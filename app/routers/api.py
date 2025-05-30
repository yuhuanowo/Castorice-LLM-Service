from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import StreamingResponse, Response
from typing import List, Dict, Any, Optional
import uuid
from datetime import datetime
import logging
import asyncio
import json
import os
import time
import urllib.parse
from bson import ObjectId
logger = logging.getLogger(__name__)

from app.models.mongodb import create_chat_log, get_chat_logs, get_user_usage, save_file_to_mongodb, get_file_from_mongodb, list_files_in_mongodb, delete_file_from_mongodb
from app.models.sqlite import create_chat_log_sqlite
from app.core.dependencies import get_api_key, get_settings_dependency
from app.core.config import Settings
from app.services.llm_service import llm_service
from app.services.memory_service import memory_service
import models as schemas

# 创建API路由
router = APIRouter()

# 辅助函数：确保MongoDB对象可以被JSON序列化
def json_serialize_mongodb(obj):
    """
    处理MongoDB对象的JSON序列化，将ObjectId转换为字符串
    """
    if isinstance(obj, ObjectId):
        return str(obj)
    elif isinstance(obj, datetime):
        return obj.isoformat()
    elif isinstance(obj, dict):
        return {k: json_serialize_mongodb(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [json_serialize_mongodb(i) for i in obj]
    return obj

# 记忆更新的后台任务函数
async def background_memory_update(user_id: str, prompt: str):
    try:
        await memory_service.update_memory(user_id, prompt)
        logger.info(f"后台记忆更新任务已完成，用户ID: {user_id}")
    except Exception as e:
        logger.error(f"后台记忆更新任务失败，用户ID: {user_id}, 错误: {str(e)}")


# MARK: chat/completions
@router.post("/chat/completions", response_model=schemas.ChatCompletionResponse)
async def chat_completion(
    request: schemas.ChatCompletionRequest,
    settings: Settings = Depends(get_settings_dependency),
    api_key: str = Depends(get_api_key)
):
    """
    创建聊天完成请求
    
    此端点处理与大型语言模型的对话，支持工具调用、多模态输入和记忆更新
    """    
    # 验证模型名称是否在允许列表中（GitHub、Gemini或Ollama模型）
    if (request.model not in settings.ALLOWED_GITHUB_MODELS and 
        request.model not in settings.ALLOWED_GEMINI_MODELS and 
        request.model not in settings.ALLOWED_OLLAMA_MODELS):
        all_models = settings.ALLOWED_GITHUB_MODELS + settings.ALLOWED_GEMINI_MODELS + settings.ALLOWED_OLLAMA_MODELS
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"模型 {request.model} 不受支持。支持的模型: {', '.join(all_models)}"
        )
    
    # 检查用户使用限制，更新使用统计
    usage = await llm_service.update_user_usage(request.user_id, request.model)
    if usage.get("isExceeded"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"今日模型 {request.model} 使用量已达上限 ({usage.get('limit')})"
        )
    
    # 获取系统提示（根据模型和语言定制）
    system_prompt = llm_service.get_system_prompt(request.model, request.language)
      # 获取工具定义（如果启用）
    tools = llm_service.get_tool_definitions(
        enable_search=request.enable_search,
        include_advanced_tools=False,
        enable_mcp=settings.MCP_SUPPORT_ENABLED and settings.AGENT_ENABLE_MCP
    )
    
    # 获取当前用户消息内容
    current_content = request.messages[-1].content if request.messages and len(request.messages) > 0 else ""
    
    # 格式化用户消息，处理文本、图像或音频输入
    user_messages = await llm_service.format_user_message(
        current_content,
        request.image,
        request.audio,
        request.model
    )
    
    # 处理历史消息逻辑
    history_messages = []
    
    # TODO: 处理多条消息輸入的情况
    
    # 只有一条消息或没有消息，且没有禁用历史功能，尝试从数据库获取
    if not getattr(request, "disable_history", False):
        # 获取用户最近5条历史消息
        db_history = get_chat_logs(request.user_id, 5)
        
        if db_history:
            # 将数据库历史记录转换为消息格式
            # 注意：get_chat_logs 返回的是按时间倒序排列的（最新的在前）
            # 但对话历史需要按时间正序（最早的在前），所以需要反转列表
            for entry in reversed(db_history):
                # 添加用户消息
                history_messages.append({"role": "user", "content": entry.get("prompt", "")})
                # 添加助手回复
                if entry.get("reply"):
                    history_messages.append({"role": "assistant", "content": entry.get("reply")})
            
            logger.info(f"使用数据库获取的历史消息，数量: {len(history_messages)}")
        else:
            logger.info("数据库中没有找到历史消息")
    
    # 准备完整的消息列表：系统提示 + 历史消息 + 当前用户消息
    full_messages = [system_prompt] + history_messages + user_messages
    
    logger.info(f"完整消息列表: {full_messages}")
    
    # 清除之前可能存在的图片数据
    llm_service.last_generated_image = None
    
    # 发送LLM请求
    response = await llm_service.send_llm_request(full_messages, request.model, tools)
    
    # 检查API响应错误
    if "error" in response:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=response.get("detail", "LLM请求失败")
        )
    
    # 提取响应内容
    message = ""  # 确保默认为空字符串而不是None
    tool_calls = None
    image_data_uri = None  # 用于存储图片数据URI
    if "choices" in response and response["choices"]:
        choice = response["choices"][0]
        if "message" in choice:
            message = choice["message"].get("content") or ""  # 确保None值被空字符串替换
            # 检查工具调用
            if "tool_calls" in choice["message"]:
                tool_calls = choice["message"]["tool_calls"]
    
    # 处理工具调用（如生成图像或网络搜索）
    if tool_calls:
        # 执行工具调用并获取结果
        tool_results = await llm_service.handle_tool_call(tool_calls)
        
        # 检查是否有图片生成结果
        for tool_result in tool_results:
            if tool_result.get("name") == "generateImage":
                logger.info(f"发现图片生成工具结果: {tool_result.get('name')}")
                try:
                    # 尝试从工具结果中提取消息
                    content_str = tool_result.get("content", "")
                    logger.info(f"工具结果内容长度: {len(content_str)}")
                    
                    # 检查内容是否为空
                    if not content_str:
                        logger.error("工具结果内容为空")
                        continue
                    
                    # 直接从LLM服务获取图片数据
                    image_data_uri = llm_service.last_generated_image
                    if image_data_uri:
                        logger.info(f"从LLM服务获取图片dataURI，长度: {len(image_data_uri)}")
                        # 添加关于图片的描述到消息中
                        if not message:
                            message = "已生成图片"
                    else:
                        # 尝试解析JSON查找错误信息
                        try:
                            content_json = json.loads(content_str)
                            if "error" in content_json:
                                logger.error(f"图片生成错误: {content_json['error']}")
                                message = f"图片生成失败: {content_json['error']}"
                        except json.JSONDecodeError:
                            if not message:
                                message = "收到图片生成结果，但无法获取图片数据"
                except Exception as e:
                    logger.error(f"处理图片生成结果错误: {str(e)}", exc_info=True)
        
        # 如果有工具结果，将其添加到对话，并重新请求LLM以获取最终回应
        if tool_results:
            # 创建包含工具结果的新消息列表
            new_messages = full_messages + [
                {"role": "assistant", "content": None, "tool_calls": tool_calls}
            ] + tool_results
            
            # 再次发送请求以获取整合工具结果的最终回应
            final_response = await llm_service.send_llm_request(new_messages, request.model)
            if "choices" in final_response and final_response["choices"]:
                message = final_response["choices"][0]["message"].get("content") or message  # 确保空值时使用原来的message
    
  # 创建唯一的交互ID用于追踪
    interaction_id = str(uuid.uuid4())
    
    # 将对话记录保存到MongoDB
    await create_chat_log(
        request.user_id,
        request.model,
        request.messages[-1].content if request.messages else "",
        message,
        interaction_id
    )
    
    # 同时将对话记录保存到SQLite（作为备份或兼容旧系统）
    create_chat_log_sqlite(
        request.user_id,
        request.model,
        request.messages[-1].content if request.messages else "",
        message,
        interaction_id
    )
    
    # 在后台异步更新用户长期记忆
    prompt = request.messages[-1].content if request.messages else ""
    asyncio.create_task(background_memory_update(request.user_id, prompt))
    logger.info(f"记忆更新任务已在后台启动，用户ID: {request.user_id}")
    
    # 返回完整响应
    return {
        "message": message,
        "model": request.model,
        "usage": usage,
        "tool_calls": tool_calls,
        "image_data_uri": image_data_uri  # 包含图片数据URI
    }

