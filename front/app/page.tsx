'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { Send, Plus, User, Bot, Copy, PanelLeft, ChevronDown, ArrowUp, ArrowDown, Trash2, Code } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { ThemeToggle } from '@/components/theme-toggle'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// API 基礎 URL - 指向后端API服务器
const API_BASE_URL = 'http://127.0.0.1:8000'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
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

export default function ModernChatGPT() {  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [selectedModel, setSelectedModel] = useState('gemini-2.0-flash-lite')
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
  const [expandedJson, setExpandedJson] = useState<{[messageId: string]: boolean}>({})  // Auto-scroll and scroll detection
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // 使用防抖函数处理滚动检测，减少不必要的状态更新
  const debouncedCheckScrollPosition = useCallback(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      
      timeoutId = setTimeout(() => {
        if (scrollContainerRef.current) {
          const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current
          const isNearBottom = scrollHeight - scrollTop - clientHeight < 100
          setIsAtBottom(isNearBottom)
          setShowScrollToBottom(!isNearBottom && messages.length > 0)
        }
        timeoutId = null;
      }, 100); // 100ms防抖延迟
    };
  }, [messages.length]);

  // 使用useRef保存防抖函数，避免每次渲染都创建新的函数
  const checkScrollPositionRef = useRef(debouncedCheckScrollPosition());
  
  useEffect(() => {
    // 更新防抖函数引用
    checkScrollPositionRef.current = debouncedCheckScrollPosition();
  }, [debouncedCheckScrollPosition]);

  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom()
    }
  }, [messages, isAtBottom, scrollToBottom])

  useEffect(() => {
    const scrollElement = scrollContainerRef.current
    if (scrollElement) {
      // 使用passive: true优化滚动性能
      scrollElement.addEventListener('scroll', checkScrollPositionRef.current, { passive: true })
      return () => scrollElement.removeEventListener('scroll', checkScrollPositionRef.current)
    }
  }, [])

  // Auto-scroll to bottom when new messages arrive, but only if already at bottom
  useEffect(() => {
    if (isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    } else {
      // 如果不在底部，显示滚动到底部按钮
      setShowScrollToBottom(messages.length > 0)
    }
  }, [messages, isAtBottom])  // Load models on component mount
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

  // Update chat history when messages change
  useEffect(() => {
    if (currentChatId && messages.length > 0) {
      setChatHistory(prev => 
        prev.map(chat => 
          chat.id === currentChatId 
            ? { ...chat, messages: messages, timestamp: new Date().toISOString() }
            : chat
        )
      )
    }
  }, [messages, currentChatId])
  const fetchModels = async () => {
    try {
      console.log('🔄 Fetching models from API...')
      setApiStatus('testing')
      
      const response = await fetch(`${API_BASE_URL}/api/v1/models`, {
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
    
    console.log('🆕 Ready for new chat session (will create on first message)')
    toast.success('准备开始新对话')
  }
  const loadChat = async (chat: ChatHistory) => {
    // 设置当前会话ID
    setCurrentChatId(chat.id)
    
    // 优先尝试从服务器加载最新数据
    try {
      await loadSessionDetail(chat.id)
      console.log('✅ Session loaded from server')
    } catch (error) {
      // 如果服务器加载失败，使用本地缓存
      console.warn('⚠️ Failed to load from server, using local cache')
      setMessages(chat.messages)
    }
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
        setCurrentChatId('')      }
      toast.success('对话已删除')
    }
  }
  
  const sendMessage = async () => {
    if (!input.trim() || isLoading) return

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
      }const endpoint = useAgent 
        ? `${API_BASE_URL}/api/v1/agent/`
        : `${API_BASE_URL}/api/v1/chat/completions`

      console.log('🎯 API endpoint:', endpoint)
      console.log('🔧 useAgent state:', useAgent)
      
      // Build request body using enhanced builder with session support
      const body = await buildRequestBodyWithSession([...messages, userMessage], sessionId)// Make API request with retry logic
      const data = await makeApiRequest(endpoint, body)
      
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
      setTimeout(() => {        try {
          const assistantContent = parseApiResponse(data, useAgent)
          
          // 确保 assistantContent 是字符串
          const finalContent = typeof assistantContent === 'string' 
            ? assistantContent 
            : JSON.stringify(assistantContent)
          
          // 更新消息内容
          setMessages(prev => prev.map(msg => 
            msg.id === assistantMessage.id 
              ? { ...msg, content: finalContent }
              : msg
          ))
          
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
        }
      }, 10) // 10ms延迟，让UI先更新
        // 设置当前会话ID（如果是新会话）
      if (!currentChatId) {
        setCurrentChatId(sessionId)
      }

      console.log('✅ Message sent successfully to session:', sessionId)
      toast.success(`${useAgent ? 'Agent' : '聊天'}響應已收到`)
      
    } catch (error) {
      console.error('❌ Error sending message:', error)
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `❌ 錯誤: ${error instanceof Error ? error.message : '發生未知錯誤'}\n\n🔧 診斷信息：\n• 後端服務: ${API_BASE_URL}\n• API 模式: ${useAgent ? 'Agent' : 'Chat'}\n• 所選模型: ${selectedModel}\n• API 密鑰: ${API_KEY}\n\n📋 請檢查：\n1. 後端服務是否在 ${API_BASE_URL} 運行\n2. API 端點是否正確配置\n3. 模型是否可用\n4. 網絡連接是否正常\n\n💡 提示: 您可以點擊側邊欄的"測試"按鈕檢查連接狀態`,
        timestamp: new Date().toISOString()
      }
      setMessages(prev => [...prev, errorMessage])
      toast.error(`發送${useAgent ? 'Agent' : '聊天'}請求失敗`)
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
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
      const modelsResponse = await fetch(`${API_BASE_URL}/api/v1/models`, {
        headers: {
          'X-API-KEY': API_KEY,
          'accept': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
      })
      
      console.log(`📊 Models test response: ${modelsResponse.status} ${modelsResponse.statusText}`)
      
      if (modelsResponse.ok) {
        // Test health endpoint instead of sending actual chat request
        const healthResponse = await fetch(`${API_BASE_URL}/health`, {
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
  const REQUEST_TIMEOUT = 30000 // 30 seconds

  // Create abort controller for request cancellation
  const abortControllerRef = useRef<AbortController | null>(null)

  // 会话图片恢复函数
  const restoreSessionImages = async (sessionId: string, messages: Message[]): Promise<Message[]> => {
    try {
      console.log('🔄 Restoring images for session:', sessionId)
      
      // 获取会话的所有图片
      const response = await fetch(`${API_BASE_URL}/api/v1/session/${sessionId}/images`, {
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
            // 检查消息是否已经包含图片
            const hasImage = message.content.includes('![') || message.content.includes('/api/v1/images/')
            
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
      const response = await fetch(`${API_BASE_URL}/api/v1/sessions`, {
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
      const response = await fetch(`${API_BASE_URL}/api/v1/sessions/test?limit=20`, {
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
  const loadSessionDetail = async (sessionId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/sessions/test/${sessionId}`, {
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
          const imageResponse = await fetch(`${API_BASE_URL}/api/v1/session/${sessionId}/images`, {
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
        }

        // 重建 rawResponses 数据
        const restoredRawResponses: {[messageId: string]: any} = {}
        let imageIndex = 0 // 用于跟踪图片索引，按顺序分配给有图片的助手消息
        
        sessionMessages.forEach((message: Message) => {
          if (message.role === 'assistant' && message.content) {
            // 检查消息内容是否包含图片引用
            if (message.content.includes('/api/v1/images/')) {
              // 从消息内容中提取图片URL
              const imageUrlMatch = message.content.match(/!\[.*?\]\((\/api\/v1\/images\/[^)]+)\)/)
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
              }
            }
          }
        })
        setRawResponses(restoredRawResponses)
        console.log('📦 Restored rawResponses:', Object.keys(restoredRawResponses).length, 'entries')
        
        setMessages(sessionMessages)
        setCurrentChatId(sessionId)
        return true
      }
      
    } catch (error) {
      console.error('❌ Error loading session detail:', error)
      // 如果失败，尝试从本地历史加载
      const localChat = chatHistory.find(chat => chat.id === sessionId)
      if (localChat) {
        setMessages(localChat.messages)
        setCurrentChatId(sessionId)
        console.log('🔄 Loaded from local cache:', sessionId)
        return true
      }
      return false
    }
  }

  const deleteSessionFromServer = async (sessionId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/sessions/test/${sessionId}`, {
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
      const response = await fetch(`${API_BASE_URL}/api/v1/sessions/test`, {
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
        enable_memory: true,
        enable_reflection: true,
        enable_react_mode: true,
        enable_mcp: enableMcp,
        language: 'zh-CN'
      }
      console.log('🤖 Agent API request body:', agentBody)
      return agentBody
    } else {
      // Chat API 格式 - 需要 messages 字段
      const chatBody = {
        messages: messages,
        model: selectedModel,
        user_id: "test",
        session_id: finalSessionId,
        tools: enableMcp ? undefined : [],
        enable_search: enableSearch,
        language: 'zh-CN',
        disable_history: disableHistory
      }
      console.log('💬 Chat API request body:', chatBody)
      return chatBody
    }
  }

  // Cancel ongoing request
  const cancelRequest = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      setIsLoading(false)
      toast.info('請求已取消')
    }
  }

  // 会话管理API调用函数
  const createNewSessionAPI = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/sessions`, {
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
      const response = await fetch(`${API_BASE_URL}/api/v1/sessions/test/${sessionId}`, {
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
    }  }

  // Enhanced API request function with retry logic
  const makeApiRequest = async (endpoint: string, body: any, retries = 2): Promise<any> => {
    // Cancel previous request if still pending
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController()
    const timeoutId = setTimeout(() => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }, REQUEST_TIMEOUT)

    try {
      console.log(`🚀 Making API request to: ${endpoint}`)
      console.log(`🔄 Attempt: ${3 - retries}/3`)
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
        signal: abortControllerRef.current.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`❌ API Error Response (${response.status}):`, errorText)
        throw new Error(`API请求失败: ${response.status} - ${errorText}`)
      }

      const data = await response.json()
      console.log('✅ API Response received:', data)
      return data

    } catch (error: any) {
      clearTimeout(timeoutId)
      
      if (error.name === 'AbortError') {
        console.log('🛑 Request was cancelled')
        throw new Error('请求已取消')
      }

      console.error(`❌ API request failed (attempt ${3 - retries}/3):`, error)

      if (retries > 0 && !error.message.includes('please try again later')) {
        console.log(`🔄 Retrying in ${(3 - retries) * 1000}ms...`)
        await new Promise(resolve => setTimeout(resolve, (3 - retries) * 1000))
        return makeApiRequest(endpoint, body, retries - 1)
      }      throw error
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
        console.log('� Found local image URL:', data.local_image_url)
        const localImageUrl = `${API_BASE_URL}${data.local_image_url}`
        
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
    // 如果image_data_uri是MongoDB URL格式（如 /api/v1/images/{id}）
    if (imageDataUri.startsWith('/api/v1/images/')) {
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
          msg.content.includes('![') || msg.content.includes('/api/v1/images/')
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
    }
  }, [currentChatId]) // 只在会话ID变化时触发

  // Update chat history when messages change
  useEffect(() => {
    if (currentChatId && messages.length > 0) {
      setChatHistory(prev => 
        prev.map(chat => 
          chat.id === currentChatId 
            ? { ...chat, messages: messages, timestamp: new Date().toISOString() }
            : chat
        )
      )
    }
  }, [messages, currentChatId])

  return (
    <div className="flex h-screen bg-background">
      {/* Modern Sidebar with Morphic-style design */}
      <div className={cn(
        "transition-all duration-300 ease-linear bg-muted/30 border-r border-border flex flex-col",
        sidebarOpen ? "w-64" : "w-0 overflow-hidden"
      )}>        {/* Sidebar Header */}
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
          <div className="text-xs text-muted-foreground mb-3 px-2">最近对话</div>
          <div className="space-y-1">
            {chatHistory.map((chat) => (
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
                    {new Date(chat.timestamp).toLocaleString('zh-CN', {
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
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Settings Panel */}
        <div className="p-3 border-t border-border">
          <div className="space-y-4">
            {/* Model Selection */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">模型</Label>
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger className="h-8 text-xs bg-background border-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {models.map((model) => (
                    <SelectItem key={model.id} value={model.id} className="text-xs">
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {/* Settings Toggles */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Agent模式</Label>
                <Switch
                  checked={useAgent}
                  onCheckedChange={setUseAgent}
                  className="scale-75"
                />
              </div>
              
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">搜索功能</Label>
                <Switch
                  checked={enableSearch}
                  onCheckedChange={setEnableSearch}
                  className="scale-75"
                />
              </div>
              
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">MCP工具</Label>
                <Switch
                  checked={enableMcp}
                  onCheckedChange={setEnableMcp}
                  className="scale-75"
                />
              </div>

              {useAgent && (
                <>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">记忆功能</Label>
                    <Switch
                      checked={enableMemory}
                      onCheckedChange={setEnableMemory}
                      className="scale-75"
                    />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">反思模式</Label>
                    <Switch
                      checked={enableReflection}
                      onCheckedChange={setEnableReflection}
                      className="scale-75"
                    />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">React模式</Label>
                    <Switch
                      checked={enableReactMode}
                      onCheckedChange={setEnableReactMode}
                      className="scale-75"
                    />
                  </div>
                </>
              )}

              {!useAgent && (
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">禁用历史</Label>
                  <Switch
                    checked={disableHistory}
                    onCheckedChange={setDisableHistory}
                    className="scale-75"
                  />
                </div>              )}
            </div>
              {/* Action Buttons */}
            <div className="pt-3 border-t border-border space-y-2">              <Button
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
              
              {/* Debug Info */}
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
                  <div><strong>功能狀態:</strong></div>
                  <div className="ml-2">
                    • 搜索: {enableSearch ? '✓' : '✗'}<br/>
                    • MCP: {enableMcp ? '✓' : '✗'}<br/>
                    {useAgent && (
                      <>
                        • 記憶: {enableMemory ? '✓' : '✗'}<br/>
                        • 反思: {enableReflection ? '✓' : '✗'}<br/>
                        • React: {enableReactMode ? '✓' : '✗'}
                      </>
                    )}
                    {!useAgent && (
                      <>• 禁用歷史: {disableHistory ? '✓' : '✗'}</>
                    )}
                  </div>
                </div>
              </details>
            </div>
          </div>
        </div>
      </div>{/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="h-14 border-b border-border flex items-center justify-between px-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen(true)}
                className="h-8 w-8"
              >
                <PanelLeft className="w-4 h-4" />              </Button>
            )}
            
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">AI Assistant</h1>              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  apiStatus === 'connected' && "bg-green-500",
                  apiStatus === 'disconnected' && "bg-red-500",
                  apiStatus === 'testing' && "bg-yellow-500 animate-pulse"
                )} />
                <span>
                  {apiStatus === 'connected' && '已連接'}
                  {apiStatus === 'disconnected' && '未連接'}
                  {apiStatus === 'testing' && '連接中...'}
                </span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </div>

        {/* Messages Area */}
        <div 
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto"
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
            <div className="max-w-4xl mx-auto px-4">              {messages.map((message) => (
                <MessageErrorBoundary key={message.id} messageId={message.id}>
                  <div className="group py-6 border-b border-border/50 last:border-0">
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
                      <div className="text-sm font-medium text-foreground">
                        {message.role === 'user' ? '你' : 'AI助手'}                      </div>                      <div className="prose prose-sm max-w-none dark:prose-invert">                        <ReactMarkdown 
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeRaw]}                          urlTransform={(url) => {
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
                                // 如果是相对路径，转换为完整URL
                                else if (imageUri.startsWith('/api/v1/images/')) {
                                  return `${API_BASE_URL}${imageUri}`
                                }
                                // 如果是data URI，直接返回
                                else if (imageUri.startsWith('data:')) {
                                  return imageUri
                                }
                                else {
                                  return imageUri
                                }
                              } else {
                                console.warn('⚠️ No image data URI found for message:', message.id)
                                console.warn('📦 Available rawResponses keys:', Object.keys(rawResponses))
                                console.warn('🔍 Message content preview:', message.content?.substring(0, 100))
                                // 返回空字符串而不是空的 attachment，这样可以避免显示破损的图片
                                return ''
                              }
                            }
                            
                            // 如果是API图片URL，转换为完整URL
                            if (url.startsWith('/api/v1/images/')) {
                              console.log('🔄 Converting API image URL to full URL:', url)
                              return `${API_BASE_URL}${url}`
                            }
                            
                            return url
                          }}
                          components={{                            img: (props) => {
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
                                  <div className="text-foreground leading-relaxed whitespace-pre-wrap mb-2">
                                    {children}
                                  </div>
                                )
                              }
                              
                              return (
                                <p className="text-foreground leading-relaxed whitespace-pre-wrap mb-2">
                                  {children}
                                </p>
                              )
                            },
                            code: ({ children, className, ...props }) => {
                              const isInline = !className
                              return isInline ? (
                                <code className="bg-muted px-1 py-0.5 rounded text-sm font-mono" {...props}>
                                  {children}
                                </code>
                              ) : (
                                <code className="block bg-muted p-3 rounded-lg text-sm font-mono overflow-x-auto" {...props}>
                                  {children}
                                </code>
                              )
                            }
                          }}                        >
                          {typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}
                        </ReactMarkdown>
                      </div>
                        {/* Message Actions */}
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
                        <span className="text-xs text-muted-foreground">
                          {new Date(message.timestamp).toLocaleTimeString('zh-CN', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                        {/* 原始JSON响应显示 */}
                      {message.role === 'assistant' && rawResponses[message.id] && expandedJson[message.id] && (
                        <div className="mt-3 p-3 bg-muted/50 rounded-lg border">                          <div className="flex items-center gap-2 mb-2">
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
              
              {/* Loading State */}
              {isLoading && (
                <div className="py-6">
                  <div className="flex gap-4">
                    <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center border">
                      <Bot className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="text-sm font-medium text-foreground">AI助手</div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"></div>
                          <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:0.1s]"></div>
                          <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:0.2s]"></div>
                        </div>
                        <span className="text-sm text-muted-foreground">正在思考...</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>        {/* Input Area */}
        <div className="border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="max-w-4xl mx-auto p-4">
            {/* Scroll to bottom button */}            <div className={`
              fixed bottom-24 left-1/2 transform -translate-x-1/2 z-50
              transition-all duration-500 ease-in-out
              ${showScrollToBottom 
                ? 'opacity-100 translate-y-0 pointer-events-auto' 
                : 'opacity-0 translate-y-4 pointer-events-none'
              }
            `}>
              <Button
                onClick={scrollToBottom}
                className="
                  flex items-center gap-2 px-4 py-2 h-10
                  bg-background/80 backdrop-blur-md 
                  border border-border/50 
                  rounded-full shadow-lg hover:shadow-xl 
                  transition-all duration-300 ease-out
                  hover:bg-background/90 hover:scale-105
                  text-foreground hover:text-foreground
                  font-medium text-sm
                "
                variant="ghost"
              >
                <ArrowDown className="w-4 h-4" />
                <span>回到底部</span>
              </Button>
            </div>

            <div className="relative">
              {/* Modern input area with Morphic-style rounded design */}
              <div className="relative flex w-full bg-muted/30 rounded-3xl border border-input shadow-sm">                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onCompositionStart={handleCompositionStart}
                  onCompositionUpdate={handleCompositionUpdate}
                  onCompositionEnd={handleCompositionEnd}
                  placeholder="发送消息..."
                  className="w-full min-h-12 max-h-32 px-4 py-3 pr-12 bg-transparent border-none resize-none focus-visible:outline-none placeholder:text-muted-foreground text-foreground rounded-3xl"
                  disabled={isLoading}
                  rows={1}/>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                  {isLoading && (
                    <Button
                      onClick={cancelRequest}
                      variant="outline"
                      className="h-8 w-8 rounded-full bg-background border-border"
                      size="icon"
                    >
                      <span className="text-xs">✕</span>
                    </Button>
                  )}
                  <Button
                    onClick={sendMessage}
                    disabled={!input.trim() || isLoading}
                    className={cn(
                      "h-8 w-8 rounded-full transition-all",
                      isLoading && "opacity-50 cursor-not-allowed"
                    )}
                    size="icon"
                  >
                    {isLoading ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
              {/* Status Bar */}
            <div className="flex items-center justify-center mt-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>{useAgent ? 'Agent模式' : 'Chat模式'}</span>
                <span>•</span>
                <span>模型: {selectedModel}</span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    apiStatus === 'connected' && "bg-green-500",
                    apiStatus === 'disconnected' && "bg-red-500",
                    apiStatus === 'testing' && "bg-yellow-500 animate-pulse"
                  )} />
                  {API_BASE_URL.replace('http://', '')}
                </span>
                {isLoading && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                      處理中...
                    </span>
                  </>
                )}
              </div>
            </div>
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

// 圖片組件 - 重新設計，簡化邏輯，專注MongoDB圖片URL處理
const ImageComponent = (props: React.ImgHTMLAttributes<HTMLImageElement>): React.ReactElement | null => {
  const [currentSrc, setCurrentSrc] = useState<string>(typeof props.src === 'string' ? props.src : '');
  const [imageSrc, setImageSrc] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const blobUrlRef = useRef<string | null>(null);
  const staticImageCache = useRef<Record<string, string>>({});
  
  const alt = props.alt || '生成的圖片';
  
  // 当props.src变化时更新currentSrc
  useEffect(() => {
    if (typeof props.src === 'string' && props.src !== currentSrc) {
      setCurrentSrc(props.src);
      
      // 清理之前的blob URL
      if (blobUrlRef.current) {
        try {
          URL.revokeObjectURL(blobUrlRef.current);
          console.log('🧹 Revoked previous blob URL due to src change');
          blobUrlRef.current = null;
        } catch (e) {
          console.error('❌ Failed to revoke previous blob URL:', e);
        }
      }
    }  }, [props.src, currentSrc]);  // 图片处理逻辑
  useEffect(() => {
    // 檢查src是否為空或無效
    if (!currentSrc || currentSrc.trim() === '' || currentSrc === '#' || currentSrc === 'undefined' || currentSrc === 'null') {
      console.warn('Empty or invalid image src detected, skipping processing:', currentSrc);
      setIsLoading(false);
      return;
    }
    
    // 检查是否是attachment相关的占位符（无效的图片引用）
    if (currentSrc === 'attachment_url' || currentSrc === 'attachment' || 
        (currentSrc.includes('attachment') && !currentSrc.startsWith('data:') && !currentSrc.startsWith('http') && !currentSrc.startsWith('/api/'))) {
      console.warn('Invalid attachment placeholder detected, skipping:', currentSrc);
      setIsLoading(false);
      return;
    }
    
    // 检查是否是URL编码的文本（不是图片）
    if (currentSrc.includes('%') && !currentSrc.startsWith('data:') && !currentSrc.startsWith('/api/') && !currentSrc.startsWith('http')) {
      try {
        const decoded = decodeURIComponent(currentSrc);
        console.warn('Detected URL encoded text (not image), skipping:', decoded);
        setIsLoading(false);
        return;
      } catch (e) {
        console.warn('Failed to decode URL encoded string:', currentSrc);
        setIsLoading(false);
        return;
      }
    }
    
    // 检查是否包含明显的非图片内容（中文、英文文本等）
    const textPatterns = [
      /[\u4e00-\u9fff]/, // 中文字符
      /^[a-zA-Z\s]+$/, // 纯英文文本
      /在回复中展示/, // 特定文本模式
    ];
    
    for (const pattern of textPatterns) {
      if (pattern.test(currentSrc)) {
        console.warn('Detected text content (not image), skipping:', currentSrc.substring(0, 50));
        setIsLoading(false);
        return;
      }
    }
    // 检查缓存
    if (staticImageCache.current[currentSrc]) {
      console.log('📋 Using cached processed image URL');
      setImageSrc(staticImageCache.current[currentSrc]);
      setIsLoading(false);
      return;
    }
    
    const processImageAsync = async () => {
      try {
        setIsLoading(true);
        setError('');
        
        let processedSrc = currentSrc;        // 1. 处理MongoDB API图片URL (优先级最高)
        if (processedSrc.startsWith('/api/v1/images/') || processedSrc.includes('/api/v1/images/')) {
          console.log('🔗 Processing MongoDB image URL:', processedSrc.substring(0, 50));
          if (processedSrc.startsWith('/')) {
            // 只有相对路径才需要转换
            processedSrc = `${API_BASE_URL}${processedSrc}`;
          }
          // 如果已经是完整URL，直接使用
          staticImageCache.current[currentSrc] = processedSrc;
          setImageSrc(processedSrc);
          setIsLoading(false);
          return;
        }
        
        // 2. 处理完整的data URI
        if (processedSrc.startsWith('data:image/')) {
          console.log('📷 Processing data URI image');
          staticImageCache.current[currentSrc] = processedSrc;
          setImageSrc(processedSrc);
          setIsLoading(false);
          return;
        }
        
        // 3. 处理纯base64字符串
        if (processedSrc.match(/^[A-Za-z0-9+/]+=*$/) && processedSrc.length > 50) {
          console.log('🔄 Converting base64 to data URI');
          processedSrc = `data:image/jpeg;base64,${processedSrc}`;
          staticImageCache.current[currentSrc] = processedSrc;
          setImageSrc(processedSrc);
          setIsLoading(false);
          return;
        }
        
        // 4. 处理其他路径
        if (processedSrc.startsWith('/')) {
          processedSrc = `${window.location.origin}${processedSrc}`;
          staticImageCache.current[currentSrc] = processedSrc;
          setImageSrc(processedSrc);
          setIsLoading(false);
          return;
        }
        
        // 5. 无效格式
        console.warn('⚠️ Unsupported image format:', processedSrc.substring(0, 50));
        setError('不支持的圖片格式');
        setIsLoading(false);
        
      } catch (err) {
        console.error('❌ Error processing image:', err);
        setError('圖片處理失敗');
        setIsLoading(false);
      }
    };
    
    processImageAsync();
    
    // 清理函数
    return () => {
      if (blobUrlRef.current) {
        try {
          URL.revokeObjectURL(blobUrlRef.current);
          console.log('🧹 Blob URL revoked on cleanup');
          blobUrlRef.current = null;
        } catch (e) {
          console.error('❌ Failed to revoke blob URL:', e);
        }
      }
    };  }, [currentSrc]);  // 早期返回检查（必须在所有hooks之后）
  if (!currentSrc || currentSrc.trim() === '' || currentSrc === '#' || currentSrc === 'undefined' || currentSrc === 'null') {
    console.warn('Empty or invalid image src detected, skipping render:', currentSrc);
    return null;
  }
  
  // 检查是否是attachment相关的占位符（无效的图片引用）
  if (currentSrc === 'attachment_url' || currentSrc === 'attachment' || 
      (currentSrc.includes('attachment') && !currentSrc.startsWith('data:') && !currentSrc.startsWith('http') && !currentSrc.startsWith('/api/'))) {
    console.warn('Invalid attachment placeholder detected, skipping render:', currentSrc);
    return null;
  }
  
  // 检查是否是URL编码的文本或纯文本（不是图片）
  if (currentSrc.includes('%') && !currentSrc.startsWith('data:') && !currentSrc.startsWith('/api/') && !currentSrc.startsWith('http')) {
    console.warn('URL encoded text detected, skipping render:', currentSrc);
    return null;
  }
  
  // 检查是否包含中文或明显的文本内容
  if (/[\u4e00-\u9fff]/.test(currentSrc) || /^[a-zA-Z\s]+$/.test(currentSrc)) {
    console.warn('Text content detected, skipping render:', currentSrc.substring(0, 50));
    return null;
  }
  
  // 渲染状态
  if (isLoading) {
    return (
      <span className="inline-block">
        <span className="bg-muted px-3 py-2 rounded-lg border text-center inline-flex items-center gap-2">
          <span className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin"></span>
          <span className="text-sm text-muted-foreground">正在加載圖片...</span>
        </span>
      </span>
    )
  }
  
  if (error) {
    return (
      <span className="inline-block">
        <span className="bg-muted px-3 py-2 rounded-lg border border-destructive/20 text-center">
          <span className="text-destructive text-sm">🖼️ {error}</span>
          <br />
          <span className="text-muted-foreground text-xs">
            原始數據: {currentSrc.substring(0, 30)}...
          </span>
        </span>
      </span>
    )
  }
  
  return (
    <img 
      src={imageSrc} 
      alt={alt} 
      className="max-w-full h-auto rounded-lg shadow-sm border" 
      loading="lazy"
      onError={(e) => {
        const target = e.target as HTMLImageElement;
        console.error('❌ Image failed to load:', target.src.substring(0, 100));
        setError(`圖片加載失敗: ${target.src.startsWith('blob:') ? 'Blob URL錯誤' : '載入失敗'}`);
      }}
      onLoad={() => {
        console.log('✅ Image loaded successfully:', imageSrc.substring(0, 50));
      }}
      style={{ maxHeight: '80vh' }}
    />
  )
}
