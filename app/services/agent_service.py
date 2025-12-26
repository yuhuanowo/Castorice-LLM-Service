"""
Agent Service - 自主智能代理服務
基於 ReAct (Reasoning, Acting, Observing) 架構的全流式智能代理

核心特點：
1. 完全流式輸出 - 每個思考步驟即時推送
2. 自主決策 - LLM 自主決定何時使用工具、何時反思、何時完成
3. 動態工具調用 - 支持 MCP 和內建工具的自動選擇
4. 智能記憶 - 長期記憶自動更新和檢索
"""

from typing import List, Dict, Any, Optional, AsyncGenerator, Callable
import asyncio
import json
import time
from datetime import datetime
from enum import Enum
import uuid

from app.utils.logger import logger
from app.core.config import get_settings
from app.services.llm_service import llm_service
from app.services.memory_service import memory_service
from app.utils.tools import generate_image, search_duckduckgo
from app.models.mongodb import (
    get_chat_logs, 
    update_user_memory, 
    get_user_memory,
    get_chat_by_interaction_id,
    create_chat_log,
    update_usage
)
from app.models.sqlite import update_usage_sqlite

# 導入MCP客戶端
try:
    from app.services.mcp_client import mcp_client
except ImportError:
    logger.warning("無法導入MCP客戶端，MCP功能將不可用")
    mcp_client = None

settings = get_settings()


class AgentState(Enum):
    """Agent狀態枚舉"""
    IDLE = "idle"              # 空閒狀態
    THINKING = "thinking"      # 思考中
    EXECUTING = "executing"    # 執行工具調用 
    OBSERVING = "observing"    # 觀察工具執行結果
    REFLECTING = "reflecting"  # 反思階段
    RESPONDING = "responding"  # 生成最終回覆
    ERROR = "error"            # 錯誤狀態
    DONE = "done"              # 完成狀態


class StreamEvent:
    """流式事件數據結構"""
    def __init__(
        self,
        status: str,
        message: str = "",
        details: Optional[Dict[str, Any]] = None,
        step: Optional[int] = None,
        tool_name: Optional[str] = None,
        tool_result: Optional[str] = None,
        reasoning: Optional[str] = None,
        is_final: bool = False
    ):
        self.status = status
        self.message = message
        self.details = details or {}
        self.step = step
        self.tool_name = tool_name
        self.tool_result = tool_result
        self.reasoning = reasoning
        self.is_final = is_final
        self.timestamp = datetime.now().isoformat()
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "message": self.message,
            "details": self.details,
            "step": self.step,
            "tool_name": self.tool_name,
            "tool_result": self.tool_result,
            "reasoning": self.reasoning,
            "is_final": self.is_final,
            "timestamp": self.timestamp
        }


# 記憶更新的後台任務函數
async def background_memory_update(user_id: str, prompt: str):
    """後台異步更新用戶記憶"""
    try:
        await memory_service.update_memory(user_id, prompt)
        logger.info(f"後台記憶更新任務已完成，用戶ID: {user_id}")
    except Exception as e:
        logger.error(f"後台記憶更新任務失敗，用戶ID: {user_id}, 錯誤: {str(e)}")


