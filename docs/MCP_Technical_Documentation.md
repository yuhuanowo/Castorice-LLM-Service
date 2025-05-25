# Model Context Protocol (MCP) 技術文檔

## 概述

Model Context Protocol (MCP) 是一個開放標準協議，用於連接大型語言模型（LLM）與外部工具和資源。在我們的系統中，MCP客戶端實現了一個"通用USB接口"，使LLM能夠動態連接到各種外部伺服器，從而極大擴展AI系統的能力。

## 核心功能

### 1. 動態工具發現

MCP客戶端能夠在運行時發現和註冊外部伺服器提供的工具，無需預先硬編碼工具定義。這種設計使系統具有高度可擴展性，可以輕鬆整合新的工具伺服器。

### 2. 多傳輸協議支援

MCP客戶端支援多種傳輸協議：

- **STDIO**：通過標準輸入/輸出與子進程通信
- **HTTP/SSE**：通過HTTP和伺服器發送事件與Web服務通信
- **WebSocket**：支援雙向實時通信

### 3. 資源管理

除了工具調用外，MCP還支援資源管理，允許外部伺服器提供各種資源（如文檔、圖像等）供LLM訪問。

### 4. 會話管理

MCP客戶端管理與外部伺服器的會話生命週期，包括啟動、維護和清理過程。

## 架構設計

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

### 核心組件

1. **MCPClient**：主客戶端類，管理伺服器連接和工具調用
2. **MCPServer**：表示外部MCP伺服器的配置和狀態
3. **MCPTool**：表示外部伺服器提供的工具定義
4. **MCPResource**：表示外部伺服器提供的資源定義

## 配置管理

MCP伺服器配置存儲在`data/mcp_servers.json`文件中，格式如下：

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

### 1. 初始化MCP客戶端

```python
from app.services.mcp_client import mcp_client, init_mcp_client

# 初始化MCP客戶端（應用啟動時調用）
await init_mcp_client()

# 檢查可用工具
available_tools = mcp_client.get_available_tools()
print(f"發現 {len(available_tools)} 個MCP工具")
```

### 2. 工具調用

```python
# 調用MCP工具
result = await mcp_client.call_tool("github.searchRepositories", {
    "query": "language:python stars:>1000",
    "maxResults": 5
})

# 處理結果
for repo in result.get("repositories", []):
    print(f"倉庫: {repo['name']} - 星標: {repo['stars']}")
```

### 3. 資源訪問

```python
# 獲取可用資源
resources = mcp_client.get_available_resources()

# 訪問特定資源
resource_content = await mcp_client.get_resource("documentation/api-reference")
```

## 錯誤處理

MCP客戶端實現了健壯的錯誤處理機制：

1. **連接錯誤**：當無法連接到外部伺服器時，提供明確的診斷信息
2. **工具調用錯誤**：捕獲並處理工具執行過程中的異常
3. **超時處理**：為工具調用設置超時限制，防止長時間阻塞
4. **資源清理**：確保在應用關閉時正確清理所有子進程和連接

## 安全考慮

1. **隔離執行**：外部工具在單獨的進程中執行，減少對主應用的風險
2. **憑證管理**：敏感憑證通過環境變數傳遞，避免硬編碼
3. **輸入驗證**：工具調用前驗證輸入參數，防止注入攻擊

## 性能優化

1. **連接池**：對HTTP/WebSocket連接使用連接池，減少建立連接的開銷
2. **子進程管理**：優化子進程生命週期，減少資源消耗
3. **非同步IO**：全面使用非同步操作，避免阻塞主線程

## 調試與監控

MCP客戶端提供詳細的日誌記錄，幫助診斷問題：

```python
# 獲取伺服器狀態
status = mcp_client.get_server_status()
print(f"伺服器狀態: {status}")

# 執行診斷
diagnostic = await mcp_client.run_diagnostic()
print(f"診斷結果: {diagnostic}")
```

## 示例：整合新的MCP伺服器

1. 在`data/mcp_servers.json`中添加新伺服器配置
2. 重啟應用或調用`await init_mcp_client()`重新初始化
3. 新伺服器的工具將自動被發現並可用

## 未來擴展

1. **服務發現**：實現自動服務發現機制，無需手動配置
2. **認證機制**：增強安全認證系統
3. **工具編排**：支援多個工具的協同工作流
4. **更多傳輸協議**：增加對更多傳輸協議的支援
