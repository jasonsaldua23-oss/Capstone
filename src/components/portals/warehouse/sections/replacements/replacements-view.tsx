'use client'

import { AlertTriangle, Boxes, ClipboardList, Loader2, PackageCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { WarehouseReplacementsViewProps } from '../shared/types'

export function WarehouseReplacementsView({
  replacementSummary,
  loadingReplacements,
  scopedReplacements,
  parseIssueMeta,
  formatIssueStatus,
  updateIssueStatus,
  updatingReplacementId,
  selectedReplacement,
  setSelectedReplacement,
  buildReplacementLines,
}: WarehouseReplacementsViewProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Replacements</h1>
          <p className="text-gray-500">Reverse logistics monitoring for replacement cases, evidence, and resolution status</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex h-full items-start gap-3 p-5">
            <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-gray-500">Total Cases</p>
              <p className="mt-1 text-2xl font-bold leading-none">{replacementSummary.totalCases}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex h-full items-start gap-3 p-5">
            <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600">
              <PackageCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-gray-500">Resolved on Delivery</p>
              <p className="mt-1 text-2xl font-bold leading-none">{replacementSummary.resolvedOnDelivery}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex h-full items-start gap-3 p-5">
            <div className="rounded-xl bg-amber-50 p-2.5 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-gray-500">Needs Follow-up</p>
              <p className="mt-1 text-2xl font-bold leading-none">{replacementSummary.needsFollowUp}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex h-full items-start gap-3 p-5">
            <div className="rounded-xl bg-violet-50 p-2.5 text-violet-600">
              <Boxes className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-gray-500">Total Replaced Qty</p>
              <p className="mt-1 text-2xl font-bold leading-none">{replacementSummary.replacedQty}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {loadingReplacements ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : scopedReplacements.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-gray-500">No replacement cases found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left p-4 font-medium text-gray-600">Replacement #</th>
                    <th className="text-left p-4 font-medium text-gray-600">Order #</th>
                    <th className="text-left p-4 font-medium text-gray-600">Customer</th>
                    <th className="text-left p-4 font-medium text-gray-600">Replacement Details</th>
                    <th className="text-left p-4 font-medium text-gray-600">Evidence</th>
                    <th className="text-left p-4 font-medium text-gray-600">Status</th>
                    <th className="text-left p-4 font-medium text-gray-600">Reported</th>
                    <th className="text-left p-4 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedReplacements.map((ret) => {
                    const meta = parseIssueMeta(ret?.notes)
                    const issueReason = String(ret?.description || ret?.reason || 'No details provided')
                    const replacementQty = Number(ret?.replacementQuantity ?? meta?.replacementQuantity ?? 0)
                    const hasEvidence = Boolean(String(ret?.damagePhotoUrl || meta?.damagePhotoUrl || '').trim())
                    const statusLabel = formatIssueStatus(ret)
                    return (
                      <tr key={ret.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="p-4 font-medium">{ret.replacementNumber}</td>
                        <td className="p-4">{ret.orderNumber || ret.order?.orderNumber || 'N/A'}</td>
                        <td className="p-4">{ret.customerName || ret.order?.customer?.name || 'N/A'}</td>
                        <td className="p-4">
                          <p className="text-sm text-gray-900">{issueReason}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            {replacementQty > 0 ? <span>Qty replaced: {replacementQty}</span> : null}
                          </div>
                        </td>
                        <td className="p-4">
                          <Badge variant={hasEvidence ? 'default' : 'secondary'}>
                            {hasEvidence ? 'Photo Attached' : 'No Photo'}
                          </Badge>
                        </td>
                        <td className="p-4">
                          <Badge
                            className={
                              statusLabel === 'Needs Follow-up'
                                ? 'bg-red-100 text-red-700 hover:bg-red-100'
                                : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'
                            }
                          >
                            {statusLabel}
                          </Badge>
                        </td>
                        <td className="p-4 text-gray-500">
                          {ret.createdAt ? new Date(ret.createdAt).toLocaleDateString() : 'N/A'}
                        </td>
                        <td className="p-4">
                          <div className="flex flex-wrap gap-2">
                            {String(ret?.status || '').toUpperCase() !== 'COMPLETED' && String(ret?.status || '').toUpperCase() !== 'RESOLVED_ON_DELIVERY' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void updateIssueStatus(ret.id, 'COMPLETED', 'Marked completed by warehouse staff')}
                                disabled={updatingReplacementId === ret.id}
                              >
                                Mark Completed
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedReplacement(ret)}
                            >
                              View Details
                            </Button>
                            {updatingReplacementId === ret.id ? <Loader2 className="h-4 w-4 animate-spin text-blue-600" /> : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedReplacement} onOpenChange={(open) => !open && setSelectedReplacement(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          {selectedReplacement ? (() => {
            const meta = parseIssueMeta(selectedReplacement.notes)
            const evidenceUrl = String(selectedReplacement.damagePhotoUrl || meta?.damagePhotoUrl || '').trim()
            const replacementLines = buildReplacementLines(selectedReplacement, meta)
            const details = [
              ['Replacement #', selectedReplacement.replacementNumber],
              ['Order #', selectedReplacement.orderNumber || selectedReplacement.order?.orderNumber || 'N/A'],
              ['Customer', selectedReplacement.customerName || selectedReplacement.order?.customer?.name || 'N/A'],
              ['Status', formatIssueStatus(selectedReplacement)],
              ['Reported', selectedReplacement.createdAt ? new Date(selectedReplacement.createdAt).toLocaleString() : 'N/A'],
              ['Reason', selectedReplacement.reason || 'N/A'],
              ['Resolution', selectedReplacement.description || 'N/A'],
              ['Replacement Mode', String(selectedReplacement.replacementMode || meta?.replacementMode || 'N/A').replace(/_/g, ' ')],
            ] as Array<[string, string]>
            return (
              <>
                <DialogHeader>
                  <DialogTitle>Replacement Details</DialogTitle>
                  <DialogDescription>Complete information for {selectedReplacement.replacementNumber}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3 sm:grid-cols-2">
                  {details.map(([label, value]) => (
                    <div key={label} className="rounded-md border bg-slate-50 px-3 py-2">
                      <p className="text-xs font-medium text-slate-500">{label}</p>
                      <p className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-md border bg-white">
                  <div className="border-b px-3 py-2">
                    <p className="text-xs font-medium text-slate-500">Replacement Items</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-xs text-slate-500">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Original Product</th>
                          <th className="px-3 py-2 text-left font-medium">Replacement Product</th>
                          <th className="px-3 py-2 text-left font-medium">Quantity to Replace</th>
                          <th className="px-3 py-2 text-left font-medium">Quantity Replaced</th>
                        </tr>
                      </thead>
                      <tbody>
                        {replacementLines.map((line, index) => (
                          <tr key={`${line.originalProductName}-${index}`} className="border-t first:border-t-0">
                            <td className="px-3 py-2 font-semibold text-slate-900">{line.originalProductName}</td>
                            <td className="px-3 py-2 font-semibold text-slate-900">{line.replacementProductName}</td>
                            <td className="px-3 py-2 font-semibold text-slate-900">{line.quantityToReplace}</td>
                            <td className="px-3 py-2 font-semibold text-slate-900">{line.quantityReplaced}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {evidenceUrl ? (
                  <div className="rounded-md border bg-white px-3 py-2">
                    <p className="text-xs font-medium text-slate-500">Evidence</p>
                    <img src={evidenceUrl} alt="Replacement evidence" className="mt-2 max-h-[360px] w-full rounded-md border object-contain" />
                  </div>
                ) : null}
              </>
            )
          })() : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
