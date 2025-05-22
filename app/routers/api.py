from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Dict, Any, Optional
import uuid
from datetime import datetime
import logging
import asyncio
import json
from bson import ObjectId
logger = logging.getLogger(__name__)

from app.models.mongodb import create_chat_log, get_chat_logs, get_user_usage
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
    # 验证模型名称是否在允许列表中
    if request.model not in settings.ALLOWED_GITHUB_MODELS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"模型 {request.model} 不受支持。支持的模型: {', '.join(settings.ALLOWED_GITHUB_MODELS)}"
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
    tools = llm_service.get_tool_definitions(request.enable_search)
    
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
    create_chat_log(
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
    return {
        "user_id": user_id,
        "usage": usage_data,
        "limits": settings.GITHUB_MODEL_USAGE_LIMITS
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