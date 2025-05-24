# 开发指南

## 🚀 快速开始

### 环境要求

- Python 3.11+
- MongoDB 4.4+
- Node.js 16+ (用于MCP服务器)
- Git

### 本地开发设置

1. **克隆项目**
   ```bash
   git clone <repository-url>
   cd fastapi-template
   ```

2. **创建虚拟环境**
   ```bash
   python -m venv .venv
   # Windows
   .venv\Scripts\activate
   # Linux/Mac
   source .venv/bin/activate
   ```

3. **安装依赖**
   ```bash
   pip install -r requirements.txt
   pip install -r dev-requirements.txt  # 开发依赖
   ```

4. **配置环境变量**
   ```bash
   cp .env.example .env
   # 编辑 .env 文件，填入必要的API密钥
   ```

5. **启动数据库**
   ```bash
   # MongoDB (如果本地安装)
   mongod
   
   # 或使用Docker
   docker run -d -p 27017:27017 --name mongodb mongo:latest
   ```

6. **运行应用**
   ```bash
   uvicorn main:app --reload --port 8000
   ```

## 🧪 开发工作流

### 代码结构

```
app/
├── core/               # 核心配置
│   ├── config.py      # 环境配置
│   └── dependencies.py # 依赖注入
├── models/            # 数据模型
│   ├── mongodb.py     # MongoDB模型
│   └── sqlite.py      # SQLite模型
├── routers/           # API路由
│   ├── api.py         # 通用API
│   └── agent.py       # Agent专用API
├── services/          # 业务逻辑
│   ├── agent_service.py    # Agent核心服务
│   ├── mcp_client.py       # MCP客户端
│   ├── llm_service.py      # LLM调用服务
│   └── memory_service.py   # 记忆管理
└── utils/             # 工具函数
    ├── logger.py      # 日志工具
    └── tools.py       # 内置工具
```

### 添加新功能

#### 1. 添加新的内置工具

在 `app/utils/tools.py` 中添加：

```python
async def your_new_tool(parameter: str) -> str:
    """
    工具描述
    
    Args:
        parameter: 参数描述
    
    Returns:
        工具执行结果
    """
    try:
        # 实现工具逻辑
        result = do_something(parameter)
        return f"成功: {result}"
    except Exception as e:
        logger.error(f"工具执行失败: {e}")
        return f"错误: {str(e)}"

# 在 get_available_tools() 中注册工具
def get_available_tools():
    return {
        # ...existing tools...
        "your_new_tool": {
            "name": "your_new_tool",
            "description": "您的新工具描述",
            "parameters": {
                "type": "object",
                "properties": {
                    "parameter": {
                        "type": "string",
                        "description": "参数描述"
                    }
                },
                "required": ["parameter"]
            }
        }
    }
```

#### 2. 添加新的API端点

在 `app/routers/` 中创建新路由：

```python
from fastapi import APIRouter, Depends, HTTPException
from app.core.dependencies import get_api_key

router = APIRouter(prefix="/api/v1/your-feature", tags=["your-feature"])

@router.post("/endpoint")
async def your_endpoint(
    request: YourRequestModel,
    api_key: str = Depends(get_api_key)
):
    """
    端点描述
    """
    try:
        # 实现业务逻辑
        result = await your_service.process(request)
        return {"status": "success", "data": result}
    except Exception as e:
        logger.error(f"处理失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))
```

在 `main.py` 中注册路由：

```python
from app.routers import your_feature

app.include_router(your_feature.router)
```

#### 3. 配置MCP服务器

在 `data/mcp_servers.json` 中添加配置：

```json
{
  "mcpServers": {
    "your-server": {
      "command": "node",
      "args": ["path/to/your-mcp-server.js"],
      "env": {
        "API_KEY": "your_api_key",
        "CONFIG_OPTION": "value"
      },
      "enabled": true,
      "timeout": 30,
      "description": "您的MCP服务器描述"
    }
  }
}
```

### 测试指南

#### 单元测试

创建测试文件 `tests/test_your_feature.py`：

```python
import pytest
from app.services.your_service import YourService

@pytest.mark.asyncio
async def test_your_function():
    service = YourService()
    result = await service.your_function("test_input")
    assert result is not None
    assert "expected_value" in result

def test_validation():
    # 测试输入验证
    with pytest.raises(ValueError):
        YourService().validate_input("")
```

#### 集成测试

创建 `scripts/test_integration.py`：

```python
import asyncio
import aiohttp

async def test_api_endpoint():
    async with aiohttp.ClientSession() as session:
        async with session.post(
            "http://localhost:8000/api/v1/your-feature/endpoint",
            headers={"X-API-KEY": "test_key"},
            json={"test": "data"}
        ) as response:
            assert response.status == 200
            data = await response.json()
            print(f"Response: {data}")

if __name__ == "__main__":
    asyncio.run(test_api_endpoint())
```

#### MCP工具测试

使用 `scripts/debug_mcp_tools.py`：

```python
# 调试特定MCP工具
await debug_specific_tool("your_tool_name", {"param": "value"})
```

### 调试技巧

#### 1. 启用详细日志

在 `.env` 中设置：

```env
LOG_LEVEL=DEBUG
LOG_FORMAT=detailed
```

#### 2. 使用调试脚本

```bash
# 测试MCP连接
python scripts/debug_mcp_tools.py

# 测试特定服务
python scripts/test_agent_service.py
```

#### 3. API调试

使用Swagger UI: http://localhost:8000/docs

或使用curl：

```bash
curl -X POST "http://localhost:8000/api/v1/agent/run" \
  -H "X-API-KEY: your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "测试请求",
    "user_id": "test_user",
    "model": "gpt-4o"
  }'
```

## 📝 代码规范

### Python代码风格

- 使用 Black 进行代码格式化
- 遵循 PEP 8 规范
- 使用类型注解
- 编写详细的文档字符串

```python
async def example_function(
    param1: str, 
    param2: Optional[int] = None
) -> Dict[str, Any]:
    """
    函数示例
    
    Args:
        param1: 必需参数描述
        param2: 可选参数描述
    
    Returns:
        返回值描述
    
    Raises:
        ValueError: 错误条件描述
    """
    if not param1:
        raise ValueError("param1 不能为空")
    
    return {"result": param1, "count": param2 or 0}
```

### 错误处理

使用一致的错误处理模式：

```python
from app.utils.logger import logger

async def your_function():
    try:
        result = await risky_operation()
        logger.info("操作成功", extra={"operation": "your_function"})
        return result
    except SpecificException as e:
        logger.warning(f"预期错误: {e}")
        return {"error": "user_friendly_message"}
    except Exception as e:
        logger.error(f"未预期错误: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="内部服务器错误")
```

### 提交规范

使用语义化提交信息：

```
feat: 添加新的搜索工具
fix: 修复MCP连接超时问题
docs: 更新API文档
refactor: 重构Agent状态管理
test: 添加工具调用测试
```

## 🚀 部署指南

### Docker部署

```dockerfile
# 使用多阶段构建
FROM python:3.11-slim as builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.11-slim
WORKDIR /app
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 生产环境配置

```env
# 生产环境配置
NODE_ENV=production
LOG_LEVEL=INFO
WORKERS=4
TIMEOUT=300
```

### 监控设置

使用健康检查端点：

```python
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "version": "1.0.0"
    }
```

这个开发指南提供了完整的开发工作流程，帮助新的开发者快速上手项目。
