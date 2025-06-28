'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { 
  Search, Plus, FileText, Image, Loader, Eye, ArrowDown, Trash2, 
  Upload, FolderOpen, Grid3X3, List, Filter, SortAsc, SortDesc,
  Download, Share2, Star, Clock, FileType, Info, X, Maximize2,
  ZoomIn, ZoomOut, RotateCw, ChevronLeft, ChevronRight, Play,
  Volume2, VolumeX, Pause, Copy, Edit3, Tag, Archive, RefreshCw,
  MoreHorizontal, CheckCircle2, AlertCircle, XCircle
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

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

// 檔案類型分類 - 簡化顏色
const FILE_TYPES = {
  image: {
    extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'],
    icon: Image,
    color: 'bg-slate-500',
    label: '圖片'
  },
  document: {
    extensions: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'],
    icon: FileText,
    color: 'bg-slate-600',
    label: '文檔'
  },
  video: {
    extensions: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv'],
    icon: Play,
    color: 'bg-slate-700',
    label: '視頻'
  },
  audio: {
    extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'],
    icon: Volume2,
    color: 'bg-slate-800',
    label: '音頻'
  },
  archive: {
    extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'],
    icon: Archive,
    color: 'bg-gray-500',
    label: '壓縮檔'
  },
  code: {
    extensions: ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'html', 'css', 'scss', 'json', 'xml'],
    icon: FileType,
    color: 'bg-gray-600',
    label: '代碼'
  }
}

// 排序選項
const SORT_OPTIONS = [
  { value: 'name_asc', label: '名稱 A-Z' },
  { value: 'name_desc', label: '名稱 Z-A' },
  { value: 'date_desc', label: '最新上傳' },
  { value: 'date_asc', label: '最早上傳' },
  { value: 'size_desc', label: '檔案大小 (大到小)' },
  { value: 'size_asc', label: '檔案大小 (小到大)' },
  { value: 'type', label: '檔案類型' }
]

// 視圖模式
type ViewMode = 'grid' | 'list'

// 工具函數
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
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
  const colorClass = config?.color || 'bg-gray-500'
  
  return {
    icon: <IconComponent className="w-4 h-4" />,
    color: colorClass,
    category: config?.label || '其他'
  }
}

