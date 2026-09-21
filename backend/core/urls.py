from django.urls import path

from . import views_auth as auth_v
from . import views_bottles as bottle_v
from . import views_customer as customer_v
from . import views_dashboard as dashboard_v
from . import views_driver as driver_v
from . import views_feedback as feedback_v
from . import views_fleet as fleet_v
from . import views_inventory as inventory_v
from . import views_media as media_v
from . import views_notifications as notification_v
from . import views_orders as order_v
from . import views_products as product_v
from . import views_retail as retail_v
from . import views_stock as stock_v
from . import views_sync as sync_v
from . import views_trip_ops as trip_ops_v
from . import views_trip_planning as trip_planning_v
from . import views_trips as trip_v
from . import views_users as user_v
from . import views_warehouses as warehouse_v

urlpatterns = [
    path("", auth_v.api_root),
    path("health", auth_v.health),
    # Liveness above answers 200 even with a dead database; point uptime monitors
    # and the platform health check at readiness so an outage is actually detected.
    path("health/ready", auth_v.health_ready),
    # Cross-device portal sync: one cheap read telling a client which scopes moved.
    path("sync/stamps", sync_v.sync_stamps),
    path("auth/login", auth_v.auth_login),
    path("auth/login/verify-otp", auth_v.auth_login_verify_otp),
    # Neutral sign-in detects the existing Customer or permitted staff account.
    path("auth/unified/login", auth_v.auth_unified_login),
    path("auth/unified/google", auth_v.auth_unified_google),
    path("auth/staff/google", auth_v.auth_staff_google),
    path("auth/customer/login", auth_v.auth_customer_login),
    path("auth/customer/google", auth_v.auth_customer_google),
    path("auth/register", auth_v.auth_register),
    path("auth/email-verification/request", auth_v.auth_email_verification_request),
    path("auth/email-verification/confirm", auth_v.auth_email_verification_confirm),
    path("auth/email-verification/request-existing", auth_v.auth_email_verification_request_existing),
    path("auth/email-verification/confirm-existing", auth_v.auth_email_verification_confirm_existing),
    path("auth/me", auth_v.auth_me),
    path("auth/logout", auth_v.auth_logout),
    path("auth/password-reset/request-otp", auth_v.auth_password_reset_request_otp),
    path("auth/password-reset/verify-otp", auth_v.auth_password_reset_verify_otp),
    path("auth/password-reset/reset", auth_v.auth_password_reset_reset),
    path("roles", user_v.roles_list),
    path("users", user_v.users_collection),
    path("users/<str:user_id>", user_v.user_detail),
    path("customers", user_v.customers_collection),
    path("customers/<str:customer_id>", user_v.customer_detail),
    path("categories", user_v.categories_list),
    path("warehouses", warehouse_v.warehouses_collection),
    path("warehouses/<str:warehouse_id>", warehouse_v.warehouse_detail),
    path("products", product_v.products_collection),
    path("products/<str:product_id>", product_v.product_detail),
    path("inventory", inventory_v.inventory_collection),
    path("inventory/empty-cases", inventory_v.empty_case_inventory),
    path("inventory/empty-returns", inventory_v.record_returned_empty_containers),
    path("inventory/<str:inventory_id>", inventory_v.inventory_detail),
    path("inventory-transactions", inventory_v.inventory_transactions_list),
    path("stock-batches", stock_v.stock_batches_collection),
    path("stock-batches/bulk", stock_v.stock_batches_bulk_collection),
    path("stock-batches/expired-stock", inventory_v.resolve_expired_stock),
    path("stock-batches/disposals", inventory_v.disposed_stock_history),
    path("vehicles", fleet_v.vehicles_collection),
    path("vehicles/<str:vehicle_id>", fleet_v.vehicle_detail),
    path("drivers", fleet_v.drivers_collection),
    path("dashboard/stats", dashboard_v.dashboard_stats),
    path("feedback", feedback_v.feedback_collection),
    path("notifications", notification_v.notifications_collection),
    path("push-subscriptions", notification_v.push_subscriptions_collection),
    # Retail POS is a separate domain module; legacy views_api wrappers remain import-compatible.
    path("retail/products", retail_v.retail_products),
    path("retail/quote", retail_v.retail_quote),
    path("retail/sales", retail_v.retail_sales_collection),
    path("retail/sales/<str:sale_id>", retail_v.retail_sale_detail),
    path("retail/sales/<str:sale_id>/payment", retail_v.retail_sale_payment),
    path("retail/sales/<str:sale_id>/pickup-status", retail_v.retail_sale_pickup_status),
    path("retail/sales/<str:sale_id>/cancel", retail_v.retail_sale_cancel),
    path("orders", order_v.orders_collection),
    path("replacements", customer_v.replacements_collection),
    path("orders/<str:order_id>", order_v.order_detail),
    path("orders/<str:order_id>/status", order_v.order_status_update),
    path("trips", trip_v.trips_collection),
    path("driver/trips", driver_v.driver_trips),
    # Protected files are owned by the media domain module.
    path("uploads/product-image", media_v.upload_product_image),
    path("uploads/pod-image", media_v.upload_pod_image),
    path("uploads/damage-image", media_v.upload_damage_image),
    path("uploads/customer-avatar", media_v.upload_customer_avatar),
    path("uploads/replacement-evidence", media_v.upload_replacement_evidence),
    path("media/<path:path>", media_v.private_media),
    path("customer/orders", customer_v.customer_orders),
    path("customer/orders/<str:order_id>/deposit-refund", customer_v.customer_order_deposit_refund),
    path("customer/orders/<str:order_id>/cancel", customer_v.customer_order_cancel),
    path("customer/replacements", customer_v.customer_replacements),
    path("customer/replacements/<str:replacement_id>/cancel", customer_v.customer_replacement_cancel),
    path("customer/tracking", customer_v.customer_tracking),
    # Returnable-container workflows are isolated from the general API controller.
    path("customer/empty-bottles/eligible", bottle_v.customer_empty_bottles_eligible),
    path("customer/empty-bottles/record", bottle_v.customer_record_empty_bottles),
    path("bottle-returns", bottle_v.bottle_returns_collection),
    path("driver/location", driver_v.driver_location),
    path("driver/profile", driver_v.driver_profile),
    path("trips/route-plan", trip_ops_v.trips_route_plan),
    path("trips/upcoming-deliveries", trip_planning_v.trips_upcoming_deliveries),
    path("trips/<str:trip_id>", trip_v.trip_detail),
    path("trips/<str:trip_id>/start", trip_ops_v.trip_start),
    path("trips/<str:trip_id>/complete", trip_ops_v.trip_complete),
    path("trips/<str:trip_id>/drop-points/<str:drop_point_id>", trip_ops_v.trip_drop_point_update),
    path("trips/<str:trip_id>/stops/<str:stop_id>", trip_ops_v.trip_stop_update),
    path("trips/<str:trip_id>/unassign", trip_v.trip_unassign_items),
    path("trips/check/<str:trip_number>", trip_v.trip_check),
]
