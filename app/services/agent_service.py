from typing import List, Dict, Any, Optional, Union
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

# 导入MCP客户端
try:
    from app.services.mcp_client import mcp_client
except ImportError:
    logger.warning("无法导入MCP客户端，MCP功能将不可用")
    mcp_client = None

settings = get_settings()

# 记忆更新的后台任务函数
async def background_memory_update(user_id: str, prompt: str):
    try:
        await memory_service.update_memory(user_id, prompt)
        logger.info(f"后台记忆更新任务已完成，用户ID: {user_id}")
    except Exception as e:
        logger.error(f"后台记忆更新任务失败，用户ID: {user_id}, 错误: {str(e)}")

class AgentState(Enum):
    """Agent状态枚举"""
    IDLE = "idle"              # 空闲状态
    PLANNING = "planning"      # 规划中
    EXECUTING = "executing"    # 执行工具调用 
    OBSERVING = "observing"    # 观察工具执行结果
    REFLECTING = "reflecting"  # 反思阶段
    RESPONDING = "responding"  # 生成最终回复
    ERROR = "error"            # 错误状态


class AgentService:
    """
    Agent服务 - 管理智能代理的工作流程
    
    包括：规划、执行、记忆、反思和响应生成
    
    支持两种主要模式：
    1. ReAct模式 - 基于推理、行动、反思的自主Agent架构
    2. 简单模式 - 基础的工具调用模式
    
    每种模式都可以选择性启用MCP（Model Context Protocol）功能
    """
    def __init__(self):
        # 基础配置
        self.max_steps = settings.AGENT_MAX_STEPS
        self.reflection_threshold = settings.AGENT_REFLECTION_THRESHOLD
        self.confidence_threshold = settings.AGENT_CONFIDENCE_THRESHOLD
    async def run(
        self, 
        user_id: str, 
        prompt: str, 
        model_name: str, 
        enable_memory: bool = True,
        enable_reflection: bool = True,
        enable_mcp: bool = True,  # 默认启用MCP
        enable_react_mode: bool = True,
        max_steps: Optional[int] = None,
        system_prompt_override: Optional[Dict[str, str]] = None,
        additional_context: Optional[List[Dict[str, str]]] = None,
        tools_config: Optional[Dict[str, bool]] = None,
        image: Optional[str] = None,
        audio: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        统一的Agent执行函数
        
        支持两种主要模式：
        1. ReAct模式 (enable_react_mode=True) - 完整的推理、行动、反思循环
        2. 简单模式 (enable_react_mode=False) - 基础的工具调用模式
        
        每种模式都可以选择性启用MCP功能 (enable_mcp=True/False)
        
        Args:
            user_id: 用户ID
            prompt: 用户输入的提示
            model_name: 使用的模型名称
            enable_memory: 是否启用记忆功能
            enable_reflection: 是否启用反思功能 (仅在ReAct模式下有效)
            enable_mcp: 是否启用MCP协议功能
            enable_react_mode: 是否使用ReAct模式
            max_steps: 可选的最大步骤数
            system_prompt_override: 可选的系统提示覆盖
            additional_context: 附加上下文信息
            tools_config: 工具配置 {"enable_search": bool, "include_advanced_tools": bool}
            image: 可选的图片输入
            audio: 可选的音频输入
            
        Returns:
            Agent执行结果
        """
        # 确保在每次运行开始时重置生成的图片
        from app.services.llm_service import llm_service
        llm_service.last_generated_image = None
        
        # 生成交互ID
        interaction_id = str(uuid.uuid4())
          # 初始化状态跟踪
        start_time = time.time()
        current_state = AgentState.IDLE
        steps_taken = 0
        execution_trace = []
        tool_results = []
        reasoning_steps = []
        
        # 使用传入的最大步骤数或默认值
        max_steps_limit = max_steps if max_steps is not None else self.max_steps
        
        # 处理工具配置
        enable_search = True
        include_advanced_tools = settings.AGENT_DEFAULT_ADVANCED_TOOLS
        if tools_config:
            enable_search = tools_config.get("enable_search", True)
            include_advanced_tools = tools_config.get("include_advanced_tools", settings.AGENT_DEFAULT_ADVANCED_TOOLS)
        
        try:
            # 获取记忆（如果启用）            
            memory_content = ""            
            if enable_memory:
                memory =  get_user_memory(user_id)
                if memory:
                    memory_content = memory
              # 检查MCP客户端是否可用（在应用启动时已初始化）
            if enable_mcp:
                try:
                    available_tools = mcp_client.get_available_tools() 
                    if not available_tools:
                        logger.warning("MCP已启用但没有可用工具，可能需要重新启动应用")
                    else:
                        logger.debug(f"MCP客户端可用，发现 {len(available_tools)} 个工具")
                except Exception as e:
                    logger.warning(f"MCP客户端不可用: {e}")
                    enable_mcp = False  # 禁用MCP避免后续错误
            
            # 组装初始消息
            system_prompt = system_prompt_override if system_prompt_override else self._get_system_prompt(enable_mcp, enable_react_mode)
            messages = [
                system_prompt
            ]
            
            # 添加额外上下文（如果有）
            if additional_context:
                messages.extend(additional_context)
            
            # 添加记忆内容（如果有）
            if memory_content:
                messages.append({
                    "role": "system",
                    "content": memory_content
                })
                
            # 添加用户输入
            user_message = await llm_service.format_user_message(
                prompt=prompt,
                image=image,
                audio=audio,
                model_name=model_name
            )
            messages.extend(user_message)
            
            # 记录初始上下文
            execution_trace.append({
                "timestamp": datetime.now().isoformat(),
                "state": AgentState.IDLE.value,
                "action": "初始化Agent",
                "context": {
                    "prompt": prompt,
                    "model": model_name,
                    "memory_enabled": enable_memory,
                    "reflection_enabled": enable_reflection,
                    "mcp_enabled": enable_mcp
                }
            })

            # 简化模式选择逻辑 - 只基于是否使用ReAct来选择
            if enable_react_mode:
                return await self._run_react_mode(
                    messages=messages,
                    model_name=model_name,
                    user_id=user_id,
                    enable_memory=enable_memory,
                    enable_reflection=enable_reflection,
                    enable_mcp=enable_mcp,  # 将MCP作为参数传递
                    execution_trace=execution_trace,
                    reasoning_steps=reasoning_steps,
                    start_time=start_time,
                    interaction_id=interaction_id,
                    max_steps=max_steps_limit,
                    tools_config={
                        "enable_search": enable_search,
                        "include_advanced_tools": include_advanced_tools,
                        "enable_mcp": enable_mcp  # 确保MCP设置传递到工具配置
                    }
                )
            else:
                # 简单模式
                return await self._run_simple_mode(
                    messages=messages,
                    model_name=model_name,
                    user_id=user_id,
                    execution_trace=execution_trace,
                    start_time=start_time,
                    interaction_id=interaction_id,
                    enable_mcp=enable_mcp,  # 将MCP作为参数传递
                    tools_config={
                        "enable_search": enable_search,
                        "include_advanced_tools": include_advanced_tools,
                        "enable_mcp": enable_mcp  # 确保MCP设置传递到工具配置
                    }
                )
                
        except Exception as e:
            # 异常处理
            end_time = time.time()
            execution_time = end_time - start_time
            
            logger.error(f"Agent执行错误: {str(e)}", exc_info=True)
            
            # 记录错误状态
            execution_trace.append({
                "timestamp": datetime.now().isoformat(),
                "state": AgentState.ERROR.value,
                "action": f"执行错误: {str(e)}"
            })
            
            # 返回错误信息
            return {
                "success": False,
                "interaction_id": interaction_id,
                "response": {"error": str(e)},
                "execution_trace": execution_trace,
                "execution_time": execution_time,
                "steps_taken": steps_taken
            }    
    def _get_system_prompt(self, enable_mcp: bool, enable_react_mode: bool = True) -> Dict[str, str]:
        """
        获取系统提示 - 根据模式选择合适的系统提示
        
        Args:
            enable_mcp: 是否启用MCP协议
            enable_react_mode: 是否启用ReAct模式
            
        Returns:
            系统提示字典
        """
        if enable_react_mode:
            # ReAct模式
            if enable_mcp:
                # ReAct模式 + MCP功能
                return {
                    "role": "system",
                    "content": settings.PROMPT_REACT_MCP_COMBINED
                }
            else:
                # 纯ReAct模式
                return {
                    "role": "system",
                    "content": settings.PROMPT_REACT_SYSTEM
                }
        else:
            # 简单模式
            if enable_mcp:
                # 简单模式 + MCP功能
                return {
                    "role": "system",
                    "content": settings.PROMPT_MCP_SYSTEM
                }
            else:
                # 纯简单模式
                return {
                    "role": "system",
                    "content": settings.PROMPT_SIMPLE_SYSTEM
                }
            # 不再需要单独的MCP模式，MCP功能已集成到其他模式中

    # MARK: REACT MOD
    async def _run_react_mode(
        self,
        messages: List[Dict[str, Any]],
        model_name: str,
        user_id: str,
        enable_memory: bool,
        enable_reflection: bool,
        execution_trace: List[Dict[str, Any]],
        reasoning_steps: List[Dict[str, Any]],
        start_time: float,
        interaction_id: str,
        enable_mcp: bool = False,
        max_steps: int = None,
        tools_config: Dict[str, bool] = None
    ) -> Dict[str, Any]:
        """
        运行ReAct模式 - 使用ReAct架构执行Agent
        
        Args:
            messages: 消息历史
            model_name: 模型名称
            user_id: 用户ID
            enable_memory: 是否启用记忆
            enable_reflection: 是否启用反思
            execution_trace: 执行跟踪记录
            reasoning_steps: 推理步骤记录
            start_time: 开始时间戳
            interaction_id: 交互ID
            enable_mcp: 是否启用MCP功能
            max_steps: 最大步骤数
            tools_config: 工具配置
            
        Returns:
            执行结果
        """        
        # 初始化状态
        current_state = AgentState.PLANNING
        steps_taken = 0
        reflection_steps = 0
        
        # 获取工具定义
        enable_search = True
        include_advanced_tools = True
        if tools_config:
            enable_search = tools_config.get("enable_search", True)
            include_advanced_tools = tools_config.get("include_advanced_tools", True)
            
        # 检查MCP客户端是否可用（如果启用）
        if enable_mcp:
            try:
                available_tools = mcp_client.get_available_tools()
                if not available_tools:
                    logger.warning("ReAct模式：MCP已启用但没有可用工具")
                    enable_mcp = False  # 禁用MCP避免后续错误
                else:
                    logger.debug(f"ReAct模式：MCP客户端可用，发现 {len(available_tools)} 个工具")
            except Exception as e:
                logger.warning(f"ReAct模式：MCP客户端不可用: {e}")
                enable_mcp = False  # 禁用MCP避免后续错误
            
        tools = llm_service.get_tool_definitions(
            enable_search=enable_search, 
            include_advanced_tools=include_advanced_tools,
            enable_mcp=enable_mcp
        )
        
        # 1. 开始规划 - ReAct 模式下的规划更加简洁
        execution_trace.append({
            "timestamp": datetime.now().isoformat(),
            "state": current_state.value,
            "action": "开始规划任务"
        })
          # ReAct模式规划提示词
        planning_message = {
            "role": "user",
            "content": settings.PROMPT_PLANNING_MESSAGE
        }

        # 深拷贝messages以避免修改原始消息
        planning_messages = messages.copy()
        planning_messages.append(planning_message)
        
        try:
            # 更新使用统计
            await self._update_usage_stats(user_id, model_name)
            
            # 发送规划请求
            planning_response = await llm_service.send_llm_request(planning_messages, model_name)
        except Exception as e:
            logger.error(f"规划阶段错误: {str(e)}")
            execution_trace.append({
                "timestamp": datetime.now().isoformat(),
                "state": AgentState.ERROR.value,
                "action": "规划错误",
                "error": str(e)
            })
            
            # 提前返回错误结果
            end_time = time.time()
            execution_time = end_time - start_time
            
            return {
                "success": False,
                "interaction_id": interaction_id,
                "response": {
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": f"很抱歉，处理请求时出错: {str(e)}"
                        }
                    }]
                },
                "execution_trace": execution_trace,
                "reasoning_steps": reasoning_steps,
                "execution_time": execution_time,
                "steps_taken": steps_taken
            }
        
        if "choices" in planning_response and planning_response["choices"]:
            plan = planning_response["choices"][0]["message"]["content"]
            
            # 记录规划结果
            execution_trace.append({
                "timestamp": datetime.now().isoformat(),
                "state": current_state.value,
                "action": "规划完成",
                "plan": plan
            })
            
            reasoning_steps.append({
                "title": "任务规划",
                "content": plan
            })
            
            # 添加规划到消息历史
            messages.append({
                "role": "assistant",
                "content": plan
            })
        
        # 2. 执行循环 - ReAct思考、行动、观察循环
        current_state = AgentState.EXECUTING
        execution_trace.append({
            "timestamp": datetime.now().isoformat(),
            "state": current_state.value,
            "action": "开始执行任务"
        })        

        # 主执行循环
        while steps_taken < self.max_steps:
            steps_taken += 1
            
            try:
                # 更新使用统计
                await self._update_usage_stats(user_id, model_name)
                
                # 发送请求，可能包含工具调用
                response = await llm_service.send_llm_request(messages, model_name, tools)
            except Exception as e:
                logger.error(f"执行循环错误: {str(e)}")
                execution_trace.append({
                    "timestamp": datetime.now().isoformat(),
                    "state": AgentState.ERROR.value,
                    "action": "执行错误",
                    "error": str(e)
                })
                
                # 提前退出循环
                current_state = AgentState.ERROR
                break
            
            # 检查是否有工具调用
            if "choices" in response and response["choices"] and "tool_calls" in response["choices"][0]["message"]:
                tool_calls = response["choices"][0]["message"]["tool_calls"]
                
                # 确保tool_calls不是None
                if tool_calls is None:
                    logger.warning("工具调用为None，跳过处理")
                    continue
                
                # 记录工具调用
                execution_trace.append({
                    "timestamp": datetime.now().isoformat(),
                    "state": AgentState.EXECUTING.value,
                    "action": f"执行工具调用 (步骤 {steps_taken})",
                    "tool_calls": tool_calls
                })
                
                # 将助理回复添加到消息历史
                messages.append({
                    "role": "assistant",
                    "content": response["choices"][0]["message"].get("content", ""),
                    "tool_calls": tool_calls
                })
                
                reasoning_steps.append({
                    "title": f"思考 #{steps_taken}",
                    "content": response["choices"][0]["message"].get("content", "")
                })
                
                # 执行工具调用
                tool_results = await llm_service.handle_tool_call(tool_calls)
                
                # 记录工具结果
                execution_trace.append({
                    "timestamp": datetime.now().isoformat(),
                    "state": AgentState.OBSERVING.value,
                    "action": f"观察工具结果 (步骤 {steps_taken})",
                    "tool_results": tool_results
                })
                
                # 将工具结果添加到消息历史
                for tool_result in tool_results:
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_result["tool_call_id"],
                        "name": tool_result["name"],
                        "content": tool_result["content"]
                    })
                    
                    # 记录工具使用日志
                    tool_name = tool_result["name"]
                    tool_args = tool_calls[0]["function"]["arguments"]
                    tool_response = tool_result["content"]
                    
                    reasoning_steps.append({
                        "title": f"行动 #{steps_taken}: {tool_name}",
                        "tool": tool_name,
                        "args": tool_args,
                        "result": tool_response[:200] + ("..." if len(tool_response) > 200 else "")
                    })
                
                # 是否需要反思
                if enable_reflection and steps_taken % self.reflection_threshold == 0:
                    reflection_steps += 1
                    
                    # 切换到反思状态
                    current_state = AgentState.REFLECTING
                    
                    # 记录反思开始
                    execution_trace.append({
                        "timestamp": datetime.now().isoformat(),
                        "state": current_state.value,
                        "action": f"开始反思 #{reflection_steps}"
                    })
                      # 添加反思提示
                    reflection_prompt = {
                        "role": "user",
                        "content": settings.PROMPT_REFLECTION_MESSAGE
                    }
                    messages.append(reflection_prompt)

                    try:
                        # 更新使用统计
                        await self._update_usage_stats(user_id, model_name)
                        
                        # 获取反思结果
                        reflection_response = await llm_service.send_llm_request(messages, model_name)
                    except Exception as e:
                        logger.error(f"反思阶段错误: {str(e)}")
                        execution_trace.append({
                            "timestamp": datetime.now().isoformat(),
                            "state": AgentState.ERROR.value,
                            "action": "反思错误",
                            "error": str(e)
                        })
                        
                        # 继续执行，不中断整个流程
                        reflection_content = f"反思过程出错: {str(e)}"
                        continue
                    
                    if "choices" in reflection_response and reflection_response["choices"]:
                        reflection = reflection_response["choices"][0]["message"]["content"]
                        
                        # 记录反思结果
                        execution_trace.append({
                            "timestamp": datetime.now().isoformat(),
                            "state": current_state.value,
                            "action": f"反思完成 #{reflection_steps}",
                            "reflection": reflection
                        })
                        
                        reasoning_steps.append({
                            "title": f"反思 #{reflection_steps}",
                            "content": reflection
                        })
                        
                        # 添加反思到消息历史
                        messages.append({
                            "role": "assistant",
                            "content": reflection
                        })
                    
                    # 返回执行状态
                    current_state = AgentState.EXECUTING
            else:
                # 没有工具调用，说明Agent认为任务已完成或无需工具
                execution_trace.append({
                    "timestamp": datetime.now().isoformat(),
                    "state": AgentState.RESPONDING.value,
                    "action": "生成最终响应"
                })
                
                # 添加最终响应到消息历史
                if "choices" in response and response["choices"]:
                    messages.append({
                        "role": "assistant",
                        "content": response["choices"][0]["message"].get("content", "")
                    })
                
                break  # 结束执行循环
        
        # 3. 生成最终响应
        # 如果达到最大步骤数但任务未完成，生成一个总结响应
        if steps_taken >= self.max_steps:
            execution_trace.append({
                "timestamp": datetime.now().isoformat(),
                "state": AgentState.RESPONDING.value,
                "action": "达到最大步骤数，生成总结响应"
            })
              # 添加总结提示
            summary_prompt = {
                "role": "user",
                "content": settings.PROMPT_SUMMARY_MESSAGE
            }
            messages.append(summary_prompt)
            
            try:
                # 更新使用统计
                await self._update_usage_stats(user_id, model_name)
                
                # 获取总结响应
                final_response = await llm_service.send_llm_request(messages, model_name)
            except Exception as e:
                logger.error(f"总结阶段错误: {str(e)}")
                execution_trace.append({
                    "timestamp": datetime.now().isoformat(),
                    "state": AgentState.ERROR.value,
                    "action": "总结错误",
                    "error": str(e)
                })
                
                # 返回错误结果
                end_time = time.time()
                execution_time = end_time - start_time
                
                return {
                    "success": False,
                    "interaction_id": interaction_id,
                    "response": {
                        "choices": [{
                            "message": {
                                "role": "assistant",
                                "content": f"很抱歉，生成总结时出错: {str(e)}"
                            }
                        }]
                    },
                    "execution_trace": execution_trace,
                    "reasoning_steps": reasoning_steps,
                    "execution_time": execution_time,
                    "steps_taken": steps_taken
                }
            
            if "choices" in final_response and final_response["choices"]:
                # 添加总结到消息历史
                messages.append({
                    "role": "assistant",
                    "content": final_response["choices"][0]["message"].get("content", "")
                })
        else:
            # 使用之前的最终响应
            final_response = response          
        # 4. 更新用户记忆（如果启用）
        if enable_memory:
            execution_trace.append({
                "timestamp": datetime.now().isoformat(),
                "state": current_state.value,
                "action": "更新用户记忆"
            })
            
            # 从消息历史中获取用户输入的原始提示
            user_prompt = ""
            for message in messages:
                if message["role"] == "user":
                    user_prompt = message["content"]
                    break
            
            # 在后台异步更新用户长期记忆
            asyncio.create_task(background_memory_update(user_id, user_prompt))
            logger.info(f"记忆更新任务已在后台启动，用户ID: {user_id}")
        
        # 5. 完成执行
        end_time = time.time()
        execution_time = end_time - start_time
        # 创建聊天日志
        # 提取用户的提示和最终回复
        user_prompt = ""
        for message in messages:
            if message["role"] == "user":
                user_prompt = message["content"]
                break
                
        # 提取最终回复，优先使用content，如果为空则尝试reasoning字段
        final_reply = ""
        if "choices" in final_response and final_response["choices"]:
            choice = final_response["choices"][0]
            message = choice.get("message", {})
            final_reply = message.get("content", "")
            
            # 如果content为空，尝试使用reasoning字段
            if not final_reply and message.get("reasoning"):
                final_reply = message["reasoning"]
                logger.info("使用推理模型的reasoning字段作为最终回复")
            
            # 如果仍为空，但有reasoning_steps，使用最后一个思考步骤
            if not final_reply and reasoning_steps:
                for step in reversed(reasoning_steps):
                    if step.get("type") == "thought" and step.get("content"):
                        final_reply = step["content"]
                        logger.info("使用推理步骤中的思考内容作为最终回复")
                        break
            
            # 更新响应中的content以确保一致性
            if final_reply and not message.get("content"):
                final_response["choices"][0]["message"]["content"] = final_reply
                logger.info("已更新响应中的content字段")
        
        # 使用现有的create_chat_log函数
        await create_chat_log(user_id, model_name, user_prompt, final_reply, interaction_id)
        
        return {
            "success": True,
            "interaction_id": interaction_id,
            "response": final_response,
            "execution_trace": execution_trace,
            "reasoning_steps": reasoning_steps,
            "execution_time": execution_time,
            "steps_taken": steps_taken,
            "generated_image": llm_service.last_generated_image
        }

    # MARK: SIMPLE MODE   
    async def _run_simple_mode(
        self,
        messages: List[Dict[str, Any]],
        model_name: str,
        user_id: str,
        execution_trace: List[Dict[str, Any]],
        start_time: float,
        interaction_id: str,
        enable_mcp: bool = False,
        tools_config: Dict[str, bool] = None
    ) -> Dict[str, Any]:
        """
        运行简单模式 - 基础的工具调用模式，不使用ReAct架构
        
        Args:
            messages: 消息历史
            model_name: 模型名称
            user_id: 用户ID
            execution_trace: 执行跟踪记录
            start_time: 开始时间戳
            interaction_id: 交互ID
            enable_mcp: 是否启用MCP功能
            tools_config: 工具配置
            
        Returns:
            执行结果
        """
        # 初始化状态
        current_state = AgentState.EXECUTING
        steps_taken = 0
        
        # 获取工具定义
        enable_search = True
        include_advanced_tools = False
        if tools_config:
            enable_search = tools_config.get("enable_search", True)
            include_advanced_tools = tools_config.get("include_advanced_tools", False)
            
        # 检查MCP客户端是否可用（如果启用）
        if enable_mcp:
            try:
                available_tools = mcp_client.get_available_tools()
                if not available_tools:
                    logger.warning("简单模式：MCP已启用但没有可用工具")
                    enable_mcp = False  # 禁用MCP避免后续错误
                else:
                    logger.debug(f"简单模式：MCP客户端可用，发现 {len(available_tools)} 个工具")
            except Exception as e:
                logger.warning(f"简单模式：MCP客户端不可用: {e}")
                enable_mcp = False  # 禁用MCP避免后续错误
            
        tools = llm_service.get_tool_definitions(
            enable_search=enable_search, 
            include_advanced_tools=include_advanced_tools,
            enable_mcp=enable_mcp
        )        

        # 记录开始执行
        execution_trace.append({
            "timestamp": datetime.now().isoformat(),
            "state": current_state.value,
            "action": "开始简单模式执行"
        })
        
        try:
            # 更新使用统计
            await self._update_usage_stats(user_id, model_name)
            
            # 发送请求
            response = await llm_service.send_llm_request(messages, model_name, tools)
        except Exception as e:
            logger.error(f"简单模式执行错误: {str(e)}")
            execution_trace.append({
                "timestamp": datetime.now().isoformat(),
                "state": AgentState.ERROR.value,
                "action": "执行错误",
                "error": str(e)
            })
            
            # 提前返回错误结果
            end_time = time.time()
            execution_time = end_time - start_time
            
            return {
                "success": False,
                "interaction_id": interaction_id,
                "response": {
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": f"很抱歉，处理请求时出错: {str(e)}"
                        }
                    }]
                },
                "execution_trace": execution_trace,
                "execution_time": execution_time,
                "steps_taken": steps_taken
            }
        
        # 如果有工具调用，处理一次工具调用循环
        if "choices" in response and response["choices"] and "tool_calls" in response["choices"][0]["message"]:
            tool_calls = response["choices"][0]["message"]["tool_calls"]
            steps_taken += 1
            
            # 确保tool_calls不是None
            if tool_calls is None:
                logger.warning("工具调用为None，跳过处理")
            else:
                # 记录工具调用
                execution_trace.append({
                    "timestamp": datetime.now().isoformat(),
                    "state": AgentState.EXECUTING.value,
                    "action": "执行工具调用",
                    "tool_calls": tool_calls
                })
                
                # 执行工具调用
                tool_results = await llm_service.handle_tool_call(tool_calls)
                
                # 记录工具结果
                execution_trace.append({
                    "timestamp": datetime.now().isoformat(),
                    "state": AgentState.OBSERVING.value,
                    "action": "工具调用结果",
                    "tool_results": tool_results
                })
                
                # 将工具调用结果添加到消息历史
                messages.append({
                    "role": "assistant",
                    "content": response["choices"][0]["message"].get("content", ""),
                    "tool_calls": tool_calls
                })
                
                for tool_result in tool_results:
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_result["tool_call_id"],
                        "name": tool_result["name"],
                        "content": tool_result["content"]                    
                        })                    
                try:
                    # 更新使用统计
                    await self._update_usage_stats(user_id, model_name)
                    
                    # 发送最终请求获取最终回答
                    response = await llm_service.send_llm_request(messages, model_name, tools)
                except Exception as e:
                    logger.error(f"简单模式最终请求错误: {str(e)}")
                    execution_trace.append({
                        "timestamp": datetime.now().isoformat(),
                        "state": AgentState.ERROR.value,
                        "action": "最终请求错误",
                        "error": str(e)
                    })
                    
                    # 返回错误结果
                    end_time = time.time()
                    execution_time = end_time - start_time
                    
                    return {
                        "success": False,
                        "interaction_id": interaction_id,
                        "response": {
                            "choices": [{
                                "message": {
                                    "role": "assistant",
                                    "content": f"很抱歉，生成最终回答时出错: {str(e)}"
                                }
                            }]
                        },
                        "execution_trace": execution_trace,
                        "execution_time": execution_time,
                        "steps_taken": steps_taken
                    }
        
        # 最终响应
        end_time = time.time()
        execution_time = end_time - start_time
        
        execution_trace.append({
            "timestamp": datetime.now().isoformat(),
            "state": AgentState.RESPONDING.value,
            "action": "生成最终响应"
        })        
        # 提取用户的提示和最终回复
        user_prompt = messages[1]["content"] if len(messages) > 1 else ""
        final_reply = response["choices"][0]["message"].get("content", "") if "choices" in response and response["choices"] else ""
        
        # 使用现有的create_chat_log函数保存聊天记录
        await create_chat_log(user_id, model_name, user_prompt, final_reply, interaction_id)
        
        # 在后台异步更新用户长期记忆
        asyncio.create_task(background_memory_update(user_id, user_prompt))
        logger.info(f"记忆更新任务已在后台启动，用户ID: {user_id}")
        
        # 准备返回结果
        return {
            "success": True,
            "interaction_id": interaction_id,
            "response": response,
            "execution_trace": execution_trace,
            "execution_time": execution_time,
            "steps_taken": steps_taken,
            "generated_image": llm_service.last_generated_image
        }
        
    async def _update_usage_stats(self, user_id: str, model_name: str):
        """
        更新用户使用统计并检查是否超过限制
        
        Args:
            user_id: 用户ID
            model_name: 模型名称
            
        Raises:
            Exception: 如果使用量超过限制
        """
        # 更新MongoDB使用统计
        update_usage(user_id, model_name)
        
        # 更新SQLite使用统计
        current_date = datetime.now().strftime("%Y-%m-%d")
        update_usage_sqlite(user_id, model_name, current_date)
        
        # 记录日志
        logger.info(f"已更新用户 {user_id} 使用 {model_name} 的统计")
        
        # 从LLM服务获取使用限制信息
        try:
            # 获取JSON文件中的使用量信息
            with open(llm_service.usage_path, "r") as f:
                user_usage = json.load(f)
                
            current_date = datetime.now().strftime("%Y-%m-%d")
            
            # 获取用户的当前使用量
            usage_count = 0
            if user_id in user_usage and model_name in user_usage[user_id]:
                usage_count = user_usage[user_id][model_name]
                
            # 获取模型的使用限制
            limit = settings.MODEL_USAGE_LIMITS.get(model_name, 0)
            
            # 如果超过限制，则抛出异常
            if usage_count > limit:
                raise Exception(f"今日模型 {model_name} 使用量已达上限 ({limit})")
                
        except Exception as e:
            logger.error(f"检查使用量错误: {str(e)}")
            raise Exception(f"使用量检查失败: {str(e)}")

    async def run_stream(
        self,
        user_id: str,
        prompt: str,
        model_name: str,
        enable_memory: bool = True,
        enable_reflection: bool = True,
        enable_mcp: bool = True,
        enable_react_mode: bool = True,
        max_steps: Optional[int] = None,
        system_prompt_override: Optional[Dict[str, str]] = None,
        additional_context: Optional[List[Dict[str, str]]] = None,
        tools_config: Optional[Dict[str, bool]] = None,
        image: Optional[str] = None,
        audio: Optional[str] = None,
        on_step=None
    ) -> Dict[str, Any]:
        """
        與 run 相同，但每個推理步驟都會調用 on_step callback（async function），用於流式SSE等場景。
        """
        from app.services.llm_service import llm_service
        llm_service.last_generated_image = None
        interaction_id = str(uuid.uuid4())
        start_time = time.time()
        steps_taken = 0
        max_steps_limit = max_steps if max_steps is not None else self.max_steps
        enable_search = True
        include_advanced_tools = settings.AGENT_DEFAULT_ADVANCED_TOOLS
        if tools_config:
            enable_search = tools_config.get("enable_search", True)
            include_advanced_tools = tools_config.get("include_advanced_tools", settings.AGENT_DEFAULT_ADVANCED_TOOLS)
        try:
            # 初始化消息
            memory_content = ""
            if enable_memory:
                memory = get_user_memory(user_id)
                if memory:
                    memory_content = memory
            system_prompt = system_prompt_override if system_prompt_override else self._get_system_prompt(enable_mcp, enable_react_mode)
            messages = [system_prompt]
            if additional_context:
                messages.extend(additional_context)
            if memory_content:
                messages.append({"role": "system", "content": memory_content})
            user_message = await llm_service.format_user_message(
                prompt=prompt,
                image=image,
                audio=audio,
                model_name=model_name
            )
            messages.extend(user_message)
            # 推送初始化狀態
            if on_step:
                await on_step({"status": "thinking", "message": "初始化Agent...", "details": {"prompt": prompt}})
            if enable_react_mode:
                # 1. 规划阶段
                await self._stream_planning_phase(messages, user_id, model_name, on_step)
                # 2. 执行循环
                result = await self._stream_execution_loop(
                    messages, user_id, model_name, max_steps_limit, enable_search, include_advanced_tools, enable_mcp, on_step
                )
                # 3. 最终回复
                await self._update_usage_stats(user_id, model_name)
                final_response = await llm_service.send_llm_request(messages, model_name)
                final_content = final_response["choices"][0]["message"].get("content", "") if "choices" in final_response and final_response["choices"] else ""
                if on_step:
                    await on_step({"status": "done", "message": final_content})
                await create_chat_log(user_id, model_name, prompt, final_content, interaction_id)
                asyncio.create_task(background_memory_update(user_id, prompt))
                execution_time = time.time() - start_time
                return {
                    "success": True,
                    "interaction_id": interaction_id,
                    "response": final_response,
                    "execution_trace": [],
                    "execution_time": execution_time,
                    "steps_taken": result["steps_taken"],
                    "generated_image": llm_service.last_generated_image
                }
            else:
                # 简单模式暂不支持流式
                result = await self.run(
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
                    audio=audio
                )
                if on_step:
                    await on_step({"status": "done", "message": result["response"]["choices"][0]["message"]["content"] if "choices" in result["response"] else "Agent已完成推理"})
                return result
        except Exception as e:
            if on_step:
                await on_step({"status": "error", "message": str(e)})
            raise

    async def _stream_planning_phase(self, messages, user_id, model_name, on_step):
        """推理流式规划阶段"""
        if on_step:
            await on_step({"status": "planning", "message": "開始規劃..."})
        planning_message = {"role": "user", "content": settings.PROMPT_PLANNING_MESSAGE}
        planning_messages = messages.copy()
        planning_messages.append(planning_message)
        await self._update_usage_stats(user_id, model_name)
        planning_response = await llm_service.send_llm_request(planning_messages, model_name)
        plan = planning_response["choices"][0]["message"].get("content", "") if "choices" in planning_response and planning_response["choices"] else ""
        if on_step:
            await on_step({"status": "planning", "message": plan, "plan": plan})
        messages.append({"role": "assistant", "content": plan})

    async def _stream_execution_loop(self, messages, user_id, model_name, max_steps_limit, enable_search, include_advanced_tools, enable_mcp, on_step):
        """推理流式执行循环，含429重试"""
        steps_taken = 0
        for i in range(max_steps_limit):
            steps_taken += 1
            if on_step:
                await on_step({"status": "executing", "message": f"第{i+1}步執行..."})
            await self._update_usage_stats(user_id, model_name)
            retry_count = 0
            while True:
                try:
                    response = await llm_service.send_llm_request(
                        messages, model_name, llm_service.get_tool_definitions(enable_search, include_advanced_tools, enable_mcp)
                    )
                    break
                except Exception as e:
                    err_str = str(e)
                    if '429' in err_str or 'Rate limit' in err_str or 'Too Many Requests' in err_str:
                        logger.warning(f"429速率限制，第{retry_count+1}次重试: {err_str}")
                        if on_step:
                            await on_step({
                                "status": "error",
                                "message": f"模型速率限制，等待60秒后自动重试... (第{retry_count+1}次)",
                                "details": {"error": True, "raw": err_str, "retry_in": 60, "retry_count": retry_count+1}
                            })
                        await asyncio.sleep(60)
                        retry_count += 1
                        continue
                    else:
                        logger.error(f"LLM请求异常: {err_str}")
                        if on_step:
                            await on_step({
                                "status": "error",
                                "message": f"LLM请求异常: {err_str}",
                                "details": {"error": True, "raw": err_str}
                            })
                        raise
            content = response["choices"][0]["message"].get("content", "") if "choices" in response and response["choices"] else ""
            if on_step:
                await on_step({"status": "thinking", "message": content})
            tool_calls = response["choices"][0]["message"].get("tool_calls") if "choices" in response and response["choices"] else None
            if tool_calls:
                if on_step:
                    await on_step({"status": "executing", "message": f"工具調用: {tool_calls}"})
                tool_results = await llm_service.handle_tool_call(tool_calls)
                if on_step:
                    await on_step({"status": "executing", "message": f"工具結果: {tool_results}"})
                messages.append({"role": "tool", "content": str(tool_results)})
            if "stop" in response.get("choices", [{}])[0].get("finish_reason", ""):
                break
        return {"steps_taken": steps_taken}

# 创建AgentService的单例实例
agent_service = AgentService()
