'use client'

import React, { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync'
import { useAuth } from '@/app/page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Loader2, Truck, Menu, Bell, ChevronDown, Settings, LogOut, Clock, CheckCircle, XCircle, MapPin, TrendingUp, UserCheck, MessageSquare, AlertTriangle, Eye, EyeOff, CircleCheck, BarChart3, ShoppingCart, Package, Archive, Building2, Database, FileText, Users, Star, Download, Pencil, Trash2 } from 'lucide-react'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { AreaChart, CartesianGrid, YAxis, XAxis, Area, LineChart, Line, Tooltip, PieChart, Pie, Cell, Label, BarChart, Bar, ResponsiveContainer, Legend } from 'recharts'
import {
  toArray,
  getCollection,
  getDefaultRouteDate,
  normalizeTripStatus,
  formatPeso,
  formatDayKey,
  toIsoDateTime,
  formatDateTime,
  formatDayLabel,
  withinRange,
  getWarehouseIdFromRow,
  formatRoleLabel,
  safeFetchJson,
} from './shared'

const LiveTrackingMap = dynamic(() => import('@/components/shared/LiveTrackingMap'), {
  ssr: false,
})

const AddressMapPicker = dynamic(
  () => import('@/components/maps/AddressMapPicker').then((mod) => mod.AddressMapPicker),
  { ssr: false }
)

export function FeedbackView() {
  const [feedbacks, setFeedbacks] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [ratingFilter, setRatingFilter] = useState('all')
  const [respondingItem, setRespondingItem] = useState<any | null>(null)
  const [responseText, setResponseText] = useState('')
  const [isResponding, setIsResponding] = useState(false)

  useEffect(() => {
    async function fetchFeedbacks() {
      try {
        const response = await fetch('/api/feedback?limit=200')
        if (response.ok) {
          const data = await response.json()
          setFeedbacks(getCollection(data, ['feedbacks']))
        }
      } catch (error) {
        console.error('Failed to fetch feedback:', error)
      } finally {
        setIsLoading(false)
      }
    }
    fetchFeedbacks()
  }, [])

  const rated = feedbacks.filter((item) => typeof item.rating === 'number' && item.rating > 0)
  const avgRating = rated.length > 0
    ? rated.reduce((sum, item) => sum + item.rating, 0) / rated.length
    : 0
  const resolvedCount = feedbacks.filter((item) => ['RESOLVED', 'CLOSED'].includes(item.status)).length
  const responseRate = feedbacks.length > 0 ? Math.round((resolvedCount / feedbacks.length) * 100) : 0
  const promoters = rated.filter((item) => item.rating >= 4).length
  const detractors = rated.filter((item) => item.rating <= 2).length
  const npsScore = rated.length > 0 ? Math.round(((promoters - detractors) / rated.length) * 100) : 0

  const ratingDistribution = [5, 4, 3, 2, 1].map((score) => ({
    label: `${score} Star${score > 1 ? 's' : ''}`,
    value: rated.filter((item) => item.rating === score).length,
  }))
  const maxDistribution = Math.max(...ratingDistribution.map((item) => item.value), 1)

  const detectCategory = (item: any) => {
    const text = `${item.subject || ''} ${item.message || ''}`.toLowerCase()
    if (text.includes('price') || text.includes('cost') || text.includes('expensive')) return 'Pricing'
    if (text.includes('service') || text.includes('support') || text.includes('staff')) return 'Customer Service'
    if (text.includes('quality') || text.includes('damaged') || text.includes('dent') || text.includes('broken')) return 'Product Quality'
    return 'Delivery'
  }

  const filteredFeedbacks = feedbacks.filter((item) => {
    const search = searchTerm.trim().toLowerCase()
    const matchesSearch =
      search.length === 0 ||
      String(item.customer?.name || '').toLowerCase().includes(search) ||
      String(item.order?.orderNumber || '').toLowerCase().includes(search)
    const matchesRating = ratingFilter === 'all' || Number(item.rating || 0) === Number(ratingFilter)
    return matchesSearch && matchesRating
  })

  const renderStars = (rating: number) => {
    const rounded = Math.max(0, Math.min(5, Math.round(Number(rating || 0))))
    return (
      <span className="flex items-center gap-0.5" aria-label={`${Number(rating || 0).toFixed(1)} out of 5`}>
        {Array.from({ length: 5 }, (_, index) => (
          <Star
            key={index}
            className={`h-4 w-4 ${index < rounded ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`}
          />
        ))}
      </span>
    )
  }

  const submitResponse = async () => {
    if (!respondingItem?.id) return
    if (!responseText.trim()) {
      toast.error('Response is required')
      return
    }

    setIsResponding(true)
    try {
      const response = await fetch('/api/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: respondingItem.id,
          response: responseText.trim(),
          status: 'RESOLVED',
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to respond')
      }

      setFeedbacks((prev) =>
        prev.map((item) =>
          item.id === respondingItem.id
            ? { ...item, status: 'RESOLVED', response: responseText.trim(), respondedAt: new Date().toISOString() }
            : item
        )
      )
      toast.success('Response submitted')
      setRespondingItem(null)
      setResponseText('')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to submit response')
    } finally {
      setIsResponding(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Client Feedback</h1>
          <p className="text-gray-500">Monitor customer satisfaction and improve service quality</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-md bg-amber-50 flex items-center justify-center">
                {/* Star icon removed */}
              </div>
              <div>
                <p className="text-sm text-gray-500">Avg Rating</p>
                <p className="text-3xl font-bold">{avgRating.toFixed(1)}/5.0</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-md bg-blue-50 flex items-center justify-center">
                <MessageSquare className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Feedback</p>
                <p className="text-3xl font-bold">{feedbacks.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-md bg-green-50 flex items-center justify-center">
                {/* ThumbsUp icon removed */}
              </div>
              <div>
                <p className="text-sm text-gray-500">Response Rate</p>
                <p className="text-3xl font-bold">{responseRate}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-md bg-purple-50 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">NPS Score</p>
                <p className="text-3xl font-bold">{npsScore}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Rating Distribution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {ratingDistribution.map((row) => (
              <div key={row.label} className="grid grid-cols-[80px_1fr_40px] items-center gap-3">
                <span className="text-gray-600">{row.label}</span>
                <div className="h-3 rounded-md bg-gray-100 overflow-hidden">
                  <div
                    className="h-full min-w-[4px] bg-blue-500 transition-all"
                    style={{ width: `${Math.max((row.value / maxDistribution) * 100, row.value > 0 ? 4 : 0)}%` }}
                  />
                </div>
                <span className="text-sm text-gray-600 text-right">{row.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Satisfaction Trend</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            {/* Chart removed for missing components */}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-4">
          <label className="text-sm font-medium text-gray-700">Feedback Search and Filter</label>
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              {/* Search icon removed */}
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by customer or order ID..."
                className="pl-10"
              />
            </div>
            <Button variant="outline" size="icon">
              {/* <Filter className="h-4 w-4" /> */}
            </Button>
            <select
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              title="Filter Rating"
              value={ratingFilter}
              onChange={(e) => setRatingFilter(e.target.value)}
            >
              <option value="all">All Ratings</option>
              <option value="5">5 Stars</option>
              <option value="4">4 Stars</option>
              <option value="3">3 Stars</option>
              <option value="2">2 Stars</option>
              <option value="1">1 Star</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : filteredFeedbacks.length === 0 ? (
            <div className="py-12 text-center">
              <MessageSquare className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No customer feedback found</p>
            </div>
          ) : (
            filteredFeedbacks.map((item: any) => {
              const isResolved = ['RESOLVED', 'CLOSED'].includes(item.status)
              const category = detectCategory(item)
              return (
                <div key={item.id} className="rounded-xl border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                        <MessageSquare className="h-5 w-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-semibold text-xl">{item.customer?.name || 'Customer'} <span className="text-base font-normal text-gray-500">• {item.order?.orderNumber || 'No Order'}</span></p>
                        <div className="mt-2 flex items-center gap-2">
                          {renderStars(Number(item.rating || 0))}
                          <span className="text-sm text-gray-500">• {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : 'N/A'}</span>
                        </div>
                      </div>
                    </div>
                    <Badge className={isResolved ? 'bg-green-100 text-green-700 hover:bg-green-100' : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-100'}>
                      {isResolved ? 'Resolved' : 'Pending'}
                    </Badge>
                  </div>
                  <div className="mt-3">
                    <Badge variant="outline">{category}</Badge>
                  </div>
                  <p className="mt-3 text-xl leading-normal">{item.message || item.subject || 'No message'}</p>
                  {item.response ? (
                    <div className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-sm">
                      <span className="font-semibold">Response:</span> {item.response}
                    </div>
                  ) : (
                    <div className="mt-3">
                      <Button onClick={() => { setRespondingItem(item); setResponseText('') }}>Respond</Button>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      <Dialog open={!!respondingItem} onOpenChange={(open) => !open && setRespondingItem(null)}>
        <DialogContent>
          {respondingItem && (
            <>
              <DialogHeader>
                <DialogTitle>Respond to Feedback</DialogTitle>
                <DialogDescription>Customer: {respondingItem.customer?.name || 'N/A'} • {respondingItem.order?.orderNumber || 'N/A'}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700">Response</label>
                <textarea
                  className="w-full min-h-28 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="Type your response..."
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setRespondingItem(null)}>
                    Cancel
                  </Button>
                  <Button className="flex-1" onClick={submitResponse} disabled={isResponding}>
                    {isResponding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Send Response
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

