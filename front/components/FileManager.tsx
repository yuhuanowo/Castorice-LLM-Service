'use client'

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { 
  Search, FileText, Image, Loader2, Eye, Trash2, 
  Upload, FolderOpen, LayoutGrid, List, Filter, 
  Download, Star, Clock, FileType, X, 
  ZoomIn, ZoomOut, RotateCw, ChevronLeft, ChevronRight, Play,
  Volume2, VolumeX, Pause, Copy, MoreHorizontal, Check,
  HardDrive, Images, FileVideo, FileAudio, FileArchive, FileCode,
  RefreshCw, Maximize2, CloudUpload, AlertCircle, ArrowUpDown
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// 安全的 Blob URL 管理器
class SafeBlobManager {
  private static blobUrls = new Map<string, string>()
  private static cleanupTimeouts = new Map<string, NodeJS.Timeout>()

  static createObjectURL(blob: Blob, key?: string): string {
    try {
      const url = URL.createObjectURL(blob)
      const urlKey = key || url
      
      // 存储 URL 以便后续清理
      this.blobUrls.set(urlKey, url)
      
      // 设置自动清理，防止内存泄漏
      const timeoutId = setTimeout(() => {
        this.revokeObjectURL(urlKey)
      }, 30000) // 30秒后自动清理
      
      this.cleanupTimeouts.set(urlKey, timeoutId)
      
      return url
    } catch (error) {
      console.warn('创建 Blob URL 失败:', error)
      throw error
    }
  }

  static revokeObjectURL(key: string): void {
    try {
      const url = this.blobUrls.get(key)
      if (url) {
        URL.revokeObjectURL(url)
        this.blobUrls.delete(key)
      }
      
      const timeoutId = this.cleanupTimeouts.get(key)
      if (timeoutId) {
        clearTimeout(timeoutId)
        this.cleanupTimeouts.delete(key)
      }
    } catch (error) {
      console.warn('释放 Blob URL 失败:', error)
    }
  }

  static revokeByPattern(pattern: string): void {
    try {
      const keysToRevoke = Array.from(this.blobUrls.keys()).filter(key => 
        key.includes(pattern)
      )
      
      keysToRevoke.forEach(key => this.revokeObjectURL(key))
    } catch (error) {
      console.warn('按模式清理 Blob URL 失败:', error)
    }
  }

  static revokeAll(): void {
    try {
      for (const [key] of this.blobUrls) {
        this.revokeObjectURL(key)
      }
    } catch (error) {
      console.warn('清理所有 Blob URL 失败:', error)
    }
  }

  static getUrl(key: string): string | undefined {
    return this.blobUrls.get(key)
  }

  static getStats(): { total: number; keys: string[] } {
    return {
      total: this.blobUrls.size,
      keys: Array.from(this.blobUrls.keys())
    }
  }
}

// 類型定義
interface FileItem {
  file_id: string
  filename: string
  file_type?: string
  file_size?: number
  upload_time: string
  description?: string
  tags?: string[]
  is_favorite?: boolean
  preview_url?: string
  thumbnail_url?: string
}

interface FileStats {
  total: number
  size: number
  types: Record<string, number>
  recent: number
}

interface FileManagerProps {
  onStatsUpdate: (stats: FileStats) => void
  apiKey: string
  apiBaseUrl: string
}

interface PreviewModalProps {
  file: FileItem | null
  isOpen: boolean
  onClose: () => void
  onNext?: () => void
  onPrev?: () => void
  hasNext?: boolean
  hasPrev?: boolean
  apiBaseUrl: string
  apiKey: string
}

// 檔案類型分類 - 簡潔統一配色
const FILE_TYPES = {
  image: {
    extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'],
    icon: Images,
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    label: '圖片'
  },
  document: {
    extensions: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'],
    icon: FileText,
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    label: '文檔'
  },
  video: {
    extensions: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv'],
    icon: FileVideo,
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    label: '視頻'
  },
  audio: {
    extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'],
    icon: FileAudio,
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    label: '音頻'
  },
  archive: {
    extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'],
    icon: FileArchive,
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    label: '壓縮檔'
  },
  code: {
    extensions: ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'html', 'css', 'scss', 'json', 'xml'],
    icon: FileCode,
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    label: '代碼'
  }
}

// 視圖模式
type ViewMode = 'grid' | 'list'

// 篩選類型
type FilterType = 'all' | 'image' | 'document' | 'video' | 'audio' | 'archive' | 'code'

// 排序類型
type SortType = 'date_desc' | 'date_asc' | 'name_asc' | 'name_desc' | 'size_desc' | 'size_asc'

// 工具函數
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export const getFileCategory = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  
  for (const [category, config] of Object.entries(FILE_TYPES)) {
    if (config.extensions.includes(ext)) {
      return category
    }
  }
  return 'other'
}

export const getFileIcon = (fileType: string, filename?: string) => {
  const category = getFileCategory(filename || fileType)
  const config = FILE_TYPES[category as keyof typeof FILE_TYPES]
  const IconComponent = config?.icon || FileText
  const color = config?.color || 'text-muted-foreground'
  const bgColor = config?.bgColor || 'bg-muted'
  
  return {
    icon: <IconComponent className="w-5 h-5" />,
    color,
    bgColor,
    category: config?.label || '其他',
    IconComponent
  }
}

export const formatTimeAgo = (timestamp: string): string => {
  const now = new Date()
  const time = new Date(timestamp)
  const diffInSeconds = Math.floor((now.getTime() - time.getTime()) / 1000)
  
  if (diffInSeconds < 60) return '剛剛'
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}分鐘前`
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}小時前`
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}天前`
  
  return time.toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })
}

export const isImageFile = (filename: string): boolean => {
  return getFileCategory(filename) === 'image'
}

export const isVideoFile = (filename: string): boolean => {
  return getFileCategory(filename) === 'video'
}

export const isAudioFile = (filename: string): boolean => {
  return getFileCategory(filename) === 'audio'
}

export const isPdfFile = (filename: string): boolean => {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return ext === 'pdf'
}

export const isTextFile = (filename: string): boolean => {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return ['txt', 'md', 'json', 'xml', 'csv', 'log', 'rtf'].includes(ext)
}

export const isWordFile = (filename: string): boolean => {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return ['doc', 'docx', 'odt'].includes(ext)
}

// 檔案管理 Hook
export const useFileManager = (apiBaseUrl: string, apiKey: string) => {
  const [fileStats, setFileStats] = useState<FileStats>({ 
    total: 0, 
    size: 0, 
    types: {}, 
    recent: 0 
  })

  const fetchFileStats = useCallback(async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/files?page_size=1000`, {
        headers: { 
              'X-API-KEY': apiKey,
              'Accept': '*/*'
            },
            mode: 'cors', // 明确指定 CORS 模式
            credentials: 'omit', // 不发送 cookies
      })
      if (response.ok) {
        const files = await response.json()
        const totalSize = files.reduce((sum: number, file: any) => sum + (file.file_size || 0), 0)
        
        // 計算檔案類型統計
        const types: Record<string, number> = {}
        files.forEach((file: any) => {
          const type = getFileCategory(file.file_type || file.filename || '')
          types[type] = (types[type] || 0) + 1
        })
        
        // 計算最近7天上傳的檔案數量
        const recent = files.filter((file: any) => {
          const uploadDate = new Date(file.upload_time)
          const weekAgo = new Date()
          weekAgo.setDate(weekAgo.getDate() - 7)
          return uploadDate > weekAgo
        }).length
        
        setFileStats({ total: files.length, size: totalSize, types, recent })
      }
    } catch (error) {
      console.warn('获取文件统计失败:', error)
    }
  }, [apiBaseUrl, apiKey])

  const updateFileStats = useCallback((stats: FileStats) => {
    setFileStats(stats)
  }, [])

  return {
    fileStats,
    fetchFileStats,
    updateFileStats,
    setFileStats
  }
}

// 簡化的 TooltipButton 組件
const TooltipButton = ({ 
  children, 
  tooltip, 
  onClick, 
  className, 
  variant = "ghost" as const,
  size = "icon" as const,
  disabled = false
}: {
  children: React.ReactNode
  tooltip: string
  onClick?: (e?: React.MouseEvent<HTMLButtonElement>) => void
  className?: string
  variant?: "default" | "secondary" | "ghost" | "outline" | "destructive"
  size?: "sm" | "default" | "lg" | "icon"
  disabled?: boolean
}) => (
  <TooltipProvider delayDuration={200}>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={variant}
          size={size}
          onClick={onClick}
          className={cn("transition-all", className)}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
)

// 增強的圖片預覽組件
const ImagePreview = ({ 
  src, 
  alt, 
  zoom, 
  rotation, 
  onZoomChange, 
  onError, 
  onLoad 
}: {
  src: string
  alt: string
  zoom: number
  rotation: number
  onZoomChange: (zoom: number) => void
  onError: () => void
  onLoad: () => void
}) => {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  
  const handleImageLoad = () => {
    setLoading(false)
    setError(false)
    onLoad()
  }
  
  const handleImageError = () => {
    setLoading(false)
    setError(true)
    onError()
  }
  
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <div className="w-24 h-24 rounded-full bg-red-500/20 flex items-center justify-center">
          <AlertCircle className="w-12 h-12 text-red-400" />
        </div>
        <div className="text-center">
          <h3 className="text-lg font-medium text-white mb-2">圖片載入失敗</h3>
          <p className="text-white/70 text-sm">請檢查檔案是否已損壞或網絡連接</p>
        </div>
      </div>
    )
  }
  
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-white animate-spin" />
            <p className="text-white text-sm">載入圖片中...</p>
          </div>
        </div>
      )}
      
      <motion.img
        src={src}
        alt={alt}
        className="max-w-full max-h-full object-contain select-none"
        style={{
          transform: `scale(${zoom}) rotate(${rotation}deg)`,
          display: loading ? 'none' : 'block'
        }}
        animate={{
          scale: zoom,
          rotate: rotation
        }}
        transition={{ duration: 0.2 }}
        onLoad={handleImageLoad}
        onError={handleImageError}
        draggable={false}
      />
    </div>
  )
}

