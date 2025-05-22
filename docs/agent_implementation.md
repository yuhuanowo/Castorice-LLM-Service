# AI Agent 实现指南

本文档提供了如何将FastAPI API服务器扩展为完整AI Agent系统的详细指南。

## 什么是AI Agent？

AI Agent（人工智能代理）是一个自主系统，它能够：
1. 接收用户的任务或问题
2. 分析并规划解决方案
3. 使用各种工具执行操作
4. 观察结果并调整行动
5. 最终返回满足用户需求的回答

与普通的LLM API不同，AI Agent具有反思、规划和执行多步骤操作的能力，可以像人类一样处理复杂任务。

## 架构设计

### 核心组件

1. **Agent服务层**：协调整个Agent的运行流程
2. **工具系统**：提供Agent可用的各种功能
3. **记忆系统**：短期和长期记忆存储和检索
4. **LLM推理**：使用大型语言模型进行思考和决策
5. **规划器**：分解复杂任务为可执行步骤

### 数据流程

```
用户请求 → 记忆检索 → 任务规划 → 工具选择与执行 → 结果观察 → 下一步动作决策 → 最终回答
```

## 实现步骤

### 1. 增强工具系统

实现更丰富的工具集，让Agent能够执行多样化的操作。

#### 1.1 工具注册系统

创建 `app/utils/tool_registry.py`：

```python
from typing import Dict, Callable, Any, List
import inspect
import asyncio

class ToolRegistry:
    """工具注册系统，管理所有可用工具"""
    
    def __init__(self):
        self._tools: Dict[str, Callable] = {}
        self._tool_descriptions: Dict[str, Dict[str, Any]] = {}
        
    def register(self, name: str, description: str, tool_func: Callable):
        """注册新工具"""
        self._tools[name] = tool_func
        
        # 获取函数参数信息
        sig = inspect.signature(tool_func)
        params = {}
        required = []
        
        for param_name, param in sig.parameters.items():
            if param_name == 'self':
                continue
                
            param_info = {"type": "string"}
            if param.annotation != inspect.Parameter.empty:
                if param.annotation == str:
                    param_info["type"] = "string"
                elif param.annotation == int:
                    param_info["type"] = "integer"
                elif param.annotation == float:
                    param_info["type"] = "number"
                elif param.annotation == bool:
                    param_info["type"] = "boolean"
            
            # 检查参数是否有默认值
            if param.default == inspect.Parameter.empty:
                required.append(param_name)
                
            params[param_name] = param_info
        
        self._tool_descriptions[name] = {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": params,
                "required": required
            }
        }
        
    def get_tool(self, name: str) -> Callable:
        """获取工具函数"""
        if name not in self._tools:
            raise ValueError(f"未找到工具: {name}")
        return self._tools[name]
        
    def get_tool_descriptions(self) -> List[Dict[str, Any]]:
        """获取所有工具的描述"""
        return [
            {
                "type": "function",
                "function": tool_desc
            }
            for tool_desc in self._tool_descriptions.values()
        ]
        
    async def execute(self, name: str, **kwargs) -> Any:
        """执行工具"""
        tool_func = self.get_tool(name)
        
        if asyncio.iscoroutinefunction(tool_func):
            return await tool_func(**kwargs)
        else:
            return tool_func(**kwargs)

# 全局工具注册表实例
tool_registry = ToolRegistry()
```

#### 1.2 实现核心工具函数

扩展 `app/utils/tools.py`：

