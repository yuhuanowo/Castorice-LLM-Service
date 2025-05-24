#!/usr/bin/env python3
"""
调试脚本：检查MCP工具传递给LLM的详细信息
"""
import asyncio
import json
import sys
import os

# 添加项目根目录到Python路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.services.mcp_client import mcp_client
from app.services.llm_service import LLMService

async def debug_mcp_tools():
    """调试MCP工具信息"""
    print("=== MCP工具调试信息 ===\n")
    
    # 1. 初始化MCP客户端
    print("1. 初始化MCP客户端...")
    try:
        await mcp_client.initialize()
        print("✓ MCP客户端初始化成功")
    except Exception as e:
        print(f"✗ MCP客户端初始化失败: {e}")
        return
    
    # 2. 获取原始MCP工具
    print("\n2. 获取原始MCP工具...")
    available_tools = mcp_client.get_available_tools()
    print(f"发现 {len(available_tools)} 个MCP工具:")
    
    for tool_key, tool in available_tools.items():
        print(f"  - {tool_key}: {tool.description[:100]}...")
        
    # 3. 检查LLM服务的工具定义转换
    print("\n3. 检查LLM工具定义转换...")
    llm_service = LLMService()
    
    # 获取包含MCP工具的完整工具定义
    tool_definitions = llm_service.get_tool_definitions(enable_mcp=True)
    
    # 分离MCP工具和其他工具
    mcp_tools = [tool for tool in tool_definitions if tool.get("function", {}).get("name", "").startswith("mcp_")]
    other_tools = [tool for tool in tool_definitions if not tool.get("function", {}).get("name", "").startswith("mcp_")]
    
    print(f"总工具数: {len(tool_definitions)}")
    print(f"MCP工具数: {len(mcp_tools)}")
    print(f"其他工具数: {len(other_tools)}")
    
    # 4. 计算token使用量估计
    print("\n4. 计算token使用量估计...")
    
    def estimate_tokens(text):
        """简单估计token数量（大致每4个字符=1个token）"""
        return len(str(text)) // 4
    
    # 将工具定义序列化为JSON来计算大小
    all_tools_json = json.dumps(tool_definitions, indent=2)
    mcp_tools_json = json.dumps(mcp_tools, indent=2)
    other_tools_json = json.dumps(other_tools, indent=2)
    
    print(f"所有工具JSON大小: {len(all_tools_json):,} 字符 (~{estimate_tokens(all_tools_json):,} tokens)")
    print(f"MCP工具JSON大小: {len(mcp_tools_json):,} 字符 (~{estimate_tokens(mcp_tools_json):,} tokens)")
    print(f"其他工具JSON大小: {len(other_tools_json):,} 字符 (~{estimate_tokens(other_tools_json):,} tokens)")
    
    #mcp_filesystem_edit_file的內容
    print (mcp_tools_json)

    # 5. 显示最大的几个工具定义
    print("\n5. 最大的工具定义:")
    
    tool_sizes = []
    for tool in tool_definitions:
        tool_json = json.dumps(tool, indent=2)
        size = len(tool_json)
        tool_name = tool.get("function", {}).get("name", "未知")
        tool_sizes.append((tool_name, size, tool))
    
    # 按大小排序
    tool_sizes.sort(key=lambda x: x[1], reverse=True)
    
    for i, (name, size, tool) in enumerate(tool_sizes[:5]):  # 显示前5个最大的
        print(f"  {i+1}. {name}: {size:,} 字符 (~{estimate_tokens(size):,} tokens)")
        
        # 显示参数schema的复杂度
        params = tool.get("function", {}).get("parameters", {})
        properties_count = len(params.get("properties", {}))
        print(f"     参数数量: {properties_count}")
    
    # 6. 保存详细信息到文件
    print("\n6. 保存详细信息...")
    
    debug_info = {
        "summary": {
            "total_tools": len(tool_definitions),
            "mcp_tools": len(mcp_tools),
            "other_tools": len(other_tools),
            "total_size_chars": len(all_tools_json),
            "total_size_tokens_estimate": estimate_tokens(all_tools_json),
            "mcp_size_chars": len(mcp_tools_json),
            "mcp_size_tokens_estimate": estimate_tokens(mcp_tools_json)
        },
        "tool_sizes": tool_sizes[:10],  # 保存前10个最大的
        "all_tools": tool_definitions
    }
    
    with open("debug_mcp_tools_output.json", "w", encoding="utf-8") as f:
        json.dump(debug_info, f, indent=2, ensure_ascii=False)
    
    print("✓ 详细信息已保存到 debug_mcp_tools_output.json")
    
    # 7. 建议优化方案
    print("\n7. 优化建议:")
    
    if estimate_tokens(all_tools_json) > 8000:  # 如果工具定义超过8000 tokens
        print("⚠️  工具定义过大，建议优化:")
        print("   - 禁用不必要的MCP服务器")
        print("   - 简化工具描述")
        print("   - 减少参数schema的复杂度")
        print("   - 实现工具选择性加载")
    
    if len(mcp_tools) > 20:
        print("⚠️  MCP工具数量过多，建议:")
        print("   - 仅启用必要的MCP服务器")
        print("   - 实现动态工具加载")
    
    # 清理资源

if __name__ == "__main__":
    asyncio.run(debug_mcp_tools())
