import { NextRequest } from "next/server";

export const runtime = 'edge'; // Edge Runtime for proper SSE streaming
export const dynamic = 'force-dynamic'; // Disable caching

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log('🔥 [Agent Edge API] Request received at:', new Date().toISOString());
  
  try {
    const body = await request.json();
    const apiKey = request.headers.get('X-API-KEY') || 'demo';
    
    const backendUrl = process.env.API_BASE_URL || 'http://localhost:8000';
    
    console.log('🚀 [Agent Edge API] Proxying to:', `${backendUrl}/api/v1/agent/`);
    console.log('📦 [Agent Edge API] Prompt:', body.prompt?.substring(0, 100));
    
    // Send request to backend
    const response = await fetch(`${backendUrl}/api/v1/agent/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ [Agent Edge API] Backend error:', response.status, errorText);
      return new Response(
        JSON.stringify({ error: errorText, status: response.status }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!response.body) {
      return new Response(
        JSON.stringify({ error: 'No response body' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ [Agent Edge API] Backend responded, starting SSE stream');

    // Use ReadableStream with controller for immediate flushing
    let chunkCount = 0;
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body!.getReader();
        
        try {
          while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
              console.log(`✅ [Agent Edge API] Stream complete. Total chunks: ${chunkCount}, Duration: ${Date.now() - startTime}ms`);
              controller.close();
              break;
            }
            
            // Immediately enqueue each chunk - no buffering
            chunkCount++;
            if (chunkCount <= 5 || chunkCount % 10 === 0) {
              console.log(`📨 [Agent Edge API] Chunk ${chunkCount}: ${value.length} bytes`);
            }
            controller.enqueue(value);
          }
        } catch (error) {
          console.error('❌ [Agent Edge API] Stream error:', error);
          controller.error(error);
        }
      }
    });

    // Return streaming response with SSE headers
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, no-transform, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
        'X-Content-Type-Options': 'nosniff',
      },
    });
    
  } catch (error) {
    console.error('❌ [Agent Edge API] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