```python
import httpx
import json
from typing import List, Dict, Any, Optional
from datetime import datetime
import os
import pandas as pd
import matplotlib.pyplot as plt
import base64
from io import BytesIO

from app.utils.tool_registry import tool_registry

# 搜索工具
async def search_web(query: str, num_results: int = 5) -> str:
    """执行网络搜索并返回结果"""
    # 实现实际的搜索功能
    try:
        # 这里是简化示例，实际中应使用实际的搜索API
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.search-service.com/search",
                params={"q": query, "limit": num_results},
                timeout=10.0
            )
            
            if response.status_code == 200:
                results = response.json()
                formatted_results = []
                
                for i, result in enumerate(results["items"][:num_results], 1):
                    formatted_results.append(f"{i}. {result['title']}")
                    formatted_results.append(f"   URL: {result['link']}")
                    formatted_results.append(f"   描述: {result['snippet']}")
                    formatted_results.append("")
                    
                return "\n".join(formatted_results)
            else:
                return f"搜索失败: HTTP {response.status_code}"
    except Exception as e:
        return f"搜索时出错: {str(e)}"

# 数据分析工具
async def analyze_data(data_path: str, analysis_type: str, column: Optional[str] = None) -> str:
    """
    分析CSV或JSON数据并返回结果
    
    参数:
    - data_path: 数据文件路径
    - analysis_type: 分析类型 (summary, correlation, distribution)
    - column: 要分析的列名
    """
    try:
        # 检查文件是否存在
        if not os.path.exists(data_path):
            return f"错误: 文件 '{data_path}' 不存在"
            
        # 根据文件扩展名加载数据
        if data_path.endswith('.csv'):
            df = pd.read_csv(data_path)
        elif data_path.endswith('.json'):
            df = pd.read_json(data_path)
        else:
            return "错误: 仅支持CSV和JSON文件"
            
        # 执行分析
        if analysis_type == "summary":
            result = df.describe().to_string()
            return f"数据摘要:\n\n{result}"
            
        elif analysis_type == "correlation":
            if not column:
                corr = df.corr().to_string()
                return f"相关性矩阵:\n\n{corr}"
            else:
                if column not in df.columns:
                    return f"错误: 找不到列 '{column}'"
                corr = df.corr()[column].to_string()
                return f"与'{column}'的相关性:\n\n{corr}"
                
        elif analysis_type == "distribution":
            if not column:
                return "错误: 分布分析需要指定列名"
                
            if column not in df.columns:
                return f"错误: 找不到列 '{column}'"
                
            # 创建分布图
            plt.figure(figsize=(10, 6))
            df[column].hist()
            plt.title(f"{column} 分布")
            plt.xlabel(column)
            plt.ylabel("频率")
            
            # 将图表转换为base64
            buffer = BytesIO()
            plt.savefig(buffer, format='png')
            buffer.seek(0)
            image_base64 = base64.b64encode(buffer.read()).decode('utf-8')
            plt.close()
            
            return f"![{column} 分布图](data:image/png;base64,{image_base64})"
        else:
            return f"错误: 不支持的分析类型 '{analysis_type}'"
    
    except Exception as e:
        return f"分析数据时出错: {str(e)}"

# 文件操作工具
async def read_file_content(file_path: str, max_lines: int = 50) -> str:
    """读取文件内容"""
    try:
        if not os.path.exists(file_path):
            return f"错误: 文件 '{file_path}' 不存在"
            
        with open(file_path, 'r', encoding='utf-8') as f:
            if max_lines > 0:
                lines = [next(f) for _ in range(max_lines) if f]
                content = ''.join(lines)
                
                if len(lines) >= max_lines:
                    content += f"\n... (已截断，仅显示前 {max_lines} 行)"
            else:
                content = f.read()
                
        return content
    except Exception as e:
        return f"读取文件时出错: {str(e)}"

# 注册工具
def register_tools():
    """注册所有可用工具"""
    tool_registry.register(
        "search_web",
        "使用搜索引擎进行搜索并返回结果",
        search_web
    )
    
    tool_registry.register(
        "analyze_data",
        "分析CSV或JSON数据文件并返回统计结果或可视化",
        analyze_data
    )
    
    tool_registry.register(
        "read_file",
        "读取文件内容",
        read_file_content
    )
    
    # 注册更多工具...

# 初始化注册工具
register_tools()
```

### 2. 实现AI Agent服务

创建 `app/services/agent_service.py` 文件：

