# 開發指南

## 🚀 快速開始

### 環境要求

- Python 3.11+
- MongoDB 4.4+
- Node.js 16+ (用於MCP伺服器)
- Git

### 本地開發設置

1. **克隆專案**
   ```bash
   git clone <repository-url>
   cd fastapi-template
   ```

2. **建立虛擬環境**
   ```bash
   python -m venv .venv
   # Windows
   .venv\Scripts\activate
   # Linux/Mac
   source .venv/bin/activate
   ```

3. **安裝依賴**
   ```bash
   pip install -r requirements.txt
   pip install -r dev-requirements.txt  # 開發依賴
   ```

4. **配置環境變數**
   ```bash
   cp .env.example .env
   # 編輯 .env 文件，填入必要的API密鑰
   ```

5. **啟動資料庫**
   ```bash
   # MongoDB (如果本地安裝)
   mongod
   
   # 或使用Docker
   docker run -d -p 27017:27017 --name mongodb mongo:latest
   ```

6. **運行應用**
   ```bash
   uvicorn main:app --reload --port 8000
   ```

## 🧪 開發工作流

### 代碼結構

```
app/
├── core/               # 核心配置
│   ├── config.py      # 環境配置
│   └── dependencies.py # 依賴注入
├── models/            # 資料模型
│   ├── mongodb.py     # MongoDB模型
│   └── sqlite.py      # SQLite模型
├── routers/           # API路由
│   ├── api.py         # 通用API
│   └── agent.py       # Agent專用API
├── services/          # 業務邏輯
│   ├── agent_service.py    # Agent核心服務
│   ├── mcp_client.py       # MCP客戶端
│   ├── llm_service.py      # LLM調用服務
│   └── memory_service.py   # 記憶管理
└── utils/             # 工具函數
    ├── logger.py      # 日誌工具
    └── tools.py       # 內置工具
```

### 添加新功能

#### 1. 添加新的內置工具

在 `app/utils/tools.py` 中添加：

```python
async def your_new_tool(parameter: str) -> str:
    """
    工具描述
    
    Args:
        parameter: 參數描述
    
    Returns:
        工具執行結果
    """
    try:
        # 實現工具邏輯
        result = do_something(parameter)
        return f"成功: {result}"
    except Exception as e:
        logger.error(f"工具執行失敗: {e}")
        return f"錯誤: {str(e)}"

# 在 get_available_tools() 中註冊工具
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
                        "description": "參數描述"
                    }
                },
                "required": ["parameter"]
            }
        }
    }
```

#### 2. 添加新的API端點

在 `app/routers/` 中創建新路由：

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
    端點描述
    """
    try:
        # 實現業務邏輯
        result = await your_service.process(request)
        return {"status": "success", "data": result}
    except Exception as e:
        logger.error(f"處理失敗: {e}")
        raise HTTPException(status_code=500, detail=str(e))
```

在 `main.py` 中註冊路由：

```python
from app.routers import your_feature

app.include_router(your_feature.router)
```

#### 3. 配置MCP伺服器

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
      "description": "您的MCP伺服器描述"
    }
  }
}
```

### 測試指南

#### 單元測試

創建測試文件 `tests/test_your_feature.py`：

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
    # 測試輸入驗證
    with pytest.raises(ValueError):
        YourService().validate_input("")
```

#### 集成測試

創建 `scripts/test_integration.py`：

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

#### MCP工具測試

使用 `scripts/debug_mcp_tools.py`：

```python
# 調試特定MCP工具
await debug_specific_tool("your_tool_name", {"param": "value"})
```

### 調試技巧

#### 1. 啟用詳細日誌

在 `.env` 中設置：

```env
LOG_LEVEL=DEBUG
LOG_FORMAT=detailed
```

#### 2. 使用調試腳本

```bash
# 測試MCP連接
python scripts/debug_mcp_tools.py

# 測試特定服務
python scripts/test_agent_service.py
```

#### 3. API調試

使用Swagger UI: http://localhost:8000/docs

或使用curl：

```bash
curl -X POST "http://localhost:8000/api/v1/agent/run" \
  -H "X-API-KEY: your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "測試請求",
    "user_id": "test_user",
    "model": "gpt-4o"
  }'
```

## 📝 代碼規範

### Python代碼風格

- 使用 Black 進行代碼格式化
- 遵循 PEP 8 規範
- 使用類型註解
- 編寫詳細的文檔字符串

```python
async def example_function(
    param1: str, 
    param2: Optional[int] = None
) -> Dict[str, Any]:
    """
    函數示例
    
    Args:
        param1: 必需參數描述
        param2: 可選參數描述
    
    Returns:
        返回值描述
    
    Raises:
        ValueError: 錯誤條件描述
    """
    if not param1:
        raise ValueError("param1 不能為空")
    
    return {"result": param1, "count": param2 or 0}
```

### 錯誤處理

使用一致的錯誤處理模式：

```python
from app.utils.logger import logger

async def your_function():
    try:
        result = await risky_operation()
        logger.info("操作成功", extra={"operation": "your_function"})
        return result
    except SpecificException as e:
        logger.warning(f"預期錯誤: {e}")
        return {"error": "user_friendly_message"}
    except Exception as e:
        logger.error(f"未預期錯誤: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="內部伺服器錯誤")
```

### 提交規範

使用語義化提交信息：

```
feat: 添加新的搜索工具
fix: 修復MCP連接超時問題
docs: 更新API文檔
refactor: 重構Agent狀態管理
test: 添加工具調用測試
```

## 🚀 部署指南

### Docker部署

```dockerfile
# 使用多階段構建
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

### 生產環境配置

```env
# 生產環境配置
NODE_ENV=production
LOG_LEVEL=INFO
WORKERS=4
TIMEOUT=300
```

### 監控設置

使用健康檢查端點：

```python
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "version": "1.0.0"
    }
```

這個開發指南提供了完整的開發工作流程，幫助新的開發者快速上手項目。
