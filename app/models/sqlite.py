import sqlite3
from app.core.config import get_settings
import logging

settings = get_settings()
logger = logging.getLogger(__name__)

# 初始化SQLite连接和表
def init_sqlite():
    """初始化SQLite数据库"""
    try:
        # 连接到SQLite数据库
        conn = sqlite3.connect(settings.SQLITE_DB)
        cursor = conn.cursor()
        
        # 创建聊天记录表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chat_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                model TEXT,
                prompt TEXT,
                reply TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                interaction_id TEXT
            )
        ''')
        
        # 创建用户使用量表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS usage_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                model TEXT,
                date TEXT,
                count INTEGER DEFAULT 1,
                UNIQUE(user_id, model, date)
            )
        ''')
        
        conn.commit()
        conn.close()
        logger.info("SQLite数据库初始化成功")
    except Exception as e:
        logger.error(f"SQLite数据库初始化失败: {str(e)}")


def create_chat_log_sqlite(user_id: str, model: str, prompt: str, reply: str, interaction_id: str = None):
    """创建聊天记录"""
    try:
        conn = sqlite3.connect(settings.SQLITE_DB)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO chat_log (user_id, model, prompt, reply, interaction_id) VALUES (?, ?, ?, ?, ?)",
            (user_id, model, prompt, reply, interaction_id)
        )
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        logger.error(f"创建聊天记录失败: {str(e)}")
        return False


def update_usage_sqlite(user_id: str, model: str, date: str):
    """更新用户使用量"""
    try:
        conn = sqlite3.connect(settings.SQLITE_DB)
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO usage_stats (user_id, model, date, count)
            VALUES (?, ?, ?, 1)
            ON CONFLICT(user_id, model, date) 
            DO UPDATE SET count = count + 1
            """,
            (user_id, model, date)
        )
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        logger.error(f"更新使用量失败: {str(e)}")
        return False


def get_user_usage_sqlite(user_id: str, date: str):
    """获取用户使用量"""
    try:
        conn = sqlite3.connect(settings.SQLITE_DB)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT model, count FROM usage_stats WHERE user_id = ? AND date = ?",
            (user_id, date)
        )
        usage = {model: count for model, count in cursor.fetchall()}
        conn.close()
        return usage
    except Exception as e:
        logger.error(f"获取使用量失败: {str(e)}")
        return {}