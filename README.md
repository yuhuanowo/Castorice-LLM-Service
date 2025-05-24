# Castorice AI Agent API 服务器

基于 FastAPI 的企业级 AI Agent 系统，整合了ReAct架构的智能代理和Model Context Protocol (MCP)，提供完整的AI工具调用解决方案。

## 🚀 核心特性

- **智能代理系统**: 基于ReAct(推理-行动-反思)架构的自主Agent
- **MCP协议支持**: 完整实现Model Context Protocol，动态连接外部工具服务器
- **多模型支持**: 支持GitHub Models、Gemini等多种AI模型
- **长期记忆**: MongoDB存储的用户交互历史和偏好记忆
- **丰富工具集**: 搜索、图像生成、网页抓取等内置工具
- **异步架构**: 基于FastAPI和asyncio的高性能异步处理

## 📋 技术栈

- **框架**: FastAPI + Python 3.11+
- **数据库**: MongoDB + SQLite
- **AI模型**: GitHub Models API, Google Gemini
- **Agent架构**: ReAct (Reasoning, Acting, Reflecting)
- **协议支持**: Model Context Protocol (MCP)

## ⚡ 快速开始

### 1. 环境配置

创建 `.env` 文件：

```env
# AI模型配置
GITHUB_INFERENCE_KEY=your_github_key
GITHUB_ENDPOINT=https://models.inference.ai.azure.com
GEMINI_API_KEY=your_gemini_key

# 数据库配置
MONGODB_URL=mongodb://localhost:27017/agent
SQLITE_DB=./data/agent.db

# 工具配置
CLOUDFLARE_API_KEY=your_cloudflare_key
CLOUDFLARE_ACCOUNT_ID=your_account_id

# 安全配置
ADMIN_API_KEY=your_admin_key
```

### 2. 安装与运行

```bash
# 安装依赖
pip install -r requirements.txt

# 启动服务
uvicorn main:app --reload

# 或使用Docker
docker-compose up -d
```

### 3. 访问服务

- API文档: http://localhost:8000/docs
- 健康检查: http://localhost:8000/health

## 🤖 Agent使用示例

### 基础对话

```python
import requests

response = requests.post("http://localhost:8000/api/v1/agent/run", 
    headers={"X-API-KEY": "your_key"},
    json={
        "prompt": "查找最新的AI研究进展并生成相关图片",
        "user_id": "user123",
        "model": "gpt-4o",
        "enable_mcp": True
    }
)
```

### MCP工具调用

```python
# 获取可用工具
tools = requests.get("http://localhost:8000/api/v1/mcp/tools",
    headers={"X-API-KEY": "your_key"}
)

# 调用特定工具
result = requests.post("http://localhost:8000/api/v1/mcp/tools/call",
    headers={"X-API-KEY": "your_key"},
    json={
        "tool_name": "github.searchRepositories",
        "parameters": {"query": "python AI", "maxResults": 5}
    }
)
```

## 📚 文档

- [Agent技术文档](docs/Agent_Technical_Documentation.md) - ReAct架构和Agent实现详解
- [MCP技术文档](docs/MCP_Technical_Documentation.md) - Model Context Protocol集成指南
- [API参考](http://localhost:8000/docs) - 完整的API接口文档

## 🏗️ 项目结构

```
app/
├── core/           # 核心配置和依赖
├── models/         # 数据模型定义
├── routers/        # API路由
├── services/       # 业务逻辑服务
│   ├── agent_service.py    # Agent核心服务
│   ├── mcp_client.py       # MCP客户端
│   └── llm_service.py      # LLM服务
└── utils/          # 工具函数
data/
├── mcp_servers.json        # MCP服务器配置
└── images/                 # 生成的图片存储
docs/               # 技术文档
```

## 🔧 配置说明

### MCP服务器配置

在 `data/mcp_servers.json` 中配置外部工具服务器：

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your_token"
      },
      "enabled": true
    }
  }
}
```

### Agent配置参数

```python
# Agent执行配置
AGENT_MAX_STEPS = 10              # 最大执行步骤
AGENT_REFLECTION_THRESHOLD = 3    # 反思触发阈值
AGENT_CONFIDENCE_THRESHOLD = 0.8  # 置信度阈值
```

## 🚀 性能特性

- **并发处理**: 支持多用户并发请求
- **资源管理**: 自动清理MCP子进程和连接
- **错误处理**: 完善的异常处理和重试机制
- **使用量控制**: 内置的用户调用频次限制

## 🛠️ 开发指南

### 添加新工具

1. 在 `app/utils/tools.py` 中定义工具函数
2. 注册到工具系统
3. 更新Agent系统提示词

### 集成新的MCP服务器

1. 更新 `data/mcp_servers.json` 配置
2. 重启应用或调用初始化接口
3. 新工具将自动被发现

## 🤝 贡献

欢迎提交Issue和Pull Request！

1. Fork项目
2. 创建特性分支
3. 提交更改
4. 创建Pull Request

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

---

**最新更新 (2025.05)**
- ✅ 完善ReAct架构Agent实现
- ✅ 优化MCP客户端稳定性
- ✅ 增强工具调用和错误处理
- ✅ 改进内存管理和资源清理
