from datetime import datetime
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from app.core.config import get_settings
import gridfs
import io
import logging
import time

settings = get_settings()
logger = logging.getLogger(__name__)

# 用于避免重复删除警告的缓存
_delete_warning_cache = {}
_cache_ttl = 60  # 缓存有效期60秒

# 同步客户端（用于需要同步操作的地方）
sync_client = MongoClient(settings.MONGODB_URL)
sync_db = sync_client.get_default_database()

# 异步客户端（用于异步操作）
async_client = AsyncIOMotorClient(settings.MONGODB_URL)
async_db = async_client.get_default_database()

# 使用同步客户端的地方
client = sync_client
db = sync_db

from app.utils.logger import logger

# 初始化GridFS（同步）
fs = gridfs.GridFS(db)

# 聊天记录集合（旧版本，保留兼容性）
chat_log_collection = db["chat_logs"]

# 聊天会话集合（新版本，以会话为单位）
chat_session_collection = db["chat_sessions"]

# 用户记忆集合
memory_collection = db["memories"]

# 用户使用量集合
usage_collection = db["usage"]

# 文件元数据集合
file_metadata_collection = db["file_metadata"]

# 圖片集合（异步）
image_collection = async_db["images"]


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
    """创建聊天记录（保留旧接口兼容性）"""
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


def create_chat_session(user_id: str, session_id: str, title: str = "新对话"):
    """创建新的聊天会话"""
    chat_session = {
        "session_id": session_id,
        "user_id": user_id,
        "title": title,
        "messages": [],
        "model": None,
        "created_at": datetime.now(),
        "updated_at": datetime.now(),
        "message_count": 0
    }
    
    try:
        result = chat_session_collection.insert_one(chat_session)
        logger.info(f"创建聊天会话成功: session_id={session_id}, user_id={user_id}")
        return {"id": str(result.inserted_id), "session_id": session_id, "success": True}
    except Exception as e:
        logger.error(f"创建聊天会话错误: {str(e)}")
        return {"id": None, "session_id": None, "success": False, "error": str(e)}


def add_message_to_session(session_id: str, user_id: str, message: dict, model: str = None):
    """向会话中添加消息 - 支持增強信息存儲"""
    try:
        # 構建基礎消息結構
        message_to_store = {
            "id": message.get("id", str(datetime.now().timestamp())),
            "role": message.get("role"),
            "content": message.get("content"),
            "timestamp": message.get("timestamp", datetime.now().isoformat())
        }
        
        # 添加增強信息（Agent 模式和基礎對話都支持）
        # Agent 模式專用字段
        if message.get("mode"):
            message_to_store["mode"] = message.get("mode")
        if message.get("model_used"):
            message_to_store["model_used"] = message.get("model_used")
        if message.get("execution_time") is not None:
            message_to_store["execution_time"] = message.get("execution_time")
        if message.get("steps_taken") is not None:
            message_to_store["steps_taken"] = message.get("steps_taken")
            
        # UI 展示增強信息
        if message.get("execution_trace"):
            message_to_store["execution_trace"] = message.get("execution_trace")
        if message.get("reasoning_steps"):
            message_to_store["reasoning_steps"] = message.get("reasoning_steps")
        if message.get("tools_used"):
            message_to_store["tools_used"] = message.get("tools_used")
            
        # 圖片生成支持
        if message.get("generated_image"):
            message_to_store["generated_image"] = message.get("generated_image")
            
        # 完整原始響應數據（用於 JSON 按鈕）
        if message.get("raw_response"):
            message_to_store["raw_response"] = message.get("raw_response")
            
        # 基礎對話增強字段（工具調用等）
        if message.get("tool_calls"):
            message_to_store["tool_calls"] = message.get("tool_calls")
        if message.get("image_data_uri"):
            message_to_store["image_data_uri"] = message.get("image_data_uri")
        
        # 准备更新数据
        update_data = {
            "$push": {"messages": message_to_store},
            "$set": {"updated_at": datetime.now()},
            "$inc": {"message_count": 1}
        }
        
        # 如果提供了模型信息，更新模型字段
        if model:
            update_data["$set"]["model"] = model
            
        # 更新会话
        result = chat_session_collection.update_one(
            {"session_id": session_id, "user_id": user_id},
            update_data
        )
        
        if result.modified_count > 0:
            logger.info(f"消息添加成功: session_id={session_id}, message_role={message.get('role')}")
            return {"success": True, "modified_count": result.modified_count}
        else:
            # 如果会话不存在，尝试创建新会话
            create_result = create_chat_session(user_id, session_id)
            if create_result["success"]:
                # 重新尝试添加消息
                return add_message_to_session(session_id, user_id, message, model)
            else:
                logger.error(f"会话不存在且创建失败: session_id={session_id}")
                return {"success": False, "error": "会话不存在且创建失败"}
                
    except Exception as e:
        logger.error(f"添加消息到会话错误: {str(e)}")
        return {"success": False, "error": str(e)}


def get_chat_session(session_id: str, user_id: str):
    """获取单个聊天会话"""
    try:
        session = chat_session_collection.find_one({"session_id": session_id, "user_id": user_id})
        
        if session:
            # 转换 ObjectId 为字符串
            if '_id' in session and isinstance(session['_id'], ObjectId):
                session['_id'] = str(session['_id'])
            return session
        else:
            return None
            
    except Exception as e:
        logger.error(f"获取聊天会话错误: {str(e)}")
        return None


