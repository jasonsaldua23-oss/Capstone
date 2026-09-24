'use client'

import { useEffect, useRef, useState } from 'react'
import { Bar, BarChart, LabelList, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartContainer } from '@/components/ui/chart'

export type SkuVelocityRow = {
  id: string
  name: string
  productName: string
  sizeLabel: string
  sku: string
  velocity: number
}

const BAR_COLOR = '#2563eb'
const BAR_SIZE = 18
const ROW_HEIGHT = 44
const NAME_FONT = '500 12px'
const SIZE_FONT = '11px'

let measureContext: CanvasRenderingContext2D | null = null

function measureText(text: string, font: string) {
  if (typeof document === 'undefined') return text.length * 7
  measureContext ??= document.createElement('canvas').getContext('2d')
  if (!measureContext) return text.length * 7
  measureContext.font = font
  return measureContext.measureText(text).width
}

// Labels are measured, never clipped: a name too long for the column ends in an
// ellipsis, and the tooltip and the <title> carry the full name.
function fitText(text: string, maxWidth: number, font: string) {
  if (measureText(text, font) <= maxWidth) return text
  let end = text.length
  while (end > 1 && measureText(`${text.slice(0, end).trimEnd()}…`, font) > maxWidth) end -= 1
  return `${text.slice(0, end).trimEnd()}…`
}

// Width drives the label column; the font family keeps measurement in step with
// the rendered text, and re-measuring once webfonts load avoids the fallback-font race.
function useChartBox() {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, fontFamily: 'sans-serif', fontsLoaded: false })

  useEffect(() => {
    const element = ref.current
    if (!element) return
    let cancelled = false
    const observer = new ResizeObserver(() => {
      setBox((previous) => ({ ...previous, width: element.clientWidth, fontFamily: getComputedStyle(element).fontFamily }))
    })
    observer.observe(element)
    void document.fonts?.ready.then(() => {
      if (!cancelled) setBox((previous) => ({ ...previous, fontsLoaded: true }))
    })
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [])

  return { ref, ...box }
}

function VelocityTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: SkuVelocityRow }> }) {
  const row = active ? payload?.[0]?.payload : undefined
  if (!row) return null
  return (
    <div className="max-w-64 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-slate-900">{row.name}</p>
      <p className="text-slate-500">{row.sku}</p>
      <p className="mt-1.5 flex items-center gap-1.5 text-slate-600">
        <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: BAR_COLOR }} />
        Velocity score
        <span className="ml-auto pl-3 font-semibold tabular-nums text-slate-900">{row.velocity.toLocaleString('en-US')}</span>
      </p>
    </div>
  )
}

/**
 * Top SKUs by velocity as a ranked horizontal bar chart: each row names the
 * product with its size, and the value sits at the bar's tip.
 */
export function SkuVelocityChart({ rows }: { rows: SkuVelocityRow[] }) {
  const { ref, width, fontFamily } = useChartBox()
  // Names get more of a phone-width card: the bars only need to compare lengths,
  // and a truncated name is harder to read than a shorter bar.
  const labelShare = width < 480 ? 0.55 : 0.42
  const labelWidth = Math.min(230, Math.max(116, Math.round(width * labelShare)))
  // YAxis insets tick text by its tick size (6) and margin (2); keep a little left padding too.
  const textWidth = labelWidth - 12
  const rowsById = new Map(rows.map((row) => [row.id, row]))

  const renderTick = ({ x, y, payload }: { x: number; y: number; payload: { value: string } }) => {
    const row = rowsById.get(String(payload.value))
    if (!row) return <g />
    const name = fitText(row.productName, textWidth, `${NAME_FONT} ${fontFamily}`)
    const size = row.sizeLabel ? fitText(row.sizeLabel, textWidth, `${SIZE_FONT} ${fontFamily}`) : ''
    return (
      <g transform={`translate(${x},${y})`}>
        <title>{`${row.name} · ${row.sku}`}</title>
        {/* Inline fill: ChartContainer otherwise mutes every axis tick to one gray. */}
        <text x={0} y={size ? -3 : 4} textAnchor="end" fontSize={12} fontWeight={500} style={{ fill: '#334155' }}>
          {name}
        </text>
        {size ? (
          <text x={0} y={12} textAnchor="end" fontSize={11} style={{ fill: '#64748b' }}>
            {size}
          </text>
        ) : null}
      </g>
    )
  }

  return (
    <div ref={ref} className="w-full min-w-0">
      <ChartContainer
        config={{ velocity: { label: 'Velocity score', color: BAR_COLOR } }}
        className="aspect-auto w-full"
        style={{ height: rows.length * ROW_HEIGHT + 8 }}
      >
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 0 }} accessibilityLayer>
          {/* Every bar carries its value, so the value axis would only repeat them. */}
          <XAxis type="number" hide domain={[0, 'dataMax']} />
          <YAxis
            type="category"
            dataKey="id"
            width={labelWidth}
            interval={0}
            axisLine={{ stroke: '#e2e8f0' }}
            tickLine={false}
            tick={renderTick}
          />
          <Tooltip cursor={{ fill: '#f1f5f9' }} content={<VelocityTooltip />} />
          <Bar dataKey="velocity" fill={BAR_COLOR} barSize={BAR_SIZE} radius={[0, 4, 4, 0]}>
            <LabelList
              dataKey="velocity"
              position="right"
              offset={8}
              fontSize={12}
              style={{ fill: '#475569' }}
              formatter={(value: number) => Number(value).toLocaleString('en-US')}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  )
}