# MARK: Get User Memory
@router.get("/memory/{user_id}", response_model=schemas.MemoryResponse)
async def get_user_memory(
    user_id: str,
    api_key: str = Depends(get_api_key)
):
    """
    获取用户长期记忆
    
    返回系统保存的关于用户的长期信息和特征
    """
    memory = await memory_service.get_memory(user_id)
    return {"memory": memory}

# MARK: Update User Memory
@router.post("/memory/update", response_model=schemas.MemoryResponse)
async def update_user_memory(
    request: schemas.MemoryRequest,
    api_key: str = Depends(get_api_key)
):
    """
    更新用户长期记忆
    
    基于新提示手动更新用户记忆
    """
    memory = await memory_service.update_memory(request.user_id, request.prompt)
    return {"memory": memory}

# MARK: Get User Usage
@router.get("/usage/{user_id}", response_model=schemas.UsageResponse)
async def get_usage(
    user_id: str,
    settings: Settings = Depends(get_settings_dependency),
    api_key: str = Depends(get_api_key)
):
    """
    获取用户使用量统计
    
    返回用户对各个模型的使用情况和相应的限制
    """
    usage_data = get_user_usage(user_id)
    # 拍平 usage_data，确保所有 value 都是 int
    flat_usage = {}
    for k, v in usage_data.items():
        if isinstance(v, dict):
            for subk, subv in v.items():
                flat_usage[f"{k}-{subk}"] = subv
        else:
            flat_usage[k] = v
    # 合并模型限制
    model_limits = settings.MODEL_USAGE_LIMITS
    return {
        "user_id": user_id,
        "usage": flat_usage,
        "limits": model_limits
    }

