"""
基礎 Provider 抽象類
定義所有 LLM Provider 的通用接口
支持 Streaming 和非 Streaming 模式
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional, AsyncIterator
from enum import Enum
from datetime import datetime

from app.utils.logger import logger


class ModelProvider(Enum):
    """模型提供商枚舉類"""
    GITHUB = "github"
    GEMINI = "gemini"
    OLLAMA = "ollama"
    NVIDIA_NIM = "nvidia_nim"
    OPENROUTER = "openrouter"


class BaseProvider(ABC):
    """
    LLM Provider 基礎抽象類
    所有具體的 Provider 實現都需要繼承此類
    統一使用 Streaming 模式進行請求
    """
    
    def __init__(self):
        """初始化 Provider"""
        self.provider_type: ModelProvider = None
        self.logger = logger
    
    @abstractmethod
    async def send_request(
        self,
        messages: List[Dict[str, Any]],
        model_name: str,
        tools: Optional[List[Dict[str, Any]]] = None,
        **kwargs
    ) -> AsyncIterator[Dict[str, Any]]:
        """
        發送流式請求到 LLM API
        
        所有 Provider 統一使用流式模式，返回異步生成器
        如需完整響應，由 LLMService 層收集並組合流式響應
        
        Args:
            messages: 消息列表
            model_name: 模型名稱
            tools: 可選的工具定義
            **kwargs: 額外參數
            
        Yields:
            逐塊返回的響應數據（OpenAI 兼容格式）
        """
        pass
    
    @abstractmethod
    def get_supported_models(self) -> List[str]:
        """
        獲取此 Provider 支持的模型列表
        
        Returns:
            支持的模型名稱列表
        """
        pass
    
    @abstractmethod
    def is_available(self) -> bool:
        """
        檢查此 Provider 是否可用
        
        Returns:
            是否可用
        """
        pass
    
    def supports_tools(self, model_name: str) -> bool:
        """
        檢查指定模型是否支持工具調用
        
        Args:
            model_name: 模型名稱
            
        Returns:
            是否支持工具調用
        """
        from app.core.config import get_settings
        settings = get_settings()
        return model_name.lower() not in [m.lower() for m in settings.UNSUPPORTED_TOOL_MODELS]
    
    def _format_standard_response(
        self,
        content: str,
        model_name: str,
        tool_calls: Optional[List[Dict[str, Any]]] = None,
        usage: Optional[Dict[str, int]] = None,
        finish_reason: str = "stop"
    ) -> Dict[str, Any]:
        """
        格式化為標準響應格式（OpenAI 兼容格式）
        
        Args:
            content: 響應內容
            model_name: 模型名稱
            tool_calls: 工具調用列表
            usage: 使用量統計
            finish_reason: 結束原因
            
        Returns:
            標準化的響應字典
        """
        message = {
            "role": "assistant",
            "content": content
        }
        
        if tool_calls:
            message["tool_calls"] = tool_calls
            finish_reason = "tool_calls"
        
        return {
            "choices": [{
                "index": 0,
                "message": message,
                "finish_reason": finish_reason
            }],
            "model": model_name,
            "id": f"{self.provider_type.value}-{datetime.now().strftime('%Y%m%d%H%M%S')}",
            "created": int(datetime.now().timestamp()),
            "usage": usage or {
                "prompt_tokens": -1,
                "completion_tokens": -1,
                "total_tokens": -1
            }
        }
    
    def _format_stream_chunk(
        self,
        content: str = "",
        model_name: str = "",
        finish_reason: Optional[str] = None,
        tool_calls: Optional[List[Dict[str, Any]]] = None,
        usage: Optional[Dict[str, int]] = None,
        chunk_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        格式化流式響應塊（OpenAI SSE 兼容格式）
        
        Args:
            content: 內容片段
            model_name: 模型名稱
            finish_reason: 結束原因（最後一個塊才有）
            tool_calls: 工具調用（如果有）
            usage: 使用量統計（最後一個塊才有）
            chunk_id: 塊 ID
            
        Returns:
            SSE 格式的響應塊
        """
        delta = {}
        if content:
            delta["content"] = content
        if tool_calls:
            delta["tool_calls"] = tool_calls
        
        chunk = {
            "id": chunk_id or f"chatcmpl-{self.provider_type.value}-{datetime.now().strftime('%Y%m%d%H%M%S%f')}",
            "object": "chat.completion.chunk",
            "created": int(datetime.now().timestamp()),
            "model": model_name,
            "choices": [{
                "index": 0,
                "delta": delta,
                "finish_reason": finish_reason
            }]
        }
        
        if usage:
            chunk["usage"] = usage
        
        return chunk
    
    def _format_error_response(self, error: str, detail: str = "") -> Dict[str, Any]:
        """
        格式化錯誤響應
        
        Args:
            error: 錯誤訊息
            detail: 詳細信息
            
        Returns:
            錯誤響應字典
        """
        return {
            "error": error,
            "detail": detail
        }
    
    def _format_stream_error(self, error: str, detail: str = "") -> Dict[str, Any]:
        """
        格式化流式錯誤響應
        
        Args:
            error: 錯誤訊息
            detail: 詳細信息
            
        Returns:
            SSE 格式的錯誤響應
        """
        return {
            "error": {
                "message": error,
                "detail": detail,
                "type": "stream_error"
            }
        }
