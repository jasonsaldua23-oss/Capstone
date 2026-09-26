"""Seeded demo accounts for local and staging environments."""

from datetime import timedelta

from django.utils import timezone

from .auth import hash_password
from .models import Customer, User


def ensure_demo_accounts() -> None:
    User.objects.get_or_create(email="admin@logistics.com", defaults={"name": "Admin User", "password": hash_password("admin123"), "phone": "+1-555-0100", "role": "ADMIN", "is_active": True})
    driver_user, _ = User.objects.get_or_create(email="driver@logistics.com", defaults={"name": "Demo Driver", "password": hash_password("driver123"), "phone": "+1-555-0103", "role": "DRIVER", "is_active": True})
    User.objects.get_or_create(email="warehouse@logistics.com", defaults={"name": "Warehouse Staff", "password": hash_password("admin123"), "phone": "+1-555-0102", "role": "WAREHOUSE_STAFF", "is_active": True})
    Customer.objects.get_or_create(email="customer@example.com", defaults={"name": "Demo Customer", "password": hash_password("customer123"), "phone": "+1-555-0104", "is_active": True})
    User.objects.filter(id=driver_user.id, role="DRIVER").update(
        license_number=f"DEMO-DRIVER-{driver_user.id[-6:].upper()}",
        license_type="B",
        license_expiry=timezone.now() + timedelta(days=1500),
    )
