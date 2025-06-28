'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ThemeToggle } from '@/components/theme-toggle'
import { motion, AnimatePresence } from 'framer-motion'
import * as Separator from '@radix-ui/react-separator'
import { 
  PanelLeft, Search, FileText, Bot, User, Copy, Brain, Clock, 
  Zap, Wrench, Image, Eye, Settings, AlertCircle, CheckCircle,
  XCircle, Loader, Code, ArrowDown, Send, X, Minimize2, BookOpen,
  ChevronDown
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { FileManager } from '@/components/FileManager'
import { SearchArea } from '@/components/SearchArea'
import type { FileStats } from '@/components/FileManager'

// 复制必要的类型定义
interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  execution_trace?: Array<{
    step: number
    action: string
    status: 'planning' | 'executing' | 'completed' | 'failed'
    timestamp: string
    details?: any
  }>
  reasoning_steps?: Array<{
    type: 'thought' | 'action' | 'observation' | 'reflection'
    content: string
    timestamp: string
  }>
  tools_used?: Array<{
    name: string
    result: string
    duration?: number
  }>
  model_used?: string
  mode?: 'llm' | 'agent' | 'chat'
  execution_time?: number
  steps_taken?: number
  generated_image?: string
  error_details?: any
}

interface Model {
  id: string
  name: string
  owned_by: string
}

interface ChatHistory {
  id: string
  title: string
  messages: Message[]
  timestamp: string
}

interface MainChatAreaProps {
  // 从原组件传递的所有props
  currentPage: 'chat' | 'search' | 'files'
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  selectedModel: string
  setSelectedModel: (model: string) => void
  models: Model[]
  apiStatus: 'connected' | 'disconnected' | 'testing'
  messages: Message[]
  isLoading: boolean
  input: string
  setInput: (input: string) => void
  sendMessage: () => void
  cancelRequest: () => void
  useAgent: boolean
  setUseAgent: (use: boolean) => void
  enableSearch: boolean
  setEnableSearch: (enable: boolean) => void
  enableMcp: boolean
  setEnableMcp: (enable: boolean) => void
  enableMemory: boolean
  setEnableMemory: (enable: boolean) => void
  enableReflection: boolean
  setEnableReflection: (enable: boolean) => void
  enableReactMode: boolean
  setEnableReactMode: (enable: boolean) => void
  disableHistory: boolean
  setDisableHistory: (disable: boolean) => void
  compactMode: boolean
  setCompactMode: (compact: boolean) => void
  showTimestamps: boolean
  setShowTimestamps: (show: boolean) => void
  showModelInfo: boolean
  setShowModelInfo: (show: boolean) => void
  showPerformanceMetrics: boolean
  setShowPerformanceMetrics: (show: boolean) => void
  rawResponses: {[messageId: string]: any}
  expandedJson: {[messageId: string]: boolean}
  setExpandedJson: React.Dispatch<React.SetStateAction<{[messageId: string]: boolean}>>
  showReasoningSteps: {[messageId: string]: boolean}
  setShowReasoningSteps: React.Dispatch<React.SetStateAction<{[messageId: string]: boolean}>>
  showExecutionTrace: {[messageId: string]: boolean}
  setShowExecutionTrace: React.Dispatch<React.SetStateAction<{[messageId: string]: boolean}>>
  showAgentDetails: {[messageId: string]: boolean}
  setShowAgentDetails: React.Dispatch<React.SetStateAction<{[messageId: string]: boolean}>>
  showToolDetails: {[messageId: string]: boolean}
  setShowToolDetails: React.Dispatch<React.SetStateAction<{[messageId: string]: boolean}>>
  fileStats: FileStats
  setFileStats: (stats: FileStats) => void
  searchResults: any[]
  setSearchResults: (results: any[]) => void
  searchQuery: string
  setSearchQuery: (query: string) => void
  isSearching: boolean
  searchChatHistory: (query: string) => void
  chatHistory: ChatHistory[]
  loadChat: (chat: ChatHistory) => void
  setCurrentPage: (page: 'chat' | 'search' | 'files') => void
  copyMessage: (content: string) => void
  scrollToBottom: () => void
  showScrollToBottom: boolean
  isAtBottom: boolean
  messagesEndRef: React.RefObject<HTMLDivElement | null>
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  handleKeyDown: (e: React.KeyboardEvent) => void
  handleCompositionStart: (e: React.CompositionEvent) => void
  handleCompositionUpdate: (e: React.CompositionEvent) => void
  handleCompositionEnd: (e: React.CompositionEvent) => void
  // 引用的组件和函数
  MessageErrorBoundary: React.ComponentType<any>
  TooltipButton: React.ComponentType<any>
  SettingsMenuItem: React.ComponentType<any>
  ImageComponent: React.ComponentType<any>
  groupModelsByProvider: (models: Model[]) => any
  getModelDeveloperIcon: (modelId: string, ownedBy: string) => React.ReactNode
  getProviderIcon: (provider: string) => React.ReactNode
  getProviderDisplayName: (provider: string) => string
  API_BASE_URL: string
  API_KEY: string
}

