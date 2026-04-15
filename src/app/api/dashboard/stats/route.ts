import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, apiResponse, unauthorizedError } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return unauthorizedError()
    }

    // Get various stats
    const [
      totalOrders,
      pendingOrders,
      processingOrders,
      inTransitOrders,
      deliveredOrders,
      failedOrders,
      activeTrips,
      totalVehicles,
      totalDrivers,
      totalCustomers,
      inventoryLevels,
      pendingReturns,
      feedbackStats,
      revenueResult,
    ] = await Promise.all([
      // Total orders
      db.order.count(),
      
      // Processing orders (first stage of delivery pipeline)
      db.order.count({ where: { status: 'PROCESSING' } }),
      
      // Packed/Dispatched orders (middle stages)
      db.order.count({ where: { status: { in: ['PACKED', 'DISPATCHED'] as any } } }),
      
      // Out for delivery orders
      db.order.count({ where: { status: 'OUT_FOR_DELIVERY' } }),
      
      // Delivered orders
      db.order.count({ where: { status: 'DELIVERED' } }),
      
      // Failed orders (removed from canonical delivery pipeline)
      Promise.resolve(0),
      
      // Active trips
      db.trip.count({ where: { status: 'IN_PROGRESS' } }),
      
      // Total vehicles
      db.vehicle.count({ where: { isActive: true } }),
      
      // Available drivers
      db.driver.count({ where: { isActive: true } }),
      
      // Total customers
      db.customer.count({ where: { isActive: true } }),
      
      // Low stock items (computed safely in app layer)
      db.inventory.findMany({
        select: {
          quantity: true,
          minStock: true,
        },
      }),
      
      // Pending returns
      db.return.count({
        where: { status: { in: ['REQUESTED', 'APPROVED', 'PICKED_UP', 'IN_TRANSIT'] } }
      }),
      
      // Average rating
      db.feedback.aggregate({
        _avg: { rating: true },
        where: { rating: { not: null } }
      }),
      
      // Total revenue
      db.order.aggregate({
        _sum: { totalAmount: true },
        where: { 
          status: 'DELIVERED',
          paymentStatus: 'paid'
        }
      }),
    ])

    const lowStockItems = inventoryLevels.filter(
      (item) => Number(item.quantity || 0) <= Number(item.minStock || 0)
    ).length

    return apiResponse({
      totalOrders,
      pendingOrders,
      processingOrders,
      inTransitOrders,
      deliveredOrders,
      failedOrders,
      activeTrips,
      totalVehicles,
      availableDrivers: totalDrivers,
      totalCustomers,
      lowStockItems,
      pendingReturns,
      avgRating: feedbackStats._avg.rating || 0,
      totalRevenue: revenueResult._sum.totalAmount || 0,
    })
  } catch (error) {
    console.error('Dashboard stats error:', error)
    return apiResponse({
      totalOrders: 0,
      pendingOrders: 0,
      processingOrders: 0,
      inTransitOrders: 0,
      deliveredOrders: 0,
      failedOrders: 0,
      activeTrips: 0,
      totalVehicles: 0,
      availableDrivers: 0,
      totalCustomers: 0,
      lowStockItems: 0,
      pendingReturns: 0,
      avgRating: 0,
      totalRevenue: 0,
    })
  }
}