// PDF 預覽組件
const PdfPreview = ({ 
  src, 
  filename,
  loading,
  error
}: {
  src: string | null
  filename: string
  loading: boolean
  error: boolean
}) => {
  const [iframeLoading, setIframeLoading] = useState(true)
  
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-white animate-spin" />
          <p className="text-white text-sm">載入 PDF 中...</p>
        </div>
      </div>
    )
  }
  
  if (error || !src) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <div className="w-24 h-24 rounded-full bg-red-500/20 flex items-center justify-center">
          <AlertCircle className="w-12 h-12 text-red-400" />
        </div>
        <div className="text-center">
          <h3 className="text-lg font-medium text-white mb-2">PDF 載入失敗</h3>
          <p className="text-white/70 text-sm">請檢查檔案是否已損壞或使用外部 PDF 檢視器</p>
        </div>
      </div>
    )
  }
  
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      {iframeLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-white animate-spin" />
            <p className="text-white text-sm">載入 PDF 中...</p>
          </div>
        </div>
      )}
      
      <iframe
        src={src}
        title={filename}
        className="w-full h-full border-0 rounded-lg"
        onLoad={() => setIframeLoading(false)}
        onError={() => setIframeLoading(false)}
      />
    </div>
  )
}

// 文本預覽組件
const TextPreview = ({ 
  content, 
  filename, 
  loading, 
  error 
}: {
  content: string
  filename: string
  loading: boolean
  error: boolean
}) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [lineNumbers, setLineNumbers] = useState(true)
  const [wordWrap, setWordWrap] = useState(true)
  
  // 根據檔案類型決定語言高亮
  const getLanguage = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'ts': 'typescript',
      'jsx': 'javascript',
      'tsx': 'typescript',
      'py': 'python',
      'json': 'json',
      'xml': 'xml',
      'html': 'html',
      'css': 'css',
      'md': 'markdown'
    }
    return languageMap[ext] || 'text'
  }
  
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-white animate-spin" />
          <p className="text-white text-sm">載入文本中...</p>
        </div>
      </div>
    )
  }
  
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <div className="w-24 h-24 rounded-full bg-red-500/20 flex items-center justify-center">
          <AlertCircle className="w-12 h-12 text-red-400" />
        </div>
        <div className="text-center">
          <h3 className="text-lg font-medium text-white mb-2">文本載入失敗</h3>
          <p className="text-white/70 text-sm">請檢查檔案是否已損壞或網絡連接</p>
        </div>
      </div>
    )
  }
  
  const lines = content.split('\n')
  const filteredLines = searchTerm 
    ? lines.filter((line, index) => 
        line.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (index + 1).toString().includes(searchTerm)
      )
    : lines
  
  return (
    <div className="w-full h-full flex flex-col bg-gray-900/90 backdrop-blur-sm rounded-lg overflow-hidden">
      {/* 工具列 */}
      <div className="bg-gray-800/90 border-b border-gray-700/50 p-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="bg-blue-500/20 text-blue-300 border-blue-500/30">
            {getLanguage(filename).toUpperCase()}
          </Badge>
          <span className="text-white/70 text-sm">
            {lines.length} 行 • {content.length} 字符
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          {/* 搜索框 */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-white/50" />
            <input
              type="text"
              placeholder="搜索..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-7 pr-3 py-1 text-xs bg-gray-700/50 text-white border border-gray-600/50 rounded focus:outline-none focus:border-blue-500/50 w-32"
            />
          </div>
          
          {/* 選項 */}
          <div className="flex items-center gap-2 text-xs">
            <Label className="flex items-center gap-1 text-white/70">
              <Switch
                checked={lineNumbers}
                onCheckedChange={setLineNumbers}
                className="scale-75"
              />
              行號
            </Label>
            <Label className="flex items-center gap-1 text-white/70">
              <Switch
                checked={wordWrap}
                onCheckedChange={setWordWrap}
                className="scale-75"
              />
              自動換行
            </Label>
          </div>
        </div>
      </div>
      
      {/* 內容區域 */}
      <div className="flex-1 overflow-auto p-4 font-mono text-sm">
        <div className="space-y-0">
          {filteredLines.map((line, index) => {
            const originalIndex = searchTerm ? lines.indexOf(line) : index
            return (
              <div
                key={originalIndex}
                className="flex hover:bg-white/5 min-h-6 group"
              >
                {lineNumbers && (
                  <div className="shrink-0 w-12 text-white/40 text-right pr-3 py-0.5 select-none group-hover:text-white/60">
                    {originalIndex + 1}
                  </div>
                )}
                <div 
                  className={cn(
                    "flex-1 text-white/90 py-0.5 px-2",
                    !wordWrap && "whitespace-nowrap",
                    searchTerm && line.toLowerCase().includes(searchTerm.toLowerCase()) && "bg-yellow-500/20"
                  )}
                >
                  {line || ' '}
                </div>
              </div>
            )
          })}
        </div>
        
        {filteredLines.length === 0 && searchTerm && (
          <div className="text-center text-white/50 py-8">
            未找到匹配 &ldquo;{searchTerm}&rdquo; 的內容
          </div>
        )}
      </div>
    </div>
  )
}

// 縮圖生成工具
const ThumbnailGenerator = {
  // 生成圖片縮圖
  generateImageThumbnail: (file: File, maxSize: number = 200): Promise<string> => {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const img = document.createElement('img')
      const urlKey = `thumbnail-img-${Date.now()}-${Math.random()}`
      
      // 设置超时
      const timeoutId = setTimeout(() => {
        cleanup()
        reject(new Error('图片加载超时'))
      }, 5000)
      
      const cleanup = () => {
        clearTimeout(timeoutId)
        SafeBlobManager.revokeObjectURL(urlKey)
      }
      
      img.onload = () => {
        try {
          // 計算縮圖尺寸
          const { width, height } = img
          if (width === 0 || height === 0) {
            cleanup()
            reject(new Error('图片尺寸无效'))
            return
          }
          
          const ratio = Math.min(maxSize / width, maxSize / height)
          const newWidth = Math.max(1, Math.floor(width * ratio))
          const newHeight = Math.max(1, Math.floor(height * ratio))
          
          canvas.width = newWidth
          canvas.height = newHeight
          
          // 繪製縮圖
          if (ctx) {
            // 设置更好的图像渲染质量
            ctx.imageSmoothingEnabled = true
            ctx.imageSmoothingQuality = 'high'
            ctx.fillStyle = '#ffffff' // 白色背景，避免透明度问题
            ctx.fillRect(0, 0, newWidth, newHeight)
            ctx.drawImage(img, 0, 0, newWidth, newHeight)
            
            // 使用更高质量的输出
            const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
            cleanup()
            resolve(dataUrl)
          } else {
            cleanup()
            reject(new Error('无法获取 Canvas 2D 上下文'))
          }
        } catch (error) {
          cleanup()
          reject(error)
        }
      }
      
      img.onerror = (error) => {
        cleanup()
        reject(new Error(`图片加载失败: ${error}`))
      }
      
      try {
        const objectUrl = SafeBlobManager.createObjectURL(file, urlKey)
        img.crossOrigin = 'anonymous' // 处理跨域问题
        img.src = objectUrl
      } catch (error) {
        cleanup()
        reject(new Error(`创建 Object URL 失败: ${error}`))
      }
    })
  },
  
  // 生成視頻縮圖
  generateVideoThumbnail: (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video')
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const urlKey = `thumbnail-video-${Date.now()}-${Math.random()}`
      
      // 设置超时
      const timeoutId = setTimeout(() => {
        cleanup()
        reject(new Error('视频加载超时'))
      }, 10000)
      
      const cleanup = () => {
        clearTimeout(timeoutId)
        SafeBlobManager.revokeObjectURL(urlKey)
      }
      
      video.onloadedmetadata = () => {
        try {
          if (video.duration === 0 || isNaN(video.duration)) {
            cleanup()
            reject(new Error('视频时长无效'))
            return
          }
          // 跳转到视频开始位置或10%处
          video.currentTime = Math.min(video.duration * 0.1, 1)
        } catch (error) {
          cleanup()
          reject(error)
        }
      }
      
      video.onseeked = () => {
        try {
          if (video.videoWidth === 0 || video.videoHeight === 0) {
            cleanup()
            reject(new Error('视频尺寸无效'))
            return
          }
          
          const maxSize = 200
          const ratio = Math.min(maxSize / video.videoWidth, maxSize / video.videoHeight)
          const newWidth = Math.max(1, Math.floor(video.videoWidth * ratio))
          const newHeight = Math.max(1, Math.floor(video.videoHeight * ratio))
          
          canvas.width = newWidth
          canvas.height = newHeight
          
          if (ctx) {
            ctx.fillStyle = '#000000' // 黑色背景
            ctx.fillRect(0, 0, newWidth, newHeight)
            ctx.drawImage(video, 0, 0, newWidth, newHeight)
            const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
            cleanup()
            resolve(dataUrl)
          } else {
            cleanup()
            reject(new Error('无法获取 Canvas 2D 上下文'))
          }
        } catch (error) {
          cleanup()
          reject(error)
        }
      }
      
      video.onerror = (error) => {
        cleanup()
        reject(new Error(`视频加载失败: ${error}`))
      }
      
      try {
        const objectUrl = SafeBlobManager.createObjectURL(file, urlKey)
        video.muted = true
        video.crossOrigin = 'anonymous'
        video.playsInline = true // 在移动设备上内联播放
        video.src = objectUrl
      } catch (error) {
        cleanup()
        reject(new Error(`创建视频 Object URL 失败: ${error}`))
      }
    })
  },
  
  // 生成PDF縮圖（需要PDF.js支持）
  generatePdfThumbnail: async (file: File): Promise<string> => {
    try {
      // 這裡可以集成PDF.js來生成PDF縮圖
      // 暫時返回一個佔位符
      return new Promise(resolve => {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        canvas.width = 200
        canvas.height = 200
        
        if (ctx) {
          ctx.fillStyle = '#f0f0f0'
          ctx.fillRect(0, 0, 200, 200)
          ctx.fillStyle = '#666'
          ctx.font = '16px Arial'
          ctx.textAlign = 'center'
          ctx.fillText('PDF', 100, 100)
        }
        
        resolve(canvas.toDataURL())
      })
    } catch (error) {
      throw error
    }
  }
}