export function MainChatArea({
  currentPage, sidebarOpen, setSidebarOpen, selectedModel, setSelectedModel,
  models, apiStatus, messages, isLoading, input, setInput, sendMessage,
  cancelRequest, useAgent, setUseAgent, enableSearch, setEnableSearch,
  enableMcp, setEnableMcp, enableMemory, setEnableMemory, enableReflection,
  setEnableReflection, enableReactMode, setEnableReactMode, disableHistory,
  setDisableHistory, compactMode, setCompactMode, showTimestamps,
  setShowTimestamps, showModelInfo, setShowModelInfo, showPerformanceMetrics,
  setShowPerformanceMetrics, rawResponses, expandedJson, setExpandedJson,
  showReasoningSteps, setShowReasoningSteps, showExecutionTrace,
  setShowExecutionTrace, showAgentDetails, setShowAgentDetails,
  showToolDetails, setShowToolDetails, fileStats, setFileStats, searchResults,
  setSearchResults, searchQuery, setSearchQuery, isSearching, searchChatHistory,
  chatHistory, loadChat, setCurrentPage, copyMessage, scrollToBottom,
  showScrollToBottom, isAtBottom, messagesEndRef, scrollContainerRef,
  textareaRef, handleKeyDown, handleCompositionStart, handleCompositionUpdate,
  handleCompositionEnd, MessageErrorBoundary,
  TooltipButton, SettingsMenuItem, ImageComponent, groupModelsByProvider,
  getModelDeveloperIcon, getProviderIcon, getProviderDisplayName, 
  API_BASE_URL, API_KEY
}: MainChatAreaProps) {

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Header - 移除底部边框 */}
      <div className="h-14 flex items-center justify-between px-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-3">
          {!sidebarOpen && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen(true)}
                className="h-8 w-8"
              >
                <PanelLeft className="w-4 h-4" />
              </Button>
            )}
              <div className="flex items-center gap-4">
            {/* 页面标题 */}
            <div className="flex items-center gap-2">
              {currentPage === 'search' && (
                <>
                  <Search className="w-5 h-5 text-blue-500" />
                  <span className="font-semibold">智能搜索</span>
                </>
              )}
              {currentPage === 'files' && (
                <>
                  <FileText className="w-5 h-5 text-purple-500" />
                  <span className="font-semibold">档案库</span>
                </>
              )}
              {currentPage === 'chat' && (
                <>
                  <Bot className="w-5 h-5 text-primary" />
                  <span className="font-semibold">AI助手</span>
                </>
              )}
            </div>

            {/* 只在聊天页面显示模型选择器 */}
            {currentPage === 'chat' && (
              <>            
              {/* Model Selector - 修复图标调用问题 */}
              <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger className="w-[280px] h-10 bg-background/80 border-border/60 hover:border-border/80 rounded-xl text-sm font-medium transition-all duration-200 hover:shadow-sm">
                <SelectValue placeholder="选择模型">
                  <div className="flex items-center gap-2 min-w-0">
                    {/* 使用模型开发者图标 */}
                    {getModelDeveloperIcon(selectedModel, models.find(m => m.id === selectedModel)?.owned_by || '')}
                    <span className="truncate font-medium">
                      {models.find(m => m.id === selectedModel)?.name || '选择模型'}
                    </span>
                  </div>
                </SelectValue>
              </SelectTrigger>
              
              <SelectContent className="w-[320px] max-h-[500px] bg-background/95 backdrop-blur-xl border-border/50 rounded-xl shadow-xl overflow-hidden">
                {Object.entries(groupModelsByProvider(models)).map(([provider, providerModels]) => (
                  <div key={provider}>
                    {/* Provider Header - 使用提供商图标 */}
                    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
                      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/20">
                        {getProviderIcon(provider)}
                        <span className="font-semibold text-sm">{getProviderDisplayName(provider)}</span>
                        <span className="ml-auto text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded-md">
                          {(providerModels as Model[]).length}
                        </span>
                      </div>
                    </div>
                    
                    {/* Models - 修复选中外框被裁切的问题 */}
                    <div className="py-1 px-1">
                      {(providerModels as Model[]).map((model) => (
                        <SelectItem 
                          key={model.id} 
                          value={model.id}
                          className={cn(
                            "rounded-lg cursor-pointer transition-all duration-200 hover:bg-accent/80 focus:bg-accent/80 data-[highlighted]:bg-accent/60 mx-1 my-1 px-3 py-2.5",
                            // 修复：为选中状态的ring留出足够空间，并确保不被裁切
                            selectedModel === model.id && "ring-2 ring-primary/60 bg-primary/10 border-primary/30 ring-inset"
                          )}
                        >
                          <div className="flex items-center gap-3 min-w-0 w-full">
                            {/* 使用模型开发者图标而不是提供商图标 */}
                            {getModelDeveloperIcon(model.id, model.owned_by)}
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-sm truncate">{model.name}</div>
                              <div className="text-xs text-muted-foreground truncate">{model.id}</div>
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </div>
                  </div>
                ))}
                
                {/* Footer - 现在在 SelectContent 内部的底部 */}
                <div className="sticky bottom-0 bg-background/95 backdrop-blur-sm border-t border-border/20 px-4 py-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>共 {models.length} 个模型</span>
                    <div className="flex items-center gap-1.5">
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        apiStatus === 'connected' && "bg-green-500",
                        apiStatus === 'disconnected' && "bg-red-500",
                        apiStatus === 'testing' && "bg-yellow-500 animate-pulse"
                      )} />
                      <span>
                        {apiStatus === 'connected' && '已连接'}
                        {apiStatus === 'disconnected' && '未连接'}
                        {apiStatus === 'testing' && '测试中'}
                      </span>
                    </div>
                  </div>
                </div>              </SelectContent>
            </Select>
              {/* Connection Status Indicator */}
              <div className="flex items-center gap-1">
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  apiStatus === 'connected' && "bg-green-500",
                  apiStatus === 'disconnected' && "bg-red-500",
                  apiStatus === 'testing' && "bg-yellow-500 animate-pulse"
                )} />
              </div>
              </>
            )}
            </div>
          </div>          
          
          
          <div className="flex items-center gap-3">
            {/* 聊天页面的状态指示器 - 优化版本 */}
            {currentPage === 'chat' && (
              <div className="flex items-center gap-2 px-2 py-1.5 bg-muted/10 hover:bg-muted/20 rounded-lg border border-border/20 transition-all duration-200">
                {/* 模式指示 */}
                <div className="flex items-center gap-1.5 text-xs">
                  <motion.div
                    animate={{
                      backgroundColor: useAgent 
                        ? ["hsl(var(--primary))", "hsl(var(--primary))", "hsl(var(--primary))"]
                        : ["hsl(214 100% 50%)", "hsl(214 100% 60%)", "hsl(214 100% 50%)"],
                      boxShadow: useAgent
                        ? ["0 0 0 0 hsla(var(--primary), 0.4)", "0 0 0 3px hsla(var(--primary), 0.1)", "0 0 0 0 hsla(var(--primary), 0.4)"]
                        : ["0 0 0 0 hsla(214, 100%, 50%, 0.4)", "0 0 0 3px hsla(214, 100%, 50%, 0.1)", "0 0 0 0 hsla(214, 100%, 50%, 0.4)"]
                    }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="w-2 h-2 rounded-full"
                  />
                  <span className="font-medium text-foreground">
                    {useAgent ? 'Agent' : 'Chat'}
                  </span>
                </div>
                
                {/* 分隔线 */}
                {(enableSearch || enableMcp || (useAgent && (enableMemory || enableReflection || enableReactMode)) || isLoading) && (
                  <div className="w-px h-3 bg-border/40" />
                )}
                
                {/* 功能状态图标组 */}
                <AnimatePresence>
                  {(enableSearch || enableMcp || (useAgent && (enableMemory || enableReflection || enableReactMode)) || isLoading) && (
                    <motion.div
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: "auto" }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.3, ease: "easeOut" }}
                      className="flex items-center gap-1.5"
                    >
                      {enableSearch && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          whileHover={{ scale: 1.1 }}
                          className="flex items-center justify-center w-5 h-5 rounded-md bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                          title="搜索功能已启用"
                        >
                          <Search className="w-2.5 h-2.5" />
                        </motion.div>
                      )}
                      {enableMcp && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          whileHover={{ scale: 1.1 }}
                          className="flex items-center justify-center w-5 h-5 rounded-md bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400"
                          title="MCP工具已启用"
                        >
                          <Wrench className="w-2.5 h-2.5" />
                        </motion.div>
                      )}
                      {useAgent && enableMemory && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          whileHover={{ scale: 1.1 }}
                          className="flex items-center justify-center w-5 h-5 rounded-md bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                          title="记忆功能已启用"
                        >
                          <BookOpen className="w-2.5 h-2.5" />
                        </motion.div>
                      )}
                      {useAgent && enableReflection && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          whileHover={{ scale: 1.1 }}
                          className="flex items-center justify-center w-5 h-5 rounded-md bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
                          title="反思模式已启用"
                        >
                          <AlertCircle className="w-2.5 h-2.5" />
                        </motion.div>
                      )}
                      {useAgent && enableReactMode && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          whileHover={{ scale: 1.1 }}
                          className="flex items-center justify-center w-5 h-5 rounded-md bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400"
                          title="ReAct模式已启用"
                        >
                          <Zap className="w-2.5 h-2.5" />
                        </motion.div>
                      )}
                      {isLoading && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="flex items-center justify-center w-5 h-5 rounded-md bg-primary/10 text-primary"
                          title={useAgent ? 'Agent处理中...' : '正在思考...'}
                        >
                          <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                            className="w-2.5 h-2.5 border border-primary border-t-transparent rounded-full"
                          />
                        </motion.div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
            
            <ThemeToggle />
          </div>
        </div>        {/* Messages Area */}
        <div 
          ref={scrollContainerRef}
          data-scroll-container="true"
          className="flex-1 overflow-y-auto scroll-container"
        >
          {currentPage === 'search' ? (
            // 智能搜索页面
            <SearchArea
              searchResults={searchResults}
              setSearchResults={setSearchResults}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              isSearching={isSearching}
              searchChatHistory={searchChatHistory}
              chatHistory={chatHistory}
              loadChat={loadChat}
              setCurrentPage={setCurrentPage}
            />
          ) : currentPage === 'files' ? (
            // 文件管理页面
            <FileManager 
              onStatsUpdate={setFileStats}
              apiKey={API_KEY}
              apiBaseUrl={API_BASE_URL}
            />
          ) : currentPage === 'chat' ? (
            // 聊天页面
            messages.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center max-w-md px-4">
                  <div className="w-16 h-16 bg-primary rounded-2xl mx-auto mb-6 flex items-center justify-center">
                    <Bot className="w-8 h-8 text-primary-foreground" />
                  </div>
                  <h2 className="text-2xl font-semibold mb-3">
                    你好！我是你的AI助手
                  </h2>
                  <p className="text-muted-foreground text-lg leading-relaxed">
                    我可以回答问题、协助工作、进行创作等。有什么可以帮助你的吗？
                  </p>
                </div>
              </div>
            ) : (
              <div className="max-w-4xl mx-auto px-4 messages-container">              {messages.map((message) => (
                  <MessageErrorBoundary key={message.id} messageId={message.id}>
                    <div className="group py-6 last:border-0 message-item">
                  <div className="flex gap-4">
                    {/* Avatar */}
                    <div className="flex-shrink-0">
                      {message.role === 'user' ? (
                        <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
                          <User className="w-4 h-4 text-primary-foreground" />
                        </div>
                      ) : (
                        <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center border">
                          <Bot className="w-4 h-4 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                      {/* Message Content */}
                    <div className="flex-1 min-w-0 space-y-2">
                      {/* Message Header with enhanced info */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-medium text-foreground">
                            {message.role === 'user' ? '你' : 'AI助手'}
                          </div>
                          
                          {/* 显示模式和模型信息 */}
                          {showModelInfo && message.role === 'assistant' && (
                            <div className="flex items-center gap-1 text-xs">
                              {message.mode === 'agent' && (
                                <div className="flex items-center gap-1 px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full">
                                  <Brain className="w-3 h-3" />
                                  <span>Agent</span>
                                </div>
                              )}
                              {message.model_used && (
                                <div className="px-2 py-0.5 bg-muted/70 text-muted-foreground rounded-full">
                                  {message.model_used}
                                </div>
                              )}
                              {message.execution_time && (
                                <div className="flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full">
                                  <Clock className="w-3 h-3" />
                                  <span>{message.execution_time.toFixed(2)}s</span>
                                </div>
                              )}
                              {message.steps_taken && message.steps_taken > 0 && (
                                <div className="flex items-center gap-1 px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full">
                                  <Zap className="w-3 h-3" />
                                  <span>{message.steps_taken}步</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        
                        {/* Timestamp */}
                        {showTimestamps && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(message.timestamp).toLocaleTimeString('zh-CN', {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        )}
                      </div>
                      
                      {/* Agent模式执行追踪摘要 */}
                      {message.mode === 'agent' && !compactMode && (message.tools_used?.length || 0) > 0 && (
                        <div className="mb-3 p-2 bg-muted/30 rounded-lg border">
                          <div className="flex items-center gap-2 mb-2">
                            <Wrench className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm font-medium text-muted-foreground">工具使用情况</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {message.tools_used?.map((tool, index) => (
                              <div key={index} className="flex items-center gap-1 px-2 py-1 bg-background rounded text-xs">
                                {tool.name === 'generateImage' && <Image className="w-3 h-3" />}
                                {tool.name === 'search' && <Search className="w-3 h-3" />}
                                {tool.name !== 'generateImage' && tool.name !== 'search' && <FileText className="w-3 h-3" />}
                                <span>{tool.name}</span>
                                {tool.duration && (
                                  <span className="text-muted-foreground">({tool.duration}ms)</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                        {/* Message Content */}                      
                      <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-p:leading-relaxed prose-li:my-1">
                        <ReactMarkdown 
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeRaw]}
                          urlTransform={(url) => {
                            // 处理不同类型的URL
                            console.log('🔄 Processing URL in ReactMarkdown:', url.substring(0, 50))
                            
                            // 如果URL是 attachment 相关的，使用特殊处理
                            if (url.startsWith('attachment://') || url.startsWith('attachment:/') || url === 'attachment' || url === 'attachment_url' || url.includes('attachment')) {
                              console.log('🔄 Transforming attachment URL in ReactMarkdown:', url, 'for message:', message.id)
                              
                              // 尝试查找消息 ID 对应的原始响应
                              if (rawResponses[message.id]?.image_data_uri) {
                                const imageUri = rawResponses[message.id].image_data_uri
                                console.log('✅ Found image data for attachment:', imageUri.substring(0, 50))
                                  // 如果已经是完整的URL，直接返回
                                if (imageUri.startsWith('http://') || imageUri.startsWith('https://')) {
                                  return imageUri
                                }                                
                                // 兼容旧格式：如果是 /api/v1/images/ 格式，转换为新格式
                                else if (imageUri.startsWith('/api/v1/images/')) {
                                  const newImageUri = imageUri.replace('/api/v1/images/', '/images/')
                                  return `${API_BASE_URL}${newImageUri}`
                                }
                                // 如果已经包含代理前缀，直接返回
                                else if (imageUri.startsWith('/api/backend/')) {
                                  return imageUri
                                }
                                // 如果是相对路径，转换为完整URL                                
                                else if (imageUri.startsWith('/images/')) {
                                  return `${API_BASE_URL}${imageUri}`
                                }
                                // 如果是data URI，直接返回
                                else if (imageUri.startsWith('data:')) {
                                  return imageUri
                                }
                                else {
                                  return imageUri                                }
                              } else {
                                console.warn('⚠️ No image data URI found for message:', message.id)
                                console.warn('📦 Available rawResponses keys:', Object.keys(rawResponses))
                                console.warn('🔍 Message content preview:', message.content?.substring(0, 100))
                                // 返回空字符串而不是空的 attachment，这样可以避免显示破损的图片
                                return ''
                              }
                            }                            
                            // 兼容旧格式：如果是API图片URL，转换为完整URL
                            if (url.startsWith('/api/v1/images/')) {
                              console.log('🔄 Converting old API image URL to new format:', url)
                              const newUrl = url.replace('/api/v1/images/', '/images/')
                              return `${API_BASE_URL}${newUrl}`
                            }
                            // 如果已经包含代理前缀，直接返回
                            else if (url.startsWith('/api/backend/')) {
                              console.log('🔄 URL already has proxy prefix:', url)
                              return url
                            }
                            // 如果是新格式的API图片URL，转换为完整URL
                            else if (url.startsWith('/images/')) {
                              console.log('🔄 Converting API image URL to full URL:', url)
                              return `${API_BASE_URL}${url}`
                            }
                            
                            return url
                          }}
                          components={{img: (props) => {
                              console.log('🖼️ ReactMarkdown img props:', 
                                props.src 
                                  ? (typeof props.src === 'string' 
                                      ? props.src.substring(0, 50) + '...' 
                                      : '[non-string src]'
                                    ) 
                                  : '[empty]'
                              )
                              return <ImageComponent {...props} />
                            },
                            p: ({ children }) => {
                              // 检查children中是否包含图片，如果有则使用div而不是p
                              const hasImage = React.Children.toArray(children).some(child => 
                                React.isValidElement(child) && child.type === 'img'
                              )
                                if (hasImage) {
                                return (
                                  <div className="text-foreground leading-relaxed mb-3">
                                    {children}
                                  </div>
                                )
                              }
                              
                              return (
                                <p className="text-foreground leading-relaxed mb-3">
                                  {children}
                                </p>
                              )
                            },                            code: ({ children, className, ...props }) => {
                              const isInline = !className
                              return isInline ? (
                                <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono text-foreground border" {...props}>
                                  {children}
                                </code>
                              ) : (
                                <code className="block bg-muted p-4 rounded-lg text-sm font-mono overflow-x-auto text-foreground border mb-4" {...props}>
                                  {children}
                                </code>
                              )
                            },
                            h1: ({ children }) => (
                              <h1 className="text-2xl font-bold mb-4 mt-6 text-foreground border-b border-border pb-2">
                                {children}
                              </h1>
                            ),
                            h2: ({ children }) => (
                              <h2 className="text-xl font-semibold mb-3 mt-5 text-foreground">
                                {children}
                              </h2>
                            ),
                            h3: ({ children }) => (
                              <h3 className="text-lg font-medium mb-2 mt-4 text-foreground">
                                {children}
                              </h3>
                            ),
                            ul: ({ children }) => (
                              <ul className="list-disc list-inside mb-4 ml-4 space-y-1 text-foreground">
                                {children}
                              </ul>
                            ),
                            ol: ({ children }) => (
                              <ol className="list-decimal list-inside mb-4 ml-4 space-y-1 text-foreground">
                                {children}
                              </ol>
                            ),
                            li: ({ children }) => (
                              <li className="leading-relaxed text-foreground pl-2">
                                {children}
                              </li>
                            ),
                            blockquote: ({ children }) => (
                              <blockquote className="border-l-4 border-primary pl-4 my-4 italic text-muted-foreground bg-muted/30 py-2">
                                {children}
                              </blockquote>
                            ),
                            strong: ({ children }) => (
                              <strong className="font-semibold text-foreground">
                                {children}
                              </strong>
                            ),
                            em: ({ children }) => (
                              <em className="italic text-foreground">
                                {children}
                              </em>
                            )
                          }}                        >
                          {typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}
                        </ReactMarkdown>
                      </div>                        {/* Message Actions */}
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyMessage(message.content)}
                          className="h-7 px-2 text-xs"
                        >
                          <Copy className="w-3 h-3 mr-1" />
                          复制
                        </Button>
                          {/* Agent模式专用按钮 */}
                        {message.role === 'assistant' && message.mode === 'agent' && (
                          <>
                            {/* 推理步骤按钮 */}
                            {message.reasoning_steps && message.reasoning_steps.length > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowReasoningSteps(prev => ({
                                  ...prev,
                                  [message.id]: !prev[message.id]
                                }))}
                                className="h-7 px-2 text-xs"
                              >
                                <Brain className="w-3 h-3 mr-1" />
                                {showReasoningSteps[message.id] ? '隐藏推理' : `推理过程 (${message.reasoning_steps.length})`}
                              </Button>
                            )}
                            
                            {/* 执行轨迹按钮 */}
                            {message.execution_trace && message.execution_trace.length > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowExecutionTrace(prev => ({
                                  ...prev,
                                  [message.id]: !prev[message.id]
                                }))}
                                className="h-7 px-2 text-xs"
                              >
                                <Eye className="w-3 h-3 mr-1" />
                                {showExecutionTrace[message.id] ? '隐藏轨迹' : `执行轨迹 (${message.execution_trace.length})`}
                              </Button>
                            )}
                            
                            {/* 工具详情按钮 */}
                            {message.tools_used && message.tools_used.length > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowToolDetails(prev => ({
                                  ...prev,
                                  [message.id]: !prev[message.id]
                                }))}
                                className="h-7 px-2 text-xs"
                              >
                                <Wrench className="w-3 h-3 mr-1" />
                                {showToolDetails[message.id] ? '隐藏工具' : `工具详情 (${message.tools_used.length})`}
                              </Button>
                            )}
                              {/* Agent详情按钮 */}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setShowAgentDetails(prev => ({
                                ...prev,
                                [message.id]: !prev[message.id]
                              }))}
                              className="h-7 px-2 text-xs"
                            >
                              <Settings className="w-3 h-3 mr-1" />
                              {showAgentDetails[message.id] ? '隐藏详情' : 'Agent详情'}
                            </Button>
                          </>
                        )}
                        
                        {/* JSON展开按钮 - 只对AI助手消息显示 */}
                        {message.role === 'assistant' && rawResponses[message.id] && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setExpandedJson(prev => ({
                              ...prev,
                              [message.id]: !prev[message.id]
                            }))}
                            className="h-7 px-2 text-xs"
                          >
                            <Code className="w-3 h-3 mr-1" />
                            {expandedJson[message.id] ? '隐藏JSON' : '显示JSON'}
                          </Button>
                        )}
                        
                        {/* 时间戳（当启用时显示在操作栏） */}
                        {!showTimestamps && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(message.timestamp).toLocaleTimeString('zh-CN', {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        )}
                      </div>                        {/* Agent推理步骤展示 */}
                      {message.role === 'assistant' && message.mode === 'agent' && showReasoningSteps[message.id] && message.reasoning_steps && (
                        <div className="mt-3 p-3 bg-muted/50 rounded-lg border">
                          <div className="flex items-center gap-2 mb-3">
                            <Brain className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm font-medium text-muted-foreground">推理过程</span>
                          </div>
                          <div className="space-y-2">
                            {message.reasoning_steps.map((step, index) => (
                              <div key={index} className="flex gap-3 p-2 bg-background rounded border-l-2 border-muted">
                                <div className="flex-shrink-0 mt-1">
                                  {step.type === 'thought' && <Brain className="w-4 h-4 text-blue-500" />}
                                  {step.type === 'action' && <Zap className="w-4 h-4 text-green-500" />}
                                  {step.type === 'observation' && <Eye className="w-4 h-4 text-purple-500" />}
                                  {step.type === 'reflection' && <AlertCircle className="w-4 h-4 text-orange-500" />}
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-medium capitalize text-muted-foreground">
                                      {step.type === 'thought' && '思考'}
                                      {step.type === 'action' && '行动'}
                                      {step.type === 'observation' && '观察'}
                                      {step.type === 'reflection' && '反思'}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {new Date(step.timestamp).toLocaleTimeString()}
                                    </span>
                                  </div>
                                  <div className="text-sm text-foreground whitespace-pre-wrap">
                                    {step.content}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* Agent执行轨迹展示 */}
                      {message.role === 'assistant' && message.mode === 'agent' && showExecutionTrace[message.id] && message.execution_trace && (
                        <div className="mt-3 p-3 bg-muted/50 rounded-lg border">
                          <div className="flex items-center gap-2 mb-3">
                            <Eye className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm font-medium text-muted-foreground">执行轨迹</span>
                          </div>
                          <div className="space-y-2">
                            {message.execution_trace.map((trace, index) => (
                              <div key={index} className="flex gap-3 p-2 bg-background rounded border-l-2 border-muted">
                                <div className="flex-shrink-0 mt-1">
                                  {trace.status === 'planning' && <Loader className="w-4 h-4 text-yellow-500 animate-spin" />}
                                  {trace.status === 'executing' && <Zap className="w-4 h-4 text-blue-500" />}
                                  {trace.status === 'completed' && <CheckCircle className="w-4 h-4 text-green-500" />}
                                  {trace.status === 'failed' && <XCircle className="w-4 h-4 text-red-500" />}
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-medium text-muted-foreground">
                                      步骤 {trace.step}
                                    </span>
                                    <span className="text-xs capitalize px-2 py-0.5 rounded-full">
                                      {trace.status === 'planning' && (
                                        <span className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300">规划中</span>
                                      )}
                                      {trace.status === 'executing' && (
                                        <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">执行中</span>
                                      )}
                                      {trace.status === 'completed' && (
                                        <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">已完成</span>
                                      )}
                                      {trace.status === 'failed' && (
                                        <span className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">失败</span>
                                      )}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {new Date(trace.timestamp).toLocaleTimeString()}
                                    </span>
                                  </div>                                  
                                  <div className="text-sm text-foreground">
                                    {trace.action}
                                  </div>
                                  {trace.details && Object.keys(trace.details).length > 0 && (
                                    <div className="text-xs text-muted-foreground mt-1 p-2 bg-muted/30 rounded">
                                      <pre className="whitespace-pre-wrap">{JSON.stringify(trace.details, null, 2)}</pre>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* Agent详细信息展示 */}
                      {message.role === 'assistant' && message.mode === 'agent' && showAgentDetails[message.id] && (
                        <div className="mt-3 p-3 bg-muted/50 rounded-lg border">
                          <div className="flex items-center gap-2 mb-3">
                            <Settings className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm font-medium text-muted-foreground">Agent详细信息</span>
                          </div>
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <span className="text-muted-foreground">执行时间:</span>
                              <span className="ml-2 font-mono">{message.execution_time?.toFixed(3)}s</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">执行步骤:</span>
                              <span className="ml-2 font-mono">{message.steps_taken || 0}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">使用模型:</span>
                              <span className="ml-2 font-mono">{message.model_used}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">工具调用:</span>
                              <span className="ml-2 font-mono">{message.tools_used?.length || 0}</span>
                            </div>
                            {message.reasoning_steps && (
                              <div>
                                <span className="text-muted-foreground">推理步骤:</span>
                                <span className="ml-2 font-mono">{message.reasoning_steps.length}</span>
                              </div>
                            )}
                            {message.execution_trace && (
                              <div>
                                <span className="text-muted-foreground">执行轨迹:</span>
                                <span className="ml-2 font-mono">{message.execution_trace.length}</span>
                              </div>
                            )}
                          </div>
                          
                          {/* 工具使用详情 */}
                          {message.tools_used && message.tools_used.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-muted">
                              <div className="text-sm font-medium text-muted-foreground mb-2">工具使用详情</div>
                              <div className="space-y-2">
                                {message.tools_used.map((tool, index) => (
                                  <div key={index} className="flex justify-between items-center p-2 bg-background rounded">
                                    <div className="flex items-center gap-2">
                                      {tool.name === 'generateImage' && <Image className="w-4 h-4" />}
                                      {tool.name === 'search' && <Search className="w-4 h-4" />}
                                      {tool.name !== 'generateImage' && tool.name !== 'search' && <FileText className="w-4 h-4" />}
                                      <span className="font-mono text-sm">{tool.name}</span>
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {tool.duration && `${tool.duration}ms`}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                        {/* 原始JSON响应显示 */}
                      {message.role === 'assistant' && rawResponses[message.id] && expandedJson[message.id] && (
                        <div className="mt-3 p-3 bg-muted/50 rounded-lg border"><div className="flex items-center gap-2 mb-2">
                            <Code className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm font-medium text-muted-foreground">原始API响应</span>                            <div className="ml-auto flex gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  // 复制截断后的JSON
                                  const processJsonForDisplay = (obj: any): any => {
                                    if (typeof obj !== 'object' || obj === null) return obj
                                    
                                    const processed: any = Array.isArray(obj) ? [] : {}
                                    
                                    for (const [key, value] of Object.entries(obj)) {
                                      if (typeof value === 'string') {
                                        if (
                                          (key.includes('image') || key.includes('data_uri') || key.includes('base64')) && 
                                          value.length > 100
                                        ) {
                                          processed[key] = value.substring(0, 100) + `... [已截断，原长度: ${value.length}]`
                                        } else {
                                          processed[key] = value
                                        }
                                      } else if (typeof value === 'object' && value !== null) {
                                        processed[key] = processJsonForDisplay(value)
                                      } else {
                                        processed[key] = value
                                      }
                                    }
                                    
                                    return processed
                                  }
                                  
                                  const processedData = processJsonForDisplay(rawResponses[message.id])
                                  navigator.clipboard.writeText(JSON.stringify(processedData, null, 2))
                                  toast.success('截断后的JSON已复制')
                                }}
                                className="h-6 px-2 text-xs"
                                title="复制截断后的JSON（图片数据已简化）"
                              >
                                <Copy className="w-3 h-3 mr-1" />
                                复制截断版
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  const jsonString = JSON.stringify(rawResponses[message.id], null, 2)
                                  navigator.clipboard.writeText(jsonString)
                                  toast.success('原始JSON已复制')
                                }}
                                className="h-6 px-2 text-xs"
                                title="复制原始完整的JSON（包含完整數據）"
                              >
                                <Copy className="w-3 h-3 mr-1" />
                                复制原始版
                              </Button>
                            </div>
                          </div>                          <div className="text-xs bg-background p-3 rounded border overflow-x-auto max-h-96 overflow-y-auto">
                            {/* 显示原始完整的JSON */}
                            <textarea 
                              readOnly
                              className="w-full h-full bg-transparent border-none resize-none text-muted-foreground font-mono text-xs"
                              style={{ minHeight: '100px', maxHeight: '300px' }}
                              value={JSON.stringify(rawResponses[message.id], null, 2)}
                            />
                          </div>
                        </div>
                      )}</div>
                  </div>
                </div>
                </MessageErrorBoundary>
              ))}
                {/* Enhanced Loading State for Agent Mode */}
              {isLoading && (
                <div className="py-6">
                  <div className="flex gap-4">
                    <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center border">
                      <Bot className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium text-foreground">AI助手</div>
                        {useAgent && (
                          <div className="flex items-center gap-1 px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-xs">
                            <Brain className="w-3 h-3 animate-pulse" />
                            <span>Agent模式</span>
                          </div>
                        )}
                      </div>
                      
                      {/* 基础加载指示 */}
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"></div>
                          <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:0.1s]"></div>
                          <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:0.2s]"></div>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {useAgent ? '正在分析和规划...' : '正在思考...'}
                        </span>
                      </div>
                      
                      {/* Agent模式增强加载指示 */}
                      {useAgent && (
                        <div className="space-y-2 p-3 bg-muted/30 rounded-lg">
                          <div className="text-xs font-medium text-muted-foreground mb-2">Agent处理状态</div>
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-xs">
                              <Loader className="w-3 h-3 animate-spin text-blue-500" />
                              <span>分析用户请求...</span>
                            </div>
                            {enableMemory && (
                              <div className="flex items-center gap-2 text-xs opacity-60">
                                <Brain className="w-3 h-3" />
                                <span>检索相关记忆...</span>
                              </div>
                            )}
                            {enableMcp && (
                              <div className="flex items-center gap-2 text-xs opacity-60">
                                <Wrench className="w-3 h-3" />
                                <span>准备工具...</span>
                              </div>
                            )}
                            {enableReactMode && (
                              <div className="flex items-center gap-2 text-xs opacity-60">
                                <Zap className="w-3 h-3" />
                                <span>React推理循环...</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {/* 模型和设置信息 */}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>使用模型: {selectedModel}</span>
                        {enableSearch && (
                          <>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <Search className="w-3 h-3" />
                              搜索已启用
                            </span>
                          </>
                        )}
                        {useAgent && enableReflection && (
                          <>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              反思模式
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>              )}
              
              <div ref={messagesEndRef} data-messages-end="true" />
            </div>
          )
        ) : currentPage === 'search' ? (
          // 智能搜索页面
            <SearchArea
              searchResults={searchResults}
              setSearchResults={setSearchResults}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              isSearching={isSearching}
              searchChatHistory={searchChatHistory}
              chatHistory={chatHistory}
              loadChat={loadChat}
              setCurrentPage={setCurrentPage}
            />
        ) : currentPage === 'files' ? (
          // 档案库页面
          <FileManager 
            onStatsUpdate={setFileStats}
            apiKey={API_KEY}
            apiBaseUrl={API_BASE_URL}
          />
        ) : (
          // 默认聊天页面
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-md px-4">
              <div className="w-16 h-16 bg-primary rounded-2xl mx-auto mb-6 flex items-center justify-center">
                <Bot className="w-8 h-8 text-primary-foreground" />
              </div>
              <h2 className="text-2xl font-semibold mb-3">
                AI Assistant
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed">
                选择一个功能开始使用
              </p>
            </div>
          </div> 
        )}
      </div>

        {/* Input Area - 只在聊天页面显示 */}
    {currentPage === 'chat' && (
    <div className="bg-background">
    <div className="max-w-4xl mx-auto p-4 relative">
    {/* Scroll to bottom button - 相对于输入区域定位 */}
    <AnimatePresence>
      {showScrollToBottom && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.9 }}
          transition={{ 
            type: "spring", 
            stiffness: 400, 
            damping: 25,
            duration: 0.3
          }}
          className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-full mb-4 z-50"
        >
          <Button
            onClick={scrollToBottom}
            variant="ghost"
            className="
              flex items-center gap-2 px-4 py-2
              bg-background/90 backdrop-blur-xl 
              border border-border/50 
              rounded-2xl shadow-xl hover:shadow-2xl 
              text-foreground hover:text-foreground
              font-medium text-sm
              transition-all duration-300 ease-out
              hover:border-primary/30 hover:scale-[1.02]
              active:scale-[0.98]
            "
          >
            <motion.div
              animate={{ y: [0, 3, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            >
              <ArrowDown className="w-4 h-4" />
            </motion.div>
            <span>回到底部</span>
          </Button>
        </motion.div>
      )}
    </AnimatePresence>

    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="relative"
    >
      {/* 输入框容器 */}
      <div className="
        relative flex flex-col w-full 
        bg-gradient-to-br from-muted/20 via-muted/10 to-muted/20 
        border border-border/50
        rounded-3xl shadow-lg
        transition-all duration-500 ease-out
        hover:shadow-xl hover:border-border/70
        focus-within:shadow-xl focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10
        backdrop-blur-sm
      ">
        {/* 主输入区域 */}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={handleCompositionStart}
            onCompositionUpdate={handleCompositionUpdate}
            onCompositionEnd={handleCompositionEnd}
            placeholder="发送消息到你的 AI 助手..."
            className="
              w-full min-h-[60px] max-h-40 px-6 py-4 pr-20 
              bg-transparent border-none resize-none 
              focus-visible:outline-none 
              placeholder:text-muted-foreground/50 text-foreground 
              rounded-3xl text-base leading-relaxed
              transition-all duration-300
              selection:bg-primary/20
            "
            disabled={isLoading}
            rows={1}
          />
          
          {/* 发送按钮区域 - 移除motion包装 */}
          <div className="absolute right-3 bottom-3 flex gap-2 items-center">
            <AnimatePresence>
              {isLoading && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8, x: 20 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.8, x: 20 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                 <TooltipButton
                  onClick={cancelRequest}
                  tooltip="取消请求"
                  variant="ghost"
                  className="
                    h-10 w-10 rounded-2xl 
                    bg-destructive/10 hover:bg-destructive/20 
                    text-destructive hover:text-destructive
                    border border-destructive/20
                  "
                >
                  <X className="w-4 h-4" />
                </TooltipButton>
                </motion.div>
              )}
            </AnimatePresence>
            
            <TooltipButton
              onClick={sendMessage}
              disabled={!input.trim() || isLoading}
              tooltip={!input.trim() ? "请输入消息" : isLoading ? "处理中..." : "发送消息"}
              className={cn(
                "h-10 w-10 rounded-2xl transition-all duration-300 ease-out relative overflow-hidden",
                input.trim() && !isLoading
                  ? "bg-primary text-primary-foreground shadow-lg hover:shadow-xl hover:shadow-primary/25"
                  : "bg-muted/50 text-muted-foreground cursor-not-allowed"
              )}
            >
              {/* 按钮发光效果 */}
              {input.trim() && !isLoading && (
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-primary/20 to-primary/40 rounded-2xl"
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
              )}
              
              <motion.div
                animate={isLoading ? { rotate: 360 } : {}}
                transition={isLoading ? { duration: 1, repeat: Infinity, ease: "linear" } : {}}
                className="relative z-10"
              >
                {isLoading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </motion.div>
            </TooltipButton>
          </div>
        </div>
        
        {/* 功能按钮区域 - 修复overflow问题 */}
<div className="px-6 pb-4 pt-2">
  <div className="flex items-center justify-between">
    {/* 确保容器有足够的padding来容纳动画 */}
    <div className="flex items-center gap-2 overflow-visible py-1">
      {/* 主要功能按钮 */}
      <div className="flex items-center gap-2">
        <TooltipButton
          variant={useAgent ? "default" : "secondary"}
          onClick={() => setUseAgent(!useAgent)}
          tooltip="智能代理模式：更强的推理和工具使用能力"
          className={cn(
            "h-8 px-3 text-xs font-medium rounded-xl",
            "shrink-0",
            useAgent 
              ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md" 
              : "bg-secondary/80 text-secondary-foreground hover:bg-secondary/90"
          )}
        >
          <Brain className={cn(
            "w-3 h-3 mr-1.5 transition-all duration-300",
            useAgent && "animate-pulse"
          )} />
          Agent
        </TooltipButton>
        
        <TooltipButton
          variant={enableSearch ? "default" : "secondary"}
          onClick={() => setEnableSearch(!enableSearch)}
          tooltip="启用网络搜索功能"
          className={cn(
            "h-8 px-3 text-xs font-medium rounded-xl",
            "shrink-0",
            enableSearch 
              ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md" 
              : "bg-secondary/80 text-secondary-foreground hover:bg-secondary/90"
          )}
        >
          <Search className="w-3 h-3 mr-1.5" />
          搜索
        </TooltipButton>
        
        <TooltipButton
          variant={enableMcp ? "default" : "secondary"}
          onClick={() => setEnableMcp(!enableMcp)}
          tooltip="MCP工具集成"
          className={cn(
            "h-8 px-3 text-xs font-medium rounded-xl",
            "shrink-0",
            enableMcp 
              ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md" 
              : "bg-secondary/80 text-secondary-foreground hover:bg-secondary/90"
          )}
        >
          <Wrench className="w-3 h-3 mr-1.5" />
          MCP
        </TooltipButton>
      </div>
      
      {/* 分隔线 */}
      <Separator.Root className="w-px h-6 bg-border/50 mx-2" />
      
      {/* Agent 专用功能 - 确保容器不会裁切动画 */}
      <AnimatePresence mode="wait">
        {useAgent ? (
          <motion.div
            key="agent-features"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="flex items-center gap-2 overflow-visible py-1"
          >
            <TooltipButton
              variant={enableMemory ? "default" : "secondary"}
              onClick={() => setEnableMemory(!enableMemory)}
              tooltip="启用上下文记忆"
              className={cn(
                "h-8 px-3 text-xs font-medium rounded-xl",
                "shrink-0 whitespace-nowrap",
                enableMemory 
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md" 
                  : "bg-secondary/80 text-secondary-foreground hover:bg-secondary/90"
              )}
            >
              <BookOpen className="w-3 h-3 mr-1.5" />
              记忆
            </TooltipButton>
            
            <TooltipButton
              variant={enableReflection ? "default" : "secondary"}
              onClick={() => setEnableReflection(!enableReflection)}
              tooltip="启用自我反思模式"
              className={cn(
                "h-8 px-3 text-xs font-medium rounded-xl",
                "shrink-0 whitespace-nowrap",
                enableReflection 
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md" 
                  : "bg-secondary/80 text-secondary-foreground hover:bg-secondary/90"
              )}
            >
              <AlertCircle className="w-3 h-3 mr-1.5" />
              反思
            </TooltipButton>
            
            <TooltipButton
              variant={enableReactMode ? "default" : "secondary"}
              onClick={() => setEnableReactMode(!enableReactMode)}
              tooltip="推理-行动循环模式"
              className={cn(
                "h-8 px-3 text-xs font-medium rounded-xl",
                "shrink-0 whitespace-nowrap",
                enableReactMode 
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md" 
                  : "bg-secondary/80 text-secondary-foreground hover:bg-secondary/90"
              )}
            >
              <Zap className="w-3 h-3 mr-1.5" />
              ReAct
            </TooltipButton>
          </motion.div>
        ) : (
          <motion.div
            key="chat-features"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="flex items-center gap-2 overflow-visible py-1"
          >
            <TooltipButton
              variant={disableHistory ? "default" : "secondary"}
              onClick={() => setDisableHistory(!disableHistory)}
              tooltip="禁用对话历史记录"
              className={cn(
                "h-8 px-3 text-xs font-medium rounded-xl",
                "shrink-0 whitespace-nowrap",
                disableHistory 
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md" 
                  : "bg-secondary/80 text-secondary-foreground hover:bg-secondary/90"
              )}
            >
              <BookOpen className="w-3 h-3 mr-1.5" />
              禁用历史
            </TooltipButton>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    
    <div className="shrink-0 ml-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            className="
              h-8 px-3 text-xs font-medium rounded-xl 
              bg-secondary/80 text-secondary-foreground 
              hover:bg-secondary/90 hover:scale-[1.02]
              active:scale-[0.98] transition-all duration-200
              group shrink-0
            "
          >
            <Settings className="w-3 h-3 mr-1.5 transition-transform duration-200 group-hover:rotate-90" />
            设置
            <ChevronDown className="w-3 h-3 ml-1.5 transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </Button>
        </DropdownMenuTrigger>
        
        <DropdownMenuContent 
          align="end"
          side="top"
          className="
            w-48 p-2
            bg-background/95 backdrop-blur-xl
            border border-border/50 
            rounded-xl shadow-xl
            animate-in slide-in-from-bottom-2 fade-in-0 duration-300
          "
        >
          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-b border-border/30 mb-2">
            显示设置
          </div>
          
          <div className="space-y-1">
            <SettingsMenuItem
              icon={Minimize2}
              label="紧凑模式"
              isActive={compactMode}
              onClick={() => setCompactMode(!compactMode)}
            />
            <SettingsMenuItem
              icon={Clock}
              label="显示时间戳"
              isActive={showTimestamps}
              onClick={() => setShowTimestamps(!showTimestamps)}
            />
            <SettingsMenuItem
              icon={Bot}
              label="模型信息"
              isActive={showModelInfo}
              onClick={() => setShowModelInfo(!showModelInfo)}
            />
            <SettingsMenuItem
              icon={Eye}
              label="性能指标"
              isActive={showPerformanceMetrics}
              onClick={() => setShowPerformanceMetrics(!showPerformanceMetrics)}
            />
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
</div>
      </div>
    </motion.div>
  </div>
</div>
    )}
  </div>
)
}