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
from app.services.llm_service import llm_service  # 添加导入llm_service

# 创建Agent路由
router = APIRouter()


# 统一Agent请求模型
class UnifiedAgentRequest(BaseModel):
    """
    Agent请求模型
    
    支持两种主要模式：
    1. ReAct模式 (enable_react_mode=True) - 完整的推理、行动、反思循环
    2. 简单模式 (enable_react_mode=False) - 基础的工具调用模式
    
    每种模式都可以选择性启用MCP功能 (enable_mcp=True/False)
    """
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
    """
    Agent响应模型
    
    包含不同模式下返回的各种信息：
    - success: 执行是否成功
    - interaction_id: 交互ID，用于关联请求和响应
    - response: 模型的原始响应
    - execution_trace: 执行跟踪（包含状态变化、工具调用等）
    - reasoning_steps: 推理步骤（在ReAct模式下包含思考、行动、反思等）
    - execution_time: 执行时间（秒）
    - steps_taken: 执行的步骤数
    - generated_image: 可能生成的图片（如果有）
    - meta: 元数据（可能包含MCP相关信息）
    """
    success: bool
    interaction_id: str
    response: Dict[str, Any]
    execution_trace: Optional[List[Dict[str, Any]]] = None
    reasoning_steps: Optional[List[Dict[str, Any]]] = None
    execution_time: float
    steps_taken: int
    generated_image: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None  # 用于MCP功能的额外元数据


@router.post("", response_model=AgentResponse, tags=["agent"])
@router.post("/", response_model=AgentResponse, tags=["agent"])
async def run_unified_agent(
    request: UnifiedAgentRequest = Body(...),
    settings: Settings = Depends(get_settings_dependency),
    api_key: str = Depends(get_api_key),
):
    """
    统一的Agent接口 - 支持两种主要模式：ReAct模式和简单模式，每种模式都可以选择性启用MCP功能
    
    - **prompt**: 用户提示或查询
    - **user_id**: 用户ID
    - **model_name**: 模型名称
    
    基本功能开关:
    - **enable_memory**: 是否启用记忆功能
    - **enable_reflection**: 是否启用反思能力（仅在ReAct模式下有效）
    - **enable_react_mode**: 是否使用ReAct模式（思考-行动-观察）
    - **enable_mcp**: 是否启用MCP功能（可在任何模式下使用）
    
    高级选项:
    - **max_steps**: 可选的最大步骤数限制
    - **tools_config**: 工具配置，如 {"search": true, "image": false}
    - **system_prompt_override**: 可选的系统提示覆盖
    - **context**: 附加上下文信息
    
    多模态输入:
    - **image**: 可选的图片输入（base64编码）
    - **audio**: 可选的音频输入（base64编码）
    
    MCP特定字段:
    - **environment_info**: 环境信息（启用MCP时使用）
    - **document_chunks**: 文档块列表（启用MCP时使用）
    """
    try:
        logger.info(f"收到Agent请求，用户: {request.user_id}, 模型: {request.model_name}, " +
                   f"模式: {'ReAct' if request.enable_react_mode else '简单'}, MCP功能: {'启用' if request.enable_mcp else '禁用'}")
        
        # 验证模型
        if request.model_name not in settings.ALLOWED_GITHUB_MODELS + settings.ALLOWED_GEMINI_MODELS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"不支持的模型: {request.model_name}"
            )
            
        # 检查用户使用限制，但不增加使用次数
        try:
            # 从JSON文件中获取当前使用量
            with open(llm_service.usage_path, "r") as f:
                user_usage = json.load(f)
            
            current_date = datetime.now().strftime("%Y-%m-%d")
            
            # 如果是新的一天，不需要检查限制
            if user_usage.get("date") != current_date:
                pass
            else:
                # 获取当前使用量
                usage_count = 0
                if request.user_id in user_usage and request.model_name in user_usage[request.user_id]:
                    usage_count = user_usage[request.user_id][request.model_name]
                
                # 获取模型限制
                limit = settings.MODEL_USAGE_LIMITS.get(request.model_name, 0)
                
                # 检查如果增加1次后是否会超过限制
                if usage_count + 1 > limit:
                    raise HTTPException(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        detail=f"今日模型 {request.model_name} 使用量已达上限 ({limit})"
                    )
        except FileNotFoundError:
            # 如果文件不存在，则无需检查限制
            pass
        except json.JSONDecodeError:
            logger.error("使用量JSON解析错误")
        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            logger.error(f"检查使用量错误: {str(e)}")
          # 验证MCP支持（如果启用）
        if request.enable_mcp:
            if request.model_name not in settings.MCP_SUPPORTED_MODELS:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"模型 {request.model_name} 不支持MCP功能"
                )
            
            # 检查MCP功能是否启用
            if settings.MCP_SUPPORT_ENABLED is False:
                raise HTTPException(
                    status_code=status.HTTP_501_NOT_IMPLEMENTED,
                    detail="MCP功能支持尚未启用，请在配置中启用"
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
