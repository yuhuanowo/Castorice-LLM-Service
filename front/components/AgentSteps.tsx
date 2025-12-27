import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Brain, Zap, Eye, CheckCircle, Terminal,
  Loader2, Lightbulb, Search, Image as ImageIcon, FileText, Code, Wrench,
  ChevronDown, Check
} from 'lucide-react'
import { cn } from '@/lib/utils'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ReactStep } from '@/types'

interface AgentStepsProps {
  steps: ReactStep[]
  isRunning?: boolean
  className?: string
}

export function AgentSteps({ steps, isRunning = false, className }: AgentStepsProps) {
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({})
  const scrollRef = useRef<HTMLDivElement>(null)

  // Check if step has MEANINGFUL expandable content (not just status text)
  const hasExpandableContent = (step: ReactStep) => {
    // Must have actual content or tool result
    const hasContent = step.content && step.content.trim().length > 0
    const hasToolResult = step.toolResult && (
      typeof step.toolResult === 'string' 
        ? step.toolResult.trim().length > 0 
        : Object.keys(step.toolResult).length > 0
    )
    
    // Only expandable for specific step types with actual content
    if (step.type === 'thought' || step.type === 'reflection' || step.type === 'decision') {
      return hasContent
    }
    if (step.type === 'action' || step.type === 'observation') {
      return hasContent || hasToolResult
    }
    return false
  }

  const toggleStep = (index: number) => {
    if (!hasExpandableContent(steps[index])) return
    setExpandedSteps(prev => ({ ...prev, [index]: !prev[index] }))
  }

  // Auto-scroll to bottom when new steps arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [steps.length])

  if (!steps || steps.length === 0) return null

  // Get icon and color for step
  const getStepStyle = (step: ReactStep) => {
    let Icon = Brain, color = "blue"
    
    switch (step.type) {
      case 'action': Icon = Zap; color = "violet"; break
      case 'observation': Icon = Eye; color = "emerald"; break
      case 'reflection': Icon = Lightbulb; color = "amber"; break
      case 'decision': Icon = CheckCircle; color = "green"; break
    }

    if (step.toolName) {
      const name = step.toolName.toLowerCase()
      if (name.includes('search')) Icon = Search
      else if (name.includes('image')) Icon = ImageIcon
      else if (name.includes('file') || name.includes('read')) Icon = FileText
      else if (name.includes('code')) Icon = Code
      else Icon = Wrench
    }

    return { Icon, color }
  }

  const colorMap: Record<string, string> = {
    blue: "text-blue-400",
    violet: "text-violet-400", 
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    green: "text-green-400"
  }

  return (
    <div className={cn(
      "rounded-xl border border-white/[0.08] overflow-hidden",
      "bg-gradient-to-b from-white/[0.03] to-transparent",
      "backdrop-blur-md",
      className
    )}>
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-white/[0.05] flex items-center gap-2">
        <div className={cn(
          "w-1.5 h-1.5 rounded-full",
          isRunning ? "bg-emerald-400 animate-pulse" : "bg-white/20"
        )} />
        <span className="text-[10px] font-medium text-white/40">
          {isRunning ? '執行中' : '完成'} · {steps.length} 步
        </span>
      </div>

      {/* Scrollable Steps Area - Compact */}
      <div 
        ref={scrollRef}
        className="max-h-40 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
      >
        <div className="p-1.5 space-y-px">
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1
            const isExpanded = expandedSteps[index]
            const expandable = hasExpandableContent(step)
            const { Icon, color } = getStepStyle(step)

            return (
              <motion.div
                key={index}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.1 }}
              >
                {/* Step Row - Ultra Compact */}
                <div 
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors",
                    expandable ? "cursor-pointer hover:bg-white/[0.04]" : "cursor-default",
                    isExpanded && "bg-white/[0.04]"
                  )}
                  onClick={() => toggleStep(index)}
                >
                  {/* Status dot / Icon */}
                  <div className="w-4 h-4 flex items-center justify-center shrink-0">
                    {isRunning && isLast && !step.complete ? (
                      <Loader2 className={cn("w-3 h-3 animate-spin", colorMap[color])} />
                    ) : step.complete ? (
                      <Check className="w-2.5 h-2.5 text-white/30" />
                    ) : (
                      <Icon className={cn("w-3 h-3", colorMap[color])} />
                    )}
                  </div>
                  
                  {/* Label */}
                  <span className={cn(
                    "flex-1 text-[11px] truncate",
                    step.complete ? "text-white/40" : "text-white/70"
                  )}>
                    {step.label || '處理中...'}
                  </span>

                  {/* Tool Badge - Only show if has tool */}
                  {step.toolName && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-white/[0.05] text-white/30 font-mono shrink-0">
                      {step.toolName}
                    </span>
                  )}

                  {/* Expand Arrow - Only if has expandable content */}
                  {expandable && (
                    <ChevronDown className={cn(
                      "w-3 h-3 text-white/20 transition-transform shrink-0",
                      isExpanded && "rotate-180"
                    )} />
                  )}
                </div>

                {/* Expanded Content */}
                <AnimatePresence>
                  {isExpanded && expandable && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.12 }}
                      className="overflow-hidden"
                    >
                      <div className="ml-5 mr-1.5 mb-1.5 mt-0.5">
                        <div className="rounded-md p-2 text-[10px] bg-black/30 border border-white/[0.05]">
                          {/* Content */}
                          {step.content && (
                            <div className="prose prose-xs dark:prose-invert max-w-none text-white/60 leading-relaxed prose-p:my-0.5 prose-p:text-[10px]">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {step.content}
                              </ReactMarkdown>
                            </div>
                          )}

                          {/* Tool Result */}
                          {step.toolResult && (
                            <div className={cn(step.content && "mt-1.5 pt-1.5 border-t border-white/[0.05]")}>
                              <div className="flex items-center gap-1 text-[9px] text-white/30 mb-1">
                                <Terminal className="w-2.5 h-2.5" />
                                <span>輸出</span>
                              </div>
                              <pre className="text-[9px] font-mono text-white/50 whitespace-pre-wrap break-all max-h-24 overflow-auto">
                                {typeof step.toolResult === 'string' 
                                  ? step.toolResult 
                                  : JSON.stringify(step.toolResult, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
