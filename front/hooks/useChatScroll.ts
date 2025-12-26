'use client'

import { useState, useCallback, useRef } from 'react'

interface UseScrollOptions {
  threshold?: number // 距離底部多少像素算作"在底部"
}

interface UseScrollReturn {
  isAtBottom: boolean
  showScrollToBottom: boolean
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  messagesEndRef: React.RefObject<HTMLDivElement | null>
  scrollToBottom: () => void
  checkScrollPosition: () => void
}

/**
 * 自定義 Hook：管理聊天滾動行為
 */
export function useChatScroll(
  messagesLength: number,
  options: UseScrollOptions = {}
): UseScrollReturn {
  const { threshold = 100 } = options
  
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 滾動到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // 檢查滾動位置（防抖）
  const checkScrollPosition = useCallback(() => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }
    
    scrollTimeoutRef.current = setTimeout(() => {
      if (scrollContainerRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current
        const isNearBottom = scrollHeight - scrollTop - clientHeight < threshold
        
        setIsAtBottom(prev => prev !== isNearBottom ? isNearBottom : prev)
        setShowScrollToBottom(prev => {
          const newValue = !isNearBottom && messagesLength > 0
          return prev !== newValue ? newValue : prev
        })
      }
    }, 50)
  }, [threshold, messagesLength])

  return {
    isAtBottom,
    showScrollToBottom,
    scrollContainerRef,
    messagesEndRef,
    scrollToBottom,
    checkScrollPosition
  }
}
