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
    create_chat_log
)

# 导入MCP客户端
try:
    from app.services.mcp_client import mcp_client
except ImportError:
    logger.warning("无法导入MCP客户端，MCP功能将不可用")
    mcp_client = None

settings = get_settings()

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
    Agent服务 - 管理智能代理的工作流程    包括：规划、执行、记忆、反思和响应生成
    
    升级为基于ReAct模式(Reasoning, Acting, Reflecting)的自主Agent架构
    """
    
    def __init__(self):
        # 基础配置
        self.max_steps = settings.AGENT_MAX_STEPS
        self.reflection_threshold = settings.AGENT_REFLECTION_THRESHOLD
        self.confidence_threshold = settings.AGENT_CONFIDENCE_THRESHOLD
        
        # 系统预设的计划模板
        self.planning_template = """
        你是一个智能Agent，需要逐步思考并解决问题。
        
        1. 首先分析用户的请求，确定这是一个什么样的任务
        2. 将任务分解成更小的子任务
        3. 按照优先级排序子任务
        4. 制定执行计划，明确每个步骤需要使用的工具
        
        请输出一个JSON格式的计划:
        {
          "taskAnalysis": "对任务的整体分析",
          "subtasks": [
            {
              "id": "子任务ID",
              "description": "子任务描述",
              "toolsNeeded": ["工具1", "工具2"],
              "priority": 优先级(1-5，1最高)
            }
          ],
          "executionOrder": ["子任务ID1", "子任务ID2", "子任务ID3"]
        }
        """
        
        # 系统提示的反思模板
        self.reflection_template = """
        请回顾你目前执行的步骤，特别关注以下几点:
        
        1. 是否有步骤执行失败？为什么？
        2. 有没有更有效的方法来解决当前问题？
        3. 是否需要调整计划？
        4. 信息是否足够完整？是否需要向用户询问更多信息？
        
        请输出一个JSON格式的反思:
        {
          "assessment": "整体评估",
          "failedSteps": ["步骤1", "步骤2"],
          "adjustments": ["调整1", "调整2"],
          "userInputNeeded": true/false,
          "userQuestion": "需要询问用户的问题(如果需要)"
        }
        """
        
        # ReAct系统提示模板        
        self.react_system_prompt = """
        你是一个先进的自主Agent，基于ReAct（推理、行动、观察）架构运作。你的目标是通过以下循环完成复杂任务：
        
        1. **思考(Thinking)**：分析当前情况、制定详细的子步骤计划
        2. **行动(Acting)**：使用可用工具完成具体子任务
        3. **观察(Observing)**：分析工具执行结果
        4. **反思(Reflecting)**：定期反思进度、调整计划
        
        与用户互动时，遵循以下原则：
        - 先理解任务全貌，再分解为清晰步骤
        - 只在需要时使用工具（不要创建不必要的步骤）
        - 在工具使用之间进行推理，形成连贯的解决方案
        - 失败后能自动尝试替代方案
        - 保持透明，清晰地解释你的推理过程
        
        工具使用的最佳实践：
        - 使用searchDuckDuckGo时，先浏览所有搜索结果摘要
        - 不要自动对每个搜索结果URL调用fetchWebpageContent
        - 仅当真正需要特定网页的详细内容时，才对1-2个最相关的URL使用fetchWebpageContent
        - 这种方法可以大大减少token消耗，提高效率
        
        你可以访问用户的短期和长期记忆，合理使用它们来维持上下文和记住用户偏好。
        """
        
        # MCP支持的系统提示模板        
        self.mcp_system_prompt = """
        你是一个支持Model Context Protocol (MCP)的智能代理。
        你可以理解用户的请求，分解成子任务，并利用工具来解决问题。
        请按照以下格式处理请求：

        1. 理解用户意图
        2. 计划执行步骤
        3. 按照计划逐步执行
        4. 必要时请求更多信息
        5. 提供清晰的回复
        
        工具使用的重要指导原则：
        - 使用searchDuckDuckGo搜索时，先审视搜索结果摘要以获取概览
        - 不要为每个搜索结果URL都调用fetchWebpageContent
        - 仅当特定任务需要深入理解网页内容时，才针对性地选择1-2个最相关的URL使用fetchWebpageContent
        - 这种有选择性的工具使用可以减少token消耗，提高处理效率
        
        你可以使用多种工具来完成任务，包括：搜索引擎、图像生成、代码执行等。
        """
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
        统一的Agent执行函数 - 支持所有Agent模式
        
        Args:
            user_id: 用户ID
            prompt: 用户输入的提示
            model_name: 使用的模型名称
            enable_memory: 是否启用记忆功能
            enable_reflection: 是否启用反思功能
            enable_mcp: 是否启用MCP协议
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
              # 根据配置选择运行模式
            if enable_mcp:
                return await self._run_mcp_mode(
                    messages=messages,
                    model_name=model_name,
                    user_id=user_id,
                    execution_trace=execution_trace,
                    start_time=start_time,
                    interaction_id=interaction_id,
                    max_steps=max_steps_limit,
                    tools_config={
                        "enable_search": enable_search,
                        "include_advanced_tools": include_advanced_tools
                    }
                )
            elif enable_react_mode:
                return await self._run_react_mode(
                    messages=messages,
                    model_name=model_name,
                    user_id=user_id,
                    enable_memory=enable_memory,
                    enable_reflection=enable_reflection,
                    execution_trace=execution_trace,
                    reasoning_steps=reasoning_steps,
                    start_time=start_time,
                    interaction_id=interaction_id,
                    max_steps=max_steps_limit,
                    tools_config={
                        "enable_search": enable_search,
                        "include_advanced_tools": include_advanced_tools
                    }
                )
            else:
                # 简单模式，不使用ReAct或MCP
                return await self._run_simple_mode(
                    messages=messages,
                    model_name=model_name,
                    user_id=user_id,
                    execution_trace=execution_trace,
                    start_time=start_time,
                    interaction_id=interaction_id,
                    tools_config={
                        "enable_search": enable_search,
                        "include_advanced_tools": include_advanced_tools
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
        if enable_mcp:
            return {
                "role": "system",                
                "content": self.mcp_system_prompt
            }
        elif enable_react_mode:
            return {
                "role": "system",
                "content": self.react_system_prompt
            }
        else:
            # 如果既不是MCP也不是ReAct模式，使用更简单的系统提示
            return {
                "role": "system",
                "content": "你是一个智能助手，能够理解用户的请求并给出清晰的回答。在需要时，你可以使用工具来完成任务。\n\n工具使用指南：\n- 使用searchDuckDuckGo搜索时，先分析搜索结果摘要获取基本信息\n- 不要对每个搜索结果都使用fetchWebpageContent\n- 仅当任务确实需要深入理解某个特定网页内容时，才对1-2个最相关的URL使用fetchWebpageContent\n- 这种有选择性的工具使用方式可以减少token使用量，提高效率"
            }

    async def _run_mcp_mode(
        self,
        messages: List[Dict[str, Any]],
        model_name: str,
        user_id: str,
        execution_trace: List[Dict[str, Any]],
        start_time: float,
        interaction_id: str,
        max_steps: int = None,
        tools_config: Dict[str, bool] = None
    ) -> Dict[str, Any]:
        """
        运行MCP模式 - 使用MCP协议执行Agent
        
        Args:
            messages: 消息历史
            model_name: 模型名称
            user_id: 用户ID
            execution_trace: 执行跟踪记录
            start_time: 开始时间戳
            interaction_id: 交互ID
            
        Returns:
            执行结果        """        
        # 初始化状态
        current_state = AgentState.PLANNING
        steps_taken = 0
        tool_results = []
          # 获取工具定义
        enable_search = True
        include_advanced_tools = True
        enable_mcp = True  # 默认启用MCP工具        
        if tools_config:
            enable_search = tools_config.get("enable_search", True)
            include_advanced_tools = tools_config.get("include_advanced_tools", True)
            enable_mcp = tools_config.get("enable_mcp", enable_mcp)
            
        # 检查MCP客户端是否可用（在应用启动时已初始化）
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
        
        # 开始执行
        execution_trace.append({
            "timestamp": datetime.now().isoformat(),
            "state": current_state.value,
            "action": "启动MCP模式"
        })
        
        # 发送初始请求
        response = await llm_service.send_llm_request(messages, model_name, tools)
        
        # 处理工具调用循环
        while "choices" in response and response["choices"] and "tool_calls" in response["choices"][0]["message"]:
            tool_calls = response["choices"][0]["message"]["tool_calls"]
            steps_taken += 1
            
            # 确保tool_calls不是None
            if tool_calls is None:
                logger.warning("工具调用为None，跳过处理")
                break
            
            # 记录工具调用
            execution_trace.append({
                "timestamp": datetime.now().isoformat(),
                "state": AgentState.EXECUTING.value,
                "action": f"执行工具调用 (步骤 {steps_taken})",
                "tool_calls": tool_calls
            })
            
            # 执行工具调用
            tool_results = await llm_service.handle_tool_call(tool_calls)
            
            # 记录工具结果
            execution_trace.append({
                "timestamp": datetime.now().isoformat(),
                "state": AgentState.OBSERVING.value,
                "action": f"工具调用结果 (步骤 {steps_taken})",
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
                  # 检查是否达到最大步骤数
            max_steps_limit = max_steps if max_steps is not None else self.max_steps
            if steps_taken >= max_steps_limit:
                execution_trace.append({
                    "timestamp": datetime.now().isoformat(),
                    "state": AgentState.REFLECTING.value,
                    "action": "达到最大步骤数，停止执行"
                })
                break
                
            # 再次请求模型来处理工具结果
            response = await llm_service.send_llm_request(messages, model_name, tools)
        
        # 最终响应
        end_time = time.time()
        execution_time = end_time - start_time
        
        execution_trace.append({
            "timestamp": datetime.now().isoformat(),
            "state": AgentState.RESPONDING.value,
            "action": "生成最终响应"
        })          # 创建聊天日志
        # 从消息历史中提取用户的原始提示和最终回复
        user_prompt = ""
        for message in messages:
            if message["role"] == "user":
                user_prompt = message["content"]
                break
                
        final_reply = response["choices"][0]["message"].get("content", "") if "choices" in response and response["choices"] else ""
        
        # 使用现有的create_chat_log函数
        await create_chat_log(user_id, model_name, user_prompt, final_reply, interaction_id)
        
        # 准备返回结果
        result = {
            "success": True,
            "interaction_id": interaction_id,
            "response": response,
            "execution_trace": execution_trace,
            "execution_time": execution_time,
            "steps_taken": steps_taken
        }
        
        # 只有当实际生成了图片时才包含图片数据
        if llm_service.last_generated_image is not None:
            result["generated_image"] = llm_service.last_generated_image
        
        return result
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
            
        Returns:
            执行结果
        """        # 初始化状态
        current_state = AgentState.PLANNING
        steps_taken = 0
        reflection_steps = 0
          # 获取工具定义
        enable_search = True
        include_advanced_tools = True
        enable_mcp = False # 只有在MCP模式下才启用MCP工具
        if tools_config:
            enable_search = tools_config.get("enable_search", True)
            include_advanced_tools = tools_config.get("include_advanced_tools", True)
            enable_mcp = tools_config.get("enable_mcp", enable_mcp)
            
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
            "content": "请分析任务并制定解决方案。在回答中，首先思考任务的性质，然后制定具体步骤，最后确定需要使用的工具。"
        }
        
        # 深拷贝messages以避免修改原始消息
        planning_messages = messages.copy()
        planning_messages.append(planning_message)
        
        # 发送规划请求
        planning_response = await llm_service.send_llm_request(planning_messages, model_name)
        
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
            
            # 发送请求，可能包含工具调用
            response = await llm_service.send_llm_request(messages, model_name, tools)
            
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
                        "content": "请反思目前的执行情况。评估进展、遇到的问题和可能的改进方向。确定是否需要调整计划或收集更多信息。"
                    }
                    messages.append(reflection_prompt)
                    
                    # 获取反思结果
                    reflection_response = await llm_service.send_llm_request(messages, model_name)
                    
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
                "content": "已达到最大执行步骤数。请总结目前的执行情况、已完成的任务和未完成的部分。"
            }
            messages.append(summary_prompt)
            
            # 获取总结响应
            final_response = await llm_service.send_llm_request(messages, model_name)
            
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
            
            # 使用memory_service的现有方法更新用户记忆
            await memory_service.update_memory(user_id, user_prompt)
        
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
                
        final_reply = final_response["choices"][0]["message"].get("content", "") if "choices" in final_response and final_response["choices"] else ""
        
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

    async def _create_plan(self, prompt: str, model_name: str) -> Dict[str, Any]:
        """
        创建任务执行计划
        
        Args:
            prompt: 用户提示
            model_name: 模型名称
            
        Returns:
            执行计划
        """
        # 确保在创建计划时重置生成的图片
        llm_service.last_generated_image = None
        
        # 构建规划消息
        planning_messages = [
            {
                "role": "system",
                "content": self.planning_template
            },
            {
                "role": "user",
                "content": f"用户请求: {prompt}\n\n请分析这个请求并制定执行计划。"
            }
        ]
        
        # 发送规划请求
        planning_response = await llm_service.send_llm_request(planning_messages, model_name)
        
        if "choices" in planning_response and planning_response["choices"]:
            plan_text = planning_response["choices"][0]["message"].get("content", "{}")
            
            # 尝试从响应中提取JSON计划
            try:
                # 查找JSON内容
                import re
                json_match = re.search(r'```json\s*([\s\S]*?)\s*```', plan_text)
                if json_match:
                    plan_json = json_match.group(1)
                else:
                    plan_json = plan_text
                
                # 解析JSON
                plan = json.loads(plan_json)
                return plan
            except Exception as e:
                logger.error(f"解析计划JSON失败: {str(e)}")
                # 返回一个基本结构
                return {
                    "taskAnalysis": "无法解析计划",
                    "subtasks": [
                        {
                            "id": "default",
                            "description": "执行用户请求",
                            "toolsNeeded": ["generateImage", "searchDuckDuckGo"],
                            "priority": 1
                        }
                    ],
                    "executionOrder": ["default"]
                }
        else:
            return {
                "taskAnalysis": "规划失败",
                "subtasks": [
                    {
                        "id": "default",
                        "description": "执行用户请求",
                        "toolsNeeded": ["generateImage", "searchDuckDuckGo"],
                        "priority": 1
                    }
                ],
                "executionOrder": ["default"]
            }    
    async def _run_simple_mode(
        self,
        messages: List[Dict[str, Any]],
        model_name: str,
        user_id: str,
        execution_trace: List[Dict[str, Any]],
        start_time: float,
        interaction_id: str,
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
        enable_mcp = False
        if tools_config:
            enable_search = tools_config.get("enable_search", True)
            include_advanced_tools = tools_config.get("include_advanced_tools", False)
            enable_mcp = tools_config.get("enable_mcp", enable_mcp)
            
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
        
        # 发送请求
        response = await llm_service.send_llm_request(messages, model_name, tools)
        
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
                    
                # 发送最终请求获取最终回答
                response = await llm_service.send_llm_request(messages, model_name, tools)
        
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
        
        # 准备返回结果
        result = {
            "success": True,
            "interaction_id": interaction_id,
            "response": response,
            "execution_trace": execution_trace,
            "execution_time": execution_time,
            "steps_taken": steps_taken
        }
        
        # 只有当实际生成了图片时才包含图片数据
        if llm_service.last_generated_image is not None:
            result["generated_image"] = llm_service.last_generated_image
        
        return result

# 创建单例实例
agent_service = AgentService()
