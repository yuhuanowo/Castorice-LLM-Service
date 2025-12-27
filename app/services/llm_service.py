from typing import List, Dict, Any, Optional, Union
import httpx
import base64
from datetime import datetime
import json
import os
import logging
import asyncio

from app.utils.logger import logger
from app.core.config import get_settings
from app.utils.tools import generate_image, search_duckduckgo
from app.models.mongodb import update_usage, get_user_usage
from app.models.sqlite import update_usage_sqlite

# 導入 Provider 模組
from app.services.providers import (
    ModelProvider,
    BaseProvider,
    GitHubModelProvider,
    GeminiProvider,
    OllamaProvider,
    NvidiaNimProvider,
    OpenRouterProvider,
)

settings = get_settings()


class LLMService:
    """
    LLM服務類 - 負責處理與大型語言模型API的交互
    包括：發送請求、處理響應、工具調用和使用量統計
    
    此類作為統一的接口，整合各個 Provider 的調用
    """
    def __init__(self):
        # 初始化各個 Provider
        self.providers: Dict[ModelProvider, BaseProvider] = {
            ModelProvider.GITHUB: GitHubModelProvider(),
            ModelProvider.GEMINI: GeminiProvider(),
            ModelProvider.OLLAMA: OllamaProvider(),
            ModelProvider.NVIDIA_NIM: NvidiaNimProvider(),
            ModelProvider.OPENROUTER: OpenRouterProvider(),
        }
        
        # 存儲最近生成的圖片
        self.last_generated_image = None
        
        # 使用量文件路徑
        self.usage_path = "./data/usage.json"
        
        # 確保目錄存在
        os.makedirs(os.path.dirname(self.usage_path), exist_ok=True)
        
        # 如果文件不存在，創建初始文件
        if not os.path.exists(self.usage_path):
            with open(self.usage_path, "w") as f:
                json.dump({"date": datetime.now().strftime("%Y-%m-%d")}, f)
    
    def get_provider(self, provider_type: ModelProvider) -> BaseProvider:
        """
        獲取指定類型的 Provider
        
        Args:
            provider_type: Provider 類型
            
        Returns:
            對應的 Provider 實例
        """
        return self.providers.get(provider_type)

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
                "description": "Generate images using Cloudflare AI and return Base64 dataURI",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "prompt": {
                            "type": "string",
                            "description": "Description of the image content to generate"
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
                "description": "Search using DuckDuckGo search engine, returning only brief information (title, summary, and URL) from search results. If you need detailed content from specific web pages, use the fetchWebpageContent tool after searching, but only for individual URLs that truly require in-depth understanding to avoid excessive token consumption.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search keywords",
                        },
                        "numResults": {
                            "type": "integer",
                            "description": "Number of search results to return",
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
                    "description": "Fetch webpage content and extract main text. Note: This tool consumes significant tokens, use with caution. Only use when you need in-depth understanding of specific webpage content. Do not use this tool for every URL in search results. Best practice: first use searchDuckDuckGo to get summaries, then use this tool only for 1-2 most relevant URLs as needed.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "url": {
                                "type": "string",
                                "description": "Webpage URL"
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
                    "description": "Analyze text content, perform tasks such as summarization, sentiment analysis, etc.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "text": {
                                "type": "string",
                                "description": "Text to be analyzed"
                            },
                            "task": {
                                "type": "string",
                                "description": "Analysis task description, such as 'summary', 'sentiment analysis', 'keyword extraction', etc."
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
                    "description": "Convert content to specified formats, such as JSON, Markdown, HTML, CSV, etc.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "content": {
                                "type": "string",
                                "description": "Content to be formatted"
                            },
                            "outputFormat": {
                                "type": "string",
                                "description": "Output format, supports 'json', 'markdown', 'html', 'csv'"
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
                    "description": "Evaluate Agent execution performance, including time, number of steps, success rate and other metrics",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "executionTrace": {
                                "type": "array",
                                "description": "Execution trace records",
                                "items": {
                                    "type": "object"
                                }
                            },
                            "expectedOutcome": {
                                "type": "string",
                                "description": "Expected result description (optional)"
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
                    "description": "Generate structured data, such as JSON, CSV, tables, etc.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "data_type": {
                                "type": "string",
                                "description": "Data type, such as 'json', 'csv', 'table', 'form'"
                            },
                            "requirements": {
                                "type": "string",
                                "description": "Data requirements description"
                            },
                            "schema": {
                                "type": "object",
                                "description": "Optional data schema definition"
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
                    "description": "Summarize long text content",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "text": {
                                "type": "string",
                                "description": "Text to be summarized"
                            },
                            "max_length": {
                                "type": "integer",
                                "description": "Maximum length of summary (in characters)",
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
                    "description": "Translate text to specified language",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "text": {
                                "type": "string",
                                "description": "Text to be translated"
                            },"target_language": {
                                "type": "string",
                                "description": "Target language, such as 'en', 'zh-CN', 'ja', 'fr'"
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
                    "description": "Answer questions based on provided data",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "question": {
                                "type": "string",
                                "description": "Question"
                            },
                            "data": {
                                "type": "array",
                                "description": "Data list, each item is a dictionary",
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
                    "description": "Save data to user memory",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "user_id": {
                                "type": "string",
                                "description": "User ID"
                            },
                            "key": {
                                "type": "string",
                                "description": "Memory key name"
                            },
                            "value": {
                                "type": "object",
                                "description": "Memory value"
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
                    "description": "Retrieve data from user memory",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "user_id": {
                                "type": "string",
                                "description": "User ID"
                            },
                            "key": {
                                "type": "string",
                                "description": "Memory key name, if empty returns all memories"
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
                    "description": "Create date plan",
                    "parameters": {
                        "type": "object",
                        "properties": {"location": {
                                "type": "string",
                                "description": "Location"
                            },
                            "interests": {
                                "type": "array",
                                "description": "List of interests",
                                "items": {
                                    "type": "string"
                                }
                            },
                            "budget": {
                                "type": "string",
                                "description": "Budget (optional)"
                            },
                            "duration": {
                                "type": "string",
                                "description": "Duration (optional)"
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
                    "description": "Integrate multiple information sources and answer questions",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "sources": {
                                "type": "array",
                                "description": "List of information sources, each item is a piece of text",
                                "items": {
                                    "type": "string"
                                }
                            },
                            "question": {
                                "type": "string",
                                "description": "Question to be answered"
                            },
                            "format": {
                                "type": "string",
                                "description": "Output format, such as 'markdown', 'json', 'html'",
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
                    "description": "Generate code",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "requirement": {
                                "type": "string",
                                "description": "Code requirement description"
                            },
                            "language": {
                                "type": "string",
                                "description": "Programming language, such as 'python', 'javascript', 'java'"
                            },
                            "framework": {
                                "type": "string",
                                "description": "Optional framework, such as 'react', 'fastapi', 'spring'"
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
        elif model_name in settings.ALLOWED_OLLAMA_MODELS:
            return ModelProvider.OLLAMA
        elif model_name in settings.ALLOWED_NVIDIA_NIM_MODELS:
            return ModelProvider.NVIDIA_NIM
        elif model_name in settings.ALLOWED_OPENROUTER_MODELS:
            return ModelProvider.OPENROUTER
        else:  # 默认为GitHub模型
            return ModelProvider.GITHUB

    # MARK: 处理用户消息格式化
    async def format_user_message(
        self, 
        prompt: str, 
        image: Optional[str] = None, 
        audio: Optional[str] = None, 
        model_name: Optional[str] = None
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
        # 使用配置的預設模型
        if model_name is None:
            model_name = settings.AGENT_DEFAULT_MODEL
        
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

    # MARK: 收集流式響應為完整響應
    async def collect_stream_response(
        self,
        stream_generator,
        model_name: str = ""
    ) -> Dict[str, Any]:
        """
        收集流式響應並組合為完整的響應對象
        
        Args:
            stream_generator: 流式響應生成器
            model_name: 模型名稱（用於構建響應）
            
        Returns:
            完整的響應對象（OpenAI 格式）
        """
        full_content = ""
        tool_calls = []
        tool_calls_map = {}  # 用於累積工具調用
        finish_reason = None
        usage = None
        response_id = None
        
        try:
            async for chunk in stream_generator:
                # 處理錯誤響應（流式錯誤格式）
                if "error" in chunk:
                    error_info = chunk.get("error", {})
                    if isinstance(error_info, dict):
                        return {
                            "error": error_info.get("message", "未知錯誤"),
                            "detail": error_info.get("detail", str(error_info))
                        }
                    return {"error": str(error_info), "detail": ""}
                
                # 提取響應 ID
                if not response_id and "id" in chunk:
                    response_id = chunk["id"]
                
                # 處理 choices
                if "choices" in chunk and chunk["choices"]:
                    choice = chunk["choices"][0]
                    delta = choice.get("delta", {})
                    
                    # 累積內容
                    if "content" in delta and delta["content"]:
                        full_content += delta["content"]
                    
                    # 處理工具調用
                    if "tool_calls" in delta:
                        for tc in delta["tool_calls"]:
                            idx = tc.get("index", 0)
                            if idx not in tool_calls_map:
                                tool_calls_map[idx] = {
                                    "id": tc.get("id", ""),
                                    "type": "function",
                                    "function": {
                                        "name": tc.get("function", {}).get("name", ""),
                                        "arguments": ""
                                    }
                                }
                            # 累積函數參數和其他信息
                            if "function" in tc:
                                func = tc["function"]
                                if "arguments" in func and func["arguments"]:
                                    tool_calls_map[idx]["function"]["arguments"] += func["arguments"]
                                if "name" in func and func["name"]:
                                    tool_calls_map[idx]["function"]["name"] = func["name"]
                            if "id" in tc and tc["id"]:
                                tool_calls_map[idx]["id"] = tc["id"]
                    
                    # 檢查結束原因
                    if choice.get("finish_reason"):
                        finish_reason = choice["finish_reason"]
                
                # 提取使用量
                if "usage" in chunk:
                    usage = chunk["usage"]
        
        except Exception as e:
            logger.error(f"收集流式響應時出錯: {str(e)}")
            return {"error": "流式響應收集失敗", "detail": str(e)}
        
        # 構建工具調用列表（確保每個工具調用都有有效的 ID）
        if tool_calls_map:
            tool_calls = []
            for i in sorted(tool_calls_map.keys()):
                tc = tool_calls_map[i]
                # 確保 tool_call 有有效的 ID
                if not tc.get("id"):
                    tc["id"] = f"call_{datetime.now().strftime('%Y%m%d%H%M%S%f')}_{i}"
                tool_calls.append(tc)
            logger.debug(f"收集到 {len(tool_calls)} 個 tool_calls: {[{'id': tc['id'], 'name': tc['function']['name']} for tc in tool_calls]}")
        
        # 構建完整響應
        message = {
            "role": "assistant",
            "content": full_content
        }
        
        if tool_calls:
            message["tool_calls"] = tool_calls
            if not finish_reason:
                finish_reason = "tool_calls"
            logger.debug(f"Assistant 消息包含 tool_calls，finish_reason={finish_reason}")
        
        if not finish_reason:
            finish_reason = "stop"
        
        return {
            "id": response_id or f"chatcmpl-{datetime.now().strftime('%Y%m%d%H%M%S')}",
            "object": "chat.completion",
            "created": int(datetime.now().timestamp()),
            "model": model_name,
            "choices": [{
                "index": 0,
                "message": message,
                "finish_reason": finish_reason
            }],
            "usage": usage or {
                "prompt_tokens": -1,
                "completion_tokens": -1,
                "total_tokens": -1
            }
        }

    # MARK: 发送LLM请求      
    async def send_llm_request(
        self,
        messages: List[Dict[str, Any]],
        model_name: str,
        tools: Optional[List[Dict[str, Any]]] = None,
        skip_content_check: bool = False,
        stream: bool = False,
        **kwargs
    ):
        """
        發送 LLM 請求 - 統一的模型調用接口
        
        所有 Provider 都使用流式模式，此方法會根據 stream 參數決定：
        - stream=True: 直接返回流式生成器
        - stream=False: 收集流式響應並返回完整響應
        
        Args:
            messages: 消息列表（包括系統提示和用戶輸入）
            model_name: 模型名稱
            tools: 可選的工具定義列表
            skip_content_check: 是否跳過內容長度檢查
            stream: 是否返回流式響應（默認 False，返回完整響應）
            **kwargs: 額外參數傳遞給 Provider
            
        Returns:
            如果 stream=False: 完整的 API 響應結果 (Dict)
            如果 stream=True: 異步生成器 (AsyncIterator)
        """
        # 確定模型提供商
        provider_type = self._get_model_provider(model_name)
        
        # 只針對 GitHub 模型請求做內容長度管理
        if provider_type == ModelProvider.GITHUB and not skip_content_check:
            try:
                from app.utils.tools import ensure_content_length
                for i, message in enumerate(messages):
                    if "content" in message and isinstance(message["content"], str):
                        original_length = len(message["content"])
                        message["content"] = await ensure_content_length(
                            content=message["content"],
                            max_tokens=6000,
                            context_description=f"{message.get('role', 'unknown').capitalize()} message"
                        )
                        if len(message["content"]) < original_length:
                            logger.info(f"{message.get('role', '消息')}消息已優化，原長度: {original_length}, 優化後: {len(message['content'])}")
            except Exception as e:
                logger.warning(f"消息長度管理失敗，繼續使用原始消息: {str(e)}")
        
        # 獲取對應的 Provider 並發送請求
        provider = self.providers.get(provider_type)
        if provider is None:
            logger.error(f"未找到對應的 Provider: {provider_type}")
            error_response = {"error": f"未找到對應的 Provider: {provider_type}", "detail": ""}
            if stream:
                async def error_gen():
                    yield error_response
                return error_gen()
            return error_response
        
        if not provider.is_available():
            logger.warning(f"Provider {provider_type.value} 不可用")
            error_response = {"error": f"Provider {provider_type.value} 不可用", "detail": "請檢查配置"}
            if stream:
                async def error_gen():
                    yield error_response
                return error_gen()
            return error_response
        
        # 在發送前檢查消息格式（調試用）
        for i, msg in enumerate(messages):
            role = msg.get("role", "")
            content = msg.get("content", "")
            tool_calls_in_msg = msg.get("tool_calls")
            tool_call_id = msg.get("tool_call_id")
            
            # 檢查 tool 消息是否有對應的 assistant 消息帶有 tool_calls
            if role == "tool":
                # 確保有 tool_call_id
                if not tool_call_id:
                    logger.warning(f"Message[{i}] role=tool 缺少 tool_call_id")
                    
                # 檢查是否有前一個 assistant 消息有 tool_calls
                has_matching_assistant = False
                for j in range(i - 1, -1, -1):
                    prev_msg = messages[j]
                    if prev_msg.get("role") == "assistant" and prev_msg.get("tool_calls"):
                        for tc in prev_msg["tool_calls"]:
                            if tc.get("id") == tool_call_id:
                                has_matching_assistant = True
                                break
                        if has_matching_assistant:
                            break
                
                if not has_matching_assistant:
                    logger.warning(f"Message[{i}] role=tool (tool_call_id={tool_call_id}) 沒有找到匹配的 assistant tool_calls")
        
        # 獲取流式生成器（不需要 await，因為 send_request 直接返回 AsyncIterator）
        stream_generator = provider.send_request(
            messages=messages,
            model_name=model_name,
            tools=tools,
            **kwargs
        )
        
        if stream:
            # 直接返回流式生成器
            return stream_generator
        else:
            # 收集流式響應為完整響應
            return await self.collect_stream_response(stream_generator, model_name)
        
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
            generate_code,
            validate_tool_result  # Anthropic 最佳實踐：Ground Truth 驗證
        )
        # 注意：不再导入MCP工具，MCP工具应该由MCP客户端动态处理
        
        # 逐个处理工具调用
        for tool_call in tool_calls:
            function_call = tool_call.get("function", {})
            name = function_call.get("name", "")
            arguments_str = function_call.get("arguments", "{}")
            try:
                # 解析参数 - 如果已经是dict就直接使用，如果是字符串就解析
                if isinstance(arguments_str, dict):
                    arguments = arguments_str
                elif isinstance(arguments_str, str):
                    # 處理空字符串的情況
                    if not arguments_str or not arguments_str.strip():
                        arguments = {}
                    else:
                        arguments = json.loads(arguments_str)
                else:
                    logger.error(f"工具调用参数格式错误: {type(arguments_str)}")
                    continue
                
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
        
        # === Anthropic 最佳實踐：Ground Truth 驗證 ===
        # 統一驗證所有工具結果
        for tool_result in tool_results:
            validation = validate_tool_result(tool_result)
            # 將驗證結果添加到工具結果中
            tool_result["validation"] = validation
            
            # 如果驗證失敗，記錄警告
            if not validation["is_valid"]:
                logger.warning(
                    f"工具 {tool_result.get('name')} 驗證失敗: "
                    f"{validation['reason']} (嚴重程度: {validation['severity']})"
                )
                
        return tool_results

    # 給實時聊天完成方法提供簡化接口
    async def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        model: str,
        temperature: Optional[float] = 0.7,
        max_tokens: Optional[int] = None,
        tools: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        簡化的聊天完成方法
        
        Args:
            messages: 消息列表
            model: 模型名稱
            temperature: 生成溫度
            max_tokens: 最大token數
            tools: 工具定義列表
            
        Returns:
            包含響應消息的字典
        """
        try:
            # 使用現有的send_llm_request方法
            response = await self.send_llm_request(
                messages=messages,
                model=model,
                tools=tools,
                temperature=temperature,
                max_tokens=max_tokens
            )
            
            return response
            
        except Exception as e:
            logger.error(f"聊天完成請求失敗: {str(e)}")
            return {
                "message": f"生成回覆時發生錯誤: {str(e)}",
                "model": model,
                "usage": {}
            }


# 创建单例实例
llm_service = LLMService()