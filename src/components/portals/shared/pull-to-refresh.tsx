'use client'

import React, { useCallback, useRef, useState } from 'react'

export interface PullToRefreshProps {
  onRefresh: () => Promise<unknown> | void
  children: React.ReactNode
  className?: string
  contentClassName?: string
  disabled?: boolean
  threshold?: number
  maxPull?: number
}

type RefreshState = 'idle' | 'pulling' | 'ready' | 'refreshing' | 'complete'

// Circular arc SVG path helper (like the Facebook/Android spinner arc)
function CircularArc({
  progress,
  size = 40,
  strokeWidth = 3,
  color = '#1a73e8',
}: {
  progress: number
  size?: number
  strokeWidth?: number
  color?: string
}) {
  const r = (size - strokeWidth) / 2
  const cx = size / 2
  const cy = size / 2
  // progress 0-1 maps to arc 0-330 degrees (leave a small gap like native)
  const angle = Math.max(0, Math.min(progress, 1)) * 330
  const rad = ((angle - 90) * Math.PI) / 180
  const x = cx + r * Math.cos(rad)
  const y = cy + r * Math.sin(rad)
  const largeArc = angle > 180 ? 1 : 0

  if (angle <= 0) return null

  // Full circle when complete
  if (angle >= 330) {
    return (
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    )
  }

  const startX = cx
  const startY = cy - r
  const d = `M ${startX} ${startY} A ${r} ${r} 0 ${largeArc} 1 ${x} ${y}`

  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
    />
  )
}

