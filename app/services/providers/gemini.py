"""
Google Gemini Provider
負責處理 Google Gemini API 的交互
使用最新的 google-genai SDK (pip install google-genai)
統一使用 Streaming 模式
參考文檔: https://ai.google.dev/gemini-api/docs
"""

from typing import List, Dict, Any, Optional, AsyncIterator
import base64
import json
import asyncio
from datetime import datetime

from .base import BaseProvider, ModelProvider
from app.core.config import get_settings

settings = get_settings()

# 嘗試導入新版 Gemini SDK (google-genai)
try:
    from google import genai
    from google.genai import types
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False
    genai = None
    types = None


class GeminiProvider(BaseProvider):
    """
    Google Gemini Provider
    使用最新的 Google GenAI SDK 進行模型調用
    統一使用 Streaming 模式
    """
    
    def __init__(self):
        super().__init__()
        self.provider_type = ModelProvider.GEMINI
        self.api_key = settings.GEMINI_API_KEY if GEMINI_AVAILABLE else None
        self.default_model = settings.GEMINI_DEFAULT_MODEL if GEMINI_AVAILABLE else None
        
        # 初始化 Gemini 客戶端 (新版 SDK 使用 Client 物件)
        if GEMINI_AVAILABLE and self.api_key:
            self.client = genai.Client(api_key=self.api_key)
        else:
            self.client = None
            if not GEMINI_AVAILABLE:
                self.logger.warning("未安裝 google-genai 庫，請執行: pip install google-genai")
            elif not self.api_key:
                self.logger.warning("Gemini API 密鑰未設置，無法使用 Gemini 模型")
    
    def get_supported_models(self) -> List[str]:
        """獲取支持的模型列表"""
        return settings.ALLOWED_GEMINI_MODELS if hasattr(settings, 'ALLOWED_GEMINI_MODELS') else []
    
    def is_available(self) -> bool:
        """檢查 Provider 是否可用"""
        return GEMINI_AVAILABLE and self.client is not None
    
    async def send_request(
        self,
        messages: List[Dict[str, Any]],
        model_name: str,
        tools: Optional[List[Dict[str, Any]]] = None,
        **kwargs
    ) -> AsyncIterator[Dict[str, Any]]:
        """
        發送流式請求
        
        使用 client.models.generate_content_stream() 方法
        
        Yields:
            轉換為 OpenAI 兼容格式的響應塊
        """
        if not self.is_available():
            yield self._format_stream_error(
                "Gemini 不可用",
                "請安裝 google-genai 庫 (pip install google-genai) 並設置 API 密鑰"
            )
            return
        
        try:
            # 轉換消息格式為 Gemini 格式
            gemini_contents = self._convert_messages_to_gemini_format(messages, model_name)
            
            # 檢查是否有有效的內容
            if not gemini_contents:
                self.logger.warning("消息轉換後內容為空，添加預設內容")
                gemini_contents = [types.Content(
                    role="user", 
                    parts=[types.Part.from_text(text="請回應")]
                )]
            
            # 構建配置
            config = self._build_generate_config(messages, model_name, tools, **kwargs)
            
            # 使用 asyncio 在執行器中運行流式 API
            loop = asyncio.get_running_loop()
            
            def sync_generate_stream():
                return self.client.models.generate_content_stream(
                    model=model_name,
                    contents=gemini_contents,
                    config=config,
                )
            
            # 獲取流式響應迭代器
            stream_response = await loop.run_in_executor(None, sync_generate_stream)
            
            # 檢查流式響應是否有效
            if stream_response is None:
                yield self._format_stream_error("Gemini 響應無效", "流式響應為空")
                return
            
            chunk_index = 0
            
            # 處理每個響應塊
            def get_next_chunk(iterator):
                try:
                    return next(iterator)
                except StopIteration:
                    return None
            
            while True:
                chunk = await loop.run_in_executor(None, get_next_chunk, stream_response)
                if chunk is None:
                    break
                
                # 提取文本增量
                text_delta = ""
                function_call = None
                
                if hasattr(chunk, 'candidates') and chunk.candidates:
                    for candidate in chunk.candidates:
                        if hasattr(candidate, 'content') and candidate.content:
                            # 確保 parts 不是 None
                            parts = getattr(candidate.content, 'parts', None)
                            if parts:
                                for part in parts:
                                    if hasattr(part, 'function_call') and part.function_call:
                                        function_call = {
                                            "name": part.function_call.name,
                                            "arguments": part.function_call.args
                                        }
                                    elif hasattr(part, 'text') and part.text:
                                        text_delta = part.text
                
                # 如果沒有從 candidates 中獲取到文本，嘗試從 text 屬性獲取
                if not text_delta and not function_call:
                    text_delta = getattr(chunk, 'text', "") or ""
                
                # 構建工具調用 (如果有)
                tool_calls = None
                if function_call:
                    tool_calls = [{
                        "index": 0,
                        "id": f"call_{datetime.now().timestamp()}",
                        "type": "function",
                        "function": {
                            "name": function_call["name"],
                            "arguments": json.dumps(function_call["arguments"]) 
                                if isinstance(function_call["arguments"], dict) 
                                else function_call["arguments"]
                        }
                    }]
                
                # 檢查是否完成
                finish_reason = None
                if hasattr(chunk, 'candidates') and chunk.candidates:
                    candidate = chunk.candidates[0]
                    if hasattr(candidate, 'finish_reason') and candidate.finish_reason:
                        finish_reason_str = str(candidate.finish_reason)
                        if 'STOP' in finish_reason_str:
                            finish_reason = "stop"
                        elif 'TOOL' in finish_reason_str or function_call:
                            finish_reason = "tool_calls"
                
                # 生成 OpenAI 兼容的 chunk
                openai_chunk = self._format_stream_chunk(
                    content=text_delta,
                    model_name=model_name,
                    finish_reason=finish_reason,
                    tool_calls=tool_calls,
                    chunk_id=f"gemini-{chunk_index}"
                )
                
                chunk_index += 1
                yield openai_chunk
                
        except Exception as e:
            self.logger.error(f"Gemini Streaming 請求錯誤: {str(e)}")
            yield self._format_stream_error("Gemini Streaming 請求錯誤", str(e))
    
    # 不支持 system instruction 的模型列表
    MODELS_WITHOUT_SYSTEM_INSTRUCTION = [
        "gemma",  # Gemma 系列模型不支持 developer instruction
    ]
    
    def _model_supports_system_instruction(self, model_name: str) -> bool:
        """
        檢查模型是否支持 system instruction
        
        Args:
            model_name: 模型名稱
            
        Returns:
            是否支持 system instruction
        """
        model_lower = model_name.lower()
        for unsupported in self.MODELS_WITHOUT_SYSTEM_INSTRUCTION:
            if unsupported in model_lower:
                return False
        return True
    
    def _build_generate_config(
        self,
        messages: List[Dict[str, Any]],
        model_name: str,
        tools: Optional[List[Dict[str, Any]]] = None,
        **kwargs
    ):
        """
        構建 GenerateContentConfig 配置
        
        Args:
            messages: 原始消息列表（用於提取 system instruction）
            model_name: 模型名稱（用於檢查是否支持 system instruction）
            tools: 可選的工具定義
            **kwargs: 其他配置參數
            
        Returns:
            types.GenerateContentConfig 配置對象
        """
        config_params = {}
        
        # 檢查模型是否支持 system instruction
        supports_system_instruction = self._model_supports_system_instruction(model_name)
        
        # 提取 system instruction (從 messages 中找 role=system 的消息)
        system_instruction = None
        if supports_system_instruction:
            for msg in messages:
                if msg.get("role") == "system":
                    content = msg.get("content", "")
                    if isinstance(content, str):
                        system_instruction = content
                    elif isinstance(content, list):
                        # 處理多部分內容
                        text_parts = [item.get("text", "") for item in content if item.get("type") == "text"]
                        system_instruction = " ".join(text_parts)
                    break

        
        if system_instruction:
            config_params["system_instruction"] = system_instruction
        
        # 轉換工具定義
        if tools:
            gemini_tools = self._convert_tools_to_gemini_format(tools)
            if gemini_tools:
                config_params["tools"] = [gemini_tools]
                # 禁用自動函式呼叫，讓上層處理
                config_params["automatic_function_calling"] = types.AutomaticFunctionCallingConfig(disable=True)
        
        # 添加可選參數
        if "temperature" in kwargs:
            config_params["temperature"] = kwargs["temperature"]
        if "max_tokens" in kwargs:
            config_params["max_output_tokens"] = kwargs["max_tokens"]
        if "top_p" in kwargs:
            config_params["top_p"] = kwargs["top_p"]
        if "top_k" in kwargs:
            config_params["top_k"] = kwargs["top_k"]
        
        return types.GenerateContentConfig(**config_params)
    
    def _convert_messages_to_gemini_format(
        self, 
        messages: List[Dict[str, Any]],
        model_name: str = ""
    ) -> List:
        """
        將標準消息格式轉換為 Gemini 格式
        
        新版 SDK 使用 types.Content 和 types.Part
        對於支持 system instruction 的模型，system 消息通過 config.system_instruction 傳遞
        對於不支持的模型，system 消息會被合併到第一個 user 消息中
        
        Args:
            messages: 標準格式的消息列表
            model_name: 模型名稱（用於檢查是否支持 system instruction）
            
        Returns:
            Gemini 格式的消息列表
        """
        gemini_contents = []
        supports_system = self._model_supports_system_instruction(model_name) if model_name else True
        
        # 對於不支持 system instruction 的模型，提取 system 消息內容
        system_content = ""
        if not supports_system:
            for msg in messages:
                if msg.get("role") == "system":
                    content = msg.get("content", "")
                    if isinstance(content, str):
                        system_content = content
                    elif isinstance(content, list):
                        text_parts = [item.get("text", "") for item in content if item.get("type") == "text"]
                        system_content = " ".join(text_parts)
                    break
        
        first_user_processed = False
        
        for msg in messages:
            role = msg.get("role", "").lower()
            content = msg.get("content", "")
            
            # system 消息：如果模型支持則跳過（已通過 config 傳遞），否則已提取
            if role == "system":
                continue
            
            # 構建 Parts
            parts = []
            
            # 對於不支持 system instruction 的模型，將 system 內容合併到第一個 user 消息
            if not supports_system and role == "user" and not first_user_processed and system_content:
                parts.append(types.Part.from_text(text=f"[系統指令] {system_content}\n\n"))
                first_user_processed = True
            
            if isinstance(content, str):
                if content.strip():  # 只添加非空內容
                    parts.append(types.Part.from_text(text=content))
            elif isinstance(content, list):
                for item in content:
                    if item.get("type") == "text":
                        text_content = item.get("text", "")
                        if text_content.strip():  # 只添加非空內容
                            parts.append(types.Part.from_text(text=text_content))
                    elif item.get("type") == "image_url":
                        image_url = item.get("image_url", {}).get("url", "")
                        if image_url.startswith("data:image"):
                            # 處理 base64 編碼的圖片
                            try:
                                # 格式: data:image/png;base64,xxxxx
                                header, base64_data = image_url.split(",", 1)
                                mime_type = header.split(":")[1].split(";")[0]
                                image_bytes = base64.b64decode(base64_data)
                                parts.append(types.Part.from_bytes(
                                    data=image_bytes,
                                    mime_type=mime_type
                                ))
                            except Exception as e:
                                self.logger.warning(f"無法解析 base64 圖片: {e}")
            elif content:  # 只處理非空內容
                parts.append(types.Part.from_text(text=str(content)))
            
            # 映射角色
            gemini_role = "user"
            if role == "assistant":
                gemini_role = "model"
            elif role == "tool":
                gemini_role = "user"  # 工具響應作為 user 角色
            
            if parts:
                gemini_contents.append(types.Content(role=gemini_role, parts=parts))
        
        return gemini_contents
    
    def _convert_tools_to_gemini_format(self, tools: List[Dict[str, Any]]):
        """
        將 OpenAI 格式的工具轉換為 Gemini 格式
        
        新版 SDK 使用 types.Tool(function_declarations=[...])
        
        Args:
            tools: OpenAI 格式的工具定義
            
        Returns:
            Gemini 格式的 Tool 對象
        """
        function_declarations = []
        
        for tool in tools:
            if tool.get("type") == "function":
                function_info = tool.get("function", {})
                declaration = {
                    "name": function_info.get("name", ""),
                    "description": function_info.get("description", ""),
                    "parameters": function_info.get("parameters", {})
                }
                function_declarations.append(declaration)
                self.logger.debug(f"轉換工具為 Gemini 格式: {declaration['name']}")
        
        if function_declarations:
            try:
                gemini_tools = types.Tool(function_declarations=function_declarations)
                self.logger.info(f"成功創建 Gemini 工具定義，函數數量: {len(function_declarations)}")
                return gemini_tools
            except Exception as e:
                self.logger.error(f"創建 Gemini 工具定義失敗: {str(e)}")
                return None
        
        return None
