import os
import logging
import datetime
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

from app.core.config import get_settings
from app.models.sqlite import init_sqlite
from app.routers import api
from app.utils.logger import logger

# 加载设置
settings = get_settings()

# 创建必要的目录结构
os.makedirs("./data", exist_ok=True)
os.makedirs("./logs", exist_ok=True)

# 初始化SQLite数据库
init_sqlite()

# 创建FastAPI应用实例
app = FastAPI(
    title=settings.APP_NAME,
    description="AI Agent API - 用于多项目中调用AI模型的统一接口",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# 添加CORS中间件，允许跨域请求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 在生产环境中应设置为具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 添加API路由
app.include_router(api.router, prefix=settings.API_V1_STR)


# 基本路由
@app.get("/")
async def root():
    """获取API服务基本信息"""
    return {
        "name": settings.APP_NAME,
        "version": "1.0.0",
        "status": "running",
        "time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "documentation": "/docs",
        "redoc": "/redoc",
        "api_version": settings.API_V1_STR,
        "description": "AI Agent API - Unified interface for calling AI models in multiple projects"
    }


@app.get("/health")
async def health_check():
    """健康检查端点，用于监控系统运行状态"""
    return {"status": "ok"}


# 全局异常处理器
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """处理HTTP异常"""
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail},
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """处理所有其他异常"""
    logger.error(f"全局异常: {str(exc)}")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"error": "服务器内部错误", "detail": str(exc)},
    )


# 主程序入口点
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=settings.DEBUG)
