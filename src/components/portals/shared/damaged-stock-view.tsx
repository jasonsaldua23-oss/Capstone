'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArchiveRestore, Clock, Eye, PackageX, Plus, Trash2, Undo2, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { DashboardSummaryCard } from '@/components/portals/shared/dashboard-cards'
import { FILTER_SELECT_CLASS } from '@/components/portals/shared/filter-select'
import { PortalTableSkeleton } from '@/components/portals/shared/loading-skeletons'
import { ReplacementStatusBadge } from '@/components/portals/shared/replacement-status'
import { ACTION_ADVANCE, ACTION_INSPECT } from '@/components/portals/shared/row-actions'
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync'
import {
  DAMAGED_STOCK_STATUSES,
  customerDamageQuantityLabel,
  customerDamageStatusLabel,
  damagedQuantityLabel,
  damagedStockCauseLabel,
  damagedStockStatusLabel,
  parseCustomerDamageReports,
  parseDamagedStockRecords,
  parseDamagedStockSummary,
  productWithSize,
  type CustomerDamageReport,
  type DamagedStockRecord,
  type DamagedStockStatus,
  type DamagedStockSummary,
} from '@/lib/damaged-stock'
import { invalidateInventoryStockCaches } from '@/lib/portal-data-cache'
import { DamagedStockDetailsDialog, RecordDamagedStockDialog } from './damaged-stock-dialogs'

const EMPTY_SUMMARY: DamagedStockSummary = { pending: 0, disposed: 0, returnedToSupplier: 0, restocked: 0, lossAmount: 0 }

const STATUS_BADGE: Record<DamagedStockStatus, string> = {
  PENDING: 'border-amber-200 bg-amber-50 text-amber-800',
  DISPOSED: 'border-rose-200 bg-rose-50 text-rose-800',
  RETURNED_TO_SUPPLIER: 'border-indigo-200 bg-indigo-50 text-indigo-800',
  RESTOCKED: 'border-emerald-200 bg-emerald-50 text-emerald-800',
}

const formatPeso = (value: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value)
const formatDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

/**
 * The Inventory module's Damaged tab, for both portals: warehouse damage with what
 * became of it, and the damaged items customers reported in replacement claims.
 * `canRecord` is the warehouse portal; administrators see the same records read-only.
 */