export const formatTimeAgo = (timestamp: string): string => {
  const now = new Date()
  const time = new Date(timestamp)
  const diffInSeconds = Math.floor((now.getTime() - time.getTime()) / 1000)
  
  if (diffInSeconds < 60) return '剛剛'
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} 分鐘前`
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} 小時前`
  if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)} 天前`
  
  return time.toLocaleDateString('zh-CN')
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
        headers: { 'X-API-KEY': apiKey }
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
  size = "sm" as const,
  disabled = false,
  ...props 
}: {
  children: React.ReactNode
  tooltip: string
  onClick?: (e?: React.MouseEvent<HTMLButtonElement>) => void
  className?: string
  variant?: "default" | "secondary" | "ghost" | "outline"
  size?: "sm" | "default" | "lg" | "icon"
  disabled?: boolean
  [key: string]: any
}) => {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={variant}
            size={size}
            onClick={onClick}
            className={className}
            disabled={disabled}
            {...props}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

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
          <XCircle className="w-12 h-12 text-red-400" />
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
            <Loader className="w-8 h-8 text-white animate-spin" />
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
          <Loader className="w-8 h-8 text-white animate-spin" />
          <p className="text-white text-sm">載入 PDF 中...</p>
        </div>
      </div>
    )
  }
  
  if (error || !src) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <div className="w-24 h-24 rounded-full bg-red-500/20 flex items-center justify-center">
          <XCircle className="w-12 h-12 text-red-400" />
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
            <Loader className="w-8 h-8 text-white animate-spin" />
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
          <Loader className="w-8 h-8 text-white animate-spin" />
          <p className="text-white text-sm">載入文本中...</p>
        </div>
      </div>
    )
  }
  
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <div className="w-24 h-24 rounded-full bg-red-500/20 flex items-center justify-center">
          <XCircle className="w-12 h-12 text-red-400" />
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
                className="flex hover:bg-white/5 min-h-[1.5rem] group"
              >
                {lineNumbers && (
                  <div className="flex-shrink-0 w-12 text-white/40 text-right pr-3 py-0.5 select-none group-hover:text-white/60">
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
            未找到匹配 "{searchTerm}" 的內容
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
      
      img.onload = () => {
        // 計算縮圖尺寸
        const { width, height } = img
        const ratio = Math.min(maxSize / width, maxSize / height)
        const newWidth = width * ratio
        const newHeight = height * ratio
        
        canvas.width = newWidth
        canvas.height = newHeight
        
        // 繪製縮圖
        ctx?.drawImage(img, 0, 0, newWidth, newHeight)
        resolve(canvas.toDataURL('image/jpeg', 0.8))
      }
      
      img.onerror = reject
      img.src = URL.createObjectURL(file)
    })
  },
  
  // 生成視頻縮圖
  generateVideoThumbnail: (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video')
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      
      video.onloadedmetadata = () => {
        video.currentTime = Math.min(video.duration * 0.1, 1) // 取前10%或1秒的幀
      }
      
      video.onseeked = () => {
        canvas.width = Math.min(video.videoWidth, 200)
        canvas.height = Math.min(video.videoHeight, 200)
        
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.8))
        
        // 清理
        URL.revokeObjectURL(video.src)
      }
      
      video.onerror = reject
      video.src = URL.createObjectURL(file)
      video.muted = true
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
  
  const generateThumbnail = useCallback(async (file: FileItem, fileBlob?: Blob) => {
    const fileId = file.file_id
    
    if (thumbnails[fileId] || loadingThumbnails.has(fileId)) {
      return thumbnails[fileId]
    }
    
    setLoadingThumbnails(prev => new Set(prev).add(fileId))
    
    try {
      let thumbnailUrl = ''
      
      if (!fileBlob && apiBaseUrl && apiKey) {
        // 如果沒有提供blob，先從API獲取（需要傳遞 API Key）
        const response = await fetch(`${apiBaseUrl}/files/${fileId}`, {
          headers: { 'X-API-KEY': apiKey }
        })
        if (!response.ok) throw new Error('Failed to fetch file')
        fileBlob = await response.blob()
      }
      
      if (!fileBlob) {
        throw new Error('無法獲取檔案內容')
      }
      
      const tempFile = new File([fileBlob], file.filename, { type: fileBlob.type })
      
      if (isImageFile(file.filename)) {
        thumbnailUrl = await ThumbnailGenerator.generateImageThumbnail(tempFile)
      } else if (isVideoFile(file.filename)) {
        thumbnailUrl = await ThumbnailGenerator.generateVideoThumbnail(tempFile)
      } else if (file.filename.toLowerCase().endsWith('.pdf')) {
        thumbnailUrl = await ThumbnailGenerator.generatePdfThumbnail(tempFile)
      }
      
      if (thumbnailUrl) {
        setThumbnails(prev => ({ ...prev, [fileId]: thumbnailUrl }))
      }
      
      return thumbnailUrl
    } catch (error) {
      console.error('縮圖生成失敗:', error)
      return null
    } finally {
      setLoadingThumbnails(prev => {
        const newSet = new Set(prev)
        newSet.delete(fileId)
        return newSet
      })
    }
  }, [thumbnails, loadingThumbnails, apiBaseUrl, apiKey])
  
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
      const response = await fetch(`${apiBaseUrl}/files/${fileId}`, {
        headers: { 'X-API-KEY': apiKey || '' }
      })
      if (!response.ok) throw new Error('文件获取失败')
      const blob = await response.blob()
      return URL.createObjectURL(blob)
    } catch (error) {
      console.error('获取文件失败:', error)
      throw error
    }
  }, [apiBaseUrl, apiKey])

  // 新增：圖片預覽時 fetch blob 並產生本地 URL
  useEffect(() => {
    if (isOpen && file && isImageFile(file.filename)) {
      let revokeUrl: string | null = null
      setFetchingImage(true)
      fetch(getFileUrl(file.file_id), {
        headers: { 'X-API-KEY': apiKey || '' }
      })
        .then(res => {
          if (!res.ok) throw new Error('圖片獲取失敗')
          return res.blob()
        })
        .then(blob => {
          const url = URL.createObjectURL(blob)
          setImageBlobUrl(url)
          revokeUrl = url
        })
        .catch(() => {
          setImageLoadError(true)
        })
        .finally(() => {
          setImageLoading(false)
          setFetchingImage(false)
        })
      return () => {
        if (revokeUrl) URL.revokeObjectURL(revokeUrl)
      }
    } else {
      setImageBlobUrl(null)
    }
  }, [isOpen, file, apiKey, getFileUrl])

  // 新增：文本文件内容加载
  useEffect(() => {
    if (isOpen && file && isTextFile(file.filename)) {
      setLoadingText(true)
      setTextError(false)
      fetch(getFileUrl(file.file_id), {
        headers: { 'X-API-KEY': apiKey || '' }
      })
        .then(res => {
          if (!res.ok) throw new Error('文件獲取失敗')
          return res.text()
        })
        .then(text => {
          setTextContent(text)
        })
        .catch(() => {
          setTextError(true)
        })
        .finally(() => {
          setLoadingText(false)
        })
    } else {
      setTextContent('')
    }
  }, [isOpen, file, apiKey, getFileUrl])

  // 新增：媒体文件 blob URL 获取
  useEffect(() => {
    if (isOpen && file && (isVideoFile(file.filename) || isAudioFile(file.filename))) {
      let revokeUrl: string | null = null
      setLoadingMedia(true)
      setMediaError(false)
      
      getAuthenticatedFileUrl(file.file_id)
        .then(url => {
          setMediaBlobUrl(url)
          revokeUrl = url
        })
        .catch(() => {
          setMediaError(true)
        })
        .finally(() => {
          setLoadingMedia(false)
        })
      
      return () => {
        if (revokeUrl) URL.revokeObjectURL(revokeUrl)
      }
    } else {
      setMediaBlobUrl(null)
    }
  }, [isOpen, file, getAuthenticatedFileUrl])

  // 新增：PDF 文件 blob URL 获取
  useEffect(() => {
    if (isOpen && file && isPdfFile(file.filename)) {
      let revokeUrl: string | null = null
      setLoadingPdf(true)
      setPdfError(false)
      
      getAuthenticatedFileUrl(file.file_id)
        .then(url => {
          setPdfBlobUrl(url)
          revokeUrl = url
        })
        .catch(() => {
          setPdfError(true)
        })
        .finally(() => {
          setLoadingPdf(false)
        })
      
      return () => {
        if (revokeUrl) URL.revokeObjectURL(revokeUrl)
      }
    } else {
      setPdfBlobUrl(null)
    }
  }, [isOpen, file, getAuthenticatedFileUrl])

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
              <Loader className="w-8 h-8 text-white animate-spin mb-2" />
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
              <Loader className="w-8 h-8 text-white animate-spin" />
              <p className="text-white text-sm">載入視頻中...</p>
            </div>
          </div>
        )
      }
      
      if (mediaError || !mediaBlobUrl) {
        return (
          <div className="flex flex-col items-center justify-center h-full space-y-4">
            <div className="w-24 h-24 rounded-full bg-red-500/20 flex items-center justify-center">
              <XCircle className="w-12 h-12 text-red-400" />
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
              <Loader className="w-8 h-8 text-white animate-spin" />
              <p className="text-white text-sm">載入音頻中...</p>
            </div>
          </div>
        )
      }
      
      if (mediaError || !mediaBlobUrl) {
        return (
          <div className="flex flex-col items-center justify-center h-full space-y-4">
            <div className="w-24 h-24 rounded-full bg-red-500/20 flex items-center justify-center">
              <XCircle className="w-12 h-12 text-red-400" />
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
            className="w-48 h-48 bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 rounded-full flex items-center justify-center shadow-2xl relative overflow-hidden"
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
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-8">
        <motion.div 
          className={cn(
            "w-48 h-48 rounded-2xl flex items-center justify-center shadow-2xl relative",
            getFileIcon(file.file_type || '', file.filename).color
          )}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent rounded-2xl" />
          <div className="text-white text-6xl relative z-10">
            {getFileIcon(file.file_type || '', file.filename).icon}
          </div>
        </motion.div>
        
        <div className="text-center space-y-4 max-w-2xl">
          <h3 className="text-3xl font-medium text-white">{file.filename}</h3>
          <div className="flex items-center justify-center gap-4 text-white/70 text-lg">
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
          <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 to-transparent p-6 z-10">
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
  const [sortBy, setSortBy] = useState('date_desc')
  const [filterType, setFilterType] = useState('all')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 计算统计信息的工具函数
  const calculateStats = (fileList: FileItem[]): FileStats => {
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
  }

  // 加载文件列表
  const loadFiles = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${apiBaseUrl}/files?page_size=1000`, {
        headers: { 'X-API-KEY': apiKey }
      })
      if (response.ok) {
        const fileList = await response.json()
        setFiles(fileList)
        
        // 更新统计
        const stats = calculateStats(fileList)
        onStatsUpdate(stats)
      } else {
        toast.error('加载文件列表失败')
      }
    } catch (error) {
      console.error('Error loading files:', error)
      toast.error('加载文件失败')
    } finally {
      setLoading(false)
    }
  }

  // 上传文件
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files
    if (!selectedFiles || selectedFiles.length === 0) return

    setUploading(true)
    const toastId = toast.loading(`正在上传 ${selectedFiles.length} 个文件...`)
    
    try {
      let successCount = 0
      
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i]
        const formData = new FormData()
        formData.append('file', file)
        formData.append('description', `Uploaded ${file.name}`)

        const response = await fetch(`${apiBaseUrl}/files/upload`, {
          method: 'POST',
          headers: { 'X-API-KEY': apiKey },
          body: formData
        })

        if (response.ok) {
          successCount++
        } else {
          console.error(`上传 ${file.name} 失败`)
        }
      }
      
      toast.success(`成功上传 ${successCount} 个文件`, { id: toastId })
      loadFiles()
    } catch (error) {
      console.error('Upload error:', error)
      toast.error('文件上传失败', { id: toastId })
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  // 删除文件
  const deleteFile = async (fileId: string) => {
    try {
      const response = await fetch(`${apiBaseUrl}/files/${fileId}`, {
        method: 'DELETE',
        headers: { 'X-API-KEY': apiKey }
      })
      
      if (response.ok) {
        toast.success('文件删除成功')
        loadFiles()
      } else {
        toast.error('文件删除失败')
      }
    } catch (error) {
      console.error('Delete error:', error)
      toast.error('文件删除失败')
    }
  }

  // 批量删除
  const deleteSelectedFiles = async () => {
    if (selectedFiles.size === 0) return
    
    const confirmed = confirm(`确定删除选中的 ${selectedFiles.size} 个文件吗？`)
    if (!confirmed) return
    
    const toastId = toast.loading('正在删除文件...')
    try {
      let successCount = 0
      
      for (const fileId of selectedFiles) {
        const response = await fetch(`${apiBaseUrl}/files/${fileId}`, {
          method: 'DELETE',
          headers: { 'X-API-KEY': apiKey }
        })
        
        if (response.ok) {
          successCount++
        }
      }
      
      toast.success(`成功删除 ${successCount} 个文件`, { id: toastId })
      setSelectedFiles(new Set())
      loadFiles()
    } catch (error) {
      toast.error('批量删除失败', { id: toastId })
    }
  }

  // 下载文件
  const downloadFile = async (fileId: string, filename: string) => {
    try {
      const response = await fetch(`${apiBaseUrl}/files/${fileId}`, {
        headers: { 'X-API-KEY': apiKey }
      })
      
      if (response.ok) {
        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
        toast.success('文件下载成功')
      } else {
        toast.error('文件下载失败')
      }
    } catch (error) {
      console.error('Download error:', error)
      toast.error('文件下载失败')
    }
  }

  // 预览文件
  const previewFileHandler = (file: FileItem) => {
    setPreviewFile(file)
    setShowPreview(true)
  }

  // 获取下一个/上一个文件
  const getAdjacentFiles = (currentFile: FileItem) => {
    const currentIndex = filteredAndSortedFiles.findIndex(f => f.file_id === currentFile.file_id)
    return {
      prev: currentIndex > 0 ? filteredAndSortedFiles[currentIndex - 1] : null,
      next: currentIndex < filteredAndSortedFiles.length - 1 ? filteredAndSortedFiles[currentIndex + 1] : null
    }
  }

  // 排序和过滤逻辑
  const filteredAndSortedFiles = files
    .filter(file => {
      // 确保文件有有效的 ID
      if (!file.file_id || file.file_id.trim() === '') {
        console.warn('发现没有有效 file_id 的文件:', file)
        return false
      }
      
      // 搜索过滤
      const searchMatch = file.filename?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         file.description?.toLowerCase().includes(searchQuery.toLowerCase())
      
      // 类型过滤
      const typeMatch = filterType === 'all' || getFileCategory(file.filename) === filterType
      
      return searchMatch && typeMatch
    })
    // 去重：移除重复的 file_id
    .reduce((uniqueFiles: FileItem[], currentFile) => {
      const existingFileIndex = uniqueFiles.findIndex(f => f.file_id === currentFile.file_id)
      if (existingFileIndex === -1) {
        uniqueFiles.push(currentFile)
      } else {
        console.warn('发现重复的 file_id:', currentFile.file_id)
      }
      return uniqueFiles
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
        case 'type':
          return getFileCategory(a.filename).localeCompare(getFileCategory(b.filename))
        default:
          return 0
      }
    })

  // 获取类型统计
  const typeStats = files.reduce((acc, file) => {
    const category = getFileCategory(file.filename)
    acc[category] = (acc[category] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  // 组件挂载时加载文件
  useEffect(() => {
    loadFiles()
  }, [])

  return (
    <div className="h-full flex flex-col bg-background">
      {/* 頭部區域 */}
      <div className="border-b border-border bg-background">
        <div className="p-4">
          {/* 標題和操作按鈕 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <FolderOpen className="w-4 h-4 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">檔案庫</h1>
                <p className="text-sm text-muted-foreground">
                  管理和預覽你的文件資源
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {selectedFiles.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={deleteSelectedFiles}
                  className="gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  删除选中 ({selectedFiles.size})
                </Button>
              )}
              
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
                className="gap-2"
              >
                {uploading ? (
                  <Loader className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                {uploading ? '上传中...' : '上传文件'}
              </Button>
            </div>
          </div>

          {/* 統計卡片 - 統一簡潔設計 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            <Card className="p-2.5">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-muted rounded-md flex items-center justify-center">
                  <FileText className="w-3 h-3 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">總數</div>
                  <div className="text-sm font-semibold">{files.length}</div>
                </div>
              </div>
            </Card>
            
            <Card className="p-2.5">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-muted rounded-md flex items-center justify-center">
                  <Archive className="w-3 h-3 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">總大小</div>
                  <div className="text-sm font-semibold">
                    {formatFileSize(files.reduce((sum, file) => sum + (file.file_size || 0), 0))}
                  </div>
                </div>
              </div>
            </Card>
            
            <Card className="p-2.5">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-muted rounded-md flex items-center justify-center">
                  <Clock className="w-3 h-3 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">本週</div>
                  <div className="text-sm font-semibold">
                    {files.filter(file => {
                      const uploadDate = new Date(file.upload_time)
                      const weekAgo = new Date()
                      weekAgo.setDate(weekAgo.getDate() - 7)
                      return uploadDate > weekAgo
                    }).length}
                  </div>
                </div>
              </div>
            </Card>
            
            <Card className="p-2.5">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-muted rounded-md flex items-center justify-center">
                  <Tag className="w-3 h-3 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">類型</div>
                  <div className="text-sm font-semibold">{Object.keys(typeStats).length}</div>
                </div>
              </div>
            </Card>
          </div>

          {/* 搜索和過濾工具列 - 緊湊設計 */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
            {/* 搜索框 */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="搜索文件..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-8 py-1.5 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring focus:border-transparent"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            
            <div className="flex items-center gap-1.5">
              {/* 類型過濾 */}
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-28 h-8 text-xs">
                  <Filter className="w-3 h-3 mr-1" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" key="all">全部</SelectItem>
                  {Object.entries(FILE_TYPES).map(([key, config]) => (
                    <SelectItem value={key} key={key}>
                      {config.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {/* 排序 */}
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-32 h-8 text-xs">
                  <SortDesc className="w-3 h-3 mr-1" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map(option => (
                    <SelectItem value={option.value} key={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {/* 視圖模式切換 */}
              <div className="flex border border-input rounded-md overflow-hidden">
                <Button
                  variant={viewMode === 'grid' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('grid')}
                  className="h-8 px-2 rounded-none border-0"
                >
                  <Grid3X3 className="w-3 h-3" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                  className="h-8 px-2 rounded-none border-0"
                >
                  <List className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </div>

          {/* 結果統計 - 簡化 */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50 text-xs text-muted-foreground">
            <span>
              共 {filteredAndSortedFiles.length} 個文件
              {searchQuery && ` · 搜索: "${searchQuery}"`}
            </span>
            {filteredAndSortedFiles.length > 0 && (
              <span>
                {formatFileSize(filteredAndSortedFiles.reduce((sum, file) => sum + (file.file_size || 0), 0))}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 文件列表區域 - 調整 padding */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center gap-2">
              <Loader className="w-5 h-5 animate-spin" />
              <span>加載中...</span>
            </div>
          </div>
        ) : filteredAndSortedFiles.length === 0 ? (
          <motion.div 
            className="flex flex-col items-center justify-center h-64"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="w-16 h-16 bg-muted/50 rounded-lg flex items-center justify-center mb-4">
              <FolderOpen className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">
              {files.length === 0 ? '暂无文件' : '未找到匹配的文件'}
            </h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              {files.length === 0 
                ? '點擊上方"上傳文件"按鈕開始添加文件'
                : '嘗試調整搜索關鍵詞或篩選條件'
              }
            </p>
            {files.length === 0 && (
              <Button
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 gap-2"
                size="sm"
              >
                <Upload className="w-4 h-4" />
                立即上傳
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
  
  // 當組件掛載時，為圖片和視頻檔案生成縮圖
  useEffect(() => {
    const generateThumbnailsForVisibleFiles = async () => {
      for (const file of files.slice(0, 20)) { // 只為前20個檔案生成縮圖以優化性能
        if (isImageFile(file.filename) || isVideoFile(file.filename) || file.filename.toLowerCase().endsWith('.pdf')) {
          try {
            // 獲取檔案並生成縮圖
            const response = await fetch(`${apiBaseUrl}/files/${file.file_id}`, {
              headers: { 'X-API-KEY': apiKey }
            })
            if (response.ok) {
              const blob = await response.blob()
              await generateThumbnail(file, blob)
            }
          } catch (error) {
            console.error('生成縮圖失敗:', error)
          }
        }
      }
    }
    
    generateThumbnailsForVisibleFiles()
  }, [files, apiBaseUrl, apiKey, generateThumbnail])

  const toggleSelection = (fileId: string) => {
    const newSelection = new Set(selectedFiles)
    if (newSelection.has(fileId)) {
      newSelection.delete(fileId)
    } else {
      newSelection.add(fileId)
    }
    onSelectionChange(newSelection)
  }

  const handleSelectAll = () => {
    if (selectedFiles.size === files.length) {
      onSelectionChange(new Set())
    } else {
      onSelectionChange(new Set(files.map(f => f.file_id)))
    }
  }

  // 渲染縮圖的組件
  const FileThumbnail = ({ file, size = 'large' }: { file: FileItem; size?: 'large' | 'small' }) => {
    const { icon, color, category } = getFileIcon(file.file_type || '', file.filename)
    const thumbnail = getThumbnail(file.file_id)
    const isLoading = isThumbnailLoading(file.file_id)
    const canHaveThumbnail = isImageFile(file.filename) || isVideoFile(file.filename) || file.filename.toLowerCase().endsWith('.pdf')
    
    const iconSize = size === 'large' ? 'text-2xl' : 'text-lg'
    const playIconSize = size === 'large' ? 'w-6 h-6' : 'w-4 h-4'
    const playPadding = size === 'large' ? 'p-2' : 'p-1'
    const eyeIconSize = size === 'large' ? 'w-4 h-4' : 'w-3 h-3'
    const loaderSize = size === 'large' ? 'w-6 h-6' : 'w-4 h-4'
    
    if (canHaveThumbnail && thumbnail) {
      return (
        <div className="w-full h-full rounded-lg overflow-hidden relative">
          <img
            src={thumbnail}
            alt={file.filename}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
          
          {/* 視頻檔案顯示播放圖標 */}
          {isVideoFile(file.filename) && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className={cn("bg-black/50 rounded-full", playPadding)}>
                <Play className={cn(playIconSize, "text-white fill-current")} />
              </div>
            </div>
          )}
          
          {/* 預覽遮罩 - 只在大尺寸時顯示 */}
          {size === 'large' && (
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
              <div className="bg-white/20 backdrop-blur-sm rounded-full p-2">
                <Eye className={cn(eyeIconSize, "text-white")} />
              </div>
            </div>
          )}
        </div>
      )
    }
    
    if (canHaveThumbnail && isLoading) {
      return (
        <div className="w-full h-full rounded-lg bg-muted/50 flex items-center justify-center">
          <Loader className={cn(loaderSize, "text-muted-foreground animate-spin")} />
        </div>
      )
    }
    
    // 默認圖標顯示
    return (
      <div className={cn("w-full h-full rounded-lg flex items-center justify-center", color)}>
        <div className={cn("text-white", iconSize)}>{icon}</div>
      </div>
    )
  }

  if (viewMode === 'grid') {
    return (
      <div className="space-y-4">
        {/* 全選控制 - 簡化 */}
        {files.length > 0 && (
          <motion.div 
            className="flex items-center justify-between p-3 bg-card border border-border rounded-lg"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={selectedFiles.size === files.length && files.length > 0}
                onChange={handleSelectAll}
                className="rounded border-input w-4 h-4"
              />
              <Label className="text-sm font-medium">
                {selectedFiles.size > 0 ? (
                  <span className="text-primary">已選擇 {selectedFiles.size} 個文件</span>
                ) : (
                  '全選文件'
                )}
              </Label>
            </div>
            
            {selectedFiles.size > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
                  {formatFileSize(files.filter(f => selectedFiles.has(f.file_id)).reduce((sum, file) => sum + (file.file_size || 0), 0))}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const selectedFileList = files.filter(f => selectedFiles.has(f.file_id))
                    selectedFileList.forEach(file => onDownload(file.file_id, file.filename))
                  }}
                  className="gap-1"
                >
                  <Download className="w-3 h-3" />
                  批量下載
                </Button>
              </div>
            )}
          </motion.div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {files.map((file, index) => {
            const { icon, color, category } = getFileIcon(file.file_type || '', file.filename)
            const isSelected = selectedFiles.has(file.file_id)
            const uniqueKey = file.file_id || `file-grid-${index}-${file.filename}`
            return (
              <motion.div
                key={uniqueKey}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.02 }}
                className={cn(
                  "group relative bg-card border border-border rounded-lg p-4 hover:shadow-md hover:shadow-primary/5 transition-all duration-200 cursor-pointer overflow-hidden",
                  isSelected && "ring-1 ring-primary border-primary shadow-sm shadow-primary/10"
                )}
                onClick={() => toggleSelection(file.file_id)}
                onDoubleClick={() => onPreview(file)}
              >
                {/* 背景漸變 */}
                <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                
                {/* 選擇框 */}
                <div className="absolute top-3 left-3 z-10">
                  <div className={cn(
                    "w-5 h-5 rounded border flex items-center justify-center transition-all duration-200",
                    isSelected 
                      ? "bg-primary border-primary" 
                      : "bg-background/90 border-border group-hover:border-primary/50"
                  )}>
                    {isSelected && <CheckCircle2 className="w-3 h-3 text-primary-foreground" />}
                  </div>
                </div>

                {/* 文件圖標或縮圖 */}
                <div className="aspect-square mb-3 relative">
                  <FileThumbnail file={file} />

                  {/* 懸停操作按鈕 */}
                  <div className="absolute inset-0 bg-black/60 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200 flex items-center justify-center gap-2">
                    <TooltipButton
                      tooltip="預覽"
                      onClick={(e?: React.MouseEvent<HTMLButtonElement>) => {
                        e?.stopPropagation()
                        onPreview(file)
                      }}
                      className="bg-white/20 text-white hover:bg-white/30 border-0 backdrop-blur-sm"
                      size="sm"
                    >
                      <Eye className="w-4 h-4" />
                    </TooltipButton>
                    
                    <TooltipButton
                      tooltip="下載"
                      onClick={(e?: React.MouseEvent<HTMLButtonElement>) => {
                        e?.stopPropagation()
                        onDownload(file.file_id, file.filename)
                      }}
                      className="bg-white/20 text-white hover:bg-white/30 border-0 backdrop-blur-sm"
                      size="sm"
                    >
                      <Download className="w-4 h-4" />
                    </TooltipButton>
                  </div>
                </div>

                {/* 文件資訊 */}
                <div className="space-y-1 relative z-10">
                  <div className="font-medium text-sm truncate pr-6" title={file.filename}>
                    {file.filename}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{formatFileSize(file.file_size || 0)}</span>
                    <span>{formatTimeAgo(file.upload_time)}</span>
                  </div>
                </div>

                {/* 類型標籤 */}
                <Badge 
                  variant="secondary" 
                  className="absolute top-3 right-3 text-xs bg-background/90 backdrop-blur-sm border-0"
                >
                  {category}
                </Badge>

                {/* 收藏標誌 */}
                {file.is_favorite && (
                  <div className="absolute bottom-3 right-3">
                    <Star className="w-4 h-4 text-yellow-500 fill-current" />
                  </div>
                )}
              </motion.div>
            )
          })}
        </div>
      </div>
    )
  }

  // 列表視圖
  return (
    <div className="space-y-4">
      {/* 全選控制 */}
      {files.length > 0 && (
        <motion.div 
          className="flex items-center justify-between p-4 bg-card/50 backdrop-blur-sm border border-border/50 rounded-xl"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={selectedFiles.size === files.length && files.length > 0}
              onChange={handleSelectAll}
              className="rounded border-input w-4 h-4"
            />
            <Label className="text-sm font-medium">
              {selectedFiles.size > 0 ? (
                <span className="text-primary">已選擇 {selectedFiles.size} 個文件</span>
              ) : (
                '全選文件'
              )}
            </Label>
          </div>
          
          {selectedFiles.size > 0 && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
                {formatFileSize(files.filter(f => selectedFiles.has(f.file_id)).reduce((sum, file) => sum + (file.file_size || 0), 0))}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const selectedFileList = files.filter(f => selectedFiles.has(f.file_id))
                  selectedFileList.forEach(file => onDownload(file.file_id, file.filename))
                }}
                className="gap-1"
              >
                <Download className="w-3 h-3" />
                批量下載
              </Button>
            </div>
          )}
        </motion.div>
      )}

      <div className="space-y-2">
        {files.map((file, index) => {
          const { icon, color, category } = getFileIcon(file.file_type || '', file.filename)
          const isSelected = selectedFiles.has(file.file_id)
          const uniqueKey = file.file_id || `file-list-${index}-${file.filename}`
          return (
            <motion.div
              key={uniqueKey}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.02 }}
              className={cn(
                "group flex items-center gap-4 p-4 bg-card/60 backdrop-blur-sm border border-border/60 rounded-xl hover:shadow-md hover:shadow-primary/10 transition-all duration-300 cursor-pointer",
                isSelected && "ring-2 ring-primary border-primary shadow-lg shadow-primary/20"
              )}
              onClick={() => toggleSelection(file.file_id)}
              onDoubleClick={() => onPreview(file)}
            >
              {/* 選擇框 */}
              <div className={cn(
                "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-200",
                isSelected 
                  ? "bg-primary border-primary" 
                  : "bg-background/80 border-border group-hover:border-primary/50"
              )}>
                {isSelected && <CheckCircle2 className="w-3 h-3 text-primary-foreground" />}
              </div>

              {/* 文件圖標或縮圖 */}
              <div className="flex-shrink-0 relative">
                <div className="w-12 h-12">
                  <FileThumbnail file={file} size="small" />
                </div>
              </div>

              {/* 文件資訊 */}
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 mb-1">
                  <div className="font-medium truncate flex-1">{file.filename}</div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant="secondary" className="text-xs bg-background/60 border-border/60">
                      {category}
                    </Badge>
                    {file.is_favorite && (
                      <Star className="w-4 h-4 text-yellow-500 fill-current" />
                    )}
                  </div>
                </div>
                <div className="text-sm text-muted-foreground flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <Archive className="w-3 h-3" />
                    {formatFileSize(file.file_size || 0)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatTimeAgo(file.upload_time)}
                  </span>
                  {file.description && (
                    <span className="truncate max-w-xs flex items-center gap-1">
                      <Info className="w-3 h-3 flex-shrink-0" />
                      {file.description}
                    </span>
                  )}
                </div>
              </div>

              {/* 操作按鈕 */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                <TooltipButton
                  tooltip="預覽"
                  onClick={() => onPreview(file)}
                  variant="ghost"
                  size="sm"
                  className="hover:bg-primary/10 hover:text-primary"
                >
                  <Eye className="w-4 h-4" />
                </TooltipButton>
                
                <TooltipButton
                  tooltip="下載"
                  onClick={() => onDownload(file.file_id, file.filename)}
                  variant="ghost"
                  size="sm"
                  className="hover:bg-primary/10 hover:text-primary"
                >
                  <Download className="w-4 h-4" />
                </TooltipButton>
                
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="hover:bg-primary/10 hover:text-primary">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={() => onPreview(file)} className="gap-2">
                      <Eye className="w-4 h-4" />
                      預覽
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onDownload(file.file_id, file.filename)} className="gap-2">
                      <Download className="w-4 h-4" />
                      下載
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}${apiBaseUrl}/files/${file.file_id}`)
                        toast.success('連結已複製到剪貼板')
                      }}
                      className="gap-2"
                    >
                      <Copy className="w-4 h-4" />
                      複製連結
                    </DropdownMenuItem>
                    <DropdownMenuItem className="gap-2">
                      <Edit3 className="w-4 h-4" />
                      重命名
                    </DropdownMenuItem>
                    <DropdownMenuItem className="gap-2">
                      <Star className="w-4 h-4" />
                      {file.is_favorite ? '取消收藏' : '加入收藏'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem 
                      onClick={() => {
                        if (confirm(`確定刪除文件"${file.filename}"嗎？`)) {
                          onDelete(file.file_id)
                        }
                      }}
                      className="text-destructive focus:text-destructive gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      刪除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

export default FileManager

// 導出類型定義以供其他組件使用
export type { FileItem, FileStats, FileManagerProps }
