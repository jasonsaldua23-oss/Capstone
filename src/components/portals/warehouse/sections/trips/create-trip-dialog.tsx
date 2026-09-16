'use client'

import { type Dispatch, type SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { DriverOption, SavedRouteDraft, WarehouseOrderItem } from '../../warehouse-portal-types'
import { Warehouse, Loader2, Route } from 'lucide-react'
import { TripLoadSummary } from '@/components/shared/trip-load-summary'
import type { WarehouseRoutePlanning } from './use-warehouse-route-planning'

/**
 * Creates a trip from a saved route draft: driver, vehicle and load checks.
 */
export type WarehouseCreateTripDialogProps = {
  createTripFromRoute: WarehouseRoutePlanning['createTripFromRoute']
  createTripOpen: boolean
  creatingTripFromRoute: boolean
  driverAvailability: WarehouseRoutePlanning['driverAvailability']
  drivers: DriverOption[]
  getDriverTripEligibilityLabel: WarehouseRoutePlanning['getDriverTripEligibilityLabel']
  isDriverSelectableForTrip: WarehouseRoutePlanning['isDriverSelectableForTrip']
  isSelectedSavedRouteOverloaded: WarehouseRoutePlanning['isSelectedSavedRouteOverloaded']
  isSelectedVehicleCapacityMissing: WarehouseRoutePlanning['isSelectedVehicleCapacityMissing']
  orders: WarehouseOrderItem[]
  savedRoutes: SavedRouteDraft[]
  selectedDriverAssignedVehicle: WarehouseRoutePlanning['selectedDriverAssignedVehicle']
  selectedDriverEligibilityIssue: WarehouseRoutePlanning['selectedDriverEligibilityIssue']
  selectedRouteDriverId: string
  selectedSavedRoute: WarehouseRoutePlanning['selectedSavedRoute']
  selectedSavedRouteId: string
  selectedSavedRouteLoad: WarehouseRoutePlanning['selectedSavedRouteLoad']
  selectedVehicleCapacity: WarehouseRoutePlanning['selectedVehicleCapacity']
  setCreateTripOpen: Dispatch<SetStateAction<boolean>>
  setSelectedRouteDriverId: Dispatch<SetStateAction<string>>
  setSelectedSavedRouteId: Dispatch<SetStateAction<string>>
}

export function WarehouseCreateTripDialog({
  createTripFromRoute,
  createTripOpen,
  creatingTripFromRoute,
  driverAvailability,
  drivers,
  getDriverTripEligibilityLabel,
  isDriverSelectableForTrip,
  isSelectedSavedRouteOverloaded,
  isSelectedVehicleCapacityMissing,
  orders,
  savedRoutes,
  selectedDriverAssignedVehicle,
  selectedDriverEligibilityIssue,
  selectedRouteDriverId,
  selectedSavedRoute,
  selectedSavedRouteId,
  selectedSavedRouteLoad,
  selectedVehicleCapacity,
  setCreateTripOpen,
  setSelectedRouteDriverId,
  setSelectedSavedRouteId,
}: WarehouseCreateTripDialogProps) {
  return (
    <Dialog open={createTripOpen} onOpenChange={setCreateTripOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Trip</DialogTitle>
          <DialogDescription>Select a saved route and assign an available driver.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Saved Route</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              title="Select Saved Route"
              value={selectedSavedRouteId}
              onChange={(e) => setSelectedSavedRouteId(e.target.value)}
            >
              <option value="">Select route</option>
              {savedRoutes.map((route) => (
                <option key={route.id} value={route.id}>
                  {route.city} | {new Date(route.date).toLocaleDateString()} | {route.orderIds.length} orders
                </option>
              ))}
            </select>
          </div>
          {selectedSavedRoute ? (
            <div className="rounded-md border bg-gray-50 p-3 text-sm">
              <p className="font-medium text-gray-900">{selectedSavedRoute.city}</p>
              <p className="text-gray-600">Warehouse: {selectedSavedRoute.warehouseName}</p>
              <p className="text-gray-600">Date: {new Date(selectedSavedRoute.date).toLocaleDateString()}</p>
              <p className="text-gray-600">Orders: {selectedSavedRoute.orderIds.length}</p>
            </div>
          ) : null}
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Assign Driver</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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
              <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                {driverAvailability.message}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Assigned Vehicle</label>
            <Input
              readOnly
              value={selectedDriverAssignedVehicle?.licensePlate || 'No assigned vehicle'}
            />
            {selectedRouteDriverId && selectedDriverEligibilityIssue ? (
              <p className="text-xs text-amber-600">Selected driver cannot be assigned: {selectedDriverEligibilityIssue}.</p>
            ) : null}
          </div>
          <TripLoadSummary
            totalCases={selectedSavedRouteLoad.totalCases}
            totalWeight={selectedSavedRouteLoad.totalWeight}
            maximumCapacity={selectedVehicleCapacity}
          />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setCreateTripOpen(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1 bg-blue-600 text-white hover:bg-blue-700"
              onClick={createTripFromRoute}
              disabled={creatingTripFromRoute || !selectedSavedRouteId || !selectedRouteDriverId || Boolean(selectedDriverEligibilityIssue) || !selectedDriverAssignedVehicle?.id || isSelectedVehicleCapacityMissing || isSelectedSavedRouteOverloaded}
            >
              {creatingTripFromRoute ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
              Create Trip
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