// 檔案預覽Hook
const useFilePreview = (apiBaseUrl?: string, apiKey?: string) => {
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const [loadingThumbnails, setLoadingThumbnails] = useState<Set<string>>(new Set())
  const [failedThumbnails, setFailedThumbnails] = useState<Set<string>>(new Set())
  
  const generateThumbnail = useCallback(async (file: FileItem, fileBlob?: Blob) => {
    const fileId = file.file_id
    
    // 如果已经有缩图、正在加载或已经失败过，则跳过
    if (thumbnails[fileId] || loadingThumbnails.has(fileId) || failedThumbnails.has(fileId)) {
      return thumbnails[fileId]
    }
    
    setLoadingThumbnails(prev => new Set(prev).add(fileId))
    
    try {
      let thumbnailUrl = ''
      
      if (!fileBlob && apiBaseUrl && apiKey) {
        // 使用更安全的请求方式
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000) // 10秒超时
        
        try {
          const response = await fetch(`${apiBaseUrl}/files/${fileId}`, {
            headers: { 
              'X-API-KEY': apiKey,
              'Accept': '*/*'
            },
            mode: 'cors', // 明确指定 CORS 模式
            credentials: 'omit', // 不发送 cookies
            signal: controller.signal
          })
          clearTimeout(timeoutId)
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
          
          fileBlob = await response.blob()
        } catch (fetchError) {
          clearTimeout(timeoutId)
          console.warn(`文件 ${file.filename} 获取失败:`, fetchError)
          throw fetchError
        }
      }
      
      if (!fileBlob) {
        throw new Error('無法獲取檔案內容')
      }
      
      // 验证 blob 的有效性
      if (fileBlob.size === 0) {
        throw new Error('檔案內容為空')
      }
      
      const tempFile = new File([fileBlob], file.filename, { type: fileBlob.type })
      
      // 增加错误处理和超时控制
      const generateWithTimeout = (generator: () => Promise<string>, timeout: number = 5000) => {
        return Promise.race([
          generator(),
          new Promise<string>((_, reject) => 
            setTimeout(() => reject(new Error('缩图生成超时')), timeout)
          )
        ])
      }
      
      if (isImageFile(file.filename)) {
        thumbnailUrl = await generateWithTimeout(() => 
          ThumbnailGenerator.generateImageThumbnail(tempFile)
        )
      } else if (isVideoFile(file.filename)) {
        thumbnailUrl = await generateWithTimeout(() => 
          ThumbnailGenerator.generateVideoThumbnail(tempFile)
        )
      } else if (file.filename.toLowerCase().endsWith('.pdf')) {
        thumbnailUrl = await generateWithTimeout(() => 
          ThumbnailGenerator.generatePdfThumbnail(tempFile)
        )
      }
      
      if (thumbnailUrl) {
        setThumbnails(prev => ({ ...prev, [fileId]: thumbnailUrl }))
        // 从失败列表中移除（如果存在）
        setFailedThumbnails(prev => {
          const newSet = new Set(prev)
          newSet.delete(fileId)
          return newSet
        })
      }
      
      return thumbnailUrl
    } catch (error) {
      console.warn(`文件 ${file.filename} 縮圖生成失敗:`, error)
      // 添加到失败列表，避免重复尝试
      setFailedThumbnails(prev => new Set(prev).add(fileId))
      return null
    } finally {
      setLoadingThumbnails(prev => {
        const newSet = new Set(prev)
        newSet.delete(fileId)
        return newSet
      })
    }
  }, [thumbnails, loadingThumbnails, failedThumbnails, apiBaseUrl, apiKey])
  
  const isThumbnailLoading = useCallback((fileId: string) => {
    return loadingThumbnails.has(fileId)
  }, [loadingThumbnails])
  
  const getThumbnail = useCallback((fileId: string) => {
    return thumbnails[fileId]
  }, [thumbnails])
  
  return {
    generateThumbnail,
    isThumbnailLoading,
    getThumbnail,
    thumbnails
  }
}

