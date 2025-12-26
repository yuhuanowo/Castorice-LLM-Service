"""
Model Context Protocol (MCP) Client Implementation
MCP客户端实现 - 作为LLM的"USB接口"连接外部工具服务器
"""

import asyncio
import json
import os
import subprocess
import uuid
import sys
import signal
import atexit
import warnings
import gc
from typing import Dict, List, Any, Optional, Union
from dataclasses import dataclass
from enum import Enum
import aiohttp
from datetime import datetime

from app.utils.logger import logger
from app.core.config import get_settings

# 完全屏蔽与子进程和事件循环相关的警告和异常
warnings.filterwarnings("ignore", category=ResourceWarning)
warnings.filterwarnings("ignore", category=RuntimeWarning, 
                      message="coroutine.*was never awaited")

# 重写BaseSubprocessTransport.__del__和_ProactorBasePipeTransport.__del__方法
# 以避免在进程退出时引发异常
try:
    # 为了防止在事件循环关闭时出现异常，我们修补关键类
    import asyncio.base_subprocess
    import asyncio.proactor_events
    
    # 保存原始方法
    original_subprocess_del = asyncio.base_subprocess.BaseSubprocessTransport.__del__
    original_pipe_del = asyncio.proactor_events._ProactorBasePipeTransport.__del__
    
    # 创建安全的__del__方法
    def _safe_subprocess_del(self):
        try:
            if hasattr(self, '_closed') and not self._closed:
                try:
                    self.close()
                except (RuntimeError, ValueError, AttributeError):
                    pass
        except Exception:
            pass
    
    def _safe_pipe_del(self):
        try:
            if not self._closed:
                try:
                    self.close()
                except (RuntimeError, ValueError, AttributeError):
                    pass
        except Exception:
            pass
    
    # 替换原始方法
    asyncio.base_subprocess.BaseSubprocessTransport.__del__ = _safe_subprocess_del
    asyncio.proactor_events._ProactorBasePipeTransport.__del__ = _safe_pipe_del
    
    logger.debug("已安装安全的子进程清理方法")
    
except Exception as e:
    logger.warning(f"无法安装安全的子进程清理方法: {e}")

# Windows环境下使用ProactorEventLoop支持子进程
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

settings = get_settings()


class MCPTransportType(Enum):
    """MCP传输类型"""
    STDIO = "stdio"
    HTTP_SSE = "http_sse"
    WEBSOCKET = "websocket"


@dataclass
class MCPServer:
    """MCP服务器配置"""
    name: str
    command: str
    args: List[str]
    env: Dict[str, str]
    transport: MCPTransportType = MCPTransportType.STDIO
    enabled: bool = True
    timeout: int = None  # 使用 None 表示將從配置獲取
    
    def __post_init__(self):
        # 從配置獲取超時時間
        if self.timeout is None:
            self.timeout = getattr(settings, 'MCP_SERVER_TIMEOUT', 30)


@dataclass
class MCPTool:
    """MCP工具定义"""
    name: str
    description: str
    inputSchema: Dict[str, Any]


@dataclass
class MCPResource:
    """MCP资源定义"""
    uri: str
    name: str
    description: Optional[str] = None
    mimeType: Optional[str] = None


