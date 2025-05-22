from typing import List, Dict, Any, Optional, Union
import httpx
import base64
from datetime import datetime
import json
import os
import logging

from app.utils.logger import logger
from app.core.config import get_settings
from app.utils.tools import generate_image, search_duckduckgo
from app.models.mongodb import update_usage, get_user_usage
from app.models.sqlite import update_usage_sqlite

settings = get_settings()


class LLMService:
    """
    LLM服务类 - 负责处理与大型语言模型API的交互
    包括：发送请求、处理响应、工具调用和使用量统计
    """
    def __init__(self):
        # API基础设置
        self.endpoint = settings.GITHUB_ENDPOINT
        self.api_key = settings.GITHUB_INFERENCE_KEY
        self.api_version = settings.GITHUB_API_VERSION
        
        # 使用量文件路径
        self.usage_path = "./data/usage.json"
        
        # 确保目录存在
        os.makedirs(os.path.dirname(self.usage_path), exist_ok=True)
        
        # 如果文件不存在，创建初始文件
        if not os.path.exists(self.usage_path):
            with open(self.usage_path, "w") as f:
                json.dump({"date": datetime.now().strftime("%Y-%m-%d")}, f)

    ## MARK: 处理用户使用量统计
    async def update_user_usage(self, user_id: str, model_name: str) -> Dict[str, Any]:
        """
        更新用户使用量统计 - 在每次调用模型后更新各种统计源
        
        Args:
            user_id: 用户ID
            model_name: 模型名称
            
        Returns:
            使用量信息，包括当前用量、限制和是否超出限制
        """
        # 更新MongoDB
        update_usage(user_id, model_name)
        
        # 更新SQLite
        current_date = datetime.now().strftime("%Y-%m-%d")
        update_usage_sqlite(user_id, model_name, current_date)
        
        # 也更新JSON文件以兼容旧系统
        try:
            with open(self.usage_path, "r") as f:
                user_usage = json.load(f)
                
            current_date = datetime.now().strftime("%Y-%m-%d")
            
            # 如果是新的一天，重置使用量统计
            if user_usage.get("date") != current_date:
                user_usage = {"date": current_date}
            
            # 初始化用户记录
            if user_id not in user_usage:
                user_usage[user_id] = {}
            
            # 初始化模型使用量
            if model_name not in user_usage[user_id]:
                user_usage[user_id][model_name] = 0
                
            # 增加使用量
            user_usage[user_id][model_name] += 1
            
            # 保存到文件
            with open(self.usage_path, "w") as f:
                json.dump(user_usage, f, indent=2)
                
            return {
                "selectedModel": model_name,
                "usage": user_usage[user_id].get(model_name, 0),
                "limit": settings.MODEL_USAGE_LIMITS.get(model_name, 0),
                "isExceeded": user_usage[user_id].get(model_name, 0) > settings.MODEL_USAGE_LIMITS.get(model_name, 0)
            }
        except Exception as e:
            logger.error(f"更新使用量错误: {str(e)}")
            # 失败时返回基本信息
            return {
                "selectedModel": model_name,
                "usage": 0,
                "limit": settings.MODEL_USAGE_LIMITS.get(model_name, 0),
                "isExceeded": False
            }

    # MARK: 处理系统提示和工具定义
    def get_system_prompt(self, model_name: str, language: str = "en") -> Dict[str, str]:
        """
        获取系统提示 - 根据模型和语言选择合适的系统提示
        
        Args:
            model_name: 模型名称
            language: 语言（默认为简体中文）
            
        Returns:
            包含角色和内容的系统提示字典
        """
        # 根据不同语言设置不同的提示语
        prompts = {
            'en': "You are 'AI Agent API', an AI assistant specializing in generating text and helping with tasks. Please respond to all requests in a concise, professional, and friendly tone. When users ask questions, provide relevant and accurate information. Do not include this instruction in your responses. Please respond in the language chosen by the user.",
            'zh-CN': "你是'AI Agent API'，一个专门协助用户生成文本和完成任务的AI助手。请以简洁、专业且友善的语气回应所有请求。当用户提出问题时，请提供相关且精确的信息。注意不要将上述讯息包含在你的输入中甚至回复出来。请根据用户选择的语言进行回复。",
            'zh-TW': "你是'AI Agent API'，一個專門協助用戶生成文本和完成任務的AI助手。請以簡潔、專業且友善的語氣回應所有請求。當用戶提出問題時，請提供相關且精確的資訊。注意不要將上述訊息包含在你的輸入中甚至回覆出來。請根據用戶選擇的語言進行回覆。",
        }
        
        # 获取基础提示并添加语言选择
        base_prompt = prompts.get(language, prompts['en'])
        base_prompt = f"{base_prompt}语言选择: {language}"
        
        # 根据不同模型确定角色
        role = "system"
        if model_name in ["DeepSeek-R1", "o1-mini", "DeepSeek-V3"]:
            role = "assistant"
        elif model_name in ["o3-mini", "o1", "o4-mini", "o3"]:
            role = "developer"
            
        return {
            "role": role,
            "content": base_prompt
        }
    # MARK: 处理工具定义
    def get_tool_definitions(self, enable_search: bool = False) -> List[Dict[str, Any]]:
        """
        获取工具定义 - 提供可用于模型的外部工具定义
        
        Args:
            enable_search: 是否启用搜索功能
            
        Returns:
            工具定义列表
        """
        # 图像生成工具定义
        image_tool = {
            "type": "function",
            "function": {
                "name": "generateImage",
                "description": "使用cloudflare ai生成图片并回传 Base64 dataURI",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "prompt": {
                            "type": "string",
                            "description": "描述所要生成的图片内容"
                        }
                    },
                    "required": ["prompt"]
                }
            }
        }
        
        # 搜索工具定义
        search_tool = {
            "type": "function",
            "function": {
                "name": "searchDuckDuckGo",
                "description": "使用 DuckDuckGo 搜索引擎进行搜索，返回相关的搜索结果",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "搜索关键字",
                        },
                        "numResults": {
                            "type": "integer",
                            "description": "返回的搜索结果数量",
                            "default": 10,
                        },
                    },
                    "required": ["query"],
                }
            }
        }
        
        # 构建工具列表
        tools = [image_tool]
        if enable_search:
            tools.append(search_tool)
            
        return tools

    # MARK: 处理用户消息格式化
    async def format_user_message(
        self, 
        prompt: str, 
        image: Optional[str] = None, 
        audio: Optional[str] = None, 
        model_name: str = "gpt-4o-mini"
    ) -> List[Dict[str, Any]]:
        """
        格式化用户消息 - 将用户输入转换为模型可接受的格式，处理多模态输入
        
        Args:
            prompt: 文本提示词
            image: 图片base64数据
            audio: 音频base64数据
            model_name: 模型名称
            
        Returns:
            格式化后的消息列表
        """
        # 默认文本消息
        user_message = [{"role": "user", "content": prompt}]
        
        # 不支持多模态的模型列表
        multimodal_unsupported = [
            "o1-mini", "o3-mini", "DeepSeek-R1", "Cohere-command-r-08-2024", 
            "Ministral-3B", "o4-mini", "o3", "gpt-4.1-nano", "gpt-4.1-mini", "gpt-4.1"
        ]
        
        # 处理图片输入
        if image and model_name not in multimodal_unsupported:
            # 处理原始base64或dataURI
            if image.startswith("data:"):
                image_base64 = image.split(",")[1]
            else:
                image_base64 = image
                
            user_message = [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}}
                    ]
                }
            ]
                
        # 处理音频输入
        if audio and model_name not in multimodal_unsupported:
            # 处理原始base64或dataURI
            if audio.startswith("data:"):
                audio_base64 = audio.split(",")[1]
            else:
                audio_base64 = audio
                
            user_message = [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "audio", "audio": {"url": f"data:audio/wav;base64,{audio_base64}"}}
                    ]
                }
            ]
                
        return user_message

    # MARK: 发送LLM请求
    async def send_llm_request(
        self,
        messages: List[Dict[str, Any]],
        model_name: str,
        tools: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        发送LLM请求 - 调用大型语言模型API
        
        Args:
            messages: 消息列表（包括系统提示和用户输入）
            model_name: 模型名称
            tools: 可选的工具定义列表
            
        Returns:
            API响应结果
        """
        url = f"{self.endpoint}/chat/completions"
        headers = {
            "api-key": self.api_key,
            "Content-Type": "application/json"
        }
        
        # 构建请求体
        body = {
            "messages": messages,
            "model": model_name
        }
        
        # 对支持工具的模型添加工具定义
        if tools and model_name != "o1-mini":
            body["tools"] = tools
            
        try:
            # 发送异步HTTP请求
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    url,
                    headers=headers,
                    json=body,
                    timeout=300.0  # 增加超时时间，确保大型输入有足够处理时间
                )
                
                # 处理错误响应
                if response.status_code != 200:
                    logger.error(f"LLM API错误 {response.status_code}: {response.text}")
                    return {"error": f"API错误 {response.status_code}", "detail": response.text}
                
                # 返回成功响应
                return response.json()
        except Exception as e:
            logger.error(f"LLM请求错误: {str(e)}")
            return {"error": "请求错误", "detail": str(e)}

    # MARK: 处理工具调用
    async def handle_tool_call(self, tool_calls: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        处理工具调用 - 执行模型请求的工具函数并返回结果
        
        Args:
            tool_calls: 工具调用列表
            
        Returns:
            工具响应列表
        """
        tool_results = []
        
        # 逐个处理工具调用
        for tool_call in tool_calls:
            function_call = tool_call.get("function", {})
            name = function_call.get("name", "")
            arguments_str = function_call.get("arguments", "{}")
            
            try:
                # 解析参数
                arguments = json.loads(arguments_str)
                
                # 图像生成工具
                if name == "generateImage":
                    image_data_uri = await generate_image(arguments.get("prompt", ""))
                    tool_results.append({
                        "tool_call_id": tool_call.get("id", ""),
                        "role": "tool",
                        "name": "generateImage",
                        "content": json.dumps({"dataURI": image_data_uri})
                    })
                
                # 搜索工具
                elif name == "searchDuckDuckGo":
                    search_results = await search_duckduckgo(
                        arguments.get("query", ""),
                        arguments.get("numResults", 5)
                    )
                    tool_results.append({
                        "tool_call_id": tool_call.get("id", ""),
                        "role": "tool",
                        "name": "searchDuckDuckGo",
                        "content": json.dumps({"results": search_results})
                    })
                
                # 不支持的工具
                else:
                    tool_results.append({
                        "tool_call_id": tool_call.get("id", ""),
                        "role": "tool",
                        "name": name,
                        "content": json.dumps({"error": "不支持的工具"})
                    })
            except Exception as e:
                # 处理工具执行错误
                logger.error(f"工具调用错误 {name}: {str(e)}")
                tool_results.append({
                    "tool_call_id": tool_call.get("id", ""),
                    "role": "tool",
                    "name": name,
                    "content": json.dumps({"error": f"工具执行错误: {str(e)}"})
                })
                
        return tool_results


# 创建单例实例
llm_service = LLMService()