class AgentService:
    """
    自主智能代理服務
    
    基於 ReAct 架構的全流式智能代理，特點：
    - 完全由 LLM 自主決策執行流程
    - 支持工具調用的自動選擇和執行
    - 流式輸出每個思考步驟
    - 智能反思和自我糾正
    """
    
    def __init__(self):
        self.max_steps = settings.AGENT_MAX_STEPS
        self.reflection_threshold = settings.AGENT_REFLECTION_THRESHOLD
        self.confidence_threshold = settings.AGENT_CONFIDENCE_THRESHOLD
    
    def _get_system_prompt(self, enable_mcp: bool = True) -> Dict[str, str]:
        """
        獲取自主 Agent 的系統提示
        
        Args:
            enable_mcp: 是否啟用 MCP 協議
            
        Returns:
            系統提示字典
        """
        if enable_mcp:
            return {
                "role": "system",
                "content": settings.PROMPT_REACT_MCP_COMBINED
            }
        else:
            return {
                "role": "system",
                "content": settings.PROMPT_REACT_SYSTEM
            }
    
    async def _check_mcp_availability(self, enable_mcp: bool) -> bool:
        """檢查 MCP 客戶端是否可用"""
        if not enable_mcp:
            return False
            
        try:
            if mcp_client is None:
                return False
            available_tools = mcp_client.get_available_tools()
            if not available_tools:
                logger.warning("MCP已啟用但沒有可用工具")
                return False
            logger.debug(f"MCP客戶端可用，發現 {len(available_tools)} 個工具")
            return True
        except Exception as e:
            logger.warning(f"MCP客戶端不可用: {e}")
            return False
    
    async def _update_usage_stats(self, user_id: str, model_name: str):
        """更新用戶使用統計"""
        update_usage(user_id, model_name)
        current_date = datetime.now().strftime("%Y-%m-%d")
        update_usage_sqlite(user_id, model_name, current_date)
        logger.debug(f"已更新用戶 {user_id} 使用 {model_name} 的統計")
    
    async def _send_request_with_retry(
        self,
        messages: List[Dict[str, Any]],
        model_name: str,
        tools: Optional[List[Dict[str, Any]]] = None,
        on_step: Optional[Callable] = None,
        max_retries: int = 3
    ) -> Dict[str, Any]:
        """
        發送 LLM 請求，支持自動重試
        
        Args:
            messages: 消息列表
            model_name: 模型名稱
            tools: 工具定義
            on_step: 步驟回調函數
            max_retries: 最大重試次數
            
        Returns:
            LLM 響應
        """
        retry_count = 0
        while retry_count <= max_retries:
            try:
                response = await llm_service.send_llm_request(messages, model_name, tools)
                return response
            except Exception as e:
                err_str = str(e)
                if '429' in err_str or 'Rate limit' in err_str or 'Too Many Requests' in err_str:
                    retry_count += 1
                    wait_time = 60 * retry_count  # 遞增等待時間
                    logger.warning(f"速率限制，第{retry_count}次重試，等待{wait_time}秒: {err_str}")
                    
                    if on_step:
                        await on_step(StreamEvent(
                            status="waiting",
                            message=f"模型速率限制，等待{wait_time}秒後自動重試... (第{retry_count}次)",
                            details={"retry_count": retry_count, "wait_time": wait_time}
                        ).to_dict())
                    
                    await asyncio.sleep(wait_time)
                    continue
                else:
                    logger.error(f"LLM請求異常: {err_str}")
                    raise
        
        raise Exception(f"已達到最大重試次數 ({max_retries})")

    async def run(
        self, 
        user_id: str, 
        prompt: str, 
        model_name: str, 
        enable_memory: bool = True,
        enable_reflection: bool = True,
        enable_mcp: bool = True,
        enable_react_mode: bool = True,  # 保留參數以兼容舊API，但忽略此值
        max_steps: Optional[int] = None,
        system_prompt_override: Optional[Dict[str, str]] = None,
        additional_context: Optional[List[Dict[str, str]]] = None,
        tools_config: Optional[Dict[str, bool]] = None,
        image: Optional[str] = None,
        audio: Optional[str] = None,
        on_step: Optional[Callable] = None
    ) -> Dict[str, Any]:
        """
        執行自主 Agent - 統一的流式執行入口
        
        LLM 完全自主決定：
        - 是否需要使用工具
        - 使用哪個工具
        - 何時需要反思
        - 何時任務完成
        
        Args:
            user_id: 用戶ID
            prompt: 用戶輸入
            model_name: 模型名稱
            enable_memory: 是否啟用記憶
            enable_reflection: 是否啟用反思
            enable_mcp: 是否啟用MCP
            enable_react_mode: 已棄用，保留以兼容舊API
            max_steps: 最大步驟數
            system_prompt_override: 系統提示覆蓋
            additional_context: 額外上下文
            tools_config: 工具配置
            image: 圖片輸入
            audio: 音頻輸入
            on_step: 步驟回調函數（用於流式輸出）
            
        Returns:
            執行結果
        """
        # 重置狀態
        llm_service.last_generated_image = None
        
        # 生成交互ID
        interaction_id = str(uuid.uuid4())
        start_time = time.time()
        steps_taken = 0
        max_steps_limit = max_steps if max_steps is not None else self.max_steps
        
        # 執行追蹤
        execution_trace = []
        reasoning_steps = []
        tools_used = []
        
        # 處理工具配置
        enable_search = True
        include_advanced_tools = settings.AGENT_DEFAULT_ADVANCED_TOOLS
        if tools_config:
            enable_search = tools_config.get("enable_search", True)
            include_advanced_tools = tools_config.get("include_advanced_tools", settings.AGENT_DEFAULT_ADVANCED_TOOLS)
        
        try:
            # 發送初始化事件
            if on_step:
                await on_step(StreamEvent(
                    status="initializing",
                    message="正在初始化智能代理...",
                    details={"prompt": prompt, "model": model_name}
                ).to_dict())
            
            # 記錄初始化
            execution_trace.append({
                "timestamp": datetime.now().isoformat(),
                "state": AgentState.IDLE.value,
                "action": "初始化Agent",
                "context": {
                    "prompt": prompt,
                    "model": model_name,
                    "memory_enabled": enable_memory,
                    "mcp_enabled": enable_mcp
                }
            })
            
            # 檢查 MCP 可用性
            mcp_available = await self._check_mcp_availability(enable_mcp)
            if enable_mcp and not mcp_available:
                enable_mcp = False
                logger.info("MCP不可用，已禁用MCP功能")
            
            # 獲取記憶（如果啟用）
            memory_content = ""
            if enable_memory:
                memory = get_user_memory(user_id)
                if memory:
                    memory_content = memory
                    if on_step:
                        await on_step(StreamEvent(
                            status="memory",
                            message="已載入用戶記憶",
                            details={"memory_length": len(memory)}
                        ).to_dict())
            
            # 組裝初始消息
            system_prompt = system_prompt_override if system_prompt_override else self._get_system_prompt(enable_mcp)
            messages = [system_prompt]
            
            # 添加額外上下文
            if additional_context:
                messages.extend(additional_context)
            
            # 添加記憶內容
            if memory_content:
                messages.append({
                    "role": "system",
                    "content": f"用戶歷史記憶：\n{memory_content}"
                })
            
            # 添加用戶輸入
            user_message = await llm_service.format_user_message(
                prompt=prompt,
                image=image,
                audio=audio,
                model_name=model_name
            )
            messages.extend(user_message)
            
            # 獲取工具定義
            tools = llm_service.get_tool_definitions(
                enable_search=enable_search,
                include_advanced_tools=include_advanced_tools,
                enable_mcp=enable_mcp
            )
            
            # 發送思考開始事件
            if on_step:
                await on_step(StreamEvent(
                    status="thinking",
                    message="開始分析任務...",
                    step=0
                ).to_dict())
            
            # 主執行循環 - LLM 自主決策
            final_response = None
            
            while steps_taken < max_steps_limit:
                steps_taken += 1
                
                # 發送步驟開始事件
                if on_step:
                    await on_step(StreamEvent(
                        status="thinking",
                        message=f"第 {steps_taken} 步推理中...",
                        step=steps_taken
                    ).to_dict())
                
                # 更新使用統計
                await self._update_usage_stats(user_id, model_name)
                
                # 發送 LLM 請求
                response = await self._send_request_with_retry(
                    messages, model_name, tools, on_step
                )
                
                # 檢查響應是否有效
                if "error" in response:
                    logger.error(f"LLM響應錯誤: {response}")
                    execution_trace.append({
                        "timestamp": datetime.now().isoformat(),
                        "state": AgentState.ERROR.value,
                        "action": "LLM響應錯誤",
                        "error": response.get("error")
                    })
                    raise Exception(response.get("detail", response.get("error")))
                
                if "choices" not in response or not response["choices"]:
                    raise Exception("無效的LLM響應")
                
                choice = response["choices"][0]
                message = choice.get("message", {})
                content = message.get("content", "")
                tool_calls = message.get("tool_calls")
                finish_reason = choice.get("finish_reason", "")
                
                # 記錄思考內容
                if content:
                    reasoning_steps.append({
                        "type": "thought",
                        "title": f"思考 #{steps_taken}",
                        "content": content,
                        "timestamp": datetime.now().isoformat()
                    })
                    
                    if on_step:
                        await on_step(StreamEvent(
                            status="thinking",
                            message=content,
                            reasoning=content,
                            step=steps_taken
                        ).to_dict())
                
                # 檢查是否有工具調用
                if tool_calls and len(tool_calls) > 0:
                    # 記錄執行狀態
                    execution_trace.append({
                        "timestamp": datetime.now().isoformat(),
                        "state": AgentState.EXECUTING.value,
                        "action": f"執行工具調用 (步驟 {steps_taken})",
                        "tool_calls": tool_calls
                    })
                    
                    # 將助理回覆添加到消息歷史
                    messages.append({
                        "role": "assistant",
                        "content": content,
                        "tool_calls": tool_calls
                    })
                    
                    # 發送工具調用事件
                    for tc in tool_calls:
                        tool_name = tc.get("function", {}).get("name", "unknown")
                        tool_args = tc.get("function", {}).get("arguments", "{}")
                        
                        if on_step:
                            await on_step(StreamEvent(
                                status="executing",
                                message=f"正在執行工具: {tool_name}",
                                tool_name=tool_name,
                                details={"arguments": tool_args},
                                step=steps_taken
                            ).to_dict())
                    
                    # 執行工具調用（記錄執行時間）
                    tool_start_time = time.time()
                    tool_results = await llm_service.handle_tool_call(tool_calls)
                    tool_duration = int((time.time() - tool_start_time) * 1000)  # 轉換為毫秒
                    
                    # 記錄觀察結果
                    execution_trace.append({
                        "timestamp": datetime.now().isoformat(),
                        "state": AgentState.OBSERVING.value,
                        "action": f"觀察工具結果 (步驟 {steps_taken})",
                        "tool_results": tool_results,
                        "duration_ms": tool_duration
                    })
                    
                    # 將工具結果添加到消息歷史
                    for tool_result in tool_results:
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tool_result["tool_call_id"],
                            "name": tool_result["name"],
                            "content": tool_result["content"]
                        })
                        
                        # 記錄工具使用（添加 duration 字段）
                        tools_used.append({
                            "name": tool_result["name"],
                            "result": tool_result["content"][:500] if len(tool_result["content"]) > 500 else tool_result["content"],
                            "duration": tool_duration,  # 添加執行時間（毫秒）
                            "timestamp": datetime.now().isoformat()
                        })
                        
                        # 記錄行動步驟
                        reasoning_steps.append({
                            "type": "action",
                            "title": f"行動 #{steps_taken}: {tool_result['name']}",
                            "content": f"工具: {tool_result['name']}\n結果: {tool_result['content'][:300]}{'...' if len(tool_result['content']) > 300 else ''}",
                            "tool": tool_result["name"],
                            "result": tool_result["content"][:300] + ("..." if len(tool_result["content"]) > 300 else ""),
                            "timestamp": datetime.now().isoformat()
                        })
                        
                        if on_step:
                            await on_step(StreamEvent(
                                status="observing",
                                message=f"工具 {tool_result['name']} 執行完成",
                                tool_name=tool_result["name"],
                                tool_result=tool_result["content"][:500],
                                step=steps_taken
                            ).to_dict())
                    
                    # 檢查是否需要反思（每 N 步或遇到複雜情況）
                    if enable_reflection and steps_taken % self.reflection_threshold == 0:
                        await self._perform_reflection(
                            messages, model_name, steps_taken,
                            execution_trace, reasoning_steps, on_step
                        )
                    
                    # 繼續下一輪決策
                    continue
                
                else:
                    # 沒有工具調用，LLM 認為任務完成或直接回答
                    final_response = response
                    
                    # 將最終回覆添加到消息歷史
                    messages.append({
                        "role": "assistant",
                        "content": content
                    })
                    
                    execution_trace.append({
                        "timestamp": datetime.now().isoformat(),
                        "state": AgentState.RESPONDING.value,
                        "action": "生成最終響應"
                    })
                    
                    if on_step:
                        await on_step(StreamEvent(
                            status="responding",
                            message="正在生成最終回覆...",
                            step=steps_taken
                        ).to_dict())
                    
                    break
            
            # 如果達到最大步驟數，生成總結
            if steps_taken >= max_steps_limit and final_response is None:
                execution_trace.append({
                    "timestamp": datetime.now().isoformat(),
                    "state": AgentState.RESPONDING.value,
                    "action": "達到最大步驟數，生成總結響應"
                })
                
                if on_step:
                    await on_step(StreamEvent(
                        status="summarizing",
                        message="達到最大步驟數，正在生成總結...",
                        step=steps_taken
                    ).to_dict())
                
                # 添加總結提示
                summary_prompt = {
                    "role": "user",
                    "content": settings.PROMPT_SUMMARY_MESSAGE
                }
                messages.append(summary_prompt)
                
                await self._update_usage_stats(user_id, model_name)
                final_response = await self._send_request_with_retry(
                    messages, model_name, None, on_step
                )
            
            # 提取最終回覆
            final_content = ""
            if final_response and "choices" in final_response and final_response["choices"]:
                final_message = final_response["choices"][0].get("message", {})
                final_content = final_message.get("content", "")
                
                # 如果 content 為空，嘗試其他字段
                if not final_content:
                    final_content = final_message.get("reasoning", "")
            
            # 計算執行時間
            execution_time = time.time() - start_time
            
            # 發送完成事件 - 包含完整的響應數據
            if on_step:
                await on_step({
                    "status": "done",
                    "message": final_content,
                    "is_final": True,
                    "step": steps_taken,
                    "response": final_response or {"choices": [{"message": {"role": "assistant", "content": final_content}}]},
                    "execution_trace": execution_trace,
                    "reasoning_steps": reasoning_steps,
                    "tools_used": tools_used,
                    "execution_time": execution_time,
                    "steps_taken": steps_taken,
                    "success": True,
                    "generated_image": llm_service.last_generated_image
                })
            
            # 更新用戶記憶（後台）
            if enable_memory:
                asyncio.create_task(background_memory_update(user_id, prompt))
                logger.info(f"記憶更新任務已在後台啟動，用戶ID: {user_id}")
            
            # 保存聊天記錄
            await create_chat_log(user_id, model_name, prompt, final_content, interaction_id)
            
            return {
                "success": True,
                "interaction_id": interaction_id,
                "response": final_response or {"choices": [{"message": {"role": "assistant", "content": final_content}}]},
                "execution_trace": execution_trace,
                "reasoning_steps": reasoning_steps,
                "tools_used": tools_used,
                "execution_time": execution_time,
                "steps_taken": steps_taken,
                "generated_image": llm_service.last_generated_image
            }
            
        except Exception as e:
            execution_time = time.time() - start_time
            logger.error(f"Agent執行錯誤: {str(e)}", exc_info=True)
            
            execution_trace.append({
                "timestamp": datetime.now().isoformat(),
                "state": AgentState.ERROR.value,
                "action": f"執行錯誤: {str(e)}"
            })
            
            if on_step:
                await on_step(StreamEvent(
                    status="error",
                    message=str(e),
                    details={"error": True}
                ).to_dict())
            
            return {
                "success": False,
                "interaction_id": interaction_id,
                "response": {
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": f"很抱歉，處理請求時出錯: {str(e)}"
                        }
                    }]
                },
                "execution_trace": execution_trace,
                "reasoning_steps": reasoning_steps,
                "tools_used": tools_used,
                "execution_time": execution_time,
                "steps_taken": steps_taken,
                "generated_image": None
            }
    
    async def _perform_reflection(
        self,
        messages: List[Dict[str, Any]],
        model_name: str,
        steps_taken: int,
        execution_trace: List[Dict[str, Any]],
        reasoning_steps: List[Dict[str, Any]],
        on_step: Optional[Callable] = None
    ):
        """
        執行反思階段
        
        讓 LLM 回顧當前進度，評估是否需要調整策略
        """
        if on_step:
            await on_step(StreamEvent(
                status="reflecting",
                message="正在進行反思...",
                step=steps_taken
            ).to_dict())
        
        execution_trace.append({
            "timestamp": datetime.now().isoformat(),
            "state": AgentState.REFLECTING.value,
            "action": f"開始反思 (步驟 {steps_taken})"
        })
        
        # 添加反思提示
        reflection_prompt = {
            "role": "user",
            "content": settings.PROMPT_REFLECTION_MESSAGE
        }
        messages.append(reflection_prompt)
        
        try:
            reflection_response = await llm_service.send_llm_request(messages, model_name)
            
            if "choices" in reflection_response and reflection_response["choices"]:
                reflection = reflection_response["choices"][0]["message"].get("content", "")
                
                execution_trace.append({
                    "timestamp": datetime.now().isoformat(),
                    "state": AgentState.REFLECTING.value,
                    "action": "反思完成",
                    "reflection": reflection
                })
                
                reasoning_steps.append({
                    "type": "reflection",
                    "title": f"反思 (步驟 {steps_taken})",
                    "content": reflection,
                    "timestamp": datetime.now().isoformat()
                })
                
                # 將反思結果添加到消息歷史
                messages.append({
                    "role": "assistant",
                    "content": reflection
                })
                
                if on_step:
                    await on_step(StreamEvent(
                        status="reflecting",
                        message=reflection,
                        reasoning=reflection,
                        step=steps_taken
                    ).to_dict())
                    
        except Exception as e:
            logger.error(f"反思階段錯誤: {str(e)}")
            # 反思失敗不中斷主流程
    
    async def run_stream(
        self,
        user_id: str,
        prompt: str,
        model_name: str,
        enable_memory: bool = True,
        enable_reflection: bool = True,
        enable_mcp: bool = True,
        enable_react_mode: bool = True,  # 保留參數以兼容舊API
        max_steps: Optional[int] = None,
        system_prompt_override: Optional[Dict[str, str]] = None,
        additional_context: Optional[List[Dict[str, str]]] = None,
        tools_config: Optional[Dict[str, bool]] = None,
        image: Optional[str] = None,
        audio: Optional[str] = None,
        on_step: Optional[Callable] = None
    ) -> Dict[str, Any]:
        """
        流式執行 Agent - 與 run() 相同，但支持流式回調
        
        這是統一的執行入口，run() 方法現在也支持 on_step 回調
        
        Args:
            on_step: 異步回調函數，每個推理步驟都會調用
            其他參數同 run()
            
        Returns:
            執行結果
        """
        return await self.run(
            user_id=user_id,
            prompt=prompt,
            model_name=model_name,
            enable_memory=enable_memory,
            enable_reflection=enable_reflection,
            enable_mcp=enable_mcp,
            enable_react_mode=enable_react_mode,
            max_steps=max_steps,
            system_prompt_override=system_prompt_override,
            additional_context=additional_context,
            tools_config=tools_config,
            image=image,
            audio=audio,
            on_step=on_step
        )


# 創建 AgentService 的單例實例
agent_service = AgentService()