```python
from typing import List, Dict, Any, Optional
import json
from datetime import datetime

from app.services.llm_service import llm_service
from app.utils.tool_registry import tool_registry
from app.utils.logger import logger
from app.models.mongodb import create_agent_log, get_agent_logs

class AgentService:
    """AI Agent服务类"""
    
    def __init__(self):
        self.llm_service = llm_service
        
    async def get_agent_response(self, task: str, history: List[Dict[str, Any]], model: str) -> Dict[str, Any]:
        """
        获取Agent的思考和行动决策
        
        Args:
            task: 用户任务
            history: 历史步骤
            model: 使用的模型
            
        Returns:
            包含思考和行动的响应
        """
        # 构建提示词
        prompt = self._build_agent_prompt(task, history)
        
        # 获取工具定义
        tools = tool_registry.get_tool_descriptions()
        
        # 发送LLM请求
        response = await self.llm_service.send_llm_request(
            messages=[
                {
                    "role": "system", 
                    "content": prompt
                }
            ],
            model=model,
            tools=tools
        )
        
        # 解析响应
        if "choices" in response and response["choices"]:
            message = response["choices"][0]["message"]
            content = message.get("content", "")
            
            # 检查是否有工具调用
            if "tool_calls" in message and message["tool_calls"]:
                tool_call = message["tool_calls"][0]["function"]
                return {
                    "thought": content,
                    "action": tool_call["name"],
                    "action_input": json.loads(tool_call["arguments"])
                }
            else:
                # 如果没有工具调用，视为直接回答
                return {
                    "thought": "我已经有足够的信息来回答问题。",
                    "action": "answer",
                    "action_input": content
                }
        else:
            # 如果出错，返回错误信息
            return {
                "thought": "处理请求时出错。",
                "action": "answer",
                "action_input": "抱歉，处理您的请求时遇到问题。请重试。"
            }
            
    async def get_final_answer(self, task: str, history: List[Dict[str, Any]], model: str) -> str:
        """
        根据历史步骤获取最终回答
        
        Args:
            task: 用户任务
            history: 历史步骤
            model: 使用的模型
            
        Returns:
            最终回答
        """
        # 构建最终答案提示
        prompt = self._build_final_answer_prompt(task, history)
        
        # 发送LLM请求
        response = await self.llm_service.send_llm_request(
            messages=[
                {
                    "role": "system", 
                    "content": prompt
                }
            ],
            model=model
        )
        
        # 解析响应
        if "choices" in response and response["choices"]:
            return response["choices"][0]["message"].get("content", "抱歉，无法生成回答。")
        else:
            return "抱歉，生成回答时遇到问题。"
    
    async def run_agent(self, user_id: str, task: str, model: str, max_steps: int = 5) -> Dict[str, Any]:
        """
        执行Agent任务
        
        Args:
            user_id: 用户ID
            task: 用户任务
            model: 使用的模型
            max_steps: 最大步骤数
            
        Returns:
            任务执行结果
        """
        history = []
        
        for step in range(max_steps):
            logger.info(f"执行Agent步骤 {step+1}/{max_steps} - 任务: {task}")
            
            # 获取思考和行动
            response = await self.get_agent_response(task, history, model)
            
            # 记录思考
            logger.info(f"思考: {response['thought']}")
            logger.info(f"行动: {response['action']}")
            
            # 如果决定直接回答
            if response["action"] == "answer":
                # 记录最终操作
                create_agent_log(
                    user_id=user_id,
                    task=task,
                    steps=history + [{"thought": response["thought"], "action": "answer"}],
                    answer=response["action_input"],
                    model=model
                )
                
                return {
                    "status": "complete",
                    "answer": response["action_input"],
                    "steps": history
                }
            
            # 执行工具调用
            try:
                if isinstance(response["action_input"], dict):
                    observation = await tool_registry.execute(response["action"], **response["action_input"])
                else:
                    observation = await tool_registry.execute(response["action"], query=response["action_input"])
            except Exception as e:
                observation = f"执行工具时出错: {str(e)}"
                logger.error(f"工具执行错误: {str(e)}")
            
            # 记录执行结果
            logger.info(f"观察: {observation[:100]}...")
            
            # 更新历史
            history.append({
                "thought": response["thought"],
                "action": response["action"],
                "input": response["action_input"],
                "observation": observation
            })
            
        # 到达最大步骤，生成最终回答
        final_response = await self.get_final_answer(task, history, model)
        
        # 记录最终操作
        create_agent_log(
            user_id=user_id,
            task=task,
            steps=history,
            answer=final_response,
            model=model
        )
        
        return {
            "status": "complete",
            "answer": final_response,
            "steps": history
        }
        
    def _build_agent_prompt(self, task: str, history: List[Dict[str, Any]]) -> str:
        """构建Agent提示词"""
        prompt = """你是一个先进的AI助手，具有思考与行动的能力。你将收到一个任务，并且你可以使用工具来完成这个任务。

你的工作流程如下：
1. 分析用户的任务
2. 思考如何解决这个问题
3. 选择一个适当的工具来执行行动
4. 观察结果并继续思考下一步

你可以使用以下工具：
- search_web: 搜索互联网获取信息
- analyze_data: 分析数据文件并生成统计信息
- read_file: 读取文件内容

请先思考，然后再行动。如果你已经有足够的信息来回答问题，可以直接给出回答。

任务: {task}
"""
        
        # 添加历史记录
        if history:
            prompt += "\n\n历史步骤:\n"
            for i, step in enumerate(history, 1):
                prompt += f"\n步骤 {i}:\n"
                prompt += f"思考: {step['thought']}\n"
                prompt += f"行动: {step['action']}\n"
                prompt += f"输入: {step['input']}\n"
                prompt += f"观察: {step['observation']}\n"
                
        prompt += "\n\n现在，请思考并决定下一步行动。"
        
        return prompt.format(task=task)
        
    def _build_final_answer_prompt(self, task: str, history: List[Dict[str, Any]]) -> str:
        """构建最终答案提示词"""
        prompt = """你是一个先进的AI助手。你已经完成了一系列步骤来解决用户的任务，现在需要提供最终的、全面的回答。

你的回答应该：
1. 直接回答用户的问题
2. 总结你使用的方法和发现的信息
3. 提供清晰、准确且有用的解释
4. 如果有多个答案或结果，请组织它们使其易于理解

任务: {task}

执行的步骤:
"""

        # 添加历史记录
        for i, step in enumerate(history, 1):
            prompt += f"\n步骤 {i}:\n"
            prompt += f"思考: {step['thought']}\n"
            prompt += f"行动: {step['action']}\n"
            prompt += f"输入: {step['input']}\n"
            prompt += f"观察: {step['observation']}\n"
            
        prompt += "\n\n请提供全面而清晰的最终回答："
        
        return prompt.format(task=task)

# 创建全局实例
agent_service = AgentService()
```

