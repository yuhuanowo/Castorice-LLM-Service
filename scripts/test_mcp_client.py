"""
MCP客户端测试脚本
用于测试MCP连接和工具调用

用法:
    python test_mcp_client.py
"""

import asyncio
import sys
import json
import os
from pathlib import Path

# 添加项目根目录到Python路径
sys.path.append(str(Path(__file__).parent))

# 导入MCP客户端
from app.services.mcp_client import mcp_client, init_mcp_client
from app.utils.logger import logger


async def test_mcp_connection():
    """测试MCP连接"""
    print("正在初始化MCP客户端...")
    await init_mcp_client()
    
    # 获取服务器状态
    status = mcp_client.get_server_status()
    print(f"服务器状态: {json.dumps(status, indent=2, ensure_ascii=False)}")
    
    # 获取可用工具
    tools = mcp_client.get_available_tools()
    print(f"发现 {len(tools)} 个可用工具:")
    for key, tool in tools.items():
        print(f"  - {key}: {tool.description}")
    
    # 获取可用资源
    resources = mcp_client.get_available_resources()
    print(f"发现 {len(resources)} 个可用资源:")
    for key, resource in resources.items():
        print(f"  - {key}: {resource.name} - {resource.description}")
    
    # 测试服务器支持的方法
    await test_supported_methods()
    
    # 测试服务器信息
    await test_server_info()
    
    return status, tools, resources


async def test_file_tool():
    """测试文件系统工具"""
    if not any(t.startswith("filesystem:") for t in mcp_client.get_available_tools()):
        print("没有可用的文件系统工具，跳过测试")
        return
    
    print("\n测试文件系统工具...")
    try:
        # 列出目录内容
        print("列出目录内容:")
        result = await mcp_client.call_tool("filesystem:list_directory", {"path": "."})
        print(f"结果: {json.dumps(result, indent=2, ensure_ascii=False)}")
        
        # 读取文件内容
        test_file = "README.md"
        if os.path.exists(test_file):
            print(f"读取文件 {test_file}:")
            result = await mcp_client.call_tool("filesystem:read_file", {"path": test_file})
            content = result.get("result", {}).get("content", "")
            if len(content) > 200:
                content = content[:200] + "..."
            print(f"文件内容: {content}")
    except Exception as e:
        print(f"文件工具测试失败: {e}")


async def test_github_tool():
    """测试GitHub工具"""
    if not any(t.startswith("github:") for t in mcp_client.get_available_tools()):
        print("没有可用的GitHub工具，跳过测试")
        return
    
    print("\n测试GitHub工具...")
    try:
        # 搜索仓库
        query = "fastapi python"
        print(f"搜索GitHub仓库: {query}")
        result = await mcp_client.call_tool("github:search_repositories", {"query": query, "language": "python"})
        print(f"结果: {json.dumps(result, indent=2, ensure_ascii=False)}")
    except Exception as e:
        print(f"GitHub工具测试失败: {e}")


async def check_npm_installation():
    """检查npm和npx是否正确安装"""
    print("\n检查npm和npx安装...")
    try:
        # 检查npm版本
        npm_process = await asyncio.create_subprocess_exec(
            "npm", "--version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await npm_process.communicate()
        
        if npm_process.returncode == 0:
            npm_version = stdout.decode('utf-8').strip()
            print(f"npm版本: {npm_version}")
        else:
            stderr_str = stderr.decode('utf-8').strip()
            print(f"npm检查失败: {stderr_str}")
            
        # 检查npx版本
        npx_process = await asyncio.create_subprocess_exec(
            "npx", "--version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await npx_process.communicate()
        
        if npx_process.returncode == 0:
            npx_version = stdout.decode('utf-8').strip()
            print(f"npx版本: {npx_version}")
        else:
            stderr_str = stderr.decode('utf-8').strip()
            print(f"npx检查失败: {stderr_str}")
            
        # 检查是否能通过npx访问MCP服务器包
        for server_name, server in mcp_client.servers.items():
            if "npx" in server.command and len(server.args) > 1:
                package_name = server.args[1]
                if package_name.startswith("-y"):
                    package_name = server.args[2] if len(server.args) > 2 else None
                
                if package_name and not package_name.startswith("-"):
                    print(f"检查MCP包 {package_name}...")
                    check_process = await asyncio.create_subprocess_exec(
                        "npm", "info", package_name,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE
                    )
                    stdout, stderr = await check_process.communicate()
                    
                    if check_process.returncode == 0:
                        print(f"MCP包 {package_name} 存在")
                    else:
                        stderr_str = stderr.decode('utf-8').strip()
                        print(f"MCP包 {package_name} 检查失败: {stderr_str}")
                        
    except Exception as e:
        print(f"检查npm安装失败: {e}")
        print("请确保Node.js和npm已正确安装")


async def test_server_info():
    """测试获取服务器信息"""
    print("\n测试获取服务器信息...")
    for server_name in mcp_client.active_sessions.keys():
        # 检查服务器是否支持system/info方法
        if mcp_client.supports_feature(server_name, "system/info"):
            print(f"获取{server_name}服务器信息:")
            result = await mcp_client.get_server_info(server_name)
            print(f"结果: {json.dumps(result, indent=2, ensure_ascii=False)}")
        else:
            print(f"服务器 {server_name} 不支持system/info方法")


async def test_supported_methods():
    """测试获取服务器支持的方法"""
    print("\n测试获取服务器支持的方法...")
    for server_name in mcp_client.active_sessions.keys():
        methods = mcp_client.get_supported_methods(server_name)
        print(f"服务器 {server_name} 支持的方法: {methods}")
        
        # 显示是否支持各种功能
        features = {
            "工具(tools)": mcp_client.supports_feature(server_name, "tools"),
            "资源(resources)": mcp_client.supports_feature(server_name, "resources"),
            "系统(system)": mcp_client.supports_feature(server_name, "system"),
            "提示(prompts)": mcp_client.supports_feature(server_name, "prompts"),
        }
        print(f"服务器 {server_name} 支持的功能: {json.dumps(features, indent=2, ensure_ascii=False)}")


async def main():
    """主函数"""
    try:
        # 首先检查npm和npx安装
        await check_npm_installation()
        
        # 测试MCP连接
        status, tools, resources = await test_mcp_connection()
          # 测试工具调用
        if tools:
            await test_file_tool()
            await test_github_tool()
        else:
            print("没有发现可用工具，跳过工具测试")
            
        # 测试服务器信息获取
        await test_server_info()
        
        # 测试服务器支持的方法
        await test_supported_methods()
        
        print("\nMCP测试完成")
        
    except Exception as e:
        print(f"测试失败: {e}")
    finally:
        # 关闭MCP客户端
        await mcp_client.shutdown()


if __name__ == "__main__":
    # 在Windows上需要使用特定的事件循环策略来支持子进程
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    
    # 创建新的事件循环
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    try:
        loop.run_until_complete(main())
    finally:
        loop.close()