export function DamagedStockView({ canRecord }: { canRecord: boolean }) {
  const [records, setRecords] = useState<DamagedStockRecord[]>([])
  const [summary, setSummary] = useState<DamagedStockSummary>(EMPTY_SUMMARY)
  const [reports, setReports] = useState<CustomerDamageReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | DamagedStockStatus>('ALL')
  const [search, setSearch] = useState('')
  const [recordOpen, setRecordOpen] = useState(false)
  const [selected, setSelected] = useState<DamagedStockRecord | null>(null)

  const load = useCallback(async () => {
    try {
      const [recordsResponse, reportsResponse] = await Promise.all([
        fetch('/api/damaged-stock?pageSize=200', { cache: 'no-store' }),
        fetch('/api/damaged-stock/customer-reports?pageSize=100', { cache: 'no-store' }),
      ])
      const recordsPayload = await recordsResponse.json().catch(() => ({}))
      const reportsPayload = await reportsResponse.json().catch(() => ({}))
      if (!recordsResponse.ok) throw new Error(String(recordsPayload?.error || 'Damaged stock could not be loaded'))
      setRecords(parseDamagedStockRecords(recordsPayload?.records))
      setSummary(parseDamagedStockSummary(recordsPayload?.summary))
      if (reportsResponse.ok) setReports(parseCustomerDamageReports(reportsPayload?.reports))
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Damaged stock could not be loaded')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // Stock moves with every record, and claims change in Replacements.
    return subscribeDataSync((message) => {
      const scopes = message.scopes || []
      if (scopes.includes('stock-batches') || scopes.includes('inventory') || scopes.includes('replacements')) void load()
    })
  }, [load])

  const afterChange = (record: DamagedStockRecord, message: string) => {
    toast.success(message)
    setSelected(null)
    // Sellable stock just changed: drop the cached inventory and tell every open view,
    // this one included (its sync listener reloads the list and the counts).
    invalidateInventoryStockCaches()
    setRecords((current) => [record, ...current.filter((row) => row.id !== record.id)])
    emitDataSync(['inventory', 'stocks', 'stock-batches', 'inventory-transactions'])
  }

  const query = search.trim().toLowerCase()
  const visibleRecords = useMemo(
    () =>
      records.filter((record) =>
        (statusFilter === 'ALL' || record.status === statusFilter)
        && (!query || [record.recordNumber, record.batchNumber, record.productName, record.productSku, record.description]
          .some((value) => value.toLowerCase().includes(query)))
      ),
    [query, records, statusFilter]
  )

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardSummaryCard icon={Clock} label="Pending" value={summary.pending} hint="Held out of sellable stock" tone="amber" />
        <DashboardSummaryCard
          icon={Trash2}
          label="Disposed"
          value={summary.disposed}
          hint={`${formatPeso(summary.lossAmount)} loss at listed price`}
          tone="rose"
        />
        <DashboardSummaryCard icon={Undo2} label="Returned to supplier" value={summary.returnedToSupplier} hint="No loss recorded" tone="indigo" />
        <DashboardSummaryCard icon={ArchiveRestore} label="Back in stock" value={summary.restocked} hint="Found sellable on inspection" tone="emerald" />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Damaged Stock</CardTitle>
              <CardDescription>
                Damaged products held out of sellable stock, and what became of each.
              </CardDescription>
            </div>
            {canRecord ? (
              <Button onClick={() => setRecordOpen(true)} className="bg-rose-600 text-white hover:bg-rose-700">
                <Plus className="mr-2 size-4" />
                Record damaged stock
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <div className="grid grid-cols-1 gap-3 px-6 pb-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Input
            aria-label="Search damaged stock"
            placeholder="Search by product, batch or record…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-10 w-full text-sm"
          />
          <select
            aria-label="Filter by status"
            className={FILTER_SELECT_CLASS}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as 'ALL' | DamagedStockStatus)}
          >
            <option value="ALL">All statuses</option>
            {DAMAGED_STOCK_STATUSES.map((status) => (
              <option key={status.value} value={status.value}>{status.label}</option>
            ))}
          </select>
        </div>
        <CardContent className="p-0">
          {loading ? (
            <PortalTableSkeleton rows={4} columns={7} className="border-0 shadow-none" />
          ) : error ? (
            <div className="flex h-40 flex-col items-center justify-center gap-3 text-center">
              <p role="alert" className="text-sm text-red-600">{error}</p>
              <Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button>
            </div>
          ) : visibleRecords.length === 0 ? (
            <div className="flex h-40 items-center justify-center px-6 text-center text-sm text-gray-500">
              {records.length === 0 ? 'No damaged stock recorded.' : 'No damaged stock matches these filters.'}
            </div>
          ) : (
            <div className="max-w-full overflow-x-auto overscroll-x-contain">
              <table className="stack-table w-full min-w-[1040px] text-sm">
                <thead className="border-b bg-gray-50">
                  <tr>
                    {['Record', 'Product', 'Batch', 'Quantity', 'Cause', 'Recorded', 'Status', 'Loss', 'Actions'].map((label) => (
                      <th key={label} className="whitespace-nowrap p-3 text-left font-medium text-gray-600">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRecords.map((record) => (
                    <tr key={record.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="p-3 font-medium text-gray-900"><span className="whitespace-nowrap">{record.recordNumber}</span></td>
                      <td className="p-3">
                        <p className="font-medium text-gray-900">{productWithSize(record.productName, record.productSizes)}</p>
                        <p className="text-xs text-gray-500">{record.productSku}</p>
                      </td>
                      <td className="p-3"><span className="whitespace-nowrap">{record.batchNumber || 'Unavailable'}</span></td>
                      <td className="p-3 font-semibold"><span className="whitespace-nowrap">{damagedQuantityLabel(record.cases, record.looseUnits)}</span></td>
                      <td className="max-w-[220px] p-3 text-gray-700">{damagedStockCauseLabel(record.cause)}</td>
                      <td className="p-3 text-gray-600">
                        <span className="whitespace-nowrap">{formatDate(record.recordedAt)}</span>
                        {record.recordedBy ? <span className="block text-xs text-gray-500">{record.recordedBy}</span> : null}
                      </td>
                      <td className="p-3">
                        <Badge className={`whitespace-nowrap border ${STATUS_BADGE[record.status]}`}>{damagedStockStatusLabel(record.status)}</Badge>
                      </td>
                      <td className="p-3 font-semibold text-rose-700">
                        {record.lossAmount !== null ? <span className="whitespace-nowrap">{formatPeso(record.lossAmount)}</span> : <span className="font-normal text-gray-400">—</span>}
                      </td>
                      <td className="p-3">
                        {record.canManage ? (
                          <Button size="sm" className={ACTION_ADVANCE} onClick={() => setSelected(record)}>
                            <Wrench className="size-3.5" />
                            Resolve<span className="sr-only"> {record.recordNumber}</span>
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" className={ACTION_INSPECT} onClick={() => setSelected(record)}>
                            <Eye className="size-3.5" />
                            View<span className="sr-only"> {record.recordNumber}</span>
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageX className="size-5 text-slate-500" aria-hidden="true" />
            Reported by customers
          </CardTitle>
          <CardDescription>
            Damaged items customers reported in replacement claims. They are reviewed and replaced in Replacements; their status follows the claim.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <PortalTableSkeleton rows={3} columns={6} className="border-0 shadow-none" />
          ) : reports.length === 0 ? (
            <div className="flex h-28 items-center justify-center text-sm text-gray-500">No damaged items reported by customers.</div>
          ) : (
            <div className="max-w-full overflow-x-auto overscroll-x-contain">
              <table className="stack-table w-full min-w-[900px] text-sm">
                <thead className="border-b bg-gray-50">
                  <tr>
                    {['Claim', 'Reported', 'Customer', 'Product', 'Quantity', 'Reason', 'Claim status'].map((label) => (
                      <th key={label} className="whitespace-nowrap p-3 text-left font-medium text-gray-600">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report) => (
                    <tr key={report.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="p-3 font-medium text-gray-900">
                        <span className="whitespace-nowrap">{report.replacementNumber}</span>
                        {report.orderNumber ? <span className="block whitespace-nowrap text-xs font-normal text-gray-500">{report.orderNumber}</span> : null}
                      </td>
                      <td className="p-3 text-gray-600"><span className="whitespace-nowrap">{formatDate(report.reportedAt)}</span></td>
                      <td className="p-3 text-gray-700">{report.customerName || '—'}</td>
                      <td className="p-3 font-medium text-gray-900">{productWithSize(report.productName, report.productSizes)}</td>
                      <td className="p-3 font-semibold"><span className="whitespace-nowrap">{customerDamageQuantityLabel(report)}</span></td>
                      <td className="max-w-[240px] p-3 text-gray-700">
                        {report.reason || '—'}
                        {report.description ? <span className="block text-xs text-gray-500">{report.description}</span> : null}
                      </td>
                      <td className="p-3">
                        <ReplacementStatusBadge statusLabel={customerDamageStatusLabel(report.status)} className="whitespace-nowrap border" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {canRecord ? (
        <RecordDamagedStockDialog
          open={recordOpen}
          onOpenChange={setRecordOpen}
          onRecorded={(record) =>
            afterChange(record, `${record.recordNumber}: ${damagedQuantityLabel(record.cases, record.looseUnits)} set aside from sellable stock.`)
          }
        />
      ) : null}
      <DamagedStockDetailsDialog
        record={selected}
        onClose={() => setSelected(null)}
        onResolved={(record) => afterChange(record, `${record.recordNumber} marked ${damagedStockStatusLabel(record.status).toLowerCase()}.`)}
      />
    </div>
  )
}
