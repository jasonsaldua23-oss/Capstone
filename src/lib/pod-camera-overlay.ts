export interface PodOverlaySnapshot {
  capturedAt: Date
  driverName: string
  address: string
  latitude: number
  longitude: number
}

export function formatPodOverlayLines(snapshot: PodOverlaySnapshot): string[] {
  return [
    snapshot.capturedAt.toLocaleDateString('en-PH', { day: '2-digit', month: 'long', year: 'numeric' }),
    snapshot.capturedAt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
    snapshot.driverName,
    snapshot.address || 'Resolving current address...',
    `GPS: ${snapshot.latitude.toFixed(6)}, ${snapshot.longitude.toFixed(6)}`,
  ]
}

function wrapCanvasLine(context: CanvasRenderingContext2D, value: string, maxWidth: number): string[] {
  const words = value.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (current && context.measureText(candidate).width > maxWidth) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['Location address unavailable']
}

export function burnPodOverlay(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: PodOverlaySnapshot,
): void {
  // Added: canvas dimensions drive the font and safe-area spacing on every camera resolution.
  const fontSize = Math.max(16, Math.min(48, Math.round(Math.min(width, height) * 0.036)))
  const padding = Math.max(12, Math.round(fontSize * 0.75))
  const lineHeight = Math.round(fontSize * 1.3)
  const panelWidth = Math.min(width - padding * 2, Math.round(width * 0.9))
  const textWidth = panelWidth - padding * 2
  context.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`
  const baseLines = formatPodOverlayLines(snapshot)
  const lines = [
    ...baseLines.slice(0, 3),
    ...wrapCanvasLine(context, baseLines[3], textWidth).slice(0, 3),
    baseLines[4],
  ]
  const panelHeight = padding * 2 + lines.length * lineHeight
  const left = padding
  const top = Math.max(padding, height - panelHeight - padding)

  context.fillStyle = 'rgba(0, 0, 0, 0.46)'
  context.beginPath()
  context.roundRect(left, top, panelWidth, panelHeight, Math.max(8, Math.round(padding / 2)))
  context.fill()
  context.fillStyle = '#fff'
  context.strokeStyle = 'rgba(0, 0, 0, 0.82)'
  context.lineWidth = Math.max(2, Math.round(fontSize / 14))
  context.textBaseline = 'top'
  lines.forEach((line, index) => {
    const x = left + padding
    const y = top + padding + index * lineHeight
    context.strokeText(line, x, y, textWidth)
    context.fillText(line, x, y, textWidth)
  })
}
