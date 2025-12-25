from fastapi import APIRouter, Depends, HTTPException, status, Body, Request
from typing import Dict, Any, Optional, List
from pydantic import BaseModel
import uuid
from datetime import datetime
import logging
import json
import asyncio

from fastapi.responses import StreamingResponse

from app.core.dependencies import get_api_key, get_settings_dependency
from app.core.config import Settings
from app.services.agent_service import agent_service
from app.models.mongodb import create_chat_log, get_user_memory, add_message_to_session, get_chat_session, update_session_title
from app.utils.logger import logger
from app.services.llm_service import llm_service  # 添加导入llm_service
from app.routers.api import generate_smart_title  # 導入智能標題生成函數

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
    session_id: Optional[str] = None  # 會話ID，用於會話管理
    
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
        if request.model_name not in settings.ALLOWED_GITHUB_MODELS + settings.ALLOWED_GEMINI_MODELS + settings.ALLOWED_OLLAMA_MODELS + settings.ALLOWED_NVIDIA_NIM_MODELS + settings.ALLOWED_OPENROUTER_MODELS:
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
        
        # 會話管理 - 如果提供了session_id，保存到會話中
        if request.session_id:
            logger.info(f"保存Agent響應到會話: session_id={request.session_id}")
            
            # 添加用戶消息到會話            
            user_message = {
                "id": str(uuid.uuid4()),
                "role": "user",
                "content": request.prompt,
                "timestamp": datetime.now().isoformat()
            }
              # 提取Agent響應
            agent_response_content = result["response"]["choices"][0]["message"]["content"] if "choices" in result["response"] else "Agent无响应"
            
            # 處理執行軌跡數據，確保格式符合前端UI期望
            execution_trace = []
            if result.get("execution_trace"):
                for i, trace in enumerate(result["execution_trace"]):
                    # 優先使用 context，如果沒有則使用 details，如果都沒有則不設置
                    details = trace.get("context") or trace.get("details")
                    trace_item = {
                        "step": i + 1,
                        "action": trace.get("action", "unknown"),
                        "status": trace.get("status", "completed"),
                        "timestamp": trace.get("timestamp", datetime.now().isoformat())
                    }
                    # 只有當 details 存在且不為空對象時才添加
                    if details and (not isinstance(details, dict) or len(details) > 0):
                        trace_item["details"] = details
                    execution_trace.append(trace_item)
            
            # 處理推理步驟數據，確保格式符合前端UI期望
            reasoning_steps = []
            if result.get("reasoning_steps"):
                for step in result["reasoning_steps"]:
                    reasoning_steps.append({
                        "type": step.get("type", "thought"),  # thought/action/observation/reflection
                        "content": step.get("content", ""),
                        "timestamp": step.get("timestamp", datetime.now().isoformat())
                    })
            
            # 處理工具使用數據，確保格式符合前端UI期望
            tools_used = []
            if result.get("tools_used"):
                for tool in result["tools_used"]:
                    tools_used.append({
                        "name": tool.get("name", "unknown_tool"),
                        "result": tool.get("result", ""),
                        "duration": tool.get("duration", 0)
                    })
            
            # 添加助手回復到會話 - 包含完整的UI展示數據
            assistant_message = {
                "id": str(uuid.uuid4()),
                "role": "assistant",
                "content": agent_response_content,
                "timestamp": datetime.now().isoformat(),
                
                # Agent模式核心信息
                "mode": "agent",
                "model_used": request.model_name,
                "execution_time": result.get("execution_time", 0),
                "steps_taken": result.get("steps_taken", 0),
                
                # UI展示增強信息
                "execution_trace": execution_trace,
                "reasoning_steps": reasoning_steps,
                "tools_used": tools_used,
                
                # 圖片生成支持
                "generated_image": result.get("generated_image"),
                
                # 完整原始響應數據（用於JSON按鈕）
                "raw_response": {
                    "success": result.get("success", True),
                    "interaction_id": result.get("interaction_id"),
                    "response": result.get("response", {}),
                    "execution_trace": result.get("execution_trace", []),
                    "reasoning_steps": result.get("reasoning_steps", []),
                    "tools_used": result.get("tools_used", []),
                    "execution_time": result.get("execution_time", 0),
                    "steps_taken": result.get("steps_taken", 0),
                    "meta": result.get("meta", {})
                }
            }
            
            # 保存用戶和助手消息
            user_result = add_message_to_session(request.session_id, request.user_id, user_message, request.model_name)
            assistant_result = add_message_to_session(request.session_id, request.user_id, assistant_message, request.model_name)
            
            if user_result["success"] and assistant_result["success"]:
                logger.info(f"Agent消息已保存到會話: session_id={request.session_id}")
                  # 如果是會話的第一條消息，智能生成標題
                session = get_chat_session(request.session_id, request.user_id)
                if session and session.get('message_count', 0) <= 2:  # 第一輪對話（用戶+助手=2條消息）
                    # 使用智能標題生成
                    smart_title = await generate_smart_title(request.prompt, agent_response_content)
                    update_session_title(request.session_id, request.user_id, smart_title)
                    logger.info(f"已為Agent會話智能生成標題: {smart_title}")
            else:
                logger.error(f"保存Agent消息到會話失敗: user_result={user_result}, assistant_result={assistant_result}")
        execution_time = (datetime.now() - start_time).total_seconds()
        logger.info(f"Agent请求处理完成，执行时间: {execution_time:.2f}秒，步骤数: {result['steps_taken']}")
        
        # 確保返回給前端的數據結構與存儲的一致
        # 使用格式化後的數據覆蓋原始數據
        # 初始化這些變量，以防它們未在session_id存在時定義
        execution_trace = result.get("execution_trace", [])
        reasoning_steps = result.get("reasoning_steps", [])
        tools_used = result.get("tools_used", [])
        
        # 只有當session_id存在時才會重新格式化這些數據
        if request.session_id:
            # 這些變量已在處理session時被定義
            pass
            
        result["execution_trace"] = execution_trace
        result["reasoning_steps"] = reasoning_steps  
        result["tools_used"] = tools_used
        result["execution_time"] = result.get("execution_time", execution_time)
        
        return result
    except Exception as e:
        logger.error(f"Agent请求处理错误: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Agent处理错误: {str(e)}"
        )


