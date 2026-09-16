import type {
  DriverLocationItem,
  InventoryItem,
  InventoryTransactionItem,
  ProductOption,
  SavedRouteDraft,
  StockBatchItem,
  VehicleOption,
  WarehouseItem,
  WarehouseOrderItem,
  WarehouseReplacementItem,
  WarehouseTripItem,
} from './warehouse-portal-types'
import { getCollection } from './warehouse-portal-utils'
import { writePortalCache } from '@/lib/portal-data-cache'
import { getMaxOrderUpdatedAt, mergeWarehouseOrders } from './warehouse-order-helpers'
import { safeFetchJson } from './warehouse-portal-api'
import type { Dispatch, SetStateAction, MutableRefObject } from 'react'

/**
 * Loading and refreshing the warehouse portal's collections: inventory, batches, products, orders (with delta merging and snapshot cache), trips, transactions, replacements, vehicles and saved routes.
 */
export type WarehousePortalDataInputs = {
  assignedWarehouseIdRef: MutableRefObject<string>
  inventory: InventoryItem[]
  inventoryStockCacheAtRef: MutableRefObject<number>
  inventoryStockCacheKey: string
  inventoryStockRefreshRef: MutableRefObject<Promise<void> | null>
  latestOrderUpdatedAtRef: MutableRefObject<string>
  orderDetailsLoadedRef: MutableRefObject<boolean>
  orders: WarehouseOrderItem[]
  ordersCacheAtRef: MutableRefObject<number>
  ordersCacheKey: string
  routeWarehouseId: string
  selectedRouteVehicleId: string
  setDriverLocations: Dispatch<SetStateAction<DriverLocationItem[]>>
  setInventory: Dispatch<SetStateAction<InventoryItem[]>>
  setInventoryTransactions: Dispatch<SetStateAction<InventoryTransactionItem[]>>
  setLoadingBatches: Dispatch<SetStateAction<boolean>>
  setLoadingInventory: Dispatch<SetStateAction<boolean>>
  setLoadingInventoryTransactions: Dispatch<SetStateAction<boolean>>
  setLoadingOrders: Dispatch<SetStateAction<boolean>>
  setLoadingReplacements: Dispatch<SetStateAction<boolean>>
  setLoadingTrips: Dispatch<SetStateAction<boolean>>
  setLoadingWarehouses: Dispatch<SetStateAction<boolean>>
  setOrders: Dispatch<SetStateAction<WarehouseOrderItem[]>>
  setProducts: Dispatch<SetStateAction<ProductOption[]>>
  setReplacements: Dispatch<SetStateAction<WarehouseReplacementItem[]>>
  setRouteWarehouseId: Dispatch<SetStateAction<string>>
  setSavedRoutes: Dispatch<SetStateAction<SavedRouteDraft[]>>
  setSelectedOrder: Dispatch<SetStateAction<WarehouseOrderItem | null>>
  setSelectedRouteVehicleId: Dispatch<SetStateAction<string>>
  setStockBatches: Dispatch<SetStateAction<StockBatchItem[]>>
  setStockInWarehouseId: Dispatch<SetStateAction<string>>
  setTrips: Dispatch<SetStateAction<WarehouseTripItem[]>>
  setVehicles: Dispatch<SetStateAction<VehicleOption[]>>
  setWarehouseLoadError: Dispatch<SetStateAction<string | null>>
  setWarehouses: Dispatch<SetStateAction<WarehouseItem[]>>
  stockBatches: StockBatchItem[]
  stockInWarehouseId: string
  tripsCacheAtRef: MutableRefObject<number>
  tripsCacheKey: string
  tripsRefreshRef: MutableRefObject<Promise<WarehouseTripItem[] | null> | null>
}

