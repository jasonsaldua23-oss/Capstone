'use client'

/**
 * Keeps every wide table (`table.stack-table`) in the layout that fits it.
 *
 * Two jobs, both derived from the DOM rather than authored per table:
 *
 * 1. Labels. Mirrors each table's column headers into its body cells as
 *    `data-label`. When a table stacks into cards the header row is hidden, so
 *    every value needs to carry its own label or the card is a column of
 *    unexplained text. Doing that in markup would mean adding an attribute to
 *    several hundred `<td>`s across ~40 tables and remembering it on every new
 *    one, so it is derived from the headers already present instead.
 *
 * 2. Layout. Sets `data-stacked` on a table whose columns cannot fit its
 *    container. An auto-layout table never renders narrower than its columns'
 *    content, so when it comes out wider than its host the only alternatives
 *    are clipping a control or scrolling sideways, and both are ruled out for
 *    these portals. Measuring beats a viewport breakpoint: the same table has
 *    different room beside the sidebar, inside a dialog, or in a narrow window.
 *
 * Rendered once per portal shell. It only ever sets attributes React does not
 * manage (`data-label`, `data-stacked`), never moves or replaces nodes, so it
 * cannot fight React over the DOM it owns. Everything runs inside
 * `requestAnimationFrame`, before the browser paints, so a table never shows in
 * the wrong layout first.
 */

import { useEffect } from 'react'

// Two cards side by side need about this much room; below it they stay in one
// column.
const TWO_COLUMN_MIN_WIDTH = 880

function contentWidth(host: HTMLElement): number {
  const style = getComputedStyle(host)
  return host.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
}

function applyLabels(table: HTMLTableElement) {
  const headings = Array.from(table.querySelectorAll('thead th')).map(
    (heading) => heading.textContent?.trim() ?? ''
  )
  if (headings.length === 0) return

  for (const row of table.querySelectorAll('tbody tr')) {
    const cells = row.children
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index]
      // A spanning cell (empty state, subtotal) has no single column, and the
      // stacked layout deliberately renders it without a label.
      if (cell.hasAttribute('colspan')) continue
      const label = headings[index]
      if (!label) continue
      if (cell.getAttribute('data-label') !== label) {
        cell.setAttribute('data-label', label)
      }
    }
  }
}

function applyLayout(table: HTMLTableElement) {
  const host = table.parentElement
  if (!host) return
  const available = contentWidth(host)
  // Hidden (an inactive tab, a closed dialog): leave it as it is; the resize
  // observer runs again once it has a width.
  if (available <= 0) return

  // Measure as a table. It is `width: 100%`, so it only comes out wider than
  // the host when its columns' content needs more than that.
  if (table.hasAttribute('data-stacked')) table.removeAttribute('data-stacked')
  if (table.offsetWidth <= available + 1) return

  table.setAttribute('data-stacked', available >= TWO_COLUMN_MIN_WIDTH ? 'wide' : '')
}

export function StackedTableLabels() {
  useEffect(() => {
    let frame = 0
    const observedHosts = new Set<HTMLElement>()
    const lastHostWidth = new WeakMap<HTMLElement, number>()

    const resizeObserver = new ResizeObserver((entries) => {
      let changed = false
      for (const entry of entries) {
        const host = entry.target as HTMLElement
        const width = entry.contentRect.width
        // Only a width change can change whether the columns fit. Restacking
        // changes the host's height, and reacting to that would loop.
        if (lastHostWidth.get(host) === width) continue
        lastHostWidth.set(host, width)
        changed = true
      }
      if (changed) schedule()
    })

    const applyAll = () => {
      frame = 0
      const tables = document.querySelectorAll<HTMLTableElement>('table.stack-table')
      for (const table of tables) {
        applyLabels(table)
        applyLayout(table)
        const host = table.parentElement
        if (host && !observedHosts.has(host)) {
          observedHosts.add(host)
          lastHostWidth.set(host, host.getBoundingClientRect().width)
          resizeObserver.observe(host)
        }
      }
      for (const host of observedHosts) {
        if (host.isConnected) continue
        resizeObserver.unobserve(host)
        observedHosts.delete(host)
      }
    }

    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(applyAll)
    }

    applyAll()

    // Rows arrive with data, and filtering/pagination swaps them out, so both
    // the labels and the fit are redone whenever the tree changes. Attribute
    // mutations are not observed, so the attributes set above cannot retrigger
    // this.
    const mutationObserver = new MutationObserver(schedule)
    mutationObserver.observe(document.body, { childList: true, subtree: true })

    // The app loads Poppins over the network. Until it arrives the rows are
    // measured in the fallback face, which is narrower - a table that will not
    // fit once the real font swaps in looks like it fits, and no resize
    // follows to correct it. `loadingdone` also covers a weight that is only
    // pulled in later, by a dialog or a chart.
    const fonts = document.fonts
    fonts?.ready.then(schedule).catch(() => {})
    fonts?.addEventListener('loadingdone', schedule)

    return () => {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      fonts?.removeEventListener('loadingdone', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return null
}
