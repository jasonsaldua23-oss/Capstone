/**
 * Empties a walk-in hands back at the warehouse POS.
 *
 * On a case sale the cases and the bottles are counted apart: a customer can return
 * an empty case with no bottles in it, or bottles without their case.
 * backend/core/retail_pos prices each on its own, so a case handed back costs no
 * shell deposit and a bottle handed back costs no bottle deposit.
 *
 * Pure helpers only, so `node --test` can load this file without the app's aliases.
 */

const whole = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0))

export type CaseLineEmpties = { cases: number; bottles: number }

/**
 * What a case line's two counts mean. Until the cashier types a bottle count, the
 * bottles follow the cases as full ones, so the usual return of whole empty cases
 * is one entry.
 */
export function caseLineEmpties(
  line: { quantity: number; emptyCasesProvided?: number; emptyBottlesProvided?: number },
  caseQuantity: number,
): CaseLineEmpties {
  const perCase = Math.max(1, whole(caseQuantity))
  const quantity = whole(line.quantity)
  const cases = Math.min(quantity, whole(line.emptyCasesProvided))
  const bottles = line.emptyBottlesProvided === undefined
    ? cases * perCase
    : Math.min(quantity * perCase, whole(line.emptyBottlesProvided))
  return { cases, bottles }
}

export type ReceiptEmptiesItem = {
  mode?: string
  caseCapacity?: number | null
  emptyBottlesProvided?: number | null
  /** Null only on sales recorded before the case count was kept. */
  emptyCasesProvided?: number | null
}

/** Cases and bottles a sale's items took back, as the receipt reports them. */
export function receiptEmptiesTotals(items: ReceiptEmptiesItem[] | undefined): CaseLineEmpties {
  let cases = 0
  let bottles = 0
  for (const item of items || []) {
    const returned = whole(item?.emptyBottlesProvided)
    bottles += returned
    if (item?.emptyCasesProvided !== null && item?.emptyCasesProvided !== undefined) {
      cases += whole(item.emptyCasesProvided)
    } else if (String(item?.mode || '').toUpperCase() === 'CASE' && returned) {
      // Sales recorded before the case count was kept: a part-filled case came back in its shell.
      cases += Math.ceil(returned / Math.max(1, whole(item?.caseCapacity)))
    }
  }
  return { cases, bottles }
}

/** "1 case, 0 bottles": both counts once a case came back, so an empty case reads as one. */
export function receiptEmptiesLabel(items: ReceiptEmptiesItem[] | undefined): string {
  const { cases, bottles } = receiptEmptiesTotals(items)
  const bottleText = `${bottles} ${bottles === 1 ? 'bottle' : 'bottles'}`
  return cases ? `${cases} ${cases === 1 ? 'case' : 'cases'}, ${bottleText}` : bottleText
}
