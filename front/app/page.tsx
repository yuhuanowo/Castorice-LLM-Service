'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { Send, Plus, User, Bot, Copy, PanelLeft, ChevronDown, ArrowUp, ArrowDown, Trash2, Code, Clock, Zap, Brain, Eye, Search, Wrench, Image, FileText, Loader, CheckCircle, XCircle, AlertCircle, Settings, BookOpen, MoreHorizontal, Minimize2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { ThemeToggle } from '@/components/theme-toggle'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import * as Tooltip from '@radix-ui/react-tooltip'
import * as Separator from '@radix-ui/react-separator'

// API 基礎 URL - 使用相对路径代理到后端
const API_BASE_URL = '/api/backend'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
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

// 时间分组工具函数
const getTimeGroup = (timestamp: string): string => {
  const now = new Date()
  const messageDate = new Date(timestamp)
  const diffInDays = Math.floor((now.getTime() - messageDate.getTime()) / (1000 * 60 * 60 * 24))
  
  if (diffInDays === 0) {
    return '今天'
  } else if (diffInDays === 1) {
    return '昨天'
  } else if (diffInDays <= 7) {
    return '这周'
  } else if (diffInDays <= 30) {
    return '这个月'
  } else if (diffInDays <= 90) {
    return '最近三个月'
  } else {
    return '更早'
  }
}

