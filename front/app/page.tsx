'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { Send, Plus, User, Bot, Copy, PanelLeft, ChevronDown, ArrowUp, ArrowDown, Trash2, Code, Clock, Zap, Brain, Eye, Search, Wrench, Image, FileText, Loader, CheckCircle, XCircle, AlertCircle, Settings, BookOpen, MoreHorizontal, Minimize2, X, Star, Shield, Moon, Sun, Download, Upload, HelpCircle, LogOut, Keyboard, Palette, Globe, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ThemeToggle } from '@/components/theme-toggle'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import * as Tooltip from '@radix-ui/react-tooltip'
import * as Separator from '@radix-ui/react-separator'
import { Sidebar } from '@/components/Sidebar'
import { MainChatArea } from '@/components/MainChatArea'
import { FileManager, useFileManager } from '@/components/FileManager'

// API 基礎 URL - 使用相对路径代理到后端
const API_BASE_URL = '/api/backend'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  sessionId?: string  // 添加 sessionId 字段
  // Agent 模式增强字段
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
  // 元数据
  model_used?: string
  mode?: 'llm' | 'agent' | 'chat'  // 支持新的 llm 模式，保留 chat 兼容性
  execution_time?: number
  steps_taken?: number
  generated_image?: string
  // 錯誤詳情（用於JSON按鈕顯示）
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

const TooltipButton = ({ 
  children, 
  tooltip, 
  onClick, 
  className, 
  variant = "secondary",
  size = "sm",
  disabled = false,
  ...props 
}: {
  children: React.ReactNode
  tooltip: string
  onClick?: () => void
  className?: string
  variant?: "default" | "secondary" | "ghost" | "outline"
  size?: "sm" | "default" | "lg" | "icon"
  disabled?: boolean
  [key: string]: any
}) => {
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            variant={variant}
            size={size}
            onClick={onClick}
            className={cn(
              className,
              "transition-all duration-200 ease-out",
              // 修复：只保留轻微缩放，移除向上浮动
              "hover:scale-[1.02]",
              "active:scale-[0.98]",
              disabled && "hover:scale-100"
            )}
            disabled={disabled}
            {...props}
          >
            {children}
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="bg-popover text-popover-foreground px-3 py-2 rounded-xl text-sm shadow-lg border border-border/50 backdrop-blur-md z-50"
            sideOffset={8}
          >
            {tooltip}
            <Tooltip.Arrow className="fill-popover" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

const SettingsMenuItem = ({ 
  icon: Icon, 
  label, 
  isActive, 
  onClick 
}: {
  icon: any
  label: string
  isActive: boolean
  onClick: () => void
}) => {
  return (
    <motion.button
      // 修复：移除向左移动的动画
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-accent/50 focus:bg-accent/50 transition-all duration-200 group"
    >
      <div className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      
      <motion.div
        animate={{
          scale: isActive ? 1.1 : 1,
          backgroundColor: isActive ? "hsl(var(--primary))" : "hsl(var(--border))"
        }}
        transition={{ duration: 0.2 }}
        className="relative w-4 h-4 rounded-full border-2"
        style={{
          borderColor: isActive ? "hsl(var(--primary))" : "hsl(var(--border))"
        }}
      >
        <AnimatePresence>
          {isActive && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute inset-0.5 bg-primary-foreground rounded-full"
            />
          )}
        </AnimatePresence>
      </motion.div>
    </motion.button>
  )
}

// 在组件内添加模型分类逻辑
const groupModelsByProvider = (models: Model[]) => {
  const groups: { [provider: string]: Model[] } = {}
  
  models.forEach(model => {
    const provider = model.owned_by || 'unknown'
    if (!groups[provider]) {
      groups[provider] = []
    }
    groups[provider].push(model)
  })
  
  // 按提供商名称排序
  const sortedGroups = Object.keys(groups).sort().reduce((acc, key) => {
    acc[key] = groups[key].sort((a, b) => a.name.localeCompare(b.name))
    return acc
  }, {} as { [provider: string]: Model[] })
  
  return sortedGroups
}

const getModelDeveloperIcon = (modelId: string, ownedBy: string) => {
  const className = "w-5 h-5 object-cover rounded-md bg-white/10"
  
  // 根据模型ID判断真正的开发者
  const modelId_lower = modelId.toLowerCase()
  
  // OpenAI 模型 (通过 GitHub 提供)
  if (modelId_lower.includes('gpt') || modelId_lower.includes('o1') || modelId_lower.includes('chatgpt') || modelId_lower.includes('o3') || modelId_lower.includes('o4') || modelId_lower.includes('4o') || modelId_lower.includes('whisper') || modelId_lower.includes('dall-e') || modelId_lower.includes('text-embedding')) {
    return <img src="/icons/models/chatgpt.jpeg" alt="OpenAI" className={className} />
  }
  
  // Anthropic 模型 (通过 GitHub 提供)
  if (modelId_lower.includes('claude')) {
    return <img src="/icons/models/claude.png" alt="Anthropic" className={className} />
  }
  
  // Gemini 模型
  if (modelId_lower.includes('gemini') || ownedBy?.toLowerCase().includes('google')) {
    return <img src="/icons/models/gemini.png" alt="Gemini" className={className} />
  }

  // Gemma 模型 
  if (modelId_lower.includes('gemma')) {
    return <img src="/icons/models/gemma.png" alt="Gemma" className={className} />
  }
  
  // Meta 模型
  if (modelId_lower.includes('llama') || modelId_lower.includes('meta')) {
    return <img src="/icons/models/llama.png" alt="Meta" className={className} />
  }
  
  // Microsoft 模型
  if (modelId_lower.includes('phi') || ownedBy?.toLowerCase().includes('microsoft')) {
    return <img src="/icons/models/microsoft.png" alt="Microsoft" className={className} />
  }
  
  // Cohere 模型 (通过 GitHub 提供)
  if (modelId_lower.includes('cohere') || modelId_lower.includes('command')) {
    return <img src="/icons/models/cohere.png" alt="Cohere" className={className} />
  }
  
  // DeepSeek 模型 (通过 GitHub 提供)
  if (modelId_lower.includes('deepseek')) {
    return <img src="/icons/models/deepseek.png" alt="DeepSeek" className={className} />
  }
  
  // Mistral 模型
  if (modelId_lower.includes('mistral') || modelId_lower.includes('mixtral') || modelId_lower.includes('ministral')) {
    return <img src="/icons/models/mixtral.png" alt="Mistral AI" className={className} />
  }
  
  // xAI 模型 (Grok)
  if (modelId_lower.includes('grok') || ownedBy?.toLowerCase().includes('xai')) {
    return <img src="/icons/models/grok.png" alt="xAI" className={className} />
  }
  
  // Qwen 模型 (通过 Ollama)
  if (modelId_lower.includes('qwen')) {
    return <img src="/icons/models/qwen.png" alt="Qwen" className={className} />
  }

  // Nvidia 模型 
  if (modelId_lower.includes('nvidia') || modelId_lower.includes('nemotron')) {
    return <img src="/icons/models/nvidia.png" alt="NVIDIA" className={className} />
  }
  // Minimax 模型
  if (modelId_lower.includes('minimax') || modelId_lower.includes('minimax')) {
    return <img src="/icons/models/minimax.png" alt="Minimax" className={className} />
  }
  
  // 默认图标
}

// 更新提供商图标函数 - 根据你的配置
const getProviderIcon = (provider: string) => {
  const className = "w-6 h-6 object-cover rounded-md bg-white/10"
  
  switch (provider.toLowerCase()) {
    case 'github':
      return <img src="/icons/providers/github.png" alt="GitHub" className={className} />
    case 'gemini':
    case 'google':
      return <img src="/icons/providers/google.png" alt="Google" className={className} />
    case 'ollama':
      return <img src="/icons/providers/ollama.png" alt="Ollama" className={className} />
    case 'nvidia_nim':
    case 'nvidia':
      return <img src="/icons/providers/nvidia.png" alt="NVIDIA" className={className} />
    case 'openrouter':
      return <img src="/icons/providers/openrouter.png" alt="OpenRouter" className={className} />
    default:
  }
}

// 更新提供商显示名称
const getProviderDisplayName = (provider: string) => {
  switch (provider.toLowerCase()) {
    case 'github':
      return 'GitHub Models'
    case 'gemini':
    case 'google':
      return 'Google Gemini'
    case 'ollama':
      return 'Ollama'
    case 'nvidia_nim':
    case 'nvidia':
      return 'NVIDIA NIM'
    default:
      const formatted = provider.charAt(0).toUpperCase() + provider.slice(1)
      return formatted.length > 15 ? formatted.substring(0, 15) + '...' : formatted
  }
}


