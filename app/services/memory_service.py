from typing import List, Dict, Any, Optional
import httpx
import json
from datetime import datetime

from app.utils.logger import logger
from app.core.config import get_settings
from app.models.mongodb import (
    get_chat_logs, 
    update_user_memory, 
    get_user_memory,
    get_chat_by_interaction_id
)

settings = get_settings()


class MemoryService:
    """記憶服務類"""
    def __init__(self):
        self.endpoint = settings.AZURE_ENDPOINT
        self.api_key = settings.AZURE_INFERENCE_KEY
        self.api_version = settings.AZURE_API_VERSION
        self.memory_model = "Meta-Llama-3.1-8B-Instruct"  # 用於記憶處理的模型
    async def update_memory(self, user_id: str, prompt: str) -> str:
        """
        更新用戶長期記憶
        
        Args:
            user_id: 用戶ID
            prompt: 最新提示
            
        Returns:
            更新後的記憶
        """
        try:
            # 獲取最近對話記錄
            recent_logs = get_chat_logs(user_id, 5)
            conversations = []
            
            for log in recent_logs:
                conversations.append({
                    "prompt": log.get("prompt", ""),
                    "reply": log.get("reply", "")
                })
                
            # 獲取現有記憶
            memory_text = get_user_memory(user_id)
            
            # 構建對話歷史部分
            conversation_history = []
            for i, c in enumerate(conversations, 1):
                conversation_history.append(f"對話 {i}：提問：{c['prompt']}")
            
            conversation_text = "\n".join(conversation_history)
            
            # 構建記憶模板 - 避免使用大型嵌套f-string
            template_begin = f"""
            以下是過去建立的長期記憶資訊，請務必將此導入新的記憶中，但不要再次提及已有內容，以免重複記憶，但更不要將這些內容忘記。
            
            {memory_text}
            
            以下是用戶近期的對話提問記錄：
            {conversation_text}
            
            最新提問：{prompt}
            
            請根據這些提問，更新用戶的長期記憶，意旨複製上方舊的長期記憶並增加內容，抓取用戶的請求與要求，並且記住用戶隱私個資，進而推論出用戶的習慣與秘密。
            請確保你的回應簡潔但不隨意或殘缺，不回答變化、增加減少，不超過 500 字，並且專注於長期有用的資訊，注重於「以後、全都」等大範圍指令，並收集大量資訊，而不是短期少量的對話細節。最後，請完成以下個資表單，但不要填入額外資訊，避免污染資料庫。請用條列方式提供以下資訊：
            
            1. **語氣與風格**（如正式/非正式、幽默/嚴肅、直接/委婉）
            2. **常見關注主題**（如：科技、遊戲、小說、AI、大型語言模型）
            3. **資訊需求類型**（如簡要回答/詳細解釋/專業推薦/技術指導）
            4. **互動模式**（如傾向問開放性問題/下明確指令/偏好對話式互動）
            5. **其他值得記住的個人特徵**（如喜歡具體舉例、喜歡條列式回答、特定詞彙風格）"""
            
            # 構建JSON模板部分
            template_json = """
            基本資訊: {
              "名稱": "",
              "性別": "",
              "年齡": "",
              "語言": [],
              "所在地": "",
              "聯絡方式": {
                "Email": "",
                "社交媒體": {
                  "GitHub": "",
                  "Twitter": "",
                  "LinkedIn": "",
                  "其他": []
                }
              }
            },
            興趣與愛好: {
              "遊戲": [],
              "音樂": [],
              "電影與影視": [],
              "閱讀": [],
              "運動與健身": [],
              "攝影": {
                "設備": [],
                "風格偏好": []
              },
              "旅行": {
                "目的地": [],
                "旅行風格": ""
              },
              "科技與科學": [],
              "藝術與設計": []
            },
            學習與技能: {
              "學習語言": [],
              "專業領域": [],
              "程式設計與技術": {
                "程式語言": [],
                "框架與工具": [],
                "資料處理": [],
                "機器學習與AI": [],
                "開發環境": ""
              },
              "學習目標": []
            },
            職業與工作: {
              "職業": "",
              "公司": "",
              "行業": "",
              "工作內容": "",
              "技能": [],
              "過去專案": [],
              "職業目標": ""
            },
            個人風格: {
              "性格特質": [],
              "MBTI": "",
              "溝通方式": "",
              "決策風格": "",
              "喜歡的內容呈現方式": ""
            },
            設備與使用環境: {
              "電腦": {
                "品牌": "",
                "型號": "",
                "作業系統": "",
                "主要用途": ""
              },
              "手機": {
                "品牌": "",
                "型號": "",
                "作業系統": ""
              },
              "其他設備": []
            },
            社交與心理: {
              "社交偏好": "",
              "心理特徵": [],
              "價值觀": [],
              "動機": [],
              "壓力與擔憂": []
            },
            使用AI需求: {
              "資訊需求類型": "",
              "互動模式": "",
              "回應風格偏好": "",
              "使用頻率": "",
              "主要用途": []
            }
            """
            
            # 合併模板
            llamaprompt = template_begin + template_json
            
            # 發送請求
            url = f"{self.endpoint}/chat/completions"
            headers = {
                "api-key": self.api_key,
                "Content-Type": "application/json"
            }
            
            body = {
                "messages": [
                    {
                        "role": "system",
                        "content": "你是一個對話記憶整理助手，專門負責從過去的對話記錄中提取用戶的長期交流習慣。你的任務是根據提供的舊對話與新對話，總結出應該記住的用戶特徵，並忽略短期、不重要的資訊。請確保你的總結簡明扼要，只關注用戶的習慣和長期特徵，而不是具體的對話內容。"
                    },
                    { 
                        "role": "user", 
                        "content": llamaprompt 
                    }
                ],
                "model": self.memory_model
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    url,
                    headers=headers,
                    json=body,
                    timeout=60.0
                )
                
                if response.status_code != 200:
                    logger.error(f"記憶更新API錯誤 {response.status_code}: {response.text}")
                    return memory_text
                
                result = response.json()
                if not result or "choices" not in result or not result["choices"]:
                    logger.error("記憶更新回應格式無效")
                    return memory_text
                
                # 提取生成的記憶
                memory_update = result["choices"][0]["message"]["content"]
                
                # 確保整個多行文本都被正確保存
                # 檢查返回的內容是否是有效字符串
                if not isinstance(memory_update, str):
                    logger.error(f"記憶更新返回的內容不是字符串: {type(memory_update)}")
                    return memory_text
                
                # 記錄一下收到的完整記憶內容
                logger.info(f"處理記憶更新: 長度={len(memory_update)}, 前50個字符={memory_update[:50]}")
                
                # 更新MongoDB中的記憶
                update_user_memory(user_id, memory_update)
                
                return memory_update
        except Exception as e:
            logger.error(f"記憶更新錯誤: {str(e)}")
            return memory_text

    async def get_memory(self, user_id: str) -> str:
        """
        獲取用戶記憶
        
        Args:
            user_id: 用戶ID
            
        Returns:
            用戶記憶
        """
        return get_user_memory(user_id)

    async def get_history_by_id(self, history_id: str, user_id: str) -> Optional[Dict[str, str]]:
        """
        根據ID獲取歷史對話
        
        Args:
            history_id: 歷史對話ID
            user_id: 用戶ID
            
        Returns:
            歷史對話
        """
        result = get_chat_by_interaction_id(history_id, user_id)
        if result:
            return {
                "prompt": result.get("prompt", ""),
                "reply": result.get("reply", "")
            }
        return None


memory_service = MemoryService()
