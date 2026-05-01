import uuid

from django.db import models
from django.utils import timezone


def generate_cuid() -> str:
    # CUID-like string to keep parity with existing string IDs.
    return f"c{uuid.uuid4().hex[:24]}"


class RoleType(models.TextChoices):
    SUPER_ADMIN = "SUPER_ADMIN", "Super Admin"
    ADMIN = "ADMIN", "Admin"
    WAREHOUSE_STAFF = "WAREHOUSE_STAFF", "Warehouse Staff"
    DRIVER = "DRIVER", "Driver"
    CUSTOMER = "CUSTOMER", "Customer"


class OrderStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    CONFIRMED = "CONFIRMED", "Confirmed"
    PREPARING = "PREPARING", "Preparing"
    OUT_FOR_DELIVERY = "OUT_FOR_DELIVERY", "Out For Delivery"
    DELIVERED = "DELIVERED", "Delivered"
    CANCELLED = "CANCELLED", "Cancelled"


class WarehouseStage(models.TextChoices):
    READY_TO_LOAD = "READY_TO_LOAD", "Ready To Load"
    LOADED = "LOADED", "Loaded"
    DISPATCHED = "DISPATCHED", "Dispatched"


class VehicleType(models.TextChoices):
    VAN = "VAN", "Van"
    TRUCK = "TRUCK", "Truck"
    MOTORCYCLE = "MOTORCYCLE", "Motorcycle"
    CAR = "CAR", "Car"


class VehicleStatus(models.TextChoices):
    AVAILABLE = "AVAILABLE", "Available"
    IN_USE = "IN_USE", "In Use"
    MAINTENANCE = "MAINTENANCE", "Maintenance"
    OUT_OF_SERVICE = "OUT_OF_SERVICE", "Out Of Service"


class TripStatus(models.TextChoices):
    PLANNED = "PLANNED", "Planned"
    IN_PROGRESS = "IN_PROGRESS", "In Progress"
    COMPLETED = "COMPLETED", "Completed"
    CANCELLED = "CANCELLED", "Cancelled"


class DropPointStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    IN_TRANSIT = "IN_TRANSIT", "In Transit"
    ARRIVED = "ARRIVED", "Arrived"
    COMPLETED = "COMPLETED", "Completed"
    FAILED = "FAILED", "Failed"
    SKIPPED = "SKIPPED", "Skipped"


class DropPointType(models.TextChoices):
    PICKUP = "PICKUP", "Pickup"
    DELIVERY = "DELIVERY", "Delivery"
    RETURN = "RETURN", "Return"


class ReplacementStatus(models.TextChoices):
    REPORTED = "REPORTED", "Reported"
    IN_PROGRESS = "IN_PROGRESS", "In Progress"
    RESOLVED_ON_DELIVERY = "RESOLVED_ON_DELIVERY", "Resolved On Delivery"
    NEEDS_FOLLOW_UP = "NEEDS_FOLLOW_UP", "Needs Follow Up"
    COMPLETED = "COMPLETED", "Completed"