// 按时间分组聊天历史
const groupChatsByTime = (chats: ChatHistory[]) => {
  const groups: { [key: string]: ChatHistory[] } = {}
  
  chats.forEach(chat => {
    const group = getTimeGroup(chat.timestamp)
    if (!groups[group]) {
      groups[group] = []
    }
    groups[group].push(chat)
  })
  
  // 按优先级排序分组
  const groupOrder = ['今天', '昨天', '这周', '这个月', '最近三个月', '更早']
  return groupOrder.filter(group => groups[group]).map(group => ({
    title: group,
    chats: groups[group].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }))
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
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [selectedModel, setSelectedModel] = useState('gpt-4o-mini')
  const [models, setModels] = useState<Model[]>([])
  const [chatHistory, setChatHistory] = useState<ChatHistory[]>([])
  const [currentChatId, setCurrentChatId] = useState<string>('')
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
  const [agentStatus, setAgentStatus] = useState<{[messageId: string]: {
    currentStep?: string
    totalSteps?: number
    isReflecting?: boolean
    toolsInUse?: string[]
    memoryActive?: boolean
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
  }, [])  // Reset current chat ID if no sessions exist (show empty state)
  useEffect(() => {
    // 如果没有任何会话，清空当前会话ID以显示空白状态
    if (chatHistory.length === 0 && currentChatId) {
      console.log('� No sessions exist, showing empty state')
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
    // 追踪是否是加载历史对话的状态
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  // 使用 ref 追踪最后加载的历史聊天 ID，避免触发 useEffect
  const lastLoadedHistoryChatId = useRef<string | null>(null)  // Update chat history when messages change (but not when loading history)
  useEffect(() => {
    // 如果当前聊天是刚加载的历史聊天，跳过时间戳更新
    if (currentChatId && currentChatId === lastLoadedHistoryChatId.current) {
      return
    }
    
    if (currentChatId && messages.length > 0 && !isLoadingHistory) {
      setChatHistory(prev => 
        prev.map(chat => 
          chat.id === currentChatId 
            ? { ...chat, messages: messages, timestamp: new Date().toISOString() }
            : chat
        )
      )
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
    
    toast.success('准备开始新对话')
  }
  const loadChat = async (chat: ChatHistory) => {
    // 设置当前会话ID
    setCurrentChatId(chat.id)
    
    // 设置加载历史对话标志和记录加载的聊天ID
    setIsLoadingHistory(true)
    lastLoadedHistoryChatId.current = chat.id// 优先尝试从服务器加载最新数据
    try {
      await loadSessionDetail(chat.id, true)
      console.log('✅ Session loaded from server')
    } catch (error) {
      // 如果服务器加载失败，使用本地缓存
      console.warn('⚠️ Failed to load from server, using local cache')
      setMessages(chat.messages)    }
      // 重置加载历史对话标志（使用 setTimeout 确保在消息设置后执行）
    setTimeout(() => {
      setIsLoadingHistory(false)
      // 注意：我们不清除 lastLoadedHistoryChatId.current，让它继续保护这个聊天不被更新时间戳
    }, 100)
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
      timestamp: new Date().toISOString()
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      // 如果没有当前会话ID，先创建新会话
      let sessionId = currentChatId
      let isNewSession = false
      
      if (!sessionId) {
        console.log('🆕 No current session, creating new one...')
        sessionId = await createNewSession()
        setCurrentChatId(sessionId)
        isNewSession = true
        
        // 创建新会话对象并添加到会话历史中
        const newChatHistory: ChatHistory = {
          id: sessionId,
          title: "新对话",
          messages: [],
          timestamp: new Date().toISOString()
        }
        
        setChatHistory(prev => [newChatHistory, ...prev])
        console.log('✅ New session created and added to history:', sessionId)
      } else {
        console.log('📝 Using existing session:', sessionId)
      }
      const endpoint = useAgent 
        ? `/api/agent/`
        : `${API_BASE_URL}/chat/completions`

      console.log('🎯 API endpoint:', endpoint)
      console.log('🔧 useAgent state:', useAgent)
      
      // Build request body using enhanced builder with session support
      const body = await buildRequestBodyWithSession([...messages, userMessage], sessionId)

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
        timestamp: new Date().toISOString()
      }

      // 先显示临时消息，避免等待
      setMessages(prev => [...prev, assistantMessage])

      // 异步处理响应内容
      setTimeout(() => {
        try {
          const assistantContent = parseApiResponse(data, useAgent)
          
          // 确保 assistantContent 是字符串
          const finalContent = typeof assistantContent === 'string' 
            ? assistantContent 
            : JSON.stringify(assistantContent)
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
          
          // 更新消息内容
          setMessages(prev => prev.map(msg => 
            msg.id === assistantMessage.id 
              ? enhancedMessage
              : msg
          ))
          
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
          
        } catch (parseError) {
          console.error('❌ Error parsing response:', parseError)
          setMessages(prev => prev.map(msg => 
            msg.id === assistantMessage.id 
              ? { ...msg, content: '响应解析失败，请查看原始JSON' }
              : msg
          ))
          
          // 更新失败统计
          setLlmStats(prev => ({
            ...prev,
            failureCount: prev.failureCount + 1,
            successRate: ((prev.successRate * (prev.totalCalls - 1))) / prev.totalCalls
          }))
        }
      }, 10) // 10ms延迟，让UI先更新
        // 设置当前会话ID（如果是新会话）
      if (!currentChatId) {
        setCurrentChatId(sessionId)
      }      console.log('✅ Message sent successfully to session:', sessionId)
      
      // 如果是新會話的第一條消息，重新加載會話列表以獲取智能生成的標題
      if (isNewSession || (!currentChatId && sessionId)) {
        console.log('🔄 Reloading sessions to get updated title...')
        setTimeout(async () => {
          try {
            await loadUserSessionsFromAPI()
            console.log('✅ Sessions reloaded with updated titles')
          } catch (error) {
            console.warn('⚠️ Failed to reload sessions after title generation:', error)
          }
        }, 1000) // 1秒延遲，給後端時間生成標題
      }
      
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
        requestBody: await buildRequestBodyWithSession([...messages, userMessage], currentChatId).catch(() => 'Failed to build request body')
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
        error_details: errorDetails // 用於JSON按鈕顯示
      }
      
      setMessages(prev => [...prev, errorMessage])
      
      // 將錯誤詳情存儲到rawResponses中，這樣用戶可以通過JSON按鈕查看
      setRawResponses(prev => ({
        ...prev,
        [errorMessage.id]: errorDetails
      }))
      
      toast.error(`${useAgent ? 'Agent' : '聊天'}請求失敗`)
    } finally {
      setIsLoading(false)
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
  const REQUEST_TIMEOUT = 30000 // 30 seconds for chat mode
  const AGENT_REQUEST_TIMEOUT = 120000 // 120 seconds (2 minutes) for agent mode
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

  // Session management functions
  const createNewSession = async (): Promise<string> => {
    try {
      const response = await fetch(`${API_BASE_URL}/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': API_KEY,
          'accept': 'application/json'
        },
        body: JSON.stringify({
          user_id: "test",
          title: "新对话"
        })
      })

      if (!response.ok) {
        throw new Error(`创建会话失败: ${response.status}`)
      }

      const data = await response.json()
      console.log('✅ New session created:', data.session_id)
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
      const response = await fetch(`${API_BASE_URL}/sessions/test?limit=20`, {
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
  const loadSessionDetail = async (sessionId: string, isHistoryLoad: boolean = false) => {
    try {
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
        let sessionMessages = data.session.messages || []
        console.log('✅ Loaded session detail:', sessionId, sessionMessages.length, 'messages')
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
        
        setMessages(sessionMessages)
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
        
        setMessages(localChat.messages)
        setCurrentChatId(sessionId)
        
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
    // 如果没有提供sessionId，创建新会话
    const finalSessionId = sessionId || await createNewSession()
    
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
  const createNewSessionAPI = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': API_KEY,
        },
        body: JSON.stringify({
          user_id: "test",
          title: "新对话"
        }),
      })

      if (response.ok) {
        const result = await response.json()
        console.log('✅ Session created on server:', result.session_id)
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
            timestamp: msg.timestamp || new Date().toISOString()
          }))
          
          setMessages(sessionMessages)
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
  const makeApiRequest = async (endpoint: string, body: any, retries = 2): Promise<any> => {    // 使用請求管理器來處理請求生命週期
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
      console.log(`🔄 Attempt: ${3 - retries}/3`)
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
      }      const data = await response.json()
      console.log('✅ API Response received:', data)
      
      // 成功完成請求，通知請求管理器
      requestManager.finishRequest()
      return data

    } catch (error: any) {
      clearTimeout(timeoutId)
      
      if (error.name === 'AbortError') {
        console.log('🛑 Request was cancelled')
        // 只有在非重試情況下才完成請求
        if (retries <= 0) {
          requestManager.finishRequest()
        }
        if (isAgentRequest) {
          throw new Error(`Agent处理超时 (${timeout/1000}秒)，可能是因为任务复杂度较高。请稍后重试或简化请求。`)
        } else {
          throw new Error('请求已取消')
        }
      }

      console.error(`❌ API request failed (attempt ${3 - retries}/3):`, error)

      if (retries > 0 && !error.message.includes('please try again later')) {
        console.log(`🔄 Retrying in ${(3 - retries) * 1000}ms...`)
        await new Promise(resolve => setTimeout(resolve, (3 - retries) * 1000))
        // 重試時不完成請求，讓新的請求繼續使用同一個管理器
        return makeApiRequest(endpoint, body, retries - 1)
      }

      // 請求失敗且不重試，完成請求
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
        
        if (data.message) {
          message = data.message
        } else if (data.choices && data.choices[0] && data.choices[0].message) {
          message = data.choices[0].message.content
        } else if (data.response) {
          message = data.response
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
  }, [messages.length, currentChatId, isLoadingHistory]) // 添加 isLoadingHistory 依賴

  return (
    <div className="flex h-screen bg-background">
      {/* Modern Sidebar with Morphic-style design */}
      <div className={cn(
        "transition-all duration-300 ease-linear bg-muted/30 border-r border-border flex flex-col",
        sidebarOpen ? "w-64" : "w-0 overflow-hidden"
      )}>        
      {/* Sidebar Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-primary rounded-md flex items-center justify-center">
              <Bot className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-sm">AI Assistant</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(false)}
            className="h-6 w-6"
          >
            <PanelLeft className="w-4 h-4" />
          </Button>
        </div>

        {/* API Status Indicator */}
        <div className="px-4 py-2 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-2 h-2 rounded-full",
                apiStatus === 'connected' && "bg-green-500",
                apiStatus === 'disconnected' && "bg-red-500",
                apiStatus === 'testing' && "bg-yellow-500 animate-pulse"
              )} />
              <span className="text-xs text-muted-foreground">
                {apiStatus === 'connected' && '已連接'}
                {apiStatus === 'disconnected' && '未連接'}
                {apiStatus === 'testing' && '測試中...'}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={testConnection}
              disabled={apiStatus === 'testing'}
              className="h-6 px-2 text-xs"
            >
              測試
            </Button>
          </div>
        </div>

        {/* New Chat Button */}
        <div className="p-3">
          <Button
            onClick={createNewChat}
            className="w-full justify-start gap-2 bg-background hover:bg-accent text-foreground border border-input rounded-lg h-10 font-normal shadow-sm"
            variant="outline"
          >
            <Plus className="w-4 h-4" />
            新对话
          </Button>
        </div>
          {/* Chat History */}
        <div className="flex-1 overflow-y-auto px-3">
          {groupChatsByTime(chatHistory).map((group) => (
            <div key={group.title} className="mb-6">
              <div className="text-xs text-muted-foreground mb-3 px-2 font-medium sticky top-0 bg-background/95 backdrop-blur-sm py-1">
                {group.title}
              </div>
              <div className="space-y-1">
                {group.chats.map((chat) => (
                  <div
                    key={chat.id}
                    className={cn(
                      "group relative flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors text-sm hover:bg-accent",
                      currentChatId === chat.id && "bg-accent"
                    )}
                    onClick={() => loadChat(chat)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium text-foreground">{chat.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(chat.timestamp).toLocaleString('zh-TW', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteChat(chat.id)
                      }}
                      className="opacity-0 group-hover:opacity-100 h-6 w-6 shrink-0"
                    >                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>        {/* Settings Panel */}
        <div className="p-3 border-t border-border">
          <div className="space-y-4">
              {/* Action Buttons */}
            <div className="space-y-2">              
              <Button
                variant="outline"
                size="sm"
                onClick={clearAllHistory}
                className="w-full h-8 text-xs justify-start gap-2"
              >
                <Trash2 className="w-3 h-3" />
                清除所有對話
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRawResponses({})
                  setExpandedJson({})
                  toast.success('JSON缓存已清理')
                }}
                className="w-full h-8 text-xs justify-start gap-2"
              >
                <Code className="w-3 h-3" />
                清理JSON缓存 ({Object.keys(rawResponses).length})
              </Button>
                {/* Debug Info with Agent Statistics */}
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  調試信息
                </summary>
                <div className="mt-2 p-2 bg-muted/50 rounded text-xs space-y-1">                  
                <div><strong>API地址:</strong> {API_BASE_URL}</div>
                  <div><strong>API密鑰:</strong> {API_KEY}</div>
                  <div><strong>當前模型:</strong> {selectedModel}</div>
                  <div><strong>可用模型:</strong> {models.length}個</div>
                  <div><strong>連接狀態:</strong> {apiStatus}</div>
                  <div><strong>模式:</strong> {useAgent ? 'Agent' : 'Chat'}</div>
                  <div><strong>JSON缓存:</strong> {Object.keys(rawResponses).length}条</div>
                    <div><strong>LLM服务统计:</strong></div>
                  <div className="ml-2 space-y-1">
                    <div>• 总调用次数: {llmStats.totalCalls}</div>
                    <div>• 总Token数: {llmStats.totalTokens.toLocaleString()}</div>
                    <div>• 平均响应时间: {llmStats.avgResponseTime.toFixed(0)}ms</div>
                    <div>• 成功率: {(llmStats.successRate * 100).toFixed(1)}%</div>
                    <div>• 失败次数: {llmStats.failureCount}</div>
                  </div>
                  
                  <div><strong>Agent统计:</strong></div>
                  <div className="ml-2 space-y-1">
                    {(() => {
                      const agentMessages = messages.filter(m => m.mode === 'agent' && m.role === 'assistant')
                      const totalExecutionTime = agentMessages.reduce((sum, m) => sum + (m.execution_time || 0), 0)
                      const totalSteps = agentMessages.reduce((sum, m) => sum + (m.steps_taken || 0), 0)
                      const totalToolUsage = agentMessages.reduce((sum, m) => sum + (m.tools_used?.length || 0), 0)
                      const avgExecutionTime = agentMessages.length > 0 ? totalExecutionTime / agentMessages.length : 0
                      const avgStepsPerMessage = agentMessages.length > 0 ? totalSteps / agentMessages.length : 0
                      const uniqueToolsUsed = Array.from(new Set(
                        agentMessages.flatMap(m => m.tools_used?.map(tool => tool.name) || [])
                      ))
                      
                      return (
                        <>
                          <div>• Agent消息: {agentMessages.length}</div>
                          <div>• 总执行时间: {totalExecutionTime.toFixed(2)}s</div>
                          <div>• 平均执行时间: {avgExecutionTime.toFixed(2)}s</div>
                          <div>• 总执行步骤: {totalSteps}</div>
                          <div>• 平均步骤数: {avgStepsPerMessage.toFixed(1)}</div>
                          <div>• 工具调用次数: {totalToolUsage}</div>
                          <div>• 使用的工具: {uniqueToolsUsed.join(', ') || '无'}</div>
                          <div>• 记忆模式: {enableMemory ? '✓' : '✗'}</div>
                          <div>• 反思模式: {enableReflection ? '✓' : '✗'}</div>
                          <div>• React模式: {enableReactMode ? '✓' : '✗'}</div>
                        </>
                      )
                    })()}
                  </div>
                  
                  <div><strong>功能狀態:</strong></div>
                  <div className="ml-2">
                    • 搜索: {enableSearch ? '✓' : '✗'}<br/>
                    • MCP: {enableMcp ? '✓' : '✗'}<br/>
                    {useAgent && (
                      <>
                        • 記憶: {enableMemory ? '✓' : '✗'}<br/>
                        • 反思: {enableReflection ? '✓' : '✗'}<br/>
                        • React: {enableReactMode ? '✓' : '✗'}<br/>
                      </>
                    )}
                    {!useAgent && (
                      <>• 禁用歷史: {disableHistory ? '✓' : '✗'}</>
                    )}
                    <br/>
                    • 紧凑模式: {compactMode ? '✓' : '✗'}<br/>
                    • 显示时间: {showTimestamps ? '✓' : '✗'}<br/>
                    • 模型信息: {showModelInfo ? '✓' : '✗'}
                  </div>
                </div>
              </details>
            </div>
          </div>
        </div>
      </div>
      {/* Main Chat Area - 移除顶部分隔线 */}
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
                          {providerModels.length}
                        </span>
                      </div>
                    </div>
                    
                    {/* Models - 修复选中外框被裁切的问题 */}
                    <div className="py-1 px-1">
                      {providerModels.map((model) => (
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
                </div>
              </SelectContent>
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
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </div>        {/* Messages Area */}
        <div 
          ref={scrollContainerRef}
          data-scroll-container="true"
          className="flex-1 overflow-y-auto scroll-container"
        >
          {messages.length === 0 ? (
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
                        <div className="mb-3 p-2 bg-muted/30 rounded-lg border border-muted">
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
            </div>          )}
        </div>        
        {/* Input Area - 修复按钮点击和状态栏高度 */}
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
    
    {/* 状态栏 - 减少高度和内边距 */}
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4, duration: 0.4 }}
      className="flex items-center justify-center mt-3"
    >
      <div className="flex items-center gap-3 flex-wrap justify-center bg-gradient-to-r from-muted/30 via-muted/20 to-muted/30 px-4 py-2 rounded-xl border border-border/30 backdrop-blur-lg shadow-lg">
        {/* 模式指示 */}
        <div className="flex items-center gap-2">
          <motion.div
            animate={{
              scale: [1, 1.2, 1],
              backgroundColor: useAgent 
                ? ["hsl(var(--primary))", "hsl(var(--primary))", "hsl(var(--primary))"]
                : ["hsl(214 100% 50%)", "hsl(214 100% 60%)", "hsl(214 100% 50%)"]
            }}
            transition={{ duration: 2, repeat: Infinity }}
            className="w-1.5 h-1.5 rounded-full"
          />
          {useAgent ? (
            <Brain className="w-3 h-3 text-primary" />
          ) : (
            <Bot className="w-3 h-3 text-blue-500" />
          )}
          <span className="font-semibold text-xs">
            {useAgent ? 'Agent模式' : 'Chat模式'}
          </span>
        </div>
        
        <Separator.Root className="w-px h-3 bg-border/50" />
        
        {/* 模型信息 */}
        <span className="font-mono text-xs bg-background/50 px-2 py-0.5 rounded-md">
          {selectedModel}
        </span>
        
        <Separator.Root className="w-px h-3 bg-border/50" />
        
        {/* 连接状态 */}
        <div className="flex items-center gap-1.5">
          <motion.div
            animate={{
              scale: [1, 1.3, 1],
              backgroundColor: 
                apiStatus === 'connected' ? ["hsl(142 100% 50%)", "hsl(142 100% 60%)", "hsl(142 100% 50%)"] :
                apiStatus === 'disconnected' ? ["hsl(0 100% 50%)", "hsl(0 100% 60%)", "hsl(0 100% 50%)"] :
                ["hsl(45 100% 50%)", "hsl(45 100% 60%)", "hsl(45 100% 50%)"]
            }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="w-1.5 h-1.5 rounded-full"
          />
          <span className="font-mono text-xs opacity-75">
            {API_BASE_URL.replace('http://', '')}
          </span>
        </div>
        
        {/* 功能状态 */}
        <AnimatePresence>
          {(enableSearch || enableMcp || enableMemory || enableReflection || enableReactMode) && (
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.3 }}
              className="flex items-center gap-2"
            >
              <Separator.Root className="w-px h-3 bg-border/50" />
              <div className="flex items-center gap-1.5">
                {enableSearch && <Search className="w-3 h-3 text-blue-500" />}
                {enableMcp && <Wrench className="w-3 h-3 text-orange-500" />}
                {useAgent && enableMemory && <Brain className="w-3 h-3 text-green-500" />}
                {useAgent && enableReflection && <AlertCircle className="w-3 h-3 text-purple-500" />}
                {useAgent && enableReactMode && <Zap className="w-3 h-3 text-blue-500" />}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* 加载状态 */}
        <AnimatePresence>
          {isLoading && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-1.5"
            >
              <Separator.Root className="w-px h-3 bg-border/50" />
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                className="w-2.5 h-2.5 border-2 border-blue-500 border-t-transparent rounded-full"
              />
              <span className="font-medium text-xs text-blue-500">
                {useAgent ? 'Agent处理中...' : '处理中...'}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  </div>
</div>

      </div>
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
