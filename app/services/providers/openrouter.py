"""
OpenRouter Provider
負責處理 OpenRouter API 的交互
OpenRouter 是一個 API 聚合服務，提供對多種模型的訪問
支持 OpenAI 兼容的 Chat Completions API 和 SSE Streaming
統一使用 Streaming 模式
參考文檔: https://openrouter.ai/docs/quickstart
"""

from typing import List, Dict, Any, Optional, AsyncIterator
import httpx
import json
from datetime import datetime

from .base import BaseProvider, ModelProvider
from app.core.config import get_settings

settings = get_settings()


class OpenRouterProvider(BaseProvider):
    """
    OpenRouter Provider
    使用 OpenRouter API 進行模型調用
    統一使用 Streaming 模式
    """
    
    def __init__(self):
        super().__init__()
        self.provider_type = ModelProvider.OPENROUTER
        self.endpoint = settings.OPENROUTER_ENDPOINT or "https://openrouter.ai/api/v1/chat/completions"
        self.api_key = settings.OPENROUTER_API_KEY
        self.default_model = settings.OPENROUTER_DEFAULT_MODEL
        self.app_url = getattr(settings, 'OPENROUTER_APP_URL', '')
        self.app_title = getattr(settings, 'OPENROUTER_APP_TITLE', 'LLM Service')
    
    def get_supported_models(self) -> List[str]:
        """獲取支持的模型列表"""
        return settings.ALLOWED_OPENROUTER_MODELS if hasattr(settings, 'ALLOWED_OPENROUTER_MODELS') else []
    
    def is_available(self) -> bool:
        """檢查 Provider 是否可用"""
        return bool(self.api_key)
    
    async def send_request(
        self,
        messages: List[Dict[str, Any]],
        model_name: str,
        tools: Optional[List[Dict[str, Any]]] = None,
        **kwargs
    ) -> AsyncIterator[Dict[str, Any]]:
        """
        發送流式請求 - 使用 SSE (Server-Sent Events)
        
        OpenRouter 使用標準 OpenAI SSE 格式:
        - 每個 chunk 包含 delta.content 或 delta.tool_calls
        - 最後一個 chunk 的 finish_reason 為 "stop" 或 "tool_calls"
        
        Yields:
            OpenAI 兼容的 SSE 格式響應塊
        """
        url = self.endpoint
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "text/event-stream",
            "HTTP-Referer": self.app_url,
            "X-Title": self.app_title
        }
        
        body = {
            "model": model_name,
            "messages": messages,
            "stream": True
        }
        
        if tools and self.supports_tools(model_name):
            body["tools"] = tools
            body["tool_choice"] = "auto"
        
        # 調試：記錄完整的請求體
        self.logger.debug(f"OpenRouter 請求: model={model_name}, messages數量={len(messages)}")
        for i, msg in enumerate(messages):
            role = msg.get("role")
            content_preview = str(msg.get("content", ""))[:50]
            tool_calls = msg.get("tool_calls")
            tool_call_id = msg.get("tool_call_id")
            self.logger.debug(f"  Message[{i}] role={role}, content_preview='{content_preview}', tool_calls={bool(tool_calls)}, tool_call_id={tool_call_id}")
        
        try:
            async with httpx.AsyncClient(timeout=settings.LLM_REQUEST_TIMEOUT) as client:
                async with client.stream(
                    "POST",
                    url,
                    headers=headers,
                    json=body
                ) as response:
                    if response.status_code != 200:
                        error_text = await response.aread()
                        self.logger.error(f"OpenRouter Streaming API 錯誤 {response.status_code}: {error_text.decode()}")
                        yield self._format_stream_error(
                            f"API 錯誤 {response.status_code}",
                            error_text.decode()
                        )
                        return
                    
                    # 處理 SSE 流
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        
                        # SSE 格式: "data: {...}"
                        if line.startswith("data: "):
                            data = line[6:]  # 移除 "data: " 前綴
                            
                            # 檢查結束標記
                            if data.strip() == "[DONE]":
                                break
                            
                            try:
                                chunk = json.loads(data)
                                # 處理推理模型的特殊響應格式
                                chunk = self._process_stream_chunk(chunk)
                                yield chunk
                            except json.JSONDecodeError as e:
                                self.logger.warning(f"無法解析 SSE 數據: {data}, 錯誤: {e}")
                                continue
                        
                        # 忽略 SSE 注釋
                        elif line.startswith(":"):
                            continue
                            
        except httpx.ConnectError as e:
            self.logger.error(f"無法連接到 OpenRouter 服務器: {str(e)}")
            yield self._format_stream_error("連接 OpenRouter 服務器失敗", str(e))
        except httpx.TimeoutException as e:
            self.logger.error(f"OpenRouter Streaming 請求超時: {str(e)}")
            yield self._format_stream_error("OpenRouter 請求超時", "請求處理時間過長")
        except Exception as e:
            self.logger.error(f"OpenRouter Streaming 請求錯誤: {str(e)}")
            yield self._format_stream_error("Streaming 請求錯誤", str(e))
    
    def _process_stream_chunk(self, chunk: Dict[str, Any]) -> Dict[str, Any]:
        """
        處理流式響應塊，標準化格式
        
        Args:
            chunk: 原始響應塊
            
        Returns:
            處理後的響應塊
        """
        if "choices" in chunk and chunk["choices"]:
            for choice in chunk["choices"]:
                delta = choice.get("delta", {})
                
                # 處理推理模型的 reasoning 字段
                if not delta.get("content") and delta.get("reasoning"):
                    delta["content"] = delta["reasoning"]
                
                # 處理模型拒絕響應
                if not delta.get("content") and delta.get("refusal"):
                    delta["content"] = f"[拒絕] {delta['refusal']}"
        
        return chunk
