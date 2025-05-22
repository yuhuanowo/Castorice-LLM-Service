from pydantic_settings import BaseSettings
import os
from functools import lru_cache


class Settings(BaseSettings):
    # 基础应用配置
    APP_NAME: str = "AI Agent API"
    API_V1_STR: str = "/api/v1"
    DEBUG: bool = True
    
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