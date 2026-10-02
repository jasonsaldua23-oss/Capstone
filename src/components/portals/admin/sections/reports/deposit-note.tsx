import { formatPeso } from '../shared'

// Revenue counts goods only (getOrderSalesAmount). These keep the container
// deposit visible next to it, so a row still adds up to the customer's total.

/** The deposit under a sales amount; nothing when the order carried none. */
export function DepositNote({ amount }: { amount: number }) {
  if (!amount) return null
  return (
    <div className="text-[11px] font-normal text-slate-400">
      {amount > 0 ? `+ ${formatPeso(amount)} deposit` : `− ${formatPeso(Math.abs(amount))} deposit credit`}
    </div>
  )
}

/** A revenue card's hint naming the deposits it leaves out. */
export function formatDepositsExcludedHint(totalDeposits: number, scope = 'Delivered only') {
  return totalDeposits
    ? `${scope}, excl. ${formatPeso(totalDeposits)} deposits`
    : `${scope}, excl. deposits`
}
