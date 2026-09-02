'use client'

import { useMemo, useState } from 'react'
import {
  ArrowUp,
  ArrowUpRight,
  ArrowRight,
  ArrowDown,
  ArrowLeft,
  ArrowUpLeft,
  CornerUpRight,
  CornerUpLeft,
  RotateCcw,
  Flag,
  Navigation,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

export type OsrmStep = {
  maneuver: {
    type: string
    modifier?: string
    location: [number, number]
  }
  name: string
  distance: number
  duration: number
  driving_side?: string
}

function getManeuverIcon(type: string, modifier?: string) {
  const iconClass = 'h-5 w-5'

  if (type === 'arrive' || type === 'destination') {
    return <Flag className={iconClass} />
  }
  if (type === 'depart') {
    return <ArrowUp className={iconClass} />
  }
  if (type === 'roundabout' || type === 'rotary') {
    return <RotateCcw className={iconClass} />
  }

  switch (modifier) {
    case 'uturn':
      return <ArrowDown className={iconClass} />
    case 'sharp right':
      return <CornerUpRight className={iconClass} />
    case 'right':
      return <ArrowRight className={iconClass} />
    case 'slight right':
      return <ArrowUpRight className={iconClass} />
    case 'straight':
      return <ArrowUp className={iconClass} />
    case 'slight left':
      return <ArrowUpLeft className={iconClass} />
    case 'left':
      return <ArrowLeft className={iconClass} />
    case 'sharp left':
      return <CornerUpLeft className={iconClass} />
    default:
      return <ArrowUp className={iconClass} />
  }
}

export function getManeuverLabel(type: string, modifier?: string, name?: string) {
  const road = name && name.trim() ? ` on ${name}` : ''

  if (type === 'arrive') return `Arrive at destination${road}`
  if (type === 'depart') return `Head${road || ' forward'}`

  switch (modifier) {
    case 'uturn':
      return `Make a U-turn${road}`
    case 'sharp right':
      return `Sharp right${road}`
    case 'right':
      return `Turn right${road}`
    case 'slight right':
      return `Slight right${road}`
    case 'straight':
      return `Continue straight${road}`
    case 'slight left':
      return `Slight left${road}`
    case 'left':
      return `Turn left${road}`
    case 'sharp left':
      return `Sharp left${road}`
    default:
      return `Continue${road}`
  }
}

export function formatDistance(meters: number) {
  if (meters < 100) return `${Math.round(meters)} m`
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`
  return `${(meters / 1000).toFixed(1)} km`
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)} sec`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

function formatSpokenDistance(meters: number) {
  if (meters < 1000) return `${Math.round(meters)} meters`
  const kilometers = Number((meters / 1000).toFixed(1))
  return `${kilometers} ${kilometers === 1 ? 'kilometer' : 'kilometers'}`
}

function formatSpokenDuration(seconds: number) {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} seconds`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}${remainingMinutes > 0 ? ` ${remainingMinutes} minutes` : ''}`
}

type NavInstructionsVariant = 'default' | 'mobile-compact'

type NavState = {
  promptStep: OsrmStep
  promptNextStep: OsrmStep | null
  remainingSteps: OsrmStep[]
  remainingDistance: number
  remainingDuration: number
  promptInstruction: string
  promptStepDistance: number
  remainingDistanceLabel: string
  remainingDurationLabel: string
}

function buildNavState(
  steps: OsrmStep[],
  currentStepIndex: number,
  showUpcomingManeuver: boolean
): NavState | null {
  const travelingStep = steps[currentStepIndex] || null
  if (!travelingStep || steps.length === 0) return null

  // The prominent instruction is the maneuver ahead of the segment the driver is
  // currently on, so completing a turn immediately reveals the next one. Totals
  // still count from the traveling segment, keeping remaining distance/ETA whole.
  const promptStepIndex = showUpcomingManeuver
    ? Math.min(currentStepIndex + 1, steps.length - 1)
    : currentStepIndex
  const promptStep = steps[promptStepIndex]
  const promptNextStep = steps[promptStepIndex + 1] || null
  const remainingSteps = steps.slice(promptStepIndex + 1)
  const remainingDistance = steps
    .slice(currentStepIndex)
    .reduce((sum, step) => sum + (step.distance || 0), 0)
  const remainingDuration = steps
    .slice(currentStepIndex)
    .reduce((sum, step) => sum + (step.duration || 0), 0)

  return {
    promptStep,
    promptNextStep,
    remainingSteps,
    remainingDistance,
    remainingDuration,
    promptInstruction: getManeuverLabel(
      promptStep.maneuver.type,
      promptStep.maneuver.modifier,
      promptStep.name
    ),
    promptStepDistance: promptStep.distance || 0,
    remainingDistanceLabel: formatDistance(remainingDistance),
    remainingDurationLabel: formatDuration(remainingDuration),
  }
}

export interface NavInstructionsPanelProps {
  steps: OsrmStep[]
  currentStepIndex: number
  destinationName?: string
  variant?: NavInstructionsVariant
  /** Show the maneuver ahead of the current segment (Google-Maps style). */
  showUpcomingManeuver?: boolean
  /** Live along-route distance to the shown maneuver; counts down continuously. */
  liveManeuverDistanceMeters?: number
  onSpeak?: (message: string) => void
}

export function NavInstructionsPanel({
  steps,
  currentStepIndex,
  destinationName,
  variant = 'default',
  showUpcomingManeuver = false,
  liveManeuverDistanceMeters,
  onSpeak,
}: NavInstructionsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const navState = useMemo(
    () => buildNavState(steps, currentStepIndex, showUpcomingManeuver),
    [steps, currentStepIndex, showUpcomingManeuver]
  )

  if (!navState) return null

  // The live distance to the shown maneuver, when the caller supplies it, drives
  // the count-down; below ~10 m the maneuver is treated as happening now.
  const maneuverDistanceMeters =
    typeof liveManeuverDistanceMeters === 'number' && Number.isFinite(liveManeuverDistanceMeters)
      ? liveManeuverDistanceMeters
      : navState.promptStepDistance
  const maneuverDistanceLabel = maneuverDistanceMeters > 10 ? formatDistance(maneuverDistanceMeters) : 'Now'

  if (variant === 'mobile-compact') {
    return (
      <div className="pointer-events-auto overflow-hidden bg-white/96 shadow-[0_10px_26px_rgba(15,23,42,0.14)] backdrop-blur">
        <div className="grid min-h-[76px] grid-cols-[64px_minmax(0,1fr)_88px] items-stretch">
          <button
            type="button"
            aria-label={`Speak navigation instruction: ${navState.promptInstruction}`}
            disabled={!onSpeak}
            onClick={() => onSpeak?.(navState.promptInstruction)}
            className="flex items-center justify-center bg-[#17cf79] text-white"
          >
            {getManeuverIcon(navState.promptStep.maneuver.type, navState.promptStep.maneuver.modifier)}
          </button>
          <button
            type="button"
            disabled={!onSpeak}
            onClick={() => onSpeak?.(navState.promptInstruction)}
            className="flex min-w-0 items-center px-4 py-2 text-left"
          >
            <p className="line-clamp-2 text-[1rem] font-black leading-[1.05] tracking-[-0.02em] text-slate-900">
              {maneuverDistanceMeters > 10 ? (
                <span className="text-[#0d61ad]">{maneuverDistanceLabel} · </span>
              ) : null}
              {navState.promptInstruction}
            </p>
          </button>
          <div className="flex flex-col justify-center bg-white px-3 py-2 text-right">
            {/* Added: each navigation metric speaks only the value the driver tapped. */}
            <button
              type="button"
              disabled={!onSpeak}
              onClick={() => onSpeak?.(`Remaining distance: ${formatSpokenDistance(navState.remainingDistance)}`)}
              className="text-right"
            >
              <span className="block text-[0.62rem] font-bold uppercase tracking-[0.14em] text-slate-500">KM</span>
              <span className="block text-[0.9rem] font-black leading-none text-[#0d61ad]">{navState.remainingDistanceLabel}</span>
            </button>
            <button
              type="button"
              disabled={!onSpeak}
              onClick={() => onSpeak?.(`Estimated time of arrival: ${formatSpokenDuration(navState.remainingDuration)}`)}
              className="mt-2 text-right"
            >
              <span className="block text-[0.62rem] font-bold uppercase tracking-[0.14em] text-slate-500">ETA</span>
              <span className="block text-[0.88rem] font-black leading-none text-slate-900">{navState.remainingDurationLabel}</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-[24px] bg-[#111928] shadow-[0_16px_32px_rgba(15,23,42,0.5)]">
      <div className="px-4 pb-4 pt-4">
        <div className="flex items-center gap-4">
          <div className="flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-[16px] bg-[#00d27a] text-white">
            {getManeuverIcon(navState.promptStep.maneuver.type, navState.promptStep.maneuver.modifier)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 flex items-center gap-2">
              <span className="text-[13px] font-bold text-[#00d27a]">
                {maneuverDistanceLabel}
              </span>
              <span className="text-[13px] font-bold text-slate-400">•</span>
              <span className="text-[13px] font-bold text-slate-200">
                {navState.remainingDurationLabel}
              </span>
            </div>
            <p className="truncate text-[16px] font-black tracking-tight text-white">
              {navState.promptInstruction}
            </p>
          </div>
        </div>

        {navState.promptNextStep && (
          <div className="mt-3 flex items-center gap-2.5 rounded-[12px] bg-white/5 px-3 py-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/10 text-[#00d27a]">
              {getManeuverIcon(navState.promptNextStep.maneuver.type, navState.promptNextStep.maneuver.modifier)}
            </div>
            <p className="truncate text-[13px] font-medium text-slate-300">
              Then {getManeuverLabel(
                navState.promptNextStep.maneuver.type,
                navState.promptNextStep.maneuver.modifier,
                navState.promptNextStep.name
              ).toLowerCase()}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-white/5 bg-black/10 px-4 py-2.5">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              ETA
            </p>
            <p className="text-[13px] font-bold text-white">
              {navState.remainingDurationLabel}
            </p>
          </div>
          <div className="h-6 w-px bg-white/10" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Distance
            </p>
            <p className="text-[13px] font-bold text-white">
              {navState.remainingDistanceLabel}
            </p>
          </div>
          {destinationName && (
            <>
              <div className="h-6 w-px bg-white/10" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  To
                </p>
                <p className="truncate text-[13px] font-medium text-slate-200">
                  {destinationName}
                </p>
              </div>
            </>
          )}
        </div>
        {navState.remainingSteps.length > 0 && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>

      {isExpanded && navState.remainingSteps.length > 0 && (
        <div className="max-h-48 overflow-y-auto border-t border-white/5 bg-black/20">
          {navState.remainingSteps.map((step, index) => (
            <div
              key={`step-${currentStepIndex + 1 + index}`}
              className="flex items-center gap-3 border-b border-white/5 px-4 py-3 last:border-b-0 hover:bg-white/5"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/5 text-[#00d27a]">
                {getManeuverIcon(step.maneuver.type, step.maneuver.modifier)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-slate-200">
                  {getManeuverLabel(step.maneuver.type, step.maneuver.modifier, step.name)}
                </p>
              </div>
              <p className="shrink-0 text-[12px] font-bold text-slate-400">
                {step.distance > 0 ? formatDistance(step.distance) : ''}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
