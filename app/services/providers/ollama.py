"""
Ollama Provider
負責處理本地 Ollama API 的交互
使用 /api/chat 端點，統一使用流式傳輸
參考文檔: https://docs.ollama.com/api/introduction
"""

from typing import List, Dict, Any, Optional, AsyncIterator
import httpx
import json

from .base import BaseProvider, ModelProvider
from app.core.config import get_settings

settings = get_settings()


class OllamaProvider(BaseProvider):
    """
    Ollama Provider
    使用本地 Ollama API 進行模型調用
    統一使用 Streaming 模式
    注意: Ollama API 默認啟用 streaming (stream=true)
    """
    
    def __init__(self):
        super().__init__()
        self.provider_type = ModelProvider.OLLAMA
        self.endpoint = settings.OLLAMA_ENDPOINT
        self.api_key = settings.OLLAMA_API_KEY
        self.default_model = settings.OLLAMA_DEFAULT_MODEL
    
    def get_supported_models(self) -> List[str]:
        """獲取支持的模型列表"""
        return settings.ALLOWED_OLLAMA_MODELS if hasattr(settings, 'ALLOWED_OLLAMA_MODELS') else []
    
    def is_available(self) -> bool:
        """檢查 Provider 是否可用"""
        return bool(self.endpoint)
    
    async def send_request(
        self,
        messages: List[Dict[str, Any]],
        model_name: str,
        tools: Optional[List[Dict[str, Any]]] = None,
        **kwargs
    ) -> AsyncIterator[Dict[str, Any]]:
        """
        發送流式請求
        
        Ollama 使用 JSON Lines 格式（每行一個 JSON 對象）而非 SSE
        每個響應包含部分 message.content
        最後一個響應包含 done: true 和完整的統計信息
        
        Yields:
            轉換為 OpenAI 兼容格式的響應塊
        """
        url = f"{self.endpoint}/api/chat"
        
        headers = {
            "Content-Type": "application/json"
        }
        
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        
        body = {
            "model": model_name,
            "messages": messages,
            "stream": True  # Ollama 默認就是 True
        }
        
        if tools and self.supports_tools(model_name):
            body["tools"] = tools
        
        try:
            async with httpx.AsyncClient(timeout=settings.OLLAMA_REQUEST_TIMEOUT) as client:
                async with client.stream(
                    "POST",
                    url,
                    headers=headers,
                    json=body
                ) as response:
                    if response.status_code != 200:
                        error_text = await response.aread()
                        self.logger.error(f"Ollama Streaming API 錯誤 {response.status_code}: {error_text.decode()}")
                        yield self._format_stream_error(
                            f"API 錯誤 {response.status_code}",
                            error_text.decode()
                        )
                        return
                    
                    # Ollama 返回 JSON Lines 格式（每行一個 JSON 對象）
                    chunk_index = 0
                    
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        
                        try:
                            ollama_chunk = json.loads(line)
                            
                            # 獲取內容增量
                            message = ollama_chunk.get("message", {})
                            content_delta = message.get("content", "")
                            tool_calls = message.get("tool_calls")
                            
                            # 檢查是否完成
                            is_done = ollama_chunk.get("done", False)
                            
                            # 轉換為 OpenAI 兼容格式
                            finish_reason = None
                            usage = None
                            
                            if is_done:
                                finish_reason = "tool_calls" if tool_calls else "stop"
                                # Ollama 在最後一個響應中提供使用量統計
                                usage = {
                                    "prompt_tokens": ollama_chunk.get("prompt_eval_count", 0),
                                    "completion_tokens": ollama_chunk.get("eval_count", 0),
                                    "total_tokens": (
                                        ollama_chunk.get("prompt_eval_count", 0) + 
                                        ollama_chunk.get("eval_count", 0)
                                    )
                                }
                            
                            # 生成 OpenAI 兼容的 chunk
                            openai_chunk = self._format_stream_chunk(
                                content=content_delta,
                                model_name=ollama_chunk.get("model", model_name),
                                finish_reason=finish_reason,
                                tool_calls=tool_calls,
                                usage=usage,
                                chunk_id=f"ollama-{chunk_index}"
                            )
                            
                            chunk_index += 1
                            yield openai_chunk
                            
                            if is_done:
                                break
                                
                        except json.JSONDecodeError as e:
                            self.logger.warning(f"無法解析 Ollama 響應行: {line}, 錯誤: {e}")
                            continue
                            
        except httpx.ConnectError as e:
            self.logger.error(f"無法連接到 Ollama 服務器: {str(e)}")
            yield self._format_stream_error(
                "連接 Ollama 服務器失敗",
                f"請確保 Ollama 服務正在 {self.endpoint} 運行"
            )
        except httpx.TimeoutException as e:
            self.logger.error(f"Ollama Streaming 請求超時: {str(e)}")
            yield self._format_stream_error("Ollama 請求超時", "請求處理時間過長")
        except Exception as e:
            self.logger.error(f"Ollama Streaming 請求錯誤: {str(e)}")
            yield self._format_stream_error("Streaming 請求錯誤", str(e))
