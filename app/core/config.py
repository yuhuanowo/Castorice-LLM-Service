from pydantic_settings import BaseSettings
import os
from functools import lru_cache


class Settings(BaseSettings):
    # 基础应用配置
    APP_NAME: str = "AI Agent API"
    API_V1_STR: str = "/api/v1"
    DEBUG: bool = True
    
    # Agent配置
    AGENT_MAX_STEPS: int = 10  # 最大执行步骤数
    AGENT_REFLECTION_THRESHOLD: int = 3  # 每执行多少步骤进行一次反思
    AGENT_CONFIDENCE_THRESHOLD: float = 0.7  # 置信度阈值，低于此值会触发反思
    AGENT_ENABLE_MCP: bool = True  # 是否默认启用MCP
    AGENT_DEFAULT_MODEL: str = "gpt-4o-mini"  # 默认Agent使用的模型
    AGENT_SHORT_TERM_MEMORY_MAX_MESSAGES: int = 5  # 短期记忆最大消息数量
    AGENT_LONG_TERM_MEMORY_MAX_TOKENS: int = 4096  # 长期记忆最大token数
    AGENT_DEFAULT_ADVANCED_TOOLS: bool = True  # 是否默认启用高级工具
    AGENT_ENABLE_SELF_EVALUATION: bool = True  # 是否启用自我评估
    AGENT_AUTO_SAVE_MEMORY: bool = True  # 是否自动保存记忆
    AGENT_REACT_MODE_ENABLED: bool = True  # 是否默认启用ReAct模式
    
    # MCP协议配置
    MCP_VERSION: str = "0.1.0"  # MCP协议版本
    MCP_MAX_CONTEXT_TOKENS: int = 16000  # MCP最大上下文长度
    MCP_SUPPORTED_MODELS: list = ["gpt-4o", "gpt-4o-mini", "o1", "DeepSeek-V3-0324", "gpt-4.1-mini", "gemini-1.5-pro", "Cohere-command-r-plus-08-2024", "Mistral-Nemo", "Mistral-Large-2411", "gemini-2.0-flash"]# 支持MCP的模型列表
    MCP_SUPPORT_ENABLED: bool = True  # 是否启用MCP协议支持
    
    # 数据库配置
    MONGODB_URL: str = os.getenv("MONGODB_URL", "mongodb://localhost:27017/agent")
    SQLITE_DB: str = os.getenv("SQLITE_DB", "./chatlog.db")

    # GitHub Model API密钥
    GITHUB_INFERENCE_KEY: str = os.getenv("GITHUB_INFERENCE_KEY", "")
    GITHUB_ENDPOINT: str = os.getenv("GITHUB_ENDPOINT", "https://models.inference.ai.azure.com")
    GITHUB_API_VERSION: str = os.getenv("GITHUB_API_VERSION", "2025-04-01-preview")
    
    # Gemini API密钥和配置
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_DEFAULT_MODEL: str = os.getenv("GEMINI_DEFAULT_MODEL", "gemini-2.0-flash")
    
    # GitHub Token (用于 GitHub 的模型调用)
    GITHUB_TOKEN: str = os.getenv("GITHUB_TOKEN", "")
    
    # 工具配置
    CLOUDFLARE_API_KEY: str = os.getenv("CLOUDFLARE_API_KEY", "")
    CLOUDFLARE_ACCOUNT_ID: str = os.getenv("CLOUDFLARE_ACCOUNT_ID", "")

    # API认证
    API_KEY_HEADER: str = "X-API-KEY"
    ADMIN_API_KEY: str = os.getenv("ADMIN_API_KEY", "admin_secret_key")
    
    # 允许的模型列表
    ALLOWED_GITHUB_MODELS: list = [
        # OpenAI
        "gpt-4o", "gpt-4o-mini", "o1", "o1-mini", "o1-preview", "o3-mini", "text-embedding-3-large", "text-embedding-3-small", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "o4-mini", "o3",
        # Cohere
        "cohere-command-a", "Cohere-command-r-plus-08-2024", "Cohere-command-r-plus", "Cohere-command-r-08-2024", "Cohere-command-r",
        # Meta
        "Llama-3.2-11B-Vision-Instruct", "Llama-3.2-90B-Vision-Instruct", "Llama-3.3-70B-Instruct", "Llama-4-Maverick-17B-128E-Instruct-FP8", "Llama-4-Scout-17B-16E-Instruct", 
        "Meta-Llama-3.1-405B-Instruct", "Meta-Llama-3.1-70B-Instruct", "Meta-Llama-3.1-8B-Instruct", "Meta-Llama-3-70B-Instruct", "Meta-Llama-3-8B-Instruct",
        # DeepSeek
        "DeepSeek-R1", "DeepSeek-V3-0324",
        # Mistral
        "Ministral-3B", "Mistral-Large-2411", "Mistral-Nemo", "mistral-medium-2505", "mistral-small-2503",
        # xAI
        "grok-3", "grok-3-mini",
        # Microsoft
        "MAI-DS-R1", "Phi-3.5-MoE-instruct", "Phi-3.5-vision-instruct", "Phi-4", "Phi-4-multimodal-instruct", "Phi-4-reasoning", "mistral-medium-2505", 
    
    ]
    
    # Gemini模型列表
    ALLOWED_GEMINI_MODELS: list = [
        "gemini-2.5-flash-preview-05-20",
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
        "gemini-1.5-pro",
        "gemini-1.5-flash",
        "gemma-3-27b-it",
        "gemma-3n-e4b-it",
        
    ]
    
    # 模型使用限制

    # 不支持工具功能的模型列表
    UNSUPPORTED_TOOL_MODELS: list = [
        "o1-mini", "phi-4", "DeepSeek-R1", "DeepSeek-V3-0324", "Llama-3.2-11B-Vision-Instruct", "Llama-3.2-90B-Vision-Instruct", "Llama-3.3-70B-Instruct", 
        "Meta-Llama-3.1-405B-Instruct", "Meta-Llama-3.1-70B-Instruct", "Meta-Llama-3.1-8B-Instruct", "Meta-Llama-3-70B-Instruct", "Meta-Llama-3-8B-Instruct",
        "MAI-DS-R1", "Phi-3.5-MoE-instruct", "Phi-3.5-vision-instruct", "Phi-4", "Phi-4-multimodal-instruct", "Phi-4-reasoning",

    ]
    
    # 使用者倍率 （限制量x使用者倍率＝使用者限制量）
    USER_LIMIT_MULTIPLIER: float = 0.5  # 使用者倍率
    # 限制量
    Low: int = 150 * USER_LIMIT_MULTIPLIER
    High: int = 50 * USER_LIMIT_MULTIPLIER
    Embedding: int = 150 * USER_LIMIT_MULTIPLIER
    
    # 使用者限制量
    MODEL_USAGE_LIMITS: dict = {
        # OpenAI
        "gpt-4o": High,
        "gpt-4o-mini": Low,
        "o1": 4,
        "o1-mini": 6,
        "o1-preview": 4,
        "o3-mini": 6,
        "text-embedding-3-large": Embedding,
        "text-embedding-3-small": Embedding,
        "gpt-4.1": High,
        "gpt-4.1-mini": Low,
        "gpt-4.1-nano": Low,
        "o4-mini": 6,
        "o3": 4,

        # Cohere    
        "cohere-command-a": Low,
        "Cohere-command-r-plus-08-2024": High,
        "Cohere-command-r-plus": High,
        "Cohere-command-r-08-2024": Low,
        "Cohere-command-r": Low,

        # Meta
        "Llama-3.2-11B-Vision-Instruct": Low,
        "Llama-3.2-90B-Vision-Instruct": High,
        "Llama-3.3-70B-Instruct": High,
        "Llama-4-Maverick-17B-128E-Instruct-FP8": High,
        "Llama-4-Scout-17B-16E-Instruct": High,
        "Meta-Llama-3.1-405B-Instruct": High,
        "Meta-Llama-3.1-70B-Instruct": High,
        "Meta-Llama-3.1-8B-Instruct": Low,
        "Meta-Llama-3-70B-Instruct": High,
        "Meta-Llama-3-8B-Instruct": Low,

        # DeepSeek
        "DeepSeek-R1": 4,
        "DeepSeek-V3-0324": High,

        # Mistral
        "Ministral-3B": Low,
        "Mistral-Large-2411": High,
        "Mistral-Nemo": Low,
        "mistral-medium-2505": Low,
        "mistral-small-2503": Low,

        # xAI
        "grok-3": 4,
        "grok-3-mini": 4,

        # Microsoft
        "MAI-DS-R1": 4,
        "Phi-3.5-MoE-instruct": Low,
        "Phi-3.5-vision-instruct": Low,
        "Phi-4": Low,
        "Phi-4-multimodal-instruct": Low,
        "Phi-4-reasoning": Low,

        # Gemini
        "gemini-2.5-flash-preview-05-20": 250,
        "gemini-2.0-flash": 750,
        "gemini-2.0-flash-lite": 750,
        "gemini-1.5-pro": 25,
        "gemini-1.5-flash": 750,
        "gemma-3-27b-it": 7200,
        "gemma-3n-e4b-it": 7200,
    
    }
    
    # 默认语言
    DEFAULT_LANGUAGE: str = "en"
    
    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings():
    return Settings()