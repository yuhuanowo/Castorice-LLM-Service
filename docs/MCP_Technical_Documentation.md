# Model Context Protocol (MCP) 技术文档

## 概述

Model Context Protocol (MCP) 是一个开放标准协议，用于连接大型语言模型（LLM）与外部工具和资源。在我们的系统中，MCP客户端实现了一个"通用USB接口"，使LLM能够动态连接到各种外部服务器，从而极大扩展AI系统的能力。

## 核心功能

### 1. 动态工具发现

MCP客户端能够在运行时发现和注册外部服务器提供的工具，无需预先硬编码工具定义。这种设计使系统具有高度可扩展性，可以轻松集成新的工具服务器。

### 2. 多传输协议支持

MCP客户端支持多种传输协议：

- **STDIO**：通过标准输入/输出与子进程通信
- **HTTP/SSE**：通过HTTP和服务器发送事件与Web服务通信
- **WebSocket**：支持双向实时通信

### 3. 资源管理

除了工具调用外，MCP还支持资源管理，允许外部服务器提供各种资源（如文档、图像等）供LLM访问。

### 4. 会话管理

MCP客户端管理与外部服务器的会话生命周期，包括启动、维护和清理过程。

## 架构设计

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Agent Service │    │   MCP Client     │    │  External MCP   │
│   LLM Service   │───▶│ (Interface Layer)│───▶│    Servers      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │ Configuration│
                        │ Management   │
                        └──────────────┘
```

### 核心组件

1. **MCPClient**：主客户端类，管理服务器连接和工具调用
2. **MCPServer**：表示外部MCP服务器的配置和状态
3. **MCPTool**：表示外部服务器提供的工具定义
4. **MCPResource**：表示外部服务器提供的资源定义

## 配置管理

MCP服务器配置存储在`data/mcp_servers.json`文件中，格式如下：

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your_token_here"
      },
      "transport": "stdio",
      "enabled": true,
      "timeout": 30
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "PGUSER": "postgres",
        "PGPASSWORD": "postgres",
        "PGDATABASE": "postgres",
        "PGHOST": "localhost",
        "PGPORT": "5432"
      },
      "enabled": true
    }
  }
}
```

## 使用方法

### 1. 初始化MCP客户端

```python
from app.services.mcp_client import mcp_client, init_mcp_client

# 初始化MCP客户端（应用启动时调用）
await init_mcp_client()

# 检查可用工具
available_tools = mcp_client.get_available_tools()
print(f"发现 {len(available_tools)} 个MCP工具")
```

### 2. 工具调用

```python
# 调用MCP工具
result = await mcp_client.call_tool("github.searchRepositories", {
    "query": "language:python stars:>1000",
    "maxResults": 5
})

# 处理结果
for repo in result.get("repositories", []):
    print(f"仓库: {repo['name']} - 星标: {repo['stars']}")
```

### 3. 资源访问

```python
# 获取可用资源
resources = mcp_client.get_available_resources()

# 访问特定资源
resource_content = await mcp_client.get_resource("documentation/api-reference")
```

## 错误处理

MCP客户端实现了健壮的错误处理机制：

1. **连接错误**：当无法连接到外部服务器时，提供明确的诊断信息
2. **工具调用错误**：捕获并处理工具执行过程中的异常
3. **超时处理**：为工具调用设置超时限制，防止长时间阻塞
4. **资源清理**：确保在应用关闭时正确清理所有子进程和连接

## 安全考虑

1. **隔离执行**：外部工具在单独的进程中执行，减少对主应用的风险
2. **凭证管理**：敏感凭证通过环境变量传递，避免硬编码
3. **输入验证**：工具调用前验证输入参数，防止注入攻击

## 性能优化

1. **连接池**：对HTTP/WebSocket连接使用连接池，减少建立连接的开销
2. **子进程管理**：优化子进程生命周期，减少资源消耗
3. **异步IO**：全面使用异步操作，避免阻塞主线程

## 调试与监控

MCP客户端提供详细的日志记录，帮助诊断问题：

```python
# 获取服务器状态
status = mcp_client.get_server_status()
print(f"服务器状态: {status}")

# 执行诊断
diagnostic = await mcp_client.run_diagnostic()
print(f"诊断结果: {diagnostic}")
```

## 示例：集成新的MCP服务器

1. 在`data/mcp_servers.json`中添加新服务器配置
2. 重启应用或调用`await init_mcp_client()`重新初始化
3. 新服务器的工具将自动被发现并可用

## 未来扩展

1. **服务发现**：实现自动服务发现机制，无需手动配置
2. **认证机制**：增强安全认证系统
3. **工具编排**：支持多个工具的协同工作流
4. **更多传输协议**：增加对更多传输协议的支持
