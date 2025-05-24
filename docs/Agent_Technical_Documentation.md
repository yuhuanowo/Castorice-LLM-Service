# AI Agent 技术文档

## 核心概念

AI Agent是一个自主智能系统，能够分析用户需求，规划解决方案，使用工具执行任务，观察结果，并根据需要调整计划以完成用户的请求。我们的实现基于ReAct（Reasoning, Acting, Reflecting）架构，结合了Model Context Protocol (MCP)支持。

## 架构设计

### 状态管理

Agent系统使用状态机进行工作流程管理，包含以下状态：

```
IDLE → PLANNING → EXECUTING → OBSERVING → REFLECTING → RESPONDING → (完成/返回到PLANNING)
```

每个状态对应Agent工作流程中的特定阶段：

- **IDLE**：初始状态，等待用户输入
- **PLANNING**：分析用户需求，制定任务计划
- **EXECUTING**：执行工具调用或操作
- **OBSERVING**：分析工具执行结果
- **REFLECTING**：评估当前进度，决定是否需要调整计划
- **RESPONDING**：生成最终回复
- **ERROR**：错误状态，处理异常情况

### 执行模式

系统支持三种执行模式：

1. **MCP模式**：使用Model Context Protocol连接外部工具服务器
2. **ReAct模式**：基于推理、行动、反思循环的自主执行模式
3. **简单模式**：直接调用LLM，不使用复杂的工具调用和规划流程

### 关键组件

- **AgentService**：核心服务类，管理整个Agent的生命周期
- **工具系统**：提供Agent可用的功能，包括搜索、图像生成等
- **记忆系统**：管理短期和长期记忆，支持上下文理解
- **MCP客户端**：连接外部工具服务器的接口

## 关键功能

### 1. 任务规划

Agent会首先分析用户请求，然后将其分解为子任务。规划过程使用JSON结构化输出：

```json
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
```

### 2. 工具执行

Agent能够调用多种工具完成任务，包括但不限于：

- **搜索引擎**：获取网络信息
- **网页内容获取**：深入分析特定网页
- **图像生成**：创建符合描述的图像
- **MCP工具**：使用外部工具服务器提供的功能

### 3. 反思与调整

执行过程中，Agent会定期反思当前进度，评估成功与失败的步骤，并根据需要调整计划：

```json
{
  "assessment": "整体评估",
  "failedSteps": ["步骤1", "步骤2"],
  "adjustments": ["调整1", "调整2"],
  "userInputNeeded": true/false,
  "userQuestion": "需要询问用户的问题(如果需要)"
}
```

### 4. 记忆管理

Agent使用两级记忆系统：

- **短期记忆**：当前对话上下文
- **长期记忆**：用户偏好、历史交互等持久化信息

### 5. MCP集成

与Model Context Protocol的集成使Agent能够访问外部工具服务器提供的各种功能，极大扩展了Agent的能力范围。

## 使用示例

### 基本用法

```python
from app.services.agent_service import agent_service

# 执行Agent请求
result = await agent_service.run(
    user_id="user123",
    prompt="帮我找到关于人工智能最新研究的信息并生成一张相关图片",
    model_name="gpt-4o",
    enable_memory=True,
    enable_reflection=True,
    enable_mcp=True
)
```

### 高级配置

```python
# 使用自定义系统提示和工具配置
result = await agent_service.run(
    user_id="user123",
    prompt="分析这个网站的SEO情况",
    model_name="gpt-4o",
    system_prompt_override={
        "role": "system",
        "content": "你是一个SEO专家..."
    },
    tools_config={
        "enable_search": True,
        "include_advanced_tools": True
    }
)
```

## 性能与限制

- **最大步骤数**：默认限制为10个执行步骤，可通过配置调整
- **反思阈值**：每执行3个步骤触发一次反思，可配置
- **超时设置**：工具调用默认超时时间为30秒

## 未来改进方向

1. 增强Agent的元认知能力，提高自我纠错能力
2. 改进任务分解逻辑，更精确地识别子任务
3. 加入协作Agent支持，允许多个Agent共同解决复杂问题
4. 优化记忆检索算法，提高上下文理解的准确性
5. 扩展工具系统，支持更多种类的操作
