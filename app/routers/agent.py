"""
Agent路由 - 全流式自主智能代理

基於 ReAct 架構，所有請求均通過 SSE 流式傳輸。
LLM 完全自主決定工具選擇、反思時機和任務完成判斷。
"""

from fastapi import APIRouter, Depends, HTTPException, status, Request
from typing import Dict, Any, Optional, List
from pydantic import BaseModel
import uuid
from datetime import datetime
import json
import asyncio

from fastapi.responses import StreamingResponse

from app.core.dependencies import get_api_key, get_settings_dependency
from app.core.config import Settings
from app.services.agent_service import agent_service
from app.models.mongodb import add_message_to_session, get_chat_session, update_session_title
from app.utils.logger import logger
from app.services.llm_service import llm_service
from app.routers.api import generate_smart_title

# 创建Agent路由
router = APIRouter()


# ============================================================
# 請求/響應模型
# ============================================================

class UnifiedAgentRequest(BaseModel):
    """
    Agent請求模型
    
    自主智能代理 - 基於 ReAct 架構的全流式智能代理
    所有請求均為流式輸出，即時返回推理過程
    """
    prompt: str
    user_id: str
    model_name: str = "gpt-4o-mini"
    session_id: Optional[str] = None
    
    # 基本功能開關
    enable_memory: bool = True
    enable_reflection: bool = True
    enable_mcp: bool = True
    
    # 高級選項
    max_steps: Optional[int] = None
    tools_config: Optional[Dict[str, bool]] = None
    system_prompt_override: Optional[str] = None
    context: Optional[Dict[str, Any]] = None
    
    # 多模態輸入
    image: Optional[str] = None
    audio: Optional[str] = None
    
    # MCP特定字段
    environment_info: Optional[Dict[str, Any]] = None
    document_chunks: Optional[List[Dict[str, Any]]] = None


# ============================================================
# 輔助函數：驗證和預處理
# ============================================================

async def validate_request(body: dict, settings: Settings) -> None:
    """驗證請求參數"""
    model_name = body.get("model_name", settings.AGENT_DEFAULT_MODEL)
    enable_mcp = body.get("enable_mcp", settings.AGENT_ENABLE_MCP)
    
    # 驗證模型
    all_models = (
        settings.ALLOWED_GITHUB_MODELS + 
        settings.ALLOWED_GEMINI_MODELS + 
        settings.ALLOWED_OLLAMA_MODELS + 
        settings.ALLOWED_NVIDIA_NIM_MODELS + 
        settings.ALLOWED_OPENROUTER_MODELS
    )
    if model_name not in all_models:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不支持的模型: {model_name}"
        )
    
    # 驗證MCP支持
    if enable_mcp:
        if model_name not in settings.MCP_SUPPORTED_MODELS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"模型 {model_name} 不支持MCP功能"
            )
        if settings.MCP_SUPPORT_ENABLED is False:
            raise HTTPException(
                status_code=status.HTTP_501_NOT_IMPLEMENTED,
                detail="MCP功能支持尚未啟用"
            )


async def check_usage_limit(user_id: str, model_name: str, settings: Settings) -> None:
    """檢查用戶使用限制"""
    try:
        with open(llm_service.usage_path, "r") as f:
            user_usage = json.load(f)
        
        current_date = datetime.now().strftime("%Y-%m-%d")
        if user_usage.get("date") != current_date:
            return  # 新的一天，無需檢查
        
        usage_count = 0
        if user_id in user_usage and model_name in user_usage[user_id]:
            usage_count = user_usage[user_id][model_name]
        
        limit = settings.MODEL_USAGE_LIMITS.get(model_name, 0)
        if usage_count + 1 > limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"今日模型 {model_name} 使用量已達上限 ({limit})"
            )
    except FileNotFoundError:
        pass
    except json.JSONDecodeError:
        logger.error("使用量JSON解析錯誤")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"檢查使用量錯誤: {str(e)}")


# ============================================================
# 主流式端點 - 唯一的Agent入口
# ============================================================

