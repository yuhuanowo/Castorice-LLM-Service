import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      message, 
      model, 
      userId, 
      enable_search = false, 
      conversation_history = [] 
    } = body;

    // 构建消息历史
    let messages = [];
    
    // 如果有对话历史，添加到消息中
    if (conversation_history && conversation_history.length > 0) {
      messages = conversation_history.slice(-10); // 限制历史消息数量
    }
    
    // 添加当前用户消息
    messages.push({ role: "user", content: message });

    // 调用后端API
    const response = await fetch(`${process.env.API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": process.env.API_KEY || "demo", // 从环境变量获取API密钥
      },
      body: JSON.stringify({
        messages: messages,
        model: model,
        user_id: userId || "anonymous",
        enable_search: enable_search,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("后端API错误:", errorText);
      throw new Error(`API请求失败: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    
    // 返回响应，包括可能的搜索结果
    return NextResponse.json({
      response: data.response || data.choices?.[0]?.message?.content || "抱歉，无法获取回复",
      search_results: data.search_results || [],
      model: model,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("API调用出错:", error);
    return NextResponse.json(
      { 
        error: "处理请求时出错",
        response: "抱歉，当前服务不可用，请稍后重试。",
        search_results: []
      },
      { status: 500 }
    );
  }
}
