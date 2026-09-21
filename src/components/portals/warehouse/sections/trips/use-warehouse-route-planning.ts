import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  getDriverProfileCompletenessIssue as getDriverProfileIssue,
  getDriverVehicleLicenseIssue,
  summarizeDriverAvailability,
} from '@/lib/driver-eligibility'
import { emitDataSync } from '@/lib/data-sync'
import type {
  DriverOption,
  ProductOption,
  RoutePlanCityGroup,
  RoutePlanOrderItem,
  SavedRouteDraft,
  TripEditorState,
  UpcomingDeliveryDay,
  VehicleOption,
  WarehouseItem,
  WarehouseOrderItem,
  WarehouseTripItem,
} from '../../warehouse-portal-types'
import { getCollection, getDefaultRouteDate, getLocalTodayDayKey, isBeforeTodayDayKey } from '../../warehouse-portal-utils'
import { isPortalCacheFresh, readPortalCache, writePortalCache } from '@/lib/portal-data-cache'
import { safeFetchJson } from '../../warehouse-portal-api'
import type { Dispatch, SetStateAction } from 'react'

/**
 * Cases and kilograms one route order puts on the truck. Every load figure in the
 * trip planner goes through this, so the per-order rows in the Selected Orders
 * summary always add up to the Vehicle Load totals.
 */
export const getRouteOrderLoad = (order: any): { totalCases: number; totalWeight: number } => {
  const explicitCases = Number(order?.totalCases)
  const explicitWeight = Number(order?.totalWeight)
  if (Number.isFinite(explicitCases) && Number.isFinite(explicitWeight)) {
    return { totalCases: Math.max(0, explicitCases), totalWeight: Math.max(0, explicitWeight) }
  }
  // Fallback supports saved routes hydrated from ordinary order details.
  return (Array.isArray(order?.items) ? order.items : []).reduce(
    (load: { totalCases: number; totalWeight: number }, item: any) => {
      const quantity = Math.max(0, Number(item?.quantity || 0))
      load.totalCases += quantity
      load.totalWeight += quantity * Math.max(0, Number(item?.product?.weight || 0))
      return load
    },
    { totalCases: 0, totalWeight: 0 },
  )
}

const calculateTripLoad = (loadOrders: any[]) => loadOrders.reduce(
  (summary, order) => {
    const load = getRouteOrderLoad(order)
    summary.totalCases += load.totalCases
    summary.totalWeight += load.totalWeight
    return summary
  },
  { totalCases: 0, totalWeight: 0 },
)

export const UPCOMING_DELIVERY_DAYS = 5

type UpcomingDeliveriesResult = { key: string; days: UpcomingDeliveryDay[]; error: string }

/**
 * Added: the "next 5 days" preview in the Create Trip dialog. Fetches once per
 * open dialog / warehouse, and never while disabled (edit mode keeps its date).
 */
export function useUpcomingDeliveries({ enabled, warehouseId, from, days = UPCOMING_DELIVERY_DAYS }: { enabled: boolean; warehouseId: string; from?: string; days?: number }) {
  const [reloadCount, setReloadCount] = useState(0)
  const [result, setResult] = useState<UpcomingDeliveriesResult | null>(null)
  const [wasEnabled, setWasEnabled] = useState(enabled)
  if (wasEnabled !== enabled) {
    // Every reopen is a fresh request: orders planned since the last open must show.
    setWasEnabled(enabled)
    if (enabled) setReloadCount((count) => count + 1)
  }
  // The daily orders page uses the same eligibility rules for exactly its selected date.
  const fromDate = from || getLocalTodayDayKey()
  const requestKey = enabled && warehouseId ? `${warehouseId}|${fromDate}|${days}|${reloadCount}` : ''

  useEffect(() => {
    if (!requestKey) return
    let cancelled = false
    const query = new URLSearchParams({ warehouseId, from: fromDate, days: String(days) })
    void safeFetchJson(
      `/api/trips/upcoming-deliveries?${query.toString()}`,
      { cache: 'no-store', credentials: 'include' },
      { retries: 0, timeoutMs: 60000 }
    ).then((response) => {
      if (cancelled) return
      if (!response.ok) {
        setResult({ key: requestKey, days: [], error: response.error || 'Could not load upcoming deliveries' })
        return
      }
      setResult({ key: requestKey, days: getCollection<UpcomingDeliveryDay>(response.data, ['days']), error: '' })
    }).catch(() => {
      if (!cancelled) setResult({ key: requestKey, days: [], error: 'Could not load upcoming deliveries' })
    })
    return () => {
      cancelled = true
    }
  }, [requestKey])

  // Loading is derived rather than stored: a result for an older warehouse or
  // an earlier open never shows as current.
  const current = result && result.key === requestKey ? result : null
  return {
    days: current?.days || [],
    error: current?.error || '',
    loading: Boolean(requestKey) && !current,
    reload: () => setReloadCount((count) => count + 1),
  }
}

/**
 * Route planning and trip creation for the warehouse: driver/vehicle eligibility, load calculations, the route-plan editor, and the create/edit/delete trip actions.
 */
