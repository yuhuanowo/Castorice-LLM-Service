from datetime import datetime
from pymongo import MongoClient
from bson import ObjectId
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


async def create_chat_log(user_id: str, model: str, prompt: str, reply: str, interaction_id: str = None):
    """创建聊天记录"""
    chat_log = {
        "user_id": user_id,
        "model": model,
        "prompt": prompt,
        "reply": reply,
        "timestamp": datetime.now(),
        "interaction_id": interaction_id
    }
    
    try:
        # 同步插入操作改为手动处理，避免直接await非awaitable对象
        result = chat_log_collection.insert_one(chat_log)
        return {"id": str(result.inserted_id), "success": True}
    except Exception as e:
        logger.error(f"创建聊天记录错误: {str(e)}")
        return {"id": None, "success": False, "error": str(e)}


def get_chat_logs(user_id: str, limit: int = 10):
    """获取用户的聊天记录"""
    logs = list(chat_log_collection.find({"user_id": user_id}).sort("timestamp", -1).limit(limit))
    
    # 将 ObjectId 转换为字符串，使其可以被 JSON 序列化
    for log in logs:
        if '_id' in log and isinstance(log['_id'], ObjectId):
            log['_id'] = str(log['_id'])
        # 检查其他可能的 ObjectId 字段
        if 'interaction_id' in log and isinstance(log['interaction_id'], ObjectId):
            log['interaction_id'] = str(log['interaction_id'])
    
    return logs


def get_chat_by_interaction_id(interaction_id: str, user_id: str):
    """通过交互ID获取聊天记录"""
    log = chat_log_collection.find_one({"interaction_id": interaction_id, "user_id": user_id})
    
    # 将 ObjectId 转换为字符串
    if log and '_id' in log and isinstance(log['_id'], ObjectId):
        log['_id'] = str(log['_id'])
    
    return log


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
    if memory_doc:
        # 转换 ObjectId 为字符串
        if '_id' in memory_doc and isinstance(memory_doc['_id'], ObjectId):
            memory_doc['_id'] = str(memory_doc['_id'])
        return memory_doc["memory"] if "memory" in memory_doc else ""
    return ""


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
    
    if usage_doc:
        # 转换 ObjectId 为字符串
        if '_id' in usage_doc and isinstance(usage_doc['_id'], ObjectId):
            usage_doc['_id'] = str(usage_doc['_id'])
        
        if "models" not in usage_doc:
            return {}
        return usage_doc["models"]
    
    return {}