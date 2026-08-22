'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { CheckCircle, AlertCircle, Loader2, ArrowRightCircle } from 'lucide-react'
import { toast } from 'sonner'

interface BottleReturnLine {
  id: string
  containerType: {
    id: string
    name: string
  }
  returnedQuantity: number
  acceptedQuantity: number | null
}

interface BottleReturn {
  id: string
  referenceNumber: string
  customer: {
    id: string
    name: string
  }
  status: 'PENDING' | 'PROCESSED'
  createdAt: string
  processedAt: string | null
  lines: BottleReturnLine[]
}

export function WarehouseBottleReturnsView() {
  const [returns, setReturns] = useState<BottleReturn[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedReturn, setSelectedReturn] = useState<BottleReturn | null>(null)
  const [gradingState, setGradingState] = useState<Record<string, number>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const fetchReturns = async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/bottle-returns')
      if (!res.ok) {
        setReturns([])
        return
      }
      const data = await res.json().catch(() => ({}))
      setReturns(Array.isArray(data.returns) ? data.returns : [])
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchReturns()
  }, [])

  const handleOpenGradeDialog = (ret: BottleReturn) => {
    setSelectedReturn(ret)
    const initialGrading: Record<string, number> = {}
    ret.lines.forEach(line => {
      initialGrading[line.id] = line.returnedQuantity
    })
    setGradingState(initialGrading)
  }

  const handleGradeSubmit = async () => {
    if (!selectedReturn) return
    setIsSubmitting(true)
    try {
      const returnLines = selectedReturn.lines.map(line => ({
        id: line.id,
        acceptedQuantity: gradingState[line.id] ?? line.returnedQuantity
      }))
      const res = await fetch(`/api/bottle-returns/${selectedReturn.id}/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnLines })
      })
      
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(payload.error || 'Failed to grade return')
      }
      
      toast.success('Return processed successfully')
      setSelectedReturn(null)
      fetchReturns()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Bottle Returns</h2>
        <p className="text-sm text-slate-500">Process and grade empty container returns from customers.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Returns</CardTitle>
          <CardDescription>A list of returned empties waiting to be inspected.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : returns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-slate-500">
              <CheckCircle className="mb-4 h-12 w-12 text-slate-300" />
              <p className="text-lg font-medium text-slate-900">No pending returns</p>
              <p>All bottle returns have been processed.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b">
                  <tr>
                    <th className="px-4 py-3 font-medium">Reference Number</th>
                    <th className="px-4 py-3 font-medium">Customer</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Total Returned</th>
                    <th className="px-4 py-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {returns.map((ret) => {
                    const totalReturned = ret.lines.reduce((sum, line) => sum + line.returnedQuantity, 0)
                    return (
                      <tr key={ret.id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-medium text-slate-900">{ret.referenceNumber}</td>
                        <td className="px-4 py-3">{ret.customer.name}</td>
                        <td className="px-4 py-3">{new Date(ret.createdAt).toLocaleString()}</td>
                        <td className="px-4 py-3">
                          <Badge variant={ret.status === 'PENDING' ? 'outline' : 'secondary'} className={ret.status === 'PENDING' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}>
                            {ret.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">{totalReturned} empties</td>
                        <td className="px-4 py-3 text-right">
                          {ret.status === 'PENDING' ? (
                            <Button size="sm" onClick={() => handleOpenGradeDialog(ret)}>
                              Grade
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" disabled>
                              Processed
                            </Button>
                          )}
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

      <Dialog open={!!selectedReturn} onOpenChange={(open) => !open && setSelectedReturn(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Grade Bottle Return</DialogTitle>
            <DialogDescription>
              Inspect the returned empties for {selectedReturn?.customer.name} and enter the accepted quantities. 
              Rejected empties will not be refunded.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="space-y-4">
              {selectedReturn?.lines.map(line => (
                <div key={line.id} className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0">
                  <div>
                    <p className="font-medium text-slate-900">{line.containerType.name}</p>
                    <p className="text-sm text-slate-500">Returned: {line.returnedQuantity}</p>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Label htmlFor={`grade-${line.id}`} className="text-sm text-slate-600">Accepted:</Label>
                    <Input 
                      id={`grade-${line.id}`}
                      type="number"
                      min="0"
                      max={line.returnedQuantity}
                      value={gradingState[line.id] ?? line.returnedQuantity}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 0
                        setGradingState(prev => ({
                          ...prev,
                          [line.id]: Math.min(Math.max(0, val), line.returnedQuantity)
                        }))
                      }}
                      className="w-20 text-right"
                    />
                  </div>
                </div>
              ))}
            </div>
            
            <div className="mt-6 rounded-lg bg-blue-50 p-4 flex gap-3">
              <AlertCircle className="h-5 w-5 text-blue-600 shrink-0" />
              <div className="text-sm text-blue-800">
                <p className="font-semibold">Deposit Refund Notice</p>
                <p className="mt-1">
                  Upon processing, the accepted quantities will automatically be credited to the customer's ledger as a deposit refund.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedReturn(null)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button onClick={handleGradeSubmit} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Process Return
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