@router.post("/stream", tags=["agent"])
async def agent_stream(
    request: Request,
    settings: Settings = Depends(get_settings_dependency),
    api_key: str = Depends(get_api_key),
):
    """
    Agent流式推理接口（SSE）
    請求體同 /api/v1/agent/ ，回應為流式SSE格式，每步推送一條推理狀態。
    支持會話管理和增強訊息存儲。
    """
    body = await request.json()
    import uuid
    from datetime import datetime
    import json
    import asyncio
    interaction_id = str(uuid.uuid4())
    step_counter = 0
    
    # 從請求體提取參數
    user_id = body.get("user_id", "test")
    prompt = body.get("prompt", "")
    model_name = body.get("model_name", "gpt-4o-mini")
    session_id = body.get("session_id")  # 新增會話ID支持

    async def event_generator():
        queue = asyncio.Queue()
        nonlocal step_counter
        final_result = None  # 保存最終結果用於會話存儲
        start_time = datetime.now()
        
        # 定义 on_step callback，将每步推理放入 queue
        async def on_step(step: dict):
            nonlocal step_counter
            step_counter += 1
            data = {
                "step": step_counter,
                "status": step.get("status", "thinking"),
                "message": step.get("message", ""),
                "plan": step.get("plan"),
                "timestamp": datetime.utcnow().isoformat(),
                "details": step.get("details", {})
            }
            await queue.put(data)
            
        # 启动 agent_service.run_stream 作為 background task
        async def run_agent():
            nonlocal final_result
            try:
                result = await agent_service.run_stream(
                    user_id=user_id,
                    prompt=prompt,
                    model_name=model_name,
                    enable_memory=body.get("enable_memory", True),
                    enable_reflection=body.get("enable_reflection", True),
                    enable_mcp=body.get("enable_mcp", False),
                    enable_react_mode=body.get("enable_react_mode", True),
                    max_steps=body.get("max_steps"),
                    system_prompt_override=body.get("system_prompt_override"),
                    additional_context=body.get("context"),
                    tools_config=body.get("tools_config"),
                    image=body.get("image"),
                    audio=body.get("audio"),
                    on_step=on_step
                )
                
                final_result = result  # 保存結果用於會話存儲
                
                await queue.put(_make_sse_step(
                    step_counter+1, "done",
                    result["response"]["choices"][0]["message"]["content"] if "choices" in result["response"] else "Agent已完成推理",
                    details={"final": True}
                ))
                
                # 流式處理完成後，保存到會話
                if session_id and final_result:
                    await save_stream_to_session(session_id, user_id, prompt, model_name, final_result, start_time)
                    
            except Exception as e:
                logger.error(f"Agent流式處理錯誤: {str(e)}", exc_info=True)
                await queue.put(_make_sse_step(
                    step_counter+1, "error", str(e), details={"error": True}
                ))
            finally:
                await queue.put(None)  # 结束标记

        def _make_sse_step(step, status, message, plan=None, details=None):
            return {
                "step": step,
                "status": status,
                "message": message,
                "plan": plan,
                "timestamp": datetime.utcnow().isoformat(),
                "details": details or {}
            }

        # 启动 agent background task
        agent_task = asyncio.create_task(run_agent())
        try:
            while True:
                data = await queue.get()
                if data is None:
                    break
                yield f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
        except Exception as e:
            error_data = {
                "step": step_counter+1,
                "status": "error",
                "message": str(e),
                "plan": None,
                "timestamp": datetime.utcnow().isoformat(),
                "details": {"error": True}
            }
            yield f"data: {json.dumps(error_data, ensure_ascii=False)}\n\n"
        finally:
            agent_task.cancel()

    return StreamingResponse(event_generator(), media_type="text/event-stream")