export type WarehouseRoutePlanningInputs = {
  assignedWarehouse: WarehouseItem | null
  createTripOpen: boolean
  drivers: DriverOption[]
  driversLoadFailed: boolean
  driversLoading: boolean
  editingTripState: TripEditorState | null
  fetchOrdersData: (options?: { showLoading?: boolean; onlyIfNew?: boolean; silent?: boolean; summaryOnly?: boolean; lightweightDetails?: boolean }) => Promise<unknown>
  fetchSavedRoutesData: () => Promise<void>
  fetchTripsData: (options?: { showLoading?: boolean }) => Promise<WarehouseTripItem[] | null>
  orders: WarehouseOrderItem[]
  products: ProductOption[]
  routeDate: string
  routePlanCachePrefix: string
  routePlans: RoutePlanCityGroup[]
  routeWarehouseId: string
  savedRoutes: SavedRouteDraft[]
  selectedRouteCity: string
  selectedRouteDriverId: string
  selectedRouteOrderIds: string[]
  selectedSavedRouteId: string
  setCreateRouteOpen: Dispatch<SetStateAction<boolean>>
  setCreateTripOpen: Dispatch<SetStateAction<boolean>>
  setCreatingTripFromRoute: Dispatch<SetStateAction<boolean>>
  setDrivers: Dispatch<SetStateAction<DriverOption[]>>
  setDriversLoadFailed: Dispatch<SetStateAction<boolean>>
  setDriversLoading: Dispatch<SetStateAction<boolean>>
  setEditingTripId: Dispatch<SetStateAction<string | null>>
  setEditingTripState: Dispatch<SetStateAction<TripEditorState | null>>
  setLoadingRoutePlans: Dispatch<SetStateAction<boolean>>
  setRouteDate: Dispatch<SetStateAction<string>>
  setRoutePlanMessage: Dispatch<SetStateAction<{ type: 'info' | 'error' | 'success'; text: string } | null>>
  setRoutePlans: Dispatch<SetStateAction<RoutePlanCityGroup[]>>
  setRouteWarehouseId: Dispatch<SetStateAction<string>>
  setSavedRoutes: Dispatch<SetStateAction<SavedRouteDraft[]>>
  setSelectedRouteCity: Dispatch<SetStateAction<string>>
  setSelectedRouteDriverId: Dispatch<SetStateAction<string>>
  setSelectedRouteOrderIds: Dispatch<SetStateAction<string[]>>
  setSelectedSavedRouteId: Dispatch<SetStateAction<string>>
  setSelectedTrip: Dispatch<SetStateAction<WarehouseTripItem | null>>
  setTripToDelete: Dispatch<SetStateAction<WarehouseTripItem | null>>
  setTrips: Dispatch<SetStateAction<WarehouseTripItem[]>>
  tripToDelete: WarehouseTripItem | null
  trips: WarehouseTripItem[]
  vehicles: VehicleOption[]
}

