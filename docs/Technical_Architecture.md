# 技術架構概覽

## 🏗️ 系統架構

本項目採用分層架構設計，將AI Agent功能、MCP協議支持和傳統API服務有機結合。

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

## 🧠 Agent系統設計

### ReAct架構實現

基於Reasoning (推理), Acting (行動), Reflecting (反思) 的三階段循環：

```python
class AgentState(Enum):
    IDLE = "idle"              # 閒置狀態
    PLANNING = "planning"      # 規劃階段
    EXECUTING = "executing"    # 執行階段  
    OBSERVING = "observing"    # 觀察階段
    REFLECTING = "reflecting"  # 反思階段
    RESPONDING = "responding"  # 回應階段
```

### 執行流程

1. **任務理解**: 分析用戶輸入，識別意圖
2. **計劃制定**: 分解任務為可執行的子步驟
3. **工具選擇**: 根據子任務選擇合適的工具
4. **執行監控**: 實時跟蹤工具執行狀態
5. **結果評估**: 分析執行結果的有效性
6. **計劃調整**: 根據評估結果調整後續計劃
7. **最終回應**: 整合結果生成用戶回答

## 🔌 MCP協議整合

### 設計理念

MCP作為"通用USB接口"，實現動態工具擴展：

- **純接口設計**: 不包含硬編碼工具
- **動態發現**: 運行時發現外部工具伺服器
- **協議標準**: 嚴格遵循MCP官方規範
- **傳輸無關**: 支援多種通信協議

### 通信流程

```
Agent Request → MCP Client → Protocol Translation → External Server
      ↓              ↓              ↓                     ↓
Tool Selection → Session Mgmt → Message Routing → Tool Execution
      ↓              ↓              ↓                     ↓
Result Processing ← Error Handling ← Response Parsing ← Tool Response
```

## 🛠️ 工具系統

### 內置工具

- **搜索工具**: DuckDuckGo網絡搜索
- **圖像生成**: 基於DALL-E的圖像創建
- **網頁抓取**: 獲取和解析網頁內容
- **記憶管理**: 用戶偏好和歷史查詢

### 外部工具 (通過MCP)

- **GitHub整合**: 代碼搜索、倉庫管理
- **資料庫操作**: PostgreSQL查詢和管理
- **文件系統**: 文件讀寫和目錄操作
- **API調用**: 各種第三方服務整合

## 💾 資料管理

### MongoDB (主要存儲)
```javascript
// 用戶記憶文檔結構
{
  userId: "user123",
  memories: [
    {
      type: "preference",
      content: "用戶偏好使用中文回答",
      timestamp: "2025-05-24T10:30:00Z",
      relevance: 0.9
    }
  ],
  chatHistory: [...],
  lastUpdated: "2025-05-24T10:30:00Z"
}
```

### SQLite (使用量統計)
```sql
-- 用戶使用量表
CREATE TABLE user_usage (
  user_id TEXT PRIMARY KEY,
  model_name TEXT,
  request_count INTEGER,
  last_request_date TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 🔐 安全機制

### API安全
- **密鑰驗證**: X-API-KEY頭部驗證
- **速率限制**: 防止API濫用
- **輸入驗證**: 嚴格的參數校驗

### MCP安全
- **進程隔離**: 外部工具在獨立進程中運行
- **憑證管理**: 環境變數傳遞敏感信息
- **資源限制**: 超時和資源使用限制

## ⚡ 性能優化

### 非同步處理
```python
# 併發工具調用示例
async def execute_multiple_tools(tool_calls):
    tasks = [
        execute_tool(tool_name, params) 
        for tool_name, params in tool_calls
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return results
```

### 快取策略
- **工具描述快取**: 減少MCP伺服器查詢
- **用戶偏好快取**: 加速記憶檢索
- **模型響應快取**: 對相似查詢複用結果

### 資源管理
- **連接池**: HTTP/WebSocket連接複用
- **記憶體管理**: 及時清理大對象
- **進程清理**: 自動終止僵屍MCP進程

## 📊 監控與調試

### 日誌系統
```python
# 結構化日誌示例
logger.info("Agent執行完成", extra={
    "user_id": user_id,
    "steps_taken": steps_count,
    "execution_time": execution_time,
    "tools_used": tool_names,
    "success": success_status
})
```

### 錯誤處理
- **分級錯誤處理**: 不同錯誤類型的不同處理策略
- **自動重試**: 臨時性錯誤的自動恢復
- **優雅降級**: 部分功能失效時的備選方案

## 🔄 擴展性設計

### 新工具整合
1. 內置工具: 在`app/utils/tools.py`中添加
2. MCP工具: 配置`data/mcp_servers.json`
3. 自動發現: 系統啟動時自動註冊

### 新模型支援
1. 在`llm_service.py`中添加模型提供商
2. 更新API密鑰配置
3. 測試模型兼容性

### 新協議支援
1. 實現協議適配器
2. 添加到傳輸層
3. 更新配置系統

這種模組化、分層的架構設計確保了系統的可維護性、可擴展性和高性能。