class MCPClient:
    """Model Context Protocol客户端
    
    作为LLM和外部工具服务器之间的接口，提供：
    1. 服务器连接管理
    2. 工具调用
    3. 资源访问
    4. 会话管理
    """
    
    def __init__(self):
        self.servers: Dict[str, MCPServer] = {}
        self.active_sessions: Dict[str, Any] = {}
        self.available_tools: Dict[str, MCPTool] = {}
        self.available_resources: Dict[str, MCPResource] = {}
        # 标记是否已经注册清理函数
        self._cleanup_called = False
    
    def __del__(self):
        """对象销毁时确保资源被清理"""
        if not self._cleanup_called:
            self._cleanup_called = True
            try:
                # 检查是否有活动会话需要清理
                if hasattr(self, 'active_sessions') and self.active_sessions:
                    # 直接终止所有子进程
                    for server_name, session in list(self.active_sessions.items()):
                        try:
                            process = session.get("process")
                            if process and hasattr(process, "terminate") and hasattr(process, "returncode"):
                                if process.returncode is None:
                                    try:
                                        process.terminate()
                                    except:
                                        pass
                        except:
                            pass
                    
                    # 清空会话和其他资源
                    if hasattr(self, 'active_sessions'):
                        self.active_sessions.clear()
                    if hasattr(self, 'available_tools'):
                        self.available_tools.clear()
                    if hasattr(self, 'available_resources'):
                        self.available_resources.clear()
                
                # 强制垃圾回收
                gc.collect()
            except:
                pass
    
    async def initialize(self):
        """初始化MCP客户端，加载服务器配置"""
        try:
            # 注册退出处理 - 确保子进程在应用退出时被终止
            self._register_exit_handlers()
            
            await self._load_server_configs()
            await self._discover_capabilities()
            logger.info(f"MCP客户端初始化完成，发现 {len(self.servers)} 个服务器")
        except Exception as e:
            logger.error(f"MCP客户端初始化失败: {e}")
            import traceback
            logger.debug(f"详细错误: {traceback.format_exc()}")
            
    def _register_exit_handlers(self):
        """注册进程退出处理程序，确保资源被正确清理"""
        if not hasattr(self, "_exit_handlers_registered"):
            # 定义清理函数
            def cleanup_resources():
                logger.debug("程序正在退出，清理MCP客户端资源")
                
                # 直接终止所有子进程，而不依赖事件循环
                for server_name, session in list(self.active_sessions.items()):
                    try:
                        process = session.get("process")
                        if process and hasattr(process, "terminate"):
                            try:
                                # 标记为已断开
                                session["connected"] = False
                                
                                # 立即终止进程
                                if process.returncode is None:
                                    process.terminate()
                                    
                                    # 使用小的超时等待进程终止
                                    import time
                                    for _ in range(5):  # 等待最多0.5秒
                                        if process.returncode is not None:
                                            break
                                        time.sleep(0.1)
                                    
                                    # 如果进程仍在运行，强制关闭
                                    if process.returncode is None:
                                        process.kill()
                                        
                                # 关闭所有管道
                                for stream in [process.stdin, process.stdout, process.stderr]:
                                    if stream:
                                        try:
                                            stream.close()
                                        except:
                                            pass
                            except:
                                pass
                        
                        # 从会话中移除
                        logger.info(f"已断开与服务器 {server_name} 的连接")
                    except:
                        pass
                
                # 清空会话列表和其他资源
                self.active_sessions.clear()
                self.available_tools.clear()
                self.available_resources.clear()
                
                # 强制垃圾回收
                try:
                    gc.collect()
                except:
                    pass
            
            # 尝试使用atexit模块注册清理函数（适用于所有平台）
            try:
                atexit.register(cleanup_resources)
                logger.debug("已通过atexit注册MCP资源清理函数")
            except Exception as e:
                logger.warning(f"无法注册atexit清理函数: {e}")
            
            # 在Windows平台，额外添加一个特殊处理
            if sys.platform == "win32":
                # 存储原始__del__方法
                original_del = self.__class__.__del__ if hasattr(self.__class__, "__del__") else None
                
                # 定义新的__del__方法
                def safe_del(self):
                    try:
                        cleanup_resources()
                    except:
                        pass
                    
                    # 调用原始__del__方法（如果存在）
                    if original_del:
                        try:
                            original_del(self)
                        except:
                            pass
                
                # 设置新的__del__方法
                self.__class__.__del__ = safe_del
            
            # 注册SIGINT和SIGTERM信号处理器（Unix/Linux/Mac）
            if sys.platform != "win32":
                for sig in [signal.SIGINT, signal.SIGTERM]:
                    try:
                        signal.signal(sig, lambda s, f: cleanup_resources())
                        logger.debug(f"已注册信号{sig}处理器")
                    except Exception as e:
                        logger.warning(f"无法注册信号{sig}处理器: {e}")
            
            # 标记已注册
            self._exit_handlers_registered = True
            
    async def _load_server_configs(self):
        """从配置文件加载MCP服务器定义"""
        try:
            # 从data/mcp_servers.json加载配置
            config_path = "data/mcp_servers.json"
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                    
                mcp_servers = config.get('mcpServers', {})
                for name, server_config in mcp_servers.items():
                    if server_config.get('enabled', True):
                        # 处理并修正配置
                        command = server_config['command']
                        args = server_config.get('args', [])
                        
                        # Windows平台下自动处理npm和npx命令
                        if sys.platform == "win32" and command in ["npm", "npx", "uv", "uvx"]:
                            import shutil
                            
                            # 检查能否找到命令及其替代版本
                            direct_cmd = shutil.which(command)
                            cmd_cmd = shutil.which(f"{command}.cmd")
                            exe_cmd = shutil.which(f"{command}.exe")
                            
                            if cmd_cmd:  # 优先使用.cmd版本
                                command = f"{command}.cmd"
                                logger.debug(f"Windows平台使用命令: {command}")
                            elif exe_cmd:
                                command = f"{command}.exe"
                                logger.debug(f"Windows平台使用命令: {command}")
                            elif not direct_cmd:
                                if command in ["uv", "uvx"]:
                                    logger.warning(f"找不到{command}命令，请确保已安装uv包管理器")
                                else:
                                    logger.warning(f"找不到{command}命令，请确保已安装Node.js")
                        
                        # 创建服务器配置
                        self.servers[name] = MCPServer(
                            name=name,
                            command=command,
                            args=args,
                            env=server_config.get('env', {}),
                            transport=MCPTransportType(server_config.get('transport', 'stdio')),
                            enabled=True,
                            timeout=server_config.get('timeout', 30)
                        )
                        
                        logger.info(f"已加载MCP服务器配置: {name} ({command} {' '.join(args)})")
                        
            except FileNotFoundError:
                logger.warning(f"MCP配置文件 {config_path} 不存在，使用默认配置")
                await self._create_default_config(config_path)
                
        except Exception as e:
            logger.error(f"加载MCP服务器配置失败: {e}")
            import traceback
            logger.debug(f"详细错误: {traceback.format_exc()}")
            
    async def _create_default_config(self, config_path: str):
        """创建默认MCP配置文件"""
        # 检测适合当前环境的命令格式
        npm_cmd = "npm"
        if sys.platform == "win32":
            import shutil
            # 检查npm命令是否存在及其格式
            npm_cmd_path = shutil.which("npm.cmd")
            if npm_cmd_path:
                npm_cmd = "npm.cmd"
            elif shutil.which("npm.exe"):
                npm_cmd = "npm.exe"
            logger.debug(f"Windows平台使用NPM命令: {npm_cmd}")
            
        default_config = {
            "mcpServers": {
                "filesystem": {
                    "command": npm_cmd,
                    "args": ["exec", "--", "@modelcontextprotocol/server-filesystem", "./data/mcp_files"],
                    "env": {},
                    "enabled": True,
                    "timeout": 30,
                    "description": "File system access server, allows reading and writing files in specified directories"
                },
                "github": {
                    "command": npm_cmd, 
                    "args": ["exec", "--", "@modelcontextprotocol/server-github"],
                    "env": {
                        "GITHUB_PERSONAL_ACCESS_TOKEN": "your_token_here"
                    },
                    "enabled": False,
                    "timeout": 30,
                    "description": "GitHub API integration server, provides repository search, file reading and other functions"
                },
                "web-search": {
                    "command": npm_cmd,
                    "args": ["exec", "--", "@modelcontextprotocol/server-brave-search"],
                    "env": {
                        "BRAVE_API_KEY": "your_api_key_here"
                    },
                    "enabled": False,
                    "timeout": 30,
                    "description": "Web search server using Brave search engine"
                }
            },
            "settings": {
                "auto_init": True,
                "default_timeout": 30,
                "max_connections": 10
            },            "description": "MCP server configuration file. To enable servers, set enabled to true and configure corresponding environment variables.\n" +
                          "For Windows systems, use npm.cmd instead of npm.\n" + 
                          "Before using this configuration, make sure you have globally installed the relevant MCP server packages, for example:\n" +
                          "npm install -g @modelcontextprotocol/server-filesystem"
        }
        
        try:
            import os
            os.makedirs(os.path.dirname(config_path), exist_ok=True)
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(default_config, f, indent=2, ensure_ascii=False)
            logger.info(f"已创建默认MCP配置文件: {config_path}")
        except Exception as e:
            logger.error(f"创建默认配置文件失败: {e}")
            import traceback
            logger.debug(f"详细错误: {traceback.format_exc()}")
    async def _discover_capabilities(self):
        """发现所有服务器的能力（工具和资源）"""
        for server_name, server in self.servers.items():
            try:
                # 首先尝试连接到服务器
                connected = await self._connect_to_server(server_name)
                if not connected:
                    logger.warning(f"无法连接到服务器 {server_name}")
                    continue
                
                # 获取服务器支持的方法列表
                supported_methods = await self._get_supported_methods(server_name)
                
                # 获取工具列表
                tools = []
                if "tools/list" in supported_methods:
                    tools = await self._list_tools(server_name)
                else:
                    logger.warning(f"服务器 {server_name} 不支持基本的tools/list方法，这不符合MCP标准")
                    # 尝试使用示例工具
                    tools = self._get_sample_tools(server_name)
                
                # 获取资源列表
                resources = []
                if "resources/list" in supported_methods:
                    resources = await self._list_resources(server_name)
                else:
                    logger.info(f"服务器 {server_name} 不支持资源API，这是正常的")
                
                # 注册工具和资源
                for tool in tools:
                    tool_key = f"{server_name}:{tool.name}"
                    self.available_tools[tool_key] = tool
                    
                for resource in resources:
                    resource_key = f"{server_name}:{resource.uri}"
                    self.available_resources[resource_key] = resource
                    
                logger.info(f"服务器 {server_name}: {len(tools)} 个工具, {len(resources)} 个资源")
                
            except Exception as e:
                logger.warning(f"连接服务器 {server_name} 失败: {e}")
                # 记录更详细的错误信息
                import traceback
                logger.debug(f"详细错误: {traceback.format_exc()}")
                
    async def _get_supported_methods(self, server_name: str) -> List[str]:
        """获取服务器支持的MCP方法列表，
        首先尝试使用标准的system/methods方法，如果不支持则使用探测方式"""
        methods = []
        try:
            # 首先尝试使用system/methods方法（标准方法）
            logger.debug(f"尝试使用system/methods获取服务器 {server_name} 支持的方法")
            response = await self._send_mcp_request(server_name, "system/methods")
            
            # 检查是否有响应结果
            if "error" not in response:
                result = response.get("result", {})
                if isinstance(result, dict) and "methods" in result:
                    methods = result.get("methods", [])
                    logger.info(f"服务器 {server_name} 声明支持的方法: {', '.join(methods)}")
                    
                    # 更新会话信息中的支持方法列表
                    if server_name in self.active_sessions:
                        self.active_sessions[server_name]["supported_methods"] = methods
                    return methods
            elif "error" in response:
                error_code = response.get("error", {}).get("code", 0)
                if error_code == -32601:  # Method not found
                    logger.debug(f"服务器 {server_name} 不支持system/methods方法，将使用探测方式")
                else:
                    logger.warning(f"获取服务器 {server_name} 方法列表失败: {response.get('error', {}).get('message', '未知错误')}")
            
            # 如果服务器不支持system/methods，通过探测确定支持的方法
            logger.debug(f"使用探测方式确定服务器 {server_name} 支持的方法")
            detected_methods = []
            
            # 基础方法探测 - tools API是MCP协议的核心要求
            tools_methods = ["tools/list", "tools/call"]
            for method in tools_methods:
                test_response = await self._send_mcp_request(server_name, method)
                if "error" not in test_response or test_response.get("error", {}).get("code", 0) != -32601:
                    detected_methods.append(method)
            
            # 资源API探测 (可选功能)
            resource_methods = ["resources/list", "resources/read"]
            for method in resource_methods:
                test_response = await self._send_mcp_request(server_name, method)
                if "error" not in test_response or test_response.get("error", {}).get("code", 0) != -32601:
                    detected_methods.append(method)
            
            # 系统API探测 (可选功能)
            system_methods = ["system/info"]
            for method in system_methods:
                test_response = await self._send_mcp_request(server_name, method)
                if "error" not in test_response or test_response.get("error", {}).get("code", 0) != -32601:
                    detected_methods.append(method)
                    
            # 提示API探测 (可选功能)
            prompts_methods = ["prompts/list", "prompts/render"]
            for method in prompts_methods:
                test_response = await self._send_mcp_request(server_name, method)
                if "error" not in test_response or test_response.get("error", {}).get("code", 0) != -32601:
                    detected_methods.append(method)
            
            # 更新会话信息中的支持方法列表
            if detected_methods and server_name in self.active_sessions:
                self.active_sessions[server_name]["supported_methods"] = detected_methods
                
            logger.info(f"服务器 {server_name} 探测支持的方法: {', '.join(detected_methods)}")
            return detected_methods
            
        except Exception as e:
            # 出错时使用基础方法
            logger.error(f"获取服务器 {server_name} 支持的方法时出错: {e}")
            basic_methods = ["tools/list", "tools/call"]
            
            # 更新会话信息中的支持方法列表
            if server_name in self.active_sessions:
                self.active_sessions[server_name]["supported_methods"] = basic_methods
                
            return basic_methods
    
    async def _connect_to_server(self, server_name: str) -> bool:
        """连接到MCP服务器 - 建立真正的MCP协议连接"""
        if server_name not in self.servers:
            logger.error(f"服务器配置不存在: {server_name}")
            return False
            
        server = self.servers[server_name]
        if not server.enabled:
            logger.info(f"服务器 {server_name} 未启用，跳过连接")
            return False
            
        session_id = str(uuid.uuid4())
        
        try:            
            logger.info(f"正在连接MCP服务器: {server_name}")
            logger.debug(f"服务器配置: command={server.command}, args={server.args}")
            # 根据传输类型建立连接
            if server.transport == MCPTransportType.STDIO:
                # STDIO连接：启动子进程并通过stdin/stdout通信                
                try:
                    logger.debug(f"启动进程: {server.command} {' '.join(server.args)}")
                    
                    # 确保设置正确的环境变量 
                    env_vars = {**os.environ.copy(), **server.env}
                    
                    # 添加Node.js相关环境变量支持
                    if 'NODE_PATH' not in env_vars and (server.command in ['npm', 'npx', 'node']):
                        # 尝试添加全局和本地node_modules路径
                        local_node_modules = os.path.join(os.getcwd(), 'node_modules')
                        if 'APPDATA' in os.environ:  # Windows
                            global_node_modules = os.path.join(os.environ['APPDATA'], 'npm', 'node_modules')
                        else:  # Linux/Mac
                            global_node_modules = '/usr/local/lib/node_modules'
                        
                        env_vars['NODE_PATH'] = f"{local_node_modules}{os.pathsep}{global_node_modules}"
                        logger.debug(f"已设置NODE_PATH环境变量: {env_vars['NODE_PATH']}")
                    
                    logger.debug(f"环境变量: {env_vars}")
                    
                    # 获取命令的完整路径
                    try:
                        import shutil
                        command_path = shutil.which(server.command)
                        if command_path:
                            logger.debug(f"命令完整路径: {command_path}")
                        else:
                            logger.warning(f"找不到命令的完整路径: {server.command}，请确保该命令已安装")
                            # 在Windows上检查是否需要添加.cmd或.exe后缀
                            if sys.platform == "win32":
                                for ext in ['.cmd', '.exe', '.bat']:
                                    alt_command = f"{server.command}{ext}"
                                    alt_path = shutil.which(alt_command)
                                    if alt_path:
                                        logger.info(f"找到替代命令: {alt_path}")
                                        server.command = alt_command
                                        command_path = alt_path
                                        break
                    except Exception as e:
                        logger.debug(f"获取命令路径失败: {e}")
                    
                    # 尝试直接使用子进程执行
                    try:
                        logger.debug(f"尝试使用create_subprocess_exec执行命令")
                        
                        # 对于Windows环境，如果是npm或npx命令，尝试添加正确的后缀
                        cmd = server.command
                        if sys.platform == "win32" and cmd in ["npm", "npx"]:
                            possible_cmds = [f"{cmd}.cmd", f"{cmd}.exe", cmd]
                            for possible_cmd in possible_cmds:
                                if shutil.which(possible_cmd):
                                    cmd = possible_cmd
                                    logger.debug(f"找到可执行命令: {cmd}")
                                    break
                        
                        process = await asyncio.create_subprocess_exec(
                            cmd, *server.args,
                            stdin=asyncio.subprocess.PIPE,
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE,
                            env=env_vars
                        )
                        
                        logger.debug(f"进程已启动，PID: {process.pid if hasattr(process, 'pid') else '未知'}")
                        
                    except FileNotFoundError as e:
                        logger.error(f"找不到命令: {server.command}，尝试使用shell模式")
                        # 如果命令未找到，尝试使用shell模式
                        shell_cmd = f"{server.command} {' '.join(server.args)}"
                        
                        process = await asyncio.create_subprocess_shell(
                            shell_cmd,
                            stdin=asyncio.subprocess.PIPE,
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE,
                            env=env_vars,
                            shell=True
                        )
                    except NotImplementedError:
                        logger.error("当前事件循环不支持子进程，正在切换到ProactorEventLoop")
                        # 保存当前事件循环状态
                        old_loop_policy = asyncio.get_event_loop_policy()
                        old_loop = asyncio.get_event_loop()
                        
                        # 切换到ProactorEventLoop
                        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
                        
                        # 创建新的事件循环并设置为当前循环
                        try:
                            new_loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(new_loop)
                            
                            # 在新循环中执行子进程启动
                            shell_cmd = f"{server.command} {' '.join(server.args)}"
                            logger.debug(f"在新事件循环中启动进程: {shell_cmd}")
                            
                            # 使用同步子进程执行，避免异步问题
                            try:
                                # 尝试使用同步子进程
                                import subprocess
                                process = subprocess.Popen(
                                    shell_cmd,
                                    stdin=subprocess.PIPE,
                                    stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE,
                                    env=env_vars,
                                    shell=True,
                                    text=False,
                                    bufsize=0  # 无缓冲
                                )
                                logger.debug(f"使用同步子进程启动成功，PID: {process.pid}")
                                
                                # 将同步子进程包装为异步可用的对象
                                class AsyncCompatProcess:
                                    def __init__(self, process):
                                        self.process = process
                                        self.pid = process.pid
                                        self.returncode = process.returncode
                                        self.stdin = AsyncioCompatPipe(process.stdin)
                                        self.stdout = AsyncioCompatPipe(process.stdout)
                                        self.stderr = AsyncioCompatPipe(process.stderr)
                                    
                                    async def wait(self):
                                        return self.process.wait()
                                    
                                    def terminate(self):
                                        return self.process.terminate()
                                    
                                    def kill(self):
                                        return self.process.kill()
                                
                                class AsyncioCompatPipe:
                                    def __init__(self, pipe):
                                        self.pipe = pipe
                                        self._closing = False
                                    
                                    def is_closing(self):
                                        return self._closing
                                    
                                    def close(self):
                                        self._closing = True
                                        try:
                                            self.pipe.close()
                                        except:
                                            pass
                                    
                                    async def readline(self):
                                        try:
                                            return self.pipe.readline()
                                        except:
                                            return b''
                                    
                                    def write(self, data):
                                        try:
                                            return self.pipe.write(data)
                                        except:
                                            return 0
                                    
                                    async def drain(self):
                                        try:
                                            self.pipe.flush()
                                        except:
                                            pass
                                
                                # 创建异步兼容对象
                                process = AsyncCompatProcess(process)
                                logger.debug("已创建异步兼容进程对象")
                                
                            except Exception as e:
                                logger.error(f"同步进程启动失败: {e}")
                                # 回退使用异步子进程
                                process = await asyncio.create_subprocess_shell(
                                    shell_cmd,
                                    stdin=asyncio.subprocess.PIPE,
                                    stdout=asyncio.subprocess.PIPE,
                                    stderr=asyncio.subprocess.PIPE,
                                    env=env_vars,
                                    shell=True
                                )
                        except Exception as e:
                            logger.error(f"在新事件循环中启动进程失败: {e}")
                            raise
                        finally:
                            # 恢复原始事件循环
                            try:
                                asyncio.set_event_loop_policy(old_loop_policy)
                                asyncio.set_event_loop(old_loop)
                                logger.debug("已恢复原始事件循环")
                            except Exception as e:
                                logger.error(f"恢复原始事件循环失败: {e}")
                    
                    # 立即检查进程状态
                    if process.returncode is not None:
                        # 进程立即退出，读取stderr
                        stderr = await process.stderr.read()
                        stderr_str = stderr.decode('utf-8', errors='replace')
                        raise Exception(f"进程立即退出，返回码 {process.returncode}: {stderr_str}")
                    
                    # 存储会话信息
                    self.active_sessions[server_name] = {
                        "session_id": session_id,
                        "connected": True,
                        "server": server,
                        "created_at": datetime.now(),
                        "transport": "stdio",
                        "process": process,
                        "status": "已连接",
                        "supported_methods": []  # 初始化为空列表，稍后将通过_get_supported_methods填充
                    }                      
                    logger.info(f"已建立STDIO连接到 {server_name}")
                    
                    # 验证连接是否正常工作 - 发送system/info请求作为心跳检查
                    try:
                        await self._send_mcp_request(server_name, "system/info")
                        logger.debug(f"与服务器 {server_name} 的心跳检查成功")
                    except Exception as e:
                        logger.debug(f"与服务器 {server_name} 的心跳检查失败: {e}")
                        # 这只是一个非关键检查，失败不影响连接结果
                    
                    return True

                except Exception as e:
                    error_msg = str(e)
                    logger.error(f"启动MCP服务器进程失败 {server_name}: {error_msg}")
                    # 尝试获取更多错误信息
                    import traceback
                    logger.error(f"详细错误: {traceback.format_exc()}")
                    
                    # 尝试解析npm错误并提供更友好的错误信息
                    if "npx" in server.command or "npm" in server.command:
                        if "系統找不到指定的檔案" in error_msg or "系统找不到指定的文件" in error_msg or "FileNotFoundError" in error_msg:
                            logger.error("Node.js/NPM命令未找到，请确保安装了最新版本的Node.js和npm")
                            logger.error("请运行以下命令安装所需的MCP服务器包：")
                            
                            packages = []
                            for arg in server.args:
                                if arg.startswith('@modelcontextprotocol/server-'):
                                    packages.append(arg)
                            
                            if packages:
                                install_cmd = f"npm install -g {' '.join(packages)}"
                                logger.error(f"安装命令: {install_cmd}")
                            else:
                                cmd_name = server.args[1] if len(server.args) > 1 else '(未指定)'
                                if "exec" in server.args and len(server.args) > 2:
                                    cmd_name = server.args[2]
                                logger.error(f"请确保已安装所需包: {cmd_name}")
                        elif "ENOENT" in error_msg:
                            logger.error("找不到npm包，请检查包名是否正确并确保网络连接正常")
                        elif "Permission denied" in error_msg or "拒绝访问" in error_msg:
                            logger.error("权限被拒绝，请尝试以管理员权限运行应用或使用sudo")
                    return False
                
            elif server.transport == MCPTransportType.HTTP_SSE:
                # HTTP Server-Sent Events连接 - 基本实现
                try:
                    # 记录连接状态，但不实际连接
                    self.active_sessions[server_name] = {
                        "session_id": session_id,
                        "connected": False,  # 标记为未真正连接
                        "server": server,
                        "created_at": datetime.now(),
                        "transport": "http_sse",
                        "status": "HTTP_SSE连接功能待实现",
                        "supported_methods": []  # 初始化为空列表
                    }
                    logger.warning(f"MCP HTTP_SSE连接到 {server_name} 的功能待实现")
                    return False
                except Exception as e:
                    logger.error(f"HTTP_SSE连接失败 {server_name}: {e}")
                    return False
                
            elif server.transport == MCPTransportType.WEBSOCKET:
                # WebSocket连接 - 基本实现
                try:
                    # 记录连接状态，但不实际连接
                    self.active_sessions[server_name] = {
                        "session_id": session_id,
                        "connected": False,  # 标记为未真正连接
                        "server": server,
                        "created_at": datetime.now(),
                        "transport": "websocket",
                        "status": "WebSocket连接功能待实现",
                        "supported_methods": []  # 初始化为空列表
                    }
                    logger.warning(f"MCP WebSocket连接到 {server_name} 的功能待实现")
                    return False                
                except Exception as e:
                    logger.error(f"WebSocket连接失败 {server_name}: {e}")
                    return False
                
            else:
                logger.error(f"不支持的传输类型: {server.transport}")
                return False
                
        except Exception as e:
            logger.error(f"连接服务器 {server_name} 失败: {e}")
            return False

    async def _list_tools(self, server_name: str) -> List[MCPTool]:
        """列出服务器可用工具 - 通过MCP协议动态发现"""
        if server_name not in self.active_sessions:
            logger.warning(f"服务器 {server_name} 未连接，无法列出工具")
            return []
            
        session = self.active_sessions[server_name]
        if not session.get("connected", False):
            logger.warning(f"服务器 {server_name} 连接未就绪，无法列出工具")
            return []
        
        # 检查服务器是否支持tools/list方法
        supported_methods = session.get("supported_methods", [])
        if "tools/list" not in supported_methods:
            logger.error(f"服务器 {server_name} 不支持基本的tools/list方法，不符合MCP标准")
            return self._get_sample_tools(server_name)
            
        try:
            # 发送 tools/list 请求
            logger.debug(f"向服务器 {server_name} 发送tools/list请求")
            response = await self._send_mcp_request(server_name, "tools/list")
            
            if "error" in response:
                error_code = response.get("error", {}).get("code", 0)
                error_msg = response.get("error", {}).get("message", "未知错误")
                
                logger.error(f"列出工具失败: {error_msg} (错误码: {error_code})")
                
                # 如果是方法不存在错误，更新支持方法列表
                if error_code == -32601:  # Method not found
                    if "tools/list" in supported_methods:
                        supported_methods.remove("tools/list")
                        session["supported_methods"] = supported_methods
                    logger.error(f"服务器 {server_name} 不支持基本的tools/list方法，不符合MCP标准")
                
                # 使用内置示例工具
                return self._get_sample_tools(server_name)
            
            # 如果成功响应，但缺少result或tools字段
            result = response.get("result", {})
            if not isinstance(result, dict) or "tools" not in result:
                logger.error(f"工具列表响应格式错误: {response}")
                return self._get_sample_tools(server_name)
                
            # 解析工具列表
            tools = []
            for tool_data in result.get("tools", []):
                try:
                    # 按照MCP标准解析工具定义
                    if "name" not in tool_data:
                        logger.warning(f"工具定义缺少必要的name字段: {tool_data}")
                        continue
                        
                    # 解析工具注解
                    annotations = tool_data.get("annotations", {})
                    tool = MCPTool(
                        name=tool_data["name"],
                        description=tool_data.get("description", "") or annotations.get("title", ""),
                        inputSchema=tool_data.get("inputSchema", {"type": "object", "properties": {}})
                    )
                    tools.append(tool)
                    logger.debug(f"发现工具: {tool.name} - {tool.description}")
                except Exception as e:
                    logger.warning(f"解析工具定义失败: {e}")
                    
            if not tools:
                logger.warning(f"服务器 {server_name} 未提供任何工具，使用示例工具")
                return self._get_sample_tools(server_name)
                
            return tools
                
        except Exception as e:
            logger.error(f"从服务器 {server_name} 列出工具失败: {e}")
            return self._get_sample_tools(server_name)
    
    def _get_sample_tools(self, server_name: str) -> List[MCPTool]:
        """获取示例工具（当无法动态发现时的回退）"""
        if server_name == "filesystem":
            return [
                MCPTool(
                    name="read_file",
                    description="Read file content",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "path": {"type": "string", "description": "File path"}
                        },
                        "required": ["path"]
                    }
                ),
                MCPTool(
                    name="list_directory",
                    description="List directory content",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "path": {"type": "string", "description": "Directory path"}
                        },
                        "required": ["path"]
                    }
                )
            ]
        elif server_name == "github":
            return [
                MCPTool(
                    name="search_repositories",
                    description="Search GitHub repositories",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "Search query"},
                            "language": {"type": "string", "description": "Programming language filter"}
                        },
                        "required": ["query"]
                    }
                )
            ]
        else:
            return []
    async def _list_resources(self, server_name: str) -> List[MCPResource]:
        """列出服务器可用资源 - 通过MCP协议动态发现"""
        if server_name not in self.active_sessions:
            logger.warning(f"服务器 {server_name} 未连接，无法列出资源")
            return []
            
        # 检查服务器是否支持resources/list方法
        session = self.active_sessions.get(server_name, {})
        supported_methods = session.get("supported_methods", [])
        
        if "resources/list" not in supported_methods:
            logger.info(f"服务器 {server_name} 不支持resources/list方法，跳过资源发现")
            return []
            
        try:
            # 发送 resources/list 请求
            logger.info(f"正在从服务器 {server_name} 动态发现资源...")
            response = await self._send_mcp_request(server_name, "resources/list")
            
            if "error" in response:
                error_code = response.get("error", {}).get("code", 0)
                error_msg = response.get("error", {}).get("message", "未知错误")
                
                # 特殊处理方法不存在的错误 - 资源API是可选的
                if error_code == -32601:  # Method not found
                    logger.info(f"服务器 {server_name} 不支持资源API (resources/list)，这是正常的")
                    # 更新服务器的支持方法列表
                    if "resources/list" in supported_methods:
                        supported_methods.remove("resources/list")
                        session["supported_methods"] = supported_methods
                    return []
                else:
                    logger.error(f"列出资源失败: {error_msg} (错误码: {error_code})")
                    return []
                
            # 解析资源列表
            result = response.get("result", {})
            if not isinstance(result, dict) or "resources" not in result:
                logger.error(f"资源列表响应格式错误: {response}")
                return []
                
            resources = []
            for resource_data in result.get("resources", []):
                try:
                    # 确保资源含有必须的uri字段
                    if "uri" not in resource_data:
                        logger.warning(f"资源定义缺少必要的uri字段: {resource_data}")
                        continue
                        
                    resource = MCPResource(
                        uri=resource_data["uri"],
                        name=resource_data.get("name", resource_data["uri"]),
                        description=resource_data.get("description", ""),
                        mimeType=resource_data.get("mimeType")
                    )
                    resources.append(resource)
                    logger.debug(f"发现资源: {resource.name} - {resource.uri}")
                except Exception as e:
                    logger.warning(f"解析资源定义失败: {e}")
                    
            logger.info(f"从服务器 {server_name} 发现 {len(resources)} 个资源")
            return resources
            
        except Exception as e:
            logger.error(f"从服务器 {server_name} 列出资源失败: {e}")
            return []
        
    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """调用MCP工具
        
        按照MCP标准调用工具，提供有意义的错误处理
        
        Args:
            tool_name: 工具名称 (格式: server_name:tool_name)
            arguments: 工具参数
            
        Returns:
            Dict[str, Any]: 工具执行结果或错误信息
        """
        try:
            # 解析工具名称 (格式: server_name:tool_name)
            if ":" not in tool_name:
                return {"success": False, "error": "工具名称格式错误，应为 server_name:tool_name"}
                
            server_name, actual_tool_name = tool_name.split(":", 1)
            
            # 检查服务器连接状态
            if server_name not in self.active_sessions:
                return {"success": False, "error": f"服务器 {server_name} 未连接"}
                
            # 检查服务器是否支持tools/call方法
            session = self.active_sessions.get(server_name, {})
            supported_methods = session.get("supported_methods", [])
            
            if "tools/call" not in supported_methods:
                return {
                    "success": False,
                    "error": f"服务器 {server_name} 不支持工具调用API",
                    "unsupported": True
                }
                
            # 验证工具是否存在
            tool_exists = False
            for key in self.available_tools.keys():
                if key == tool_name:
                    tool_exists = True
                    break
                    
            if not tool_exists:
                logger.warning(f"尝试调用未知工具: {tool_name}")
                # 尝试刷新工具列表
                tools = await self._list_tools(server_name)
                for tool in tools:
                    tool_key = f"{server_name}:{tool.name}"
                    self.available_tools[tool_key] = tool
                    if tool_key == tool_name:
                        tool_exists = True
                        
            if not tool_exists:
                return {"success": False, "error": f"未知工具: {tool_name}"}
            
            # 通过MCP协议执行实际的工具调用
            result = await self._execute_tool_call(server_name, actual_tool_name, arguments)
            return result
            
        except Exception as e:
            logger.error(f"调用MCP工具失败 {tool_name}: {e}")
            return {"success": False, "error": str(e)}
    async def _execute_tool_call(self, server_name: str, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """执行具体的工具调用 - 通过MCP协议与服务器通信
        
        按照MCP标准执行工具调用，处理错误并返回标准格式的结果
        
        Args:
            server_name: 服务器名称
            tool_name: 工具名称
            arguments: 工具参数
            
        Returns:
            Dict[str, Any]: 工具执行结果或错误信息
        """
        try:
            session = self.active_sessions.get(server_name)
            if not session:
                return {"success": False, "error": f"服务器 {server_name} 未连接"}
            
            # 构建tools/call请求参数
            params = {
                "name": tool_name,
                "arguments": arguments
            }
            
            logger.info(f"正在通过MCP协议调用工具: {server_name}:{tool_name}")
            logger.debug(f"工具参数: {arguments}")
            
            # 发送tools/call请求
            response = await self._send_mcp_request(server_name, "tools/call", params)
            
            # 处理响应
            if "error" in response:
                error_message = response.get("error", {}).get("message", "未知错误")
                error_code = response.get("error", {}).get("code", -1)
                
                # 处理特定错误类型
                if error_code == -32601:  # Method not found
                    # 更新支持的方法列表
                    supported_methods = session.get("supported_methods", [])
                    if "tools/call" in supported_methods:
                        supported_methods.remove("tools/call")
                        session["supported_methods"] = supported_methods
                        
                    logger.error(f"服务器 {server_name} 不支持tools/call方法，不符合MCP标准")
                    return {
                        "success": False,
                        "error": "工具调用API不受支持",
                        "error_code": error_code,
                        "unsupported": True
                    }
                elif error_code == -32602:  # Invalid params
                    logger.error(f"工具参数无效: {error_message}")
                    return {
                        "success": False,
                        "error": f"工具参数无效: {error_message}",
                        "error_code": error_code
                    }
                
                logger.error(f"MCP工具调用失败 {server_name}:{tool_name}: {error_message} (code: {error_code})")
                return {
                    "success": False,
                    "error": error_message,
                    "error_code": error_code
                }
            
            # 提取结果
            result = response.get("result", {})
            
            # 检查是否有错误结果（MCP标准中通过isError标记错误结果）
            if isinstance(result, dict) and result.get("isError", False):
                logger.warning(f"工具 {server_name}:{tool_name} 执行报告错误")
                error_content = ""
                
                # 从content提取错误信息
                content = result.get("content", [])
                if isinstance(content, list):
                    for item in content:
                        if isinstance(item, dict) and item.get("type") == "text":
                            error_content += item.get("text", "")
                
                return {
                    "success": False,
                    "error": error_content or "工具执行错误",
                    "tool_error": True,
                    "result": result
                }
            
            logger.info(f"MCP工具调用成功: {server_name}:{tool_name}")
            
            return {
                "success": True,
                "result": result
            }
            
        except Exception as e:
            logger.error(f"执行MCP工具调用失败 {server_name}:{tool_name}: {e}")
            return {
                "success": False,
                "error": f"工具调用过程中发生错误: {str(e)}",
            }
    async def get_resource(self, resource_uri: str) -> Dict[str, Any]:
        """获取MCP资源 - 通过MCP协议动态获取
        
        按照MCP标准获取资源内容，处理不支持的情况
        
        Args:
            resource_uri: 资源URI (格式: server_name:resource_path)
            
        Returns:
            Dict[str, Any]: 资源内容或错误信息
        """
        try:
            # 解析资源URI (格式: server_name:resource_path)
            if ":" not in resource_uri:
                return {"success": False, "error": "资源URI格式错误，应为 server_name:resource_path"}
                
            server_name, resource_path = resource_uri.split(":", 1)
            
            # 检查服务器连接状态
            session = self.active_sessions.get(server_name)
            if not session:
                return {"success": False, "error": f"服务器 {server_name} 未连接"}
            
            # 检查服务器是否支持resources/read方法
            supported_methods = session.get("supported_methods", [])
            if "resources/read" not in supported_methods:
                return {
                    "success": False, 
                    "error": f"服务器 {server_name} 不支持资源读取API",
                    "unsupported": True
                }
            
            # 发送 resources/read 请求
            logger.debug(f"尝试读取资源: {resource_uri}")
            params = {"uri": resource_path}
            response = await self._send_mcp_request(server_name, "resources/read", params)
            
            if "error" in response:
                error_code = response.get("error", {}).get("code", 0)
                error_message = response.get("error", {}).get("message", "未知错误")
                
                # 特殊处理方法不存在的错误 - 资源API是可选的
                if error_code == -32601:  # Method not found
                    logger.info(f"服务器 {server_name} 不支持资源API (resources/read)，更新支持方法列表")
                    # 更新服务器的支持方法列表
                    if "resources/read" in supported_methods:
                        supported_methods.remove("resources/read")
                        session["supported_methods"] = supported_methods
                    
                    return {
                        "success": False, 
                        "error": "资源API不受支持",
                        "error_code": error_code,
                        "unsupported": True
                    }
                elif error_code == -32602:  # Invalid params
                    return {
                        "success": False,
                        "error": f"资源URI无效: {error_message}",
                        "error_code": error_code
                    }
                elif error_code == 404:  # Resource not found
                    return {
                        "success": False,
                        "error": f"资源不存在: {error_message}",
                        "error_code": error_code
                    }
                
                logger.error(f"获取资源失败: {error_message}")
                return {"success": False, "error": error_message, "error_code": error_code}
                
            # 处理响应
            result = response.get("result", {})
            
            # 验证响应是否符合MCP标准
            if "content" not in result:
                logger.warning(f"资源响应缺少content字段: {result}")
                return {
                    "success": False,
                    "error": "资源响应格式不符合MCP标准",
                    "response": result
                }
                
            return {
                "success": True,
                "resource": result
            }
            
        except Exception as e:
            logger.error(f"获取MCP资源失败 {resource_uri}: {e}")
            return {"success": False, "error": str(e)}
            
    async def get_server_info(self, server_name: str) -> Dict[str, Any]:
        """获取服务器信息
        
        通过system/info方法获取服务器的详细信息，按照MCP标准处理
        
        Args:
            server_name: 服务器名称
            
        Returns:
            Dict[str, Any]: 服务器信息
        """
        if server_name not in self.active_sessions:
            return {"success": False, "error": f"服务器 {server_name} 未连接"}
        
        session = self.active_sessions.get(server_name)
        
        # 检查是否支持system/info方法
        supported_methods = session.get("supported_methods", [])
        if "system/info" not in supported_methods:
            return {
                "success": False,
                "error": f"服务器 {server_name} 不支持系统信息API",
                "unsupported": True
            }
        
        try:
            # 发送system/info请求
            logger.debug(f"正在获取服务器 {server_name} 的系统信息")
            response = await self._send_mcp_request(server_name, "system/info")
            
            if "error" in response:
                error_code = response.get("error", {}).get("code", 0)
                error_msg = response.get("error", {}).get("message", "未知错误")
                
                # 更新方法支持列表 - 系统API是可选的
                if error_code == -32601:  # Method not found
                    logger.info(f"服务器 {server_name} 不支持system/info方法")
                    if "system/info" in supported_methods:
                        supported_methods.remove("system/info")
                        session["supported_methods"] = supported_methods
                
                    return {
                        "success": False,
                        "error": "系统信息API不受支持",
                        "error_code": error_code,
                        "unsupported": True
                    }
                
                logger.error(f"获取服务器信息失败: {error_msg}")
                return {
                    "success": False,
                    "error": error_msg,
                    "error_code": error_code
                }
            
            # 处理响应结果 - 确保返回的是有效的JSON结构
            result = response.get("result", {})
            
            # 提取有用的系统信息
            system_info = {
                "server": server_name,
                "name": result.get("name", "未知"),
                "version": result.get("version", "未知"),
                "description": result.get("description", ""),
                "capabilities": result.get("capabilities", {}),
                "full_info": result  # 保留完整信息
            }
            
            return {
                "success": True,
                "info": system_info
            }            
        except Exception as e:
            logger.error(f"获取服务器信息失败: {e}")
            return {"success": False, "error": str(e)}
        
    def get_available_tools(self) -> Dict[str, MCPTool]:
        """获取所有可用工具"""
        return self.available_tools.copy()
        
    def get_available_resources(self) -> Dict[str, MCPResource]:
        """获取所有可用资源"""
        return self.available_resources.copy()
        
    def get_server_status(self) -> Dict[str, Any]:
        """获取服务器状态
        
        获取所有服务器的连接状态、工具数量、资源数量和支持的功能
        
        Returns:
            Dict[str, Any]: 服务器状态信息
        """
        status = {}
        for server_name, server in self.servers.items():
            session = self.active_sessions.get(server_name)
            server_info = {
                "enabled": server.enabled,
                "connected": session is not None and session.get("connected", False),
                "tools_count": len([t for t in self.available_tools.keys() if t.startswith(f"{server_name}:")]),
                "resources_count": len([r for r in self.available_resources.keys() if r.startswith(f"{server_name}:")]),
                "transport": server.transport.value,
                "features": {}
            }
            
            # 如果已连接，添加支持的功能信息
            if server_info["connected"]:
                # 添加功能支持信息
                server_info["features"] = {
                    "tools": self.supports_feature(server_name, "tools"),
                    "resources": self.supports_feature(server_name, "resources"),
                    "system": self.supports_feature(server_name, "system"),
                    "prompts": self.supports_feature(server_name, "prompts"),
                    "sampling": self.supports_feature(server_name, "sampling"),
                    "notifications": self.supports_feature(server_name, "notifications")
                }
                
                # 添加支持的方法列表
                supported_methods = self.get_supported_methods(server_name)
                server_info["methods"] = supported_methods
                server_info["methods_count"] = len(supported_methods)
                
                # 添加连接时间
                if session and "created_at" in session:
                    created_at = session["created_at"]
                    if isinstance(created_at, datetime):
                        server_info["connected_since"] = created_at.isoformat()
                
            status[server_name] = server_info
        return status
    
    def supports_feature(self, server_name: str, feature: str) -> bool:
        """检查服务器是否支持特定功能或方法

        根据支持的方法列表判断服务器是否支持某个功能类别或特定方法

        Args:
            server_name: 服务器名称
            feature: 功能名称 (resources, tools, system等) 或特定方法名称

        Returns:
            bool: 是否支持该功能
        """
        if server_name not in self.active_sessions:
            return False
            
        session = self.active_sessions.get(server_name, {})
        supported_methods = session.get("supported_methods", [])
        
        # 检查具体方法
        if "/" in feature:
            return feature in supported_methods
            
        # 检查功能类别
        if feature == "resources":
            return any(method.startswith("resources/") for method in supported_methods)
        elif feature == "tools":
            return any(method.startswith("tools/") for method in supported_methods) 
        elif feature == "system":
            return any(method.startswith("system/") for method in supported_methods)
        elif feature == "prompts":
            return any(method.startswith("prompts/") for method in supported_methods)
        elif feature == "sampling":
            return any(method.startswith("sampling/") for method in supported_methods)
        elif feature == "notifications":
            return any(method.startswith("notifications/") for method in supported_methods)
        
        # 默认不支持
        return False
        
    def get_supported_methods(self, server_name: str) -> List[str]:
        """获取服务器支持的方法列表
        
        Args:
            server_name: 服务器名称
            
        Returns:
            List[str]: 支持的方法列表
        """
        if server_name not in self.active_sessions:
            return []
            
        session = self.active_sessions.get(server_name, {})
        return session.get("supported_methods", [])
        
    async def shutdown(self):
        """关闭所有连接和清理资源"""
        # 首先标记所有会话为关闭状态
        for server_name in list(self.active_sessions.keys()):
            self.active_sessions[server_name]["connected"] = False
        
        # 强制进行垃圾回收，确保任何待回收的对象都被回收
        gc.collect()
        
        # 处理每个会话
        for server_name in list(self.active_sessions.keys()):
            try:
                session = self.active_sessions.get(server_name, {})
                
                # 关闭子进程
                process = session.get("process")
                if process:
                    try:
                        # 确保子进程被终止
                        if hasattr(process, 'returncode') and process.returncode is None:
                            # 首先尝试优雅终止
                            try:
                                process.terminate()
                                # 使用同步方法等待一小段时间
                                import time
                                for _ in range(10):  # 等待最多1秒
                                    if process.returncode is not None:
                                        break
                                    time.sleep(0.1)
                            except Exception as e:
                                logger.debug(f"终止进程时出错: {e}")
                            
                            # 如果进程仍在运行，强制终止
                            if hasattr(process, 'returncode') and process.returncode is None:
                                try:
                                    process.kill()
                                except Exception as e:
                                    logger.debug(f"强制终止进程时出错: {e}")
                    except Exception as e:
                        logger.debug(f"关闭进程时出错: {e}")
                    
                    # 关闭标准输入输出流
                    for stream_name, stream in [
                        ("stdin", getattr(process, "stdin", None)),
                        ("stdout", getattr(process, "stdout", None)),
                        ("stderr", getattr(process, "stderr", None))
                    ]:
                        if stream:
                            try:
                                # 首先检查流是否已经关闭
                                if hasattr(stream, "is_closing") and not stream.is_closing():
                                    stream.close()
                            except Exception as e:
                                logger.debug(f"关闭{stream_name}流时出错: {e}")
                
                # 从活动会话中移除
                try:
                    del self.active_sessions[server_name]
                    logger.info(f"已断开与服务器 {server_name} 的连接")
                except Exception as e:
                    logger.error(f"清理服务器 {server_name} 会话时出错: {e}")
            except Exception as e:
                logger.error(f"断开服务器 {server_name} 连接失败: {e}")
        
        # 清理自身资源
        self.available_tools.clear()
        self.available_resources.clear()
        
        # 强制进行另一轮垃圾回收
        gc.collect()

    # MARK: MCP协议消息处理
    def _build_mcp_request(self, method: str, params: Dict[str, Any] = None) -> Dict[str, Any]:
        """构建MCP协议请求消息"""
        request = {
            "jsonrpc": "2.0",
            "id": str(uuid.uuid4()),
            "method": method
        }
        if params:
            request["params"] = params
        return request
    
    def _build_mcp_response(self, request_id: str, result: Any = None, error: Dict[str, Any] = None) -> Dict[str, Any]:
        """构建MCP协议响应消息"""
        response = {
            "jsonrpc": "2.0",
            "id": request_id
        }
        if error:
            response["error"] = error
        else:
            response["result"] = result
        return response
    async def _send_mcp_request(self, server_name: str, method: str, params: Dict[str, Any] = None) -> Dict[str, Any]:
        """发送MCP协议请求到服务器"""
        if server_name not in self.active_sessions:
            return {"error": {"code": -1, "message": f"服务器 {server_name} 未连接"}}
        
        session = self.active_sessions[server_name]
        
        # 构建请求消息
        request_data = self._build_mcp_request(method, params)
        request_str = json.dumps(request_data) + "\n"
        
        logger.debug(f"发送MCP请求到 {server_name}: {request_data}")
        
        try:
            # 根据传输类型发送请求
            if session.get("transport") == "stdio":
                process = session.get("process")
                if not process:
                    return {"error": {"code": -1, "message": f"服务器 {server_name} 进程未运行"}}
                
                # 检查进程和标准输入输出流是否可用
                if process.returncode is not None:
                    return {"error": {"code": -1, "message": f"服务器 {server_name} 进程已退出，返回码 {process.returncode}"}}
                
                try:
                    # 检查stdin是否可用
                    if process.stdin.is_closing():
                        return {"error": {"code": -1, "message": f"服务器 {server_name} 标准输入已关闭"}}
                    
                    # 发送消息到子进程的标准输入
                    process.stdin.write(request_str.encode('utf-8'))
                    await process.stdin.drain()
                except (BrokenPipeError, ConnectionResetError, RuntimeError) as e:
                    # 处理管道关闭或连接重置的情况
                    logger.error(f"与服务器 {server_name} 的连接已断开: {e}")
                    return {"error": {"code": -1, "message": f"连接已断开: {str(e)}"}}
                
                try:
                    # 从标准输出读取响应
                    response_line = await asyncio.wait_for(
                        process.stdout.readline(), 
                        timeout=session.get("server").timeout
                    )
                    
                    if not response_line:
                        return {"error": {"code": -1, "message": f"服务器 {server_name} 无响应"}}
                    
                    # 解析响应JSON
                    try:
                        response_data = json.loads(response_line.decode('utf-8'))
                        return response_data
                    except json.JSONDecodeError as e:
                        logger.error(f"解析MCP响应失败: {e}, 原始响应: {response_line}")
                        return {"error": {"code": -32700, "message": f"解析响应失败: {str(e)}"}}
                except (BrokenPipeError, ConnectionResetError, RuntimeError) as e:
                    # 处理管道关闭或连接重置的情况
                    logger.error(f"从服务器 {server_name} 读取响应时连接已断开: {e}")
                    return {"error": {"code": -1, "message": f"读取响应时连接已断开: {str(e)}"}}
            
            elif session.get("transport") == "http_sse" or session.get("transport") == "websocket":
                # HTTP和WebSocket实现待添加，目前返回未实现错误
                return {
                    "error": {
                        "code": -32000,
                        "message": f"{session.get('transport')} 传输类型待实现",
                        "data": {"server": server_name, "method": method}
                    }
                }
            
            else:
                return {"error": {"code": -32000, "message": f"不支持的传输类型: {session.get('transport')}"}}
                
        except asyncio.TimeoutError:
            logger.error(f"MCP请求超时: {server_name}, 方法: {method}")
            return {"error": {"code": -32000, "message": "请求超时"}}
        except asyncio.CancelledError:
            # 请求被取消，可能是由于事件循环关闭
            logger.warning(f"MCP请求被取消: {server_name}, 方法: {method}")
            return {"error": {"code": -32000, "message": "请求被取消"}}
        except RuntimeError as e:
            if "Event loop is closed" in str(e):
                logger.warning(f"MCP请求失败，事件循环已关闭: {server_name}, 方法: {method}")
                return {"error": {"code": -32000, "message": "事件循环已关闭"}}
            logger.error(f"发送MCP请求失败: {e}")
            return {"error": {"code": -32000, "message": f"请求失败: {str(e)}"}}
        except Exception as e:
            logger.error(f"发送MCP请求失败: {e}")
            import traceback
            logger.debug(f"详细错误: {traceback.format_exc()}")
            return {"error": {"code": -32000, "message": f"请求失败: {str(e)}"}}
        


# 全局MCP客户端实例
mcp_client = MCPClient()

async def init_mcp_client():
    """异步初始化MCP客户端"""
    if not mcp_client.servers:  # 只在未初始化时初始化
        await mcp_client.initialize()