export default function ModernChatGPT() {
  const [messages, setMessages] = useState<Message[]>(() => {
    // 尝试恢复最后一条用户消息（如果页面刷新时有未完成的对话）
    if (typeof window !== 'undefined') {
      try {
        const savedMessage = localStorage.getItem('lastUserMessage');
        const loadingSessionId = localStorage.getItem('chatLoadingSessionId');
        const isLoading = localStorage.getItem('chatLoadingState') === 'true';
        
        if (savedMessage && loadingSessionId && isLoading) {
          const userMsg = JSON.parse(savedMessage);
          console.log('🔄 Initializing messages with saved user message:', userMsg.content.substring(0, 30) + '...');
          return [userMsg];
        }
      } catch (err) {
        console.warn('⚠️ Error restoring saved user message on init:', err);
      }
    }
    return [];
  })
  const [input, setInput] = useState('')
  
  // 加载状态从localStorage初始化 - 解决页面刷新时状态丢失问题
  const [isLoading, setIsLoading] = useState(() => {
    if (typeof window !== 'undefined') {
      const savedLoadingState = localStorage.getItem('chatLoadingState')
      return savedLoadingState === 'true'
    }
    return false
  })
  
  // 跟踪哪个会话正在加载 - 也从localStorage恢复
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('chatLoadingSessionId')
    }
    return null
  })
  
  // 记录当前正在使用的模型 - 用于"正在使用模型:xxx"的提示
  const [currentLoadingModel, setCurrentLoadingModel] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('currentLoadingModel') || ''
    }
    return ''
  })
  
  const [selectedModel, setSelectedModel] = useState('gpt-4o-mini')
  const [models, setModels] = useState<Model[]>([])
  const [chatHistory, setChatHistory] = useState<ChatHistory[]>([])
  // 从localStorage恢复当前会话ID
  const [currentChatId, setCurrentChatId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      // 如果有正在加载的会话，优先恢复那个会话ID
      const loadingId = localStorage.getItem('chatLoadingSessionId')
      if (loadingId) {
        console.log('🔄 Restoring loading session ID from localStorage:', loadingId)
        
        // 同时尝试恢复最后的用户消息到初始messages状态
        try {
          const savedUserMessage = localStorage.getItem('lastUserMessage');
          if (savedUserMessage) {
            console.log('🔄 Found saved user message, will restore with session');
          }
        } catch (err) {
          console.warn('⚠️ Error checking for saved user message:', err);
        }
        
        return loadingId
      }
      // 否则尝试恢复最后一次活跃的会话ID
      const lastActiveId = localStorage.getItem('lastActiveChatId')
      if (lastActiveId) {
        console.log('🔄 Restoring last active session ID:', lastActiveId)
        return lastActiveId
      }
    }
    return ''
  })
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  
  // API settings
  const [enableSearch, setEnableSearch] = useState(true)
  const [disableHistory, setDisableHistory] = useState(false)
  const [enableMcp, setEnableMcp] = useState(true)
  const [useAgent, setUseAgent] = useState(false)
  const [enableMemory, setEnableMemory] = useState(true)
  const [enableReflection, setEnableReflection] = useState(true)
  const [enableReactMode, setEnableReactMode] = useState(true)
  
  // API connection status
  const [apiStatus, setApiStatus] = useState<'connected' | 'disconnected' | 'testing'>('disconnected')

  // Raw JSON responses for debugging
  const [rawResponses, setRawResponses] = useState<{[messageId: string]: any}>({})
  const [expandedJson, setExpandedJson] = useState<{[messageId: string]: boolean}>({})
  
  // Agent状态显示增强
  const [showAgentDetails, setShowAgentDetails] = useState<{[messageId: string]: boolean}>({})
  const [showReasoningSteps, setShowReasoningSteps] = useState<{[messageId: string]: boolean}>({})
  const [showExecutionTrace, setShowExecutionTrace] = useState<{[messageId: string]: boolean}>({})
  const [showToolDetails, setShowToolDetails] = useState<{[messageId: string]: boolean}>({})
    // 性能和统计信息
  const [messageStats, setMessageStats] = useState<{[messageId: string]: {
    processingTime?: number
    tokenCount?: number
    modelUsed?: string
    toolsCount?: number
    memoryUsed?: boolean
    mcpToolsUsed?: string[]
    responseSize?: number
  }}>({})
  
  // 显示增强控制
  const [compactMode, setCompactMode] = useState(false)
  const [showTimestamps, setShowTimestamps] = useState(true)
  const [showModelInfo, setShowModelInfo] = useState(true)
  const [showPerformanceMetrics, setShowPerformanceMetrics] = useState(false)
    // Agent模式的实时状态追踪
  // 定义React推理步骤类型
  type ReactStep = {
    type: 'thought' | 'decision' | 'reflection' | 'action' | 'observation'
    label: string
    complete: boolean
    enabled?: boolean
  }

  const [agentStatus, setAgentStatus] = useState<{[messageId: string]: {
    currentStep?: string
    totalSteps?: number
    isReflecting?: boolean
    toolsInUse?: string[]
    memoryActive?: boolean
    reactPhase?: string
    reactSteps?: ReactStep[]
    currentReactStep?: number
  }}>({})
  
  // LLM服务调用统计
  const [llmStats, setLlmStats] = useState({
    totalCalls: 0,
    totalTokens: 0,
    avgResponseTime: 0,
    successRate: 0,
    failureCount: 0
  })
  
  // Auto-scroll and scroll detection
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])  // 使用防抖函数处理滚动检测，减少不必要的状态更新
  const debouncedCheckScrollPosition = useCallback(() => {
    if (scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100
      
      // 只在狀態真正變化時才更新，避免不必要的重新渲染
      setIsAtBottom(prev => {
        if (prev !== isNearBottom) {
          console.log('📍 Scroll position changed:', isNearBottom ? 'at bottom' : 'not at bottom')
          return isNearBottom
        }
        return prev
      })
      
      setShowScrollToBottom(prev => {
        const newValue = !isNearBottom && messages.length > 0
        if (prev !== newValue) {
          return newValue
        }
        return prev
      })
    }
  }, []) // 移除 messages.length 依賴，避免函數重新創建
    // 滾動檢測的穩定引用
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isScrollingRef = useRef(false) // 追蹤是否正在滾動中
  
  // 防抖滾動檢測
  const throttledScrollCheck = useCallback(() => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }
    
    isScrollingRef.current = true
    scrollTimeoutRef.current = setTimeout(() => {
      debouncedCheckScrollPosition()
      isScrollingRef.current = false
    }, 50)
  }, [debouncedCheckScrollPosition])
  
  // 通用滾動到底部函數，會檢查當前滾動狀態
  const scrollToBottomIfNeeded = useCallback(() => {
    if (isScrollingRef.current) return // 如果正在滾動中，不進行額外滾動
    
    const scrollElement = scrollContainerRef.current
    if (scrollElement) {
      const { scrollTop, scrollHeight, clientHeight } = scrollElement
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 150
      
      if (isAtBottom) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
      }
    }
  }, [])
  
  // 當新消息到達且用戶在底部時，自動滾動
  useEffect(() => {
    if (isAtBottom && messages.length > 0) {
      const timeoutId = setTimeout(scrollToBottomIfNeeded, 100) // 延遲滾動，避免與圖片載入衝突
      
      return () => clearTimeout(timeoutId)
    }
  }, [messages.length, isAtBottom, scrollToBottomIfNeeded]) // 只依賴於消息數量，避免頻繁更新
  
  // 設置滾動監聽器
  useEffect(() => {
    const scrollElement = scrollContainerRef.current
    if (scrollElement) {
      // 使用 throttled 版本避免過於頻繁的檢查
      scrollElement.addEventListener('scroll', throttledScrollCheck, { passive: true })
      
      // 初始檢查滾動位置
      const initialCheck = setTimeout(debouncedCheckScrollPosition, 200)
      
      return () => {
        scrollElement.removeEventListener('scroll', throttledScrollCheck)
        clearTimeout(initialCheck)
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current)
        }
      }
    }
  }, [throttledScrollCheck, debouncedCheckScrollPosition])// Load models on component mount
  useEffect(() => {
    fetchModels()
    loadChatHistory()
    // 异步加载服务器会话（不阻塞界面）
    loadUserSessionsFromAPI().catch(err => 
      console.warn('⚠️ Failed to load sessions from server:', err)
    )
  }, [])
  
  // 页面刷新后自动恢复加载中的会话
  useEffect(() => {
    const handlePageRefresh = async () => {
      // 检查是否存在加载中的会话和当前会话ID
      const loadingId = localStorage.getItem('chatLoadingSessionId')
      const isPageRefresh = localStorage.getItem('isPageRefresh') !== 'false'
      const wasLoading = localStorage.getItem('chatLoadingState') === 'true'
      const savedUserMessage = localStorage.getItem('lastUserMessage')
      
      console.log('🔄 Page refresh check:', { 
        loadingId, 
        currentChatId, 
        wasLoading, 
        isPageRefresh,
        hasSavedUserMessage: !!savedUserMessage
      })
      
      // 标记这不是页面刷新
      localStorage.setItem('isPageRefresh', 'false')
      
      // 如果当前有会话ID且之前有加载状态，需要恢复会话
      if (currentChatId && wasLoading && loadingId === currentChatId && isPageRefresh) {
        console.log('🔄 Auto-restoring session after page refresh:', currentChatId)
        
        // 等待聊天历史加载完成
        let retries = 0
        while (chatHistory.length === 0 && retries < 5) {
          console.log('⏳ Waiting for chat history to load...')
          await new Promise(resolve => setTimeout(resolve, 200))
          retries++
        }
        
        // 找到相应的会话
        let chat = chatHistory.find(c => c.id === currentChatId)
        
        // 如果有保存的用户消息，检查是否需要将其添加到会话
        if (chat && savedUserMessage) {
          try {
            const userMsg = JSON.parse(savedUserMessage);
            
            // 确保这条消息属于当前会话
            if (!userMsg.sessionId || userMsg.sessionId === currentChatId) {
              // 检查这条消息是否已经在会话中
              const messageExists = chat.messages.some(m => 
                m.id === userMsg.id || 
                (m.content === userMsg.content && m.role === 'user')
              );
              
              // 如果消息不在会话中，添加它
              if (!messageExists) {
                console.log('🔄 Adding saved user message to chat history before restoring');
                // 创建更新的会话副本
                chat = {
                  ...chat,
                  messages: [...chat.messages, {...userMsg, sessionId: currentChatId}]
                };
              }
            }
          } catch (err) {
            console.warn('⚠️ Error processing saved user message:', err);
          }
        }
        
        if (chat) {
          console.log('✅ Found session to restore:', chat.id, 'with', chat.messages.length, 'messages');
          
          // 在恢复会话状态前，先检查服务器是否已经响应
          const hasServerResponded = await checkSessionResponseStatus(currentChatId);
          
          if (hasServerResponded) {
            console.log('⚠️ Server has already responded while user was away, loading fresh session');
            // 清除加载状态
            localStorage.removeItem('chatLoadingState');
            localStorage.removeItem('chatLoadingSessionId');
            localStorage.removeItem('currentLoadingModel');
            localStorage.removeItem('lastUserMessage');
            
            setIsLoading(false);
            setLoadingSessionId(null);
            setCurrentLoadingModel('');
            
            // 加载最新的会话内容
            await loadChatSessions();
            // 重新加载会话，但不保持加载状态
            await loadChat(chat, { isPageRefresh: false });
            
            toast.info('会话已完成响应，已加载最新内容');
          } else {
            // 恢复会话内容，标记为页面刷新
            await loadChat(chat, { isPageRefresh: true });
            
            // 显示提示，告知用户会话已恢复
            if (localStorage.getItem('chatLoadingState') === 'true') {
              toast.info('已恢复正在等待响应的会话');
            }
          }
        } else {
          console.log('⚠️ Could not find session to restore:', currentChatId);
        }
      }
    }
    
    // 标记这是页面刷新
    localStorage.setItem('isPageRefresh', 'true')
    
    // 在组件挂载时检查是否需要恢复会话
    handlePageRefresh()
  }, [chatHistory.length, currentChatId])  // Reset current chat ID if no sessions exist (show empty state)
  useEffect(() => {
    // 如果没有任何会话，清空当前会话ID以显示空白状态
    if (chatHistory.length === 0 && currentChatId) {
      console.log('⚠️ No sessions exist, showing empty state')
      setCurrentChatId('')
      setMessages([])
    }
  }, [chatHistory])
  // Save chat history to localStorage
  useEffect(() => {
    if (chatHistory.length > 0) {
      localStorage.setItem('chatHistory', JSON.stringify(chatHistory))
    }
  }, [chatHistory])
  
  // 持久化存储加载状态 - 页面刷新后可恢复
  useEffect(() => {
    console.log('💾 Persisting loading state:', { isLoading, loadingSessionId, currentLoadingModel })
    localStorage.setItem('chatLoadingState', isLoading.toString())
    
    if (loadingSessionId) {
      localStorage.setItem('chatLoadingSessionId', loadingSessionId)
    } else {
      localStorage.removeItem('chatLoadingSessionId')
    }
    
    if (currentLoadingModel) {
      localStorage.setItem('currentLoadingModel', currentLoadingModel)
    } else {
      localStorage.removeItem('currentLoadingModel')
    }
    
    // 如果正在加载且有会话ID，保存最后一条用户消息
    if (isLoading && loadingSessionId) {
      const lastUserMessage = messages.filter(msg => msg.role === 'user' && 
        (!msg.sessionId || msg.sessionId === loadingSessionId)).pop();
      
      if (lastUserMessage) {
        localStorage.setItem('lastUserMessage', JSON.stringify(lastUserMessage));
        console.log('💾 Saved last user message:', lastUserMessage.content.substring(0, 50) + '...');
      }
    } else if (!isLoading) {
      // 如果不再加载，清除保存的消息
      localStorage.removeItem('lastUserMessage');
    }
  }, [isLoading, loadingSessionId, currentLoadingModel, messages])
  
  // 定期检查等待中的会话是否已收到响应
  useEffect(() => {
    // 只有当有会话正在加载时才设置定时器
    if (isLoading && loadingSessionId) {
      console.log('🔄 Setting up periodic check for session response:', loadingSessionId);
      
      // 创建定时器，每5秒检查一次
      const checkInterval = setInterval(async () => {
        // 检查会话是否已经收到响应
        const hasResponded = await checkSessionResponseStatus(loadingSessionId);
        
        if (hasResponded) {
          console.log('✅ Server has responded to session during background check');
          
          // 清除加载状态
          setIsLoading(false);
          setLoadingSessionId(null);
          setCurrentLoadingModel('');
          
          // 清除localStorage中的状态
          localStorage.removeItem('chatLoadingState');
          localStorage.removeItem('chatLoadingSessionId');
          localStorage.removeItem('currentLoadingModel');
          localStorage.removeItem('lastUserMessage');
          
          // 刷新会话内容
          try {
            // 重新加载当前会话的消息
            const freshData = await loadSessionDetailWithoutStateUpdate(loadingSessionId, false);
            if (freshData.success && freshData.messages) {
              setMessages(freshData.messages);
              toast.success('收到服务器响应，已更新内容');
            }
          } catch (refreshError) {
            console.warn('⚠️ Failed to refresh messages after response detected:', refreshError);
          }
          
          // 清除定时器
          clearInterval(checkInterval);
        }
      }, 5000); // 每5秒检查一次
      
      // 清理函数
      return () => {
        clearInterval(checkInterval);
      };
    }
  }, [isLoading, loadingSessionId]);
  
  // 持久化存储当前活跃的会话ID
  useEffect(() => {
    if (currentChatId) {
      localStorage.setItem('lastActiveChatId', currentChatId)
      console.log('💾 Persisting current chat ID:', currentChatId)
    }
  }, [currentChatId])
    // 追踪是否是加载历史对话的状态
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  // 使用 ref 追踪最后加载的历史聊天 ID，避免触发 useEffect
  const lastLoadedHistoryChatId = useRef<string | null>(null)  // Update chat history when messages change (but not when loading history)
  useEffect(() => {
    // 如果当前聊天是刚加载的历史聊天，跳过时间戳更新
    if (currentChatId && currentChatId === lastLoadedHistoryChatId.current) {
      console.log('⏭️ Skipping history update - loading historical chat:', currentChatId)
      return
    }
    
    if (currentChatId && messages.length > 0 && !isLoadingHistory) {
      console.log('📝 Updating chat history for session:', currentChatId, 'with', messages.length, 'messages')
      console.log('📋 Messages:', messages.map(m => ({ id: m.id, role: m.role, content: m.content.substring(0, 50) + '...' })))
      
      setChatHistory(prev => {
        const updated = prev.map(chat => 
          chat.id === currentChatId 
            ? { ...chat, messages: messages.filter(m => !m.sessionId || m.sessionId === currentChatId), timestamp: new Date().toISOString() }
            : chat
        )
        console.log('� ChatHistory updated for session:', currentChatId)
        return updated
      })
    } else {
      console.log('⚠️ Skipping history update:', { 
        currentChatId: !!currentChatId, 
        messagesLength: messages.length, 
        isLoadingHistory 
      })
    }
  }, [messages, currentChatId, isLoadingHistory])
  const fetchModels = async () => {
    try {
      console.log('🔄 Fetching models from API...')
      setApiStatus('testing')
      
      const response = await fetch(`${API_BASE_URL}/models`, {
        headers: {
          'X-API-KEY': API_KEY,
          'accept': 'application/json'
        },
        signal: AbortSignal.timeout(10000) // 10 second timeout for models
      })
      
      console.log(`📊 Models API response status: ${response.status} ${response.statusText}`)
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('❌ Models API Error:', errorText)
        setApiStatus('disconnected')
        
        // Provide specific error messages
        if (response.status === 404) {
          throw new Error('🔍 模型API端點不存在，請檢查後端API版本')
        } else if (response.status === 401) {
          throw new Error('🔐 API密鑰無效，請檢查配置')
        } else {
          throw new Error(`❌ 獲取模型失敗: HTTP ${response.status}`)
        }
      }
        const data = await response.json()
      console.log('✅ Models response:', JSON.stringify(data, null, 2))
      
      // Support different response formats - backend returns ModelListResponse
      const modelsList = data.models || data.data || data || []
        // Validate models data
      if (!Array.isArray(modelsList)) {
        console.warn('⚠️ Models response is not an array:', modelsList)
        throw new Error('🔧 模型數據格式錯誤')
      }
      
      setApiStatus('connected')
      
      if (modelsList.length > 0) {
        // Auto-select first model if current selection is invalid
        const validModels = modelsList.filter((model: any) => model.model_id && model.model_name)        
        if (validModels.length > 0) {
          // Convert ModelInfo to our Model interface
          const convertedModels: Model[] = validModels.map((model: any) => ({
            id: model.model_id,
            name: model.model_name,
            owned_by: model.provider || 'unknown'
          }))
          
          // Remove duplicate models based on id
          const uniqueModels = convertedModels.filter((model, index, self) => 
            index === self.findIndex(m => m.id === model.id)
          )
          
          setModels(uniqueModels)
          
          if (!convertedModels.some((model: Model) => model.id === selectedModel)) {
            setSelectedModel(convertedModels[0].id)
            console.log(`🔄 Model auto-selected: ${convertedModels[0].id}`)
          }
          toast.success(`✅ 已加載 ${convertedModels.length} 個模型`)
        } else {
          toast.warning('⚠️ 沒有有效的模型數據')
        }
      } else {
        toast.warning('⚠️ 沒有可用的模型')
        setApiStatus('disconnected')
      }
      
    } catch (error: any) {
      console.error('❌ Error fetching models:', error)
      setApiStatus('disconnected')
      
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        toast.error('⏰ 獲取模型超時，請檢查網絡連接')
      } else {
        toast.error(error.message || '❌ 無法連接到 API 服務器')
      }
      
      // Set fallback models if no models are available
      if (models.length === 0) {
        const fallbackModels = [
          { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite', owned_by: 'google' },
          { id: 'gpt-4o-mini', name: 'GPT-4o Mini', owned_by: 'openai' },
          { id: 'claude-3-5-haiku', name: 'Claude 3.5 Haiku', owned_by: 'anthropic' },
          { id: 'llama-3.1-8b', name: 'Llama 3.1 8B', owned_by: 'meta' }
        ]
        setModels(fallbackModels)
        console.log('🔄 Using fallback models')
        toast.info('📋 使用備用模型列表')      }
    }
  }
  
  const loadChatHistory = () => {
    // 尝试先从服务器加载会话
    loadChatSessions().catch(() => {
      // 如果服务器加载失败，从localStorage加载
      const saved = localStorage.getItem('chatHistory')
      if (saved) {
        const parsedHistory = JSON.parse(saved)
        // 只有在有有效会话时才设置聊天历史
        if (Array.isArray(parsedHistory) && parsedHistory.length > 0) {
          setChatHistory(parsedHistory)
          console.log('🔄 Loaded from localStorage as fallback')
        } else {
          console.log('📭 No valid sessions in localStorage')
        }
      } else {
        console.log('📭 No chat history in localStorage')
      }
    })
  }
  const createNewChat = async () => {
    // 只清空当前消息和会话ID，等待用户发送第一条消息时再创建会话    
    setMessages([])
    setCurrentChatId('')
    lastLoadedHistoryChatId.current = null // 清除加载聊天ID标志
    
    // 确保所有加载状态都被重置
    setIsLoading(false)
    setLoadingSessionId(null)
    setIsLoadingHistory(false)
    
    toast.success('准备开始新对话')
  }
  const loadChat = async (chat: ChatHistory, options: { isPageRefresh?: boolean } = {}) => {
    const isPageRefresh = options.isPageRefresh || false
    
    console.log('🔄 Loading chat session:', chat.id, 'with', chat.messages.length, 'messages', isPageRefresh ? '(page refresh)' : '')
    
    // 检查是否是之前正在加载的会话
    const wasLoadingThisSession = 
      localStorage.getItem('chatLoadingSessionId') === chat.id && 
      localStorage.getItem('chatLoadingState') === 'true'
    
    console.log('🔍 Session loading state check:', {
      wasLoadingThisSession,
      'chatLoadingSessionId': localStorage.getItem('chatLoadingSessionId'),
      'chatLoadingState': localStorage.getItem('chatLoadingState')
    })
    
    // 先设置加载历史对话标志和记录加载的聊天ID
    setIsLoadingHistory(true)
    lastLoadedHistoryChatId.current = chat.id
    
    // 重要：先准备好数据，再一次性更新状态，减少闪烁
    let sessionMessages: Message[] = []

    // 优先尝试从服务器加载最新数据
    try {
      // 尝试加载详细信息但不直接设置消息，而是返回消息数组和加载状态
      const { success, messages: serverMessages, wasLoading, loadingModel } = 
        await loadSessionDetailWithoutStateUpdate(chat.id, true)
      
      if (success && serverMessages) {
        console.log('✅ Session loaded from server successfully')
        sessionMessages = serverMessages
        
        // 如果这是一个正在加载的会话，更新加载状态
        if (wasLoading) {
          console.log('⚠️ This session was in loading state, restoring state')
          
          // 恢复加载模型信息
          if (loadingModel) {
            setCurrentLoadingModel(loadingModel)
          }
          
          // 检查并恢复最后一条用户消息
          try {
            const savedUserMessage = localStorage.getItem('lastUserMessage');
            if (savedUserMessage) {
              const parsedUserMessage = JSON.parse(savedUserMessage);
              
              // 确保这条消息属于当前会话
              if (!parsedUserMessage.sessionId || parsedUserMessage.sessionId === chat.id) {
                // 检查这条消息是否已经在会话消息列表中
                const messageExists = sessionMessages.some(m => 
                  m.id === parsedUserMessage.id || 
                  (m.content === parsedUserMessage.content && m.role === 'user')
                );
                
                if (!messageExists) {
                  console.log('🔄 Restoring last user message that was not in session messages');
                  sessionMessages = [...sessionMessages, {...parsedUserMessage, sessionId: chat.id}];
                } else {
                  console.log('✓ Last user message already exists in session messages');
                }
              }
            }
          } catch (err) {
            console.warn('⚠️ Error restoring last user message:', err);
          }
        }
      } else {
        throw new Error('Failed to load from server')
      }
    } catch (error) {
      // 如果服务器加载失败，使用本地缓存
      console.warn('⚠️ Failed to load from server, using local cache')
      
      // 确保每条消息都有会话ID，并且只加载当前会话的消息
      sessionMessages = chat.messages.map((msg: Message) => ({
        ...msg,
        sessionId: chat.id // 确保每条消息都有sessionId
      })).filter((msg: Message) => !msg.sessionId || msg.sessionId === chat.id);
      
      console.log('📋 Prepared messages from local cache:', sessionMessages.length)
    }
    
    // 检查这个会话是否正在等待响应中
    // 从本地存储和当前状态两处检查
    const isSessionCurrentlyLoading = loadingSessionId === chat.id || 
                                    (localStorage.getItem('chatLoadingSessionId') === chat.id && 
                                     localStorage.getItem('chatLoadingState') === 'true');
    
    console.log('🔍 Loading session state check:', {
      'session': chat.id,
      'isCurrentlyLoading': isSessionCurrentlyLoading,
      'loadingSessionId': loadingSessionId,
      'globalLoadingState': isLoading,
      'localStorageLoadingId': localStorage.getItem('chatLoadingSessionId'),
      'localStorageLoading': localStorage.getItem('chatLoadingState')
    });

    // 一次性更新状态，减少闪烁问题
    // 设置当前会话ID并同时更新消息
    setCurrentChatId(chat.id)
    
    // 如果有消息则设置，否则不覆盖（可能是正在加载中的会话）
    if (sessionMessages.length > 0 || !isSessionCurrentlyLoading) {
      setMessages(sessionMessages)
    } else {
      console.log('⚠️ Preserving existing messages for loading session')
    }
    
    // 根据会话实际状态设置加载指示器
    setIsLoadingHistory(false)
    
    // 关键修复：处理会话加载状态
    if (isSessionCurrentlyLoading) {
      console.log('⚠️ Restoring loading state for session:', chat.id)
      
      // 检查服务器是否已经响应（避免页面刷新时状态不一致）
      const hasServerResponded = await checkSessionResponseStatus(chat.id);
      
      if (hasServerResponded) {
        console.log('🔄 Server has already responded to this session, clearing loading state');
        // 清除加载状态
        localStorage.removeItem('chatLoadingState');
        localStorage.removeItem('chatLoadingSessionId');
        localStorage.removeItem('currentLoadingModel');
        localStorage.removeItem('lastUserMessage');
        
        // 不设置加载状态
        setIsLoading(false);
        setLoadingSessionId(null);
        setCurrentLoadingModel('');
        
        // 重新加载最新的消息
        try {
          const freshData = await loadSessionDetailWithoutStateUpdate(chat.id, false);
          if (freshData.success && freshData.messages) {
            setMessages(freshData.messages);
          }
        } catch (refreshError) {
          console.warn('⚠️ Failed to refresh messages after loading state cleared:', refreshError);
        }
        
        toast.info('服务器已经响应此会话，已加载最新内容');
      } else {
        // 恢复加载状态
        setIsLoading(true);
        setLoadingSessionId(chat.id);
        
        // 从localStorage恢复模型信息
        const savedModel = localStorage.getItem('currentLoadingModel');
        if (savedModel) {
          setCurrentLoadingModel(savedModel);
          console.log('📝 Restored loading model for active session:', savedModel);
        }
      }
    } else {
      console.log('📋 Session not in loading state, no indicators needed')
      // 不更改加载状态
      // 因为可能有另一个会话正在加载中，我们不希望干扰它
    }
    
    console.log('✅ Chat loading completed for session:', chat.id)
  }
  const deleteChat = async (chatId: string) => {
    // 尝试从服务器删除
    try {
      await deleteSessionFromServer(chatId)
    } catch (error) {
      // 如果服务器删除失败，执行本地删除
      console.warn('⚠️ Server delete failed, deleting locally')
      setChatHistory(prev => prev.filter(chat => chat.id !== chatId))
      if (currentChatId === chatId) {
        setMessages([])
        setCurrentChatId('')
      }
      toast.success('对话已删除')
    }
  }
  
  const sendMessage = async () => {
    if (!input.trim() || isLoading) return

    // 清除历史聊天ID标志，允许新消息更新时间戳
    lastLoadedHistoryChatId.current = null

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
      sessionId: currentChatId || undefined // 若有现有会话ID，则添加
    }

    // 如果没有当前会话ID，立即创建新会话
    let sessionId = currentChatId
    let isNewSession = false
    
    if (!sessionId) {
      console.log('🆕 No current session, creating new one...')
      // 传入用户问题作为初始标题，同时传入用户消息
      sessionId = await createNewSession(input.trim(), userMessage) 
      setCurrentChatId(sessionId)
      isNewSession = true
      
      // 创建新会话对象并添加到会话历史中，使用用户问题作为初始标题
      const initialTitle = input.trim().length > 50 ? input.trim().substring(0, 50) + '...' : input.trim()
      
      // 立即创建包含用户消息的会话，而不是等待useEffect
      const updatedMessagesForNewSession = [...messages, userMessage]
      const newChatHistory: ChatHistory = {
        id: sessionId,
        title: initialTitle,
        messages: updatedMessagesForNewSession, // 立即包含用户消息
        timestamp: new Date().toISOString()
      }
      
      setChatHistory(prev => [newChatHistory, ...prev])
      console.log('✅ New session created with user message included:', sessionId, initialTitle, updatedMessagesForNewSession.length, 'messages')
      
      // 同时更新 messages 状态，确保只包含新会话的消息
      setMessages(updatedMessagesForNewSession.filter(msg => !msg.sessionId || msg.sessionId === sessionId))
      setInput('')
      setIsLoading(true)
      setLoadingSessionId(sessionId) // 设置当前正在加载的会话ID
      setCurrentLoadingModel(selectedModel) // 保存当前使用的模型名称，用于显示"使用模型:xxx"
      
      console.log('🎯 New session setup complete - messages and chatHistory both updated')
      
      // 确保消息被同步到服务器端会话
      try {
        // 尝试单独发送用户消息到会话（如果创建会话时没有成功添加消息）
        const syncResponse = await fetch(`${API_BASE_URL}/sessions/test/${sessionId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': API_KEY,
            'accept': 'application/json'
          },
          body: JSON.stringify({
            message: {
              role: userMessage.role,
              content: userMessage.content,
              timestamp: userMessage.timestamp
            }
          })
        })
        
        if (syncResponse.ok) {
          console.log('✅ User message explicitly synced to server session:', sessionId)
        }
      } catch (syncError) {
        // 如果同步失败，记录错误但继续进行
        console.warn('⚠️ Failed to explicitly sync message to server, continuing with local state:', syncError)
      }
    } else {
      console.log('📝 Using existing session:', sessionId)
      
      // 更新消息列表 - 对于现有session
      // 先过滤掉其他会话的消息，然后添加新消息
      const filteredMessages = messages.filter(msg => !msg.sessionId || msg.sessionId === sessionId)
      const updatedMessages = [...filteredMessages, {...userMessage, sessionId: sessionId}]
      setMessages(updatedMessages)
      setInput('')
      setIsLoading(true)
      setLoadingSessionId(sessionId) // 设置当前正在加载的会话ID
      setCurrentLoadingModel(selectedModel) // 保存当前使用的模型名称，用于显示"使用模型:xxx"
    }
    
    // 获取当前的消息列表用于API请求
    const currentMessages = [...messages, userMessage]
    
    try {
      const endpoint = useAgent 
        ? `/api/agent/`
        : `${API_BASE_URL}/chat/completions`

      console.log('🎯 API endpoint:', endpoint)
      console.log('🔧 useAgent state:', useAgent)
      console.log('📋 Current sessionId:', sessionId)
      console.log('📝 Messages to send:', currentMessages.length)
      
      // Build request body using enhanced builder with session support
      const body = await buildRequestBodyWithSession(currentMessages, sessionId)

      // 记录API调用开始时间
      const apiStartTime = performance.now()
      
      // Make API request with retry logic
      const data = await makeApiRequest(endpoint, body)
      
      // 计算API响应时间
      const apiEndTime = performance.now()
      const apiResponseTime = apiEndTime - apiStartTime
      
      // 更新LLM统计信息
      setLlmStats(prev => ({
        totalCalls: prev.totalCalls + 1,
        totalTokens: prev.totalTokens + (data.usage?.total_tokens || 0),
        avgResponseTime: ((prev.avgResponseTime * prev.totalCalls) + apiResponseTime) / (prev.totalCalls + 1),
        successRate: ((prev.successRate * prev.totalCalls) + 1) / (prev.totalCalls + 1),
        failureCount: prev.failureCount
      }))
      
      // 异步解析响应，避免阻塞UI
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '正在处理响应...', // 临时内容
        timestamp: new Date().toISOString(),
        sessionId: sessionId // 标记消息属于哪个会话
      }

      // 先显示临时消息，避免等待，但只在当前会话中显示
      // 使用immutable方式更新消息，确保sessionId标记正确
      setMessages(prev => {
        // 首先过滤掉所有其他会话的消息，只保留当前会话的消息或没有sessionId的旧消息
        const filteredPrev = prev.filter(msg => !msg.sessionId || msg.sessionId === sessionId);
        // 然后添加新消息
        return [...filteredPrev, {...assistantMessage, sessionId: sessionId}];
      })

      // 存储当前处理的会话ID，用于后续检查
      const processingSessionId = sessionId
      
      // 初始化Agent处理状态 - 采用改进的状态模型
      if (useAgent) {
        // 保存每个消息ID对应的时间控制器ID，以便清除
        const statusTimers: {[key: string]: NodeJS.Timeout[]} = {};
        
        // 第一步：分析用户请求
        setAgentStatus(prev => ({
          ...prev,
          [assistantMessage.id]: {
            currentStep: '分析用户请求...',
            totalSteps: 1,
            isReflecting: false,
            toolsInUse: [],
            memoryActive: enableMemory
          }
        }));
        
        const msgId = assistantMessage.id;
        statusTimers[msgId] = [];
        
        // 第二步：检索记忆
        const timer1 = setTimeout(() => {
          setAgentStatus(prev => ({
            ...prev,
            [msgId]: {
              ...prev[msgId],
              currentStep: '检索相关记忆...',
              totalSteps: 2,
              memoryActive: enableMemory
            }
          }));
        }, 1500);
        statusTimers[msgId].push(timer1);
        
        // 第三步：准备工具
        const timer2 = setTimeout(() => {
          setAgentStatus(prev => ({
            ...prev,
            [msgId]: {
              ...prev[msgId],
              currentStep: '准备工具...',
              totalSteps: 3,
              toolsInUse: enableMcp ? ['search', 'fileSystem', 'codeInterpreter'] : []
            }
          }));
        }, 3000);
        statusTimers[msgId].push(timer2);
        
        // 第四步：React推理循环 - 增加更多细节和子步骤
        const timer3 = setTimeout(() => {
          setAgentStatus(prev => ({
            ...prev,
            [msgId]: {
              ...prev[msgId],
              currentStep: 'React推理循环...',
              totalSteps: 4,
              isReflecting: enableReflection,
              reactPhase: 'thought', // 添加React循环的子阶段
              currentReactStep: 1, // 当前正在执行的React步骤编号
              reactSteps: [
                // 思考步骤
                { type: 'thought', label: '思考: 分析问题要点', complete: true },
                { type: 'observation', label: '观察: 收集相关信息', complete: false },
                { type: 'action', label: '行动: 确定初始方向', complete: false },
                // 决策步骤
                { type: 'decision', label: '决策: 确定最佳应对策略', complete: false },
                // 反思步骤（仅当启用时）
                { type: 'reflection', label: '反思: 评估解决方案质量', complete: false, enabled: enableReflection },
                // 行动步骤
                { type: 'action', label: '行动: 生成最终回复', complete: false }
              ]
            }
          }));

          // 模拟React循环的子步骤过程
          // 观察阶段
          setTimeout(() => {
            setAgentStatus(prev => {
              if (!prev[msgId]) return prev; // 安全检查
              return {
                ...prev,
                [msgId]: {
                  ...prev[msgId],
                  reactPhase: 'observation',
                  currentReactStep: 2,
                  reactSteps: prev[msgId].reactSteps?.map((step, idx) => 
                    idx === 1 ? { ...step, complete: true } : step
                  ) || []
                }
              };
            });
          }, 800);
          
          // 第一个行动阶段
          setTimeout(() => {
            setAgentStatus(prev => {
              if (!prev[msgId]) return prev; // 安全检查
              return {
                ...prev,
                [msgId]: {
                  ...prev[msgId],
                  reactPhase: 'action',
                  currentReactStep: 3,
                  reactSteps: prev[msgId].reactSteps?.map((step, idx) => 
                    idx === 2 ? { ...step, complete: true } : step
                  ) || []
                }
              };
            });
          }, 1600);
          
          // 决策阶段
          setTimeout(() => {
            setAgentStatus(prev => {
              if (!prev[msgId]) return prev; // 安全检查
              return {
                ...prev,
                [msgId]: {
                  ...prev[msgId],
                  reactPhase: 'decision',
                  currentReactStep: 4,
                  reactSteps: prev[msgId].reactSteps?.map((step, idx) => 
                    idx === 3 ? { ...step, complete: true } : step
                  ) || []
                }
              };
            });
            
            // 反思阶段 (仅当启用反思时)
            if (enableReflection) {
              setTimeout(() => {
                setAgentStatus(prev => {
                  if (!prev[msgId]) return prev; // 安全检查
                  return {
                    ...prev,
                    [msgId]: {
                      ...prev[msgId],
                      reactPhase: 'reflection',
                      currentReactStep: 5,
                      reactSteps: prev[msgId].reactSteps?.map((step, idx) => 
                        idx === 4 ? { ...step, complete: true } : step
                      ) || []
                    }
                  };
                });
              }, 1000);
            }
            
            // 最终行动阶段
            setTimeout(() => {
              setAgentStatus(prev => {
                if (!prev[msgId]) return prev; // 安全检查
                return {
                  ...prev,
                  [msgId]: {
                    ...prev[msgId],
                    reactPhase: 'action',
                    currentReactStep: 6,
                    reactSteps: prev[msgId].reactSteps?.map((step, idx) => 
                      idx === 5 ? { ...step, complete: true } : step
                    ) || []
                  }
                };
              });
            }, enableReflection ? 2000 : 1000);
            
          }, 1000);
          
        }, 4500);
        statusTimers[msgId].push(timer3);
        
        // 最终步骤：完成处理
        const timer4 = setTimeout(() => {
          setAgentStatus(prev => ({
            ...prev,
            [msgId]: {
              ...prev[msgId],
              currentStep: '生成响应...',
              totalSteps: 5
            }
          }));
        }, 6000);
        statusTimers[msgId].push(timer4);
        
        // 清理函数：如果请求被取消，清除所有定时器
        return () => {
          if (statusTimers[msgId]) {
            statusTimers[msgId].forEach(timer => clearTimeout(timer));
            delete statusTimers[msgId];
          }
        };
      }
      
      // 直接处理响应内容，不使用setTimeout延迟
      try {
        // 检查当前活动会话是否仍然是发送请求的会话
        const isStillActiveSession = currentChatId === processingSessionId
        console.log('🔍 Processing response for session:', processingSessionId, 'Current active session:', currentChatId, 'Still active:', isStillActiveSession)
        
        const assistantContent = parseApiResponse(data, useAgent)
        
        // 确保 assistantContent 是字符串并且不为空
        let finalContent = typeof assistantContent === 'string' 
          ? assistantContent 
          : JSON.stringify(assistantContent)
        
        // 如果内容为空或只是空白字符，使用默认消息
        if (!finalContent || finalContent.trim() === '') {
          finalContent = data.success ? 
            '已完成对您请求的处理，但无法生成详细回复。' : 
            '处理请求时出现问题，请查看详细信息。'
          console.warn('⚠️ Empty response content, using fallback message')
        }
        
        console.log('📝 Final content to display:', finalContent.substring(0, 100), '...')
        
        // 增强消息数据，添加Agent模式的详细信息
        const enhancedMessage: Message = {
          ...assistantMessage,
          content: finalContent,
          // 模式增强信息（後端優先，前端fallback）
          mode: data.mode || (useAgent ? 'agent' : 'llm'),
          model_used: data.model_used || selectedModel,
          execution_time: data.execution_time,
          steps_taken: data.steps_taken,
          generated_image: data.generated_image || data.image_data_uri,
          execution_trace: data.execution_trace || [],
          reasoning_steps: data.reasoning_steps || [],
          tools_used: data.tools_used || []
        }
        
        // 更新消息内容，但考虑会话ID
        setMessages(prev => {
          // 首先过滤掉所有其他会话的消息
          const filteredPrev = prev.filter(msg => !msg.sessionId || msg.sessionId === processingSessionId);
          
          // 创建更新后的消息列表
          const updatedMessages = filteredPrev.map(msg => 
            msg.id === assistantMessage.id ? { ...enhancedMessage, sessionId: processingSessionId } : msg
          );
          
          // 如果用户已经切换到其他会话，控制台记录但不影响更新
          if (currentChatId !== processingSessionId) {
            console.log('⚠️ User switched to another session. Response added to session:', processingSessionId);
          }
          
          console.log('✅ Message content updated successfully for session:', processingSessionId)
          return updatedMessages;
        })
          
          // 更新增强的消息统计信息
          setMessageStats(prev => ({
            ...prev,
            [assistantMessage.id]: {
              processingTime: data.execution_time || apiResponseTime / 1000,
              tokenCount: data.usage?.total_tokens || 0,
              modelUsed: selectedModel,
              toolsCount: (data.execution_trace || []).filter((trace: any) => 
                trace.action && trace.action !== 'thinking' && trace.action !== 'responding'
              ).length,
              memoryUsed: useAgent ? enableMemory : false,
              mcpToolsUsed: useAgent && enableMcp ? (data.tools_used || []).map((tool: any) => tool.name) : [],
              responseSize: JSON.stringify(data).length
            }
          }))
          
          // Agent模式状态更新
          if (useAgent && data.success) {
            setAgentStatus(prev => ({
              ...prev,
              [assistantMessage.id]: {
                currentStep: 'completed',
                totalSteps: data.steps_taken || 0,
                isReflecting: enableReflection && (data.reasoning_steps || []).some((step: any) => step.type === 'reflection'),
                toolsInUse: (data.tools_used || []).map((tool: any) => tool.name),
                memoryActive: enableMemory
              }
            }))
          }
          
          // 保存原始响应数据用于调试 (限制数量防止内存泄漏)
          setRawResponses(prev => {
            const newResponses = {
              ...prev,
              [assistantMessage.id]: data
            }
            
            // 只保留最近20条响应，防止内存泄漏
            const responseIds = Object.keys(newResponses)
            if (responseIds.length > 20) {
              const idsToKeep = responseIds.slice(-20) // 保留最新的20条
              const filteredResponses: {[key: string]: any} = {}
              idsToKeep.forEach(id => {
                filteredResponses[id] = newResponses[id]
              })
              return filteredResponses
            }
            
            return newResponses
          })
          
          // 如果是新會話且收到回覆，重新生成智能標題
          if (isNewSession) {
            console.log('🔄 Generating smart title for new session...')
            setTimeout(async () => {
              try {
                await loadUserSessionsFromAPI()
                console.log('✅ Sessions reloaded with AI-generated title')
              } catch (error) {
                console.warn('⚠️ Failed to reload sessions after title generation:', error)
              }
            }, 1000) // 1秒延遲，給後端時間生成標題
          }
          
        } catch (parseError) {
          console.error('❌ Error parsing response:', parseError)
          setMessages(prev => {
            // 首先过滤掉所有其他会话的消息
            const filteredPrev = prev.filter(msg => !msg.sessionId || msg.sessionId === processingSessionId);
            // 然后更新特定消息
            return filteredPrev.map(msg => 
              msg.id === assistantMessage.id 
                ? { ...msg, content: '响应解析失败，请查看原始JSON', sessionId: processingSessionId }
                : msg
            );
          })
          
          // 更新失败统计
          setLlmStats(prev => ({
            ...prev,
            failureCount: prev.failureCount + 1,
            successRate: ((prev.successRate * (prev.totalCalls - 1))) / prev.totalCalls
          }))
        }
      
      console.log('✅ Message sent successfully to session:', sessionId)
      toast.success(`${useAgent ? 'Agent' : '聊天'}響應已收到`)
        } catch (error) {
      console.error('❌ Error sending message:', error)
      
      // 創建詳細的錯誤信息對象用於調試
      const errorDetails = {
        error: error instanceof Error ? error.message : '發生未知錯誤',
        timestamp: new Date().toISOString(),
        endpoint: useAgent ? `/api/agent/` : `${API_BASE_URL}/chat/completions`,
        mode: useAgent ? 'Agent' : 'Chat',
        model: selectedModel,
        apiKey: API_KEY,
        requestBody: await buildRequestBodyWithSession(currentMessages, sessionId).catch(() => 'Failed to build request body')
      }
      
      // 生成友好的錯誤消息
      let friendlyErrorMessage = ''
      
      if (error instanceof Error) {
        if (error.message.includes('Agent处理超时')) {
          friendlyErrorMessage = `🤖 Agent正在處理複雜任務，處理時間較長。\n\n${error.message}\n\n 建議：\n• 嘗試簡化您的請求\n• 分步驟提出問題\n• 檢查網絡連接是否穩定`
        } else if (error.message.includes('请求已取消')) {
          friendlyErrorMessage = `⏹️ 請求已取消\n\n這可能是因為：\n• 您手動取消了請求\n• ${useAgent ? 'Agent處理時間過長' : '網絡響應超時'}\n• 後端服務暫時不可用`
        } else if (error.message.includes('API请求失败: 404')) {
          friendlyErrorMessage = `🔍 API端點不存在\n\n請檢查：\n• 後端服務是否正確運行\n• API版本是否匹配\n• ${useAgent ? 'Agent' : 'Chat'}端點是否可用`
        } else if (error.message.includes('API请求失败: 401')) {
          friendlyErrorMessage = `🔐 API密鑰驗證失敗\n\n請檢查：\n• API密鑰是否正確\n• 後端服務配置\n• 權限設置`
        } else if (error.message.includes('API请求失败: 500')) {
          friendlyErrorMessage = `🚧 後端服務內部錯誤\n\n這通常是暫時性問題：\n• 請稍後重試\n• 檢查後端服務日志\n• 確認模型是否可用`
        } else {
          friendlyErrorMessage = `❌ ${useAgent ? 'Agent' : '聊天'}請求失敗\n\n錯誤詳情：${error.message}`
        }
      } else {
        friendlyErrorMessage = '❌ 發生未知錯誤，請重試'
      }
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: friendlyErrorMessage,
        timestamp: new Date().toISOString(),        // 添加錯誤相關的元數據
        mode: useAgent ? 'agent' : 'llm',
        model_used: selectedModel,
        error_details: errorDetails, // 用於JSON按鈕顯示
        sessionId: sessionId // 确保错误消息也有会话ID
      }
      
      // 添加错误消息到当前会话，同时过滤掉其他会话的消息
      setMessages(prev => {
        // 首先过滤掉所有其他会话的消息，只保留当前会话的消息或没有sessionId的旧消息
        const filteredPrev = prev.filter(msg => !msg.sessionId || msg.sessionId === sessionId);
        return [...filteredPrev, errorMessage];
      })
      
      // 將錯誤詳情存儲到rawResponses中，這樣用戶可以通過JSON按鈕查看
      setRawResponses(prev => ({
        ...prev,
        [errorMessage.id]: errorDetails
      }))
      
      toast.error(`${useAgent ? 'Agent' : '聊天'}請求失敗`)
    } finally {
      // 只在这是当前会话时才清除加载状态
      if (sessionId === currentChatId) {
        console.log('✅ Clearing loading state for current session:', sessionId)
        setIsLoading(false)
        setLoadingSessionId(null) // 清除正在加载的会话ID
        setCurrentLoadingModel('') // 清除当前加载模型
        
        // 清除localStorage中的状态
        localStorage.removeItem('chatLoadingState')
        localStorage.removeItem('chatLoadingSessionId')
        localStorage.removeItem('currentLoadingModel')
      } else {
        console.log('⚠️ Not clearing loading state - session has changed:', {
          'processingSession': sessionId,
          'currentSession': currentChatId
        })
        // 如果用户已经切换到其他会话，仅重置这个会话的加载状态
        // 但不影响UI的当前加载状态
        if (loadingSessionId === sessionId) {
          setLoadingSessionId(null)
          localStorage.removeItem('chatLoadingSessionId')
        }
      }
      requestManager.finishRequest()
    }
  }
  
  const [isComposing, setIsComposing] = useState(false)
  const [compositionText, setCompositionText] = useState('')
  const isComposingRef = useRef(false) // 使用 ref 确保实时状态
  
  // Safari 浏览器检测和特殊处理
  const isSafari = useRef(false)
  useEffect(() => {
    isSafari.current = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
    console.log('🍎 Safari detected:', isSafari.current)
  }, [])
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Safari 特殊处理：检查 keyCode 229 (输入法激活)
    if (isSafari.current && e.nativeEvent.keyCode === 229) {
      console.log('🍎 Safari IME active (keyCode 229) - blocking Enter')
      return // 不处理任何按键
    }
    
    // 对于中文输入法，需要检查多个条件
    const isEnterPressed = e.key === 'Enter'
    const isNoShift = !e.shiftKey
    const isNotComposing = !isComposing && !isComposingRef.current
    
    console.log('KeyDown event:', { 
      key: e.key, 
      isComposing, 
      isComposingRef: isComposingRef.current,
      shiftKey: e.shiftKey,
      compositionText,
      inputLength: input.length,
      willSend: isEnterPressed && isNoShift && isNotComposing
    })
    
    // 只有在不是组合输入状态下才允许发送
    if (isEnterPressed && isNoShift && isNotComposing) {
      e.preventDefault()
      console.log('✅ Sending message via Enter key')
      sendMessage()
    } else if (isEnterPressed && (isComposing || isComposingRef.current)) {
      console.log('🚫 Enter blocked - composition in progress')
    }
  }
  const handleCompositionStart = (e: React.CompositionEvent) => {
    console.log('🎯 Composition started - 输入法开始', e.data)
    setIsComposing(true)
    isComposingRef.current = true
    setCompositionText(e.data || '')
  }

  const handleCompositionUpdate = (e: React.CompositionEvent) => {
    console.log('🔄 Composition update - 输入法更新', e.data)
    setCompositionText(e.data || '')
    // 确保在更新期间保持组合状态
    setIsComposing(true)
    isComposingRef.current = true
  }

  const handleCompositionEnd = (e: React.CompositionEvent) => {
    console.log('🏁 Composition ended - 输入法结束', e.data)
    
    // Safari 需要额外的延迟来确保正确处理
    const delay = isSafari.current ? 150 : 50
    
    setTimeout(() => {
      setIsComposing(false)
      isComposingRef.current = false
      setCompositionText('')
      console.log('✅ Composition state cleared')
    }, delay)
  }

  const copyMessage = (content: string) => {
    navigator.clipboard.writeText(content)
    toast.success('已复制到剪贴板')
  }  // Test API connection
  const testConnection = async () => {
    setApiStatus('testing')
    try {
      console.log('🔍 Testing API connection...')
      
      // Test models endpoint
      const modelsResponse = await fetch(`${API_BASE_URL}/models`, {
        headers: {
          'X-API-KEY': API_KEY,
          'accept': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
      })
      
      console.log(`📊 Models test response: ${modelsResponse.status} ${modelsResponse.statusText}`)
      
      if (modelsResponse.ok) {
        // Test health endpoint instead of sending actual chat request
        const healthResponse = await fetch(`/api/health`, {
          headers: {
            'accept': 'application/json'
          },
          signal: AbortSignal.timeout(5000)
        })
        
        console.log(`❤️ Health test response: ${healthResponse.status} ${healthResponse.statusText}`)
        
        if (healthResponse.ok) {
          setApiStatus('connected')
          console.log('✅ API connection successful')
          toast.success('✅ API 連接正常，所有端點可用')
          fetchModels() // Refresh models
        } else {
          setApiStatus('connected') // Models work, health might not be implemented
          console.log('✅ Models API works, health endpoint not available')
          toast.success('✅ API 連接正常，模型端點可用')
          fetchModels() // Refresh models
        }
      } else {
        setApiStatus('disconnected')
        console.log('❌ Models API test failed')
        toast.error(`❌ 模型API測試失敗: ${modelsResponse.status} ${modelsResponse.statusText}`)
      }
    } catch (error: any) {
      setApiStatus('disconnected')
      console.error('❌ Connection test failed:', error)
      
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        toast.error('⏰ 連接測試超時，請檢查網絡或後端服務')
      } else if (error.message.includes('fetch')) {
        toast.error('🌐 網絡連接失敗，請確保後端服務正在運行')
      } else {
        toast.error(`❌ 連接測試失敗: ${error.message}`)
      }
    }
  }

  const clearAllHistory = () => {
    setChatHistory([])
    setMessages([])
    setCurrentChatId('')
    localStorage.removeItem('chatHistory')
    toast.success('所有對話歷史已清除')
  }  // API configuration
  const API_KEY = 'test_api_key'
  const REQUEST_TIMEOUT = 7200000 // 2 hours for chat mode
  const AGENT_REQUEST_TIMEOUT = 7200000 // 2 hours for agent mode
  // Create abort controller for request cancellation with better state management
  const abortControllerRef = useRef<AbortController | null>(null)
  const isRequestActiveRef = useRef(false)
  
  // 請求管理器 - 提供更精確的請求控制
  const requestManager = {
    startRequest: () => {
      console.log('🚀 Starting new request...')
      isRequestActiveRef.current = true
      if (abortControllerRef.current) {
        abortControllerRef.current.abort('New request started')
      }
      abortControllerRef.current = new AbortController()
      return abortControllerRef.current
    },
    
    cancelRequest: () => {
      console.log('🛑 Manually cancelling request...')
      if (abortControllerRef.current && isRequestActiveRef.current) {
        abortControllerRef.current.abort('User cancelled')
        isRequestActiveRef.current = false
        setIsLoading(false)
        toast.info('請求已取消')
      }
    },
      finishRequest: () => {
      console.log('✅ Request finished')
      isRequestActiveRef.current = false
      // 不立即清除controller，讓它自然過期，這樣可以避免在請求完成期間的競態條件
    },
    
    isActive: () => isRequestActiveRef.current
  }

  // 会话图片恢复函数
  const restoreSessionImages = async (sessionId: string, messages: Message[]): Promise<Message[]> => {
    try {
      console.log('🔄 Restoring images for session:', sessionId)
      
      // 获取会话的所有图片
      const response = await fetch(`${API_BASE_URL}/session/${sessionId}/images`, {
        headers: {
          'X-API-KEY': API_KEY,
          'accept': 'application/json'
        }
      })

      if (response.ok) {
        const imageData = await response.json()
        console.log('📷 Found session images:', imageData.image_count, 'images')
        
        if (imageData.image_urls && imageData.image_urls.length > 0) {
          // 为每个消息检查是否需要添加图片
          const updatedMessages = messages.map((message, index) => {              
            // 检查消息是否已经包含图片（兼容新旧格式）
            const hasImage = message.content.includes('![') || 
                            message.content.includes('/images/') || 
                            message.content.includes('/api/v1/images/')
            
            // 如果是助手消息且没有图片，尝试匹配对应的图片
            if (message.role === 'assistant' && !hasImage) {
              // 寻找对应的图片（简化逻辑：按顺序匹配助手消息）
              const assistantMessageIndex = messages.slice(0, index + 1)
                .filter(m => m.role === 'assistant').length - 1
              
              if (imageData.image_urls[assistantMessageIndex]) {
                console.log(`🖼️ Adding missing image to message ${message.id}`)
                return {
                  ...message,
                  content: message.content + `\n\n![生成的圖片](${imageData.image_urls[assistantMessageIndex]})`
                }
              }
            }
            
            return message
          })
          
          return updatedMessages
        }
      }
      
      return messages
    } catch (error) {
      console.warn('⚠️ Failed to restore session images:', error)
      return messages
    }
  }

  // 检查会话是否已经收到响应
  const checkSessionResponseStatus = async (sessionId: string): Promise<boolean> => {
    try {
      console.log('🔍 Checking if session has received response:', sessionId);
      // 获取会话的最新消息
      const response = await fetch(`${API_BASE_URL}/sessions/test/${sessionId}`, {
        headers: {
          'X-API-KEY': API_KEY,
          'accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        console.warn('⚠️ Failed to check session status:', response.status);
        return false;
      }
      
      const data = await response.json();
      
      // 检查会话中的消息
      if (data.success && data.session && data.session.messages) {
        const messages = data.session.messages;
        
        // 如果存在的最后一条消息是AI回复，说明请求已经完成
        if (messages.length > 0) {
          // 获取最后两条消息
          const lastMessage = messages[messages.length - 1];
          const previousMessage = messages.length > 1 ? messages[messages.length - 2] : null;
          
          // 如果最后一条消息是助手的回复，且倒数第二条是用户的问题，说明服务器已经响应
          if (lastMessage.role === 'assistant' && previousMessage && previousMessage.role === 'user') {
            console.log('✅ Server has already responded to this session');
            return true;
          }
        }
      }
      
      console.log('⏳ Session is still waiting for response or no messages found');
      return false;
    } catch (error) {
      console.error('❌ Error checking session response status:', error);
      return false;
    }
  };

  // Session management functions
  const createNewSession = async (initialTitle?: string, initialMessage?: Message): Promise<string> => {
    try {
      // 如果提供了初始标题，使用它；否则使用默认标题
      const sessionTitle = initialTitle ? 
        (initialTitle.length > 50 ? initialTitle.substring(0, 50) + '...' : initialTitle) : 
        "新对话"
      
      // 准备请求体，如果有初始消息则包含进去
      const requestBody: any = {
        user_id: "test",
        title: sessionTitle
      }
      
      // 如果提供了初始消息，添加到请求中
      if (initialMessage) {
        requestBody.initial_message = {
          role: initialMessage.role,
          content: initialMessage.content,
          timestamp: initialMessage.timestamp
        }
      }
      
      const response = await fetch(`${API_BASE_URL}/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': API_KEY,
          'accept': 'application/json'
        },
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        throw new Error(`创建会话失败: ${response.status}`)
      }

      const data = await response.json()
      console.log('✅ New session created:', data.session_id, 'with title:', sessionTitle, initialMessage ? 'and initial message' : '')
      return data.session_id
      
    } catch (error) {
      console.error('❌ Error creating session:', error)
      // 如果创建会话失败，生成本地session ID作为备用
      const fallbackId = Date.now().toString()
      console.log('🔄 Using fallback session ID:', fallbackId)
      return fallbackId
    }
  }

  const loadChatSessions = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/sessions/test?limit=100`, {
        headers: {
          'X-API-KEY': API_KEY,
          'accept': 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error(`获取会话列表失败: ${response.status}`)
      }

      const data = await response.json()
        if (data.success && data.sessions) {
        // 转换服务器会话格式为前端格式
        const sessions: ChatHistory[] = data.sessions.map((session: any) => ({
          id: session.session_id,
          title: session.title || "未命名对话",
          messages: session.messages || [],
          timestamp: session.updated_at || session.created_at
        }))
        
        setChatHistory(sessions)
        console.log('✅ Loaded sessions from server:', sessions.length)
      } else {
        // 如果服务器返回空会话列表，设置为空数组
        setChatHistory([])
        console.log('📭 No sessions found on server')
      }
        } catch (error) {
      console.warn('⚠️ Failed to load sessions from server:', error)
      // 如果服务器加载失败，直接设置空会话列表，让自动创建逻辑处理
      setChatHistory([])
      console.log('📭 Set empty session list due to server error')
    }
  }
  // 新增一个不直接更新状态的版本，用于避免UI闪烁
  const loadSessionDetailWithoutStateUpdate = async (sessionId: string, isHistoryLoad: boolean = false) => {
    try {
      console.log('🔍 Loading session detail (without state update) from server:', sessionId)
      const response = await fetch(`${API_BASE_URL}/sessions/test/${sessionId}`, {
        headers: {
          'X-API-KEY': API_KEY,
          'accept': 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error(`获取会话详情失败: ${response.status}`)
      }

      const data = await response.json()
      
      if (data.success && data.session) {
        // 获取原始消息列表
        let sessionMessages = (data.session.messages || []).map((msg: any) => ({
          ...msg,
          sessionId: sessionId // 为每条消息标记会话ID
        }))
        console.log('✅ Loaded session detail:', sessionId, sessionMessages.length, 'messages')
        
        // 服务器返回空消息列表，但本地有消息 - 可能是会话刚创建但消息还未同步
        if (sessionMessages.length === 0) {
          console.log('⚠️ Server returned empty message list for session:', sessionId)
          // 尝试找到本地缓存的消息
          const localSession = chatHistory.find(chat => chat.id === sessionId)
          if (localSession && localSession.messages.length > 0) {
            // 确保本地缓存的消息也有会话ID
            sessionMessages = localSession.messages.map(msg => ({
              ...msg,
              sessionId: sessionId // 添加会话ID标识
            }));
          }
        }
        
        // 尝试恢复会话图片
        try {
          sessionMessages = await restoreSessionImages(sessionId, sessionMessages)
          console.log('🖼️ Images restored for session:', sessionId)
        } catch (imageError) {
          console.warn('⚠️ Failed to restore images for session:', sessionId, imageError)
        }
        
        // 检查是否是正在加载的会话 - 页面刷新后需要恢复加载状态
        const wasLoadingThisSession = 
          localStorage.getItem('chatLoadingSessionId') === sessionId && 
          localStorage.getItem('chatLoadingState') === 'true';
          
        console.log('🔍 Checking if session was loading:', { 
          sessionId, 
          wasLoadingThisSession,
          localStorageId: localStorage.getItem('chatLoadingSessionId'),
          localStorageState: localStorage.getItem('chatLoadingState')
        });
        
        // 不更新状态，只返回数据
        return { 
          success: true, 
          messages: sessionMessages,
          wasLoading: wasLoadingThisSession,
          loadingModel: localStorage.getItem('currentLoadingModel') || ''
        };
      }
      return { success: false, messages: [] };
      
    } catch (error) {
      console.error('❌ Error loading session detail:', error)
      // 如果失败，尝试从本地历史加载
      const localChat = chatHistory.find(chat => chat.id === sessionId)
      if (localChat) {
        // 确保本地加载的消息也有会话ID
        const messagesWithSessionId = localChat.messages.map(msg => ({
          ...msg,
          sessionId: sessionId
        }));
        return { success: true, messages: messagesWithSessionId };
      }
      return { success: false, messages: [] };
    }
  }
  
  // 原始函数保留用于兼容性
  const loadSessionDetail = async (sessionId: string, isHistoryLoad: boolean = false) => {
    try {
      console.log('🔍 Loading session detail from server:', sessionId)
      const response = await fetch(`${API_BASE_URL}/sessions/test/${sessionId}`, {
        headers: {
          'X-API-KEY': API_KEY,
          'accept': 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error(`获取会话详情失败: ${response.status}`)
      }

      const data = await response.json()
      
      if (data.success && data.session) {
        // 获取原始消息列表
        let sessionMessages = (data.session.messages || []).map((msg: any) => ({
          ...msg,
          sessionId: sessionId // 为每条消息标记会话ID
        }))
        console.log('✅ Loaded session detail:', sessionId, sessionMessages.length, 'messages')
        
        // 服务器返回空消息列表，但本地有消息 - 可能是会话刚创建但消息还未同步
        if (sessionMessages.length === 0) {
          console.log('⚠️ Server returned empty message list for session:', sessionId)
          // 尝试找到本地缓存的消息
          const localSession = chatHistory.find(chat => chat.id === sessionId)
          if (localSession && localSession.messages.length > 0) {
            // 确保本地缓存的消息也有会话ID
            sessionMessages = localSession.messages.map(msg => ({
              ...msg,
              sessionId: sessionId // 添加会话ID标识
            }));
            console.log('🔄 Using local messages for session:', sessionId, localSession.messages.length, 'messages')
            sessionMessages = localSession.messages
          }
        }
          // 尝试恢复会话图片
        try {
          sessionMessages = await restoreSessionImages(sessionId, sessionMessages)
          console.log('🖼️ Images restored for session:', sessionId)
        } catch (imageError) {
          console.warn('⚠️ Failed to restore images for session:', sessionId, imageError)
        }        // 获取会话图片列表以便匹配 attachment 引用
        let sessionImageUrls: string[] = []
        try {
          const imageResponse = await fetch(`${API_BASE_URL}/session/${sessionId}/images`, {
            headers: {
              'X-API-KEY': API_KEY,
              'accept': 'application/json'
            }
          })
          if (imageResponse.ok) {
            const imageData = await imageResponse.json()
            sessionImageUrls = imageData.image_urls || []
            console.log('📷 Found session images for attachment matching:', sessionImageUrls.length)
          }
        } catch (error) {
          console.warn('⚠️ Failed to fetch session images for attachment matching:', error)
        }        // 重建 rawResponses 数据
        const restoredRawResponses: {[messageId: string]: any} = {}
        let imageIndex = 0 // 用于跟踪图片索引，按顺序分配给有图片的助手消息
        
        sessionMessages.forEach((message: Message) => {
          if (message.role === 'assistant' && message.content) {
            // 首先檢查是否有存儲的 raw_response 數據（新版本）
            if ((message as any).raw_response) {
              restoredRawResponses[message.id] = (message as any).raw_response
              console.log('🔄 Restored stored raw_response for message:', message.id)
            }
            // 或者檢查是否有其他增強數據字段
            else if ((message as any).tool_calls || (message as any).image_data_uri || (message as any).execution_trace) {
              // 構建 raw_response 結構
              restoredRawResponses[message.id] = {
                success: true,
                interaction_id: message.id,
                response: {},
                tool_calls: (message as any).tool_calls || null,
                image_data_uri: (message as any).image_data_uri || null,
                execution_trace: (message as any).execution_trace || [],
                reasoning_steps: (message as any).reasoning_steps || [],
                tools_used: (message as any).tools_used || [],
                execution_time: (message as any).execution_time || 0,
                steps_taken: (message as any).steps_taken || 1,
                meta: {
                  model: (message as any).model_used || 'unknown',
                  timestamp: message.timestamp || new Date().toISOString()
                }
              }
              console.log('🔄 Built raw_response from enhanced fields for message:', message.id)
            }              
            // 兼容舊版本：检查消息内容是否包含图片引用（新旧格式）
            else if (message.content.includes('/images/') || message.content.includes('/api/v1/images/')) {
              // 从消息内容中提取图片URL（兼容新旧格式）
              const imageUrlMatch = message.content.match(/!\[.*?\]\((\/(?:api\/v1\/)?images\/[^)]+)\)/)
              if (imageUrlMatch) {
                restoredRawResponses[message.id] = {
                  image_data_uri: imageUrlMatch[1],
                  message: message.content.replace(/!\[.*?\]\([^)]+\)/, '').trim()
                }
                console.log('🔄 Restored rawResponse for message:', message.id, imageUrlMatch[1])
                imageIndex++ // 增加图片索引
              }
            }
            // 处理包含 attachment 引用的消息
            else if (message.content.includes('attachment')) {
              // 检查是否有对应的图片链接模式
              const attachmentMatch = message.content.match(/!\[.*?\]\(attachment[^)]*\)/)
              if (attachmentMatch) {
                // 尝试从会话图片中按顺序匹配图片
                if (imageIndex < sessionImageUrls.length) {
                  const matchedImageUrl = sessionImageUrls[imageIndex]
                  restoredRawResponses[message.id] = {
                    image_data_uri: matchedImageUrl,
                    message: message.content.replace(/!\[.*?\]\(attachment[^)]*\)/, '').trim()
                  }
                  console.log('✅ Matched attachment to image for message:', message.id, matchedImageUrl)
                  imageIndex++ // 增加图片索引
                } else {
                  console.warn('⚠️ Found attachment reference but no available image for message:', message.id)
                  restoredRawResponses[message.id] = {
                    image_data_uri: '', // 没有可用图片
                    message: message.content.replace(/!\[.*?\]\(attachment[^)]*\)/, '').trim()
                  }
                }
              }            }
          }
        })
        
        setRawResponses(restoredRawResponses)
        console.log('📦 Restored rawResponses:', Object.keys(restoredRawResponses).length, 'entries')
        
        // 如果是加载历史对话，设置标志以防止时间戳更新
        if (isHistoryLoad) {
          setIsLoadingHistory(true)
        }
        
        // 设置消息时，确保只包含当前会话的消息，替换所有其他会话的消息
        setMessages(sessionMessages.filter((msg: Message) => !msg.sessionId || msg.sessionId === sessionId))
        setCurrentChatId(sessionId)
        
        // 重置标志
        if (isHistoryLoad) {
          setTimeout(() => setIsLoadingHistory(false), 100)
        }
        
        return true
      }
      
    } catch (error) {
      console.error('❌ Error loading session detail:', error)      // 如果失败，尝试从本地历史加载
      const localChat = chatHistory.find(chat => chat.id === sessionId)
      if (localChat) {
        // 如果是加载历史对话，设置标志以防止时间戳更新
        if (isHistoryLoad) {
          setIsLoadingHistory(true)
        }
        
        // 确保本地加载的消息也有会话ID
        const messagesWithSessionId = localChat.messages.map(msg => ({
          ...msg,
          sessionId: sessionId // 添加会话ID标识
        }));
        setMessages(messagesWithSessionId)
        setCurrentChatId(sessionId)
        console.log('📋 Added sessionId to locally loaded messages:', sessionId)
        
        // 重置标志
        if (isHistoryLoad) {
          setTimeout(() => setIsLoadingHistory(false), 100)
        }
        
        console.log('🔄 Loaded from local cache:', sessionId)
        return true
      }
      return false
    }
  }

  const deleteSessionFromServer = async (sessionId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/sessions/test/${sessionId}`, {
        method: 'DELETE',
        headers: {
          'X-API-KEY': API_KEY,
          'accept': 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error(`删除会话失败: ${response.status}`)
      }

      const data = await response.json()
      
      if (data.success) {
        console.log('✅ Session deleted from server:', sessionId)
        // 重新加载会话列表
        await loadChatSessions()
        
        // 如果删除的是当前会话，清空消息
        if (currentChatId === sessionId) {
          setMessages([])
          setCurrentChatId('')
        }
        
        toast.success('对话已删除')
        return true
      }
      
    } catch (error) {
      console.error('❌ Error deleting session:', error)
      // 如果服务器删除失败，仍然从本地删除
      deleteChat(sessionId)
      return false
    }
  }

  const loadUserSessionsFromAPI = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/sessions/test`, {
        headers: {
          'X-API-KEY': API_KEY,
        },
      })

      if (response.ok) {
        const result = await response.json()
        if (result.success && result.sessions) {
          const serverSessions: ChatHistory[] = result.sessions.map((session: any) => ({
            id: session.session_id,
            title: session.title,
            messages: session.messages?.map((msg: any) => ({
              id: msg.id || Date.now().toString(),
              role: msg.role,
              content: msg.content,
              timestamp: msg.timestamp || new Date().toISOString()
            })) || [],
            timestamp: session.updated_at || session.created_at
          }))
          
          // 合并服务器会话和本地会话，避免重复
          setChatHistory(prev => {
            const mergedSessions = [...serverSessions]
            
            // 添加不在服务器上的本地会话
            prev.forEach(localChat => {
              if (!serverSessions.find(serverSession => serverSession.id === localChat.id)) {
                mergedSessions.push(localChat)
              }
            })
            
            // 按时间戳排序
            return mergedSessions.sort((a, b) => 
              new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
            )
          })
          
          console.log('✅ Sessions synced from server:', serverSessions.length)
          return true
        }
      }
      return false
    } catch (error) {
      console.error('❌ Error loading sessions:', error)
      return false
    }
  }  // 构建带有会话ID的请求体
  const buildRequestBodyWithSession = async (messages: Message[], sessionId?: string) => {
    // 如果没有提供sessionId，创建新会话（使用最后一条消息作为标题和内容）
    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : undefined;
    const finalSessionId = sessionId || await createNewSession(
      lastMessage ? lastMessage.content : undefined,
      lastMessage // 传递完整的消息对象，确保新会话包含初始消息
    )
    
    console.log('🔧 Building request body - useAgent:', useAgent)
    
    if (useAgent) {
      // Agent API 格式 - 需要 prompt 字段
      const lastMessage = messages[messages.length - 1]
      const agentBody = {
        prompt: lastMessage?.content || '',
        user_id: "test",
        model_name: selectedModel,
        session_id: finalSessionId,
        
        // Agent基础功能配置
        enable_memory: enableMemory,
        enable_reflection: enableReflection,
        enable_react_mode: enableReactMode,
        enable_mcp: enableMcp,
        
        // 工具配置
        tools_config: {
          enable_search: enableSearch,
          include_advanced_tools: true
        },
        
        // 高级Agent配置
        max_steps: useAgent ? 10 : undefined, // 可配置的最大步骤数
        system_prompt_override: undefined, // 可选的系统提示覆盖
        
        // 上下文增强
        additional_context: [],
        context: {
          ui_mode: compactMode ? 'compact' : 'standard',
          display_preferences: {
            show_timestamps: showTimestamps,
            show_model_info: showModelInfo,
            show_performance_metrics: showPerformanceMetrics
          },
          session_info: {
            message_count: messages.length,
            current_session_id: finalSessionId
          }
        },
          // 环境信息（用于增强上下文）
        environment_info: {
          timestamp: new Date().toISOString(),
          user_agent: navigator.userAgent,
          language: navigator.language || 'en-US', // 自動檢測用戶語言
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          user_preferences: {
            compact_mode: compactMode,
            show_timestamps: showTimestamps,
            show_model_info: showModelInfo,
            show_performance_metrics: showPerformanceMetrics
          },
          session_context: {
            total_messages: messages.length,
            agent_messages: messages.filter(m => m.mode === 'agent').length,
            has_images: messages.some(m => m.generated_image || 
                                       m.content.includes('![') || 
                                       m.content.includes('/images/') ||
                                       m.content.includes('/api/v1/images/')),
            tools_previously_used: Array.from(new Set(
              messages.flatMap(m => m.tools_used?.map(tool => tool.name) || [])
            ))
          }
        },
        
        // 可能的多模态输入
        image: undefined, // 可以在需要时添加
        audio: undefined, // 可以在需要时添加
        
        // MCP特定配置
        document_chunks: enableMcp ? [] : undefined
      }
      
      console.log('🤖 Agent API request body:', agentBody)
      return agentBody
    } else {
      // Chat API 格式 - 需要 messages 字段
      const chatBody = {
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp
        })),
        model: selectedModel,
        user_id: "test",
        session_id: finalSessionId,
        
        // Chat模式工具配置
        tools: enableMcp ? undefined : [],
        enable_search: enableSearch,
          // 语言和历史设置
        language: navigator.language || 'en-US', // 自動檢測用戶語言
        disable_history: disableHistory,
        
        // 温度和其他生成参数
        temperature: 0.7,
        max_tokens: 4000,
        
        // 增强的上下文信息
        context: {
          ui_preferences: {
            compact_mode: compactMode,
            show_model_info: showModelInfo,
            show_timestamps: showTimestamps
          },
          session_metadata: {
            message_count: messages.length,
            session_id: finalSessionId,
            has_previous_context: !disableHistory
          }
        },
        
        // 用户偏好和环境
        user_preferences: {
          response_format: 'markdown',
          include_reasoning: false, // Chat模式通常不需要推理步骤
          max_response_length: 4000
        }
      }
      
      console.log('💬 Chat API request body:', chatBody)
      return chatBody
    }
  }

  // Cancel ongoing request  
  const cancelRequest = () => {
    requestManager.cancelRequest()
  }

  // 会话管理API调用函数
  const createNewSessionAPI = async (initialTitle?: string) => {
    try {
      const sessionTitle = initialTitle ? 
        (initialTitle.length > 50 ? initialTitle.substring(0, 50) + '...' : initialTitle) : 
        "新对话"
        
      const response = await fetch(`${API_BASE_URL}/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': API_KEY,
        },
        body: JSON.stringify({
          user_id: "test",
          title: sessionTitle
        }),
      })

      if (response.ok) {
        const result = await response.json()
        console.log('✅ Session created on server:', result.session_id, 'with title:', sessionTitle)
        return result.session_id
      } else {
        console.error('❌ Failed to create session on server')
        return null
      }
    } catch (error) {
      console.error('❌ Error creating session:', error)
      return null
    }
  }

  const loadSessionFromAPI = async (sessionId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/sessions/test/${sessionId}`, {
        headers: {
          'X-API-KEY': API_KEY,
        },
      })

      if (response.ok) {
        const result = await response.json()
        if (result.success && result.session) {
          const session = result.session
          const sessionMessages: Message[] = session.messages.map((msg: any) => ({
            id: msg.id || Date.now().toString(),
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp || new Date().toISOString(),
            sessionId: sessionId // 确保每条消息都有sessionId
          }))
          
          // 只保留当前会话的消息
          setMessages(sessionMessages.filter((msg: Message) => !msg.sessionId || msg.sessionId === sessionId))
          setCurrentChatId(sessionId)
          
          // 更新本地缓存
          const chatExists = chatHistory.find(chat => chat.id === sessionId)
          if (!chatExists) {
            const newChat: ChatHistory = {
              id: sessionId,
              title: session.title || "加载的对话",
              messages: sessionMessages,
              timestamp: session.updated_at || new Date().toISOString()
            }
            setChatHistory(prev => [newChat, ...prev])
          }
          
          console.log('✅ Session loaded from server:', sessionId)
          return true
        }
      }
      return false
    } catch (error) {
      console.error('❌ Error loading session:', error)
      return false
    }  }  // Enhanced API request function with retry logic and adaptive timeout
  const makeApiRequest = async (endpoint: string, body: any): Promise<any> => {    // 使用請求管理器來處理請求生命週期
    const controller = requestManager.startRequest()
    if (abortControllerRef.current && abortControllerRef.current.signal.aborted) {
      console.log('Previous request was already aborted, creating new controller')
    } else if (abortControllerRef.current) {
      console.log('⚠️ Previous request still active, but proceeding with new request (concurrent)')
    }    // Use different timeout based on request type
    const isAgentRequest = endpoint.includes('/agent')
    const timeout = isAgentRequest ? AGENT_REQUEST_TIMEOUT : REQUEST_TIMEOUT
    
    const timeoutId = setTimeout(() => {
      if (controller && !controller.signal.aborted) {
        console.log(`⏰ Request timeout after ${timeout}ms (${isAgentRequest ? 'Agent' : 'Chat'} mode)`)
        controller.abort(`Request timeout after ${timeout}ms`)
      }
    }, timeout)

    try {
      console.log(`🚀 Making API request to: ${endpoint}`)
      console.log(`⏰ Timeout: ${timeout}ms (${isAgentRequest ? 'Agent' : 'Chat'} mode)`)
      console.log('📦 Request body:', JSON.stringify(body, null, 2))

      // Validate request body to prevent invalid HTTP requests
      if (!body || typeof body !== 'object') {
        throw new Error('Invalid request body: must be a valid object')
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': API_KEY,
          'accept': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`❌ API Error Response (${response.status}):`, errorText)
        
        // Try to parse error as JSON for better error handling
        let errorData = null
        try {
          errorData = JSON.parse(errorText)
        } catch (e) {
          // Not JSON, use raw text
        }
        throw new Error(`API请求失败: ${response.status} - ${errorText}`)
      }
      const data = await response.json()
      console.log('✅ API Response received:', data)
      // 成功完成請求，通知請求管理器
      requestManager.finishRequest()
      return data
    } catch (error: any) {
      clearTimeout(timeoutId)
      if (error.name === 'AbortError') {
        console.log('🛑 Request was cancelled')
        requestManager.finishRequest()
        if (isAgentRequest) {
          throw new Error(`Agent处理超时 (${timeout/1000}秒)，可能是因为任务复杂度较高。请稍后重试或简化请求。`)
        } else {
          throw new Error('请求已取消')
        }
      }
      console.error(`❌ API request failed:`, error)
      requestManager.finishRequest()
      throw error
    }
  }

  // Parse API response based on mode
  const parseApiResponse = (data: any, isAgentMode: boolean): string => {
    try {
      console.log('🔍 Parsing API response:', JSON.stringify(data, null, 2))
      
      let message = ''
      
      if (isAgentMode) {
        // Agent mode response parsing - 处理嵌套结构
        console.log('🤖 Parsing Agent mode response')
        
        if (data.response && data.response.choices && data.response.choices[0] && data.response.choices[0].message) {
          // 标准的 Agent 响应格式：data.response.choices[0].message.content
          message = data.response.choices[0].message.content
          console.log('✅ Found message in data.response.choices[0].message.content')
          
          // 添加 Agent 模式的额外信息日志
          const agentInfo = {
            success: data.success,
            interaction_id: data.interaction_id,
            execution_time: data.execution_time,
            steps_taken: data.steps_taken,
            execution_trace: data.execution_trace?.length || 0,
            reasoning_steps: data.reasoning_steps?.length || 0
          };
          console.log('🤖 Agent response metadata:', agentInfo);
          
        } else if (data.response && typeof data.response === 'string') {
          // 简单的响应字符串
          message = data.response
          console.log('✅ Found message in data.response (string)')
        } else if (data.message) {
          // 备用：直接的 message 字段
          message = data.message
          console.log('✅ Found message in data.message')
        } else {
          console.warn('⚠️ Agent response structure not recognized, trying fallback methods')
          // 尝试其他可能的路径
          if (data.choices && data.choices[0] && data.choices[0].message) {
            message = data.choices[0].message.content
          }
        }
      } else {
        // Chat mode response parsing
        console.log('💬 Parsing Chat mode response')
        console.log('🔍 Available data keys:', Object.keys(data))
        
        if (data.message) {
          message = data.message
          console.log('✅ Found message in data.message')
        } else if (data.choices && data.choices[0] && data.choices[0].message) {
          message = data.choices[0].message.content
          console.log('✅ Found message in data.choices[0].message.content')
        } else if (data.response) {
          message = data.response
          console.log('✅ Found message in data.response')
        } else if (data.content) {
          message = data.content
          console.log('✅ Found message in data.content (fallback)')
        } else {
          console.warn('⚠️ Chat response structure not recognized')
          console.log('🔍 Data structure:', JSON.stringify(data, null, 2).substring(0, 500) + '...')
          message = '收到响应但无法解析内容，请查看原始JSON。'
        }
      }
        
      console.log('📝 Extracted message:', message)
      
      // 确保 message 是字符串类型
      if (typeof message !== 'string') {
        console.warn('⚠️ Non-string message detected:', typeof message, message)
        message = String(message || '')
      }

      // 统一的图片处理逻辑
      const imageDataUri = isAgentMode ? 
        (data.generated_image || data.image_data_uri || (data.response && data.response.image_data_uri)) :
        data.image_data_uri;
      
      if (imageDataUri) {
        console.log('🔍 Processing image data from API response')
        message = processImageInMessage(message, imageDataUri);
      }
      
      // 检查是否有本地图片URL
      if (data.local_image_url && !imageDataUri) {        
        console.log('📷 Found local image URL:', data.local_image_url)
        let localImageUrl = data.local_image_url
        
        // 如果不是完整URL，添加API_BASE_URL前缀
        if (!localImageUrl.startsWith('http') && !localImageUrl.startsWith('/api/backend/')) {
          // 处理各种可能的格式
          if (localImageUrl.startsWith('/api/v1/images/')) {
            localImageUrl = localImageUrl.replace('/api/v1/images/', '/images/')
          }
          if (!localImageUrl.startsWith('/')) {
            localImageUrl = '/' + localImageUrl
          }
          localImageUrl = `${API_BASE_URL}${localImageUrl}`
        } else if (localImageUrl.startsWith('/api/backend/')) {
          // 如果已经包含 /api/backend/ 前缀，直接使用
          localImageUrl = localImageUrl
        }
        
        if (message) {
          message += `\n\n![生成的图片](${localImageUrl})`
        } else {
          message = `![生成的图片](${localImageUrl})`
        }
      }
        
      if (message) {
        return String(message) // 确保返回字符串
      }
      
      console.warn('⚠️ Unexpected response structure:', data)
      return JSON.stringify(data, null, 2) || '收到了意外的响应格式'
    } catch (error) {
      console.error('❌ Error parsing API response:', error)
      return '解析响应时出错'
    }
  }
  // 抽取图片处理逻辑到独立函数
  const processImageInMessage = (message: string, imageDataUri: string): string => {
    // 兼容旧格式：如果是 /api/v1/images/ 格式，转换为新格式
    if (imageDataUri.startsWith('/api/v1/images/')) {
      console.log('📊 Detected old format MongoDB image URL, converting:', imageDataUri)
      imageDataUri = imageDataUri.replace('/api/v1/images/', '/images/')
    }
    
    // 如果image_data_uri是MongoDB URL格式（如 /images/{id}）
    if (imageDataUri.startsWith('/images/')) {
      console.log('📊 Detected MongoDB image URL:', imageDataUri)
      
      // 检查消息中是否已包含图片
      if (!message.includes('![') && !message.includes(imageDataUri)) {
        console.log('🖼️ Adding MongoDB image URL to message')
        const imageMarkdown = `\n\n![生成的圖片](${imageDataUri})`
        message = (message || '') + imageMarkdown
        console.log('✅ Added MongoDB image URL to message')
      }
    }
    // 处理传统的data URI格式
    else if (imageDataUri.startsWith('data:image/')) {
      console.log('📷 Processing data URI image, length:', imageDataUri.length)
      
      // 检查消息中是否包含 attachment 引用需要替换
      if (message.includes('attachment://') || message.includes('attachment:/') || 
          message.includes('(attachment') || (message.includes('![') && message.includes('attachment'))) {
        
        console.log('🔄 Found attachment reference in message, replacing with actual image data')
        
        // 替换attachment引用
        const attachmentRegex = /!\[([^\]]*)\]\((attachment:[\/]{0,2}[^)]*)\)/g
        const originalMessage = message
        
        if (message.match(attachmentRegex)) {
          message = message.replace(attachmentRegex, (match, p1) => {
            console.log(`🔧 Replacing "${match}" with image data URI`)
            return `![${p1 || '生成的圖片'}](${imageDataUri})`
          })
        } else {
          // 直接替换包含attachment的行
          const lines = message.split('\n')
          message = lines.map(line => {
            if (line.includes('attachment') && line.includes('![')) {
              return `![生成的圖片](${imageDataUri})`
            }
            return line
          }).join('\n')
        }
        
        // 如果替换失败，直接添加图片
        if (message === originalMessage || !message.includes(imageDataUri.substring(0, 20))) {
          console.log('⚠️ Replacement failed, appending image directly')
          message += `\n\n![生成的圖片](${imageDataUri})`
        }
      }
      // 如果消息中没有图片，添加图片
      else if (!message.includes(imageDataUri.substring(0, 20)) && 
               (!message.includes('![') || !message.includes('生成的圖片'))) {
        console.log('🖼️ Adding missing image data to message')
        const imageMarkdown = `\n\n![生成的圖片](${imageDataUri})`
        message = (message || '') + imageMarkdown
        console.log('✅ Added image data URI to message')
      }
    }
    
    return message;
  }

  // Enhanced local cache management
  const CACHE_KEY = 'chatHistory'
  const CACHE_METADATA_KEY = 'chatHistoryMetadata'
  const CACHE_EXPIRY = 24 * 60 * 60 * 1000 // 24 hours

  // Cache metadata interface
  interface CacheMetadata {
    lastSync: number
    version: string
    userId: string
  }

  // Save to cache with metadata
  const saveChatHistoryToCache = (sessions: ChatHistory[]) => {
    try {
      const metadata: CacheMetadata = {
        lastSync: Date.now(),
        version: '1.0',
        userId: 'test'
      }
      
      localStorage.setItem(CACHE_KEY, JSON.stringify(sessions))
      localStorage.setItem(CACHE_METADATA_KEY, JSON.stringify(metadata))
      console.log('💾 Chat history saved to cache:', sessions.length, 'sessions')
    } catch (error) {
      console.error('❌ Failed to save to cache:', error)
    }
  }

  // Load from cache with validation
  const loadChatHistoryFromCache = (): ChatHistory[] => {
    try {
      const cachedData = localStorage.getItem(CACHE_KEY)
      const metadataString = localStorage.getItem(CACHE_METADATA_KEY)
      
      if (!cachedData || !metadataString) {
        console.log('📭 No cached data found')
        return []
      }

      const metadata: CacheMetadata = JSON.parse(metadataString)
      
      // Check if cache is expired
      if (Date.now() - metadata.lastSync > CACHE_EXPIRY) {
        console.log('⏰ Cache expired, clearing')
        clearCache()
        return []
      }

      const sessions: ChatHistory[] = JSON.parse(cachedData)
      console.log('📁 Loaded from cache:', sessions.length, 'sessions')
      return sessions
      
    } catch (error) {
      console.error('❌ Failed to load from cache:', error)
      clearCache()
      return []
    }
  }

  // Clear cache
  const clearCache = () => {
    localStorage.removeItem(CACHE_KEY)
    localStorage.removeItem(CACHE_METADATA_KEY)
    console.log('🗑️ Cache cleared')
  }

  // Smart sync strategy
  const syncChatHistory = async (): Promise<boolean> => {
    try {
      console.log('🔄 Starting smart sync...')
      
      // Load cached data first
      const cachedSessions = loadChatHistoryFromCache()
      
      // Try to load from server
      const serverLoaded = await loadUserSessionsFromAPI()
      
      if (serverLoaded) {
        // Server data loaded successfully
        console.log('✅ Synced from server')
        return true
      } else {
        // Server failed, use cached data
        if (cachedSessions.length > 0) {
          setChatHistory(cachedSessions)
          console.log('🔄 Using cached data as fallback')
          return true
        } else {
          console.log('📭 No server data and no cache')
          return false
        }
      }
    } catch (error) {
      console.error('❌ Sync failed:', error)
      
      // Fallback to cache
      const cachedSessions = loadChatHistoryFromCache()
      if (cachedSessions.length > 0) {
        setChatHistory(cachedSessions)
        return true
      }
      return false
    }
  }

  // Auto-save to cache whenever chatHistory changes
  useEffect(() => {
    if (chatHistory.length > 0) {
      saveChatHistoryToCache(chatHistory)
    }
  }, [chatHistory])

  // Enhanced load function with smart caching
  const loadChatHistoryEnhanced = () => {
    syncChatHistory()
  }

  // 初始化时检查并恢复所有会话的图片
  const initializeSessionImages = async () => {
    try {
      console.log('🔄 Initializing session images...')
      
      // 检查当前会话是否需要图片恢复
      if (currentChatId && messages.length > 0) {          
        const hasAnyImages = messages.some(msg => 
          msg.content.includes('![') || 
          msg.content.includes('/images/') ||
          msg.content.includes('/api/v1/images/')
        )
        
        // 如果没有图片但有助手消息，尝试恢复图片
        if (!hasAnyImages && messages.some(msg => msg.role === 'assistant')) {
          console.log('🖼️ Current session may be missing images, attempting restore...')
          const restoredMessages = await restoreSessionImages(currentChatId, messages)
          if (restoredMessages.length > 0 && restoredMessages !== messages) {
            setMessages(restoredMessages)
            console.log('✅ Session images restored successfully')
          }
        }
      }
    } catch (error) {
      console.warn('⚠️ Failed to initialize session images:', error)
    }
  }

  // 在组件挂载时执行图片初始化
  useEffect(() => {
    if (currentChatId && messages.length > 0) {
      initializeSessionImages()
    }  }, [currentChatId]) // 只在会话ID变化时触发
  // Update chat history when messages change - 使用防抖優化
  const updateChatHistoryRef = useRef<NodeJS.Timeout | null>(null)
    useEffect(() => {
    // 如果当前聊天是刚加载的历史聊天，跳过时间戳更新
    if (currentChatId && currentChatId === lastLoadedHistoryChatId.current) {
      return
    }
    
    if (currentChatId && messages.length > 0 && !isLoadingHistory) {
      // 清除之前的定時器
      if (updateChatHistoryRef.current) {
        clearTimeout(updateChatHistoryRef.current)
      }
      
      // 使用防抖，避免頻繁更新聊天歷史
      updateChatHistoryRef.current = setTimeout(() => {
        setChatHistory(prev => 
          prev.map(chat => 
            chat.id === currentChatId 
              ? { ...chat, messages: messages, timestamp: new Date().toISOString() }
              : chat
          )
        )
      }, 500) // 500ms 防抖延遲
    }
    
    // 清理函數
    return () => {
      if (updateChatHistoryRef.current) {
        clearTimeout(updateChatHistoryRef.current)
      }
    }
  }, [messages.length, currentChatId, isLoadingHistory]) // 添加 isLoadingHistory 依賴  // 新增状态管理
  const [currentPage, setCurrentPage] = useState<'chat' | 'search' | 'files'>('chat')
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [isSearching, setIsSearching] = useState(false)

  // 使用 FileManager hook
  const { fileStats, fetchFileStats, updateFileStats, setFileStats } = useFileManager(API_BASE_URL, API_KEY)
  // 导入聊天数据功能
  const importChatData = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      
      try {
        const text = await file.text()
        const importedData = JSON.parse(text)
        
        // 验证导入的数据格式
        if (Array.isArray(importedData) && importedData.every(item => 
          item.id && item.title && item.messages && item.timestamp
        )) {
          setChatHistory(prev => [...importedData, ...prev])
          toast.success(`成功导入 ${importedData.length} 个对话记录`)
        } else {
          toast.error('导入文件格式不正确')
        }
      } catch (error) {
        toast.error('导入失败，请检查文件格式')
      }
    }
    input.click()
  }

  // 搜索聊天记录功能
  const searchChatHistory = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([])
      return
    }

    setIsSearching(true)
    try {
      const results: any[] = []
      
      // 搜索聊天历史
      chatHistory.forEach(chat => {
        // 搜索标题
        if (chat.title.toLowerCase().includes(query.toLowerCase())) {
          results.push({
            type: 'chat',
            id: chat.id,
            title: chat.title,
            content: chat.title,
            timestamp: chat.timestamp,
            matches: [{ text: chat.title, type: 'title' }]
          })
        }
        
        // 搜索消息内容
        chat.messages.forEach(message => {
          if (message.content.toLowerCase().includes(query.toLowerCase())) {
            const preview = message.content.length > 100 
              ? message.content.substring(0, 100) + '...'
              : message.content
            
            results.push({
              type: 'message',
              id: `${chat.id}-${message.id}`,
              title: chat.title,
              content: preview,
              role: message.role,
              timestamp: message.timestamp,
              chatId: chat.id,
              matches: [{ text: preview, type: 'content' }]
            })
          }
        })
      })
      
      // 按时间排序
      results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      
      setSearchResults(results.slice(0, 20)) // 限制最多20个结果
    } catch (error) {
      console.error('搜索失败:', error)
      toast.error('搜索失败')
    } finally {
      setIsSearching(false)
    }
  }
  // 组件挂载时获取文件统计
  useEffect(() => {
    if (sidebarOpen) {
      fetchFileStats()
    }
  }, [sidebarOpen])

  // 页面切换时也获取文件统计
  useEffect(() => {
    if (currentPage === 'files') {
      fetchFileStats()
    }
  }, [currentPage])
  return (
    <div className="flex h-screen bg-background">
      {/* 全新 Shadcn UI 风格的 Sidebar */}
      <Sidebar 
        apiStatus={apiStatus}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        chatHistory={chatHistory}
        currentChatId={currentChatId}
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        fileStats={fileStats}
        searchResults={searchResults}
        createNewChat={createNewChat}
        loadChat={loadChat}
        deleteChat={deleteChat}
        testConnection={testConnection}
        clearAllHistory={clearAllHistory}
        importChatData={importChatData}
      />
            
      <MainChatArea
        currentPage={currentPage}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        models={models}
        apiStatus={apiStatus}
        messages={messages}
        isLoading={isLoading && !isLoadingHistory} 
        loadingSessionId={loadingSessionId}
        currentLoadingModel={currentLoadingModel}
        input={input}
        setInput={setInput}
        sendMessage={sendMessage}
        cancelRequest={cancelRequest}
        useAgent={useAgent}
        setUseAgent={setUseAgent}
        enableSearch={enableSearch}
        setEnableSearch={setEnableSearch}
        enableMcp={enableMcp}
        setEnableMcp={setEnableMcp}
        enableMemory={enableMemory}
        setEnableMemory={setEnableMemory}
        enableReflection={enableReflection}
        setEnableReflection={setEnableReflection}
        enableReactMode={enableReactMode}
        setEnableReactMode={setEnableReactMode}
        disableHistory={disableHistory}
        setDisableHistory={setDisableHistory}
        compactMode={compactMode}
        setCompactMode={setCompactMode}
        showTimestamps={showTimestamps}
        setShowTimestamps={setShowTimestamps}
        showModelInfo={showModelInfo}
        setShowModelInfo={setShowModelInfo}
        showPerformanceMetrics={showPerformanceMetrics}
        setShowPerformanceMetrics={setShowPerformanceMetrics}
        rawResponses={rawResponses}
        setRawResponses={setRawResponses}
        currentChatId={currentChatId}
        setCurrentChatId={setCurrentChatId}
        expandedJson={expandedJson}
        setExpandedJson={setExpandedJson}
        showReasoningSteps={showReasoningSteps}
        setShowReasoningSteps={setShowReasoningSteps}
        showExecutionTrace={showExecutionTrace}
        setShowExecutionTrace={setShowExecutionTrace}
        showAgentDetails={showAgentDetails}
        setShowAgentDetails={setShowAgentDetails}
        showToolDetails={showToolDetails}
        setShowToolDetails={setShowToolDetails}
        fileStats={fileStats}
        setFileStats={setFileStats}
        searchResults={searchResults}
        setSearchResults={setSearchResults}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        isSearching={isSearching}
        searchChatHistory={searchChatHistory}
        chatHistory={chatHistory}
        loadChat={loadChat}
        setCurrentPage={setCurrentPage}
        copyMessage={copyMessage}
        scrollToBottom={scrollToBottom}
        showScrollToBottom={showScrollToBottom}
        isAtBottom={isAtBottom}
        messagesEndRef={messagesEndRef}
        scrollContainerRef={scrollContainerRef}
        textareaRef={textareaRef}
        handleKeyDown={handleKeyDown}
        handleCompositionStart={handleCompositionStart}
        handleCompositionUpdate={handleCompositionUpdate}
        handleCompositionEnd={handleCompositionEnd}
        MessageErrorBoundary={MessageErrorBoundary}
        TooltipButton={TooltipButton}
        SettingsMenuItem={SettingsMenuItem}
        ImageComponent={ImageComponent}
        groupModelsByProvider={groupModelsByProvider}
        getModelDeveloperIcon={getModelDeveloperIcon}
        getProviderIcon={getProviderIcon}
        getProviderDisplayName={getProviderDisplayName}
        API_BASE_URL={API_BASE_URL}
        agentStatus={agentStatus}
        API_KEY={API_KEY}
      />
</div>
  )
}

// Error Boundary Component for individual messages
const MessageErrorBoundary = ({ children, messageId }: { children: React.ReactNode, messageId: string }) => {
  const [hasError, setHasError] = useState(false)
  
  useEffect(() => {
    setHasError(false)
  }, [messageId])
  
  if (hasError) {
    return (
      <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-center">
        <div className="text-destructive text-sm">
          ❌ 消息渲染出錯
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          className="mt-2"
          onClick={() => setHasError(false)}
        >
          重試
        </Button>
      </div>
    )
  }
  
  try {
    return <>{children}</>
  } catch (error) {
    console.error('Message render error:', error)
    setHasError(true)
    return null
  }
}

// 全局圖片緩存
const globalImageCache = new Map<string, string>();
const pendingImageProcesses = new Set<string>();

// 預處理圖片URL以獲取標準化的URL
const preprocessImageUrl = (src: string): string | null => {
  if (!src || src.trim() === '' || src === '#' || src === 'undefined' || src === 'null') {
    return null;
  }
  
  // 檢查是否是attachment相關的佔位符（無效的圖片引用）
  if (src === 'attachment_url' || src === 'attachment' || 
      (src.includes('attachment') && !src.startsWith('data:') && !src.startsWith('http') && !src.startsWith('/api/'))) {
    return null;
  }
  
  // 檢查是否是URL編碼的文本（不是圖片）
  if (src.includes('%') && !src.startsWith('data:') && !src.startsWith('/api/') && !src.startsWith('http')) {
    try {
      const decoded = decodeURIComponent(src);
      if (/[\u4e00-\u9fff]/.test(decoded) || /^[a-zA-Z\s]+$/.test(decoded)) {
        return null;
      }
    } catch (e) {
      return null;
    }
  }
  
  // 檢查是否包含明顯的非圖片內容（中文、英文文本等）
  const textPatterns = [
    /[\u4e00-\u9fff]/, // 中文字符
    /^[a-zA-Z\s]+$/, // 純英文文本
    /在回复中展示/, // 特定文本模式
  ];
  
  for (const pattern of textPatterns) {
    if (pattern.test(src)) {
      return null;
    }
  }
  
  return src;
};

// 處理圖片URL並返回可用的URL
const processImageUrl = (src: string): string => {
  let processedSrc = src;
  
  // 如果已經包含代理前綴，直接使用
  if (processedSrc.startsWith('/api/backend/') || processedSrc.includes('/api/backend/')) {
    return processedSrc;
  }
  
  // 兼容舊格式：處理 /api/v1/images/ 格式的URL
  if (processedSrc.startsWith('/api/v1/images/') || processedSrc.includes('/api/v1/images/')) {
    processedSrc = processedSrc.replace('/api/v1/images/', '/images/');
    if (processedSrc.startsWith('/')) {
      processedSrc = `${API_BASE_URL}${processedSrc}`;
    }
    return processedSrc;
  }
  
  // 處理MongoDB API圖片URL
  if (processedSrc.startsWith('/images/') || processedSrc.includes('/images/')) {
    if (processedSrc.startsWith('/')) {
      processedSrc = `${API_BASE_URL}${processedSrc}`;
    }
    return processedSrc;
  }
  
  // 處理完整的data URI
  if (processedSrc.startsWith('data:image/')) {
    return processedSrc;
  }
  
  // 處理純base64字符串
  if (processedSrc.match(/^[A-Za-z0-9+/]+=*$/) && processedSrc.length > 50) {
    return `data:image/jpeg;base64,${processedSrc}`;
  }
  
  // 處理其他路徑
  if (processedSrc.startsWith('/')) {
    return `${window.location.origin}${processedSrc}`;
  }
  
  return processedSrc;
};

// 優化的圖片組件 - 使用記憶化和懶加載防止頁面滾動時的閃爍
const ImageComponent = React.memo((props: React.ImgHTMLAttributes<HTMLImageElement>): React.ReactElement | null => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>('');
  const imgRef = useRef<HTMLImageElement>(null);
  const imageWrapperRef = useRef<HTMLDivElement>(null);
  const alt = props.alt || '生成的圖片';
  
  // 檢查並預處理圖片URL
  const src = typeof props.src === 'string' ? props.src : '';
  const validSrc = useMemo(() => preprocessImageUrl(src), [src]);
  
  // 使用記憶化的URL處理結果
  const imageSrc = useMemo(() => {
    if (!validSrc) return '';
    
    // 檢查全局緩存
    if (globalImageCache.has(validSrc)) {
      return globalImageCache.get(validSrc)!;
    }
    
    // 處理並緩存圖片URL
    if (!pendingImageProcesses.has(validSrc)) {
      pendingImageProcesses.add(validSrc);
      
      try {
        const processed = processImageUrl(validSrc);
        globalImageCache.set(validSrc, processed);
        pendingImageProcesses.delete(validSrc);
        return processed;
      } catch (err) {
        pendingImageProcesses.delete(validSrc);
        console.error('❌ Error processing image URL:', err);
        return '';
      }
    }
    
    return '';
  }, [validSrc]);
  
  // 使用 Intersection Observer 實現懶加載
  useEffect(() => {
    if (!imageWrapperRef.current || !validSrc || !imageSrc) return;
    
    // 創建 Intersection Observer 以檢測圖片何時進入視口
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && imgRef.current) {
            // 圖片進入視口，設置 src 開始加載
            imgRef.current.src = imageSrc;
            // 停止觀察
            observer.unobserve(entry.target);
          }
        });
      },
      {
        root: document.querySelector('[data-scroll-container="true"]'),
        rootMargin: '300px 0px', // 提前 300px 加載圖片
        threshold: 0.01
      }
    );
    
    // 開始觀察
    observer.observe(imageWrapperRef.current);
    
    // 清理函數
    return () => {
      if (imageWrapperRef.current) {
        observer.unobserve(imageWrapperRef.current);
      }
      observer.disconnect();
    };
  }, [imageSrc, validSrc]);
  
  // 如果URL無效，則不渲染任何內容
  if (!validSrc || !imageSrc) {
    return null;
  }
  
  // 渲染錯誤狀態
  if (error) {
    return (
      <div className="inline-block image-container">
        <div className="bg-muted px-3 py-2 rounded-lg border border-destructive/20 text-center image-error">
          <span className="text-destructive text-sm">🖼️ {error}</span>
        </div>
      </div>
    );
  }
  
  return (
    <div 
      ref={imageWrapperRef}
      className="inline-block max-w-full overflow-hidden relative"
      style={{
        minHeight: loaded ? 'auto' : '200px',
        minWidth: loaded ? 'auto' : '200px',
      }}
    >
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/30 rounded-lg">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}
      <img 
        ref={imgRef}
        alt={alt}
        className={cn(
          "max-w-full h-auto rounded-lg shadow-sm border transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0"
        )}
        loading="lazy"
        onError={(e) => {
          console.error('❌ Image failed to load:', (e.target as HTMLImageElement).src.substring(0, 50));
          setError('圖片載入失敗');
        }}
        onLoad={() => {
          setLoaded(true);
          
          // 圖片載入完成後，如果用戶在底部則保持在底部
          setTimeout(() => {
            const scrollElement = document.querySelector('[data-scroll-container="true"]') as HTMLElement;
            if (scrollElement) {
              const { scrollTop, scrollHeight, clientHeight } = scrollElement;
              const isNearBottom = scrollHeight - scrollTop - clientHeight < 200; // 增加容差範圍
              
              if (isNearBottom) {
                // 使用 scrollTop 直接設定位置，避免動畫導致的閃爍
                scrollElement.scrollTop = scrollElement.scrollHeight;
              }
            }
          }, 50) // 較短的延遲以減少閃爍
        }}
        style={{ 
          maxHeight: '80vh',
          // 使用 CSS 屬性優化圖片顯示
          willChange: 'transform',
          transform: 'translateZ(0)', // 使用 GPU 加速
          backfaceVisibility: 'hidden',
          // 防止圖片載入時的閃爍
          imageRendering: 'auto'
        }}
        // data-placeholder 屬性用於保存原始URL，方便調試
        data-placeholder={src}
      />
    </div>
  );
}, (prevProps, nextProps) => {
  // 比較函數，僅當 src 發生變化時才重新渲染
  return prevProps.src === nextProps.src;
});
