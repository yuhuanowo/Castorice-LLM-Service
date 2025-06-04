from typing import Optional, List, Dict, Any, Union
from pydantic import BaseModel, Field
from fastapi import UploadFile


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
        session_id: 可选的会话ID，用于基于会话的存储
        tools: 可选的工具定义
        enable_search: 是否启用搜索功能
        image: 可选的图片base64数据
        audio: 可选的音频base64数据
        language: 对话语言（默认为英语）
        disable_history: 是否禁用从数据库获取历史记录功能
    """

    messages: List[ChatMessage]
    model: str = Field(..., description="要使用的模型")
    user_id: str = Field(..., description="用户标识符")
    session_id: Optional[str] = Field(None, description="会话ID，用于基于会话的存储")
    tools: Optional[List[Dict[str, Any]]] = None
    enable_search: Optional[bool] = False
    image: Optional[str] = None
    audio: Optional[str] = None
    language: str = "en"
    disable_history: Optional[bool] = False


class ChatCompletionResponse(BaseModel):
    """
    聊天完成响应模型
    表示LLM API的响应结果

    Attributes:
        message: 模型生成的回复文本
        model: 使用的模型名称
        usage: 使用统计信息
        tool_calls: 可选的工具调用列表
        image_data_uri: 可选的图片数据URI
    """

    message: str = ""  # 设置默认值为空字符串，避免None值
    model: str
    usage: Dict[str, Any] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    image_data_uri: Optional[str] = None  # 新增字段：图片数据URI


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


class FileUploadRequest(BaseModel):
    """
    檔案上傳請求模型
    
    Attributes:
        user_id: 用戶標識符
        description: 檔案描述
        tags: 檔案標籤列表
    """
    user_id: str = Field(..., description="用戶標識符")
    description: Optional[str] = Field(None, description="檔案描述")
    tags: Optional[List[str]] = Field(default_factory=list, description="檔案標籤")


class FileUploadResponse(BaseModel):
    """
    檔案上傳響應模型
    
    Attributes:
        file_id: 檔案唯一標識符
        filename: 檔案名稱
        file_size: 檔案大小（字節）
        file_type: 檔案類型
        upload_time: 上傳時間
        user_id: 用戶標識符
        description: 檔案描述
        tags: 檔案標籤列表
    """
    file_id: str
    filename: str
    file_size: int
    file_type: str
    upload_time: str
    user_id: str
    description: Optional[str] = None
    tags: List[str] = []


class FileMetadata(BaseModel):
    """
    檔案元數據模型
    
    Attributes:
        file_id: 檔案唯一標識符
        filename: 檔案名稱
        file_size: 檔案大小（字節）
        file_type: 檔案類型
        upload_time: 上傳時間
        user_id: 用戶標識符
        description: 檔案描述
        tags: 檔案標籤列表
        stored_filename: 儲存的檔案名稱
        file_path: 檔案路徑
        gridfs_id: MongoDB GridFS ID（如果存儲在MongoDB中）
    """
    file_id: str
    filename: str
    file_size: int
    file_type: str
    upload_time: str
    user_id: str
    description: Optional[str] = None
    tags: List[str] = []
    stored_filename: Optional[str] = None
    file_path: Optional[str] = None
    gridfs_id: Optional[str] = None


class FileDeleteResponse(BaseModel):
    """
    檔案刪除響應模型
    
    Attributes:
        file_id: 刪除的檔案ID
        success: 刪除是否成功
        message: 刪除結果信息
    """
    file_id: str
    success: bool
    message: str


class ModelInfo(BaseModel):
    """
    模型信息模型
    
    Attributes:
        model_id: 模型標識符
        model_name: 模型顯示名稱
        provider: 模型提供商
        description: 模型描述
        max_tokens: 最大token數
        capabilities: 模型能力列表
    """
    model_id: str
    model_name: str
    provider: str
    description: Optional[str] = None
    max_tokens: Optional[int] = None
    capabilities: List[str] = []


class ModelListResponse(BaseModel):
    """
    模型列表響應模型
    
    Attributes:
        models: 可用模型列表
        total_count: 模型總數
    """
    models: List[ModelInfo]
    total_count: int


class StreamChatRequest(BaseModel):
    """
    實時對話流請求模型
    
    Attributes:
        messages: 對話歷史消息列表
        model: 使用的模型名稱
        user_id: 用戶標識符
        temperature: 生成溫度
        max_tokens: 最大生成token數
        stream: 是否啟用流式輸出
    """
    messages: List[ChatMessage]
    model: str = Field(..., description="要使用的模型")
    user_id: str = Field(..., description="用戶標識符")
    temperature: Optional[float] = Field(0.7, ge=0.0, le=2.0, description="生成溫度")
    max_tokens: Optional[int] = Field(None, description="最大生成token數")
    stream: bool = Field(True, description="是否啟用流式輸出")


class StreamChatChunk(BaseModel):
    """
    實時對話流數據塊模型
    
    Attributes:
        id: 響應ID
        object: 對象類型
        created: 創建時間戳
        model: 使用的模型
        choices: 選擇列表
    """
    id: str
    object: str = "chat.completion.chunk"
    created: int
    model: str
    choices: List[Dict[str, Any]]

# MARK: 会话管理相关模型

class CreateSessionRequest(BaseModel):
    """
    创建会话请求模型
    
    Attributes:
        user_id: 用户标识符
        session_id: 可选的会话ID，不提供则自动生成
        title: 会话标题
    """
    user_id: str = Field(..., description="用户标识符")
    session_id: Optional[str] = Field(None, description="会话ID")
    title: Optional[str] = Field("新对话", description="会话标题")


class ChatSessionResponse(BaseModel):
    """
    会话响应模型
    
    Attributes:
        session_id: 会话ID
        success: 操作是否成功
        message: 响应消息
    """
    session_id: str
    success: bool
    message: str


class ChatSessionListResponse(BaseModel):
    """
    会话列表响应模型
    
    Attributes:
        sessions: 会话列表
        total: 会话总数
        success: 操作是否成功
    """
    sessions: List[Dict[str, Any]]
    total: int
    success: bool


class ChatSessionDetailResponse(BaseModel):
    """
    会话详情响应模型
    
    Attributes:
        session: 会话详细信息
        success: 操作是否成功
    """
    session: Dict[str, Any]
    success: bool


class UpdateSessionTitleRequest(BaseModel):
    """
    更新会话标题请求模型
    
    Attributes:
        title: 新的会话标题
    """
    title: str = Field(..., description="新的会话标题")


class ChatCompletionRequestV2(BaseModel):
    """
    基于会话的聊天完成请求模型（新版本）
    
    Attributes:
        session_id: 会话ID
        message: 当前消息
        user_id: 用户标识符
        model: 使用的模型名称
        tools: 可选的工具定义
        enable_search: 是否启用搜索功能
        image: 可选的图片base64数据
        language: 对话语言
    """
    session_id: str = Field(..., description="会话ID")
    message: str = Field(..., description="用户消息")
    user_id: str = Field(..., description="用户标识符")
    model: str = Field(..., description="要使用的模型")
    tools: Optional[List[Dict[str, Any]]] = None
    enable_search: Optional[bool] = False
    image: Optional[str] = None
    language: str = "zh-CN"


class ImageSaveRequest(BaseModel):
    """
    图片保存请求模型
    
    Attributes:
        session_id: 会话ID
        user_id: 用户标识符
        base64_data: 图片的base64编码数据
        mime_type: 图片的MIME类型
    """
    session_id: str = Field(..., description="会话ID")
    user_id: str = Field(..., description="用户标识符")
    base64_data: str = Field(..., description="图片的base64编码数据")
    mime_type: str = Field("image/jpeg", description="图片的MIME类型")


class ImageSaveResponse(BaseModel):
    """
    图片保存响应模型
    
    Attributes:
        image_id: 保存的图片ID
        url: 图片访问URL
        success: 操作是否成功
    """
    image_id: str
    url: str
    success: bool
