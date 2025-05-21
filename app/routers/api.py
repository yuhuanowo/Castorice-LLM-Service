from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Dict, Any, Optional
import uuid
from datetime import datetime
import logging
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
    if request.model not in settings.ALLOWED_MODELS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"模型 {request.model} 不受支持。支持的模型: {', '.join(settings.ALLOWED_MODELS)}"
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
    
    # 格式化用户消息，处理文本、图像或音频输入
    user_messages = await llm_service.format_user_message(
        request.messages[-1].content if request.messages else "",
        request.image,
        request.audio,
        request.model
    )
    
    # 准备完整的消息列表：系统提示 + 历史消息 + 当前用户消息
    full_messages = [system_prompt] + request.messages[:-1] + user_messages
    
    # 发送LLM请求
    response = await llm_service.send_llm_request(full_messages, request.model, tools)
    
    # 检查API响应错误
    if "error" in response:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=response.get("detail", "LLM请求失败")
        )
    
    # 提取响应内容
    message = ""
    tool_calls = None
    if "choices" in response and response["choices"]:
        choice = response["choices"][0]
        if "message" in choice:
            message = choice["message"].get("content", "")
            # 检查工具调用
            if "tool_calls" in choice["message"]:
                tool_calls = choice["message"]["tool_calls"]
    
    # 处理工具调用（如生成图像或网络搜索）
    if tool_calls:
        # 执行工具调用并获取结果
        tool_results = await llm_service.handle_tool_call(tool_calls)
        
        # 如果有工具结果，将其添加到对话，并重新请求LLM以获取最终回应
        if tool_results:
            # 创建包含工具结果的新消息列表
            new_messages = full_messages + [
                {"role": "assistant", "content": None, "tool_calls": tool_calls}
            ] + tool_results
            
            # 再次发送请求以获取整合工具结果的最终回应
            final_response = await llm_service.send_llm_request(new_messages, request.model)
            if "choices" in final_response and final_response["choices"]:
                message = final_response["choices"][0]["message"].get("content", message)
    
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
    
    # 异步更新用户长期记忆
    await memory_service.update_memory(
        request.user_id,
        request.messages[-1].content if request.messages else ""
    )
    logger.info("记忆更新任务已完成")
    
    # 返回完整响应
    return {
        "message": message,
        "model": request.model,
        "usage": usage,
        "tool_calls": tool_calls
    }


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
        "limits": settings.MODEL_USAGE_LIMITS
    }


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
    history = get_chat_logs(user_id, limit)
    return {"history": history}