# MARK: Get Chat History
@router.get("/history/{user_id}")
async def get_chat_history(
    user_id: str,
    limit: int = 10,
    api_key: str = Depends(get_api_key)
):
    """
    获取用户聊天历史
    
    返回用户最近的对话记录，可通过limit参数限制返回数量
    """
    # 获取聊天历史并确保可序列化
    history = get_chat_logs(user_id, limit)
    # 使用辅助函数确保所有数据可以被正确序列化
    serialized_history = json_serialize_mongodb(history)
    return {"history": serialized_history}


# MARK: File Upload
@router.post("/files/upload", response_model=schemas.FileUploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    user_id: str = None,
    description: str = None,
    tags: str = None,
    api_key: str = Depends(get_api_key)
):
    """
    上傳檔案到檔案資料庫
    
    支持多種檔案類型的上傳，自動生成唯一檔案ID並存儲元數據
    """
    try:
        # 生成唯一檔案ID
        file_id = str(uuid.uuid4())
        
        # 處理標籤
        tag_list = []
        if tags:
            tag_list = [tag.strip() for tag in tags.split(",") if tag.strip()]
        
        # 確保上傳目錄存在
        upload_dir = "./data/uploads"
        os.makedirs(upload_dir, exist_ok=True)
        
        # 讀取檔案內容
        file_content = await file.read()
        file_size = len(file_content)
        
        # 生成檔案路徑
        file_extension = os.path.splitext(file.filename)[1]
        stored_filename = f"{file_id}{file_extension}"
        file_path = os.path.join(upload_dir, stored_filename)
        
        # 儲存檔案
        with open(file_path, "wb") as f:
            f.write(file_content)
        
        # 創建檔案元數據
        file_metadata = {
            "file_id": file_id,
            "filename": file.filename,
            "stored_filename": stored_filename,
            "file_path": file_path,
            "file_size": file_size,
            "file_type": file.content_type or "application/octet-stream",
            "upload_time": datetime.now().isoformat(),
            "user_id": user_id or "anonymous",
            "description": description,
            "tags": tag_list
        }
          # 儲存到MongoDB（如果可用）
        try:
            from app.models.mongodb import get_database, save_file_to_mongodb
            db = get_database()
            if db is not None:
                # 使用GridFS存储完整文件
                gridfs_id = save_file_to_mongodb(
                    file_id=file_id,
                    filename=file.filename,
                    content_type=file.content_type or "application/octet-stream",
                    file_content=file_content,
                    metadata=file_metadata
                )
                logger.info(f"檔案已完整儲存到MongoDB GridFS: {file_id}, GridFS ID: {gridfs_id}")
        except Exception as e:
            logger.warning(f"無法儲存到MongoDB，使用本地儲存: {str(e)}")
            # 如果MongoDB不可用，儲存到本地JSON文件
            metadata_file = os.path.join(upload_dir, "metadata.json")
            if os.path.exists(metadata_file):
                with open(metadata_file, "r", encoding="utf-8") as f:
                    metadata_list = json.load(f)
            else:
                metadata_list = []
            
            metadata_list.append(file_metadata)
            with open(metadata_file, "w", encoding="utf-8") as f:
                json.dump(metadata_list, f, ensure_ascii=False, indent=2)
        return schemas.FileUploadResponse(
            file_id=file_id,
            filename=file.filename,
            file_size=file_size,
            file_type=file.content_type or "application/octet-stream",
            upload_time=datetime.now().isoformat(),
            user_id=user_id or "anonymous",
            description=description,
            tags=tag_list
        )
    except Exception as e:
        logger.error(f"檔案上傳失敗: {str(e)}")
        raise HTTPException(status_code=500, detail=f"檔案上傳失敗: {str(e)}")


