'use client'

import { useEffect, useRef } from 'react'

// Nested screens consume Back before their parent portal changes its main view.
export function useNativeBack(handler: () => boolean, priority = 0) {
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => {
    const entry = { priority, handle: () => latest.current() }
    handlers.add(entry)
    return () => { handlers.delete(entry) }
  }, [priority])
}

const handlers = new Set<{ priority: number; handle: () => boolean }>()

export const hasNativeBackHandlers = () => handlers.size > 0

export function handleNativeBack(): boolean {
  // Radix owns modal dismissal and its existing unsaved/required-state guards.
  if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"]')) {
    // Dispatch from focus so menus receive Escape too; dialog listeners receive the bubble.
    const target = document.activeElement || document
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    return true
  }
  return [...handlers].sort((a, b) => b.priority - a.priority).some(entry => entry.handle())
}