// 預覽模態框組件
const PreviewModal = ({ file, isOpen, onClose, onNext, onPrev, hasNext, hasPrev, apiBaseUrl, apiKey }: PreviewModalProps) => {
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [imageLoadError, setImageLoadError] = useState(false)
  const [imageLoading, setImageLoading] = useState(true)
  const [imageBlobUrl, setImageBlobUrl] = useState<string | null>(null)
  const [fetchingImage, setFetchingImage] = useState(false)
  const [textContent, setTextContent] = useState<string>('')
  const [loadingText, setLoadingText] = useState(false)
  const [textError, setTextError] = useState(false)
  const [mediaBlobUrl, setMediaBlobUrl] = useState<string | null>(null)
  const [loadingMedia, setLoadingMedia] = useState(false)
  const [mediaError, setMediaError] = useState(false)
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [pdfError, setPdfError] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const resetViewState = useCallback(() => {
    setZoom(1)
    setRotation(0)
    setIsPlaying(false)
    setImageLoadError(false)
    setImageLoading(true)
    setImageBlobUrl(null)
    setFetchingImage(false)
    setTextContent('')
    setLoadingText(false)
    setTextError(false)
    setMediaBlobUrl(null)
    setLoadingMedia(false)
    setMediaError(false)
    setPdfBlobUrl(null)
    setLoadingPdf(false)
    setPdfError(false)
  }, [])

  useEffect(() => {
    if (isOpen && file) {
      resetViewState()
    }
  }, [file?.file_id, isOpen, resetViewState])

  // 構建檔案URL的函數
  const getFileUrl = useCallback((fileId: string, includeApiKey: boolean = false) => {
    const url = `${apiBaseUrl}/files/${fileId}`
    if (includeApiKey && apiKey) {
      const urlParams = new URLSearchParams()
      urlParams.append('X-API-KEY', apiKey)
      return `${url}?${urlParams.toString()}`
    }
    return url
  }, [apiBaseUrl, apiKey])

  // 获取带认证的文件 Blob URL
  const getAuthenticatedFileUrl = useCallback(async (fileId: string): Promise<string> => {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000) // 15秒超时
      
      const response = await fetch(`${apiBaseUrl}/files/${fileId}`, {
        headers: { 
          'X-API-KEY': apiKey || '',
          'Accept': '*/*'
        },
        mode: 'cors',
        credentials: 'omit',
        signal: controller.signal
      })
      
      clearTimeout(timeoutId)
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const blob = await response.blob()
      if (blob.size === 0) {
        throw new Error('文件内容为空')
      }
      
      const urlKey = `file-${fileId}-${Date.now()}`
      return SafeBlobManager.createObjectURL(blob, urlKey)
    } catch (error) {
      console.error('获取文件失败:', error)
      throw error
    }
  }, [apiBaseUrl, apiKey])

  // 新增：圖片預覽時 fetch blob 並產生本地 URL
  useEffect(() => {
    if (isOpen && file && isImageFile(file.filename)) {
      let urlKey: string | null = null
      let abortController: AbortController | null = null
      
      setFetchingImage(true)
      setImageLoadError(false)
      setImageLoading(true)
      
      const fetchImage = async () => {
        try {
          abortController = new AbortController()
          const timeoutId = setTimeout(() => abortController?.abort(), 10000)
          
          const response = await fetch(getFileUrl(file.file_id), {
            headers: { 
              'X-API-KEY': apiKey || '',
              'Accept': 'image/*'
            },
            mode: 'cors',
            credentials: 'omit',
            signal: abortController.signal
          })
          
          clearTimeout(timeoutId)
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
          
          const blob = await response.blob()
          if (blob.size === 0) {
            throw new Error('图片文件为空')
          }
          
          urlKey = `image-preview-${file.file_id}-${Date.now()}`
          const url = SafeBlobManager.createObjectURL(blob, urlKey)
          setImageBlobUrl(url)
        } catch (error) {
          if ((error as Error)?.name !== 'AbortError') {
            console.warn(`图片 ${file.filename} 获取失败:`, error)
            setImageLoadError(true)
          }
        } finally {
          setImageLoading(false)
          setFetchingImage(false)
        }
      }
      
      fetchImage()
      
      return () => {
        if (abortController) {
          abortController.abort()
        }
        if (urlKey) {
          SafeBlobManager.revokeObjectURL(urlKey)
        }
      }
    } else {
      setImageBlobUrl(null)
    }
  }, [isOpen, file, apiKey, getFileUrl])

  // 新增：文本文件内容加载
  useEffect(() => {
    if (isOpen && file && isTextFile(file.filename)) {
      let abortController: AbortController | null = null
      
      setLoadingText(true)
      setTextError(false)
      
      const fetchText = async () => {
        try {
          abortController = new AbortController()
          const timeoutId = setTimeout(() => abortController?.abort(), 10000)
          
          const response = await fetch(getFileUrl(file.file_id), {
            headers: { 
              'X-API-KEY': apiKey || '',
              'Accept': 'text/*'
            },
            mode: 'cors',
            credentials: 'omit',
            signal: abortController.signal
          })
          
          clearTimeout(timeoutId)
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
          
          const text = await response.text()
          setTextContent(text)
        } catch (error) {
          if ((error as Error)?.name !== 'AbortError') {
            console.warn(`文本文件 ${file.filename} 获取失败:`, error)
            setTextError(true)
          }
        } finally {
          setLoadingText(false)
        }
      }
      
      fetchText()
      
      return () => {
        if (abortController) {
          abortController.abort()
        }
      }
    } else {
      setTextContent('')
    }
  }, [isOpen, file, apiKey, getFileUrl])

  // 新增：媒体文件 blob URL 获取
  useEffect(() => {
    if (isOpen && file && (isVideoFile(file.filename) || isAudioFile(file.filename))) {
      let urlKey: string | null = null
      let abortController: AbortController | null = null
      
      setLoadingMedia(true)
      setMediaError(false)
      
      const fetchMedia = async () => {
        try {
          abortController = new AbortController()
          const timeoutId = setTimeout(() => abortController?.abort(), 30000) // 媒体文件可能较大，15秒超时
          
          const response = await fetch(`${apiBaseUrl}/files/${file.file_id}`, {
            headers: { 
              'X-API-KEY': apiKey || '',
              'Accept': isVideoFile(file.filename) ? 'video/*' : 'audio/*'
            },
            mode: 'cors',
            credentials: 'omit',
            signal: abortController.signal
          })
          
          clearTimeout(timeoutId)
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
          
          const blob = await response.blob()
          if (blob.size === 0) {
            throw new Error('媒体文件为空')
          }
          
          urlKey = `media-preview-${file.file_id}-${Date.now()}`
          const url = SafeBlobManager.createObjectURL(blob, urlKey)
          setMediaBlobUrl(url)
        } catch (error) {
          if ((error as Error)?.name !== 'AbortError') {
            console.warn(`媒体文件 ${file.filename} 获取失败:`, error)
            setMediaError(true)
          }
        } finally {
          setLoadingMedia(false)
        }
      }
      
      fetchMedia()
      
      return () => {
        if (abortController) {
          abortController.abort()
        }
        if (urlKey) {
          SafeBlobManager.revokeObjectURL(urlKey)
        }
      }
    } else {
      setMediaBlobUrl(null)
    }
  }, [isOpen, file, apiBaseUrl, apiKey])

  // 新增：PDF 文件 blob URL 获取
  useEffect(() => {
    if (isOpen && file && isPdfFile(file.filename)) {
      let urlKey: string | null = null
      let abortController: AbortController | null = null
      
      setLoadingPdf(true)
      setPdfError(false)
      
      const fetchPdf = async () => {
        try {
          abortController = new AbortController()
          const timeoutId = setTimeout(() => abortController?.abort(), 20000) // PDF 可能较大，20秒超时
          
          const response = await fetch(`${apiBaseUrl}/files/${file.file_id}`, {
            headers: { 
              'X-API-KEY': apiKey || '',
              'Accept': 'application/pdf'
            },
            mode: 'cors',
            credentials: 'omit',
            signal: abortController.signal
          })
          
          clearTimeout(timeoutId)
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
          
          const blob = await response.blob()
          if (blob.size === 0) {
            throw new Error('PDF 文件为空')
          }
          
          urlKey = `pdf-preview-${file.file_id}-${Date.now()}`
          const url = SafeBlobManager.createObjectURL(blob, urlKey)
          setPdfBlobUrl(url)
        } catch (error) {
          if ((error as Error)?.name !== 'AbortError') {
            console.warn(`PDF 文件 ${file.filename} 获取失败:`, error)
            setPdfError(true)
          }
        } finally {
          setLoadingPdf(false)
        }
      }
      
      fetchPdf()
      
      return () => {
        if (abortController) {
          abortController.abort()
        }
        if (urlKey) {
          SafeBlobManager.revokeObjectURL(urlKey)
        }
      }
    } else {
      setPdfBlobUrl(null)
    }
  }, [isOpen, file, apiBaseUrl, apiKey])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isOpen || !file) return
    switch (e.key) {
      case 'Escape':
        onClose()
        break
      case 'ArrowLeft':
        e.preventDefault()
        onPrev?.()
        break
      case 'ArrowRight':
        e.preventDefault()
        onNext?.()
        break
      case ' ':
        e.preventDefault()
        if (isVideoFile(file.filename) || isAudioFile(file.filename)) {
          setIsPlaying(!isPlaying)
          if (isVideoFile(file.filename) && videoRef.current) {
            if (isPlaying) {
              videoRef.current.pause()
            } else {
              videoRef.current.play()
            }
          }
          if (isAudioFile(file.filename) && audioRef.current) {
            if (isPlaying) {
              audioRef.current.pause()
            } else {
              audioRef.current.play()
            }
          }
        }
        break
      case 'f':
      case 'F':
        e.preventDefault()
        if (document.fullscreenElement) {
          document.exitFullscreen()
        } else {
          document.documentElement.requestFullscreen()
        }
        break
      case 'm':
      case 'M':
        e.preventDefault()
        if (isVideoFile(file.filename) || isAudioFile(file.filename)) {
          setIsMuted(!isMuted)
          if (videoRef.current) {
            videoRef.current.muted = !isMuted
          }
          if (audioRef.current) {
            audioRef.current.muted = !isMuted
          }
        }
        break
      case 'c':
      case 'C':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          if (isTextFile(file.filename) && textContent) {
            navigator.clipboard.writeText(textContent)
            toast.success('文本內容已複製到剪貼板')
          }
        }
        break
      case 'd':
      case 'D':
        e.preventDefault()
        getAuthenticatedFileUrl(file.file_id).then(url => {
          const link = document.createElement('a')
          link.href = url
          link.download = file.filename
          link.click()
          URL.revokeObjectURL(url)
        }).catch(() => {
          toast.error('文件下載失敗')
        })
        break
    }
  }, [isOpen, file, onClose, onNext, onPrev, isPlaying, isMuted, textContent, getAuthenticatedFileUrl])

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'hidden'
      return () => {
        document.removeEventListener('keydown', handleKeyDown)
        document.body.style.overflow = 'unset'
      }
    }
  }, [isOpen, handleKeyDown])

  // 組件卸載時清理所有 blob URL
  useEffect(() => {
    return () => {
      // 當組件卸載時，清理相關的 blob URL
      if (file) {
        const patterns = [
          `image-preview-${file.file_id}`,
          `media-preview-${file.file_id}`,
          `pdf-preview-${file.file_id}`,
          `file-${file.file_id}`
        ]
        
        patterns.forEach(pattern => {
          SafeBlobManager.revokeByPattern(pattern)
        })
      }
    }
  }, [file?.file_id])

  if (!file || !isOpen) return null

  const renderPreviewContent = () => {
    const { category } = getFileIcon(file.file_type || '', file.filename)
    
    // 圖片預覽
    if (isImageFile(file.filename)) {
      return (
        <div 
          className="relative flex items-center justify-center h-full w-full overflow-hidden"
          onWheel={(e) => {
            e.preventDefault()
            const delta = e.deltaY > 0 ? -0.1 : 0.1
            setZoom(Math.max(0.1, Math.min(5, zoom + delta)))
          }}
        >
          {imageBlobUrl ? (
            <ImagePreview
              src={imageBlobUrl}
              alt={file.filename}
              zoom={zoom}
              rotation={rotation}
              onZoomChange={setZoom}
              onLoad={() => {
                setImageLoading(false)
                setImageLoadError(false)
              }}
              onError={() => {
                setImageLoading(false)
                setImageLoadError(true)
              }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full w-full">
              <Loader2 className="w-8 h-8 text-white animate-spin mb-2" />
              <span className="text-white/80">圖片載入中...</span>
            </div>
          )}
          {/* 縮放指示器 */}
          {zoom !== 1 && !imageLoadError && (
            <div className="absolute bottom-4 left-4 bg-white/10 backdrop-blur-sm px-3 py-1 rounded-full text-white text-sm border border-white/20">
              {Math.round(zoom * 100)}%
            </div>
          )}
          {/* 檔案資訊覆蓋層 */}
          <div className="absolute top-4 right-4 bg-black/50 backdrop-blur-sm rounded-lg p-3 text-white text-sm max-w-xs">
            <div className="font-medium truncate">{file.filename}</div>
            <div className="text-white/70 text-xs">
              {formatFileSize(file.file_size || 0)} • {formatTimeAgo(file.upload_time)}
            </div>
          </div>
        </div>
      )
    }
    
    // PDF 預覽
    if (isPdfFile(file.filename)) {
      return (
        <div className="relative flex items-center justify-center h-full w-full">
          <PdfPreview
            src={pdfBlobUrl}
            filename={file.filename}
            loading={loadingPdf}
            error={pdfError}
          />
          {/* 檔案資訊覆蓋層 */}
          <div className="absolute top-4 right-4 bg-black/50 backdrop-blur-sm rounded-lg p-3 text-white text-sm max-w-xs">
            <div className="font-medium truncate">{file.filename}</div>
            <div className="text-white/70 text-xs">
              {formatFileSize(file.file_size || 0)} • {formatTimeAgo(file.upload_time)}
            </div>
          </div>
        </div>
      )
    }
    
    // 文本文件預覽
    if (isTextFile(file.filename)) {
      return (
        <div className="relative flex items-center justify-center h-full w-full p-4">
          <TextPreview
            content={textContent}
            filename={file.filename}
            loading={loadingText}
            error={textError}
          />
        </div>
      )
    }
    
    // Word 文檔預覽 (使用 Google Docs Viewer)
    if (isWordFile(file.filename)) {
      const fileUrl = getFileUrl(file.file_id, true) // 包含 API Key
      const viewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(window.location.origin + fileUrl)}&embedded=true`
      
      return (
        <div className="relative flex items-center justify-center h-full w-full">
          <div className="w-full h-full bg-gray-900/90 backdrop-blur-sm rounded-lg overflow-hidden">
            <div className="bg-gray-800/90 border-b border-gray-700/50 p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Badge variant="secondary" className="bg-blue-500/20 text-blue-300 border-blue-500/30">
                  WORD
                </Badge>
                <span className="text-white font-medium truncate">{file.filename}</span>
              </div>
              <Button
                onClick={() => {
                  getAuthenticatedFileUrl(file.file_id).then(url => {
                    const link = document.createElement('a')
                    link.href = url
                    link.download = file.filename
                    link.click()
                    URL.revokeObjectURL(url)
                  }).catch(() => {
                    toast.error('文件下載失敗')
                  })
                }}
                size="sm"
                className="bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm border border-white/20"
              >
                <Download className="w-4 h-4 mr-2" />
                下載原檔
              </Button>
            </div>
            
            <iframe
              src={viewerUrl}
              title={file.filename}
              className="w-full h-[calc(100%-60px)] border-0"
              onLoad={() => console.log('Word document loaded')}
              onError={() => console.error('Word document loading failed')}
            />
          </div>
        </div>
      )
    }
    
    // 視頻預覽
    if (isVideoFile(file.filename)) {
      if (loadingMedia) {
        return (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-white animate-spin" />
              <p className="text-white text-sm">載入視頻中...</p>
            </div>
          </div>
        )
      }
      
      if (mediaError || !mediaBlobUrl) {
        return (
          <div className="flex flex-col items-center justify-center h-full space-y-4">
            <div className="w-24 h-24 rounded-full bg-red-500/20 flex items-center justify-center">
              <AlertCircle className="w-12 h-12 text-red-400" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-medium text-white mb-2">視頻載入失敗</h3>
              <p className="text-white/70 text-sm">請檢查檔案是否已損壞或網絡連接</p>
            </div>
          </div>
        )
      }
      
      return (
        <div className="relative flex items-center justify-center h-full w-full">
          <video
            ref={videoRef}
            src={mediaBlobUrl}
            className="max-w-full max-h-full rounded-lg shadow-2xl"
            controls
            muted={isMuted}
            autoPlay={false}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onLoadedMetadata={() => {
              console.log('視頻載入成功:', file.filename)
            }}
            onError={(e) => {
              console.error('視頻載入失敗:', file.filename, e)
              setMediaError(true)
            }}
          />
          {/* 檔案資訊覆蓋層 */}
          <div className="absolute top-4 right-4 bg-black/50 backdrop-blur-sm rounded-lg p-3 text-white text-sm max-w-xs">
            <div className="font-medium truncate">{file.filename}</div>
            <div className="text-white/70 text-xs">
              {formatFileSize(file.file_size || 0)} • {formatTimeAgo(file.upload_time)}
            </div>
          </div>
        </div>
      )
    }
    
    // 音頻預覽
    if (isAudioFile(file.filename)) {
      if (loadingMedia) {
        return (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-white animate-spin" />
              <p className="text-white text-sm">載入音頻中...</p>
            </div>
          </div>
        )
      }
      
      if (mediaError || !mediaBlobUrl) {
        return (
          <div className="flex flex-col items-center justify-center h-full space-y-4">
            <div className="w-24 h-24 rounded-full bg-red-500/20 flex items-center justify-center">
              <AlertCircle className="w-12 h-12 text-red-400" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-medium text-white mb-2">音頻載入失敗</h3>
              <p className="text-white/70 text-sm">請檢查檔案是否已損壞或網絡連接</p>
            </div>
          </div>
        )
      }
      
      return (
        <div className="flex flex-col items-center justify-center h-full space-y-8">
          <motion.div 
            className="w-48 h-48 bg-linear-to-br from-purple-500 via-pink-500 to-orange-500 rounded-full flex items-center justify-center shadow-2xl relative overflow-hidden"
            animate={{
              rotate: isPlaying ? 360 : 0
            }}
            transition={{
              duration: 3,
              repeat: isPlaying ? Infinity : 0,
              ease: "linear"
            }}
          >
            <div className="absolute inset-4 bg-white/10 rounded-full backdrop-blur-sm" />
            <Volume2 className="w-24 h-24 text-white relative z-10" />
          </motion.div>
          
          <div className="text-center space-y-4">
            <h3 className="text-2xl font-medium text-white">{file.filename}</h3>
            <div className="bg-white/10 backdrop-blur-sm p-4 rounded-lg border border-white/20">
              <audio
                ref={audioRef}
                src={mediaBlobUrl}
                controls
                className="w-full max-w-md"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onError={(e) => {
                  console.error('音頻載入失敗:', file.filename, e)
                  setMediaError(true)
                }}
              />
            </div>
            
            {/* 檔案詳細資訊 */}
            <div className="flex items-center justify-center gap-4 text-white/70 text-sm">
              <span>{formatFileSize(file.file_size || 0)}</span>
              <span>•</span>
              <span>{formatTimeAgo(file.upload_time)}</span>
            </div>
          </div>
        </div>
      )
    }
    
    // 其他檔案類型顯示檔案資訊
    const fileIconInfo = getFileIcon(file.file_type || '', file.filename);
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-8">
        <motion.div 
          className={cn(
            "w-40 h-40 rounded-2xl flex items-center justify-center relative",
            fileIconInfo.bgColor
          )}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <fileIconInfo.IconComponent className={cn("w-20 h-20", fileIconInfo.color)} />
        </motion.div>
        
        <div className="text-center space-y-4 max-w-2xl">
          <h3 className="text-2xl font-medium text-white">{file.filename}</h3>
          <div className="flex items-center justify-center gap-4 text-white/70 text-base">
            <Badge variant="secondary" className="bg-white/10 text-white border-white/20 px-3 py-1">
              {category}
            </Badge>
            <span>{formatFileSize(file.file_size || 0)}</span>
            <span>•</span>
            <span>{formatTimeAgo(file.upload_time)}</span>
          </div>
          
          {file.description && (
            <div className="bg-white/10 backdrop-blur-sm p-4 rounded-lg border border-white/20">
              <p className="text-white/90 text-lg leading-relaxed">
                {file.description}
              </p>
            </div>
          )}
          
          {/* 檔案操作按鈕 */}
          <div className="flex items-center justify-center gap-3 pt-4">
            <Button
              onClick={() => {
                getAuthenticatedFileUrl(file.file_id).then(url => {
                  const link = document.createElement('a')
                  link.href = url
                  link.download = file.filename
                  link.click()
                  URL.revokeObjectURL(url)
                }).catch(() => {
                  toast.error('文件下載失敗')
                })
              }}
              className="bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm border border-white/20"
            >
              <Download className="w-4 h-4 mr-2" />
              下載檔案
            </Button>
            
            <Button
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}${getFileUrl(file.file_id)}`)
                toast.success('連結已複製到剪貼板')
              }}
              variant="outline"
              className="bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm border border-white/20"
            >
              <Copy className="w-4 h-4 mr-2" />
              複製連結
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center"
          onClick={onClose}
        >
          {/* 頂部工具列 */}
          <div className="absolute top-0 left-0 right-0 bg-linear-to-b from-black/80 to-transparent p-6 z-10">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <Badge variant="secondary" className="bg-white/10 text-white border-white/20 backdrop-blur-sm">
                  {getFileIcon(file.file_type || '', file.filename).category}
                </Badge>
                <div className="text-white">
                  <div className="font-medium text-lg">{file.filename}</div>
                  <div className="text-sm text-white/70 flex items-center gap-2">
                    <span>{formatFileSize(file.file_size || 0)}</span>
                    <span>•</span>
                    <span>{formatTimeAgo(file.upload_time)}</span>
                    {file.description && (
                      <React.Fragment key="file-description">
                        <span>•</span>
                        <span className="max-w-xs truncate">{file.description}</span>
                      </React.Fragment>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                {isImageFile(file.filename) && (
                  <React.Fragment key="image-controls">
                    <div className="flex items-center gap-1 bg-white/10 backdrop-blur-sm rounded-lg px-2 py-1">
                      <TooltipButton
                        tooltip="縮小 (滾輪向下)"
                        onClick={(e?: React.MouseEvent<HTMLButtonElement>) => {
                          e?.stopPropagation()
                          setZoom(Math.max(0.1, zoom - 0.2))
                        }}
                        className="bg-transparent text-white hover:bg-white/20 border-0 p-1 h-7 w-7"
                        disabled={zoom <= 0.1}
                        size="sm"
                      >
                        <ZoomOut className="w-3 h-3" />
                      </TooltipButton>
                      
                      <TooltipButton
                        tooltip="重置縮放"
                        onClick={(e?: React.MouseEvent<HTMLButtonElement>) => {
                          e?.stopPropagation()
                          setZoom(1)
                          setRotation(0)
                        }}
                        className="bg-transparent text-white hover:bg-white/20 border-0 px-2 h-7 min-w-12"
                        size="sm"
                      >
                        <span className="text-xs font-mono">{Math.round(zoom * 100)}%</span>
                      </TooltipButton>
                      
                      <TooltipButton
                        tooltip="放大 (滾輪向上)"
                        onClick={(e?: React.MouseEvent<HTMLButtonElement>) => {
                          e?.stopPropagation()
                          setZoom(Math.min(5, zoom + 0.2))
                        }}
                        className="bg-transparent text-white hover:bg-white/20 border-0 p-1 h-7 w-7"
                        disabled={zoom >= 5}
                        size="sm"
                      >
                        <ZoomIn className="w-3 h-3" />
                      </TooltipButton>
                    </div>
                    
                    <TooltipButton
                      tooltip="旋轉 90°"
                      onClick={(e?: React.MouseEvent<HTMLButtonElement>) => {
                        e?.stopPropagation()
                        setRotation((rotation + 90) % 360)
                      }}
                      className="bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm border-white/20"
                    >
                      <RotateCw className="w-4 h-4" />
                    </TooltipButton>
                    
                    <div className="w-px h-6 bg-white/20 mx-1" />
                  </React.Fragment>
                )}
                
                {(isPdfFile(file.filename) || isTextFile(file.filename) || isWordFile(file.filename)) && (
                  <React.Fragment key="document-controls">
                    <TooltipButton
                      tooltip="複製內容"
                      onClick={(e?: React.MouseEvent<HTMLButtonElement>) => {
                        e?.stopPropagation()
                        if (isTextFile(file.filename) && textContent) {
                          navigator.clipboard.writeText(textContent)
                          toast.success('文本內容已複製到剪貼板')
                        } else {
                          toast.info('此文件類型暫不支持內容複製')
                        }
                      }}
                      className="bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm border-white/20"
                      disabled={isTextFile(file.filename) ? !textContent : true}
                    >
                      <Copy className="w-4 h-4" />
                    </TooltipButton>
                    
                    <div className="w-px h-6 bg-white/20 mx-1" />
                  </React.Fragment>
                )}
                
                {(isVideoFile(file.filename) || isAudioFile(file.filename)) && (
                  <React.Fragment key="media-controls">
                    <TooltipButton
                      tooltip={isMuted ? "取消靜音" : "靜音"}
                      onClick={(e?: React.MouseEvent<HTMLButtonElement>) => {
                        e?.stopPropagation()
                        setIsMuted(!isMuted)
                        if (videoRef.current) {
                          videoRef.current.muted = !isMuted
                        }
                        if (audioRef.current) {
                          audioRef.current.muted = !isMuted
                        }
                      }}
                      className="bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm border-white/20"
                    >
                      {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </TooltipButton>
                    
                    <div className="w-px h-6 bg-white/20 mx-1" />
                  </React.Fragment>
                )}
                
                <TooltipButton
                  tooltip="下載檔案"
                  onClick={(e?: React.MouseEvent<HTMLButtonElement>) => {
                    e?.stopPropagation()
                    getAuthenticatedFileUrl(file.file_id).then(url => {
                      const link = document.createElement('a')
                      link.href = url
                      link.download = file.filename
                      link.click()
                      URL.revokeObjectURL(url)
                    }).catch(() => {
                      toast.error('文件下載失敗')
                    })
                  }}
                  className="bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm border-white/20"
                >
                  <Download className="w-4 h-4" />
                </TooltipButton>
                
                <TooltipButton
                  tooltip="全螢幕 (F11)"
                  onClick={(e?: React.MouseEvent<HTMLButtonElement>) => {
                    e?.stopPropagation()
                    if (document.fullscreenElement) {
                      document.exitFullscreen()
                    } else {
                      document.documentElement.requestFullscreen()
                    }
                  }}
                  className="bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm border-white/20"
                >
                  <Maximize2 className="w-4 h-4" />
                </TooltipButton>
                
                <TooltipButton
                  tooltip="關閉 (ESC)"
                  onClick={(e?: React.MouseEvent<HTMLButtonElement>) => {
                    e?.stopPropagation()
                    onClose()
                  }}
                  className="bg-red-500/20 text-white hover:bg-red-500/30 backdrop-blur-sm border-red-500/20"
                >
                  <X className="w-4 h-4" />
                </TooltipButton>
              </div>
            </div>
          </div>

          {/* 導航按鈕 */}
          <AnimatePresence>
            {hasPrev && (
              <motion.button
                key="prev-button"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                onClick={(e) => {
                  e.stopPropagation()
                  onPrev?.()
                }}
                className="absolute left-6 top-1/2 -translate-y-1/2 bg-white/10 backdrop-blur-sm text-white p-4 rounded-full hover:bg-white/20 transition-all duration-200 border border-white/20 group"
              >
                <ChevronLeft className="w-6 h-6 group-hover:scale-110 transition-transform" />
              </motion.button>
            )}
            
            {hasNext && (
              <motion.button
                key="next-button"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                onClick={(e) => {
                  e.stopPropagation()
                  onNext?.()
                }}
                className="absolute right-6 top-1/2 -translate-y-1/2 bg-white/10 backdrop-blur-sm text-white p-4 rounded-full hover:bg-white/20 transition-all duration-200 border border-white/20 group"
              >
                <ChevronRight className="w-6 h-6 group-hover:scale-110 transition-transform" />
              </motion.button>
            )}
          </AnimatePresence>

          {/* 主要內容區域 */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="w-full h-full flex items-center justify-center p-24"
            onClick={(e) => e.stopPropagation()}
          >
            {renderPreviewContent()}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// 檔案管理組件
export const FileManager = ({ 
  onStatsUpdate, 
  apiKey, 
  apiBaseUrl 
}: FileManagerProps) => {
  const [files, setFiles] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortType>('date_desc')
  const [filterType, setFilterType] = useState<FilterType>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)

  // 組件卸載時清理所有 blob URL
  useEffect(() => {
    return () => {
      SafeBlobManager.revokeAll()
    }
  }, [])

  // 計算統計資訊
  const calculateStats = useCallback((fileList: FileItem[]): FileStats => {
    const totalSize = fileList.reduce((sum, file) => sum + (file.file_size || 0), 0)
    const types: Record<string, number> = {}
    
    fileList.forEach(file => {
      const category = getFileCategory(file.filename)
      types[category] = (types[category] || 0) + 1
    })
    
    const recent = fileList.filter(file => {
      const uploadDate = new Date(file.upload_time)
      const weekAgo = new Date()
      weekAgo.setDate(weekAgo.getDate() - 7)
      return uploadDate > weekAgo
    }).length
    
    return { total: fileList.length, size: totalSize, types, recent }
  }, [])

  // 載入檔案列表
  const loadFiles = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`${apiBaseUrl}/files?page_size=1000`, {
        headers: { 
          'X-API-KEY': apiKey,
          'Accept': '*/*'
        },
        mode: 'cors',
        credentials: 'omit',
      })
      if (response.ok) {
        const fileList = await response.json()
        setFiles(fileList)
        onStatsUpdate(calculateStats(fileList))
      } else {
        toast.error('載入檔案失敗')
      }
    } catch (error) {
      console.error('Error loading files:', error)
      toast.error('載入檔案失敗')
    } finally {
      setLoading(false)
    }
  }, [apiBaseUrl, apiKey, onStatsUpdate, calculateStats])

  // 上傳檔案
  const uploadFiles = useCallback(async (fileList: FileList | File[]) => {
    if (!fileList || fileList.length === 0) return

    setUploading(true)
    const toastId = toast.loading(`正在上傳 ${fileList.length} 個檔案...`)
    
    try {
      let successCount = 0
      const filesArray = Array.from(fileList)
      
      for (const file of filesArray) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('description', `Uploaded ${file.name}`)

        const response = await fetch(`${apiBaseUrl}/files/upload`, {
          method: 'POST',
          headers: { 
            'X-API-KEY': apiKey,
            'Accept': '*/*'
          },
          mode: 'cors',
          credentials: 'omit',
          body: formData
        })

        if (response.ok) successCount++
      }
      
      toast.success(`成功上傳 ${successCount} 個檔案`, { id: toastId })
      loadFiles()
    } catch (error) {
      console.error('Upload error:', error)
      toast.error('上傳失敗', { id: toastId })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [apiBaseUrl, apiKey, loadFiles])

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) uploadFiles(event.target.files)
  }

  // 拖放處理
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files) uploadFiles(e.dataTransfer.files)
  }, [uploadFiles])

  // 刪除檔案
  const deleteFile = useCallback(async (fileId: string) => {
    try {
      const response = await fetch(`${apiBaseUrl}/files/${fileId}`, {
        method: 'DELETE',
        headers: { 
          'X-API-KEY': apiKey,
          'Accept': '*/*'
        },
        mode: 'cors',
        credentials: 'omit',
      })
      
      if (response.ok) {
        toast.success('已刪除')
        loadFiles()
      } else {
        toast.error('刪除失敗')
      }
    } catch (error) {
      console.error('Delete error:', error)
      toast.error('刪除失敗')
    }
  }, [apiBaseUrl, apiKey, loadFiles])

  // 批量刪除
  const deleteSelectedFiles = useCallback(async () => {
    if (selectedFiles.size === 0) return
    
    if (!confirm(`確定刪除選中的 ${selectedFiles.size} 個檔案嗎？`)) return
    
    const toastId = toast.loading('正在刪除...')
    try {
      let successCount = 0
      
      for (const fileId of selectedFiles) {
        const response = await fetch(`${apiBaseUrl}/files/${fileId}`, {
          method: 'DELETE',
          headers: { 
            'X-API-KEY': apiKey,
            'Accept': '*/*'
          },
          mode: 'cors',
          credentials: 'omit',
        })
        
        if (response.ok) successCount++
      }
      
      toast.success(`已刪除 ${successCount} 個檔案`, { id: toastId })
      setSelectedFiles(new Set())
      loadFiles()
    } catch (error) {
      toast.error('批量刪除失敗', { id: toastId })
    }
  }, [selectedFiles, apiBaseUrl, apiKey, loadFiles])

  // 下載檔案
  const downloadFile = useCallback(async (fileId: string, filename: string) => {
    try {
      const response = await fetch(`${apiBaseUrl}/files/${fileId}`, {
        headers: { 
          'X-API-KEY': apiKey,
          'Accept': '*/*'
        },
        mode: 'cors',
        credentials: 'omit',
      })
      
      if (response.ok) {
        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
        toast.success('下載完成')
      } else {
        toast.error('下載失敗')
      }
    } catch (error) {
      console.error('Download error:', error)
      toast.error('下載失敗')
    }
  }, [apiBaseUrl, apiKey])

  // 預覽檔案
  const previewFileHandler = useCallback((file: FileItem) => {
    setPreviewFile(file)
    setShowPreview(true)
  }, [])

  // 排序和過濾邏輯
  const filteredAndSortedFiles = useMemo(() => {
    return files
      .filter(file => {
        if (!file.file_id || file.file_id.trim() === '') return false
        
        const searchMatch = file.filename?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           file.description?.toLowerCase().includes(searchQuery.toLowerCase())
        const typeMatch = filterType === 'all' || getFileCategory(file.filename) === filterType
        
        return searchMatch && typeMatch
      })
      .reduce((unique: FileItem[], file) => {
        if (!unique.find(f => f.file_id === file.file_id)) unique.push(file)
        return unique
      }, [])
      .sort((a, b) => {
        switch (sortBy) {
          case 'name_asc':
            return a.filename.localeCompare(b.filename)
          case 'name_desc':
            return b.filename.localeCompare(a.filename)
          case 'date_asc':
            return new Date(a.upload_time).getTime() - new Date(b.upload_time).getTime()
          case 'date_desc':
            return new Date(b.upload_time).getTime() - new Date(a.upload_time).getTime()
          case 'size_asc':
            return (a.file_size || 0) - (b.file_size || 0)
          case 'size_desc':
            return (b.file_size || 0) - (a.file_size || 0)
          default:
            return 0
        }
      })
  }, [files, searchQuery, filterType, sortBy])

  // 獲取下一個/上一個檔案
  const getAdjacentFiles = useCallback((currentFile: FileItem) => {
    const currentIndex = filteredAndSortedFiles.findIndex(f => f.file_id === currentFile.file_id)
    return {
      prev: currentIndex > 0 ? filteredAndSortedFiles[currentIndex - 1] : null,
      next: currentIndex < filteredAndSortedFiles.length - 1 ? filteredAndSortedFiles[currentIndex + 1] : null
    }
  }, [filteredAndSortedFiles])

  // 類型統計
  const typeStats = useMemo(() => {
    return files.reduce((acc, file) => {
      const category = getFileCategory(file.filename)
      acc[category] = (acc[category] || 0) + 1
      return acc
    }, {} as Record<string, number>)
  }, [files])

  // 總大小
  const totalSize = useMemo(() => {
    return files.reduce((sum, file) => sum + (file.file_size || 0), 0)
  }, [files])

  // 組件掛載時載入檔案
  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  return (
    <div 
      ref={dropZoneRef}
      className="h-full flex flex-col bg-background relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 拖放覆蓋層 */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-4 z-50 bg-card/80 backdrop-blur-xl border-2 border-dashed border-primary/50 rounded-2xl flex items-center justify-center"
          >
            <div className="text-center space-y-3">
              <div className="w-14 h-14 mx-auto bg-primary/10 rounded-xl flex items-center justify-center">
                <CloudUpload className="w-7 h-7 text-primary" />
              </div>
              <div>
                <p className="text-base font-medium text-foreground">放開以上傳檔案</p>
                <p className="text-sm text-muted-foreground">支援所有常見檔案格式</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 頂部工具列 - 毛玻璃設計 */}
      <div className="flex-none bg-card/50 backdrop-blur-xl border-b border-border/50 sticky top-0 z-40">
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            {/* 搜索框 */}
            <div className="flex-1 max-w-sm">
              <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <input
                  type="text"
                  placeholder="搜尋檔案..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-9 pl-9 pr-9 text-sm bg-background/50 border border-border/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all placeholder:text-muted-foreground/60"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* 分隔線 */}
            <div className="h-6 w-px bg-border/50 hidden sm:block" />

            {/* 篩選類型標籤組 */}
            <div className="hidden md:flex items-center gap-1 bg-muted/50 rounded-lg p-1">
              <button
                onClick={() => setFilterType('all')}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                  filterType === 'all' 
                    ? "bg-background text-foreground shadow-sm" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                全部
              </button>
              {Object.entries(FILE_TYPES).slice(0, 4).map(([key, config]) => {
                const count = typeStats[key] || 0
                return (
                  <button
                    key={key}
                    onClick={() => setFilterType(key as FilterType)}
                    className={cn(
                      "px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1.5",
                      filterType === key 
                        ? "bg-background text-foreground shadow-sm" 
                        : "text-muted-foreground hover:text-foreground",
                      count === 0 && "opacity-50 cursor-not-allowed"
                    )}
                    disabled={count === 0}
                  >
                    {config.label}
                    {count > 0 && <span className="text-[10px] opacity-60">{count}</span>}
                  </button>
                )
              })}
              
              {/* 更多篩選 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md transition-all">
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-30">
                  {Object.entries(FILE_TYPES).slice(4).map(([key, config]) => {
                    const count = typeStats[key] || 0
                    const IconComponent = config.icon
                    return (
                      <DropdownMenuItem 
                        key={key} 
                        onClick={() => setFilterType(key as FilterType)}
                        disabled={count === 0}
                        className={cn(count === 0 && "opacity-50")}
                      >
                        <IconComponent className="w-4 h-4 mr-2" />
                        {config.label}
                        {count > 0 && <span className="ml-auto text-xs text-muted-foreground">{count}</span>}
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* 移動端篩選下拉 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild className="md:hidden">
                <Button variant="outline" size="sm" className="h-9 gap-1.5 border-border/50">
                  <Filter className="w-3.5 h-3.5" />
                  {filterType === 'all' ? '全部' : FILE_TYPES[filterType as keyof typeof FILE_TYPES]?.label}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-35">
                <DropdownMenuItem onClick={() => setFilterType('all')}>
                  <FolderOpen className="w-4 h-4 mr-2" />
                  全部
                  <span className="ml-auto text-xs text-muted-foreground">{files.length}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {Object.entries(FILE_TYPES).map(([key, config]) => {
                  const count = typeStats[key] || 0
                  const IconComponent = config.icon
                  return (
                    <DropdownMenuItem 
                      key={key} 
                      onClick={() => setFilterType(key as FilterType)}
                      disabled={count === 0}
                    >
                      <IconComponent className="w-4 h-4 mr-2" />
                      {config.label}
                      {count > 0 && <span className="ml-auto text-xs text-muted-foreground">{count}</span>}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex-1" />

            {/* 批量操作 */}
            <AnimatePresence>
              {selectedFiles.size > 0 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="flex items-center gap-2"
                >
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    已選 {selectedFiles.size} 項
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={deleteSelectedFiles}
                    className="h-8 px-3 text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span className="ml-1.5 hidden sm:inline">刪除</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedFiles(new Set())}
                    className="h-8 px-2"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 排序 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-9 gap-1.5 text-muted-foreground hover:text-foreground">
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline text-xs">
                    {sortBy === 'date_desc' ? '最新' : 
                     sortBy === 'date_asc' ? '最早' :
                     sortBy === 'name_asc' ? 'A-Z' :
                     sortBy === 'name_desc' ? 'Z-A' :
                     sortBy === 'size_desc' ? '最大' : '最小'}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-35">
                <DropdownMenuItem onClick={() => setSortBy('date_desc')}>
                  <Check className={cn("w-4 h-4 mr-2", sortBy !== 'date_desc' && "opacity-0")} />
                  最新上傳
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy('date_asc')}>
                  <Check className={cn("w-4 h-4 mr-2", sortBy !== 'date_asc' && "opacity-0")} />
                  最早上傳
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setSortBy('name_asc')}>
                  <Check className={cn("w-4 h-4 mr-2", sortBy !== 'name_asc' && "opacity-0")} />
                  名稱 A-Z
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy('name_desc')}>
                  <Check className={cn("w-4 h-4 mr-2", sortBy !== 'name_desc' && "opacity-0")} />
                  名稱 Z-A
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setSortBy('size_desc')}>
                  <Check className={cn("w-4 h-4 mr-2", sortBy !== 'size_desc' && "opacity-0")} />
                  大小 (大→小)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy('size_asc')}>
                  <Check className={cn("w-4 h-4 mr-2", sortBy !== 'size_asc' && "opacity-0")} />
                  大小 (小→大)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 視圖切換 */}
            <div className="flex bg-muted/50 rounded-lg p-0.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewMode('grid')}
                className={cn(
                  "h-7 w-7 p-0 rounded-md",
                  viewMode === 'grid' && "bg-background shadow-sm"
                )}
              >
                <LayoutGrid className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewMode('list')}
                className={cn(
                  "h-7 w-7 p-0 rounded-md",
                  viewMode === 'list' && "bg-background shadow-sm"
                )}
              >
                <List className="w-4 h-4" />
              </Button>
            </div>

            {/* 重新整理 */}
            <TooltipButton tooltip="重新整理" onClick={loadFiles} className="h-9 w-9">
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </TooltipButton>
            
            {/* 上傳按鈕 */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              size="sm"
              className="h-9 gap-1.5 bg-primary hover:bg-primary/90 shadow-sm"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">{uploading ? '上傳中' : '上傳'}</span>
            </Button>
          </div>
        </div>

        {/* 狀態欄 */}
        <div className="px-4 py-2 border-t border-border/30 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <FolderOpen className="w-3.5 h-3.5" />
              {filteredAndSortedFiles.length} 個檔案
            </span>
            <span className="flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5" />
              {formatFileSize(totalSize)}
            </span>
          </div>
          {searchQuery && (
            <span>
              搜尋: "{searchQuery}"
            </span>
          )}
        </div>
      </div>

      {/* 主內容區域 */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">載入中...</span>
          </div>
        ) : filteredAndSortedFiles.length === 0 ? (
          <motion.div 
            className="flex flex-col items-center justify-center h-64"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="w-16 h-16 bg-muted/50 rounded-2xl flex items-center justify-center mb-4">
              <FolderOpen className="w-8 h-8 text-muted-foreground/50" />
            </div>
            <h3 className="text-base font-medium mb-1">
              {files.length === 0 ? '尚無檔案' : '找不到符合的檔案'}
            </h3>
            <p className="text-sm text-muted-foreground text-center max-w-xs mb-4">
              {files.length === 0 
                ? '拖放檔案到此處，或點擊上傳按鈕'
                : '試試調整搜尋或篩選條件'
              }
            </p>
            {files.length === 0 && (
              <Button
                onClick={() => fileInputRef.current?.click()}
                size="sm"
                className="gap-2"
              >
                <Upload className="w-4 h-4" />
                上傳檔案
              </Button>
            )}
          </motion.div>
        ) : (
          <FileGrid
            files={filteredAndSortedFiles}
            viewMode={viewMode}
            selectedFiles={selectedFiles}
            onSelectionChange={setSelectedFiles}
            onPreview={previewFileHandler}
            onDownload={downloadFile}
            onDelete={deleteFile}
            apiBaseUrl={apiBaseUrl}
            apiKey={apiKey}
          />
        )}
      </div>

      {/* 預覽模態框 */}
      <PreviewModal
        file={previewFile}
        isOpen={showPreview}
        apiBaseUrl={apiBaseUrl}
        apiKey={apiKey}
        onClose={() => {
          setShowPreview(false)
          setPreviewFile(null)
        }}
        onNext={() => {
          if (previewFile) {
            const { next } = getAdjacentFiles(previewFile)
            if (next) setPreviewFile(next)
          }
        }}
        onPrev={() => {
          if (previewFile) {
            const { prev } = getAdjacentFiles(previewFile)
            if (prev) setPreviewFile(prev)
          }
        }}
        hasNext={previewFile ? !!getAdjacentFiles(previewFile).next : false}
        hasPrev={previewFile ? !!getAdjacentFiles(previewFile).prev : false}
      />
    </div>
  )
}