export function useWarehouseRoutePlanning(inputs: WarehouseRoutePlanningInputs) {
  const {
    assignedWarehouse,
    createTripOpen,
    drivers,
    driversLoadFailed,
    driversLoading,
    editingTripState,
    fetchOrdersData,
    fetchSavedRoutesData,
    fetchTripsData,
    orders,
    products,
    routeDate,
    routePlanCachePrefix,
    routePlans,
    routeWarehouseId,
    savedRoutes,
    selectedRouteCity,
    selectedRouteDriverId,
    selectedRouteOrderIds,
    selectedSavedRouteId,
    setCreateRouteOpen,
    setCreateTripOpen,
    setCreatingTripFromRoute,
    setDrivers,
    setDriversLoadFailed,
    setDriversLoading,
    setEditingTripId,
    setEditingTripState,
    setLoadingRoutePlans,
    setRouteDate,
    setRoutePlanMessage,
    setRoutePlans,
    setRouteWarehouseId,
    setSavedRoutes,
    setSelectedRouteCity,
    setSelectedRouteDriverId,
    setSelectedRouteOrderIds,
    setSelectedSavedRouteId,
    setSelectedTrip,
    setTripToDelete,
    setTrips,
    tripToDelete,
    trips,
    vehicles,
  } = inputs

  const savedRoutesGetUnsupportedRef = useRef(false)
  const selectedRouteGroup = useMemo(
    () => routePlans.find((group) => group.city === selectedRouteCity) || null,
    [routePlans, selectedRouteCity]
  )
  const selectedRouteOrders = useMemo(
    () => (selectedRouteGroup?.orders || []).filter((order) => selectedRouteOrderIds.includes(order.id)),
    [selectedRouteGroup, selectedRouteOrderIds]
  )
  const selectedRouteLoad = useMemo(() => calculateTripLoad(selectedRouteOrders), [selectedRouteOrders])
  const selectedSavedRoute = useMemo(
    () => savedRoutes.find((route) => route.id === selectedSavedRouteId) || null,
    [savedRoutes, selectedSavedRouteId]
  )
  const selectedSavedRouteLoad = useMemo(() => {
    if (!selectedSavedRoute) return { totalCases: 0, totalWeight: 0 }
    const routeOrderLookup = new Map(
      routePlans.flatMap((group) => group.orders || []).map((order) => [String(order.id), order]),
    )
    const loadOrders = selectedSavedRoute.orderIds
      .map((orderId) => routeOrderLookup.get(String(orderId)) || orders.find((order) => String(order.id) === String(orderId)))
      .filter(Boolean)
    return calculateTripLoad(loadOrders)
  }, [selectedSavedRoute, routePlans, orders])
  const availableVehicleIdSet = useMemo(
    () => new Set(vehicles.map((vehicle) => String(vehicle?.id || '').trim()).filter(Boolean)),
    [vehicles]
  )
  const getDriverAssignedVehicle = (driver: DriverOption | undefined, options?: { allowVehicleId?: string | null }) => {
    const assigned = (driver?.vehicles || []).find((item) => item?.vehicle?.id)?.vehicle
    if (!assigned?.id) return undefined
    const assignedId = String(assigned.id).trim()
    if (options?.allowVehicleId && assignedId === String(options.allowVehicleId).trim()) {
      return assigned
    }
    return availableVehicleIdSet.has(assignedId) ? assigned : undefined
  }
  const getDriverProfileCompletenessIssue = (driver: DriverOption | undefined) => getDriverProfileIssue(driver)
  const getDriverDisplayName = (driverId: string) => {
    const driver = drivers.find((item) => String(item?.id || '') === String(driverId || ''))
    return driver?.user?.name || driver?.name || driver?.email || 'the assigned driver'
  }

  const getDriverAreaIssue = (driver: DriverOption | undefined): string => {
    const status = String(driver?.status || driver?.driverStatus || 'ACTIVE').replace(/_/g, '').toUpperCase()
    if (status !== 'ACTIVE') return 'Driver is on leave or inactive'
    const areas = new Set((driver?.serviceAreas || []).map((city) => city.trim().replace(/\s+/g, ' ').toLowerCase()))
    if (!areas.size) return 'No service areas assigned'
    // Match every selected destination; the backend repeats this check on save.
    const selectedCities = routePlans.flatMap((group) => group.orders).filter((order) => selectedRouteOrderIds.includes(order.id)).map((order) => order.city)
    const cities = createTripOpen && selectedSavedRoute
      ? selectedSavedRoute.orders.map((order) => order.city)
      : selectedCities.length ? selectedCities : [selectedRouteCity]
    return cities.filter(Boolean).every((city) => areas.has(city.trim().replace(/\s+/g, ' ').toLowerCase()))
      ? '' : 'Outside assigned service areas'
  }
  const isDriverSelectableForTrip = (driver: DriverOption | undefined, options?: { allowDriverId?: string | null; allowVehicleId?: string | null }) => {
    if (!driver || driver?.isActive === false) return false
    if (getDriverAreaIssue(driver)) return false
    if (getDriverProfileCompletenessIssue(driver)) return false
    const eligibleVehicle = options?.allowDriverId && String(driver.id || '').trim() === String(options.allowDriverId).trim()
      ? getDriverAssignedVehicle(driver, { allowVehicleId: options.allowVehicleId })
      : getDriverAssignedVehicle(driver)
    if (!eligibleVehicle?.id) return false
    // Vehicles assigned before the licence rule existed can still be mismatched,
    // so the driver's restriction code is re-checked here too.
    return !getDriverVehicleLicenseIssue(driver, eligibleVehicle)
  }
  const getDriverTripEligibilityLabel = (driver: DriverOption | undefined, options?: { allowDriverId?: string | null; allowVehicleId?: string | null }) => {
    if (driver?.isActive === false) return 'Inactive'
    const areaIssue = getDriverAreaIssue(driver)
    if (areaIssue) return areaIssue
    const profileIssue = getDriverProfileCompletenessIssue(driver)
    if (profileIssue) return profileIssue
    const assignedVehicle = (driver?.vehicles || []).find((item) => item?.vehicle?.id)?.vehicle
    if (!assignedVehicle?.id) return 'No assigned vehicle'
    const licenseIssue = getDriverVehicleLicenseIssue(driver, assignedVehicle)
    if (licenseIssue) return licenseIssue
    if (!isDriverSelectableForTrip(driver, options)) return 'Assigned vehicle unavailable'
    return ''
  }
  // Added: an empty driver dropdown now states why, instead of looking broken.
  const driverAvailability = useMemo(
    () =>
      summarizeDriverAvailability(
        drivers,
        (driver) => getDriverTripEligibilityLabel(driver) || (isDriverSelectableForTrip(driver) ? '' : 'Not available'),
        { loadFailed: driversLoadFailed, loading: driversLoading }
      ),
    [drivers, driversLoadFailed, driversLoading, availableVehicleIdSet]
  )
  const selectedDriverAssignedVehicle = useMemo(() => {
    const driver = drivers.find((d) => d.id === selectedRouteDriverId)
    return getDriverAssignedVehicle(driver, {
      allowVehicleId: editingTripState?.originalVehicleId,
    })
  }, [drivers, selectedRouteDriverId, availableVehicleIdSet, editingTripState, selectedRouteCity, selectedRouteOrderIds, selectedSavedRouteId, createTripOpen, routePlans])
  const selectedVehicleCapacity = Math.max(0, Number(selectedDriverAssignedVehicle?.capacity || 0))
  const isSelectedVehicleCapacityMissing = Boolean(selectedDriverAssignedVehicle?.id) && selectedVehicleCapacity <= 0
  const isSelectedRouteOverloaded = selectedVehicleCapacity > 0 && selectedRouteLoad.totalWeight > selectedVehicleCapacity
  const isSelectedSavedRouteOverloaded = selectedVehicleCapacity > 0 && selectedSavedRouteLoad.totalWeight > selectedVehicleCapacity
  const selectedDriverEligibilityIssue = useMemo(() => {
    const driver = drivers.find((d) => d.id === selectedRouteDriverId)
    return getDriverTripEligibilityLabel(driver, {
      allowDriverId: editingTripState?.originalDriverId,
      allowVehicleId: editingTripState?.originalVehicleId,
    })
  }, [drivers, selectedRouteDriverId, availableVehicleIdSet, editingTripState, selectedRouteCity, selectedRouteOrderIds, selectedSavedRouteId, createTripOpen, routePlans])

  const deleteSavedRouteDraft = async (routeId: string) => {
    const response = await fetch('/api/trips/saved-routes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: routeId }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload?.error || 'Failed to delete saved route')
    }
  }

  const removeSavedRoute = async (routeId: string) => {
    try {
      await deleteSavedRouteDraft(routeId)
      setSavedRoutes((prev) => prev.filter((route) => route.id !== routeId))
      setSelectedSavedRouteId((prev) => (prev === routeId ? '' : prev))
      toast.success('Route deleted')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete route')
    }
  }

  const deleteTrip = async (trip: WarehouseTripItem) => {
    if (String(trip.status || '').toUpperCase() !== 'PLANNED') {
      toast.error('Only planned trips can be deleted')
      return
    }
    setTripToDelete(trip)
  }

  const confirmDeleteTrip = async () => {
    if (!tripToDelete) return
    const trip = tripToDelete

    try {
      const response = await fetch(`/api/trips/${trip.id}`, { method: 'DELETE' })
      const raw = await response.text()
      let data: any = {}
      try {
        data = raw ? JSON.parse(raw) : {}
      } catch {
        data = {}
      }
      if (!response.ok || data?.success === false) {
        const fallbackText = String(raw || '').trim()
        throw new Error(data?.error || fallbackText || 'Failed to delete trip')
      }

      setSelectedTrip((current) => (current?.id === trip.id ? null : current))
      setTrips((prev) => prev.filter((entry) => entry.id !== trip.id))
      if (routeDate && routeWarehouseId) {
        await createRoutePlan(true, routeDate, routeWarehouseId)
      }
      await fetchTripsData()
      await fetchOrdersData()
      await fetchSavedRoutesData()
      emitDataSync(['trips', 'orders'])
      toast.success('Trip deleted')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete trip')
    } finally {
      setTripToDelete(null)
    }
  }

  const unassignOrderItemsFromTrip = async (tripId: string, orderId: string, warehouseId: string, itemIds: string[]) => {
    try {
      const response = await fetch(`/api/trips/${tripId}/unassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, warehouseId, itemIds }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to unassign items')
      }
      await fetchTripsData()
      await fetchOrdersData()
      emitDataSync(['trips', 'orders'])
      toast.success(`Unassigned ${data?.deletedCount || 0} items from trip`)
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to unassign items')
      return false
    }
  }
  const fetchDriversData = async () => {
    setDriversLoading(true)
    try {
      const result = await safeFetchJson('/api/drivers?includeSample=true&pageSize=200')
      if (!result.ok) {
        // A failed load used to leave the dropdown silently empty, which reads
        // identically to "no drivers exist".
        setDriversLoadFailed(true)
        return
      }
      const list = getCollection<DriverOption>(result.data, ['drivers'])
      // The endpoint is paginated; eligible older drivers may be on later pages.
      for (let page = 2; page <= Number(result.data?.totalPages || 1); page += 1) {
        const next = await safeFetchJson(`/api/drivers?includeSample=true&pageSize=200&page=${page}`)
        if (!next.ok) {
          setDriversLoadFailed(true)
          return
        }
        list.push(...getCollection<DriverOption>(next.data, ['drivers']))
      }
      setDriversLoadFailed(false)
      setDrivers(list)
      const preferredDriver = list.find((driver) => isDriverSelectableForTrip(driver))

      if (preferredDriver?.id) {
        // A background refresh must not overwrite a driver selected after polling began.
        setSelectedRouteDriverId((current) => current || preferredDriver.id)
      }
    } catch (error) {
      console.warn('Failed to load drivers:', error)
      setDriversLoadFailed(true)
    } finally {
      setDriversLoading(false)
    }
  }
  useEffect(() => {
    if (!selectedRouteDriverId) return
    const selectedDriver = drivers.find((driver) => String(driver?.id || '') === String(selectedRouteDriverId))
    if (!selectedDriver) return
    const allowDriverId = editingTripState?.originalDriverId || ''
    const allowVehicleId = editingTripState?.originalVehicleId || ''
    if (!isDriverSelectableForTrip(selectedDriver, { allowDriverId, allowVehicleId })) {
      setSelectedRouteDriverId(allowDriverId && drivers.some((driver) => String(driver?.id || '') === String(allowDriverId)) ? allowDriverId : '')
    }
  }, [drivers, selectedRouteDriverId, availableVehicleIdSet, editingTripState])

  useEffect(() => {
    if (selectedRouteDriverId || drivers.length === 0 || editingTripState) return
    const preferredDriver = drivers.find((driver) => isDriverSelectableForTrip(driver))
    if (preferredDriver?.id) {
      setSelectedRouteDriverId(preferredDriver.id)
    }
  }, [drivers, selectedRouteDriverId, availableVehicleIdSet, editingTripState])
  const getEditingTripSnapshot = (tripId?: string | null) => {
    const normalizedTripId = String(tripId || editingTripState?.tripId || '').trim()
    if (!normalizedTripId) return null
    return trips.find((trip) => String(trip?.id || '').trim() === normalizedTripId) || null
  }

  const buildTripEditorOrder = (point: any) => {
    const order = point?.order || {}
    const items = Array.isArray(order?.items) ? order.items : []
    const totalCases = Number(order?.totalCases)
    const totalWeight = Number(order?.totalWeight)
    const productSummary = items
      .map((item: any) => String(item?.product?.name || item?.productName || item?.name || '').trim())
      .filter(Boolean)
      .join(', ')

    return {
      id: String(point?.orderId || order?.id || '').trim(),
      orderNumber: String(point?.orderNumber || order?.orderNumber || '').trim() || 'Order',
      city: String(order?.shippingCity || point?.city || '').trim() || 'Unassigned City',
      customerName: String(order?.shippingName || order?.customer?.name || point?.locationName || '').trim() || 'Customer',
      address: String(order?.shippingAddress || point?.address || '').trim(),
      products: productSummary || undefined,
      latitude: point?.latitude ?? order?.shippingLatitude ?? null,
      longitude: point?.longitude ?? order?.shippingLongitude ?? null,
      sequence: Number(point?.sequence || 0),
      distanceKm: null,
      status: String(point?.orderStatus || order?.status || point?.status || 'PENDING').trim() || 'PENDING',
      currentTripOrder: true,
      // Fix: preserve the backend's warehouse-scoped load for orders already on the trip.
      totalCases: Number.isFinite(totalCases) ? Math.max(0, totalCases) : undefined,
      totalWeight: Number.isFinite(totalWeight) ? Math.max(0, totalWeight) : undefined,
    }
  }

  const mergeRoutePlansWithTripOrders = (
    inputPlans: RoutePlanCityGroup[],
    tripIdOverride?: string | null
  ): RoutePlanCityGroup[] => {
    const editingTrip = getEditingTripSnapshot(tripIdOverride)
    if (!editingTrip) return inputPlans

    const groupedPlans = new Map<string, RoutePlanCityGroup>()
    inputPlans.forEach((group) => {
      groupedPlans.set(group.city, {
        ...group,
        orders: Array.isArray(group.orders) ? [...group.orders] : [],
      })
    })

    ;(Array.isArray(editingTrip?.dropPoints) ? editingTrip.dropPoints : []).forEach((point: any) => {
      const tripOrder = buildTripEditorOrder(point)
      if (!tripOrder.id) return

      const cityKey = String(tripOrder.city || 'Unassigned City').trim() || 'Unassigned City'
      const existingGroup = groupedPlans.get(cityKey) || {
        city: cityKey,
        orderCount: 0,
        totalDistanceKm: 0,
        orders: [],
      }
      const existingOrderIndex = existingGroup.orders.findIndex((order) => String(order?.id || '').trim() === tripOrder.id)
      if (existingOrderIndex >= 0) {
        const existingOrder = existingGroup.orders[existingOrderIndex] as any
        existingGroup.orders[existingOrderIndex] = {
          ...existingOrder,
          ...tripOrder,
          currentTripOrder: true,
          sequence: Number(point?.sequence || tripOrder.sequence || existingOrder?.sequence || 0),
        } as RoutePlanOrderItem
      } else {
        existingGroup.orders = [...existingGroup.orders, tripOrder as RoutePlanOrderItem]
      }

      existingGroup.orders.sort((left: any, right: any) => Number(left?.sequence || 0) - Number(right?.sequence || 0))
      existingGroup.orderCount = existingGroup.orders.length
      groupedPlans.set(cityKey, existingGroup)
    })

    return Array.from(groupedPlans.values()).sort((left, right) => left.city.localeCompare(right.city))
  }

  const createRoutePlan = async (silent = false, inputDate?: string, inputWarehouseId?: string) => {
    const effectiveDate = inputDate ?? routeDate
    const effectiveWarehouseId = inputWarehouseId ?? routeWarehouseId
    const preservedTripOrderIds = editingTripState
      ? Array.from(new Set(
          (selectedRouteOrderIds.length > 0 ? selectedRouteOrderIds : editingTripState.originalOrderIds).filter(Boolean)
        ))
      : []
    if (!effectiveDate || !effectiveWarehouseId) {
      if (!silent) toast.error('Select route date and warehouse')
      setRoutePlanMessage({ type: 'error', text: 'Select route date and warehouse first.' })
      return null
    }
    if (isBeforeTodayDayKey(effectiveDate)) {
      const message = 'Delivery date cannot be before today'
      if (!silent) toast.error(message)
      setRoutePlanMessage({ type: 'error', text: message })
      return null
    }
    setLoadingRoutePlans(true)
    setRoutePlanMessage(null)
    setSelectedRouteCity('')
    setSelectedRouteOrderIds(editingTripState ? preservedTripOrderIds : [])
    const routePlanCacheKey = `${routePlanCachePrefix}${encodeURIComponent(effectiveWarehouseId)}:${effectiveDate}`
    const cachedRoutePlan = readPortalCache<RoutePlanCityGroup[]>(routePlanCacheKey)
    if (!cachedRoutePlan) setRoutePlans([])

    const applyRoutePlanResult = (rawPlans: RoutePlanCityGroup[], notify: boolean) => {
      const eligiblePlans = rawPlans
        .map((group: any) => ({
          ...group,
          orders: (Array.isArray(group?.orders) ? group.orders : []).filter(
            (order: any) =>
              Number(order?.allocatedQtyForSelectedWarehouse || 0) > 0 ||
              Boolean((order as any)?.isScheduledReplacement) ||
              String(order?.orderNumber || '').trim().toUpperCase().startsWith('RPL-')
          ),
        }))
        .filter((group: any) => (Array.isArray(group?.orders) ? group.orders.length : 0) > 0)
      // Added: stamp the filtered day on each order for the Selected Orders summary.
      const plans = mergeRoutePlansWithTripOrders(eligiblePlans).map((group) => ({
        ...group,
        orders: group.orders.map((order) => (order.deliveryDate ? order : { ...order, deliveryDate: effectiveDate })),
      }))
      setRoutePlans(plans)
      setSelectedRouteCity((current) => {
        if (current && plans.some((group) => group.city === current)) return current
        const matchingGroup = plans.find((group) =>
          group.orders.some((order: any) => preservedTripOrderIds.includes(String(order?.id || '').trim()))
        )
        return matchingGroup?.city || plans[0]?.city || ''
      })
      setSelectedRouteOrderIds(editingTripState ? preservedTripOrderIds : [])
      if (eligiblePlans.length === 0 && !editingTripState) {
        setRoutePlanMessage({
          type: 'info',
          text: 'No eligible orders found for that delivery date.',
        })
      } else {
        const baseMessage =
          eligiblePlans.length === 0 && editingTripState
            ? 'Loaded the current trip contents. No additional eligible orders were found for this delivery date.'
            : `Found ${plans.length} city group(s) for this delivery date.`
        setRoutePlanMessage({ type: 'success', text: baseMessage })
        if (!silent && notify) toast.success('Filtered scheduled orders by city')
      }
      return plans
    }

    let cachedPlans: RoutePlanCityGroup[] | null = null
    if (cachedRoutePlan) {
      // Show the previously filtered date/warehouse result immediately.
      cachedPlans = applyRoutePlanResult(cachedRoutePlan.data, isPortalCacheFresh(cachedRoutePlan))
      if (isPortalCacheFresh(cachedRoutePlan)) {
        setLoadingRoutePlans(false)
        return cachedPlans
      }
    }

    try {
      const query = new URLSearchParams({
        date: effectiveDate,
        warehouseId: effectiveWarehouseId,
      })
      // Production databases can need more than 20 seconds during a cold start; use the shared authenticated timeout handling.
      const result = await safeFetchJson(
        `/api/trips/route-plan?${query.toString()}`,
        { cache: 'no-store', credentials: 'include' },
        { retries: 0, timeoutMs: 60000 }
      )
      const data = result.data || {}
      if (!result.ok) {
        throw new Error(result.status === 0 ? 'Request timed out. Please try again.' : data?.error || 'Failed to generate route plan')
      }

      const rawPlans = getCollection<RoutePlanCityGroup>(data, ['routePlans'])
      // Cache the unmerged API result so edit mode can safely add its current trip orders later.
      writePortalCache(routePlanCacheKey, rawPlans, effectiveWarehouseId)
      const plans = applyRoutePlanResult(rawPlans, true)
      return plans
    } catch (error: any) {
      const message = error?.message || 'Failed to generate route plan'
      if (!silent) toast.error(message)
      if (cachedPlans) {
        setRoutePlanMessage({ type: 'info', text: 'Showing cached orders because the latest refresh failed.' })
        return cachedPlans
      }
      setRoutePlanMessage({ type: 'error', text: message })
      setRoutePlans([])
      setSelectedRouteCity('')
      setSelectedRouteOrderIds(editingTripState ? preservedTripOrderIds : [])
      return null
    } finally {
      setLoadingRoutePlans(false)
    }
  }

  const handleRouteOrderClick = (city: string, orderId: string) => {
    setSelectedRouteCity(city)
    setSelectedRouteOrderIds((prev) => {
      const belongsToCity = routePlans.find((group) => group.city === city)?.orders?.some((order) => order.id === orderId)
      if (!belongsToCity) return [orderId]
      if (prev.includes(orderId)) {
        const next = prev.filter((id) => id !== orderId)
        if (editingTripState && prev.length === 1) {
          toast.error('A trip must keep at least one drop point')
          return prev
        }
        return next.length > 0 ? next : [orderId]
      }
      return [...prev, orderId]
    })
  }

  const editTripDropPoints = async (
    trip: WarehouseTripItem,
    changes: { addOrderIds?: string[]; removeDropPointIds?: string[]; assignWarehouseLegs?: boolean; assignWarehouseId?: string; driverId?: string; vehicleId?: string }
  ) => {
    const addOrderIds = (changes.addOrderIds || []).filter(Boolean)
    const removeDropPointIds = (changes.removeDropPointIds || []).filter(Boolean)
    const assignWarehouseLegs = Boolean(changes.assignWarehouseLegs)
    const assignWarehouseId = String(changes.assignWarehouseId || '').trim()
    const driverId = String(changes.driverId || '').trim()
    const vehicleId = String(changes.vehicleId || '').trim()
    if (addOrderIds.length === 0 && removeDropPointIds.length === 0 && !assignWarehouseLegs && !driverId && !vehicleId) return false
    if (String(trip.status || '').toUpperCase() !== 'PLANNED') {
      toast.error('Only planned trips can be edited')
      return false
    }

    setEditingTripId(trip.id)
    try {
      // Only send assignment fields for an intentional driver change; empty keys trigger backend validation.
      const payload: Record<string, unknown> = {
        addOrderIds,
        removeDropPointIds,
        assignWarehouseLegs,
        assignWarehouseId,
      }
      if (driverId && vehicleId) {
        payload.driverId = driverId
        payload.vehicleId = vehicleId
      }
      // A mutation must not retry, but it still needs a deadline so network loss
      // cannot leave the editor permanently locked in its saving state.
      const result = await safeFetchJson(
        `/api/trips/${trip.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        { retries: 0, timeoutMs: 60000 }
      )
      const data = result.data || {}
      if (!result.ok || data?.success === false) {
        throw new Error(result.error || data?.error || 'Failed to update trip')
      }
      const updatedTrip = data?.trip
      if (updatedTrip?.id) {
        setTrips((prev) => prev.map((entry) => (entry.id === updatedTrip.id ? updatedTrip : entry)))
        setSelectedTrip((current) => (current?.id === updatedTrip.id ? updatedTrip : current))
      }
      // Fix: the PATCH response already updates the visible trip; refresh related lists in
      // the background so a slow orders query cannot leave the Save button spinning.
      emitDataSync(['trips', 'orders'])
      toast.success('Trip updated')
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update trip')
      return false
    } finally {
      setEditingTripId(null)
    }
  }

  const parseApiErrorMessage = (response: Response, payload: any, fallback: string) => {
    const fromPayload =
      String(payload?.error || '').trim() ||
      String(payload?.message || '').trim() ||
      String(payload?.detail || '').trim()
    if (fromPayload) return fromPayload
    return `${fallback} (HTTP ${response.status})`
  }

  const createTripFromRoute = async () => {
    if (!selectedSavedRoute || !selectedRouteDriverId) {
      toast.error('Select a saved route and driver first')
      return
    }
    if (selectedDriverEligibilityIssue) {
      toast.error(`Selected driver cannot be assigned: ${selectedDriverEligibilityIssue}`)
      return
    }
    if (selectedSavedRoute.orderIds.length === 0) {
      toast.error('Selected saved route has no orders')
      return
    }
    if (!selectedDriverAssignedVehicle?.id) {
      toast.error('Selected driver has no assigned vehicle')
      return
    }
    if (isSelectedSavedRouteOverloaded) {
      const exceededBy = selectedSavedRouteLoad.totalWeight - selectedVehicleCapacity
      toast.error(`Vehicle overloaded by ${exceededBy.toFixed(2)} kg`)
      return
    }
    if (isSelectedVehicleCapacityMissing) {
      toast.error('Vehicle maximum weight capacity is not configured')
      return
    }
    if (isBeforeTodayDayKey(selectedSavedRoute.date)) {
      toast.error('Delivery date cannot be before today')
      return
    }
    setCreatingTripFromRoute(true)
    try {
      const response = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Stable across the shared fetch retry loop so replay returns this trip.
          requestId: crypto.randomUUID(),
          plannedStartAt: selectedSavedRoute.date,
          status: 'PLANNED',
          warehouseId: selectedSavedRoute.warehouseId,
          driverId: selectedRouteDriverId,
          vehicleId: selectedDriverAssignedVehicle.id,
          orderIds: selectedSavedRoute.orderIds,
        }),
      })
      const raw = await response.text()
      const data = (() => {
        try {
          return raw ? JSON.parse(raw) : {}
        } catch {
          return {}
        }
      })()
      if (!response.ok || data?.success === false) {
        throw new Error(parseApiErrorMessage(response, data, 'Failed to create trip'))
      }
      const createdTrip = data?.trip
      const createdTripNumber = createdTrip?.tripNumber || createdTrip?.id
      const assignedDriverName = getDriverDisplayName(selectedRouteDriverId)
      toast.success(
        createdTripNumber
          ? `Trip ${createdTripNumber} created and assigned to ${assignedDriverName}`
          : 'Trip created from route'
      )
      if (createdTrip) {
        setTrips((prev) => [createdTrip, ...prev.filter((trip) => trip.id !== createdTrip.id)])
      }
      setSavedRoutes((prev) => prev.filter((route) => route.id !== selectedSavedRoute.id))
      setSelectedSavedRouteId('')
      setCreateTripOpen(false)
      emitDataSync(['trips', 'orders'])
      void (async () => {
        try {
          await deleteSavedRouteDraft(selectedSavedRoute.id)
        } catch (deleteError) {
          console.error('Failed to delete saved route:', deleteError)
        }
        await Promise.all([
          fetchTripsData({ showLoading: false }),
          fetchOrdersData({ showLoading: false, silent: true }),
        ])
      })()
    } catch (error: any) {
      const message = String(error?.message || 'Failed to create trip')
      const lowerMessage = message.toLowerCase()

      if (lowerMessage.includes('no eligible orders') || lowerMessage.includes('already assigned')) {
        try {
          await deleteSavedRouteDraft(selectedSavedRoute.id)
        } catch (deleteError) {
          console.error('Failed to delete stale saved route:', deleteError)
        }
        setSavedRoutes((prev) => prev.filter((route) => route.id !== selectedSavedRoute.id))
        setSelectedSavedRouteId('')
        setCreateTripOpen(false)
        emitDataSync(['trips', 'orders'])
        void Promise.all([
          fetchTripsData({ showLoading: false }),
          fetchOrdersData({ showLoading: false, silent: true }),
        ])
        toast.success('Trip data refreshed. Stale saved route was removed.')
      } else {
        toast.error(message)
      }
    } finally {
      setCreatingTripFromRoute(false)
    }
  }

  const createTripFromCurrentRoutePlan = async () => {
    if (!routeDate || !routeWarehouseId || !selectedRouteCity || selectedRouteOrderIds.length === 0) {
      toast.error('Select date, warehouse, city and at least one order')
      return
    }
    if (!selectedRouteDriverId) {
      toast.error('Select a driver')
      return
    }
    if (selectedDriverEligibilityIssue) {
      toast.error(`Selected driver cannot be assigned: ${selectedDriverEligibilityIssue}`)
      return
    }
    if (!selectedDriverAssignedVehicle?.id) {
      toast.error('Selected driver has no assigned vehicle')
      return
    }
    if (isSelectedRouteOverloaded) {
      const exceededBy = selectedRouteLoad.totalWeight - selectedVehicleCapacity
      toast.error(`Vehicle overloaded by ${exceededBy.toFixed(2)} kg`)
      return
    }
    if (isSelectedVehicleCapacityMissing) {
      toast.error('Vehicle maximum weight capacity is not configured')
      return
    }
    if (isBeforeTodayDayKey(routeDate)) {
      toast.error('Delivery date cannot be before today')
      return
    }

    const group = routePlans.find((g) => g.city === selectedRouteCity)
    const selectedOrders = (group?.orders || []).filter((order) => selectedRouteOrderIds.includes(order.id))
    if (!group || selectedOrders.length === 0) {
      toast.error('No orders selected for this route')
      return
    }

    setCreatingTripFromRoute(true)
    try {
      const response = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Stable across the shared fetch retry loop so replay returns this trip.
          requestId: crypto.randomUUID(),
          plannedStartAt: routeDate,
          status: 'PLANNED',
          warehouseId: routeWarehouseId,
          driverId: selectedRouteDriverId,
          vehicleId: selectedDriverAssignedVehicle.id,
          orderIds: selectedRouteOrderIds,
        }),
      })
      const raw = await response.text()
      const data = (() => {
        try {
          return raw ? JSON.parse(raw) : {}
        } catch {
          return {}
        }
      })()
      if (!response.ok || data?.success === false) {
        throw new Error(parseApiErrorMessage(response, data, 'Failed to create trip'))
      }

      const createdTrip = data?.trip
      if (createdTrip) {
        setTrips((prev) => [createdTrip, ...prev.filter((trip) => trip.id !== createdTrip.id)])
      }

      setCreateRouteOpen(false)
      setSelectedRouteCity('')
      setSelectedRouteOrderIds([])
      setRoutePlans([])
      emitDataSync(['trips', 'orders'])
      void Promise.all([
        fetchTripsData({ showLoading: false }),
        fetchOrdersData({ showLoading: false, silent: true }),
      ])
      const createdTripNumber = createdTrip?.tripNumber || createdTrip?.id
      const assignedDriverName = getDriverDisplayName(selectedRouteDriverId)
      toast.success(
        createdTripNumber
          ? `Trip ${createdTripNumber} created and assigned to ${assignedDriverName}`
          : 'Trip created and assigned successfully'
      )
    } catch (error: any) {
      toast.error(error?.message || 'Failed to create trip')
    } finally {
      setCreatingTripFromRoute(false)
    }
  }

  const saveTripEditsFromCurrentRoutePlan = async () => {
    if (!editingTripState) return

    const editingTrip = getEditingTripSnapshot(editingTripState.tripId)
    if (!editingTrip) {
      toast.error('Trip not found')
      return
    }
    if (String(editingTrip.status || '').toUpperCase() !== 'PLANNED') {
      toast.error('Only planned trips can be edited')
      return
    }

    const desiredOrderIds = Array.from(
      new Set(selectedRouteOrderIds.map((orderId) => String(orderId || '').trim()).filter(Boolean))
    )
    const effectiveSelectedDriverId = String(selectedRouteDriverId || editingTripState.originalDriverId || '').trim()
    const originalOrderIdSet = new Set(
      editingTripState.originalOrderIds.map((orderId) => String(orderId || '').trim()).filter(Boolean)
    )
    const desiredOrderIdSet = new Set(desiredOrderIds)
    const addOrderIds = desiredOrderIds.filter((orderId) => !originalOrderIdSet.has(orderId))
    const removeDropPointIds = (Array.isArray(editingTrip.dropPoints) ? editingTrip.dropPoints : [])
      .filter((point: any) => {
        const orderId = String(point?.orderId || point?.order?.id || '').trim()
        return orderId && !desiredOrderIdSet.has(orderId)
      })
      .map((point: any) => String(point?.id || '').trim())
      .filter(Boolean)
    const driverChanged = Boolean(
      effectiveSelectedDriverId &&
      effectiveSelectedDriverId !== String(editingTripState.originalDriverId || '').trim()
    )

    if (!effectiveSelectedDriverId) {
      toast.error('Select a driver')
      return
    }
    if (selectedDriverEligibilityIssue && driverChanged) {
      toast.error(`Selected driver cannot be assigned: ${selectedDriverEligibilityIssue}`)
      return
    }
    if (driverChanged && !selectedDriverAssignedVehicle?.id) {
      toast.error('Selected driver has no assigned vehicle')
      return
    }

    if (addOrderIds.length === 0 && removeDropPointIds.length === 0 && !driverChanged) {
      setCreateRouteOpen(false)
      setEditingTripState(null)
      toast.success('Trip already matches the selected settings')
      return
    }

    const updated = await editTripDropPoints(editingTrip, {
      addOrderIds,
      removeDropPointIds,
      driverId: driverChanged ? effectiveSelectedDriverId : undefined,
      vehicleId: driverChanged ? String(selectedDriverAssignedVehicle?.id || '').trim() : undefined,
    })
    if (!updated) return
    setCreateRouteOpen(false)
    setEditingTripState(null)
  }
  const openTripEditorInCreateDialog = async (trip: WarehouseTripItem) => {
    const tripStatus = String(trip?.status || '').toUpperCase()
    if (tripStatus !== 'PLANNED') {
      toast.error('Only planned trips can be edited')
      return
    }
    const dateValue = String(trip?.tripSchedule || routeDate || getDefaultRouteDate()).slice(0, 10)
    const warehouseValue = String(trip?.warehouseId || routeWarehouseId || assignedWarehouse?.id || '').trim()
    if (!dateValue || !warehouseValue) {
      toast.error('Trip is missing schedule date or warehouse')
      return
    }
    const tripOrderIds = Array.from(
      new Set(
        (Array.isArray(trip?.dropPoints) ? trip.dropPoints : [])
          .map((point: any) => String(point?.orderId || point?.order?.id || '').trim())
          .filter(Boolean)
      )
    )

    setEditingTripState({
      tripId: trip.id,
      tripNumber: trip.tripNumber,
      originalOrderIds: tripOrderIds,
      originalDriverId: String(trip?.driver?.id || '').trim(),
      originalVehicleId: String(trip?.vehicle?.id || '').trim(),
      driverName: String(trip?.driver?.user?.name || trip?.driver?.name || 'Unassigned').trim() || 'Unassigned',
      vehiclePlate: String(trip?.vehicle?.licensePlate || 'No assigned vehicle').trim() || 'No assigned vehicle',
    })
    setSelectedRouteDriverId(String(trip?.driver?.id || '').trim())
    setSelectedRouteOrderIds(tripOrderIds)
    setCreateRouteOpen(true)
    setRouteDate(dateValue)
    setRouteWarehouseId(warehouseValue)
    const plans = await createRoutePlan(true, dateValue, warehouseValue)
    const planGroups = mergeRoutePlansWithTripOrders(Array.isArray(plans) ? plans : [], trip.id)
    setRoutePlans(planGroups)
    if (planGroups.length === 0) return

    let bestCity = String(planGroups[0]?.city || '')
    let bestMatchCount = 0
    for (const group of planGroups) {
      const groupOrderIds = (Array.isArray(group?.orders) ? group.orders : [])
        .map((order: any) => String(order?.id || '').trim())
        .filter(Boolean)
      const matched = groupOrderIds.filter((id: string) => tripOrderIds.includes(id))
      if (matched.length > bestMatchCount) {
        bestCity = String(group?.city || bestCity)
        bestMatchCount = matched.length
      }
    }

    setSelectedRouteCity(bestCity)
    setSelectedRouteOrderIds(tripOrderIds)
  }

  return {
    confirmDeleteTrip,
    createRoutePlan,
    createTripFromCurrentRoutePlan,
    createTripFromRoute,
    deleteTrip,
    driverAvailability,
    editTripDropPoints,
    fetchDriversData,
    getDriverTripEligibilityLabel,
    handleRouteOrderClick,
    isDriverSelectableForTrip,
    isSelectedRouteOverloaded,
    isSelectedSavedRouteOverloaded,
    isSelectedVehicleCapacityMissing,
    openTripEditorInCreateDialog,
    saveTripEditsFromCurrentRoutePlan,
    selectedDriverAssignedVehicle,
    selectedDriverEligibilityIssue,
    selectedRouteLoad,
    selectedSavedRoute,
    selectedSavedRouteLoad,
    selectedVehicleCapacity,
    unassignOrderItemsFromTrip,
  }
}

/** Everything the hook manages, for the dialogs that render it. */
export type WarehouseRoutePlanning = ReturnType<typeof useWarehouseRoutePlanning>
