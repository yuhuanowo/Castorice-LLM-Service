"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Send, 
  Search, 
  Bot, 
  User, 
  Loader2, 
  Globe, 
  ExternalLink,
  Eye,
  EyeOff,
  Copy
} from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  searchResults?: SearchResult[];
  isGenerating?: boolean;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  favicon?: string;
}

function SearchPageContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  const initialModel = searchParams.get("model") || "github-copilot-chat";

  const [query, setQuery] = useState(initialQuery);
  const [selectedModel, setSelectedModel] = useState(initialModel);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSources, setShowSources] = useState(true);
  const [inputMessage, setInputMessage] = useState("");

  const models = [
    { id: "github-copilot-chat", name: "GitHub Copilot" },
    { id: "gemini-pro", name: "Gemini Pro" },
    { id: "gpt-4", name: "GPT-4" },
  ];
  useEffect(() => {
    if (initialQuery) {
      const performInitialSearch = () => {
        handleSearch(initialQuery);
      };
      performInitialSearch();
    }
  }, []); // initialQuery is stable from useSearchParams

  const handleSearch = async (searchQuery: string = query) => {
    if (!searchQuery.trim()) return;

    setIsLoading(true);
    
    // 创建用户消息
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: searchQuery,
      timestamp: new Date(),
    };

    // 创建AI响应消息（初始化为生成中状态）
    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content: "",
      timestamp: new Date(),
      isGenerating: true,
      searchResults: [],
    };

    setMessages(prev => [...prev, userMessage, assistantMessage]);

    try {
      // 调用搜索API
      const searchResponse = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: searchQuery,
          model: selectedModel,
          enable_search: true,
        }),
      });

      if (!searchResponse.ok) {
        throw new Error("搜索请求失败");
      }

      const reader = searchResponse.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = "";
      let searchResults: SearchResult[] = [];

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                
                if (data.type === "search_results") {
                  searchResults = data.results || [];
                } else if (data.type === "content") {
                  accumulatedContent += data.content;
                } else if (data.type === "done") {
                  // 完成响应
                  setMessages(prev => 
                    prev.map(msg => 
                      msg.id === assistantMessage.id 
                        ? { 
                            ...msg, 
                            content: accumulatedContent,
                            searchResults,
                            isGenerating: false 
                          }
                        : msg
                    )
                  );
                }

                // 实时更新内容
                setMessages(prev => 
                  prev.map(msg => 
                    msg.id === assistantMessage.id 
                      ? { 
                          ...msg, 
                          content: accumulatedContent,
                          searchResults 
                        }
                      : msg
                  )
                );
              } catch (e) {
                console.error("解析SSE数据错误:", e);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("搜索错误:", error);
      setMessages(prev => 
        prev.map(msg => 
          msg.id === assistantMessage.id 
            ? { 
                ...msg, 
                content: "抱歉，搜索时发生错误。请稍后重试。",
                isGenerating: false 
              }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = () => {
    if (inputMessage.trim()) {
      handleSearch(inputMessage);
      setInputMessage("");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto p-4 space-y-6">
          {/* Search Header */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col space-y-4">
                <div className="flex items-center space-x-2">
                  <div className="flex-1 flex space-x-2">
                    <Input
                      placeholder="搜索任何内容..."
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyPress={(e) => e.key === "Enter" && handleSearch()}
                      className="flex-1"
                    />
                    <Button 
                      onClick={() => handleSearch()} 
                      disabled={isLoading}
                      className="px-4"
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <span className="text-sm text-muted-foreground">模型:</span>
                    <Select value={selectedModel} onValueChange={setSelectedModel}>
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {models.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowSources(!showSources)}
                    >
                      {showSources ? (
                        <>
                          <EyeOff className="h-4 w-4 mr-2" />
                          隐藏来源
                        </>
                      ) : (
                        <>
                          <Eye className="h-4 w-4 mr-2" />
                          显示来源
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Messages */}
          <div className="space-y-6">
            {messages.length === 0 && !isLoading && (
              <div className="text-center py-12">
                <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">开始搜索</h3>
                <p className="text-muted-foreground">
                  输入您的问题，让 AI 为您搜索和分析答案
                </p>
              </div>
            )}

            {messages.map((message) => (
              <div key={message.id} className="space-y-4">
                {message.role === "user" ? (
                  <div className="flex items-start space-x-3">
                    <div className="p-2 bg-primary rounded-full">
                      <User className="h-4 w-4 text-primary-foreground" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium mb-1">您</p>
                      <div className="prose prose-sm max-w-none">
                        {message.content}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-start space-x-3">
                      <div className="p-2 bg-muted rounded-full">
                        <Bot className="h-4 w-4" />
                      </div>
                      <div className="flex-1 space-y-4">
                        <div className="flex items-center justify-between">
                          <p className="font-medium">AI 助手</p>
                          <div className="flex items-center space-x-2">
                            <Badge variant="secondary" className="text-xs">
                              {selectedModel}
                            </Badge>
                            {!message.isGenerating && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copyToClipboard(message.content)}
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* 搜索结果源 */}
                        {showSources && message.searchResults && message.searchResults.length > 0 && (
                          <Card>
                            <CardHeader className="pb-3">
                              <CardTitle className="text-sm flex items-center">
                                <Globe className="h-4 w-4 mr-2" />
                                搜索来源
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-0">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {message.searchResults.slice(0, 6).map((result, index) => (
                                  <div
                                    key={index}
                                    className="p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                                  >
                                    <div className="flex items-start space-x-2">
                                      <Globe className="h-4 w-4 mt-1 text-muted-foreground shrink-0" />
                                      <div className="flex-1 min-w-0">
                                        <a
                                          href={result.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-sm font-medium hover:underline line-clamp-1"
                                        >
                                          {result.title}
                                        </a>
                                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                                          {result.snippet}
                                        </p>
                                      </div>
                                      <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        {/* AI回答内容 */}
                        <div className="prose prose-sm max-w-none">
                          {message.isGenerating ? (
                            <div className="space-y-2">
                              <Skeleton className="h-4 w-full" />
                              <Skeleton className="h-4 w-4/5" />
                              <Skeleton className="h-4 w-3/5" />
                            </div>
                          ) : (
                            <div className="whitespace-pre-wrap">
                              {message.content || "正在生成回答..."}
                            </div>
                          )}
                          {message.isGenerating && (
                            <div className="flex items-center space-x-2 mt-3">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span className="text-sm text-muted-foreground">
                                AI 正在思考中...
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Follow-up Input */}
          {messages.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <div className="flex space-x-2">
                  <Input
                    placeholder="继续提问..."
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyPress={handleKeyPress}
                    disabled={isLoading}
                    className="flex-1"
                  />
                  <Button 
                    onClick={handleSendMessage} 
                    disabled={isLoading || !inputMessage.trim()}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}        </div>
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
      <SearchPageContent />
    </Suspense>
  );
}
