import os
import logging
import datetime
import signal
import sys
import atexit
import asyncio
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn
from starlette.exceptions import HTTPException as StarletteHTTPException
import traceback

# 确保在Windows上使用ProactorEventLoop
# 这必须在任何异步代码执行之前设置
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    # 尝试获取/创建事件循环
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

from app.core.config import get_settings
from app.models.sqlite import init_sqlite
from app.routers import api
from app.utils.logger import logger

# 加载设置
settings = get_settings()

# 创建必要的目录结构
os.makedirs("./data", exist_ok=True)
os.makedirs("./logs", exist_ok=True)
os.makedirs("./data/images", exist_ok=True)  # 确保图片存储目录存在

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
    expose_headers=["Content-Disposition"]  # 暴露 Content-Disposition 头
)

# 添加API路由
app.include_router(api.router, prefix=settings.API_V1_STR)

# 添加Agent路由
from app.routers import agent
app.include_router(agent.router, prefix=f"{settings.API_V1_STR}/agent")


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


@app.exception_handler(StarletteHTTPException)
async def starlette_http_exception_handler(request: Request, exc: StarletteHTTPException):
    """处理Starlette HTTP异常"""
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail},
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """处理所有未捕获的异常"""
    logger.error(f"未捕获的异常: {exc}")
    logger.error(traceback.format_exc())
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"error": "服务器内部错误", "detail": str(exc)},
    )


# 启动和关闭事件
@app.on_event("startup")
async def startup_event():
    """应用启动时执行的事件"""
    logger.info("应用启动...")
    
    # 检查是否需要初始化MCP客户端
    mcp_client = None
    try:
        # 读取MCP配置
        import json
        import os
        config_path = os.path.join(os.path.dirname(__file__), "data", "mcp_servers.json")
        
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                mcp_config = json.load(f)
            
            # 检查是否启用自动初始化且有启用的服务器
            auto_init = mcp_config.get("settings", {}).get("auto_init", True)
            enabled_servers = [
                name for name, config in mcp_config.get("mcpServers", {}).items() 
                if config.get("enabled", False)            ]
            
            if auto_init and enabled_servers:
                logger.info(f"检测到 {len(enabled_servers)} 个启用的MCP服务器，正在初始化MCP客户端...")
                from app.services.mcp_client import mcp_client
                # 使用全局MCP客户端实例
                await mcp_client.initialize()
                
                # 存储全局实例
                app.state.mcp_client = mcp_client
                logger.info("MCP客户端初始化完成")
            else:
                logger.info("MCP客户端未启用或无可用服务器，跳过初始化")
                app.state.mcp_client = None
        else:
            logger.warning("MCP配置文件不存在，跳过MCP初始化")
            app.state.mcp_client = None
        
        # 注册清理函数
        def cleanup_mcp():
            try:
                import asyncio
                # 获取或创建事件循环
                try:
                    loop = asyncio.get_event_loop()
                except RuntimeError:
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                
                # 仅当循环正在运行时使用异步方法，否则使用直接清理
                if loop.is_running():
                    logger.info("正在关闭MCP客户端...")
                    future = asyncio.ensure_future(mcp_client.shutdown(), loop=loop)
                    loop.run_until_complete(future)
                else:
                    # 直接清理，不依赖事件循环
                    for server_name, session in list(mcp_client.active_sessions.items()):
                        try:
                            process = session.get("process")
                            if process and hasattr(process, "terminate"):
                                if process.returncode is None:
                                    process.terminate()
                            logger.info(f"已断开与服务器 {server_name} 的连接")
                        except:
                            pass
                    mcp_client.active_sessions.clear()
                    mcp_client.available_tools.clear()
                    mcp_client.available_resources.clear()
            except Exception as e:
                logger.warning(f"清理MCP资源时出错: {e}")
        
        # 注册清理函数
        atexit.register(cleanup_mcp)
        
        # Unix系统处理信号
        if sys.platform != "win32":
            for sig in [signal.SIGINT, signal.SIGTERM]:
                signal.signal(sig, lambda s, f: cleanup_mcp())
        
    except Exception as e:
        logger.error(f"初始化MCP客户端失败: {e}")
        logger.error(traceback.format_exc())


@app.on_event("shutdown")
async def shutdown_event():
    """应用关闭时执行的事件"""
    logger.info("应用关闭...")
    
    # 关闭MCP客户端连接
    try:
        if hasattr(app.state, 'mcp_client'):
            logger.info("正在关闭MCP客户端连接...")
            await app.state.mcp_client.shutdown()
            logger.info("MCP客户端连接已关闭")
    except Exception as e:
        logger.error(f"关闭MCP客户端连接失败: {e}")
        logger.error(traceback.format_exc())

# 主程序入口点
if __name__ == "__main__":
    # 设置优雅关闭的处理程序
    def handle_exit(sig, frame):
        logger.info(f"收到信号 {sig}，正在关闭应用...")
        sys.exit(0)
    
    # 注册信号处理程序
    if sys.platform != "win32":
        signal.signal(signal.SIGINT, handle_exit)
        signal.signal(signal.SIGTERM, handle_exit)
    
    # 启动 Uvicorn 服务器 - 在Windows上使用特殊配置
    if sys.platform == "win32":
        # 在命令行添加额外参数
        config = uvicorn.Config(
            "main:app", 
            host="0.0.0.0", 
            port=8000, 
            reload=settings.DEBUG,
            loop="asyncio",  # 明确指定使用asyncio
            http="h11",      # Windows下更兼容的HTTP协议实现
        )
        server = uvicorn.Server(config)
        server.run()
    else:
        # 其他平台使用标准配置
        uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=settings.DEBUG)
