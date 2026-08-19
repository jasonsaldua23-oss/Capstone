from django.urls import path

from . import views

urlpatterns = [
    # Container Types
    path("container-types", views.list_container_types, name="rgb_list_container_types"),
    
    # Product Packaging
    path("products/<str:product_id>/packaging", views.product_packaging, name="rgb_product_packaging"),
    
    # Deposit Calculation
    path("calculate-deposit", views.calculate_deposit, name="rgb_calculate_deposit"),
    
    # Customer Endpoints
    path("customer/balances", views.customer_bottle_balances, name="rgb_customer_balances"),
    path("customer/ledger", views.customer_deposit_ledger, name="rgb_customer_ledger"),
    
    # Bottle Returns
    path("bottle-returns", views.create_bottle_return, name="rgb_create_bottle_return"),
    path("bottle-returns/list", views.list_bottle_returns, name="rgb_list_bottle_returns"),
    path("bottle-returns/<str:return_id>", views.get_bottle_return, name="rgb_get_bottle_return"),
    
    # Admin Endpoints
    path("admin/container-types", views.admin_create_container_type, name="rgb_admin_create_container_type"),
    path("admin/product-packaging", views.admin_create_product_packaging, name="rgb_admin_create_product_packaging"),
    path("admin/bottle-returns", views.admin_list_bottle_returns, name="rgb_admin_list_bottle_returns"),
    path("admin/customers/<str:customer_id>/balances", views.admin_customer_balances, name="rgb_admin_customer_balances"),
]
