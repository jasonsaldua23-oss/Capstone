/**
 * The driver's count of the empties a customer declared, and what a shortfall costs.
 *
 * Cases are counted as handed over (shell and bottles), with any bottles missing from
 * them counted on their own. A missing bottle is charged the bottle deposit and a
 * missing case its bottles plus the shell, so a case handed back one bottle short
 * costs one bottle's deposit, not a 24th of the case. The same pricing,
 * uncoveredDeposit, prices the warehouse POS, which counts the cases and bottles
 * handed back apart (src/lib/retail-empties.ts); backend/core/deposit_math.uncovered_deposit
 * settles both.
 *
 * Pure helpers only, so `node --test` can load this file without the app's aliases.
 */

export type EmptiesDeclaration = {
  /** Containers declared, cases included. */
  declaredBottles: number
  declaredCases: number
  declaredLooseBottles: number
  containersPerCase: number
  /** Deposit the customer was credited for the declaration, shells included. */
  depositValue: number
  /** The physical case shells inside depositValue. */
  shellDepositValue: number
}

export type EmptiesCount = {
  /** Cases handed over, each in its shell. */
  cases: number
  /** Bottles missing from those cases. */
  missingBottles: number
  looseBottles: number
}

const whole = (value: number) => Math.max(0, Math.floor(Number(value) || 0))

/** Keep a count within the declaration; missing bottles can only come out of counted cases. */
export function clampEmptiesCount(count: EmptiesCount, declaration: EmptiesDeclaration): EmptiesCount {
  const perCase = Math.max(1, whole(declaration.containersPerCase))
  const cases = Math.min(whole(count.cases), whole(declaration.declaredCases))
  return {
    cases,
    missingBottles: perCase > 1 ? Math.min(whole(count.missingBottles), cases * perCase) : 0,
    looseBottles: Math.min(whole(count.looseBottles), whole(declaration.declaredLooseBottles)),
  }
}

/** Containers handed over, which is what the settlement records. */
export function countedBottles(count: EmptiesCount, declaration: EmptiesDeclaration): number {
  const clamped = clampEmptiesCount(count, declaration)
  const perCase = Math.max(1, whole(declaration.containersPerCase))
  return Math.min(
    whole(declaration.declaredBottles),
    clamped.cases * perCase - clamped.missingBottles + clamped.looseBottles,
  )
}

/**
 * Deposit still owed for containers not handed back: declared empties short at a
 * delivery, or a POS sale's containers the walk-in did not exchange. Mirrors
 * backend/core/deposit_math.uncovered_deposit.
 */
export function uncoveredDeposit(
  declaration: Pick<EmptiesDeclaration, 'declaredBottles' | 'declaredCases' | 'depositValue' | 'shellDepositValue'>,
  collected: { bottles: number; cases: number },
): number {
  const declaredBottles = whole(declaration.declaredBottles)
  if (declaredBottles <= 0) return 0
  const declaredCases = whole(declaration.declaredCases)
  const depositValue = Math.max(0, Number(declaration.depositValue) || 0)
  const shellValue = declaredCases > 0
    ? Math.min(Math.max(0, Number(declaration.shellDepositValue) || 0), depositValue)
    : 0
  const shortBottles = Math.max(0, declaredBottles - whole(collected.bottles))
  let value = ((depositValue - shellValue) * shortBottles) / declaredBottles
  if (declaredCases > 0) {
    value += (shellValue * Math.max(0, declaredCases - whole(collected.cases))) / declaredCases
  }
  return Math.round(value * 100) / 100
}