def get_user_chat_sessions(user_id: str, limit: int = 20, skip: int = 0):
    """获取用户的聊天会话列表"""
    try:
        sessions = list(
            chat_session_collection.find({"user_id": user_id})
            .sort("updated_at", -1)
            .skip(skip)
            .limit(limit)
        )
        
        # 转换 ObjectId 为字符串
        for session in sessions:
            if '_id' in session and isinstance(session['_id'], ObjectId):
                session['_id'] = str(session['_id'])
                
        return sessions
        
    except Exception as e:
        logger.error(f"获取用户聊天会话列表错误: {str(e)}")
        return []


def update_session_title(session_id: str, user_id: str, title: str):
    """更新会话标题"""
    try:
        result = chat_session_collection.update_one(
            {"session_id": session_id, "user_id": user_id},
            {"$set": {"title": title, "updated_at": datetime.now()}}
        )
        
        if result.modified_count > 0:
            logger.info(f"会话标题更新成功: session_id={session_id}, title={title}")
            return {"success": True}
        else:
            logger.warning(f"会话不存在或标题未更新: session_id={session_id}")
            return {"success": False, "error": "会话不存在或标题未更新"}
            
    except Exception as e:
        logger.error(f"更新会话标题错误: {str(e)}")
        return {"success": False, "error": str(e)}


def delete_chat_session(session_id: str, user_id: str):
    """删除聊天会话"""
    try:
        result = chat_session_collection.delete_one({"session_id": session_id, "user_id": user_id})
        
        if result.deleted_count > 0:
            logger.info(f"会话删除成功: session_id={session_id}")
            # 清除缓存中的记录
            cache_key = f"{session_id}_{user_id}"
            if cache_key in _delete_warning_cache:
                del _delete_warning_cache[cache_key]
            return {"success": True, "deleted_count": result.deleted_count}
        else:
            # 使用缓存避免重复警告
            cache_key = f"{session_id}_{user_id}"
            current_time = time.time()
            
            # 清理过期的缓存
            expired_keys = [k for k, v in _delete_warning_cache.items() if current_time - v > _cache_ttl]
            for k in expired_keys:
                del _delete_warning_cache[k]
            
            # 检查是否已经记录过这个警告
            if cache_key not in _delete_warning_cache:
                logger.warning(f"会话不存在或删除失败: session_id={session_id}")
                _delete_warning_cache[cache_key] = current_time
            
            return {"success": False, "error": "会话不存在"}
            
    except Exception as e:
        logger.error(f"删除会话错误: {str(e)}")
        return {"success": False, "error": str(e)}


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

async def save_image_to_mongodb(session_id: str, user_id: str, base64_data: str, mime_type: str = "image/jpeg"):
    """
    將圖片的 base64 數據保存到 MongoDB
    
    參數:
        session_id: 會話 ID
        user_id: 用戶 ID
        base64_data: 圖片的 base64 數據（不含 data:image/jpeg;base64, 前綴）
        mime_type: 圖片的 MIME 類型，默認為 image/jpeg
        
    返回:
        image_id: 圖片在 MongoDB 中的 ID
    """
    try:
        # 創建圖片記錄
        image_record = {
            "session_id": session_id,
            "user_id": user_id,
            "base64_data": base64_data,
            "mime_type": mime_type,
            "created_at": datetime.now()
        }
        
        # 插入到 MongoDB
        result = await image_collection.insert_one(image_record)
        
        # 返回插入的 ID
        return result.inserted_id
    except Exception as e:
        logger.error(f"保存圖片到 MongoDB 失敗: {str(e)}")
        raise e

async def get_image_from_mongodb(image_id: str):
    """
    從 MongoDB 獲取圖片數據
    
    參數:
        image_id: 圖片在 MongoDB 中的 ID
        
    返回:
        image_data: 包含 base64_data 和 mime_type 的字典
    """
    try:
        # 將字符串 ID 轉換為 ObjectId
        obj_id = ObjectId(image_id)
        
        # 從 MongoDB 獲取圖片記錄
        image_record = await image_collection.find_one({"_id": obj_id})
        
        if not image_record:
            logger.error(f"找不到 ID 為 {image_id} 的圖片")
            return None
        
        # 從記錄中提取所需數據
        return {
            "data": image_record["base64_data"],
            "mime_type": image_record["mime_type"],
            "created_at": image_record["created_at"]
        }
    except Exception as e:
        logger.error(f"從 MongoDB 獲取圖片失敗: {str(e)}")
        raise e

async def get_session_images(session_id: str):
    """
    獲取指定會話的所有圖片 ID
    
    參數:
        session_id: 會話 ID
        
    返回:
        image_ids: 圖片 ID 列表
    """
    try:
        # 查詢指定會話的所有圖片
        cursor = image_collection.find({"session_id": session_id})
        
        # 提取圖片 ID
        image_records = await cursor.to_list(length=100)  # 限制最多返回 100 個圖片
        
        # 返回圖片 ID 列表
        return [str(record["_id"]) for record in image_records]
    except Exception as e:
        logger.error(f"獲取會話圖片失敗: {str(e)}")
        raise e