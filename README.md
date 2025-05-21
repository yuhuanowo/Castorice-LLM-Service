# Castorice-LLM-Service AI Agent API 服务器

这是一个基于 FastAPI 开发的 AI Agent API 服务器，提供统一的 AI 模型调用接口，支持多种功能，包括聊天完成、长期记忆管理、工具调用等。

## 项目特点

- **统一接口**: 为各种项目提供一致的 AI 调用体验
- **多模型支持**: 支持多种 AI 模型，包括 GPT-4o、GPT-4o-mini、LLaMA 等
- **长期记忆**: 使用 MongoDB 存储用户交互历史，支持长期记忆功能
- **工具调用**: 支持图像生成、搜索等工具功能
- **使用量控制**: 跟踪并限制用户的模型使用量
- **简单集成**: 基于 RESTful API，易于与其他系统集成

## 主要技术栈

- **后端框架**: FastAPI
- **数据库**: MongoDB 和 SQLite (双重存储)
- **AI 模型**: 通过 Azure AI 推理服务调用各类 LLM 模型
- **异步处理**: 使用 Python asyncio 优化性能

## 设置说明

This sample makes use of Dev Containers, in order to leverage this setup, make sure you have [Docker installed](https://www.docker.com/products/docker-desktop).

To successfully run this example, we recommend the following VS Code extensions:

- [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
- [Python](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
- [Python Debugger](https://marketplace.visualstudio.com/items?itemName=ms-python.debugpy)
- [Pylance](https://marketplace.visualstudio.com/items?itemName=ms-python.vscode-pylance) 

In addition to these extension there a few settings that are also useful to enable. You can enable to following settings by opening the Settings editor (`Ctrl+,`) and searching for the following settings:

- Python > Analysis > **Type Checking Mode** : `basic`
- Python > Analysis > Inlay Hints: **Function Return Types** : `enable`
- Python > Analysis > Inlay Hints: **Variable Types** : `enable`

## 环境变量配置

创建一个 `.env` 文件，配置以下环境变量:

```env
MONGODB_URL=mongodb://localhost:27017/agent
SQLITE_DB=./chatlog.db
AZURE_INFERENCE_KEY=your_azure_key_here
AZURE_ENDPOINT=https://models.inference.ai.azure.com
AZURE_API_VERSION=2025-03-01-preview
CLOUDFLARE_API_KEY=your_cloudflare_key_here
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id_here
ADMIN_API_KEY=your_admin_api_key_here
```

## 运行项目

### 本地运行

1. 安装依赖:
   ```bash
   pip install -r requirements.txt
   ```

2. 启动服务:
   ```bash
   uvicorn main:app --reload
   ```

3. 访问 API 文档: http://localhost:8000/docs

### 使用 Docker 运行

1. 构建 Docker 镜像:
   ```bash
   docker build -t ai-agent-api .
   ```

2. 运行容器:
   ```bash
   docker run -p 8000:8000 --env-file .env ai-agent-api
   ```

## API 使用示例

### 聊天完成

```python
import requests
import json

url = "http://localhost:8000/api/v1/chat/completions"
headers = {
    "X-API-KEY": "your_admin_api_key_here",
    "Content-Type": "application/json"
}
payload = {
    "messages": [
        {
            "role": "user",
            "content": "你好，請介紹一下你自己"
        }
    ],
    "model": "Meta-Llama-3.1-70B-Instruct",
    "user_id": "user123",
    "enable_search": False,
    "language": "zh-TW"
}

response = requests.post(url, headers=headers, json=payload)
print(json.dumps(response.json(), indent=2, ensure_ascii=False))
```
<!-- 
## 将API升级为AI Agent的实施指南

当前系统已经实现了API层面的功能，接下来可以升级为全功能AI Agent。以下是实施路线图：

### 1. 增强工具函数系统

扩展 `app/utils/tools.py` 添加更多工具：

```python
# app/utils/tools.py

async def search_web(query: str) -> str:
    """执行网络搜索并返回结果"""
    # 实现搜索API的集成
    pass

async def analyze_data(data_source: str, query: str) -> dict:
    """分析数据"""
    # 实现数据分析逻辑
    pass

async def execute_tool(tool_name: str, tool_input: any) -> str:
    """工具执行统一入口"""
    tool_map = {
        "search_web": search_web,
        "analyze_data": analyze_data,
        # 添加更多工具
    }
    
    if tool_name not in tool_map:
        return f"错误: 未找到工具 '{tool_name}'"
    
    return await tool_map[tool_name](tool_input)
```

### 2. 实现ReAct框架

创建 `app/services/agent_service.py` 实现思考-行动-观察循环：

```python
# app/services/agent_service.py
from typing import List, Dict, Any
from app.services.llm_service import llm_service
from app.utils.tools import execute_tool

class AgentService:
    def __init__(self):
        self.llm_service = llm_service
        
    async def run_agent(self, user_id: str, task: str, model: str, max_steps: int = 5):
        """执行Agent任务，实现ReAct框架"""
        history = []
        
        for step in range(max_steps):
            # 获取思考和行动
            response = await self.llm_service.get_agent_response(task, history, model)
            
            # 如果决定直接回答
            if response["action"] == "answer":
                return {
                    "status": "complete",
                    "answer": response["action_input"],
                    "steps": history
                }
            
            # 执行工具调用
            observation = await execute_tool(response["action"], response["action_input"])
            history.append({
                "thought": response["thought"],
                "action": response["action"],
                "input": response["action_input"],
                "observation": observation
            })
            
        # 最终回答
        final_response = await self.llm_service.get_final_answer(task, history, model)
        return {
            "status": "complete",
            "answer": final_response,
            "steps": history
        }

agent_service = AgentService()
```

### 3. 添加API端点

在 `app/routers/api.py` 中：

```python
@router.post("/agent/run")
async def run_agent(
    request: schemas.AgentRequest,
    settings: Settings = Depends(get_settings_dependency),
    api_key: str = Depends(get_api_key)
):
    """执行Agent任务"""
    result = await agent_service.run_agent(
        user_id=request.user_id,
        task=request.task,
        model=request.model,
        max_steps=request.max_steps
    )
    
    return result
```

### 4. 关键概念与实施路线图

#### Agent核心组件

1. **工具系统**：Agent可以调用的各种功能
   - 搜索工具：从互联网获取最新信息
   - 数据分析工具：处理各种格式的数据
   - 文件处理工具：读取和处理文件内容

2. **记忆系统**：短期和长期记忆
   - 短期记忆：当前任务的执行历史
   - 长期记忆：用户偏好和过往交互的向量化存储

3. **推理引擎**：基于LLM的决策和思考能力
   - 思考能力：分析问题，合理规划解决方案
   - 行动选择：确定最佳下一步行动
   - 观察分析：理解执行结果，调整后续步骤

4. **规划系统**：分解任务为细化步骤
   - 任务理解：深入理解用户需求
   - 步骤规划：将复杂任务分解为可管理的步骤
   - 适应性调整：根据执行过程中的新信息调整计划

#### 分阶段实施计划

1. **第一阶段**: 构建基本工具系统
   - 实现工具注册机制
   - 添加3-5个核心工具
   - 完成工具执行框架

2. **第二阶段**: 实现ReAct框架
   - 构建"思考-行动-观察"循环
   - 实现推理逻辑和决策机制
   - 建立交互历史记录系统

3. **第三阶段**: 添加任务规划能力
   - 实现任务分析与目标识别
   - 建立递归子目标处理
   - 添加执行计划生成功能

4. **第四阶段**: 增强记忆检索系统
   - 实现嵌入向量存储
   - 添加相似度搜索功能
   - 建立长期记忆更新机制

5. **第五阶段**: 集成完整Agent流程
   - 将所有组件连接为完整流程
   - 添加用户反馈处理
   - 实现错误处理和自动恢复能力

#### 工具系统示例

```python
# 工具注册机制示例
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
        
        # 获取函数参数信息，自动生成参数描述
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
                
            # 检查参数是否有默认值
            if param.default == inspect.Parameter.empty:
                required.append(param_name)
                
            params[param_name] = param_info
        
        # 存储工具描述
        self._tool_descriptions[name] = {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": params,
                "required": required
            }
        }
```

完整的实施指南、示例代码和实现细节可参考 [AI Agent 实现指南](docs/agent_implementation.md)。

## AI Agent使用指南

一旦您实施了AI Agent功能，可以通过以下方式与Agent交互:

### 1. 使用API直接调用

```python
import requests
import json

url = "http://localhost:8000/api/v1/agent/run"
headers = {
    "X-API-KEY": "your_admin_api_key_here",
    "Content-Type": "application/json"
}
payload = {
    "user_id": "user123",
    "task": "帮我查找深圳明天的天气预报，并分析是否适合户外活动",
    "model": "Meta-Llama-3.1-70B-Instruct",
    "max_steps": 3  # 允许Agent最多执行3个步骤
}

response = requests.post(url, headers=headers, json=payload)
result = response.json()

print("Agent回答:", result["answer"])
print("\n执行步骤:")
for i, step in enumerate(result["steps"], 1):
    print(f"步骤 {i}:")
    print(f"思考: {step['thought']}")
    print(f"行动: {step['action']}")
    print(f"输入: {step['input']}")
    print(f"观察: {step['observation']}")
    print()
```

### 2. 查看执行历史

```python
import requests

url = "http://localhost:8000/api/v1/agent/history/user123"
headers = {
    "X-API-KEY": "your_admin_api_key_here"
}

response = requests.get(url, headers=headers)
history = response.json()["history"]

for item in history:
    print(f"任务: {item['task']}")
    print(f"时间: {item['timestamp']}")
    print(f"回答: {item['answer']}")
    print("---")
```

### 3. 典型用例示例

以下是一些Agent可以处理的典型用例:

#### 数据分析任务

```
"分析sales_data.csv文件，找出销售额最高的三个月，并解释可能的原因"
```

#### 复杂信息检索

```
"收集有关近期人工智能法规的信息，特别是欧盟和美国在2024年出台的新规定"
```

#### 多步骤问题解决

```
"帮我设计一个简单的健身计划，考虑我每周只有3天时间，每次1小时，目标是增肌"
```

#### 创意生成与建议

```
"我需要为一个科技初创公司想出5个可能的名称，公司专注于环保数据分析"
```

### 4. 自定义工具开发

您可以通过以下步骤添加自定义工具:

1. 在 `app/utils/tools.py` 中定义新工具函数
2. 在 `register_tools()` 函数中注册该工具
3. 重启服务以使新工具生效

工具函数示例:

```python
async def generate_chart(data_path: str, chart_type: str, x_column: str, y_column: str) -> str:
    """
    生成数据可视化图表
    
    参数:
    - data_path: 数据文件路径
    - chart_type: 图表类型 (bar, line, scatter)
    - x_column: X轴列名
    - y_column: Y轴列名
    """
    # 实现图表生成逻辑
    # ...
    
    # 返回图表的base64或URL
    return chart_base64
    
# 在register_tools()中注册
tool_registry.register(
    "generate_chart",
    "生成数据可视化图表，支持柱状图、折线图和散点图",
    generate_chart
)
```

## AI Agent最佳实践与故障排除

### 最佳实践

1. **任务清晰明确**
   - 给Agent的任务应该清晰、具体，并明确预期结果
   - 例如："查找2024年第一季度销售数据并制作图表"比"分析销售数据"更好

2. **合理设置步骤限制**
   - 对于简单任务，3-5个步骤通常足够
   - 对于复杂任务，可能需要8-10个步骤，或拆分为多个子任务

3. **设计良好的工具函数**
   - 工具函数应该有明确的单一职责
   - 提供详细的参数说明和错误处理
   - 返回结构化、易于理解的结果

4. **内存使用优化**
   - 对于长对话，使用向量数据库存储历史记忆
   - 实现相关性过滤，只检索与当前任务相关的历史信息

5. **模型选择**
   - 简单任务可使用较小模型如LLaMA-3.1-8B
   - 复杂任务需要更强大的模型如GPT-4o或LLaMA-3.1-70B

### 故障排除

1. **Agent卡在循环中**
   - **症状**: Agent重复执行类似步骤但不取得进展
   - **解决方案**: 
     - 提高提示词清晰度
     - 设置合理的最大步骤数
     - 在AgentService中添加循环检测逻辑

2. **工具执行失败**
   - **症状**: 工具返回错误，Agent无法处理
   - **解决方案**:
     - 改进工具错误处理，返回具体错误信息
     - 在工具函数中添加参数验证
     - 实现自动重试机制

3. **回答不相关或不完整**
   - **症状**: Agent回答与任务不相关或不完整
   - **解决方案**:
     - 改进最终回答提示词，强调任务目标
     - 在回答前添加验证步骤，确保回答相关性
     - 使用更强大的模型

4. **性能问题**
   - **症状**: Agent响应时间过长
   - **解决方案**:
     - 实现工具并行执行
     - 优化数据库查询
     - 对常见任务实现结果缓存

### 日志与监控

有效的日志记录和监控对于排查Agent问题至关重要。确保：

1. 记录每个Agent步骤的详细信息：
   ```python
   logger.info(f"步骤 {step}: 思考={thought}, 行动={action}, 结果={observation[:100]}...")
   ```

2. 监控工具执行时间：
   ```python
   start_time = time.time()
   result = await tool_func(**params)
   execution_time = time.time() - start_time
   logger.debug(f"工具 {tool_name} 执行时间: {execution_time:.2f}s")
   ```

3. 跟踪用户满意度：
   ```python
   @router.post("/agent/feedback")
   async def submit_feedback(
       request: schemas.FeedbackRequest,
       api_key: str = Depends(get_api_key)
   ):
       """提交Agent回答的反馈"""
       # 存储反馈并用于改进Agent
   ```

## 未来扩展方向

本项目作为基础框架，为构建强大的AI Agent提供了起点。以下是一些值得探索的扩展方向：

### 1. 多代理协作系统

实现多个专业Agent协作解决复杂问题：
- 研究Agent：专注于信息检索和分析
- 规划Agent：负责任务分解和规划
- 执行Agent：执行具体操作和工具调用
- 协调Agent：管理其他Agent并整合结果

```python
class AgentCoordinator:
    def __init__(self):
        self.research_agent = ResearchAgent()
        self.planning_agent = PlanningAgent()
        self.execution_agent = ExecutionAgent()
        
    async def solve_problem(self, task: str):
        # 1. 规划阶段
        plan = await self.planning_agent.create_plan(task)
        
        # 2. 研究阶段
        research_results = await self.research_agent.gather_information(task, plan)
        
        # 3. 执行阶段
        result = await self.execution_agent.execute_plan(plan, research_results)
        
        return result
```

### 2. 持久化对话状态

实现支持长期任务和会话的持久化机制：
- 保存Agent执行状态，支持暂停和恢复
- 维护会话上下文，实现跨会话的连续性
- 建立任务队列，处理需要长时间执行的任务

### 3. 自适应智能

让Agent随着使用而变得更智能：
- 基于用户反馈学习和改进决策
- 收集成功的解决方案模式，用于类似问题
- 根据不同任务自动调整策略

### 4. 自定义Agent个性

为不同领域或用途创建专业化Agent：
- 客服Agent：优化对客户问题的响应
- 研究Agent：专注于深入信息检索和分析
- 教育Agent：具有教学能力和耐心解释

### 5. 安全与隐私增强

加强Agent系统的安全性和隐私保护：
- 实现更严格的权限控制和验证机制
- 增加敏感信息检测和隐藏功能
- 提供数据匿名化选项

## 结语

AI Agent代表了人工智能应用的重要发展方向，将大型语言模型从简单的问答系统转变为能够执行复杂任务的智能助手。通过本项目框架，您可以构建适合各种业务场景的智能代理系统。

关键在于循序渐进地实施功能，确保每个组件都经过充分测试，并随着实际使用不断优化。通过合理的架构设计和实施最佳实践，您可以构建出既实用又强大的AI Agent系统，为用户提供真正有价值的智能服务。

无论您是希望创建企业级智能助手，还是专注于特定领域的专业Agent，本框架都可以作为坚实的起点，帮助您快速实现和部署AI Agent应用。

---

**附录: 相关资源**

- [ReAct论文](https://arxiv.org/abs/2210.03629) - 关于思考-行动-观察框架
- [LangChain文档](https://python.langchain.com/docs/get_started/introduction) - 另一个流行的Agent框架
- [FastAPI文档](https://fastapi.tiangolo.com/) - 后端框架官方文档
- [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) - 云数据库服务，适合存储Agent数据 -->
