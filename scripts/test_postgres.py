"""
PostgreSQL MCP服务器测试脚本
专门用于测试PostgreSQL查询功能

用法:
    python test_postgres.py
"""

import asyncio
import sys
import json
from pathlib import Path

# 添加项目根目录到Python路径
sys.path.append(str(Path(__file__).parent))

# 导入MCP客户端
from app.services.mcp_client import mcp_client, init_mcp_client
from app.utils.logger import logger


async def test_postgres_connection():
    """测试PostgreSQL连接"""
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
        # 打印工具的输入模式，以了解如何调用
        print(f"    输入模式: {json.dumps(tool.inputSchema, indent=2, ensure_ascii=False)}")
    
    # 获取可用资源
    resources = mcp_client.get_available_resources()
    print(f"发现 {len(resources)} 个可用资源:")
    for key, resource in resources.items():
        print(f"  - {key}: {resource.name} - {resource.description}")
    
    # 检查是否有PostgreSQL工具
    postgres_tools = [t for t in tools.keys() if t.startswith("postgres:")]
    if postgres_tools:
        print(f"\n找到PostgreSQL工具: {postgres_tools}")
        return True
    else:
        print("\n未找到PostgreSQL工具")
        return False


async def test_postgres_query():
    """测试PostgreSQL查询"""
    # 假设工具名为postgres:query
    tool_name = "postgres:query"
    
    print(f"\n测试PostgreSQL查询 ({tool_name})...")    
    try:
        # 执行简单的测试查询
        query = "SELECT version();"
        print(f"执行查询: {query}")
        
        result = await mcp_client.call_tool(tool_name, {
            "sql": query
        })
        
        print(f"查询结果: {json.dumps(result, indent=2, ensure_ascii=False)}")
        
        # 如果成功，尝试更复杂的查询
        if result.get("success"):
            # 获取数据库中的表
            query = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';"
            print(f"\n执行查询: {query}")
            
            result = await mcp_client.call_tool(tool_name, {
                "sql": query
            })
            
            print(f"查询结果: {json.dumps(result, indent=2, ensure_ascii=False)}")
            
            # 根据查询结果尝试查询一个表
            if result.get("success") and isinstance(result.get("result"), dict) and "rows" in result.get("result", {}):
                tables = result["result"]["rows"]
                if tables:
                    first_table = tables[0]["table_name"]
                    query = f"SELECT * FROM {first_table} LIMIT 5;"
                    print(f"\n执行查询: {query}")
                    
                    result = await mcp_client.call_tool(tool_name, {
                        "sql": query
                    })
                    
                    print(f"查询结果: {json.dumps(result, indent=2, ensure_ascii=False)}")
        
    except Exception as e:
        print(f"PostgreSQL查询测试失败: {e}")


async def main():
    """主函数"""
    try:
        # 测试PostgreSQL连接
        has_postgres = await test_postgres_connection()
        
        if has_postgres:
            # 测试PostgreSQL查询
            await test_postgres_query()
        else:
            print("未找到PostgreSQL工具，跳过查询测试")
            
        print("\nPostgreSQL测试完成")
        
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
