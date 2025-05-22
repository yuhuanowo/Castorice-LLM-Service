from typing import Optional, List, Dict, Any, Union
from pydantic import BaseModel, Field


class MsgPayload(BaseModel):
    """
    基本消息载荷模型
    用于简单的消息传递
    """

    msg_id: Optional[int] = None
    msg_name: str


class ChatMessage(BaseModel):
    """
    聊天消息模型
    表示对话中的单条消息

    Attributes:
        role: 消息发送者角色（如"user"、"assistant"、"system"）
        content: 消息内容，可以是文本或结构化的多模态内容
    """

    role: str
    content: Union[str, List[Dict[str, Any]]]


class ChatCompletionRequest(BaseModel):
    """
    聊天完成请求模型
    用于向LLM API发送对话请求

    Attributes:
        messages: 对话历史消息列表
        model: 使用的模型名称
        user_id: 用户标识符
        tools: 可选的工具定义
        enable_search: 是否启用搜索功能
        image: 可选的图片base64数据
        audio: 可选的音频base64数据
        language: 对话语言（默认为繁体中文）
    """

    messages: List[ChatMessage]
    model: str = Field(..., description="要使用的模型")
    user_id: str = Field(..., description="用户标识符")
    tools: Optional[List[Dict[str, Any]]] = None
    enable_search: Optional[bool] = False
    image: Optional[str] = None
    audio: Optional[str] = None
    language: str = "en"


class ChatCompletionResponse(BaseModel):
    """
    聊天完成响应模型
    表示LLM API的响应结果

    Attributes:
        message: 模型生成的回复文本
        model: 使用的模型名称
        usage: 使用统计信息
        tool_calls: 可选的工具调用列表
    """

    message: str
    model: str
    usage: Dict[str, Any] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None


class MemoryRequest(BaseModel):
    """
    记忆更新请求模型

    Attributes:
        user_id: 用户标识符
        prompt: 用于更新记忆的提示文本
    """

    user_id: str
    prompt: str


class MemoryResponse(BaseModel):
    """
    记忆响应模型

    Attributes:
        memory: 用户记忆内容
    """

    memory: str


class UsageResponse(BaseModel):
    """
    使用量响应模型

    Attributes:
        user_id: 用户标识符
        usage: 不同模型的使用次数
        limits: 不同模型的使用限制
    """

    user_id: str
    usage: Dict[str, int]
    limits: Dict[str, int]


class ErrorResponse(BaseModel):
    """
    错误响应模型

    Attributes:
        error: 错误描述
        detail: 可选的详细错误信息
    """

    error: str
    detail: Optional[str] = None