export function useWarehousePortalData(inputs: WarehousePortalDataInputs) {
  const {
    assignedWarehouseIdRef,
    inventory,
    inventoryStockCacheAtRef,
    inventoryStockCacheKey,
    inventoryStockRefreshRef,
    latestOrderUpdatedAtRef,
    orderDetailsLoadedRef,
    orders,
    ordersCacheAtRef,
    ordersCacheKey,
    routeWarehouseId,
    selectedRouteVehicleId,
    setDriverLocations,
    setInventory,
    setInventoryTransactions,
    setLoadingBatches,
    setLoadingInventory,
    setLoadingInventoryTransactions,
    setLoadingOrders,
    setLoadingReplacements,
    setLoadingTrips,
    setLoadingWarehouses,
    setOrders,
    setProducts,
    setReplacements,
    setRouteWarehouseId,
    setSavedRoutes,
    setSelectedOrder,
    setSelectedRouteVehicleId,
    setStockBatches,
    setStockInWarehouseId,
    setTrips,
    setVehicles,
    setWarehouseLoadError,
    setWarehouses,
    stockBatches,
    stockInWarehouseId,
    tripsCacheAtRef,
    tripsCacheKey,
    tripsRefreshRef,
  } = inputs

  const fetchInventoryData = async (warehouseId?: string, options?: { showLoading?: boolean }): Promise<InventoryItem[] | null> => {
    const showLoading = options?.showLoading !== false
    if (showLoading) setLoadingInventory(true)
    try {
      const normalizedWarehouseId = String(warehouseId || '').trim()
      const query = new URLSearchParams({ pageSize: '1000' })
      if (normalizedWarehouseId) {
        query.set('warehouseId', normalizedWarehouseId)
      }
      const inventoryUrl = `/api/inventory?${query.toString()}`
      const result = await safeFetchJson(inventoryUrl, { cache: 'no-store' })
      if (!result.ok) {
        return null
      }
      const list = getCollection<InventoryItem>(result.data, ['inventory'])
      setInventory(list)
      return list
    } catch (error) {
      console.warn('Failed to load inventory:', error)
      return null
    } finally {
      if (showLoading) setLoadingInventory(false)
    }
  }

  const fetchWarehousesData = async (): Promise<WarehouseItem[]> => {
    setLoadingWarehouses(true)
    try {
      const result = await safeFetchJson('/api/warehouses', { cache: 'no-store' })
      if (!result.ok) {
        setWarehouseLoadError(result.error || 'Failed to fetch warehouses')
        return []
      }
      if ((result.data as any)?.dbUnavailable) {
        setWarehouseLoadError('Warehouse data is temporarily unavailable')
        return []
      }
      const list = getCollection<WarehouseItem>(result.data, ['warehouses'])
      setWarehouseLoadError(null)
      setWarehouses(list)
      const firstWarehouse = list[0]
      assignedWarehouseIdRef.current = String(firstWarehouse?.id || '')
      if (firstWarehouse?.id && !stockInWarehouseId) {
        setStockInWarehouseId(firstWarehouse.id)
      }
      if (firstWarehouse?.id && !routeWarehouseId) {
        setRouteWarehouseId(firstWarehouse.id)
      }
      return list
    } catch (error) {
      setWarehouseLoadError('Failed to fetch warehouses')
      console.warn('Failed to load warehouses:', error)
      return []
    } finally {
      setLoadingWarehouses(false)
    }
  }

  const fetchProductsData = async () => {
    try {
      const result = await safeFetchJson('/api/products?page=1&pageSize=1000', { cache: 'no-store' })
      if (!result.ok) {
        return
      }
      const list = getCollection<ProductOption>(result.data, ['products']).filter((product) => product?.isActive !== false)
      const activeProductIds = new Set(list.map((product) => String(product?.id || '').trim()).filter(Boolean))
      setProducts(list)
      // Remove products that were deleted by Admin from any cached warehouse snapshot.
      setInventory((current) => current.filter((item) => {
        const productId = String(item?.product?.id || '').trim()
        return !productId || activeProductIds.has(productId)
      }))
      setStockBatches((current) => current.filter((batch) => {
        const productId = String(batch?.inventory?.product?.id || '').trim()
        return !productId || activeProductIds.has(productId)
      }))
    } catch (error) {
      console.warn('Failed to load products:', error)
    }
  }

  const fetchStockBatchesData = async (options?: { showLoading?: boolean }): Promise<StockBatchItem[] | null> => {
    const showLoading = options?.showLoading !== false
    if (showLoading) setLoadingBatches(true)
    try {
      const result = await safeFetchJson('/api/stock-batches?page=1&pageSize=200', { cache: 'no-store' })
      if (!result.ok) {
        return null
      }
      const list = getCollection<StockBatchItem>(result.data, ['stockBatches'])
      setStockBatches(list)
      return list
    } catch (error) {
      console.warn('Failed to load stock-in batches:', error)
      return null
    } finally {
      if (showLoading) setLoadingBatches(false)
    }
  }

  const refreshInventoryAndStockData = async (warehouseId?: string, options?: { showLoading?: boolean }) => {
    if (inventoryStockRefreshRef.current) return inventoryStockRefreshRef.current
    const normalizedWarehouseId = String(warehouseId || assignedWarehouseIdRef.current || '').trim()
    const refresh = (async () => {
      const [nextInventory, nextStockBatches] = await Promise.all([
        fetchInventoryData(normalizedWarehouseId, options),
        fetchStockBatchesData(options),
      ])
      if (nextInventory && nextStockBatches) {
        // Shared snapshot prevents Inventory and Stock Batch from caching different stock states.
        writePortalCache(
          inventoryStockCacheKey,
          { inventory: nextInventory, stockBatches: nextStockBatches },
          normalizedWarehouseId
        )
        inventoryStockCacheAtRef.current = Date.now()
      }
    })().finally(() => {
      inventoryStockRefreshRef.current = null
    })
    inventoryStockRefreshRef.current = refresh
    return refresh
  }

  const fetchAllWarehouseOrders = async (options?: { summaryOnly?: boolean; lightweightDetails?: boolean }) => {
    const pageSize = 200
    const maxPages = 100
    const summaryOnly = options?.summaryOnly ?? false
    const lightweightDetails = options?.lightweightDetails ?? false
    const fetchPage = (page: number) =>
      safeFetchJson(
        summaryOnly
          ? `/api/orders?page=${page}&pageSize=${pageSize}&includeItems=none&summaryOnly=true`
          : lightweightDetails
            ? `/api/orders?page=${page}&pageSize=${pageSize}&includeItems=full&includeFulfillments=false&includeWarehouseAllocations=false`
          : `/api/orders?page=${page}&pageSize=${pageSize}&includeItems=full&includeFulfillments=true&includeWarehouseAllocations=true`,
        { cache: 'no-store', credentials: 'include' },
        // The initial loader must remain visible until the real warehouse totals arrive.
        summaryOnly
          ? { retries: 1, timeoutMs: 90000 }
          : lightweightDetails
            ? { retries: 1, timeoutMs: 30000 }
            : undefined
      )

    const first = await fetchPage(1)
    if (!first.ok) {
      // A rejected request must never discard this tab's token and retry without
      // it. The retry then authenticates from the browser-wide staff cookie,
      // which may belong to whichever portal logged in last (see the same note
      // in app/page.tsx checkAuth). Because orders, purchase requests and trips
      // are scoped server-side to the signed-in staff member's warehouse, taking
      // on another identity silently returns a different set of rows — or none —
      // and, with the token gone, the next refresh restores the tab as that
      // other user. Session expiry is owned by the portal shell, not by a fetch
      // helper; here we surface the failure and keep the current rows on screen.
      throw new Error(
        first.status === 401 || first.status === 403
          ? 'Not authorized to load orders'
          : first.error || 'Failed orders fetch'
      )
    }

    const merged = getCollection<WarehouseOrderItem>(first.data, ['orders'])
    const totalPages = Math.min(Math.max(1, Number((first.data as any)?.totalPages || 1)), maxPages)

    for (let page = 2; page <= totalPages; page += 1) {
      const next = await fetchPage(page)
      if (!next.ok) {
        throw new Error(next.error || `Failed orders fetch (page ${page})`)
      }
      merged.push(...getCollection<WarehouseOrderItem>(next.data, ['orders']))
    }

    return {
      data: {
        ...(first.data as any),
        orders: merged,
        totalPages,
      },
    }
  }

  // Purchase Requests and Purchase Orders both read from `orders`, so the
  // snapshot is what keeps those two screens populated across a refresh, a
  // reopened tab, or a failed revalidation — the same role the trips and
  // inventory snapshots already play for their screens.
  const persistOrdersSnapshot = (rows: WarehouseOrderItem[]) => {
    writePortalCache(ordersCacheKey, rows, assignedWarehouseIdRef.current)
    ordersCacheAtRef.current = Date.now()
  }

  const fetchOrdersData = async (options?: { showLoading?: boolean; onlyIfNew?: boolean; silent?: boolean; summaryOnly?: boolean; lightweightDetails?: boolean }) => {
    const showLoading = options?.showLoading ?? true
    const onlyIfNew = options?.onlyIfNew ?? false
    const silent = options?.silent ?? false
    if (showLoading) setLoadingOrders(true)
    try {
      if (onlyIfNew) {
        if (latestOrderUpdatedAtRef.current) {
          const deltaParams = new URLSearchParams({
            includeItems: 'full',
            includeFulfillments: 'true',
            includeWarehouseAllocations: 'true',
            sort: 'updated_at',
            page: '1',
            pageSize: '200',
            updatedAfter: latestOrderUpdatedAtRef.current,
          })
          const deltaResult = await safeFetchJson(`/api/orders?${deltaParams.toString()}`, { cache: 'no-store', credentials: 'include' })
          if (deltaResult.ok) {
            const deltaOrders = getCollection<WarehouseOrderItem>(deltaResult.data, ['orders'])
            if (deltaOrders.length > 0) {
              setOrders((prev) => {
                const merged = mergeWarehouseOrders(prev, deltaOrders)
                latestOrderUpdatedAtRef.current = getMaxOrderUpdatedAt(merged)
                persistOrdersSnapshot(merged)
                return merged
              })
              // Keep an open order detail synchronized with the faster status poll.
              setSelectedOrder((prev) => {
                if (!prev) return prev
                const fresh = deltaOrders.find((order) => String(order.id) === String(prev.id))
                return fresh ? { ...prev, ...fresh } : prev
              })
            }
            return
          }
        }
      }

      const result = await fetchAllWarehouseOrders({
        summaryOnly: options?.summaryOnly,
        lightweightDetails: options?.lightweightDetails,
      })

      // Normalize overlapping paginated results so each order appears only once in PR and PO views.
      const list = mergeWarehouseOrders([], getCollection<WarehouseOrderItem>(result.data, ['orders']))
      setOrders(list)
      setSelectedOrder((prev) => {
        if (!prev) return prev
        const fresh = list.find((order) => String(order.id) === String(prev.id))
        return fresh ? { ...prev, ...fresh } : prev
      })
      // A summary-only pass carries no line items, so caching it would leave the
      // next refresh showing rows the tables cannot fully render.
      if (!options?.summaryOnly) persistOrdersSnapshot(list)
      if (!options?.summaryOnly) orderDetailsLoadedRef.current = true
      latestOrderUpdatedAtRef.current = getMaxOrderUpdatedAt(list)
    } catch (error: any) {
      console.warn('Failed to load orders:', error)
    } finally {
      if (showLoading) setLoadingOrders(false)
    }
  }

  const fetchTripsData = (options?: { showLoading?: boolean }): Promise<WarehouseTripItem[] | null> => {
    // Deduplicate simultaneous refreshes from local mutations and cross-tab sync events.
    if (tripsRefreshRef.current) return tripsRefreshRef.current
    const showLoading = options?.showLoading !== false
    if (showLoading) setLoadingTrips(true)
    const refresh = (async () => {
      try {
        const pageSize = 100
        let page = 1
        let totalPages = 1
        const mergedTrips: WarehouseTripItem[] = []
        let latestDriverLocations: DriverLocationItem[] = []

        while (page <= totalPages) {
          const query = new URLSearchParams({
            page: String(page),
            pageSize: String(pageSize),
            includeTracking: '1',
          })
          const result = await safeFetchJson(`/api/trips?${query.toString()}`, { cache: 'no-store' })
          if (!result.ok) {
            return null
          }
          mergedTrips.push(...getCollection<WarehouseTripItem>(result.data, ['trips']))
          if (page === 1) {
            latestDriverLocations = Array.isArray(result.data?.driverLocations)
              ? result.data.driverLocations
              : []
          }
          const payload = (result.data || {}) as Record<string, any>
          totalPages = Math.max(1, Number(payload.totalPages || 1))
          page += 1
        }

        setTrips(mergedTrips)
        setDriverLocations(latestDriverLocations)
        writePortalCache(tripsCacheKey, mergedTrips, assignedWarehouseIdRef.current)
        tripsCacheAtRef.current = Date.now()
        return mergedTrips
      } catch (error: any) {
        console.warn('Failed to load trips:', error)
        return null
      } finally {
        if (showLoading) setLoadingTrips(false)
      }
    })().finally(() => {
      tripsRefreshRef.current = null
    })
    tripsRefreshRef.current = refresh
    return refresh
  }

  const fetchInventoryTransactionsData = async () => {
    setLoadingInventoryTransactions(true)
    try {
      const result = await safeFetchJson('/api/inventory-transactions?limit=1000', { cache: 'no-store' })
      if (!result.ok) {
        return
      }
      setInventoryTransactions(getCollection<InventoryTransactionItem>(result.data, ['transactions']))
    } catch (error) {
      console.warn('Failed to load inventory transactions:', error)
    } finally {
      setLoadingInventoryTransactions(false)
    }
  }

  const fetchReplacementsData = async () => {
    setLoadingReplacements(true)
    try {
      let result = await safeFetchJson('/api/replacements?limit=300', { cache: 'no-store' })
      if (!result.ok) {
        result = await safeFetchJson('/api/orders?includeReplacements=true&includeOrders=false&includeItems=none&limit=300', { cache: 'no-store' })
      }
      if (!result.ok) return
      setReplacements(getCollection<WarehouseReplacementItem>(result.data, ['replacements']))
    } catch (error) {
      console.warn('Failed to load replacements:', error)
    } finally {
      setLoadingReplacements(false)
    }
  }

  const fetchVehiclesData = async () => {
    try {
      const result = await safeFetchJson('/api/vehicles?status=AVAILABLE')
      if (!result.ok) {
        return
      }
      const list = getCollection<VehicleOption>(result.data, ['vehicles'])
      setVehicles(list)
      if (list[0]?.id && !selectedRouteVehicleId) {
        setSelectedRouteVehicleId(list[0].id)
      }
    } catch (error) {
      console.warn('Failed to load vehicles:', error)
    }
  }

  const fetchSavedRoutesData = async () => {
    setSavedRoutes([])
  }

  return {
    fetchInventoryTransactionsData,
    fetchOrdersData,
    fetchProductsData,
    fetchReplacementsData,
    fetchSavedRoutesData,
    fetchTripsData,
    fetchVehiclesData,
    fetchWarehousesData,
    refreshInventoryAndStockData,
  }
}
