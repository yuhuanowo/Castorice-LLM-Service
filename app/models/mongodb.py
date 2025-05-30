from datetime import datetime
from pymongo import MongoClient
from bson import ObjectId
from app.core.config import get_settings
import gridfs
import io

settings = get_settings()
client = MongoClient(settings.MONGODB_URL)
db = client.get_default_database()
from app.utils.logger import logger

# 初始化GridFS
fs = gridfs.GridFS(db)

# 聊天记录集合
chat_log_collection = db["chat_logs"]

# 用户记忆集合
memory_collection = db["memories"]

# 用户使用量集合
usage_collection = db["usage"]

# 文件元数据集合
file_metadata_collection = db["file_metadata"]


def get_database():
    """获取数据库连接"""
    try:
        # 验证连接是否可用
        client.admin.command('ping')
        return db
    except Exception as e:
        logger.error(f"MongoDB连接失败: {str(e)}")
        return None


def save_file_to_mongodb(file_id: str, filename: str, content_type: str, file_content: bytes, metadata: dict):
    """
    将文件保存到MongoDB的GridFS中
    
    参数:
        file_id: 文件唯一标识符
        filename: 原始文件名
        content_type: 文件MIME类型
        file_content: 文件二进制内容
        metadata: 文件相关元数据
    
    返回:
        文件ID字符串
    """
    try:
        # 将文件存储到GridFS
        stored_file_id = fs.put(
            io.BytesIO(file_content), 
            filename=filename,
            content_type=content_type,
            metadata=metadata
        )
        
        # 更新元数据中的GridFS ID
        metadata['gridfs_id'] = str(stored_file_id)
        
        # 存储元数据到专门的集合
        file_metadata_collection.insert_one(metadata)
        
        logger.info(f"文件已成功存储到MongoDB GridFS: {file_id}")
        return str(stored_file_id)
    except Exception as e:
        logger.error(f"存储文件到MongoDB GridFS失败: {str(e)}")
        raise e


def get_file_from_mongodb(file_id: str):
    """
    从MongoDB的GridFS中获取文件
    
    参数:
        file_id: 文件唯一标识符
    
    返回:
        (文件内容, 文件名, 内容类型, 元数据) 元组，如果文件不存在则返回 (None, None, None, None)
    """
    try:
        # 从元数据集合中查找文件
        metadata = file_metadata_collection.find_one({"file_id": file_id})
        
        if not metadata:
            return None, None, None, None
            
        # 从GridFS获取文件
        if 'gridfs_id' in metadata:
            gridfs_id = ObjectId(metadata['gridfs_id'])
            grid_out = fs.get(gridfs_id)
            
            # 读取文件内容
            file_content = grid_out.read()
            filename = grid_out.filename
            content_type = grid_out.content_type
            
            # 处理元数据中的ObjectId
            if '_id' in metadata:
                metadata['_id'] = str(metadata['_id'])
                
            return file_content, filename, content_type, metadata
        else:
            logger.warning(f"文件元数据中没有gridfs_id: {file_id}")
            return None, None, None, metadata
            
    except Exception as e:
        logger.error(f"从MongoDB GridFS获取文件失败: {str(e)}")
        return None, None, None, None


def delete_file_from_mongodb(file_id: str):
    """
    从MongoDB的GridFS中删除文件
    
    参数:
        file_id: 文件唯一标识符
        
    返回:
        删除是否成功的布尔值
    """
    try:
        # 从元数据集合中查找文件
        metadata = file_metadata_collection.find_one({"file_id": file_id})
        
        if not metadata or 'gridfs_id' not in metadata:
            logger.warning(f"找不到要删除的文件或没有gridfs_id: {file_id}")
            return False
            
        # 删除GridFS中的文件
        gridfs_id = ObjectId(metadata['gridfs_id'])
        fs.delete(gridfs_id)
        
        # 删除元数据
        file_metadata_collection.delete_one({"file_id": file_id})
        
        logger.info(f"文件已从MongoDB GridFS成功删除: {file_id}")
        return True
            
    except Exception as e:
        logger.error(f"从MongoDB GridFS删除文件失败: {str(e)}")
        return False


def list_files_in_mongodb(user_id: str = None, tags: list = None, limit: int = 50, skip: int = 0):
    """
    列出MongoDB中存储的文件
    
    参数:
        user_id: 可选的用户ID筛选
        tags: 可选的标签列表筛选
        limit: 返回结果的最大数量
        skip: 跳过的结果数量(用于分页)
        
    返回:
        文件元数据列表
    """
    try:
        # 构建查询条件
        query = {}
        if user_id:
            query["user_id"] = user_id
        if tags and len(tags) > 0:
            query["tags"] = {"$in": tags}
            
        # 执行查询
        cursor = file_metadata_collection.find(query).sort("upload_time", -1).skip(skip).limit(limit)
        files = list(cursor)
        
        # 处理ObjectId
        for file in files:
            if '_id' in file:
                file['_id'] = str(file['_id'])
            if 'gridfs_id' in file:
                file['gridfs_id'] = str(file['gridfs_id'])
                
        return files
            
    except Exception as e:
        logger.error(f"列出MongoDB文件失败: {str(e)}")
        return []


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