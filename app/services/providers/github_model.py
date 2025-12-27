"""
GitHub Models Provider (Azure AI Foundry)
負責處理 GitHub Models / Azure AI Inference API 的交互
支持 OpenAI 兼容的 Chat Completions API
統一使用 Streaming 模式
參考文檔: https://learn.microsoft.com/en-us/azure/ai-foundry/foundry-models/concepts/endpoints
"""

from typing import List, Dict, Any, Optional, AsyncIterator
import httpx
import json

from .base import BaseProvider, ModelProvider
from app.core.config import get_settings

settings = get_settings()


class GitHubModelProvider(BaseProvider):
    """
    GitHub Models Provider (基於 Azure AI Foundry)
    使用 OpenAI 兼容的 Chat Completions API
    統一使用 Streaming 模式
    """
    
    def __init__(self):
        super().__init__()
        self.provider_type = ModelProvider.GITHUB
        self.endpoint = settings.GITHUB_ENDPOINT
        self.api_key = settings.GITHUB_INFERENCE_KEY
        self.api_version = settings.GITHUB_API_VERSION
    
    def get_supported_models(self) -> List[str]:
        """獲取支持的模型列表"""
        return settings.ALLOWED_GITHUB_MODELS if hasattr(settings, 'ALLOWED_GITHUB_MODELS') else []
    
    def is_available(self) -> bool:
        """檢查 Provider 是否可用"""
        return bool(self.api_key and self.endpoint)
    
    async def send_request(
        self,
        messages: List[Dict[str, Any]],
        model_name: str,
        tools: Optional[List[Dict[str, Any]]] = None,
        **kwargs
    ) -> AsyncIterator[Dict[str, Any]]:
        """
        發送流式請求 - 使用 SSE (Server-Sent Events)
        
        Yields:
            OpenAI 兼容的 SSE 格式響應塊
        """
        url = f"{self.endpoint}/chat/completions"
        headers = {
            "api-key": self.api_key,
            "Content-Type": "application/json",
            "Accept": "text/event-stream"
        }
        
        body = {
            "messages": messages,
            "model": model_name,
            "stream": True,
            "stream_options": {"include_usage": True}  # 請求最後返回使用量統計
        }
        
        if tools and self.supports_tools(model_name):
            body["tools"] = tools
            body["tool_choice"] = "auto"
        
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
                        self.logger.error(f"GitHub Streaming API 錯誤 {response.status_code}: {error_text.decode()}")
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
                                yield chunk
                            except json.JSONDecodeError as e:
                                self.logger.warning(f"無法解析 SSE 數據: {data}, 錯誤: {e}")
                                continue
                        
                        # 忽略 SSE 注釋（以 : 開頭）
                        elif line.startswith(":"):
                            continue
                            
        except httpx.TimeoutException as e:
            self.logger.error(f"GitHub Streaming 請求超時: {str(e)}")
            yield self._format_stream_error("GitHub 請求超時", "請求處理時間過長")
        except Exception as e:
            self.logger.error(f"GitHub Streaming 請求錯誤: {str(e)}")
            yield self._format_stream_error("Streaming 請求錯誤", str(e))