### 3. 扩展数据模型和数据库

#### 3.1 更新 MongoDB 模型

修改 `app/models/mongodb.py`，添加Agent日志功能：

```python
# 添加到现有文件中

def create_agent_log(user_id: str, task: str, steps: List[Dict[str, Any]], answer: str, model: str):
    """创建Agent执行日志"""
    db = get_database()
    agent_logs = db["agent_logs"]
    
    log_entry = {
        "user_id": user_id,
        "task": task,
        "steps": steps,
        "answer": answer,
        "model": model,
        "timestamp": datetime.now()
    }
    
    agent_logs.insert_one(log_entry)
    
def get_agent_logs(user_id: str, limit: int = 10):
    """获取用户的Agent日志"""
    db = get_database()
    agent_logs = db["agent_logs"]
    
    cursor = agent_logs.find(
        {"user_id": user_id}
    ).sort("timestamp", -1).limit(limit)
    
    return list(cursor)
```

#### 3.2 更新 Pydantic 模型

在 `models.py` 中添加新的模型：

```python
# 添加到现有文件中

class AgentRequest(BaseModel):
    user_id: str
    task: str
    model: str
    max_steps: int = 5

class AgentStep(BaseModel):
    thought: str
    action: str
    input: Any
    observation: str

class AgentResponse(BaseModel):
    status: str
    answer: str
    steps: List[AgentStep]
```

### 4. 添加API端点

在 `app/routers/api.py` 添加Agent接口：

```python
# 添加导入
from app.services.agent_service import agent_service

# 添加新的端点
@router.post("/agent/run", response_model=schemas.AgentResponse)
async def run_agent(
    request: schemas.AgentRequest,
    settings: Settings = Depends(get_settings_dependency),
    api_key: str = Depends(get_api_key)
):
    """执行Agent任务"""
    # 验证模型名称
    if request.model not in settings.ALLOWED_MODELS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"模型 {request.model} 不受支持。支持的模型: {', '.join(settings.ALLOWED_MODELS)}"
        )
    
    # 检查用户使用限制
    usage = await llm_service.update_user_usage(request.user_id, request.model)
    if usage.get("isExceeded"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"今日模型 {request.model} 使用量已达上限 ({usage.get('limit')})"
        )
    
    result = await agent_service.run_agent(
        user_id=request.user_id,
        task=request.task,
        model=request.model,
        max_steps=request.max_steps
    )
    
    return result

@router.get("/agent/history/{user_id}")
async def get_agent_history(
    user_id: str,
    limit: int = 10,
    api_key: str = Depends(get_api_key)
):
    """获取用户的Agent执行历史"""
    history = get_agent_logs(user_id, limit)
    return {"history": history}
```

