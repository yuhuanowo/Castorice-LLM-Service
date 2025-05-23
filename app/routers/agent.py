from fastapi import APIRouter, Depends, HTTPException, status, Body
from typing import Dict, Any, Optional, List
from pydantic import BaseModel
import uuid
from datetime import datetime
import logging
import json

from app.core.dependencies import get_api_key, get_settings_dependency
from app.core.config import Settings
from app.services.agent_service import agent_service
from app.models.mongodb import create_chat_log, get_user_memory
from app.utils.logger import logger

# 创建Agent路由
router = APIRouter()


# 统一Agent请求模型
class UnifiedAgentRequest(BaseModel):
    """Agent请求模型"""
    prompt: str
    user_id: str
    model_name: str = "gpt-4o-mini"
    
    # 基本功能开关
    enable_memory: bool = True
    enable_reflection: bool = True
    enable_react_mode: bool = True
    enable_mcp: bool = False
    
    # 高级选项
    max_steps: Optional[int] = None
    tools_config: Optional[Dict[str, bool]] = None
    system_prompt_override: Optional[str] = None
    context: Optional[Dict[str, Any]] = None
    
    # 多模态输入
    image: Optional[str] = None
    audio: Optional[str] = None
    
    # MCP特定字段（如果启用MCP时需要）
    environment_info: Optional[Dict[str, Any]] = None
    document_chunks: Optional[List[Dict[str, Any]]] = None


class AgentResponse(BaseModel):
    """Agent响应模型"""
    success: bool
    interaction_id: str
    response: Dict[str, Any]
    execution_trace: Optional[List[Dict[str, Any]]] = None
    reasoning_steps: Optional[List[Dict[str, Any]]] = None
    execution_time: float
    steps_taken: int
    generated_image: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None  # 用于MCP模式的额外元数据


@router.post("/agent", response_model=AgentResponse, tags=["agent"])
async def run_unified_agent(
    request: UnifiedAgentRequest = Body(...),
    settings: Settings = Depends(get_settings_dependency),
    api_key: str = Depends(get_api_key),
):
    """
    统一的Agent接口 - 支持普通模式、高级模式和MCP模式
    
    - **prompt**: 用户提示或查询
    - **user_id**: 用户ID
    - **model_name**: 模型名称
    
    基本功能开关:
    - **enable_memory**: 是否启用记忆功能
    - **enable_reflection**: 是否启用反思能力
    - **enable_react_mode**: 是否使用ReAct模式（思考-行动-观察）
    - **enable_mcp**: 是否启用MCP协议
    
    高级选项:
    - **max_steps**: 可选的最大步骤数限制
    - **tools_config**: 工具配置，如 {"search": true, "image": false}
    - **system_prompt_override**: 可选的系统提示覆盖
    - **context**: 附加上下文信息
    
    多模态输入:
    - **image**: 可选的图片输入（base64编码）
    - **audio**: 可选的音频输入（base64编码）
    
    MCP特定字段:
    - **environment_info**: 环境信息（MCP模式）
    - **document_chunks**: 文档块列表（MCP模式）
    """
    try:
        logger.info(f"收到Agent请求，用户: {request.user_id}, 模型: {request.model_name}, " +
                   f"模式: {'MCP' if request.enable_mcp else ('ReAct' if request.enable_react_mode else '标准')}")
        
        # 验证模型
        if request.model_name not in settings.ALLOWED_GITHUB_MODELS + settings.ALLOWED_GEMINI_MODELS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"不支持的模型: {request.model_name}"
            )
            
        # 验证MCP支持（如果启用）
        if request.enable_mcp:
            if request.model_name not in settings.MCP_SUPPORTED_MODELS:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"模型 {request.model_name} 不支持MCP协议"
                )
            
            # TODO: MCP协议实现逻辑
            # 由于您要求暂时不支持MCP，所以暂不实现
            if settings.MCP_SUPPORT_ENABLED is False:
                raise HTTPException(
                    status_code=status.HTTP_501_NOT_IMPLEMENTED,
                    detail="MCP协议支持尚未启用，请在配置中启用"
                )
        
        # 检查工具支持
        if request.model_name in settings.UNSUPPORTED_TOOL_MODELS and request.tools_config:
            logger.warning(f"模型 {request.model_name} 不支持工具调用，但仍然尝试配置工具")
            
        # 处理最大步骤数
        max_steps = request.max_steps if request.max_steps is not None else settings.AGENT_MAX_STEPS
        
        # 构建可能的系统提示覆盖
        system_prompt_override = None
        if request.system_prompt_override:
            system_prompt_override = {
                "role": "system",
                "content": request.system_prompt_override
            }
        
        # 处理额外上下文
        additional_context = []
        if request.context:
            for key, value in request.context.items():
                additional_context.append({
                    "role": "system",
                    "content": f"{key}: {json.dumps(value, ensure_ascii=False)}"
                })
        
        # 运行Agent
        start_time = datetime.now()
        
        # 准备工具配置
        tools_config = request.tools_config or {}
        enable_search = tools_config.get("search", True)
        include_advanced_tools = tools_config.get("advanced", settings.AGENT_DEFAULT_ADVANCED_TOOLS)
        
        # 调用Agent服务
        result = await agent_service.run(
            user_id=request.user_id,
            prompt=request.prompt,
            model_name=request.model_name,
            enable_memory=request.enable_memory,
            enable_reflection=request.enable_reflection,
            enable_mcp=request.enable_mcp,
            enable_react_mode=request.enable_react_mode,
            max_steps=max_steps,
            system_prompt_override=system_prompt_override,
            additional_context=additional_context,
            image=request.image,
            audio=request.audio,
            tools_config={
                "enable_search": enable_search,
                "include_advanced_tools": include_advanced_tools
            }
        )
        
        # 记录到聊天历史
        await create_chat_log(
            user_id=request.user_id,
            model=request.model_name,
            prompt=request.prompt,
            reply=result["response"]["choices"][0]["message"]["content"] if "choices" in result["response"] else "无响应",
            interaction_id=result["interaction_id"]
        )
        
        execution_time = (datetime.now() - start_time).total_seconds()
        logger.info(f"Agent请求处理完成，执行时间: {execution_time:.2f}秒，步骤数: {result['steps_taken']}")
        
        return result
    except Exception as e:
        logger.error(f"Agent请求处理错误: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Agent处理错误: {str(e)}"
        )