async def save_stream_to_session(session_id: str, user_id: str, prompt: str, model_name: str, result: dict, start_time: datetime):
    """
    將流式Agent結果保存到會話中，格式與非流式API一致
    """
    try:
        logger.info(f"保存流式Agent響應到會話: session_id={session_id}")
          # 添加用戶消息到會話
        user_message = {
            "id": str(uuid.uuid4()),
            "role": "user",
            "content": prompt,
            "timestamp": datetime.now().isoformat()
        }
        
        # 提取Agent響應
        agent_response_content = result["response"]["choices"][0]["message"]["content"] if "choices" in result["response"] else "Agent无响应"
        
        # 處理執行軌跡數據，確保格式符合前端UI期望
        execution_trace = []
        if result.get("execution_trace"):
            for i, trace in enumerate(result["execution_trace"]):
                # 優先使用 context，如果沒有則使用 details，如果都沒有則不設置
                details = trace.get("context") or trace.get("details")
                trace_item = {
                    "step": i + 1,
                    "action": trace.get("action", "unknown"),
                    "status": trace.get("status", "completed"),
                    "timestamp": trace.get("timestamp", datetime.now().isoformat())
                }
                # 只有當 details 存在且不為空對象時才添加
                if details and (not isinstance(details, dict) or len(details) > 0):
                    trace_item["details"] = details
                execution_trace.append(trace_item)
        
        # 處理推理步驟數據，確保格式符合前端UI期望
        reasoning_steps = []
        if result.get("reasoning_steps"):
            for step in result["reasoning_steps"]:
                reasoning_steps.append({
                    "type": step.get("type", "thought"),  # thought/action/observation/reflection
                    "content": step.get("content", ""),
                    "timestamp": step.get("timestamp", datetime.now().isoformat())
                })
        
        # 處理工具使用數據，確保格式符合前端UI期望
        tools_used = []
        if result.get("tools_used"):
            for tool in result["tools_used"]:
                tools_used.append({
                    "name": tool.get("name", "unknown_tool"),
                    "result": tool.get("result", ""),
                    "duration": tool.get("duration", 0)
                })
        
        execution_time = (datetime.now() - start_time).total_seconds()
        
        # 添加助手回復到會話 - 包含完整的UI展示數據
        assistant_message = {
            "id": str(uuid.uuid4()),
            "role": "assistant",
            "content": agent_response_content,
            "timestamp": datetime.now().isoformat(),
            
            # Agent模式核心信息
            "mode": "agent",
            "model_used": model_name,
            "execution_time": result.get("execution_time", execution_time),
            "steps_taken": result.get("steps_taken", 0),
            
            # UI展示增強信息
            "execution_trace": execution_trace,
            "reasoning_steps": reasoning_steps,
            "tools_used": tools_used,
            
            # 圖片生成支持
            "generated_image": result.get("generated_image"),
            
            # 完整原始響應數據（用於JSON按鈕）
            "raw_response": {
                "success": result.get("success", True),
                "interaction_id": result.get("interaction_id"),
                "response": result.get("response", {}),
                "execution_trace": result.get("execution_trace", []),
                "reasoning_steps": result.get("reasoning_steps", []),
                "tools_used": result.get("tools_used", []),
                "execution_time": result.get("execution_time", execution_time),
                "steps_taken": result.get("steps_taken", 0),
                "meta": result.get("meta", {})
            }
        }
        
        # 保存用戶和助手消息
        user_result = add_message_to_session(session_id, user_id, user_message, model_name)
        assistant_result = add_message_to_session(session_id, user_id, assistant_message, model_name)
        
        if user_result["success"] and assistant_result["success"]:
            logger.info(f"流式Agent消息已保存到會話: session_id={session_id}")
              # 如果是會話的第一條消息，智能生成標題
            session = get_chat_session(session_id, user_id)
            if session and session.get('message_count', 0) <= 2:  # 第一輪對話（用戶+助手=2條消息）
                # 使用智能標題生成
                smart_title = await generate_smart_title(prompt, agent_response_content)
                update_session_title(session_id, user_id, smart_title)
                logger.info(f"已為流式Agent會話智能生成標題: {smart_title}")
        else:
            logger.error(f"保存流式Agent消息到會話失敗: user_result={user_result}, assistant_result={assistant_result}")
            
    except Exception as e:
        logger.error(f"保存流式Agent會話時發生錯誤: {str(e)}", exc_info=True)