### 5. 扩展LLM服务

在 `app/services/llm_service.py` 添加Agent响应处理方法：

```python
# 添加到LLMService类中

async def get_agent_system_prompt(self) -> Dict[str, str]:
    """
    获取Agent系统提示
    
    Returns:
        系统提示
    """
    return {
        "role": "system",
        "content": """你是一个先进的AI助手，具有思考与行动的能力。你的目标是帮助用户解决问题，
        回答问题，并完成各种任务。你可以使用各种工具来获取信息和执行操作。
        
        在执行任务时，请遵循以下流程：
        1. 仔细分析用户的需求
        2. 思考解决方案，规划步骤
        3. 使用适当的工具获取所需信息或执行操作
        4. 分析结果，如需要继续使用工具
        5. 提供全面、准确、有用的回答
        
        你的回应应该清晰、专业且友好，避免不必要的冗长内容。"""
    }
```

## 5. 规划能力增强

创建 `app/services/planner_service.py`：

```python
from typing import List, Dict, Any
from app.services.llm_service import llm_service

class PlannerService:
    """任务规划服务类"""
    
    def __init__(self):
        self.llm_service = llm_service
        
    async def create_plan(self, task: str, model: str) -> List[Dict[str, str]]:
        """
        为任务创建执行计划
        
        Args:
            task: 用户任务
            model: 使用的模型
            
        Returns:
            步骤列表
        """
        prompt = f"""作为一个高效的任务规划者，你的职责是分析下面的任务，并将其拆分为合理的、有序的步骤。
        每个步骤都应该具体、明确，并有助于最终解决任务。
        
        任务: {task}
        
        请提供一个JSON格式的步骤列表，格式如下:
        [
            {{"step": "步骤1描述", "reason": "为什么需要这个步骤"}},
            {{"step": "步骤2描述", "reason": "为什么需要这个步骤"}},
            ...
        ]
        
        确保步骤是逻辑顺序的，并且能够完整地解决任务。不要包含任何其他文本，仅返回JSON数组。"""
        
        # 发送LLM请求
        response = await self.llm_service.send_llm_request(
            messages=[
                {
                    "role": "system", 
                    "content": "你是一个专业的任务规划助手，擅长将复杂任务分解为具体步骤。"
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            model=model
        )
        
        # 解析响应
        if "choices" in response and response["choices"]:
            content = response["choices"][0]["message"].get("content", "")
            
            try:
                # 从回复中提取JSON
                import re
                import json
                
                # 查找JSON数组
                match = re.search(r'\[.*\]', content, re.DOTALL)
                if match:
                    json_str = match.group(0)
                    plan = json.loads(json_str)
                    return plan
                else:
                    return [{"step": "无法创建计划", "reason": "解析错误"}]
            except Exception as e:
                return [{"step": f"创建计划时出错: {str(e)}", "reason": "解析错误"}]
        else:
            return [{"step": "无法创建计划", "reason": "LLM响应错误"}]

# 创建全局实例
planner_service = PlannerService()
```

## 6. 增强记忆检索系统

创建 `app/services/embedding_service.py`：

