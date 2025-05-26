from typing import List, Dict, Any, Optional, Union
import httpx
import base64
from datetime import datetime
import json
import os
import logging
import asyncio
from enum import Enum

# 添加Gemini需要的依赖
try:
    from google import genai
    from google.genai import types
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False

from app.utils.logger import logger
from app.core.config import get_settings
from app.utils.tools import generate_image, search_duckduckgo
from app.models.mongodb import update_usage, get_user_usage
from app.models.sqlite import update_usage_sqlite

settings = get_settings()


class ModelProvider(Enum):
    """模型提供商枚举类"""
    GITHUB = "github"
    GEMINI = "gemini"


class LLMService:
    """
    LLM服务类 - 负责处理与大型语言模型API的交互
    包括：发送请求、处理响应、工具调用和使用量统计
    """
    def __init__(self):
        # GitHub API设置
        self.github_endpoint = settings.GITHUB_ENDPOINT
        self.github_api_key = settings.GITHUB_INFERENCE_KEY
        self.github_api_version = settings.GITHUB_API_VERSION
          # Gemini API设置
        if GEMINI_AVAILABLE:
            self.gemini_api_key = settings.GEMINI_API_KEY
            self.gemini_default_model = settings.GEMINI_DEFAULT_MODEL
            # 初始化Gemini客户端
            if self.gemini_api_key:
                self.gemini_client = genai.Client(api_key=self.gemini_api_key)
            else:
                self.gemini_client = None
                logger.warning("Gemini API密钥未设置，无法使用Gemini模型")
        else:
            self.gemini_client = None
            logger.warning("未安装google-genai库，无法使用Gemini模型")
        
        # 存储最近生成的图片
        self.last_generated_image = None
        
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
            usage_count = user_usage[user_id].get(model_name, 0)
            limit = settings.MODEL_USAGE_LIMITS.get(model_name, 0)
            
            return {
                "selectedModel": model_name,
                "usage": usage_count,
                "limit": limit,
                "isExceeded": usage_count > limit
            }
        except Exception as e:
            logger.error(f"更新使用量错误: {str(e)}")            
            # 失败时返回基本信息
            limit = settings.MODEL_USAGE_LIMITS.get(model_name, 0)
            return {
                "selectedModel": model_name,
                "usage": 0,
                "limit": limit,
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
        # 从配置中获取提示词
        prompts = settings.PROMPT_SYSTEM_BASE
        
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
    
    def get_tool_definitions(self, enable_search: bool = False, include_advanced_tools: bool = False, enable_mcp: bool = False) -> List[Dict[str, Any]]:
        """
        获取工具定义 - 提供可用于模型的外部工具定义
        
        Args:
            enable_search: 是否启用搜索功能
            include_advanced_tools: 是否包含高级工具
            enable_mcp: 是否启用MCP工具
            
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
                "description": "使用 DuckDuckGo 搜索引擎进行搜索，仅返回搜索结果的简要信息（标题、摘要和URL）。如果需要获取特定网页的详细内容，请在搜索后使用 fetchWebpageContent 工具，但仅对真正需要深入了解的个别URL使用，以避免过多token消耗。",
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
                        }
                    },
                    "required": ["query"],
                }
            }
        }
        
        # 高级工具定义列表
        advanced_tools = []
        
        if include_advanced_tools:
            # 网页内容获取工具            
            webpage_tool = {
                "type": "function",
                "function": {
                    "name": "fetchWebpageContent",
                    "description": "获取网页内容并提取正文文本。注意：此工具会消耗大量token，请谨慎使用。仅在需要深入了解特定网页内容时使用，不要对搜索结果中的每个URL都使用此工具。最佳实践是：先用searchDuckDuckGo获取摘要，然后根据需要仅对1-2个最相关的URL使用此工具。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "url": {
                                "type": "string",
                                "description": "网页URL"
                            }
                        },
                        "required": ["url"]
                    }
                }
            }
            advanced_tools.append(webpage_tool)
            
            # 文本分析工具
            text_analysis_tool = {
                "type": "function",
                "function": {
                    "name": "analyzeText",
                    "description": "分析文本内容，执行摘要、情感分析等任务",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "text": {
                                "type": "string",
                                "description": "待分析的文本"
                            },
                            "task": {
                                "type": "string",
                                "description": "分析任务描述，如'摘要','情感分析','关键词提取'等"
                            }
                        },
                        "required": ["text", "task"]
                    }
                }
            }
            advanced_tools.append(text_analysis_tool)
            
            # 内容格式转换工具
            format_tool = {
                "type": "function",
                "function": {
                    "name": "formatContent",
                    "description": "将内容转换为指定格式，如JSON、Markdown、HTML、CSV等",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "content": {
                                "type": "string",
                                "description": "需要格式化的内容"
                            },
                            "outputFormat": {
                                "type": "string",
                                "description": "输出格式，支持'json','markdown','html','csv'"
                            }
                        },
                        "required": ["content", "outputFormat"]
                    }
                }
            }
            advanced_tools.append(format_tool)
            
            # Agent性能评估工具
            evaluation_tool = {
                "type": "function",
                "function": {
                    "name": "evaluateAgentPerformance",
                    "description": "评估Agent执行性能，包括时间、步骤数、成功率等指标",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "executionTrace": {
                                "type": "array",
                                "description": "执行跟踪记录",
                                "items": {
                                    "type": "object"
                                }
                            },
                            "expectedOutcome": {
                                "type": "string",
                                "description": "期望的结果描述（可选）"
                            }
                        },
                        "required": ["executionTrace"]
                    }
                }
            }
            advanced_tools.append(evaluation_tool)
            
            # 新增工具: 结构化数据生成
            structured_data_tool = {
                "type": "function",
                "function": {
                    "name": "generateStructuredData",
                    "description": "生成结构化数据，如JSON、CSV、表格等",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "data_type": {
                                "type": "string",
                                "description": "数据类型，如'json', 'csv', 'table', 'form'"
                            },
                            "requirements": {
                                "type": "string",
                                "description": "数据需求描述"
                            },
                            "schema": {
                                "type": "object",
                                "description": "可选的数据模式定义"
                            }
                        },
                        "required": ["data_type", "requirements"]
                    }
                }
            }
            advanced_tools.append(structured_data_tool)
            
            # 新增工具: 文本摘要
            summarize_tool = {
                "type": "function",
                "function": {
                    "name": "summarizeContent",
                    "description": "对长文本内容进行摘要",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "text": {
                                "type": "string",
                                "description": "待摘要的文本"
                            },
                            "max_length": {
                                "type": "integer",
                                "description": "摘要最大长度（字符数）",
                                "default": 500
                            }
                        },
                        "required": ["text"]
                    }
                }
            }
            advanced_tools.append(summarize_tool)
            
            # 新增工具: 文本翻译
            translate_tool = {
                "type": "function",
                "function": {
                    "name": "translateText",
                    "description": "将文本翻译成指定语言",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "text": {
                                "type": "string",
                                "description": "待翻译的文本"
                            },
                            "target_language": {
                                "type": "string",
                                "description": "目标语言，如'en', 'zh-CN', 'ja', 'fr'"
                            }
                        },
                        "required": ["text", "target_language"]
                    }
                }
            }
            advanced_tools.append(translate_tool)
            
            # 新增工具: 数据问答
            data_qa_tool = {
                "type": "function",
                "function": {
                    "name": "answerFromData",
                    "description": "根据提供的数据回答问题",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "question": {
                                "type": "string",
                                "description": "问题"
                            },
                            "data": {
                                "type": "array",
                                "description": "数据列表，每项是一个字典",
                                "items": {
                                    "type": "object"
                                }
                            }
                        },
                        "required": ["question", "data"]
                    }
                }
            }
            advanced_tools.append(data_qa_tool)
            
            # 新增工具: 保存到记忆
            save_memory_tool = {
                "type": "function",
                "function": {
                    "name": "saveToMemory",
                    "description": "将数据保存到用户记忆中",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "user_id": {
                                "type": "string",
                                "description": "用户ID"
                            },
                            "key": {
                                "type": "string",
                                "description": "记忆键名"
                            },
                            "value": {
                                "type": "object",
                                "description": "记忆值"
                            }
                        },
                        "required": ["user_id", "key", "value"]
                    }
                }
            }
            advanced_tools.append(save_memory_tool)
            
            # 新增工具: 从记忆检索
            retrieve_memory_tool = {
                "type": "function",
                "function": {
                    "name": "retrieveFromMemory",
                    "description": "从用户记忆中检索数据",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "user_id": {
                                "type": "string",
                                "description": "用户ID"
                            },
                            "key": {
                                "type": "string",
                                "description": "记忆键名，如果为空则返回所有记忆"
                            }
                        },
                        "required": ["user_id"]
                    }
                }
            }
            advanced_tools.append(retrieve_memory_tool)
            
            # 新增工具: 创建日程计划
            date_plan_tool = {
                "type": "function",
                "function": {
                    "name": "createDatePlan",
                    "description": "创建日程计划",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "location": {
                                "type": "string",
                                "description": "地点"
                            },
                            "interests": {
                                "type": "array",
                                "description": "兴趣列表",
                                "items": {
                                    "type": "string"
                                }
                            },
                            "budget": {
                                "type": "string",
                                "description": "预算（可选）"
                            },
                            "duration": {
                                "type": "string",
                                "description": "持续时间（可选）"
                            }
                        },
                        "required": ["location", "interests"]
                    }
                }
            }
            advanced_tools.append(date_plan_tool)
            
            # 新增工具: 信息整合
            integrate_info_tool = {
                "type": "function",
                "function": {
                    "name": "integrateInformation",
                    "description": "整合多个信息源并回答问题",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "sources": {
                                "type": "array",
                                "description": "信息源列表，每项是一段文本",
                                "items": {
                                    "type": "string"
                                }
                            },
                            "question": {
                                "type": "string",
                                "description": "需要回答的问题"
                            },
                            "format": {
                                "type": "string",
                                "description": "输出格式，如'markdown', 'json', 'html'",
                                "default": "markdown"
                            }
                        },
                        "required": ["sources", "question"]
                    }
                }
            }
            advanced_tools.append(integrate_info_tool)
            
            # 新增工具: 代码生成
            code_gen_tool = {
                "type": "function",
                "function": {
                    "name": "generateCode",
                    "description": "生成代码",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "requirement": {
                                "type": "string",
                                "description": "代码需求描述"
                            },
                            "language": {
                                "type": "string",
                                "description": "编程语言，如'python', 'javascript', 'java'"
                            },
                            "framework": {
                                "type": "string",
                                "description": "可选的框架，如'react', 'fastapi', 'spring'"
                            }
                        },
                        "required": ["requirement", "language"]
                    }
                }
            }
            advanced_tools.append(code_gen_tool)
              # 构建工具列表
        tools = [image_tool]
        if enable_search:
            tools.append(search_tool)
            
        # 添加高级工具
        tools.extend(advanced_tools)
          
        # 添加MCP工具（如果启用）
        if enable_mcp:
            try:
                from app.services.mcp_client import mcp_client
                
                # 直接获取已缓存的MCP工具，避免在当前同步函数中尝试异步操作
                available_tools = mcp_client.get_available_tools()
                if available_tools:
                    # 将MCP工具转换为OpenAI函数格式
                    mcp_tool_definitions = []
                    
                    for tool_key, mcp_tool in available_tools.items():
                        try:
                            # 创建工具定义，遵循OpenAI Functions格式
                            tool_def = {
                                "type": "function",
                                "function": {
                                    "name": f"mcp_{tool_key.replace(':', '_')}",
                                    "description": f"[MCP] {mcp_tool.description}",
                                    "parameters": mcp_tool.inputSchema
                                }
                            }
                            
                            # 确保参数schema符合OpenAI格式
                            if "type" not in tool_def["function"]["parameters"]:
                                tool_def["function"]["parameters"]["type"] = "object"
                            
                            if "properties" not in tool_def["function"]["parameters"]:
                                tool_def["function"]["parameters"]["properties"] = {}
                                
                            mcp_tool_definitions.append(tool_def)
                            
                        except Exception as e:
                            logger.warning(f"转换MCP工具定义失败 {tool_key}: {e}")
                            continue
                    
                    logger.info(f"添加 {len(mcp_tool_definitions)} 个MCP工具到工具定义中")
                    tools.extend(mcp_tool_definitions)
                else:
                    logger.warning("没有可用的MCP工具")
            except Exception as e:
                logger.warning(f"获取MCP工具失败: {e}")
            
        return tools
    async def _get_mcp_tools(self) -> List[Dict[str, Any]]:
        """
        动态获取MCP工具定义 - 从实际连接的MCP服务器获取工具
        这是真正的接口实现，不预定义任何工具
        
        Returns:
            从MCP服务器动态获取的工具定义列表
        """
        try:
            from app.services.mcp_client import mcp_client, init_mcp_client
              # 确保MCP客户端已初始化
            await init_mcp_client()
            
            # 获取所有可用的MCP工具
            available_tools = mcp_client.get_available_tools()
            
            if not available_tools:
                logger.info("当前没有可用的MCP工具")
                return []
            
            # 将MCP工具转换为OpenAI函数格式
            mcp_tool_definitions = []
            
            for tool_key, mcp_tool in available_tools.items():
                try:
                    # 创建工具定义，遵循OpenAI Functions格式
                    tool_def = {
                        "type": "function",
                        "function": {
                            "name": f"mcp_{tool_key.replace(':', '_')}",  # 将server:tool格式转换为mcp_server_tool
                            "description": f"[MCP] {mcp_tool.description}",
                            "parameters": mcp_tool.inputSchema
                        }
                    }
                    
                    # 确保参数schema符合OpenAI格式
                    if "type" not in tool_def["function"]["parameters"]:
                        tool_def["function"]["parameters"]["type"] = "object"
                    
                    if "properties" not in tool_def["function"]["parameters"]:
                        tool_def["function"]["parameters"]["properties"] = {}
                        
                    mcp_tool_definitions.append(tool_def)
                    
                except Exception as e:
                    logger.warning(f"转换MCP工具定义失败 {tool_key}: {e}")
                    continue
            
            logger.info(f"成功加载 {len(mcp_tool_definitions)} 个MCP工具")
            return mcp_tool_definitions
            
        except ImportError:
            logger.warning("MCP客户端未安装，跳过MCP工具加载")
            return []
        except Exception as e:
            logger.error(f"获取MCP工具定义失败: {e}")
            return []

    # MARK: Model Provider 選擇
    def _get_model_provider(self, model_name: str) -> ModelProvider:
        """
        确定模型的提供商类型
        
        Args:
            model_name: 模型名称
            
        Returns:
            模型提供商枚举值
        """
        if model_name in settings.ALLOWED_GEMINI_MODELS:
            return ModelProvider.GEMINI
        else:  # 默认为GitHub模型
            return ModelProvider.GITHUB

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
        # 检查消息内容长度，避免token爆炸
        try:
            from app.utils.tools import ensure_content_length
            
            # 处理用户消息中的内容
            for i, message in enumerate(messages):
                if message.get("role") == "user" and "content" in message and isinstance(message["content"], str):
                    # 对用户消息内容进行长度管理
                    original_length = len(message["content"])
                    message["content"] = await ensure_content_length(
                        content=message["content"],
                        max_tokens=6000,
                        context_description="用户消息"
                    )
                    
                    # 如果内容被修改，记录日志
                    if len(message["content"]) < original_length:
                        logger.info(f"用户消息已优化，原长度: {original_length}, 优化后: {len(message['content'])}")
        except Exception as e:
            logger.warning(f"消息长度管理失败，继续使用原始消息: {str(e)}")
        
        # 确定模型提供商
        provider = self._get_model_provider(model_name)
        
        # 根据提供商调用相应的请求方法
        if provider == ModelProvider.GEMINI:
            return await self._send_gemini_request(messages, model_name, tools)
        else:  # 默认使用GitHub模型
            return await self._send_github_request(messages, model_name, tools)

    # MARK: 发送GitHub模型请求
    async def _send_github_request(
        self,
        messages: List[Dict[str, Any]],
        model_name: str,
        tools: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        发送GitHub模型请求
        
        Args:
            messages: 消息列表
            model_name: 模型名称
            tools: 可选的工具定义
            
        Returns:
            API响应结果
        """
        url = f"{self.github_endpoint}/chat/completions"
        headers = {
            "api-key": self.github_api_key,
            "Content-Type": "application/json"
        }
        
        # 构建请求体
        body = {
            "messages": messages,
            "model": model_name
        }
        
        # 对支持工具的模型添加工具定义
        if tools and model_name.lower() not in [m.lower() for m in settings.UNSUPPORTED_TOOL_MODELS]:
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
                    logger.error(f"GitHub LLM API错误 {response.status_code}: {response.text}")
                    return {"error": f"API错误 {response.status_code}", "detail": response.text}
                
                # 返回成功响应
                return response.json()
        except Exception as e:
            logger.error(f"GitHub LLM请求错误: {str(e)}")
            return {"error": "请求错误", "detail": str(e)}

    # MARK: 发送Gemini模型请求
    async def _send_gemini_request(
        self,
        messages: List[Dict[str, Any]],
        model_name: str,
        tools: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        发送Gemini模型请求
        
        Args:
            messages: 消息列表
            model_name: 模型名称
            tools: 可选的工具定义
            
        Returns:
            格式化后的API响应结果，使其与GitHub模型响应格式一致
        """
        if not GEMINI_AVAILABLE or not self.gemini_client:
            return {"error": "Gemini不可用，请安装google-genai库并设置API密钥"}
        
        try:
            # 转换消息格式为Gemini格式
            gemini_messages = []
            for msg in messages:
                role = msg.get("role", "").lower()
                content = msg.get("content", "")
                
                # 构建Gemini消息
                if isinstance(content, str):
                    parts = [types.Part.from_text(text=content)]
                elif isinstance(content, list):
                    parts = []
                    for item in content:
                        if item.get("type") == "text":
                            parts.append(types.Part.from_text(text=item.get("text", "")))
                        elif item.get("type") == "image_url":
                            image_url = item.get("image_url", {}).get("url", "")
                            if image_url.startswith("data:image"):
                                # 处理base64图片
                                image_base64 = image_url.split(",")[1]
                                parts.append(types.Part.from_data(data=base64.b64decode(image_base64)))
                
                # 映射角色
                gemini_role = "user"
                if role == "system":
                    gemini_role = "user"  # Gemini没有system角色，用user替代
                elif role == "assistant":
                    gemini_role = "model"
                
                gemini_messages.append(types.Content(role=gemini_role, parts=parts))
            
            # 配置生成参数和工具定义（如果提供）
            gemini_tools = None
            if tools:
                # 将OpenAI/GitHub格式的工具转换为Gemini格式
                function_declarations = []
                for tool in tools:
                    if tool.get("type") == "function":
                        function_info = tool.get("function", {})
                        # 创建符合Gemini格式的函数声明
                        declaration = {
                            "name": function_info.get("name", ""),
                            "description": function_info.get("description", ""),
                            "parameters": function_info.get("parameters", {})
                        }
                        function_declarations.append(declaration)
                        logger.info(f"转换工具为Gemini格式: {declaration['name']}")
                
                if function_declarations:
                    try:
                        # 创建Gemini工具定义
                        gemini_tools = types.Tool(function_declarations=function_declarations)
                        logger.info(f"成功创建Gemini工具定义，函数数量: {len(function_declarations)}")
                    except Exception as e:
                        logger.error(f"创建Gemini工具定义失败: {str(e)}")
            
            # 配置生成参数
            generate_config = types.GenerateContentConfig(
                response_mime_type="text/plain",
            )
            
            # 如果有工具定义，添加到配置中
            if gemini_tools:
                generate_config.tools = [gemini_tools]
            
            # 发送请求并处理响应
            function_call = None
            response_text = ""
            
            try:
                # 获取完整响应
                response = await self._collect_gemini_stream(model_name, gemini_messages, generate_config)
                
                # 如果是字符串，说明已经提取了文本响应
                if isinstance(response, str):
                    response_text = response
                else:
                    # 处理完整响应对象 - 可能包含函数调用
                    if hasattr(response, 'candidates') and response.candidates:
                        for candidate in response.candidates:
                            if hasattr(candidate, 'content') and candidate.content:
                                for part in candidate.content.parts:
                                    # 处理函数调用
                                    if hasattr(part, 'function_call') and part.function_call:
                                        function_call = {
                                            "name": part.function_call.name,
                                            "arguments": part.function_call.args
                                        }
                                        logger.info(f"Gemini返回工具调用: {function_call['name']}")
                                    # 处理文本部分（如果有）
                                    elif hasattr(part, 'text') and part.text:
                                        if response_text:
                                            response_text += " " + part.text
                                        else:
                                            response_text = part.text
            
            except Exception as e:
                logger.error(f"Gemini请求错误: {str(e)}")
                return {"error": "Gemini请求失败", "detail": str(e)}
            
            # 构建与GitHub模型响应格式一致的响应
            choices = [{
                "message": {
                    "role": "assistant",
                    "content": response_text if response_text else None  # 如果没有文本内容则设为None
                },
                "finish_reason": "stop"
            }]
            
            # 如果有工具调用，添加到响应中
            if function_call:
                if not choices[0]["message"]["content"]:
                    # 如果没有文本内容，将content设置为空字符串而不是None
                    choices[0]["message"]["content"] = ""
                    
                choices[0]["message"]["tool_calls"] = [{
                    "id": f"call_{datetime.now().timestamp()}",
                    "type": "function",
                    "function": {
                        "name": function_call["name"],
                        "arguments": json.dumps(function_call["arguments"])
                    }
                }]
            
            return {
                "choices": choices,
                "model": model_name,
                "id": f"gemini-{datetime.now().strftime('%Y%m%d%H%M%S')}",
                "created": int(datetime.now().timestamp()),
                "usage": {
                    "prompt_tokens": -1,  # Gemini不提供token计数
                    "completion_tokens": -1,
                    "total_tokens": -1
                }
            }
        except Exception as e:
            logger.error(f"Gemini请求错误: {str(e)}")
            return {"error": "Gemini请求错误", "detail": str(e)}    
    async def _collect_gemini_stream(self, model_name, contents, config):
        """
        收集Gemini流式响应的完整内容
        
        Args:
            model_name: 模型名称
            contents: Gemini格式的内容
            config: 生成配置
            
        Returns:
            完整的响应文本或响应对象(如果有工具调用)
        """
        try:
            # 直接使用非流式API以避免异步/同步混合问题
            logger.info(f"使用非流式API获取Gemini响应，模型: {model_name}")
            
            # 先尝试在执行器中运行同步代码
            def get_response():
                try:
                    return self.gemini_client.models.generate_content(
                        model=model_name,
                        contents=contents,
                        config=config,
                    )
                except Exception as inner_error:
                    logger.error(f"Gemini API调用失败: {str(inner_error)}")
                    # 如果错误是因为安全过滤，尝试使用更宽松的安全设置
                    if "blocked" in str(inner_error).lower() or "safety" in str(inner_error).lower():
                        logger.info("尝试使用更宽松的安全设置重新请求")
                        # 配置更宽松的安全设置
                        safer_config = config
                        
                        # 添加安全设置，降低阈值
                        if GEMINI_AVAILABLE and hasattr(types, 'HarmCategory') and hasattr(types, 'HarmBlockThreshold'):
                            safer_config.safety_settings = [
                                {
                                    "category": types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                                    "threshold": types.HarmBlockThreshold.BLOCK_ONLY_HIGH
                                },
                                {
                                    "category": types.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                                    "threshold": types.HarmBlockThreshold.BLOCK_ONLY_HIGH
                                },
                                {
                                    "category": types.HarmCategory.HARM_CATEGORY_HARASSMENT,
                                    "threshold": types.HarmBlockThreshold.BLOCK_ONLY_HIGH
                                },
                                {
                                    "category": types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                                    "threshold": types.HarmBlockThreshold.BLOCK_ONLY_HIGH
                                }
                            ]
                        else:
                            # 兼容旧版API或导入失败的情况
                            safer_config.safety_settings = [
                                {
                                    "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
                                    "threshold": "BLOCK_ONLY_HIGH"
                                },
                                {
                                    "category": "HARM_CATEGORY_HATE_SPEECH",
                                    "threshold": "BLOCK_ONLY_HIGH"
                                },
                                {
                                    "category": "HARM_CATEGORY_HARASSMENT",
                                    "threshold": "BLOCK_ONLY_HIGH"
                                },
                                {
                                    "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                                    "threshold": "BLOCK_ONLY_HIGH"
                                }
                            ]
                            
                        return self.gemini_client.models.generate_content(
                            model=model_name,
                            contents=contents,
                            config=safer_config,
                        )
                    raise
            
            # 在线程池中运行同步代码
            loop = asyncio.get_running_loop()
            response = await loop.run_in_executor(None, get_response)
            
            # 检查是否存在函数调用，如果有就直接返回完整响应对象
            # 这样可以避免尝试提取不存在的文本部分
            if hasattr(response, 'candidates') and response.candidates:
                for candidate in response.candidates:
                    if hasattr(candidate, 'content') and candidate.content and hasattr(candidate.content, 'parts'):
                        for part in candidate.content.parts:
                            if hasattr(part, 'function_call') and part.function_call:
                                logger.info("检测到函数调用，返回完整响应对象")
                                return response
            
            # 如果没有函数调用，尝试获取文本响应
            # 使用 getattr 避免直接访问 text 属性可能引起的错误
            response_text = getattr(response, 'text', None)
            if response_text is not None:
                logger.info(f"返回Gemini文本响应，长度: {len(response_text)}")
                return response_text
            
            # 尝试从候选结果中提取文本
            text_parts = []
            if hasattr(response, 'candidates') and response.candidates:
                for candidate in response.candidates:
                    if hasattr(candidate, 'content') and candidate.content:
                        if hasattr(candidate.content, 'parts'):
                            for part in candidate.content.parts:
                                if hasattr(part, 'text') and part.text:
                                    text_parts.append(part.text)
            
            if text_parts:
                return " ".join(text_parts)
            
            # 如果没有找到任何文本或函数调用，返回空字符串而不是错误消息
            # 这样可以正常处理只有函数调用没有文本的情况
            return ""
            
        except Exception as e:
            logger.error(f"获取Gemini响应时出错: {str(e)}")
            return f"Gemini响应错误: {str(e)}"

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
        
        # 检查工具调用是否为None
        if tool_calls is None:
            logger.warning("工具调用为None，返回空结果列表")
            return tool_results
          # 导入工具函数
        from app.utils.tools import (
            generate_image, 
            search_duckduckgo,
            fetch_webpage_content,
            analyze_text,
            format_content,
            evaluate_agent_performance,
            generate_structured_data,
            summarize_content,
            translate_text,
            answer_from_data,
            save_to_memory,
            retrieve_from_memory,
            create_date_plan,
            integrate_information,
            generate_code
        )
        # 注意：不再导入MCP工具，MCP工具应该由MCP客户端动态处理
        
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
                    logger.info(f"处理图片生成工具调用，参数: {arguments}")
                    prompt = arguments.get("prompt", "")
                    if not prompt:
                        logger.error("图片生成缺少prompt参数")
                        tool_results.append({
                            "tool_call_id": tool_call.get("id", ""),
                            "role": "tool",
                            "name": "generateImage",
                            "content": json.dumps({"error": "missing prompt parameter"})
                        })
                        continue
                        
                    image_data_uri = await generate_image(prompt)
                    if image_data_uri:
                        # 图像生成成功
                        logger.info(f"图片生成成功，dataURI长度: {len(image_data_uri)}")
                        
                        # 存储图片数据以供API响应使用，但不直接发送给LLM
                        # 将图片数据存储在一个全局变量或上下文中
                        self.last_generated_image = image_data_uri
                        
                        # 只向LLM返回成功消息，不包含实际图片数据
                        tool_results.append({
                            "tool_call_id": tool_call.get("id", ""),
                            "role": "tool",
                            "name": "generateImage",
                            "content": json.dumps({"success": True, "message": "图片已成功生成，将在回复中显示"})
                        })
                    else:
                        # 图像生成失败
                        logger.error("图片生成失败，返回错误信息")
                        tool_results.append({
                            "tool_call_id": tool_call.get("id", ""),
                            "role": "tool",
                            "name": "generateImage",
                            "content": json.dumps({"error": "图片生成失败，请稍后重试"})
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
                
                # 网页内容获取工具
                elif name == "fetchWebpageContent":
                    url = arguments.get("url", "")
                    if not url:
                        tool_results.append({
                            "tool_call_id": tool_call.get("id", ""),
                            "role": "tool",
                            "name": "fetchWebpageContent",
                            "content": json.dumps({"error": "missing url parameter"})
                        })
                        continue
                        
                    webpage_content = await fetch_webpage_content(url)
                    if webpage_content:
                        tool_results.append({
                            "tool_call_id": tool_call.get("id", ""),
                            "role": "tool",
                            "name": "fetchWebpageContent",
                            "content": json.dumps({"success": True, "content": webpage_content})
                        })
                    else:
                        tool_results.append({
                            "tool_call_id": tool_call.get("id", ""),
                            "role": "tool",
                            "name": "fetchWebpageContent",
                            "content": json.dumps({"error": "Failed to fetch webpage content"})
                        })
                
                # 文本分析工具
                elif name == "analyzeText":
                    text = arguments.get("text", "")
                    task = arguments.get("task", "")
                    if not text or not task:
                        tool_results.append({
                            "tool_call_id": tool_call.get("id", ""),
                            "role": "tool",
                            "name": "analyzeText",
                            "content": json.dumps({"error": "missing required parameters"})
                        })
                        continue
                        
                    analysis_result = await analyze_text(text, task)
                    tool_results.append({
                        "tool_call_id": tool_call.get("id", ""),
                        "role": "tool",
                        "name": "analyzeText",
                        "content": json.dumps(analysis_result)
                    })
                
                # 内容格式转换工具
                elif name == "formatContent":
                    content = arguments.get("content", "")
                    output_format = arguments.get("outputFormat", "")
                    if not content or not output_format:
                        tool_results.append({
                            "tool_call_id": tool_call.get("id", ""),
                            "role": "tool",
                            "name": "formatContent",
                            "content": json.dumps({"error": "missing required parameters"})
                        })
                        continue
                        
                    format_result = await format_content(content, output_format)
                    tool_results.append({
                        "tool_call_id": tool_call.get("id", ""),
                        "role": "tool",
                        "name": "formatContent",
                        "content": json.dumps(format_result)
                    })
                
                # Agent性能评估工具
                elif name == "evaluateAgentPerformance":
                    execution_trace = arguments.get("executionTrace", [])
                    expected_outcome = arguments.get("expectedOutcome", None)
                    
                    evaluation_result = await evaluate_agent_performance(execution_trace, expected_outcome)
                    tool_results.append({
                        "tool_call_id": tool_call.get("id", ""),
                        "role": "tool",
                        "name": "evaluateAgentPerformance",
                        "content": json.dumps(evaluation_result)
                    })
                
                # 新增工具处理: 结构化数据生成
                elif name == "generateStructuredData":
                    data_type = arguments.get("data_type", "")
                    requirements = arguments.get("requirements", "")
                    schema = arguments.get("schema", None)
                    
                    if not data_type or not requirements:
                        tool_results.append({
                            "tool_call_id": tool_call.get("id", ""),
                            "role": "tool",
                            "name": "generateStructuredData",
                            "content": json.dumps({"error": "missing required parameters"})
                        })
                        continue
                        
                    result = await generate_structured_data(data_type, requirements, schema)
                    tool_results.append({
                        "tool_call_id": tool_call.get("id", ""),
                        "role": "tool",
                        "name": "generateStructuredData",
                        "content": json.dumps(result)
                    })
                
                # 新增工具处理: 文本摘要
                elif name == "summarizeContent":
                    text = arguments.get("text", "")
                    max_length = arguments.get("max_length", 500)
                    
                    if not text:
                        tool_results.append({
                            "tool_call_id": tool_call.get("id", ""),
                            "role": "tool",
                            "name": "summarizeContent",
                            "content": json.dumps({"error": "missing text parameter"})
                        })
                        continue
                        
                    result = await summarize_content(text, max_length)
                    tool_results.append({
                        "tool_call_id": tool_call.get("id", ""),
                        "role": "tool",
                        "name": "summarizeContent",
                        "content": json.dumps(result)
                    })
                
                # 新增工具处理: 文本翻译
                elif name == "translateText":
                    text = arguments.get("text", "")
                    target_language = arguments.get("target_language", "")
                    
                    if not text or not target_language:
                        tool_results.append({
                            "tool_call_id": tool_call.get("id", ""),
                            "role": "tool",
                            "name": "translateText",
                            "content": json.dumps({"error": "missing required parameters"})
                        })
                        continue
                        
                    result = await translate_text(text, target_language)
                    tool_results.append({
                        "tool_call_id": tool_call.get("id", ""),
                        "role": "tool",
                        "name": "translateText",
                        "content": json.dumps(result)
                    })
                
                # 新增工具处理: 数据问答
                elif name == "answerFromData":
                    question = arguments.get("question", "")
                    data = arguments.get("data", [])
                    
                    if not question or not data:
                        tool_results.append({
                            "tool_call_id": tool_call.get("id", ""),
                            "role": "tool",
                            "name": "answerFromData",
                            "content": json.dumps({"error": "missing required parameters"})
                        })
                        continue
                        
                    result = await answer_from_data(question, data)
                    tool_results.append({
                        "tool_call_id": tool_call.get("id", ""),
                        "role": "tool",
                        "name": "answerFromData",
                        "content": json.dumps(result)
                    })
                
                # 新增工具处理: 保存到记忆
                elif name == "saveToMemory":
                    user_id = arguments.get("user_id", "")
                    key = arguments.get("key", "")
                    value = arguments.get("value", {})
                    
                    if not user_id or not key:
                        tool_results.append({
                            "tool_call_id": tool_call.get("id", ""),
                            "role": "tool",
                            "name": "saveToMemory",
                            "content": json.dumps({"error": "missing required parameters"})
                        })
                        continue
                        
                    result = await save_to_memory(user_id, key, value)
                    tool_results.append({
                        "tool_call_id": tool_call.get("id", ""),
                        "role": "tool",
                        "name": "saveToMemory",
                        "content": json.dumps(result)
                    })
                
                # 新增工具处理: 从记忆检索
                elif name == "retrieveFromMemory":
                    user_id = arguments.get("user_id", "")
                    key = arguments.get("key", None)
                    
                    if not user_id:
                        tool_results.append({
                            "tool_call_id": tool_call.get("id", ""),
                            "role": "tool",
                            "name": "retrieveFromMemory",
                            "content": json.dumps({"error": "missing user_id parameter"})
                        })
                        continue
                        
                    result = await retrieve_from_memory(user_id, key)
                    tool_results.append({
                        "tool_call_id": tool_call.get("id", ""),
                        "role": "tool",
                        "name": "retrieveFromMemory",
                        "content": json.dumps(result)
                    })
                
                # 新增工具处理: 创建日程计划
                elif name == "createDatePlan":
                    location = arguments.get("location", "")
                    interests = arguments.get("interests", [])
                    budget = arguments.get("budget", None)
                    duration = arguments.get("duration", None)
                    
                    if not location or not interests:
                        tool_results.append({
                            "tool_call_id": tool_call.get("id", ""),
                            "role": "tool",
                            "name": "createDatePlan",
                            "content": json.dumps({"error": "missing required parameters"})
                        })
                        continue
                        
                    result = await create_date_plan(location, interests, budget, duration)
                    tool_results.append({
                        "tool_call_id": tool_call.get("id", ""),
                        "role": "tool",
                        "name": "createDatePlan",
                        "content": json.dumps(result)
                    })
                
                # 新增工具处理: 信息整合
                elif name == "integrateInformation":
                    sources = arguments.get("sources", [])
                    question = arguments.get("question", "")
                    format = arguments.get("format", "markdown")
                    
                    if not sources or not question:
                        tool_results.append({
                            "tool_call_id": tool_call.get("id", ""),
                            "role": "tool",
                            "name": "integrateInformation",
                            "content": json.dumps({"error": "missing required parameters"})
                        })
                        continue
                        
                    result = await integrate_information(sources, question, format)
                    tool_results.append({
                        "tool_call_id": tool_call.get("id", ""),
                        "role": "tool",
                        "name": "integrateInformation",
                        "content": json.dumps(result)
                    })
                
                # 新增工具处理: 代码生成
                elif name == "generateCode":
                    requirement = arguments.get("requirement", "")
                    language = arguments.get("language", "")
                    framework = arguments.get("framework", None)
                    
                    if not requirement or not language:
                        tool_results.append({
                            "tool_call_id": tool_call.get("id", ""),
                            "role": "tool",
                            "name": "generateCode",
                            "content": json.dumps({"error": "missing required parameters"})
                        })
                        continue
                        
                    result = await generate_code(requirement, language, framework)
                    tool_results.append({
                        "tool_call_id": tool_call.get("id", ""),
                        "role": "tool",
                        "name": "generateCode",
                        "content": json.dumps(result)
                    })
                  # MCP工具调用处理
                elif name.startswith("mcp_"):
                    # 这是MCP工具调用，通过MCP客户端处理
                    try:
                        # 将mcp_server_tool格式转换回server:tool
                        tool_key = name[4:].replace('_', ':', 1)  # 移除mcp_前缀，第一个_替换为:
                        
                        from app.services.mcp_client import mcp_client
                        
                        # 通过MCP客户端调用工具
                        mcp_result = await mcp_client.call_tool(tool_key, arguments)
                        
                        tool_results.append({
                            "tool_call_id": tool_call.get("id", ""),
                            "role": "tool",
                            "name": name,
                            "content": json.dumps(mcp_result)
                        })
                        
                    except Exception as e:
                        logger.error(f"MCP工具调用失败 {name}: {str(e)}")
                        tool_results.append({
                            "tool_call_id": tool_call.get("id", ""),
                            "role": "tool",
                            "name": name,
                            "content": json.dumps({"success": False, "error": f"MCP工具调用失败: {str(e)}"})
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