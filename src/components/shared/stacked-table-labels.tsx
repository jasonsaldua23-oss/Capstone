'use client'

/**
 * Mirrors each wide table's column headers into its body cells as `data-label`.
 *
 * Below `lg` those tables stack into cards (see `stack-table` in globals.css) and
 * the header row is hidden, so every value needs to carry its own label or the
 * card is a column of unexplained text. Doing that in markup would mean adding an
 * attribute to several hundred `<td>`s across ~40 tables and remembering it on
 * every new one, so it is derived from the headers already present instead.
 *
 * Rendered once per portal shell. It only ever sets `data-label`, never moves or
 * replaces nodes, so it cannot fight React over the DOM it owns.
 */

import { useEffect } from 'react'

export function StackedTableLabels() {
  useEffect(() => {
    let frame = 0

    const applyLabels = () => {
      frame = 0
      for (const table of document.querySelectorAll<HTMLTableElement>('table.stack-table')) {
        const headings = Array.from(table.querySelectorAll('thead th')).map(
          (heading) => heading.textContent?.trim() ?? ''
        )
        if (headings.length === 0) continue

        for (const row of table.querySelectorAll('tbody tr')) {
          const cells = row.children
          for (let index = 0; index < cells.length; index += 1) {
            const cell = cells[index]
            // A spanning cell (empty state, subtotal) has no single column, and
            // the stacked layout deliberately renders it without a label.
            if (cell.hasAttribute('colspan')) continue
            const label = headings[index]
            if (!label) continue
            if (cell.getAttribute('data-label') !== label) {
              cell.setAttribute('data-label', label)
            }
          }
        }
      }
    }

    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(applyLabels)
    }

    applyLabels()

    // Rows arrive with data, and filtering/pagination swaps them out, so the
    // labels are reapplied whenever the tree changes. Attribute mutations are not
    // observed, so the labelling below cannot retrigger this.
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return null
}
