# 技术架构概览

## 🏗️ 系统架构

本项目采用分层架构设计，将AI Agent功能、MCP协议支持和传统API服务有机结合。

```
┌─────────────────────────────────────────────────────────────┐
│                     API Gateway Layer                      │
│                   (FastAPI Routes)                         │
├─────────────────────────────────────────────────────────────┤
│                    Service Layer                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Agent     │  │  MCP Client │  │    LLM Service      │  │
│  │  Service    │  │   Service   │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                   Tool & Utility Layer                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Built-in  │  │   Memory    │  │    External MCP     │  │
│  │    Tools    │  │   Service   │  │     Servers         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                     Data Layer                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   MongoDB   │  │   SQLite    │  │    File Storage     │  │
│  │ (Long-term  │  │  (Usage &   │  │   (Images, Logs)    │  │
│  │  Memory)    │  │   Cache)    │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 🧠 Agent系统设计

### ReAct架构实现

基于Reasoning (推理), Acting (行动), Reflecting (反思) 的三阶段循环：

```python
class AgentState(Enum):
    IDLE = "idle"              # 空闲状态
    PLANNING = "planning"      # 规划阶段
    EXECUTING = "executing"    # 执行阶段  
    OBSERVING = "observing"    # 观察阶段
    REFLECTING = "reflecting"  # 反思阶段
    RESPONDING = "responding"  # 回应阶段
```

### 执行流程

1. **任务理解**: 分析用户输入，识别意图
2. **计划制定**: 分解任务为可执行的子步骤
3. **工具选择**: 根据子任务选择合适的工具
4. **执行监控**: 实时跟踪工具执行状态
5. **结果评估**: 分析执行结果的有效性
6. **计划调整**: 根据评估结果调整后续计划
7. **最终回应**: 整合结果生成用户回答

## 🔌 MCP协议集成

### 设计理念

MCP作为"通用USB接口"，实现动态工具扩展：

- **纯接口设计**: 不包含硬编码工具
- **动态发现**: 运行时发现外部工具服务器
- **协议标准**: 严格遵循MCP官方规范
- **传输无关**: 支持多种通信协议

### 通信流程

```
Agent Request → MCP Client → Protocol Translation → External Server
      ↓              ↓              ↓                     ↓
Tool Selection → Session Mgmt → Message Routing → Tool Execution
      ↓              ↓              ↓                     ↓
Result Processing ← Error Handling ← Response Parsing ← Tool Response
```

## 🛠️ 工具系统

### 内置工具

- **搜索工具**: DuckDuckGo网络搜索
- **图像生成**: 基于DALL-E的图像创建
- **网页抓取**: 获取和解析网页内容
- **记忆管理**: 用户偏好和历史查询

### 外部工具 (通过MCP)

- **GitHub集成**: 代码搜索、仓库管理
- **数据库操作**: PostgreSQL查询和管理
- **文件系统**: 文件读写和目录操作
- **API调用**: 各种第三方服务集成

## 💾 数据管理

### MongoDB (主要存储)
```javascript
// 用户记忆文档结构
{
  userId: "user123",
  memories: [
    {
      type: "preference",
      content: "用户偏好使用中文回答",
      timestamp: "2025-05-24T10:30:00Z",
      relevance: 0.9
    }
  ],
  chatHistory: [...],
  lastUpdated: "2025-05-24T10:30:00Z"
}
```

### SQLite (使用量统计)
```sql
-- 用户使用量表
CREATE TABLE user_usage (
  user_id TEXT PRIMARY KEY,
  model_name TEXT,
  request_count INTEGER,
  last_request_date TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 🔐 安全机制

### API安全
- **密钥验证**: X-API-KEY头部验证
- **速率限制**: 防止API滥用
- **输入验证**: 严格的参数校验

### MCP安全
- **进程隔离**: 外部工具在独立进程中运行
- **凭证管理**: 环境变量传递敏感信息
- **资源限制**: 超时和资源使用限制

## ⚡ 性能优化

### 异步处理
```python
# 并发工具调用示例
async def execute_multiple_tools(tool_calls):
    tasks = [
        execute_tool(tool_name, params) 
        for tool_name, params in tool_calls
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return results
```

### 缓存策略
- **工具描述缓存**: 减少MCP服务器查询
- **用户偏好缓存**: 加速记忆检索
- **模型响应缓存**: 对相似查询复用结果

### 资源管理
- **连接池**: HTTP/WebSocket连接复用
- **内存管理**: 及时清理大对象
- **进程清理**: 自动终止僵尸MCP进程

## 📊 监控与调试

### 日志系统
```python
# 结构化日志示例
logger.info("Agent执行完成", extra={
    "user_id": user_id,
    "steps_taken": steps_count,
    "execution_time": execution_time,
    "tools_used": tool_names,
    "success": success_status
})
```

### 错误处理
- **分级错误处理**: 不同错误类型的不同处理策略
- **自动重试**: 临时性错误的自动恢复
- **优雅降级**: 部分功能失效时的备选方案

## 🔄 扩展性设计

### 新工具集成
1. 内置工具: 在`app/utils/tools.py`中添加
2. MCP工具: 配置`data/mcp_servers.json`
3. 自动发现: 系统启动时自动注册

### 新模型支持
1. 在`llm_service.py`中添加模型提供商
2. 更新API密钥配置
3. 测试模型兼容性

### 新协议支持
1. 实现协议适配器
2. 添加到传输层
3. 更新配置系统

这种模块化、分层的架构设计确保了系统的可维护性、可扩展性和高性能。
