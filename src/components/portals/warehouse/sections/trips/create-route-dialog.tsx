'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
import type { DriverOption, RoutePlanCityGroup, TripEditorState, WarehouseItem, WarehouseOrderItem } from '../../warehouse-portal-types'
import { getLocalTodayDayKey } from '../../warehouse-portal-utils'
import { Warehouse, Loader2 } from 'lucide-react'
import { TripLoadSummary } from '@/components/shared/trip-load-summary'
import { isWarehouseRescheduledOrder, getOrderBarangayLabel } from '../../warehouse-order-helpers'
import type { WarehouseRoutePlanning } from './use-warehouse-route-planning'
import type { deriveOrderFulfillmentSummaryImpl } from '../../warehouse-order-helpers'

/**
 * Route planner: groups the day's orders by city, lets staff pick orders and a driver, and creates or edits the trip.
 */
export type WarehouseCreateRouteDialogProps = {
  createRouteOpen: boolean
  createRoutePlan: WarehouseRoutePlanning['createRoutePlan']
  createTripFromCurrentRoutePlan: WarehouseRoutePlanning['createTripFromCurrentRoutePlan']
  creatingTripFromRoute: boolean
  deriveOrderFulfillmentSummary: (order: any) => ReturnType<typeof deriveOrderFulfillmentSummaryImpl>
  driverAvailability: WarehouseRoutePlanning['driverAvailability']
  drivers: DriverOption[]
  editingTripId: string | null
  editingTripState: TripEditorState | null
  formatAllocatedQtyLabel: (order: any, allocatedQty: number, totalQty: number) => string
  getDriverTripEligibilityLabel: WarehouseRoutePlanning['getDriverTripEligibilityLabel']
  getRouteReplacementProducts: (order: any) => string
  handleRouteOrderClick: WarehouseRoutePlanning['handleRouteOrderClick']
  isDriverSelectableForTrip: WarehouseRoutePlanning['isDriverSelectableForTrip']
  isSelectedRouteOverloaded: WarehouseRoutePlanning['isSelectedRouteOverloaded']
  isSelectedVehicleCapacityMissing: WarehouseRoutePlanning['isSelectedVehicleCapacityMissing']
  loadingRoutePlans: boolean
  orders: WarehouseOrderItem[]
  routeDate: string
  routePlanMessage: { type: 'info' | 'error' | 'success'; text: string } | null
  routePlans: RoutePlanCityGroup[]
  routeWarehouseId: string
  saveTripEditsFromCurrentRoutePlan: WarehouseRoutePlanning['saveTripEditsFromCurrentRoutePlan']
  selectedDriverAssignedVehicle: WarehouseRoutePlanning['selectedDriverAssignedVehicle']
  selectedDriverEligibilityIssue: WarehouseRoutePlanning['selectedDriverEligibilityIssue']
  selectedRouteCity: string
  selectedRouteDriverId: string
  selectedRouteLoad: WarehouseRoutePlanning['selectedRouteLoad']
  selectedRouteOrderIds: string[]
  selectedVehicleCapacity: WarehouseRoutePlanning['selectedVehicleCapacity']
  setCreateRouteOpen: Dispatch<SetStateAction<boolean>>
  setEditingTripState: Dispatch<SetStateAction<TripEditorState | null>>
  setRouteDate: Dispatch<SetStateAction<string>>
  setRoutePlanMessage: Dispatch<SetStateAction<{ type: 'info' | 'error' | 'success'; text: string } | null>>
  setRoutePlans: Dispatch<SetStateAction<RoutePlanCityGroup[]>>
  setSelectedRouteCity: Dispatch<SetStateAction<string>>
  setSelectedRouteDriverId: Dispatch<SetStateAction<string>>
  setSelectedRouteOrderIds: Dispatch<SetStateAction<string[]>>
  warehouses: WarehouseItem[]
}

