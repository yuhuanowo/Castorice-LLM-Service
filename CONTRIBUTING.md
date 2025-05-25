# 貢獻指南

感謝您考慮為 Castorice AI Agent API 服務器做出貢獻！我們歡迎來自社區的所有貢獻，無論是錯誤報告、功能請求、文檔改進還是程式碼貢獻。

## 如何貢獻

### 報告問題

如果您發現了錯誤或有功能請求，請提交一個詳細的 Issue。請確保：

1. 首先檢查現有 Issues，避免重複
2. 提供詳細的描述，包括：
   - 問題的清晰描述
   - 複現步驟
   - 預期行為與實際行為
   - 環境資訊（操作系統、Python版本等）
   - 如有可能，附上相關日誌或截圖

### 提交程式碼

1. Fork 本倉庫
2. 創建您的特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交您的改動 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 創建新的 Pull Request

### 程式碼規範

- 遵循 PEP 8 Python 程式碼風格指南
- 為所有新函數和類編寫適當的文檔字符串
- 添加必要的單元測試
- 確保所有測試通過
- 保持程式碼簡潔清晰

### 開發環境設置

```bash
# 克隆程式碼庫
git clone https://github.com/yourusername/castorice-ai-agent.git
cd castorice-ai-agent

# 創建虛擬環境
python -m venv venv
source venv/bin/activate  # Linux/Mac
# 或
venv\Scripts\activate  # Windows

# 安裝依賴
pip install -r requirements.txt
pip install -r dev-requirements.txt
```

## 開發流程

1. 選擇一個要解決的問題或實現的功能
2. 討論您的解決方案方法（如適用）
3. 開發並測試您的更改
4. 提交 Pull Request 進行審核

## 溝通渠道

- GitHub Issues: 用於錯誤報告和功能請求
- Discussions: 用於一般討論和問題

## 行為準則

請參閱我們的 [行為準則](CODE_OF_CONDUCT.md)，了解我們的社區標準。

再次感謝您的貢獻！
