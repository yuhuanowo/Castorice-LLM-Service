// 共享類型定義

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  sessionId?: string
  // Agent 模式增強字段
  execution_trace?: ExecutionTraceItem[]
  reasoning_steps?: ReasoningStep[]
  tools_used?: ToolUsage[]
  // 元數據
  model_used?: string
  mode?: 'llm' | 'agent' | 'chat'
  execution_time?: number
  steps_taken?: number
  generated_image?: string
  error_details?: any
}

export interface ExecutionTraceItem {
  step: number
  action: string
  status: 'planning' | 'executing' | 'completed' | 'failed'
  timestamp: string
  details?: any
}

export interface ReasoningStep {
  type: 'thought' | 'action' | 'observation' | 'reflection'
  content: string
  timestamp: string
}

export interface ToolUsage {
  name: string
  result: string
  duration?: number
}

export interface Model {
  id: string
  name: string
  owned_by: string
}

export interface ChatHistory {
  id: string
  title: string
  messages: Message[]
  timestamp: string
}

export interface ReactStep {
  type: 'thought' | 'decision' | 'reflection' | 'action' | 'observation'
  label: string
  complete: boolean
  enabled?: boolean
  toolName?: string
  toolResult?: string | object
  timestamp?: string
}

export interface AgentStatus {
  currentStep?: string
  totalSteps?: number
  isReflecting?: boolean
  toolsInUse?: string[]
  memoryActive?: boolean
  reactPhase?: string
  reactSteps?: ReactStep[]
  currentReactStep?: number
}

export interface FileStats {
  total: number
  size: number
}

// API 相關類型
export type ApiStatus = 'connected' | 'disconnected' | 'testing'
export type PageType = 'chat' | 'files'
// 搜索結果類型
export interface SearchResult {
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

// 上傳文件類型
export interface UploadedFile {
  id: string
  name: string
  size: number
  type: string
  url?: string
  uploadedAt: string
}