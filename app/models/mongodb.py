from datetime import datetime
from pymongo import MongoClient
from app.core.config import get_settings

settings = get_settings()
client = MongoClient(settings.MONGODB_URL)
db = client.get_default_database()
from app.utils.logger import logger

# 聊天记录集合
chat_log_collection = db["chat_logs"]

# 用户记忆集合
memory_collection = db["memories"]

# 用户使用量集合
usage_collection = db["usage"]


def create_chat_log(user_id: str, model: str, prompt: str, reply: str, interaction_id: str = None):
    """创建聊天记录"""
    chat_log = {
        "user_id": user_id,
        "model": model,
        "prompt": prompt,
        "reply": reply,
        "timestamp": datetime.now(),
        "interaction_id": interaction_id
    }
    return chat_log_collection.insert_one(chat_log)


def get_chat_logs(user_id: str, limit: int = 10):
    """获取用户的聊天记录"""
    return list(chat_log_collection.find({"user_id": user_id}).sort("timestamp", -1).limit(limit))


def get_chat_by_interaction_id(interaction_id: str, user_id: str):
    """通过交互ID获取聊天记录"""
    return chat_log_collection.find_one({"interaction_id": interaction_id, "user_id": user_id})


def update_user_memory(user_id: str, memory: str):
    """更新或创建用户记忆"""
    # 确保 memory 是字符串类型
    if not isinstance(memory, str):
        memory = str(memory)
    
    # logger.info(memory)
    # 记录内存更新长度
    logger.info(f"更新用户记忆: user_id={user_id}, memory_length={len(memory)}")
    
    memory_collection.update_one(
        {"user_id": user_id},
        {"$set": {"memory": memory, "last_update": datetime.now()}},
        upsert=True
    )


def get_user_memory(user_id: str):
    """获取用户记忆"""
    memory_doc = memory_collection.find_one({"user_id": user_id})
    return memory_doc["memory"] if memory_doc else ""


def update_usage(user_id: str, model: str):
    """更新用户使用量"""
    current_date = datetime.now().strftime("%Y-%m-%d")
    usage_collection.update_one(
        {"user_id": user_id, "date": current_date},
        {"$inc": {f"models.{model}": 1}},
        upsert=True
    )


def get_user_usage(user_id: str):
    """获取用户使用量"""
    current_date = datetime.now().strftime("%Y-%m-%d")
    usage_doc = usage_collection.find_one({"user_id": user_id, "date": current_date})
    if not usage_doc or "models" not in usage_doc:
        return {}
    return usage_doc["models"]