// 檔案網格組件
const FileGrid = ({
  files,
  viewMode,
  selectedFiles,
  onSelectionChange,
  onPreview,
  onDownload,
  onDelete,
  apiBaseUrl,
  apiKey
}: {
  files: FileItem[]
  viewMode: ViewMode
  selectedFiles: Set<string>
  onSelectionChange: (files: Set<string>) => void
  onPreview: (file: FileItem) => void
  onDownload: (fileId: string, filename: string) => void
  onDelete: (fileId: string) => void
  apiBaseUrl: string
  apiKey: string
}) => {
  const { generateThumbnail, isThumbnailLoading, getThumbnail } = useFilePreview(apiBaseUrl, apiKey)
  
  // 縮圖生成
  useEffect(() => {
    const generateThumbnails = async () => {
      if (!apiBaseUrl || !apiKey || files.length === 0) return
      
      const eligibleFiles = files
        .filter(file => isImageFile(file.filename) || isVideoFile(file.filename) || isPdfFile(file.filename))
        .slice(0, 12)
      
      for (let i = 0; i < eligibleFiles.length; i += 3) {
        const batch = eligibleFiles.slice(i, i + 3)
        
        await Promise.allSettled(
          batch.map(async (file) => {
            if (getThumbnail(file.file_id) || isThumbnailLoading(file.file_id)) return
            
            try {
              const controller = new AbortController()
              const timeoutId = setTimeout(() => controller.abort(), 8000)
              
              const response = await fetch(`${apiBaseUrl}/files/${file.file_id}`, {
                headers: { 'X-API-KEY': apiKey, 'Accept': '*/*' },
                mode: 'cors',
                credentials: 'omit',
                signal: controller.signal
              })
              
              clearTimeout(timeoutId)
              
              if (response.ok) {
                const blob = await response.blob()
                if (blob.size > 0) await generateThumbnail(file, blob)
              }
            } catch (error) {
              // 靜默處理
            }
          })
        )
        
        if (i + 3 < eligibleFiles.length) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }
    }
    
    const timeoutId = setTimeout(generateThumbnails, 500)
    return () => clearTimeout(timeoutId)
  }, [files, apiBaseUrl, apiKey, generateThumbnail, getThumbnail, isThumbnailLoading])

  const toggleSelection = useCallback((fileId: string) => {
    const newSelection = new Set(selectedFiles)
    if (newSelection.has(fileId)) {
      newSelection.delete(fileId)
    } else {
      newSelection.add(fileId)
    }
    onSelectionChange(newSelection)
  }, [selectedFiles, onSelectionChange])

  // 縮圖組件
  const FileThumbnail = ({ file, size = 'large' }: { file: FileItem; size?: 'large' | 'small' }) => {
    const { color, bgColor, IconComponent } = getFileIcon(file.file_type || '', file.filename)
    const thumbnail = getThumbnail(file.file_id)
    const isLoading = isThumbnailLoading(file.file_id)
    const canHaveThumbnail = isImageFile(file.filename) || isVideoFile(file.filename) || isPdfFile(file.filename)
    
    if (canHaveThumbnail && thumbnail) {
      return (
        <div className="w-full h-full rounded-lg overflow-hidden relative bg-muted/30">
          <img
            src={thumbnail}
            alt={file.filename}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
          {isVideoFile(file.filename) && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-9 h-9 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center">
                <Play className="w-4 h-4 text-white fill-current ml-0.5" />
              </div>
            </div>
          )}
        </div>
      )
    }
    
    if (canHaveThumbnail && isLoading) {
      return (
        <div className={cn("w-full h-full rounded-lg flex items-center justify-center", bgColor)}>
          <Loader2 className={cn("w-6 h-6 animate-spin", color)} />
        </div>
      )
    }
    
    return (
      <div className={cn("w-full h-full rounded-lg flex items-center justify-center", bgColor)}>
        <IconComponent className={cn(color, size === 'large' ? "w-10 h-10" : "w-5 h-5")} />
      </div>
    )
  }

  // 網格視圖
  if (viewMode === 'grid') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {files.map((file, index) => {
          const { category, bgColor, color } = getFileIcon(file.file_type || '', file.filename)
          const isSelected = selectedFiles.has(file.file_id)
          const uniqueKey = file.file_id || `file-grid-${index}`
          
          return (
            <motion.div
              key={uniqueKey}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.02, duration: 0.2 }}
              className={cn(
                "group relative bg-card/50 backdrop-blur-sm rounded-xl border transition-all duration-200 cursor-pointer overflow-hidden",
                isSelected 
                  ? "border-primary/50 ring-1 ring-primary/20 bg-primary/5" 
                  : "border-border/40 hover:border-border/60 hover:bg-card/80"
              )}
              onClick={() => toggleSelection(file.file_id)}
              onDoubleClick={() => onPreview(file)}
            >
              {/* 縮圖區域 */}
              <div className="aspect-square p-2.5 pb-0">
                <FileThumbnail file={file} />
              </div>

              {/* 選擇指示器 */}
              <div 
                className={cn(
                  "absolute top-2 left-2 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all",
                  isSelected 
                    ? "bg-primary border-primary" 
                    : "bg-background/80 backdrop-blur-sm border-border/50 opacity-0 group-hover:opacity-100"
                )}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleSelection(file.file_id)
                }}
              >
                {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
              </div>

              {/* 懸停操作 */}
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <TooltipButton
                  tooltip="預覽"
                  onClick={(e) => {
                    e?.stopPropagation()
                    onPreview(file)
                  }}
                  className="w-7 h-7 bg-background/80 backdrop-blur-sm border border-border/50 hover:bg-background"
                >
                  <Eye className="w-3.5 h-3.5" />
                </TooltipButton>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-7 h-7 bg-background/80 backdrop-blur-sm border border-border/50 hover:bg-background"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-35">
                    <DropdownMenuItem onClick={() => onDownload(file.file_id, file.filename)}>
                      <Download className="w-4 h-4 mr-2" />
                      下載
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/api/files/${file.file_id}`)
                        toast.success('連結已複製')
                      }}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      複製連結
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem 
                      onClick={() => {
                        if (confirm(`確定刪除「${file.filename}」？`)) onDelete(file.file_id)
                      }}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      刪除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* 檔案資訊 */}
              <div className="p-2.5 pt-2 space-y-0.5">
                <p className="text-sm font-medium truncate" title={file.filename}>
                  {file.filename}
                </p>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{formatFileSize(file.file_size || 0)}</span>
                  <span>{formatTimeAgo(file.upload_time)}</span>
                </div>
              </div>

              {/* 收藏標記 */}
              {file.is_favorite && (
                <div className="absolute top-2 left-9">
                  <Star className="w-3.5 h-3.5 text-amber-400 fill-current" />
                </div>
              )}
            </motion.div>
          )
        })}
      </div>
    )
  }

  // 列表視圖
  return (
    <div className="space-y-1">
      {files.map((file, index) => {
        const { category, bgColor, color, IconComponent } = getFileIcon(file.file_type || '', file.filename)
        const isSelected = selectedFiles.has(file.file_id)
        const uniqueKey = file.file_id || `file-list-${index}`
        
        return (
          <motion.div
            key={uniqueKey}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.02, duration: 0.2 }}
            className={cn(
              "group flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all",
              isSelected 
                ? "bg-primary/5 ring-1 ring-primary/20" 
                : "hover:bg-muted/30"
            )}
            onClick={() => toggleSelection(file.file_id)}
            onDoubleClick={() => onPreview(file)}
          >
            {/* 選擇指示器 */}
            <div 
              className={cn(
                "w-4 h-4 rounded border flex items-center justify-center transition-all shrink-0",
                isSelected 
                  ? "bg-primary border-primary" 
                  : "border-border/50 group-hover:border-border"
              )}
              onClick={(e) => {
                e.stopPropagation()
                toggleSelection(file.file_id)
              }}
            >
              {isSelected && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
            </div>

            {/* 檔案圖示 */}
            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", bgColor)}>
              <IconComponent className={cn("w-4 h-4", color)} />
            </div>

            {/* 檔案名稱 */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{file.filename}</p>
            </div>

            {/* 大小 */}
            <span className="text-xs text-muted-foreground w-16 text-right hidden sm:block">
              {formatFileSize(file.file_size || 0)}
            </span>

            {/* 時間 */}
            <span className="text-xs text-muted-foreground w-20 text-right hidden md:block">
              {formatTimeAgo(file.upload_time)}
            </span>

            {/* 操作按鈕 */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <TooltipButton
                tooltip="預覽"
                onClick={(e) => {
                  e?.stopPropagation()
                  onPreview(file)
                }}
                className="w-7 h-7"
              >
                <Eye className="w-3.5 h-3.5" />
              </TooltipButton>
              <TooltipButton
                tooltip="下載"
                onClick={(e) => {
                  e?.stopPropagation()
                  onDownload(file.file_id, file.filename)
                }}
                className="w-7 h-7"
              >
                <Download className="w-3.5 h-3.5" />
              </TooltipButton>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-7 h-7"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="w-3.5 h-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-35">
                  <DropdownMenuItem 
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/api/files/${file.file_id}`)
                      toast.success('連結已複製')
                    }}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    複製連結
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={() => {
                      if (confirm(`確定刪除「${file.filename}」？`)) onDelete(file.file_id)
                    }}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    刪除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}

export default FileManager

// 導出類型定義
export type { FileItem, FileStats, FileManagerProps }