```python
import numpy as np
from typing import List, Dict, Any
import httpx
import json
from datetime import datetime

from app.utils.logger import logger
from app.core.config import get_settings
from app.models.mongodb import get_database

settings = get_settings()

class EmbeddingService:
    """嵌入向量服务类"""
    
    def __init__(self):
        self.endpoint = settings.GITHUB_ENDPOINT
        self.api_key = settings.GITHUB_INFERENCE_KEY
        self.api_version = settings.GITHUB_API_VERSION
        self.embedding_model = "text-embedding-ada-002"  # 或其他嵌入模型
        
    async def get_embedding(self, text: str) -> List[float]:
        """
        获取文本的嵌入向量
        
        Args:
            text: 要嵌入的文本
            
        Returns:
            嵌入向量
        """
        url = f"{self.endpoint}/embeddings"
        headers = {
            "api-key": self.api_key,
            "Content-Type": "application/json"
        }
        
        body = {
            "input": text,
            "model": self.embedding_model
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                url,
                headers=headers,
                json=body,
                timeout=30.0
            )
            
            if response.status_code == 200:
                result = response.json()
                if "data" in result and result["data"]:
                    return result["data"][0]["embedding"]
            
            logger.error(f"获取嵌入向量失败: {response.text}")
            return []
            
    async def store_memory_embedding(self, user_id: str, memory: str):
        """
        存储记忆的嵌入向量
        
        Args:
            user_id: 用户ID
            memory: 记忆内容
        """
        embedding = await self.get_embedding(memory)
        
        if not embedding:
            logger.error("无法获取嵌入向量，跳过存储")
            return
            
        db = get_database()
        memory_embeddings = db["memory_embeddings"]
        
        entry = {
            "user_id": user_id,
            "memory": memory,
            "embedding": embedding,
            "timestamp": datetime.now()
        }
        
        memory_embeddings.insert_one(entry)
        
    async def search_similar_memories(self, user_id: str, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        """
        搜索相似的记忆
        
        Args:
            user_id: 用户ID
            query: 查询文本
            limit: 返回结果数量
            
        Returns:
            相似记忆列表
        """
        query_embedding = await self.get_embedding(query)
        
        if not query_embedding:
            logger.error("无法获取查询嵌入向量")
            return []
            
        db = get_database()
        memory_embeddings = db["memory_embeddings"]
        
        # 获取所有该用户的记忆嵌入
        cursor = memory_embeddings.find({"user_id": user_id})
        memories = list(cursor)
        
        # 计算相似度
        results = []
        for memory in memories:
            memory_embedding = memory["embedding"]
            
            # 计算余弦相似度
            similarity = self._cosine_similarity(query_embedding, memory_embedding)
            
            results.append({
                "memory": memory["memory"],
                "similarity": similarity,
                "timestamp": memory["timestamp"]
            })
            
        # 按相似度排序
        results.sort(key=lambda x: x["similarity"], reverse=True)
        
        return results[:limit]
        
    def _cosine_similarity(self, vec1: List[float], vec2: List[float]) -> float:
        """计算两个向量的余弦相似度"""
        vec1 = np.array(vec1)
        vec2 = np.array(vec2)
        
        dot_product = np.dot(vec1, vec2)
        norm_a = np.linalg.norm(vec1)
        norm_b = np.linalg.norm(vec2)
        
        if norm_a == 0 or norm_b == 0:
            return 0
            
        return dot_product / (norm_a * norm_b)

# 创建全局实例
embedding_service = EmbeddingService()
```

### 7. 进阶功能：自动化测试

创建 `tests/test_agent.py`：

```python
import pytest
import asyncio
from httpx import AsyncClient
from fastapi import FastAPI

from app.services.agent_service import agent_service
from main import app

@pytest.mark.asyncio
async def test_agent_search():
    task = "找出2024年全球人工智能领域最新的发展趋势"
    result = await agent_service.run_agent(
        user_id="test_user",
        task=task,
        model="Meta-Llama-3.1-70B-Instruct",
        max_steps=3
    )
    
    assert "status" in result
    assert result["status"] == "complete"
    assert "answer" in result
    assert len(result["steps"]) > 0

@pytest.mark.asyncio
async def test_agent_api():
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/agent/run",
            json={
                "user_id": "test_user",
                "task": "计算366乘以42的结果",
                "model": "Meta-Llama-3.1-8B-Instruct",
                "max_steps": 2
            },
            headers={"X-API-KEY": "your_test_api_key"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "answer" in data
        assert "15372" in data["answer"]  # 366 * 42 = 15372
```

## 集成指南

以上代码和功能创建完成后，请按以下步骤集成：

1. 确保所有必要的依赖已安装：
   ```bash
   pip install numpy pandas matplotlib httpx
   ```

2. 更新项目的 `requirements.txt` 文件，添加新的依赖。

3. 更新配置文件以支持新的功能。

4. 执行单元测试以验证功能是否正常。

5. 依次实现各个阶段的功能，从工具系统开始，逐步添加Agent服务、规划服务和记忆增强。

6. 在实现每个阶段后，进行功能测试，确保系统工作正常。

## 进一步的优化方向

1. **并行工具执行**：实现多工具并行执行，提高效率

2. **用户反馈学习**：加入用户反馈机制，让Agent学习改进

3. **多轮对话支持**：增强Agent对多轮复杂对话的处理能力

4. **错误处理与重试**：增强错误处理和自动重试机制