class User(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    email = models.EmailField()
    password = models.CharField(max_length=255)
    name = models.CharField(max_length=255)
    phone = models.CharField(max_length=50, blank=True, null=True)
    avatar = models.TextField(blank=True, null=True)
    role = models.CharField(max_length=50, choices=RoleType.choices, default=RoleType.CUSTOMER)
    license_number = models.CharField(max_length=120, blank=True, null=True, unique=True)
    license_type = models.CharField(max_length=20, blank=True, null=True)
    license_expiry = models.DateTimeField(blank=True, null=True)
    emergency_contact = models.CharField(max_length=255, blank=True, null=True)
    rating = models.FloatField(default=5.0)
    total_deliveries = models.IntegerField(default=0)
    hired_at = models.DateTimeField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    last_login_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "User"


class Customer(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    email = models.EmailField(unique=True)
    password = models.CharField(max_length=255)
    name = models.CharField(max_length=255)
    phone = models.CharField(max_length=50, blank=True, null=True)
    avatar = models.TextField(blank=True, null=True)
    address = models.TextField(blank=True, null=True)
    city = models.CharField(max_length=100, blank=True, null=True)
    province = models.CharField(max_length=100, blank=True, null=True)
    zip_code = models.CharField(max_length=20, blank=True, null=True)
    country = models.CharField(max_length=100, default="Philippines")
    latitude = models.FloatField(blank=True, null=True)
    longitude = models.FloatField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "Customer"


class Feedback(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="feedback")
    order = models.ForeignKey("Order", on_delete=models.SET_NULL, related_name="feedback", blank=True, null=True)
    type = models.CharField(max_length=50, default="SUGGESTION")
    subject = models.CharField(max_length=255, default="General Feedback")
    message = models.TextField(default="")
    rating = models.IntegerField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "Feedback"


class Warehouse(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=100, unique=True)
    address = models.TextField()
    city = models.CharField(max_length=100)
    province = models.CharField(max_length=100)
    zip_code = models.CharField(max_length=20)
    country = models.CharField(max_length=100, default="Philippines")
    latitude = models.FloatField(blank=True, null=True)
    longitude = models.FloatField(blank=True, null=True)
    capacity = models.IntegerField(default=1000)
    manager_id = models.CharField(max_length=25, blank=True, null=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "Warehouse"


class Product(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    sku = models.CharField(max_length=120, unique=True)
    name = models.CharField(max_length=255)
    image_url = models.TextField(blank=True, null=True)
    unit = models.CharField(max_length=50, default="case")
    weight = models.FloatField(blank=True, null=True)
    price = models.FloatField(default=0)
    sizes = models.JSONField(default=list, blank=True)
    quantity_per_unit = models.IntegerField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "Product"


class Inventory(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name="inventory")
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="inventory")
    quantity = models.IntegerField(default=0)
    reserved_quantity = models.IntegerField(default=0)
    threshold = models.IntegerField(default=10)
    last_restocked_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "Inventory"
        constraints = [models.UniqueConstraint(fields=["warehouse", "product"], name="unique_inventory_warehouse_product")]


class InventoryTransaction(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name="inventory_transactions", blank=True, null=True)
    driver = models.ForeignKey(User, on_delete=models.CASCADE, related_name="inventory_transactions", blank=True, null=True)
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="inventory_transactions")
    type = models.CharField(max_length=50)
    quantity = models.IntegerField()
    reference_type = models.CharField(max_length=100, blank=True, null=True)
    reference_id = models.CharField(max_length=100, blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    performed_by = models.CharField(max_length=100, blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "InventoryTransaction"


class StockBatch(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    batch_number = models.CharField(max_length=120, unique=True)
    inventory = models.ForeignKey(Inventory, on_delete=models.CASCADE, related_name="batches")
    quantity = models.IntegerField()
    receipt_date = models.DateTimeField()
    expiry_date = models.DateTimeField(blank=True, null=True)
    location_label = models.CharField(max_length=255, blank=True, null=True)
    status = models.CharField(max_length=50, default="ACTIVE")
    created_by = models.CharField(max_length=100, blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "StockBatch"


class Order(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    order_number = models.CharField(max_length=120, unique=True)
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="orders")
    status = models.CharField(max_length=50, choices=OrderStatus.choices, default=OrderStatus.PENDING)
    priority = models.CharField(max_length=30, default="normal")
    subtotal = models.FloatField()
    tax = models.FloatField(default=0)
    shipping_cost = models.FloatField(default=0)
    discount = models.FloatField(default=0)
    total_amount = models.FloatField()
    payment_status = models.CharField(max_length=50, default="pending")
    warehouse_id = models.CharField(max_length=25, blank=True, null=True)
    shipping_name = models.CharField(max_length=255, blank=True, null=True)
    shipping_phone = models.CharField(max_length=100, blank=True, null=True)
    shipping_address = models.TextField(blank=True, null=True)
    shipping_city = models.CharField(max_length=100, blank=True, null=True)
    shipping_province = models.CharField(max_length=100, blank=True, null=True)
    shipping_zip_code = models.CharField(max_length=20, blank=True, null=True)
    shipping_country = models.CharField(max_length=100, default="Philippines")
    shipping_latitude = models.FloatField(blank=True, null=True)
    shipping_longitude = models.FloatField(blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    special_instructions = models.TextField(blank=True, null=True)

    # Warehouse load and dispatch controls
    warehouse_stage = models.CharField(max_length=50, choices=WarehouseStage.choices, default=WarehouseStage.READY_TO_LOAD)
    ready_to_load_at = models.DateTimeField(blank=True, null=True)
    loaded_at = models.DateTimeField(blank=True, null=True)
    warehouse_dispatched_at = models.DateTimeField(blank=True, null=True)

    checklist_quantity_verified = models.BooleanField(default=False)

    dispatch_signed_off_by = models.CharField(max_length=255, blank=True, null=True)
    dispatch_signed_off_user_id = models.CharField(max_length=100, blank=True, null=True)
    dispatch_signed_off_at = models.DateTimeField(blank=True, null=True)

    exception_short_load_qty = models.IntegerField(default=0)
    exception_damaged_on_loading_qty = models.IntegerField(default=0)
    exception_hold_reason = models.TextField(blank=True, null=True)
    exception_notes = models.TextField(blank=True, null=True)

    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "Order"

    @property
    def checklist_items_verified(self) -> bool:
        return bool(self.checklist_quantity_verified)

    @checklist_items_verified.setter
    def checklist_items_verified(self, value: bool) -> None:
        self.checklist_quantity_verified = bool(value)

    @property
    def checklist_packaging_verified(self) -> bool:
        return bool(self.checklist_quantity_verified)

    @checklist_packaging_verified.setter
    def checklist_packaging_verified(self, value: bool) -> None:
        self.checklist_quantity_verified = bool(value)

    @property
    def checklist_spare_products_verified(self) -> bool:
        return bool(self.checklist_quantity_verified)

    @checklist_spare_products_verified.setter
    def checklist_spare_products_verified(self, value: bool) -> None:
        self.checklist_quantity_verified = bool(value)

    @property
    def checklist_vehicle_assigned(self) -> bool:
        return bool(self.checklist_quantity_verified)

    @checklist_vehicle_assigned.setter
    def checklist_vehicle_assigned(self, value: bool) -> None:
        self.checklist_quantity_verified = bool(value)

    @property
    def checklist_driver_assigned(self) -> bool:
        return bool(self.checklist_quantity_verified)

    @checklist_driver_assigned.setter
    def checklist_driver_assigned(self, value: bool) -> None:
        self.checklist_quantity_verified = bool(value)


class OrderTimeline(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    order = models.OneToOneField(Order, on_delete=models.CASCADE, related_name="timeline")
    confirmed_at = models.DateTimeField(blank=True, null=True)
    processed_at = models.DateTimeField(blank=True, null=True)
    shipped_at = models.DateTimeField(blank=True, null=True)
    delivery_date = models.DateTimeField(blank=True, null=True)
    delivered_at = models.DateTimeField(blank=True, null=True)
    cancelled_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "OrderTimeline"


class OrderItem(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="order_items")
    quantity = models.IntegerField()
    unit_price = models.FloatField()
    total_price = models.FloatField()
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "OrderItem"


class Vehicle(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    license_plate = models.CharField(max_length=100, unique=True)
    type = models.CharField(max_length=50, choices=VehicleType.choices)
    capacity = models.FloatField(blank=True, null=True)
    status = models.CharField(max_length=50, choices=VehicleStatus.choices, default=VehicleStatus.AVAILABLE)
    driver = models.ForeignKey("User", on_delete=models.SET_NULL, blank=True, null=True, related_name="assigned_vehicles")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "Vehicle"


class DriverSpareStock(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    driver = models.ForeignKey(User, on_delete=models.CASCADE, related_name="spare_stock")
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="spare_stock")
    on_hand_quantity = models.IntegerField(default=0)
    minimum_required_quantity = models.IntegerField(default=0)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "DriverSpareStock"
        constraints = [models.UniqueConstraint(fields=["driver", "product"], name="unique_driver_spare_stock")]


class Trip(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    trip_number = models.CharField(max_length=120, unique=True)
    driver = models.ForeignKey(User, on_delete=models.CASCADE, related_name="trips")
    vehicle = models.ForeignKey(Vehicle, on_delete=models.CASCADE, related_name="trips")
    warehouse_id = models.CharField(max_length=25, blank=True, null=True)
    status = models.CharField(max_length=50, choices=TripStatus.choices, default=TripStatus.PLANNED)
    start_latitude = models.FloatField(blank=True, null=True)
    start_longitude = models.FloatField(blank=True, null=True)
    planned_start_at = models.DateTimeField(blank=True, null=True)
    actual_start_at = models.DateTimeField(blank=True, null=True)
    actual_end_at = models.DateTimeField(blank=True, null=True)
    total_drop_points = models.IntegerField(default=0)
    completed_drop_points = models.IntegerField(default=0)
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "Trip"


class TripDropPoint(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    trip = models.ForeignKey(Trip, on_delete=models.CASCADE, related_name="drop_points")
    order = models.ForeignKey(Order, on_delete=models.SET_NULL, blank=True, null=True, related_name="drop_points")
    drop_point_type = models.CharField(max_length=50, choices=DropPointType.choices, default=DropPointType.DELIVERY)
    sequence = models.IntegerField(default=0)
    status = models.CharField(max_length=50, choices=DropPointStatus.choices, default=DropPointStatus.PENDING)
    location_name = models.CharField(max_length=255)
    address = models.TextField()
    city = models.CharField(max_length=100)
    province = models.CharField(max_length=100)
    zip_code = models.CharField(max_length=20)
    latitude = models.FloatField(blank=True, null=True)
    longitude = models.FloatField(blank=True, null=True)
    contact_name = models.CharField(max_length=255, blank=True, null=True)
    contact_phone = models.CharField(max_length=100, blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    actual_arrival = models.DateTimeField(blank=True, null=True)
    actual_departure = models.DateTimeField(blank=True, null=True)
    recipient_name = models.CharField(max_length=255, blank=True, null=True)
    delivery_photo = models.TextField(blank=True, null=True)
    failure_reason = models.TextField(blank=True, null=True)
    failure_notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "TripDropPoint"
        constraints = [models.UniqueConstraint(fields=["trip", "sequence"], name="unique_trip_sequence")]


class LocationLog(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    driver = models.ForeignKey(User, on_delete=models.CASCADE, related_name="location_logs")
    trip = models.ForeignKey(Trip, on_delete=models.SET_NULL, blank=True, null=True, related_name="location_logs")
    latitude = models.FloatField()
    longitude = models.FloatField()
    heading = models.FloatField(blank=True, null=True)
    altitude = models.FloatField(blank=True, null=True)
    accuracy = models.FloatField(blank=True, null=True)
    battery = models.IntegerField(blank=True, null=True)
    recorded_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "LocationLog"


class Replacement(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    replacement_number = models.CharField(max_length=120, unique=True)
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="replacements")
    customer_id = models.CharField(max_length=25)
    reason = models.TextField()
    description = models.TextField(blank=True, null=True)
    status = models.CharField(max_length=50, choices=ReplacementStatus.choices, default=ReplacementStatus.REPORTED)
    requested_by = models.CharField(max_length=50, default="CUSTOMER")
    replacement_mode = models.CharField(max_length=100, blank=True, null=True)
    original_order_item_id = models.CharField(max_length=25, blank=True, null=True)
    replacement_product_id = models.CharField(max_length=25, blank=True, null=True)
    replacement_quantity = models.IntegerField(blank=True, null=True)
    damage_photo_url = models.TextField(blank=True, null=True)
    trip_id = models.CharField(max_length=25, blank=True, null=True)
    drop_point_id = models.CharField(max_length=25, blank=True, null=True)
    pickup_address = models.TextField()
    pickup_city = models.CharField(max_length=100)
    pickup_province = models.CharField(max_length=100)
    pickup_zip_code = models.CharField(max_length=20)
    pickup_completed = models.DateTimeField(blank=True, null=True)
    processed_at = models.DateTimeField(blank=True, null=True)
    processed_by = models.CharField(max_length=100, blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "Replacement"


class Notification(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, blank=True, null=True, related_name="notifications")
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, blank=True, null=True, related_name="notifications")
    title = models.CharField(max_length=255)
    message = models.TextField()
    type = models.CharField(max_length=100)
    reference_type = models.CharField(max_length=100, blank=True, null=True)
    reference_id = models.CharField(max_length=25, blank=True, null=True)
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "Notification"