@router.get("/files/{file_id}", response_class=Response)
async def download_file(
    file_id: str,
    api_key: str = Depends(get_api_key)
):
    """
    從檔案資料庫下載檔案
    
    根據檔案ID下載檔案，如果MongoDB可用，優先從MongoDB獲取
    """    
    try:
        # 首先嘗試從MongoDB獲取
        try:
            from app.models.mongodb import get_file_from_mongodb
            file_content, filename, content_type, metadata = get_file_from_mongodb(file_id)
            
            if file_content is not None:
                logger.info(f"從MongoDB GridFS獲取檔案: {file_id}")
                
                # 安全處理文件名，避免非ASCII字符問題
                safe_filename = urllib.parse.quote(filename)
                
                # 準備元數據 - 只保留ASCII可表示的字段或進行適當編碼
                safe_metadata = {}
                if metadata:
                    for key, value in metadata.items():
                        if isinstance(value, str):
                            # 對字符串值進行安全處理
                            safe_metadata[key] = value
                        else:
                            # 非字符串值直接保留
                            safe_metadata[key] = value
                
                # 使用ASCII安全的方式處理響應頭
                return Response(
                    content=file_content,
                    media_type=content_type,
                    headers={
                        "Content-Disposition": f'attachment; filename*=UTF-8\'\'{safe_filename}',
                        "X-File-Id": file_id
                    }
                )
        except Exception as e:
            logger.warning(f"從MongoDB獲取檔案失敗，嘗試從本地獲取: {str(e)}")
        
        # 如果MongoDB不可用或沒有找到檔案，嘗試從本地獲取
        upload_dir = "./data/uploads"
        metadata_file = os.path.join(upload_dir, "metadata.json")
        
        if os.path.exists(metadata_file):
            with open(metadata_file, "r", encoding="utf-8") as f:
                metadata_list = json.load(f)
            
            file_metadata = next((m for m in metadata_list if m.get("file_id") == file_id), None)
            if file_metadata and os.path.exists(file_metadata["file_path"]):
                with open(file_metadata["file_path"], "rb") as f:
                    file_content = f.read()
                
                # 安全處理文件名，避免非ASCII字符問題
                safe_filename = urllib.parse.quote(file_metadata["filename"])
                
                return Response(
                    content=file_content,
                    media_type=file_metadata.get("file_type", "application/octet-stream"),
                    headers={
                        "Content-Disposition": f'attachment; filename*=UTF-8\'\'{safe_filename}',
                        "X-File-Id": file_id
                    }
                )
        
        # 如果兩種方式都失敗，返回404
        raise HTTPException(status_code=404, detail="檔案未找到")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"檔案下載失敗: {str(e)}")
        raise HTTPException(status_code=500, detail=f"檔案下載失敗: {str(e)}")


