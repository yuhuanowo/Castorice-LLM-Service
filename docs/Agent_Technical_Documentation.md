# AI Agent 技術文檔

## 核心概念

AI Agent是一個自主智能系統，能夠分析用戶需求，規劃解決方案，使用工具執行任務，觀察結果，並根據需要調整計劃以完成用戶的請求。我們的實現基於ReAct（Reasoning, Acting, Reflecting）架構，結合了Model Context Protocol (MCP)支援。

## 架構設計

### 狀態管理

Agent系統使用狀態機進行工作流程管理，包含以下狀態：

```
IDLE → PLANNING → EXECUTING → OBSERVING → REFLECTING → RESPONDING → (完成/返回到PLANNING)
```

每個狀態對應Agent工作流程中的特定階段：

- **IDLE**：初始狀態，等待用戶輸入
- **PLANNING**：分析用戶需求，制定任務計劃
- **EXECUTING**：執行工具調用或操作
- **OBSERVING**：分析工具執行結果
- **REFLECTING**：評估當前進度，決定是否需要調整計劃
- **RESPONDING**：生成最終回覆
- **ERROR**：錯誤狀態，處理異常情況

### 執行模式

系統支援三種執行模式：

1. **MCP模式**：使用Model Context Protocol連接外部工具伺服器
2. **ReAct模式**：基於推理、行動、反思循環的自主執行模式
3. **簡單模式**：直接調用LLM，不使用複雜的工具調用和規劃流程

### 關鍵組件

- **AgentService**：核心服務類，管理整個Agent的生命週期
- **工具系統**：提供Agent可用的功能，包括搜索、圖像生成等
- **記憶系統**：管理短期和長期記憶，支援上下文理解
- **MCP客戶端**：連接外部工具伺服器的接口

## 關鍵功能

### 1. 任務規劃

Agent會首先分析用戶請求，然後將其分解為子任務。規劃過程使用JSON結構化輸出：

```json
{
  "taskAnalysis": "對任務的整體分析",
  "subtasks": [
    {
      "id": "子任務ID",
      "description": "子任務描述",
      "toolsNeeded": ["工具1", "工具2"],
      "priority": 優先級(1-5，1最高)
    }
  ],
  "executionOrder": ["子任務ID1", "子任務ID2", "子任務ID3"]
}
```

### 2. 工具執行

Agent能夠調用多種工具完成任務，包括但不限於：

- **搜索引擎**：獲取網絡信息
- **網頁內容獲取**：深入分析特定網頁
- **圖像生成**：創建符合描述的圖像
- **MCP工具**：使用外部工具伺服器提供的功能

### 3. 反思與調整

執行過程中，Agent會定期反思當前進度，評估成功與失敗的步驟，並根據需要調整計劃：

```json
{
  "assessment": "整體評估",
  "failedSteps": ["步驟1", "步驟2"],
  "adjustments": ["調整1", "調整2"],
  "userInputNeeded": true/false,
  "userQuestion": "需要詢問用戶的問題(如果需要)"
}
```

### 4. 記憶管理

Agent使用兩級記憶系統：

- **短期記憶**：當前對話上下文
- **長期記憶**：用戶偏好、歷史互動等持久化信息

### 5. MCP整合

與Model Context Protocol的整合使Agent能夠訪問外部工具伺服器提供的各種功能，極大擴展了Agent的能力範圍。

## 使用示例

### 基本用法

```python
from app.services.agent_service import agent_service

# 執行Agent請求
result = await agent_service.run(
    user_id="user123",
    prompt="幫我找到關於人工智能最新研究的信息並生成一張相關圖片",
    model_name="gpt-4o",
    enable_memory=True,
    enable_reflection=True,
    enable_mcp=True
)
```

### 高級配置

```python
# 使用自定義系統提示和工具配置
result = await agent_service.run(
    user_id="user123",
    prompt="分析這個網站的SEO情況",
    model_name="gpt-4o",
    system_prompt_override={
        "role": "system",
        "content": "你是一個SEO專家..."
    },
    tools_config={
        "enable_search": True,
        "include_advanced_tools": True
    }
)
```

## 性能與限制

- **最大步驟數**：默認限制為10個執行步驟，可通過配置調整
- **反思閾值**：每執行3個步驟觸發一次反思，可配置
- **超時設置**：工具調用默認超時時間為30秒

## 未來改進方向

1. 增強Agent的元認知能力，提高自我糾錯能力
2. 改進任務分解邏輯，更精確地識別子任務
3. 加入協作Agent支援，允許多個Agent共同解決複雜問題
4. 優化記憶檢索算法，提高上下文理解的準確性
5. 擴展工具系統，支援更多種類的操作
