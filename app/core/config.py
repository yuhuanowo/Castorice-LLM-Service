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

    # LLM API密钥
    GITHUB_INFERENCE_KEY: str = os.getenv("GITHUB_INFERENCE_KEY", "")
    GITHUB_ENDPOINT: str = os.getenv("GITHUB_ENDPOINT", "https://models.inference.ai.azure.com")
    GITHUB_API_VERSION: str = os.getenv("GITHUB_API_VERSION", "2025-04-01-preview")
    
    # GitHub Token (用于 GitHub 的模型调用)
    GITHUB_TOKEN: str = os.getenv("GITHUB_TOKEN", "")
    
    # 工具配置
    CLOUDFLARE_API_KEY: str = os.getenv("CLOUDFLARE_API_KEY", "")
    CLOUDFLARE_ACCOUNT_ID: str = os.getenv("CLOUDFLARE_ACCOUNT_ID", "")

    # API认证
    API_KEY_HEADER: str = "X-API-KEY"
    ADMIN_API_KEY: str = os.getenv("ADMIN_API_KEY", "admin_secret_key")
    
    # 允许的模型列表
    ALLOWED_MODELS: list = [
        "openai/gpt-4o", "gpt-4o-mini", "o3-mini", "o1", "o1-mini",
        "DeepSeek-R1", "Cohere-command-r-08-2024", "Ministral-3B",
        "DeepSeek-V3-0324", "mistral-small-2503", "gpt-4.1",
        "gpt-4.1-mini", "gpt-4.1-nano", "o4-mini", "o3",
        "Meta-Llama-3.1-8B-Instruct","openai/gpt-4.1-nano"
    ]
    
    # 模型使用限制
    MODEL_USAGE_LIMITS: dict = {
        "openai/gpt-4o": 10,
        "gpt-4o-mini": 30,
        "o3-mini": 4,
        "o1": 4,
        "o1-mini": 4,
        "DeepSeek-R1": 4,
        "Cohere-command-r-08-2024": 75,
        "Ministral-3B": 75,
        "DeepSeek-V3-0324": 25,
        "mistral-small-2503": 75,
        "gpt-4.1": 10,
        "gpt-4.1-mini": 30,
        "gpt-4.1-nano": 30,
        "o4-mini": 4,
        "o3": 4,
        "Meta-Llama-3.1-8B-Instruct": 10,
        "openai/gpt-4.1-nano": 10,
    }
    
    # 默认语言
    DEFAULT_LANGUAGE: str = "zh-TW"
    
    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings():
    return Settings()