@router.get("/files", response_model=List[schemas.FileMetadata])
async def list_files(
    user_id: str = None,
    tags: str = None,
    page: int = 1,
    page_size: int = 20,
    api_key: str = Depends(get_api_key)
):
    """
    列出檔案資料庫中的檔案
    
    可選參數用於篩選特定用戶或標籤的檔案
    """
    try:
        # 處理標籤
        tag_list = []
        if tags:
            tag_list = [tag.strip() for tag in tags.split(",") if tag.strip()]
        
        # 計算分頁
        skip = (page - 1) * page_size
        
        # 首先嘗試從MongoDB獲取
        try:
            from app.models.mongodb import list_files_in_mongodb
            files = list_files_in_mongodb(
                user_id=user_id,
                tags=tag_list if tag_list else None,
                limit=page_size,
                skip=skip
            )
            
            if files:
                logger.info(f"從MongoDB獲取檔案列表，找到{len(files)}個檔案")
                return files
        except Exception as e:
            logger.warning(f"從MongoDB獲取檔案列表失敗，嘗試從本地獲取: {str(e)}")
        
        # 如果MongoDB不可用，嘗試從本地獲取
        upload_dir = "./data/uploads"
        metadata_file = os.path.join(upload_dir, "metadata.json")
        
        if os.path.exists(metadata_file):
            with open(metadata_file, "r", encoding="utf-8") as f:
                metadata_list = json.load(f)
            
            # 應用篩選條件
            if user_id:
                metadata_list = [m for m in metadata_list if m.get("user_id") == user_id]
            
            if tag_list:
                metadata_list = [m for m in metadata_list if any(tag in m.get("tags", []) for tag in tag_list)]
            
            # 排序和分頁
            metadata_list.sort(key=lambda x: x.get("upload_time", ""), reverse=True)
            paginated_list = metadata_list[skip:skip + page_size]
            
            return paginated_list
        
        # 如果都沒有找到，返回空列表
        return []
    except Exception as e:
        logger.error(f"獲取檔案列表失敗: {str(e)}")
        raise HTTPException(status_code=500, detail=f"獲取檔案列表失敗: {str(e)}")


@router.delete("/files/{file_id}", response_model=schemas.FileDeleteResponse)
async def delete_file(
    file_id: str,
    api_key: str = Depends(get_api_key)
):
    """
    從檔案資料庫刪除檔案
    
    根據檔案ID刪除檔案，同時刪除MongoDB和本地存儲
    """
    try:
        mongodb_deleted = False
        local_deleted = False
        
        # 嘗試從MongoDB刪除
        try:
            from app.models.mongodb import delete_file_from_mongodb
            mongodb_deleted = delete_file_from_mongodb(file_id)
            if mongodb_deleted:
                logger.info(f"從MongoDB GridFS刪除檔案: {file_id}")
        except Exception as e:
            logger.warning(f"從MongoDB刪除檔案失敗: {str(e)}")
        
        # 嘗試從本地刪除
        upload_dir = "./data/uploads"
        metadata_file = os.path.join(upload_dir, "metadata.json")
        
        if os.path.exists(metadata_file):
            with open(metadata_file, "r", encoding="utf-8") as f:
                metadata_list = json.load(f)
            
            file_metadata = next((m for m in metadata_list if m.get("file_id") == file_id), None)
            
            if file_metadata:
                # 刪除實際檔案
                if os.path.exists(file_metadata["file_path"]):
                    os.remove(file_metadata["file_path"])
                
                # 更新元數據列表
                metadata_list = [m for m in metadata_list if m.get("file_id") != file_id]
                with open(metadata_file, "w", encoding="utf-8") as f:
                    json.dump(metadata_list, f, ensure_ascii=False, indent=2)
                
                local_deleted = True
                logger.info(f"從本地刪除檔案: {file_id}")
        
        if not mongodb_deleted and not local_deleted:
            raise HTTPException(status_code=404, detail="檔案未找到")
        
        return schemas.FileDeleteResponse(
            file_id=file_id,
            success=True,
            message="檔案刪除成功"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"檔案刪除失敗: {str(e)}")
        raise HTTPException(status_code=500, detail=f"檔案刪除失敗: {str(e)}")


# MARK: Get Model List
@router.get("/models", response_model=schemas.ModelListResponse)
async def get_model_list(
    provider: Optional[str] = None,
    settings: Settings = Depends(get_settings_dependency),
    api_key: str = Depends(get_api_key)
):
    """
    獲取可用的模型列表
    
    返回系統中配置的所有可用模型，可根據提供商進行篩選
    """
    try:
        models = []
        
        # GitHub 模型
        if not provider or provider.lower() == "github":
            for model_id in settings.ALLOWED_GITHUB_MODELS:
                models.append(schemas.ModelInfo(
                    model_id=model_id,
                    model_name=model_id,
                    provider="github",
                    description="GitHub Models提供的AI模型",
                    capabilities=["chat", "text-generation"]
                ))
        
        # Gemini 模型
        if not provider or provider.lower() == "gemini":
            for model_id in settings.ALLOWED_GEMINI_MODELS:
                models.append(schemas.ModelInfo(
                    model_id=model_id,
                    model_name=model_id,
                    provider="gemini",
                    description="Google Gemini AI模型",
                    capabilities=["chat", "text-generation", "multimodal"]
                ))
        
        # Ollama 模型
        if not provider or provider.lower() == "ollama":
            for model_id in settings.ALLOWED_OLLAMA_MODELS:
                models.append(schemas.ModelInfo(
                    model_id=model_id,
                    model_name=model_id,
                    provider="ollama",
                    description="Ollama本地AI模型",
                    capabilities=["chat", "text-generation"]
                ))
        
        return schemas.ModelListResponse(
            models=models,
            total_count=len(models)
        )
        
    except Exception as e:
        logger.error(f"獲取模型列表失敗: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"獲取模型列表失敗: {str(e)}"
        )


