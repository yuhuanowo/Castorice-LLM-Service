'use client'

import React, { useState } from 'react'
import { 
  Search, Clock, Bot, Loader, FileText, Calendar, MessageSquare,
  Filter, SortAsc, SortDesc, List, Grid3X3, Copy, Tag, Star,
  ChevronDown, MoreHorizontal
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// 类型定义
interface SearchResult {
  id: string
  type: 'chat' | 'message' | 'file'
  title: string
  content: string
  timestamp: string
  role?: 'user' | 'assistant'
  chatId?: string
  relevanceScore?: number
  highlights?: string[]
  category?: string
  tags?: string[]
}

interface ChatHistory {
  id: string
  title: string
  messages: Message[]
  timestamp: string
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  sessionId?: string  // 添加 sessionId 字段
}

interface SearchAreaProps {
  searchResults: SearchResult[]
  setSearchResults: (results: SearchResult[]) => void
  searchQuery: string
  setSearchQuery: (query: string) => void
  isSearching: boolean
  searchChatHistory: (query: string) => void
  chatHistory: ChatHistory[]
  loadChat: (chat: ChatHistory) => void
  setCurrentPage: (page: 'chat' | 'search' | 'files') => void
}

export function SearchArea({
  searchResults,
  setSearchResults,
  searchQuery,
  setSearchQuery,
  isSearching,
  searchChatHistory,
  chatHistory,
  loadChat,
  setCurrentPage
}: SearchAreaProps) {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list')
  const [sortBy, setSortBy] = useState<'relevance' | 'date' | 'type'>('relevance')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [filterType, setFilterType] = useState<'all' | 'chat' | 'message' | 'file'>('all')

  // 工具按钮组件
  const TooltipButton = ({ children, tooltip, ...props }: any) => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button {...props}>
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )

  // 过滤和排序结果
  const sortedAndFilteredResults = React.useMemo(() => {
    let filtered = searchResults
    
    if (filterType !== 'all') {
      filtered = filtered.filter(result => result.type === filterType)
    }

    return filtered.sort((a, b) => {
      let comparison = 0
      
      switch (sortBy) {
        case 'relevance':
          comparison = (b.relevanceScore || 0) - (a.relevanceScore || 0)
          break
        case 'date':
          comparison = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          break
        case 'type':
          comparison = a.type.localeCompare(b.type)
          break
      }
      
      return sortOrder === 'desc' ? comparison : -comparison
    })
  }, [searchResults, filterType, sortBy, sortOrder])

  return (
    <div className="h-full flex flex-col">
      {/* 搜索头部 */}
      <div className="p-8">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl mx-auto mb-6 flex items-center justify-center">
              <Search className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold mb-4">智能搜索</h1>
            <p className="text-muted-foreground text-lg">
              快速找到你需要的信息和资源
            </p>
          </div>
          
          {/* 搜索输入框 */}
          <div className="relative mb-8">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索对话记录、文件内容..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                if (e.target.value.trim()) {
                  searchChatHistory(e.target.value)
                } else {
                  setSearchResults([])
                }
              }}
              className="w-full pl-12 pr-4 py-4 text-lg border border-input rounded-xl bg-background focus:outline-none focus:ring-2 focus:ring-ring shadow-sm"
            />
            {isSearching && (
              <div className="absolute right-4 top-1/2 transform -translate-y-1/2">
                <Loader className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
          
          {/* 快捷搜索标签 */}
          {!searchQuery && (
            <div className="space-y-3">
              <h3 className="font-medium text-sm text-muted-foreground">常用搜索</h3>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: '今天的对话', query: new Date().toLocaleDateString('zh-CN') },
                  { label: '代码相关', query: 'code|代码|function|函数' },
                  { label: '图片文件', query: '图片|image|png|jpg' },
                  { label: '文档资料', query: '文档|document|doc|pdf' },
                  { label: '重要提醒', query: '重要|提醒|注意|警告' }
                ].map((tag) => (
                  <button
                    key={tag.label}
                    onClick={() => {
                      setSearchQuery(tag.query)
                      searchChatHistory(tag.query)
                    }}
                    className="px-3 py-1.5 text-sm bg-muted hover:bg-accent rounded-lg transition-colors"
                  >
                    {tag.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 搜索结果区域 */}
      {searchQuery && (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-8 pb-8">
            {/* 工具栏 */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-semibold">
                  搜索结果
                  {sortedAndFilteredResults.length > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {sortedAndFilteredResults.length}
                    </Badge>
                  )}
                </h2>
                
                {searchQuery && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="w-4 h-4" />
                    <span>"{searchQuery}"</span>
                  </div>
                )}
              </div>
              
              <div className="flex items-center gap-2">
                {/* 视图切换 */}
                <div className="flex items-center border border-border rounded-lg p-1">
                  <TooltipButton
                    variant={viewMode === 'list' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode('list')}
                    tooltip="列表视图"
                    className="h-8 w-8 p-0"
                  >
                    <List className="w-4 h-4" />
                  </TooltipButton>
                  <TooltipButton
                    variant={viewMode === 'grid' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode('grid')}
                    tooltip="网格视图"
                    className="h-8 w-8 p-0"
                  >
                    <Grid3X3 className="w-4 h-4" />
                  </TooltipButton>
                </div>
                
                {/* 排序 */}
                <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
                  <SelectTrigger className="w-32 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="relevance">相关性</SelectItem>
                    <SelectItem value="date">时间</SelectItem>
                    <SelectItem value="type">类型</SelectItem>
                  </SelectContent>
                </Select>
                
                <TooltipButton
                  variant="outline"
                  size="sm"
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                  tooltip={`${sortOrder === 'asc' ? '升序' : '降序'}排序`}
                  className="h-8 w-8 p-0"
                >
                  {sortOrder === 'asc' ? (
                    <SortAsc className="w-4 h-4" />
                  ) : (
                    <SortDesc className="w-4 h-4" />
                  )}
                </TooltipButton>
                
                {/* 过滤 */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8">
                      <Filter className="w-4 h-4 mr-1" />
                      筛选
                      {filterType !== 'all' && (
                        <Badge variant="secondary" className="ml-1 h-4 text-xs">
                          1
                        </Badge>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={() => setFilterType('all')}>
                      全部类型
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setFilterType('chat')}>
                      <MessageSquare className="w-4 h-4 mr-2" />
                      对话记录
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setFilterType('message')}>
                      <Bot className="w-4 h-4 mr-2" />
                      消息内容
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setFilterType('file')}>
                      <FileText className="w-4 h-4 mr-2" />
                      文件资源
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            
            {/* 搜索结果 */}
            {isSearching ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <Loader className="w-8 h-8 mx-auto mb-4 animate-spin text-muted-foreground" />
                  <p className="text-muted-foreground">正在搜索中...</p>
                </div>
              </div>
            ) : sortedAndFilteredResults.length > 0 ? (
              <div className={cn(
                "space-y-3",
                viewMode === 'grid' && "grid grid-cols-1 md:grid-cols-2 gap-4 space-y-0"
              )}>
                {sortedAndFilteredResults.map((result) => (
                  <div
                    key={result.id}
                    className="p-4 border border-border rounded-lg hover:bg-accent/50 cursor-pointer transition-colors group"
                    onClick={() => {
                      if (result.type === 'chat' || result.chatId) {
                        const chat = chatHistory.find(c => c.id === (result.chatId || result.id))
                        if (chat) {
                          loadChat(chat)
                          setCurrentPage('chat')
                        }
                      }
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {result.type === 'chat' ? (
                            <Clock className="w-4 h-4 text-blue-500" />
                          ) : result.type === 'file' ? (
                            <FileText className="w-4 h-4 text-purple-500" />
                          ) : (
                            <Bot className="w-4 h-4 text-muted-foreground" />
                          )}
                          <span className="font-medium text-sm">{result.title}</span>
                          {result.role && (
                            <span className="text-xs bg-muted px-2 py-1 rounded">
                              {result.role === 'user' ? '用户' : 'AI'}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {result.content}
                        </p>
                        
                        {/* 标签 */}
                        {result.tags && result.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {result.tags.slice(0, 3).map((tag, idx) => (
                              <Badge key={idx} variant="outline" className="h-5 text-xs">
                                <Tag className="w-3 h-3 mr-1" />
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      
                      <div className="flex flex-col items-end gap-2">
                        <span className="text-xs text-muted-foreground">
                          {new Date(result.timestamp).toLocaleDateString('zh-CN')}
                        </span>
                        
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <TooltipButton
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            tooltip="复制内容"
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation()
                              navigator.clipboard.writeText(result.content)
                              toast.success('已复制到剪贴板')
                            }}
                          >
                            <Copy className="w-3 h-3" />
                          </TooltipButton>
                          
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreHorizontal className="w-3 h-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem 
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toast.success('已添加到收藏')
                                }}
                              >
                                <Star className="w-4 h-4 mr-2" />
                                收藏
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : searchQuery ? (
              <div className="text-center py-12">
                <div className="w-12 h-12 bg-muted rounded-lg mx-auto mb-3 flex items-center justify-center">
                  <Search className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground mb-4">未找到匹配的结果</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchQuery('')
                    setSearchResults([])
                  }}
                >
                  清除搜索
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* 搜索功能介绍 */}
      {!searchQuery && (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-8 pb-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              <div className="p-4 border border-border rounded-lg hover:bg-accent/50 cursor-pointer transition-colors">
                <div className="flex items-center gap-3 mb-2">
                  <Clock className="w-5 h-5 text-blue-500" />
                  <span className="font-medium">搜索对话记录</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  在历史对话中查找相关内容
                </p>
              </div>
              
              <div className="p-4 border border-border rounded-lg hover:bg-accent/50 cursor-pointer transition-colors">
                <div className="flex items-center gap-3 mb-2">
                  <FileText className="w-5 h-5 text-purple-500" />
                  <span className="font-medium">搜索文件内容</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  在上传的文件中查找信息
                </p>
              </div>
            </div>
            
            {/* 使用统计 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: '总对话数', value: chatHistory.length, icon: MessageSquare },
                { label: '总消息数', value: chatHistory.reduce((sum, chat) => sum + chat.messages.length, 0), icon: Bot },
                { label: '本周搜索', value: '127', icon: Search },
                { label: '收藏内容', value: '23', icon: Star }
              ].map((stat) => {
                const IconComponent = stat.icon
                return (
                  <div key={stat.label} className="p-4 border border-border rounded-lg text-center">
                    <div className="w-8 h-8 bg-muted rounded-lg mx-auto mb-2 flex items-center justify-center">
                      <IconComponent className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <p className="text-lg font-semibold">{stat.value}</p>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
