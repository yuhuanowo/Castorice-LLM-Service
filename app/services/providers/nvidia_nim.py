"""
NVIDIA NIM Provider
負責處理 NVIDIA NIM API 的交互
NVIDIA NIM 使用 OpenAI 兼容的 API 格式
統一使用 Streaming 模式
參考文檔: https://build.nvidia.com/explore/discover
"""

from typing import List, Dict, Any, Optional, AsyncIterator
import httpx
import json

from .base import BaseProvider, ModelProvider
from app.core.config import get_settings

settings = get_settings()


class NvidiaNimProvider(BaseProvider):
    """
    NVIDIA NIM Provider
    使用 NVIDIA NIM API 進行模型調用
    完全兼容 OpenAI API 格式
    統一使用 Streaming 模式
    """
    
    def __init__(self):
        super().__init__()
        self.provider_type = ModelProvider.NVIDIA_NIM
        self.endpoint = settings.NVIDIA_NIM_ENDPOINT
        self.api_key = settings.NVIDIA_NIM_API_KEY
        self.default_model = settings.NVIDIA_NIM_DEFAULT_MODEL
    
    def get_supported_models(self) -> List[str]:
        """獲取支持的模型列表"""
        return settings.ALLOWED_NVIDIA_NIM_MODELS if hasattr(settings, 'ALLOWED_NVIDIA_NIM_MODELS') else []
    
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
        
        NVIDIA NIM 使用標準 OpenAI SSE 格式
        
        Yields:
            OpenAI 兼容的 SSE 格式響應塊
        """
        url = self.endpoint
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "text/event-stream",
            "Content-Type": "application/json"
        }
        
        body = {
            "model": model_name,
            "messages": messages,
            "max_tokens": kwargs.get("max_tokens", 8192),
            "temperature": kwargs.get("temperature", 0.20),
            "top_p": kwargs.get("top_p", 0.70),
            "frequency_penalty": kwargs.get("frequency_penalty", 0.00),
            "presence_penalty": kwargs.get("presence_penalty", 0.00),
            "stream": True
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
                        self.logger.error(f"NVIDIA NIM Streaming API 錯誤 {response.status_code}: {error_text.decode()}")
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
                        
                        # 忽略 SSE 注釋
                        elif line.startswith(":"):
                            continue
                            
        except httpx.ConnectError as e:
            self.logger.error(f"無法連接到 NVIDIA NIM 服務器: {str(e)}")
            yield self._format_stream_error(
                "連接 NVIDIA NIM 服務器失敗",
                f"請檢查網絡連接和 API 端點 {self.endpoint}"
            )
        except httpx.TimeoutException as e:
            self.logger.error(f"NVIDIA NIM Streaming 請求超時: {str(e)}")
            yield self._format_stream_error("NVIDIA NIM 請求超時", "請求處理時間過長")
        except Exception as e:
            self.logger.error(f"NVIDIA NIM Streaming 請求錯誤: {str(e)}")
            yield self._format_stream_error("Streaming 請求錯誤", str(e))