export function WarehouseCreateRouteDialog({
  createRouteOpen,
  createRoutePlan,
  createTripFromCurrentRoutePlan,
  creatingTripFromRoute,
  deriveOrderFulfillmentSummary,
  driverAvailability,
  drivers,
  editingTripId,
  editingTripState,
  formatAllocatedQtyLabel,
  getDriverTripEligibilityLabel,
  getRouteReplacementProducts,
  handleRouteOrderClick,
  isDriverSelectableForTrip,
  isSelectedRouteOverloaded,
  isSelectedVehicleCapacityMissing,
  loadingRoutePlans,
  orders,
  routeDate,
  routePlanMessage,
  routePlans,
  routeWarehouseId,
  saveTripEditsFromCurrentRoutePlan,
  selectedDriverAssignedVehicle,
  selectedDriverEligibilityIssue,
  selectedRouteCity,
  selectedRouteDriverId,
  selectedRouteLoad,
  selectedRouteOrderIds,
  selectedVehicleCapacity,
  setCreateRouteOpen,
  setEditingTripState,
  setRouteDate,
  setRoutePlanMessage,
  setRoutePlans,
  setSelectedRouteCity,
  setSelectedRouteDriverId,
  setSelectedRouteOrderIds,
  warehouses,
}: WarehouseCreateRouteDialogProps) {
  const [confirmCreateOpen, setConfirmCreateOpen] = useState(false)
  const selectedRouteDriverName = drivers.find((driver) => driver.id === selectedRouteDriverId)?.user?.name
    || drivers.find((driver) => driver.id === selectedRouteDriverId)?.name
    || drivers.find((driver) => driver.id === selectedRouteDriverId)?.email
    || ''
  return (
    <>
    <Dialog
      open={createRouteOpen}
      onOpenChange={(open) => {
        setCreateRouteOpen(open)
        if (!open) {
          setEditingTripState(null)
          setRoutePlans([])
          setSelectedRouteCity('')
          setSelectedRouteOrderIds([])
          setRoutePlanMessage(null)
        }
      }}
    >
      {/* Fix: override the shared dialog's sm:max-w-lg cap so both trip panes remain readable on desktop. */}
      <DialogContent className="m-auto flex h-[95vh] w-[95vw] max-w-[1180px] min-w-0 items-stretch justify-center overflow-hidden rounded-xl p-0 shadow-xl sm:max-w-[1180px] z-[60]">
        <DialogHeader>
          <DialogTitle className="sr-only">{editingTripState ? 'Edit Trip' : 'Create Trip'}</DialogTitle>
        </DialogHeader>
        <div className="flex h-full w-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          {/* On phones the trip controls stack above the route preview so neither pane is clipped. */}
          <div className="flex h-[70vh] w-full min-w-0 max-w-none shrink-0 flex-col overflow-hidden border-b bg-white p-2.5 lg:h-full lg:w-[280px] lg:min-w-[260px] lg:max-w-[300px] lg:border-b-0 lg:border-r">
            <h2 className="mb-2 text-lg font-bold">{editingTripState ? `Edit ${editingTripState.tripNumber}` : 'Create Trip'}</h2>
            <div className="mb-2">
              <label htmlFor="popup-route-date" className="text-sm font-medium text-gray-700">
                {editingTripState ? 'Trip Delivery Date' : 'Delivery Date'}
              </label>
              <Input
                id="popup-route-date"
                type="date"
                value={routeDate}
                min={getLocalTodayDayKey()}
                disabled={Boolean(editingTripState)}
                onChange={(e) => setRouteDate(e.target.value)}
                className="mt-1 h-9 text-sm"
              />
            </div>
            <Button className="mt-1 mb-2 h-9 w-full bg-blue-600 text-sm text-white hover:bg-blue-700" onClick={() => createRoutePlan(false, routeDate, routeWarehouseId)} disabled={loadingRoutePlans}>
              {loadingRoutePlans ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
              {editingTripState ? 'Refresh Orders' : 'Filter Orders'}
            </Button>

            {routePlanMessage && (
              <div className={`mb-2 rounded-lg p-2 text-[11px] ${routePlanMessage.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                {routePlanMessage.text}
              </div>
            )}

            {/* Fix: keep the order results in their own mouse/touch scroll area. */}
            <div className="min-h-[120px] flex-1 overflow-y-scroll overscroll-contain touch-pan-y rounded-lg bg-gray-50 p-2.5">
              <h3 className="mb-1.5 text-base font-semibold">Orders by City</h3>
              {routePlans.length === 0 ? (
                <div className="flex items-center justify-center text-sm text-gray-400 min-h-[80px]">
                  {loadingRoutePlans ? 'Loading orders...' : editingTripState ? 'No trip orders are available to edit right now' : 'Pick a delivery date and warehouse to view orders by city'}
                </div>
              ) : (
                <div className="space-y-2">
                  {routePlans.map((cityGroup) => (
                    <div key={cityGroup.city}>
                      <button
                        onClick={() => setSelectedRouteCity(cityGroup.city)}
                        className={`mb-1 w-full rounded-lg p-2 text-left text-sm font-semibold transition-colors ${
                          selectedRouteCity === cityGroup.city
                            ? 'bg-blue-500 text-white'
                            : 'bg-white border border-gray-200 text-gray-900 hover:border-blue-400'
                        }`}
                      >
                        {cityGroup.city} ({cityGroup.orders.length} orders)
                      </button>
                      {selectedRouteCity === cityGroup.city && (
                        <div className="mb-2 space-y-1 pl-2">
                          {cityGroup.orders.map((order) => (
                            <button
                              key={order.id}
                              onClick={() => handleRouteOrderClick(cityGroup.city, order.id)}
                              className={`w-full rounded p-1 text-left text-[11px] transition-colors ${
                                selectedRouteOrderIds.includes(order.id)
                                  ? 'bg-blue-100 text-blue-900 font-medium'
                                  : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span
                                  aria-hidden="true"
                                  className={`inline-flex h-4 w-4 items-center justify-center rounded border ${
                                    selectedRouteOrderIds.includes(order.id)
                                      ? 'border-blue-600 bg-blue-600 text-white'
                                      : 'border-gray-300 bg-white'
                                  }`}
                                >
                                  {selectedRouteOrderIds.includes(order.id) ? '\u2713' : ''}
                                </span>
                                <span className="truncate">{order.orderNumber || order.id}</span>
                                {(order as any)?.currentTripOrder ? (
                                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">In Trip</span>
                                ) : null}
                                {isWarehouseRescheduledOrder(order) ? (
                                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Rescheduled Order</span>
                                ) : null}
                                {(Boolean((order as any)?.isScheduledReplacement) || String(order?.orderNumber || '').toUpperCase().startsWith('RPL-')) ? (
                                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">Scheduled Replacement</span>
                                ) : null}
                              </div>
                              <div className="text-xs text-gray-500 truncate">{getOrderBarangayLabel(order.address, order.city)}</div>
                              {(() => {
                                const summary = deriveOrderFulfillmentSummary(order)
                                const isMultiWarehouse = summary.totalLegs > 1
                                if (!isMultiWarehouse) return null
                                if (!Array.isArray((order as any)?.productAllocations) || (order as any).productAllocations.length === 0) return null
                                return (
                                  <div className="mt-0.5 space-y-0.5">
                                    {(order as any).productAllocations.map((line: any, index: number) => (
                                      <div
                                        key={`${String(line?.itemId || index)}`}
                                        className={`text-[10px] ${Number(line?.allocatedQtyForSelectedWarehouse || 0) > 0 ? 'text-emerald-700' : 'text-amber-700'}`}
                                      >
                                        {String(line?.productName || 'Product')}
                                        {String(line?.sizeLabel || '').trim() ? ` (${String(line.sizeLabel).trim()})` : ''}: {formatAllocatedQtyLabel(order, Number(line?.allocatedQtyForSelectedWarehouse || 0), Number(line?.totalQty || 0))}
                                      </div>
                                    ))}
                                  </div>
                                )
                              })()}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-1 space-y-1">
              {editingTripState ? (
                <>
                  <label className="text-[11px] font-medium text-gray-700">Assign Driver</label>
                  <select
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    title="Assign Driver"
                    value={selectedRouteDriverId}
                    onChange={(e) => setSelectedRouteDriverId(e.target.value)}
                  >
                    <option value="">Select driver</option>
                    {drivers.map((driver) => (
                      <option
                        key={driver.id}
                        value={driver.id}
                        disabled={!isDriverSelectableForTrip(driver, { allowDriverId: editingTripState.originalDriverId, allowVehicleId: editingTripState.originalVehicleId })}
                      >
                        {(driver.user?.name || driver.name || driver.email || driver.id) + (() => {
                          const issue = getDriverTripEligibilityLabel(driver, { allowDriverId: editingTripState.originalDriverId, allowVehicleId: editingTripState.originalVehicleId })
                          return issue ? ` (${issue})` : ''
                        })()}
                      </option>
                    ))}
                  </select>
                  {driverAvailability.message ? (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                      {driverAvailability.message}
                    </p>
                  ) : null}
                  <Input
                    readOnly
                    className="h-8 text-xs"
                    value={selectedDriverAssignedVehicle?.licensePlate || editingTripState.vehiclePlate}
                  />
                  {selectedRouteDriverId && selectedRouteDriverId !== editingTripState.originalDriverId && selectedDriverEligibilityIssue ? (
                    <p className="text-[11px] text-amber-600">Selected driver cannot be assigned: {selectedDriverEligibilityIssue}.</p>
                  ) : null}
                  <p className="text-[11px] text-gray-500">This edit updates the trip orders and driver assignment.</p>
                </>
              ) : (
                <>
                  <label className="text-[11px] font-medium text-gray-700">Assign Driver</label>
                  <select
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    title="Assign Driver"
                    value={selectedRouteDriverId}
                    onChange={(e) => setSelectedRouteDriverId(e.target.value)}
                  >
                    <option value="">Select driver</option>
                    {drivers.map((driver) => (
                      <option key={driver.id} value={driver.id} disabled={!isDriverSelectableForTrip(driver)}>
                        {(driver.user?.name || driver.name || driver.email || driver.id) + (() => {
                          const issue = getDriverTripEligibilityLabel(driver)
                          return issue ? ` (${issue})` : ''
                        })()}
                      </option>
                    ))}
                  </select>
                  {driverAvailability.message ? (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                      {driverAvailability.message}
                    </p>
                  ) : null}
                  <Input
                    readOnly
                    className="h-8 text-xs"
                    value={selectedDriverAssignedVehicle?.licensePlate || 'No assigned vehicle'}
                  />
                  {selectedRouteDriverId && selectedDriverEligibilityIssue ? (
                    <p className="text-[11px] text-amber-600">Selected driver cannot be assigned: {selectedDriverEligibilityIssue}.</p>
                  ) : null}
                </>
              )}
              <TripLoadSummary
                totalCases={selectedRouteLoad.totalCases}
                totalWeight={selectedRouteLoad.totalWeight}
                maximumCapacity={selectedVehicleCapacity}
                compact
              />
              <Button
                className="h-8 w-full bg-blue-600 text-sm text-white hover:bg-blue-700"
                onClick={() => {
                  if (editingTripState) {
                    void saveTripEditsFromCurrentRoutePlan()
                  } else {
                    setConfirmCreateOpen(true)
                  }
                }}
                disabled={
                  creatingTripFromRoute ||
                  loadingRoutePlans ||
                  !routeDate ||
                  !routeWarehouseId ||
                  (editingTripState
                    ? (
                        editingTripId === editingTripState.tripId ||
                        !String(selectedRouteDriverId || editingTripState.originalDriverId || '').trim() ||
                        Boolean(selectedDriverEligibilityIssue) ||
                        (
                          String(selectedRouteDriverId || editingTripState.originalDriverId || '').trim() !== String(editingTripState.originalDriverId || '').trim() &&
                          !selectedDriverAssignedVehicle?.id
                        )
                      )
                    : (
                        !selectedRouteCity ||
                        selectedRouteOrderIds.length === 0 ||
                        !selectedRouteDriverId ||
                        Boolean(selectedDriverEligibilityIssue) ||
                        !selectedDriverAssignedVehicle?.id ||
                        isSelectedVehicleCapacityMissing ||
                        isSelectedRouteOverloaded
                      ))
                }
              >
                {/* Show immediate progress feedback for both trip creation and trip-detail saves. */}
                {creatingTripFromRoute || (editingTripState && editingTripId === editingTripState.tripId)
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : null}
                {editingTripState
                  ? editingTripId === editingTripState.tripId ? 'Saving Trip Changes...' : 'Save Trip Changes'
                  : 'Create Trip'}
              </Button>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-gray-50 p-3 sm:p-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Delivery Locations</CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="flex w-full flex-col items-center rounded-xl border bg-gray-50 p-4">
                  {(() => {
                    const wh = warehouses.find((w) => w.id === routeWarehouseId)
                    if (!wh) return <div className="mb-4 text-gray-400">Select a warehouse to start</div>
                    return (
                      <div className="mb-2 w-full max-w-lg">
                        <div className="mb-1 flex flex-col items-start rounded-lg border-2 border-green-400 bg-green-50 p-2.5">
                          <div className="mb-1 flex items-center gap-2">
                            <span className="mr-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-white font-bold">
                              <svg width="16" height="16" fill="none"><path d="M9 2.25a6.75 6.75 0 1 1 0 13.5a6.75 6.75 0 0 1 0-13.5Zm0 2.25v2.25m0 2.25h.008v.008H9V6.75Z" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            </span>
                            <span className="text-sm font-semibold text-green-900">Warehouse - Starting Point</span>
                          </div>
                          <div className="text-[11px] font-semibold text-gray-700">{wh.name}</div>
                          <div className="text-[10px] text-green-700">{[wh.address, wh.city, wh.province].filter(Boolean).join(', ')}</div>
                          {wh.latitude && wh.longitude && (
                            <div className="mt-0.5 text-[10px] text-gray-500">Coordinates: {wh.latitude}, {wh.longitude}</div>
                          )}
                        </div>
                      </div>
                    )
                  })()}
                  <div className="flex w-full max-w-xl flex-col gap-2">
                    {(() => {
                      if (!routePlans || !selectedRouteCity) return null
                      const group = routePlans.find((g) => g.city === selectedRouteCity)
                      if (!group) return null
                      const selectedOrders = group.orders.filter((order) => selectedRouteOrderIds.includes(order.id))
                      return selectedOrders.map((order, idx) => (
                        <div key={order.id} className="flex items-start gap-2 rounded-lg border bg-white p-3">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-500 text-sm font-bold text-white">{idx + 1}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                              <span>{order.customerName || order.orderNumber}</span>
                              {(order as any)?.currentTripOrder ? (
                                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">In Trip</span>
                              ) : null}
                              {isWarehouseRescheduledOrder(order) ? (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Rescheduled Order</span>
                              ) : null}
                              {(Boolean((order as any)?.isScheduledReplacement) || String(order?.orderNumber || '').toUpperCase().startsWith('RPL-')) ? (
                                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">Scheduled Replacement</span>
                              ) : null}
                            </div>
                            <div className="text-[11px] text-gray-600">{order.address || order.city || ''}</div>
                            {getRouteReplacementProducts(order) && (
                              <div className="mt-0.5 text-[11px] text-gray-500">{getRouteReplacementProducts(order)}</div>
                            )}
                            {(() => {
                              // Check if this is a multi-warehouse order
                              const summary = deriveOrderFulfillmentSummary(order)
                              const isMultiWarehouse = summary.totalLegs > 1
                              if (!isMultiWarehouse) return null
                          
                              if (Array.isArray((order as any)?.productAllocations) && (order as any).productAllocations.length > 0) {
                                return (
                                  <div className="mt-0.5 space-y-0.5">
                                    {(order as any).productAllocations.map((line: any, index: number) => (
                                      <div
                                        key={`${String(line?.itemId || index)}-map`}
                                      className={`text-[11px] ${Number(line?.allocatedQtyForSelectedWarehouse || 0) > 0 ? 'text-emerald-700' : 'text-amber-700'}`}
                                    >
                                      {String(line?.productName || 'Product')}
                                        {String(line?.sizeLabel || '').trim() ? ` (${String(line.sizeLabel).trim()})` : ''}: {formatAllocatedQtyLabel(order, Number(line?.allocatedQtyForSelectedWarehouse || 0), Number(line?.totalQty || 0))}
                                      </div>
                                    ))}
                                  </div>
                                )
                              }
                              return (
                                <div className={`mt-0.5 text-[11px] ${Number((order as any)?.allocatedQtyForSelectedWarehouse || 0) > 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                                  Allocated for this warehouse: {formatAllocatedQtyLabel(order, Number((order as any)?.allocatedQtyForSelectedWarehouse || 0), Number((order as any)?.totalOrderQty || 0))}
                                </div>
                              )
                            })()}
                            {order.latitude && order.longitude && (
                              <div className="mt-0.5 text-[11px] text-gray-500">Coordinates: {order.latitude}, {order.longitude}</div>
                            )}
                          </div>
                        </div>
                      ))
                    })()}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <AlertDialog open={confirmCreateOpen} onOpenChange={setConfirmCreateOpen}>
      {/* Fix: keep this nested confirmation and its backdrop above the z-60 route planner. */}
      <AlertDialogContent className="z-[70]" overlayClassName="z-[70]">
        <AlertDialogHeader>
          <AlertDialogTitle>Create this trip?</AlertDialogTitle>
          <AlertDialogDescription>
            {selectedRouteCity
              ? `This will create a trip for ${selectedRouteCity} with ${selectedRouteOrderIds.length} order(s), and assign it to ${selectedRouteDriverName || 'the selected driver'}.`
              : 'This will create the trip and assign it to the selected driver.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setConfirmCreateOpen(false)
              void createTripFromCurrentRoutePlan()
            }}
          >
            Create Trip
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