@router.post("", tags=["agent"])
@router.post("/", tags=["agent"])
@router.post("/stream", tags=["agent"])
async def agent_stream(
    request: Request,
    settings: Settings = Depends(get_settings_dependency),
    api_key: str = Depends(get_api_key),
):
    """
    自主智能代理 - 全流式 SSE 接口
    
    基於 ReAct (Reasoning, Acting, Observing) 架構的智能代理。
    LLM 完全自主決定執行流程，所有輸出均為流式傳輸。
    
    **請求參數：**
    - prompt: 用戶提示或查詢
    - user_id: 用戶ID
    - model_name: 模型名稱（默認 gpt-4o-mini）
    - session_id: 可選會話ID
    - enable_memory: 是否啟用記憶（默認 true）
    - enable_reflection: 是否啟用反思（默認 true）
    - enable_mcp: 是否啟用MCP工具（默認 true）
    - max_steps: 最大步驟數限制
    - tools_config: 工具配置
    - context: 附加上下文
    
    **SSE事件格式：**
    ```json
    {
        "step": 1,
        "status": "thinking|executing|observing|reflecting|responding|done|error",
        "message": "當前狀態描述",
        "tool_name": "使用的工具名稱（可選）",
        "tool_result": "工具執行結果（可選）",
        "reasoning": "推理內容（可選）",
        "is_final": false,
        "timestamp": "2024-01-01T00:00:00.000Z",
        "details": {}
    }
    ```
    
    **最終事件（is_final=true）包含完整響應：**
    ```json
    {
        "step": 5,
        "status": "done",
        "message": "最終回答內容",
        "is_final": true,
        "response": { "choices": [...] },
        "execution_trace": [...],
        "reasoning_steps": [...],
        "tools_used": [...],
        "execution_time": 3.5,
        "steps_taken": 5
    }
    ```
    """
    body = await request.json()
    interaction_id = str(uuid.uuid4())
    step_counter = 0
    
    # 提取請求參數
    user_id = body.get("user_id", "test")
    prompt = body.get("prompt", "")
    model_name = body.get("model_name", settings.AGENT_DEFAULT_MODEL)
    session_id = body.get("session_id")
    
    logger.info(f"收到Agent流式請求，用戶: {user_id}, 模型: {model_name}, "
                f"MCP: {'啟用' if body.get('enable_mcp', True) else '禁用'}")
    
    # 驗證請求
    try:
        await validate_request(body, settings)
        await check_usage_limit(user_id, model_name, settings)
    except HTTPException as exc:
        # 如果驗證失敗，返回錯誤事件流
        # 保存異常信息到局部變數以避免作用域問題
        error_detail = exc.detail
        error_status = exc.status_code
        
        async def error_generator():
            error_data = {
                "step": 1,
                "status": "error",
                "message": error_detail,
                "is_final": True,
                "timestamp": datetime.utcnow().isoformat(),
                "details": {"error": True, "status_code": error_status}
            }
            yield f"data: {json.dumps(error_data, ensure_ascii=False)}\n\n"
        
        return StreamingResponse(error_generator(), media_type="text/event-stream")

    async def event_generator():
        queue = asyncio.Queue()
        nonlocal step_counter
        final_result = None
        start_time = datetime.now()
        
        async def on_step(step: dict):
            """回調函數，將每步推理放入隊列"""
            nonlocal step_counter
            step_counter += 1
            
            data = {
                "step": step.get("step", step_counter),
                "status": step.get("status", "thinking"),
                "message": step.get("message", ""),
                "tool_name": step.get("tool_name"),
                "tool_result": step.get("tool_result"),
                "reasoning": step.get("reasoning"),
                "is_final": step.get("is_final", False),
                "timestamp": datetime.utcnow().isoformat(),
                "details": step.get("details", {})
            }
            
            # 如果是最終結果，包含完整響應數據
            if step.get("is_final"):
                data.update({
                    "response": step.get("response"),
                    "execution_trace": step.get("execution_trace", []),
                    "reasoning_steps": step.get("reasoning_steps", []),
                    "tools_used": step.get("tools_used", []),
                    "execution_time": step.get("execution_time"),
                    "steps_taken": step.get("steps_taken"),
                    "success": step.get("success", True),
                    "interaction_id": interaction_id
                })
            
            await queue.put(data)
        
        async def run_agent():
            """後台執行Agent任務"""
            nonlocal final_result
            try:
                # 處理工具配置
                tools_config = body.get("tools_config") or {}
                
                # 處理額外上下文
                additional_context = []
                if body.get("context"):
                    for key, value in body["context"].items():
                        additional_context.append({
                            "role": "system",
                            "content": f"{key}: {json.dumps(value, ensure_ascii=False)}"
                        })
                
                # 處理系統提示覆蓋
                system_prompt_override = None
                if body.get("system_prompt_override"):
                    system_prompt_override = {
                        "role": "system",
                        "content": body["system_prompt_override"]
                    }
                
                result = await agent_service.run(
                    user_id=user_id,
                    prompt=prompt,
                    model_name=model_name,
                    enable_memory=body.get("enable_memory", True),
                    enable_reflection=body.get("enable_reflection", True),
                    enable_mcp=body.get("enable_mcp", True),
                    max_steps=body.get("max_steps"),
                    system_prompt_override=system_prompt_override,
                    additional_context=additional_context,
                    tools_config=tools_config,
                    image=body.get("image"),
                    audio=body.get("audio"),
                    on_step=on_step
                )
                
                final_result = result
                
                # 保存到會話
                if session_id and final_result:
                    await save_to_session(
                        session_id, user_id, prompt, 
                        model_name, final_result, start_time
                    )
                    
            except Exception as e:
                logger.error(f"Agent流式處理錯誤: {str(e)}", exc_info=True)
                await queue.put({
                    "step": step_counter + 1,
                    "status": "error",
                    "message": str(e),
                    "is_final": True,
                    "timestamp": datetime.utcnow().isoformat(),
                    "details": {"error": True}
                })
            finally:
                await queue.put(None)  # 結束標記

        # 啟動Agent任務
        agent_task = asyncio.create_task(run_agent())
        
        try:
            while True:
                data = await queue.get()
                if data is None:
                    break
                yield f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.error(f"事件生成器錯誤: {str(e)}")
            error_data = {
                "step": step_counter + 1,
                "status": "error",
                "message": str(e),
                "is_final": True,
                "timestamp": datetime.utcnow().isoformat(),
                "details": {"error": True}
            }
            yield f"data: {json.dumps(error_data, ensure_ascii=False)}\n\n"
        finally:
            if not agent_task.done():
                agent_task.cancel()

    return StreamingResponse(
        event_generator(), 
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


# ============================================================
# 會話保存輔助函數
# ============================================================

async def save_to_session(
    session_id: str, 
    user_id: str, 
    prompt: str, 
    model_name: str, 
    result: dict, 
    start_time: datetime
) -> None:
    """將Agent結果保存到會話中"""
    try:
        logger.info(f"保存Agent響應到會話: session_id={session_id}")
        
        # 用戶消息
        user_message = {
            "id": str(uuid.uuid4()),
            "role": "user",
            "content": prompt,
            "timestamp": datetime.now().isoformat()
        }
        
        # 提取Agent響應內容
        response_content = "Agent無響應"
        if result.get("response", {}).get("choices"):
            response_content = result["response"]["choices"][0].get("message", {}).get("content", response_content)
        
        # 處理執行軌跡
        execution_trace = []
        for i, trace in enumerate(result.get("execution_trace", [])):
            details = trace.get("context") or trace.get("details")
            trace_item = {
                "step": i + 1,
                "action": trace.get("action", "unknown"),
                "status": trace.get("status", "completed"),
                "timestamp": trace.get("timestamp", datetime.now().isoformat())
            }
            if details and (not isinstance(details, dict) or len(details) > 0):
                trace_item["details"] = details
            execution_trace.append(trace_item)
        
        # 處理推理步驟
        reasoning_steps = []
        for step in result.get("reasoning_steps", []):
            reasoning_steps.append({
                "type": step.get("type", "thought"),
                "content": step.get("content", ""),
                "timestamp": step.get("timestamp", datetime.now().isoformat())
            })
        
        # 處理工具使用
        tools_used = []
        for tool in result.get("tools_used", []):
            tools_used.append({
                "name": tool.get("name", "unknown_tool"),
                "result": tool.get("result", ""),
                "duration": tool.get("duration", 0)
            })
        
        execution_time = (datetime.now() - start_time).total_seconds()
        
        # 助手消息（包含完整的UI展示數據）
        assistant_message = {
            "id": str(uuid.uuid4()),
            "role": "assistant",
            "content": response_content,
            "timestamp": datetime.now().isoformat(),
            "mode": "agent",
            "model_used": model_name,
            "execution_time": result.get("execution_time", execution_time),
            "steps_taken": result.get("steps_taken", 0),
            "execution_trace": execution_trace,
            "reasoning_steps": reasoning_steps,
            "tools_used": tools_used,
            "generated_image": result.get("generated_image"),
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
        
        # 保存消息
        user_result = add_message_to_session(session_id, user_id, user_message, model_name)
        assistant_result = add_message_to_session(session_id, user_id, assistant_message, model_name)
        
        if user_result["success"] and assistant_result["success"]:
            logger.info(f"Agent消息已保存到會話: session_id={session_id}")
            
            # 為新會話生成智能標題
            session = get_chat_session(session_id, user_id)
            if session and session.get('message_count', 0) <= 2:
                smart_title = await generate_smart_title(prompt, response_content)
                update_session_title(session_id, user_id, smart_title)
                logger.info(f"已為Agent會話生成智能標題: {smart_title}")
        else:
            logger.error(f"保存Agent消息失敗: user={user_result}, assistant={assistant_result}")
            
    except Exception as e:
        logger.error(f"保存會話時發生錯誤: {str(e)}", exc_info=True)
