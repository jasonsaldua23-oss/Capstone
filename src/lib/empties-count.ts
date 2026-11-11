/**
 * The driver's count of the empties a customer declared, and what a shortfall costs.
 *
 * Cases and bottles are counted apart: a customer can hand back an empty case with
 * no bottles in it, or bottles without their case. A missing bottle is charged the
 * bottle deposit and a missing case its shell, so a case handed back one bottle short
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
  /** Case shells handed over, whatever is in them. */
  cases: number
  /** Bottles handed over, in a case or not. */
  bottles: number
}

const whole = (value: number) => Math.max(0, Math.floor(Number(value) || 0))

/** Keep each count within what the customer declared; neither limits the other. */
export function clampEmptiesCount(count: EmptiesCount, declaration: EmptiesDeclaration): EmptiesCount {
  return {
    cases: Math.min(whole(count.cases), whole(declaration.declaredCases)),
    bottles: Math.min(whole(count.bottles), whole(declaration.declaredBottles)),
  }
}

/**
 * Change the cases handed over, taking a full case of bottles with each one, so the
 * usual shortfall of whole cases is one tap. The driver corrects the bottles after
 * when a case came back empty or bottles came without their case.
 */
export function stepEmptiesCases(count: EmptiesCount, nextCases: number, declaration: EmptiesDeclaration): EmptiesCount {
  const current = clampEmptiesCount(count, declaration)
  const cases = Math.min(whole(nextCases), whole(declaration.declaredCases))
  const perCase = Math.max(1, whole(declaration.containersPerCase))
  return clampEmptiesCount({ cases, bottles: current.bottles + (cases - current.cases) * perCase }, declaration)
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
