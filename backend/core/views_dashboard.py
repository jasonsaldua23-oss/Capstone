"""Administrative dashboard statistics endpoint."""

from django.db.models import F, Sum
from django.http import HttpRequest, JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET

from . import views_api as legacy
from .api_utils import ok as _ok
from .models import (
    Customer,
    Feedback,
    Inventory,
    Order,
    OrderStatus,
    Product,
    Replacement,
    ReplacementStatus,
    Trip,
    TripStatus,
    User,
    Vehicle,
    Warehouse,
)


# Dashboard filters reuse the API's established sample-data and authorization policy.
def _require_staff(request: HttpRequest):
    return legacy._require_staff(request)


def _real_orders(queryset):
    return legacy._real_orders(queryset)


def _real_trips(queryset):
    return legacy._real_trips(queryset)


def _real_products(queryset):
    return legacy._real_products(queryset)


def _real_warehouses(queryset):
    return legacy._real_warehouses(queryset)


def _real_customers(queryset):
    return legacy._real_customers(queryset)


def _real_drivers(queryset):
    return legacy._real_drivers(queryset)


@require_GET
def dashboard_stats(request: HttpRequest) -> JsonResponse:
    _, err = _require_staff(request)
    if err:
        return err
    today = timezone.now().date()
    orders = _real_orders(Order.objects.all())
    trips = _real_trips(Trip.objects.all())
    inventory = (
        Inventory.objects.filter(product__in=_real_products(Product.objects.all()))
        .filter(warehouse__in=_real_warehouses(Warehouse.objects.all()))
    )
    customers = _real_customers(Customer.objects.all())
    drivers = _real_drivers(User.objects.filter(role="DRIVER"))
    feedback_qs = Feedback.objects.filter(customer__in=customers)
    ratings_qs = feedback_qs.exclude(rating__isnull=True)
    avg_rating = float(ratings_qs.aggregate(avg=Sum("rating")).get("avg") or 0)
    rating_count = ratings_qs.count()
    if rating_count > 0:
        avg_rating = avg_rating / rating_count

    pending_replacements = Replacement.objects.filter(
        status__in=[
            ReplacementStatus.REPORTED,
            ReplacementStatus.IN_PROGRESS,
            ReplacementStatus.NEEDS_FOLLOW_UP,
        ]
    ).count()

    pending_orders = orders.filter(status=OrderStatus.PENDING).count()
    processing_orders = orders.filter(status=OrderStatus.PREPARING).count()
    in_transit_orders = orders.filter(status=OrderStatus.OUT_FOR_DELIVERY).count()
    delivered_orders = orders.filter(status=OrderStatus.DELIVERED).count()
    cancelled_orders = orders.filter(status__in=[OrderStatus.CANCELLED, OrderStatus.REJECTED]).count()
    loaded_orders = 0
    total_orders = orders.count()
    total_revenue = float(orders.filter(status=OrderStatus.DELIVERED).aggregate(total=Sum("total_amount")).get("total") or 0)
    active_drivers = drivers.filter(is_active=True).count()
    available_drivers = active_drivers
    low_stock_items = inventory.filter(quantity__lte=F("threshold") + F("reserved_quantity")).count()
    total_customers = customers.count()
    total_vehicles = Vehicle.objects.count()

    stats = {
        # Current frontend contract
        "totalOrders": total_orders,
        "pendingOrders": pending_orders,
        "processingOrders": processing_orders,
        "loadedOrders": loaded_orders,
        "inTransitOrders": in_transit_orders,
        "deliveredOrders": delivered_orders,
        "failedOrders": cancelled_orders,
        "completedOrders": delivered_orders,
        "totalRevenue": total_revenue,
        "totalCustomers": total_customers,
        "activeDrivers": active_drivers,
        "availableDrivers": available_drivers,
        "activeTrips": trips.filter(status=TripStatus.IN_PROGRESS).count(),
        "totalVehicles": total_vehicles,
        "lowStockItems": low_stock_items,
        "pendingReturns": pending_replacements,
        "avgRating": round(avg_rating, 2),
        # Backward-compatible aliases
        "ordersTotal": total_orders,
        "ordersToday": orders.filter(created_at__date=today).count(),
        "lowStockCount": low_stock_items,
        "customersTotal": total_customers,
        "driversTotal": drivers.count(),
        "revenueTotal": total_revenue,
    }
    return _ok({"success": True, "stats": stats})