export function PullToRefresh({
  onRefresh,
  children,
  className = '',
  contentClassName = '',
  disabled = false,
  threshold = 68,
  maxPull = 110,
}: PullToRefreshProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [refreshState, setRefreshState] = useState<RefreshState>('idle')
  const [pullDistance, setPullDistance] = useState(0)
  const isDraggingRef = useRef(false)
  const startYRef = useRef(0)
  const startXRef = useRef(0)
  const isHorizontalScrollRef = useRef(false)
  const hasVibratedRef = useRef(false)

  const isRefreshing = refreshState === 'refreshing'

  const computeDampedDistance = useCallback(
    (deltaY: number) => {
      if (deltaY <= 0) return 0
      const damped = Math.pow(deltaY, 0.78) * 1.6
      return Math.min(maxPull, damped)
    },
    [maxPull]
  )

  const triggerRefresh = useCallback(async () => {
    setRefreshState('refreshing')
    setPullDistance(threshold * 0.85)
    try {
      await onRefresh()
      setRefreshState('complete')
      await new Promise((resolve) => setTimeout(resolve, 600))
    } catch (err) {
      console.warn('Pull-to-refresh handler error:', err)
    } finally {
      setRefreshState('idle')
      setPullDistance(0)
      hasVibratedRef.current = false
    }
  }, [onRefresh, threshold])

  // Touch handlers
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (disabled || isRefreshing) return
    const container = containerRef.current
    if (!container || container.scrollTop > 0) return

    isDraggingRef.current = true
    startYRef.current = e.touches[0].clientY
    startXRef.current = e.touches[0].clientX
    isHorizontalScrollRef.current = false
    hasVibratedRef.current = false
  }

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || disabled || isRefreshing) return
    const container = containerRef.current
    if (!container || container.scrollTop > 0) {
      isDraggingRef.current = false
      setPullDistance(0)
      setRefreshState('idle')
      return
    }

    const currentY = e.touches[0].clientY
    const currentX = e.touches[0].clientX
    const deltaY = currentY - startYRef.current
    const deltaX = Math.abs(currentX - startXRef.current)

    if (!isHorizontalScrollRef.current && deltaX > Math.abs(deltaY) && deltaX > 10) {
      isHorizontalScrollRef.current = true
      isDraggingRef.current = false
      setPullDistance(0)
      return
    }
    if (isHorizontalScrollRef.current) return

    if (deltaY > 0) {
      if (e.cancelable) e.preventDefault()
      const dist = computeDampedDistance(deltaY)
      setPullDistance(dist)

      if (dist >= threshold) {
        setRefreshState('ready')
        if (!hasVibratedRef.current && typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(15)
          hasVibratedRef.current = true
        }
      } else {
        setRefreshState('pulling')
        hasVibratedRef.current = false
      }
    } else {
      setPullDistance(0)
      setRefreshState('idle')
    }
  }

  const handleTouchEnd = () => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false

    if (refreshState === 'ready') {
      void triggerRefresh()
    } else {
      setRefreshState('idle')
      setPullDistance(0)
    }
  }

  // Pointer/mouse drag handlers for desktop support
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || isRefreshing || e.pointerType === 'touch') return
    if (e.button !== 0) return

    const container = containerRef.current
    if (!container || container.scrollTop > 0) return

    const target = e.target as HTMLElement | null
    if (target && (target.closest('button') || target.closest('input') || target.closest('a') || target.closest('select') || target.closest('textarea'))) {
      return
    }

    isDraggingRef.current = true
    startYRef.current = e.clientY
    startXRef.current = e.clientX
    isHorizontalScrollRef.current = false
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || disabled || isRefreshing || e.pointerType === 'touch') return
    const container = containerRef.current
    if (!container || container.scrollTop > 0) {
      isDraggingRef.current = false
      setPullDistance(0)
      setRefreshState('idle')
      return
    }

    const deltaY = e.clientY - startYRef.current
    if (deltaY > 0) {
      const dist = computeDampedDistance(deltaY)
      setPullDistance(dist)
      if (dist >= threshold) {
        setRefreshState('ready')
      } else {
        setRefreshState('pulling')
      }
    } else {
      setPullDistance(0)
      setRefreshState('idle')
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || e.pointerType === 'touch') return
    isDraggingRef.current = false

    if (refreshState === 'ready') {
      void triggerRefresh()
    } else {
      setRefreshState('idle')
      setPullDistance(0)
    }
  }

  // Derived values for the circular indicator
  const isActive = pullDistance > 2 || isRefreshing || refreshState === 'complete'
  const progress = Math.min(1, pullDistance / threshold)

  // The circle translates down as you pull, capped near the threshold
  // Then stays locked in place while refreshing
  const circleTranslateY = (() => {
    if (!isActive) return -56
    if (isRefreshing || refreshState === 'complete') return Math.min(pullDistance * 0.5, 32)
    return Math.min(pullDistance * 0.5, 32)
  })()

  const circleOpacity = isActive ? 1 : 0
  const circleScale = isActive ? Math.min(0.4 + progress * 0.6, 1) : 0.3

  // Arrow rotation follows progress (0 deg → 330 deg as arc fills)
  // Then at ready/refreshing the arrow flips up
  const arrowRotation = refreshState === 'ready' ? 180 : progress * 180

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain ${className}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Facebook/Material-style floating circular indicator */}
      <div
        className="pointer-events-none absolute left-0 right-0 top-0 z-30 flex justify-center"
        aria-hidden={!isActive}
        style={{
          transform: `translate3d(0, ${circleTranslateY}px, 0)`,
          opacity: circleOpacity,
          transition: isDraggingRef.current
            ? 'opacity 0.1s ease'
            : 'transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.22s ease',
          willChange: 'transform, opacity',
        }}
      >
        <div
          style={{
            transform: `scale(${circleScale})`,
            transition: isDraggingRef.current ? 'none' : 'transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        >
          {/* The circle shadow card — like Facebook's white circle */}
          <div
            className="relative flex items-center justify-center rounded-full bg-white dark:bg-slate-800"
            style={{
              width: 40,
              height: 40,
              boxShadow: '0 2px 12px rgba(0,0,0,0.18), 0 1px 4px rgba(0,0,0,0.10)',
            }}
          >
            {/* Refreshing state: standard spinning arc */}
            {isRefreshing ? (
              <svg
                width={40}
                height={40}
                viewBox="0 0 40 40"
                className="absolute inset-0"
                style={{ animation: 'ptr-spin 0.75s linear infinite' }}
              >
                <circle
                  cx={20}
                  cy={20}
                  r={15}
                  fill="none"
                  stroke="#e8eaed"
                  strokeWidth={3}
                />
                <path
                  d="M 20 5 A 15 15 0 0 1 35 20"
                  fill="none"
                  stroke="#1a73e8"
                  strokeWidth={3}
                  strokeLinecap="round"
                />
              </svg>
            ) : refreshState === 'complete' ? (
              /* Check mark on completion */
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 13l4 4L19 7"
                  stroke="#34a853"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              /* Pulling state: progressively drawing arc with arrow */
              <>
                {/* Background track circle */}
                <svg
                  width={40}
                  height={40}
                  viewBox="0 0 40 40"
                  className="absolute inset-0"
                >
                  <circle
                    cx={20}
                    cy={20}
                    r={15}
                    fill="none"
                    stroke="#e8eaed"
                    strokeWidth={3}
                  />
                  {/* Foreground progress arc */}
                  <CircularArc
                    progress={progress}
                    size={40}
                    strokeWidth={3}
                    color="#1a73e8"
                  />
                </svg>

                {/* Central arrow that rotates with pull direction */}
                <svg
                  width={14}
                  height={14}
                  viewBox="0 0 24 24"
                  fill="none"
                  style={{
                    transform: `rotate(${arrowRotation}deg)`,
                    transition: isDraggingRef.current ? 'none' : 'transform 0.2s ease',
                    opacity: Math.max(0.3, progress),
                  }}
                >
                  <path
                    d="M12 5v14M5 12l7 7 7-7"
                    stroke="#1a73e8"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Spin keyframes injected once */}
      <style>{`
        @keyframes ptr-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>

      {/* Content shifts down slightly as you pull */}
      <div
        className={`flex min-h-0 flex-1 flex-col ${contentClassName}`}
        style={{
          transform: `translate3d(0, ${pullDistance > 0 && !isRefreshing ? pullDistance * 0.3 : 0}px, 0)`,
          transition: isDraggingRef.current ? 'none' : 'transform 0.32s cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
      >
        {children}
      </div>
    </div>
  )
}
