import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Clock, X, Plus, Search, FileText, Bot, PanelLeft, Trash2, ChevronDown, User, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export interface ChatHistory {
  id: string
  title: string
  messages: any[]
  timestamp: string
}

interface SidebarProps {
  apiStatus: 'connected' | 'disconnected' | 'testing'
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  chatHistory: ChatHistory[]
  currentChatId: string
  currentPage: 'chat' | 'search' | 'files'
  setCurrentPage: (page: 'chat' | 'search' | 'files') => void
  fileStats: { total: number, size: number }
  searchResults: any[]
  createNewChat: () => void
  loadChat: (chat: ChatHistory) => void
  deleteChat: (chatId: string) => void
  testConnection: () => void
  clearAllHistory: () => void
  importChatData: () => void
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

export const Sidebar: React.FC<SidebarProps> = ({
  apiStatus,
  sidebarOpen,
  setSidebarOpen,
  chatHistory,
  currentChatId,
  currentPage,
  setCurrentPage,
  fileStats,
  searchResults,
  createNewChat,
  loadChat,
  deleteChat,
  testConnection,
  clearAllHistory,
  importChatData
}) => {
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  
  return (
    <motion.div 
        className={cn(
          "bg-card/50 backdrop-blur-xl border-r border-border/60 flex flex-col shadow-lg",
          "transition-all duration-300 ease-out"
        )}
        initial={false}        animate={{
          width: sidebarOpen ? 260 : 0,
          opacity: sidebarOpen ? 1 : 0
        }}
        style={{ overflow: sidebarOpen ? 'visible' : 'hidden' }}
      >          {/* 1. Logo & 品牌区 */}
        <div className="flex items-center justify-between p-4 border-b border-border/50">
          <motion.div 
            className="flex items-center gap-2.5"
            initial={false}
            animate={{ scale: sidebarOpen ? 1 : 0.8 }}
          >
            <div className="relative">
              <div className="w-7 h-7 bg-gradient-to-br from-primary to-primary/80 rounded-lg flex items-center justify-center shadow-lg">
                <Bot className="w-4 h-4 text-primary-foreground" />
              </div>
              {/* 连接状态指示器 */}
              <div className={cn(
                "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background",
                apiStatus === 'connected' && "bg-green-500",
                apiStatus === 'disconnected' && "bg-red-500",
                apiStatus === 'testing' && "bg-yellow-500 animate-pulse"
              )} />
            </div>
            <div>
              <h1 className="font-bold text-base text-foreground">AI Assistant</h1>
              <p className="text-xs text-muted-foreground">智能助手平台</p>
            </div>
          </motion.div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(false)}
            className="h-7 w-7 hover:bg-accent/50"
          >
            <X className="w-3.5 h-3.5" />
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
            onClick={() => {
              createNewChat()
              setCurrentPage('chat')
            }}
            className="w-full justify-start gap-2.5 bg-primary hover:bg-primary/90 text-primary-foreground h-9 rounded-lg font-medium shadow-sm transition-all duration-200 hover:shadow-md hover:scale-[1.01]"
          >
            <Plus className="w-4 h-4" />
            开始新对话
          </Button>
        </div>        {/* 4. 查询功能 */}
        <div className="px-4 py-0.5">
          <Button
            variant={currentPage === 'search' ? 'secondary' : 'ghost'}
            className="w-full justify-start gap-2.5 h-8 rounded-lg font-medium transition-all duration-200 hover:bg-accent/60"
            onClick={() => {
              setCurrentPage('search')
            }}
          >
            <Search className="w-4 h-4" />
            <span>智能搜索</span>
            {searchResults.length > 0 && (
              <span className="ml-auto text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-md">
                {searchResults.length}
              </span>
            )}
          </Button>
        </div>

        {/* 5. 档案库 */}
        <div className="px-4 py-0.5">
          <Button
            variant={currentPage === 'files' ? 'secondary' : 'ghost'}
            className="w-full justify-start gap-2.5 h-8 rounded-lg font-medium transition-all duration-200 hover:bg-accent/60"
            onClick={() => {
              setCurrentPage('files')
            }}
          >
            <FileText className="w-4 h-4" />
            <span>档案库</span>
            {fileStats.total > 0 && (
              <span className="ml-auto text-xs bg-purple-500/20 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded-md">
                {fileStats.total}
              </span>
            )}
          </Button>
        </div>

        <div className="mx-4 my-2 h-px bg-border/60" />        
        {/* 6. 对话纪录 */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <div className="px-4 py-1.5 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
              <Clock className="w-3.5 h-3.5" />
              对话纪录
            </h3>
            {chatHistory.length > 0 && (
              <span className="text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-md">
                {chatHistory.length}
              </span>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto px-4 pb-2 space-y-1">
            <AnimatePresence>
              {groupChatsByTime(chatHistory).map((group) => (
                <motion.div 
                  key={group.title} 
                  className="space-y-1"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <div className="text-xs text-muted-foreground font-medium px-2 py-1 sticky top-0 bg-card/80 backdrop-blur-sm rounded-md">
                    {group.title}
                  </div>
                  <div className="space-y-0.5">
                    {group.chats.map((chat) => (
                      <motion.div
                        key={chat.id}
                        className={cn(
                          "group relative flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all duration-200 text-sm hover:bg-accent/60",
                          currentChatId === chat.id && "bg-accent shadow-sm ring-1 ring-border/50"
                        )}
                        onClick={() => {loadChat(chat); setCurrentPage('chat');}}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="truncate font-medium text-foreground mb-0.5">{chat.title}</div>
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
                          className="opacity-0 group-hover:opacity-100 h-6 w-6 shrink-0 hover:bg-destructive/20 hover:text-destructive transition-all duration-200"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>            
            {chatHistory.length === 0 && (
              <motion.div 
                className="text-center py-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <div className="w-10 h-10 bg-muted/50 rounded-lg mx-auto mb-2 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">暂无对话记录</p>
                <p className="text-xs text-muted-foreground/60 mt-1">开始新对话来创建记录</p>
              </motion.div>
            )}
          </div>
        </div>        

        {/* 7. 用户区域 */}
        <div className="p-2">
          <div className="mx-4 mb-2 h-px bg-border/60" />
          <DropdownMenu open={userMenuOpen} onOpenChange={setUserMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-start gap-2.5 h-11 px-3 hover:bg-accent/60 rounded-lg transition-all duration-200"
              >
                <div className="relative">
                  <div className="w-7 h-7 bg-gradient-to-br from-primary to-primary/70 rounded-lg flex items-center justify-center shadow-lg">
                    <User className="w-3.5 h-3.5 text-primary-foreground" />
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-background flex items-center justify-center">
                    <div className="w-0.5 h-0.5 bg-white rounded-full" />
                  </div>
                </div>
                <div className="flex-1 text-left">
                  <div className="font-semibold text-sm text-foreground">用户</div>
                  <div className="text-xs text-muted-foreground">
                    <span>未登录</span>
                  </div>
                </div>
                <ChevronDown className={cn(
                  "w-4 h-4 text-muted-foreground transition-transform duration-200",
                  userMenuOpen && "rotate-180"
                )} />
              </Button>
            </DropdownMenuTrigger>
              <DropdownMenuContent 
              className="w-48 p-2 bg-card/95 backdrop-blur-xl border-border/60 shadow-xl" 
              align="end" 
              side="top"
              sideOffset={8}
            >
              {/* 认证功能 */}
              <div className="px-2 py-1 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                账户
              </div>
              <DropdownMenuItem className="flex items-center gap-3 cursor-pointer h-8 rounded-md px-2 hover:bg-accent/60">
                <User className="w-3.5 h-3.5" />
                <span>登录</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="flex items-center gap-3 cursor-pointer h-8 rounded-md px-2 hover:bg-destructive/20 hover:text-destructive">
                <LogOut className="w-3.5 h-3.5" />
                <span>登出</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </motion.div>
  )
}