# MARK: Stream Chat
@router.post("/chat/stream")
async def stream_chat(
    request: schemas.StreamChatRequest,
    settings: Settings = Depends(get_settings_dependency),
    api_key: str = Depends(get_api_key)
):
    """
    建立實時對話流
    
    提供流式的對話響應，實現實時對話體驗
    """
    # 驗證模型
    if (request.model not in settings.ALLOWED_GITHUB_MODELS and 
        request.model not in settings.ALLOWED_GEMINI_MODELS and 
        request.model not in settings.ALLOWED_OLLAMA_MODELS):
        all_models = settings.ALLOWED_GITHUB_MODELS + settings.ALLOWED_GEMINI_MODELS + settings.ALLOWED_OLLAMA_MODELS
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"模型 {request.model} 不受支持。支持的模型: {', '.join(all_models)}"
        )
    
    # 檢查用戶使用限制
    usage = await llm_service.update_user_usage(request.user_id, request.model)
    if usage.get("isExceeded"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"今日模型 {request.model} 使用量已達上限 ({usage.get('limit')})"
        )
    
    async def generate_stream():
        """生成流式響應"""
        try:
            # 生成響應ID
            response_id = f"chatcmpl-{uuid.uuid4().hex[:8]}"
            created_time = int(time.time())
            
            # 模擬流式響應（實際實現需要調用相應模型的流式API）
            full_response = ""
            
            # 調用LLM服務生成響應
            try:
                # 這裡應該調用實際的流式API
                # 目前使用非流式API模擬流式輸出
                system_prompt = llm_service.get_system_prompt(request.model, "zh")
                
                # 構建消息
                messages = []
                if system_prompt:
                    messages.append({"role": "system", "content": system_prompt})
                
                for msg in request.messages:
                    messages.append({
                        "role": msg.role,
                        "content": msg.content
                    })
                
                # 調用LLM服務（非流式）
                response = await llm_service.chat_completion(
                    messages=messages,
                    model=request.model,
                    temperature=request.temperature,
                    max_tokens=request.max_tokens
                )
                
                full_response = response.get("message", "")
                
                # 將響應按字符分割，模擬流式輸出
                words = full_response.split()
                current_content = ""
                
                for i, word in enumerate(words):
                    current_content += word + " "
                    
                    chunk = schemas.StreamChatChunk(
                        id=response_id,
                        created=created_time,
                        model=request.model,
                        choices=[{
                            "index": 0,
                            "delta": {"content": word + " "},
                            "finish_reason": None if i < len(words) - 1 else "stop"
                        }]
                    )
                    
                    yield f"data: {chunk.json()}\n\n"
                    await asyncio.sleep(0.05)  # 模擬延遲
                
            except Exception as e:
                logger.error(f"流式對話生成失敗: {str(e)}")
                error_chunk = {
                    "id": response_id,
                    "object": "chat.completion.chunk",
                    "created": created_time,
                    "model": request.model,
                    "choices": [{
                        "index": 0,
                        "delta": {"content": f"錯誤: {str(e)}"},
                        "finish_reason": "error"
                    }]
                }
                yield f"data: {json.dumps(error_chunk)}\n\n"
            
            # 發送結束標記
            yield "data: [DONE]\n\n"
            
        except Exception as e:
            logger.error(f"流式響應生成失敗: {str(e)}")
            yield f"data: {{\"error\": \"{str(e)}\"}}\n\n"
    
    return StreamingResponse(
        generate_stream(),
        media_type="text/plain",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Content-Type": "text/event-stream"
        }
    )