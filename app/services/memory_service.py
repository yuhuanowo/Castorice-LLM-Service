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
from app.services.llm_service import llm_service

settings = get_settings()


class MemoryService:
    """記憶服務類"""
    def __init__(self):
        self.memory_model = "gemma-3-27b-it"  # 用於記憶處理的模型
        
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
            # 標記記憶更新開始
            logger.info(f"開始記憶更新過程，使用者ID: {user_id}")
            
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
            
            # 構建記憶模板 - 使用配置中的模板
            template_begin = settings.PROMPT_MEMORY_TEMPLATE_BEGIN.format(
                memory_text=memory_text,
                conversation_text=conversation_text,
                prompt=prompt
            )
            
            # 使用配置中的JSON模板
            template_json = settings.PROMPT_MEMORY_TEMPLATE_JSON
            
            # 合併模板
            llamaprompt = template_begin + template_json
            
            # 準備消息數組
            messages = [
                {
                    "role": "system",
                    "content": settings.PROMPT_MEMORY_SYSTEM
                },
                { 
                    "role": "user", 
                    "content": llamaprompt 
                }
            ]
            
            logger.info(f"發送記憶更新請求，使用者ID: {user_id}")
            
            try:
                # 使用llm_service發送請求
                result = await llm_service.send_llm_request(
                    messages=messages,
                    model_name=self.memory_model,
                    skip_content_check=True  # 跳過內容長度檢查，因為我們已經在模板中控制了長度
                )
                
                if not result or "choices" not in result or not result["choices"]:
                    logger.error("記憶更新回應格式無效")
                    logger.error(f"API返回的完整结果: {json.dumps(result, ensure_ascii=False)}")
                    return memory_text
                
                # 提取生成的記憶
                memory_update = result["choices"][0]["message"]["content"]
                
                # 记录返回的内容长度和部分内容
                logger.info(f"记憶更新內容長度: {len(memory_update)} 字符")
                logger.info(f"记憶更新前10字符: {memory_update[:10]}...")
                
                # 检查返回内容是否过短
                if len(memory_update) < 50:
                    logger.warning(f"警告: 记憶更新內容過短({len(memory_update)}字符): {memory_update}")
                    # 尝试获取完整的响应信息
                    logger.warning(f"完整响应: {json.dumps(result, ensure_ascii=False)}")
                
                # 更新MongoDB中的記憶
                update_user_memory(user_id, memory_update)
                logger.info(f"記憶更新完成，使用者ID: {user_id}")
                
                return memory_update
            except httpx.ReadTimeout:
                logger.error(f"記憶更新請求超時，使用者ID: {user_id}")
                return memory_text
            except Exception as e:
                logger.error(f"記憶更新API請求錯誤: {str(e)}")
                return memory_text
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
