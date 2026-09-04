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
    RESCHEDULED = "RESCHEDULED", "Rescheduled"
    OUT_FOR_DELIVERY = "OUT_FOR_DELIVERY", "Out For Delivery"
    DELIVERED = "DELIVERED", "Delivered"
    REJECTED = "REJECTED", "Rejected"
    CANCELLED = "CANCELLED", "Cancelled"


class PurchaseRequestStatus(models.TextChoices):
    PENDING_APPROVAL = "PENDING_APPROVAL", "Pending Approval"
    APPROVED = "APPROVED", "Approved"
    REJECTED = "REJECTED", "Rejected"
    CANCELLED = "CANCELLED", "Cancelled"


class PurchaseOrderStage(models.TextChoices):
    APPROVED = "APPROVED", "Approved"
    PROCESSING = "PROCESSING", "Processing"
    READY_FOR_DELIVERY = "READY_FOR_DELIVERY", "Ready for Delivery"
    FOR_DELIVERY = "FOR_DELIVERY", "For Delivery"
    OUT_FOR_DELIVERY = "OUT_FOR_DELIVERY", "Out for Delivery"
    DELIVERED = "DELIVERED", "Delivered"
    COMPLETED = "COMPLETED", "Completed"
    CANCELLED = "CANCELLED", "Cancelled"


class VehicleType(models.TextChoices):
    TRUCK = "TRUCK", "Truck"
    TRICYCLE = "TRICYCLE", "Tricycle"
    VAN = "VAN", "Van"
    MOTORCYCLE = "MOTORCYCLE", "Motorcycle"
    CAR = "CAR", "Car"


class VehicleClassification(models.TextChoices):
    LIGHT_DUTY = "LIGHT_DUTY", "Light-Duty"
    MEDIUM_DUTY = "MEDIUM_DUTY", "Medium-Duty"
    HEAVY_DUTY = "HEAVY_DUTY", "Heavy-Duty"


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
    PENDING = "PENDING", "Pending"
    UNDER_REVIEW = "UNDER_REVIEW", "Under Review"
    APPROVED = "APPROVED", "Approved"
    REJECTED = "REJECTED", "Rejected"
    CANCELLED = "CANCELLED", "Cancelled"
    REPORTED = "REPORTED", "Reported"
    IN_PROGRESS = "IN_PROGRESS", "In Progress"
    RESOLVED_ON_DELIVERY = "RESOLVED_ON_DELIVERY", "Resolved On Delivery"
    NEEDS_FOLLOW_UP = "NEEDS_FOLLOW_UP", "Needs Follow Up"
    COMPLETED = "COMPLETED", "Completed"


class OrderItemType(models.TextChoices):
    STANDARD_CASE = "STANDARD_CASE", "Standard Case"
    MIXED_CASE = "MIXED_CASE", "Mixed Case"


class ReservationStatus(models.TextChoices):
    RESERVED = "RESERVED", "Reserved"
    CONSUMED = "CONSUMED", "Consumed"
    RELEASED = "RELEASED", "Released"


class InventoryQuantityUnit(models.TextChoices):
    CASE = "CASE", "Case"
    BASE_UNIT = "BASE_UNIT", "Base Unit"


class SalesChannel(models.TextChoices):
    ONLINE = "ONLINE", "Online"
    RETAIL_POS = "RETAIL_POS", "Retail"


class RetailFulfillmentType(models.TextChoices):
    IMMEDIATE = "IMMEDIATE", "Immediate / Walk-in Sale"
    CUSTOMER_PICKUP = "CUSTOMER_PICKUP", "Customer Pickup"


class RetailPickupStatus(models.TextChoices):
    NOT_APPLICABLE = "NOT_APPLICABLE", "Not Applicable"
    PENDING_PICKUP = "PENDING_PICKUP", "Pending Pickup"
    READY_FOR_PICKUP = "READY_FOR_PICKUP", "Ready for Pickup"
    PICKED_UP_COMPLETED = "PICKED_UP_COMPLETED", "Picked Up / Completed"
    CANCELLED = "CANCELLED", "Cancelled"


class RetailTransactionStatus(models.TextChoices):
    OPEN = "OPEN", "Open"
    RESERVED = "RESERVED", "Reserved"
    COMPLETED = "COMPLETED", "Completed"
    CANCELLED = "CANCELLED", "Cancelled"


class RetailSaleMode(models.TextChoices):
    LOOSE = "LOOSE", "Loose"
    CASE = "CASE", "Case"
    MIXED_CASE = "MIXED_CASE", "Mixed Case"


class DriverStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    ON_LEAVE = "ON_LEAVE", "On Leave"
    INACTIVE = "INACTIVE", "Inactive"


class User(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    email = models.EmailField()
    password = models.CharField(max_length=255)
    name = models.CharField(max_length=255)
    first_name = models.CharField(max_length=255, blank=True, null=True)
    middle_name = models.CharField(max_length=255, blank=True, null=True)
    last_name = models.CharField(max_length=255, blank=True, null=True)
    suffix = models.CharField(max_length=50, blank=True, null=True)
    phone = models.CharField(max_length=50, blank=True, null=True)
    avatar = models.TextField(blank=True, null=True)
    role = models.CharField(max_length=50, choices=RoleType.choices, default=RoleType.CUSTOMER)
    license_number = models.CharField(max_length=120, blank=True, null=True, unique=True)
    license_type = models.CharField(max_length=30, blank=True, null=True)
    # Added: stores the uploaded driver's license image used by both driver and admin editors.
    license_photo_url = models.TextField(blank=True, null=True)
    license_expiry = models.DateTimeField(blank=True, null=True)
    emergency_contact = models.CharField(max_length=255, blank=True, null=True)
    rating = models.FloatField(default=5.0)
    total_deliveries = models.IntegerField(default=0)
    hired_at = models.DateTimeField(blank=True, null=True)
    # Added: operational driver availability is separate from account activation.
    driver_status = models.CharField(max_length=20, choices=DriverStatus.choices, default=DriverStatus.ACTIVE)
    is_active = models.BooleanField(default=True)
    two_factor_enabled = models.BooleanField(default=False)
    login_alerts_enabled = models.BooleanField(default=True)
    session_timeout_minutes = models.IntegerField(default=30)
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
    first_name = models.CharField(max_length=255, blank=True, null=True)
    middle_name = models.CharField(max_length=255, blank=True, null=True)
    last_name = models.CharField(max_length=255, blank=True, null=True)
    suffix = models.CharField(max_length=50, blank=True, null=True)
    phone = models.CharField(max_length=50, blank=True, null=True)
    avatar = models.TextField(blank=True, null=True)
    address = models.TextField(blank=True, null=True)
    city = models.CharField(max_length=100, blank=True, null=True)
    province = models.CharField(max_length=100, blank=True, null=True)
    zip_code = models.CharField(max_length=20, blank=True, null=True)
    country = models.CharField(max_length=100, default="Philippines")
    latitude = models.FloatField(blank=True, null=True)
    longitude = models.FloatField(blank=True, null=True)
    discount_option = models.CharField(max_length=50, default="NO_DISCOUNT")
    discount_percent = models.FloatField(default=0)
    discount_amount_per_case = models.FloatField(default=0)
    discount_status = models.CharField(max_length=30, default="REMOVED")
    discount_applied_by_user_id = models.CharField(max_length=25, blank=True, null=True)
    discount_applied_by_name = models.CharField(max_length=255, blank=True, null=True)
    discount_updated_at = models.DateTimeField(blank=True, null=True)
    bottle_balance_threshold = models.IntegerField(
        blank=True,
        null=True,
        default=0,
        help_text="Max outstanding empties before new RGB orders are blocked. 0 = no limit.",
    )
    deposit_override_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        blank=True,
        null=True,
        default=0,
        help_text="Optional per-customer deposit discount percentage.",
    )
    is_active = models.BooleanField(default=True)
    two_factor_enabled = models.BooleanField(default=False)
    login_alerts_enabled = models.BooleanField(default=True)
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


class PackagingProfile(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    code = models.CharField(max_length=120, unique=True)
    name = models.CharField(max_length=255)
    container_type = models.CharField(max_length=100)
    container_size = models.CharField(max_length=100)
    standard_units_per_case = models.PositiveIntegerField()
    allowed_mixed_case_capacities = models.JSONField(default=list, blank=True)
    compatibility_key = models.CharField(max_length=255, db_index=True)
    base_unit_label = models.CharField(max_length=50, default="unit")
    is_returnable = models.BooleanField(default=False)
    default_deposit_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "PackagingProfile"


class Product(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    sku = models.CharField(max_length=120, unique=True)
    name = models.CharField(max_length=255)
    image_url = models.TextField(blank=True, null=True)
    unit = models.CharField(max_length=50, default="case")
    weight = models.FloatField(blank=True, null=True)
    price = models.FloatField(default=0)
    retail_unit_price = models.DecimalField(max_digits=12, decimal_places=2, blank=True, null=True)
    case_price = models.DecimalField(max_digits=12, decimal_places=2, blank=True, null=True)
    category = models.CharField(max_length=150, blank=True, null=True)
    sizes = models.JSONField(default=list, blank=True)
    quantity_per_unit = models.IntegerField(blank=True, null=True)
    packaging_profile = models.ForeignKey(PackagingProfile, on_delete=models.PROTECT, null=True, blank=True, related_name="products")
    packaging_type = models.CharField(
        max_length=20,
        choices=[("RETURNABLE", "Returnable"), ("NON_RETURNABLE", "Non-Returnable")],
        default="NON_RETURNABLE",
    )
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
    loose_bottles = models.IntegerField(default=0)
    reserved_quantity = models.IntegerField(default=0)
    reserved_base_units = models.IntegerField(default=0)
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
    quantity_unit = models.CharField(max_length=20, choices=InventoryQuantityUnit.choices, default=InventoryQuantityUnit.CASE)
    stock_unit_label = models.CharField(max_length=100, blank=True, null=True)
    previous_stock = models.IntegerField(blank=True, null=True)
    updated_stock = models.IntegerField(blank=True, null=True)
    case_capacity_snapshot = models.IntegerField(blank=True, null=True)
    case_count_snapshot = models.IntegerField(blank=True, null=True)
    order_item = models.ForeignKey("OrderItem", on_delete=models.SET_NULL, related_name="inventory_transactions", blank=True, null=True)
    mixed_case_component = models.ForeignKey("MixedCaseComponent", on_delete=models.SET_NULL, related_name="inventory_transactions", blank=True, null=True)
    reference_type = models.CharField(max_length=100, blank=True, null=True)
    reference_id = models.CharField(max_length=100, blank=True, null=True)
    # Staff user id behind the movement. Manual stock corrections are the one
    # movement with no order, trip or batch to trace them back to, so without
    # this the adjustment has no accountable author. Mirrors DepositTransaction.
    performed_by = models.CharField(max_length=100, blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "InventoryTransaction"


class StockBatch(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    batch_number = models.CharField(max_length=120, unique=True)
    inventory = models.ForeignKey(Inventory, on_delete=models.CASCADE, related_name="batches")
    quantity = models.IntegerField()
    loose_units = models.IntegerField(default=0)
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
    request_id = models.CharField(max_length=120, blank=True, null=True, unique=True)
    customer = models.ForeignKey(Customer, on_delete=models.SET_NULL, related_name="orders", blank=True, null=True)
    status = models.CharField(max_length=50, choices=OrderStatus.choices, default=OrderStatus.PENDING)
    priority = models.CharField(max_length=30, default="normal")
    subtotal = models.FloatField()
    tax = models.FloatField(default=0)
    shipping_cost = models.FloatField(default=0)
    discount = models.FloatField(default=0)
    discount_type = models.CharField(max_length=30, default="NO_DISCOUNT")
    discount_name = models.CharField(max_length=120, blank=True, null=True)
    discount_percent_applied = models.FloatField(default=0)
    discount_amount_per_case_applied = models.FloatField(default=0)
    discount_per_case_applied = models.FloatField(default=0)
    discount_cases_affected = models.IntegerField(default=0)
    discount_applied_by_name = models.CharField(max_length=255, blank=True, null=True)
    discount_status = models.CharField(max_length=30, default="REMOVED")
    total_amount = models.FloatField()
    payment_status = models.CharField(max_length=50, default="pending")
    sales_channel = models.CharField(max_length=20, choices=SalesChannel.choices, default=SalesChannel.ONLINE, db_index=True)
    fulfillment_type = models.CharField(max_length=30, choices=RetailFulfillmentType.choices, blank=True, null=True)
    pickup_status = models.CharField(max_length=30, choices=RetailPickupStatus.choices, default=RetailPickupStatus.NOT_APPLICABLE, db_index=True)
    retail_status = models.CharField(max_length=20, choices=RetailTransactionStatus.choices, blank=True, null=True, db_index=True)
    retail_transaction_number = models.CharField(max_length=120, blank=True, null=True, unique=True)
    retail_request_id = models.CharField(max_length=120, blank=True, null=True, unique=True)
    walk_in_name = models.CharField(max_length=255, blank=True, null=True)
    walk_in_contact = models.CharField(max_length=100, blank=True, null=True)
    walk_in_notes = models.TextField(blank=True, null=True)
    amount_paid = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    remaining_balance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_by_user = models.ForeignKey(User, on_delete=models.SET_NULL, blank=True, null=True, related_name="retail_orders_created")
    created_by_name = models.CharField(max_length=255, blank=True, null=True)
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
    pod_recipient_name = models.CharField(max_length=255, blank=True, null=True)
    pod_photo_url = models.TextField(blank=True, null=True)
    pod_submitted_at = models.DateTimeField(blank=True, null=True)

    ready_to_load_at = models.DateTimeField(blank=True, null=True)
    loaded_at = models.DateTimeField(blank=True, null=True)
    warehouse_dispatched_at = models.DateTimeField(blank=True, null=True)

    purchase_request_number = models.CharField(max_length=120, blank=True, null=True, db_index=True)
    purchase_order_number = models.CharField(max_length=120, blank=True, null=True, db_index=True)
    request_status = models.CharField(max_length=50, choices=PurchaseRequestStatus.choices, default=PurchaseRequestStatus.PENDING_APPROVAL)
    purchase_order_stage = models.CharField(max_length=50, choices=PurchaseOrderStage.choices, blank=True, null=True)
    approved_by_user_id = models.CharField(max_length=25, blank=True, null=True)
    approved_by_name = models.CharField(max_length=255, blank=True, null=True)
    approved_at = models.DateTimeField(blank=True, null=True)
    rejected_by_user_id = models.CharField(max_length=25, blank=True, null=True)
    rejected_by_name = models.CharField(max_length=255, blank=True, null=True)
    rejection_reason = models.TextField(blank=True, null=True)
    rejected_at = models.DateTimeField(blank=True, null=True)
    cancelled_by_user_id = models.CharField(max_length=25, blank=True, null=True)
    cancelled_by_name = models.CharField(max_length=255, blank=True, null=True)
    cancellation_reason = models.TextField(blank=True, null=True)
    cancelled_at = models.DateTimeField(blank=True, null=True)

    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "Order"


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
    product = models.ForeignKey(Product, on_delete=models.SET_NULL, related_name="order_items", blank=True, null=True)
    product_name = models.CharField(max_length=255, blank=True, null=True)
    product_sku = models.CharField(max_length=100, blank=True, null=True)
    product_unit = models.CharField(max_length=50, blank=True, null=True)
    item_type = models.CharField(max_length=30, choices=OrderItemType.choices, default=OrderItemType.STANDARD_CASE)
    case_capacity = models.IntegerField(blank=True, null=True)
    quantity = models.IntegerField()
    unit_price = models.FloatField()
    total_price = models.FloatField()
    container_type_id = models.CharField(max_length=25, blank=True, null=True)
    container_type_name = models.CharField(max_length=255, blank=True, null=True)
    is_returnable_item = models.BooleanField(default=False)
    full_quantity = models.IntegerField(default=0, help_text="Quantity of full bottles/crates delivered")
    empty_returned_quantity = models.IntegerField(default=0, help_text="Quantity of empties returned in this transaction")
    deposit_per_unit = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    deposit_charged = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    deposit_refunded = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    net_deposit = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    sale_mode = models.CharField(max_length=20, choices=RetailSaleMode.choices, blank=True, null=True)
    product_category = models.CharField(max_length=150, blank=True, null=True)
    packaging_type_snapshot = models.CharField(max_length=100, blank=True, null=True)
    product_subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    deposit_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    empty_covered_quantity = models.PositiveIntegerField(default=0)
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "OrderItem"


class Vehicle(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    license_plate = models.CharField(max_length=100, unique=True)
    brand = models.CharField(max_length=100, default="", blank=True)
    model = models.CharField(max_length=100, default="", blank=True)
    year = models.IntegerField(blank=True, null=True)
    type = models.CharField(max_length=50, choices=VehicleType.choices, default=VehicleType.TRUCK)
    classification = models.CharField(max_length=50, choices=VehicleClassification.choices, default=VehicleClassification.LIGHT_DUTY)
    capacity = models.FloatField(blank=True, null=True)
    status = models.CharField(max_length=50, choices=VehicleStatus.choices, default=VehicleStatus.AVAILABLE)
    driver = models.ForeignKey("User", on_delete=models.SET_NULL, blank=True, null=True, related_name="assigned_vehicles")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "Vehicle"


class Trip(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    trip_number = models.CharField(max_length=120, unique=True)
    driver = models.ForeignKey(User, on_delete=models.CASCADE, related_name="trips")
    vehicle = models.ForeignKey(Vehicle, on_delete=models.CASCADE, related_name="trips")
    warehouse_id = models.CharField(max_length=25, blank=True, null=True)
    created_by_user_id = models.CharField(max_length=25, blank=True, null=True)
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
    bottle_return_id = models.CharField(max_length=25, blank=True, null=True)
    empties_collected = models.BooleanField(default=False)
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
    speed = models.FloatField(blank=True, null=True, help_text="GPS speed in m/s")
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
    damage_photo_urls = models.TextField(blank=True, null=True)
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


class PushSubscription(models.Model):
    """A browser push endpoint owned by exactly one authenticated account."""

    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, blank=True, null=True, related_name="push_subscriptions")
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, blank=True, null=True, related_name="push_subscriptions")
    endpoint = models.TextField()
    p256dh = models.TextField()
    auth = models.TextField()
    user_agent = models.TextField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "PushSubscription"
        constraints = [
            # Fix: prevent a device endpoint from belonging to both account types.
            models.CheckConstraint(
                check=(
                    models.Q(user__isnull=False, customer__isnull=True)
                    | models.Q(user__isnull=True, customer__isnull=False)
                ),
                name="push_subscription_has_one_owner",
            ),
            models.UniqueConstraint(fields=["endpoint", "user"], name="unique_push_endpoint_user"),
            models.UniqueConstraint(fields=["endpoint", "customer"], name="unique_push_endpoint_customer"),
        ]


class MixedCaseComponent(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    order_item = models.ForeignKey("OrderItem", on_delete=models.CASCADE, related_name="mixed_case_components")
    product = models.ForeignKey("Product", on_delete=models.SET_NULL, blank=True, null=True, related_name="mixed_case_components")
    product_name = models.CharField(max_length=255)
    product_sku = models.CharField(max_length=120, blank=True, null=True)
    base_unit_label = models.CharField(max_length=50, default="unit")
    quantity_per_case = models.PositiveIntegerField()
    case_count = models.PositiveIntegerField()
    total_base_units = models.PositiveIntegerField()
    unit_price = models.DecimalField(max_digits=12, decimal_places=6)
    component_subtotal = models.DecimalField(max_digits=12, decimal_places=2)
    product_category = models.CharField(max_length=150, blank=True, null=True)
    packaging_type_snapshot = models.CharField(max_length=100, blank=True, null=True)
    container_type_id = models.CharField(max_length=25, blank=True, null=True)
    container_type_name = models.CharField(max_length=255, blank=True, null=True)
    deposit_per_unit = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    deposit_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    empty_covered_quantity = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "MixedCaseComponent"
        constraints = [
            models.UniqueConstraint(fields=["order_item", "product"], name="unique_mixed_case_component_product")
        ]


class InventoryReservation(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    inventory = models.ForeignKey("Inventory", on_delete=models.PROTECT, related_name="reservations")
    order_item = models.ForeignKey("OrderItem", on_delete=models.CASCADE, related_name="inventory_reservations")
    mixed_case_component = models.ForeignKey(MixedCaseComponent, on_delete=models.CASCADE, blank=True, null=True, related_name="inventory_reservations")
    product = models.ForeignKey("Product", on_delete=models.SET_NULL, blank=True, null=True, related_name="inventory_reservations")
    stock_batch = models.ForeignKey("StockBatch", on_delete=models.PROTECT, blank=True, null=True, related_name="reservations")
    quantity_base_units = models.PositiveIntegerField()
    standard_case_quantity = models.PositiveIntegerField(blank=True, null=True)
    allocation_policy = models.CharField(max_length=10, default="FEFO")
    status = models.CharField(max_length=20, choices=ReservationStatus.choices, default=ReservationStatus.RESERVED)
    reserved_at = models.DateTimeField(default=timezone.now)
    consumed_at = models.DateTimeField(blank=True, null=True)
    released_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        db_table = "InventoryReservation"
        indexes = [
            models.Index(fields=["inventory", "status"], name="inv_res_inventory_status_idx"),
            models.Index(fields=["stock_batch", "status"], name="inv_res_batch_status_idx"),
        ]


class ReplacementLine(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    replacement = models.ForeignKey("Replacement", on_delete=models.CASCADE, related_name="lines")
    product_name = models.CharField(max_length=255)
    product_sku = models.CharField(max_length=120, blank=True, null=True)
    base_unit_label = models.CharField(max_length=50, default="unit")
    requested_base_units = models.PositiveIntegerField()
    replaced_base_units = models.PositiveIntegerField(default=0)
    returned_base_units = models.PositiveIntegerField(default=0)
    reason = models.TextField()
    description = models.TextField(blank=True, null=True)
    product = models.ForeignKey(Product, on_delete=models.SET_NULL, blank=True, null=True, related_name="replacement_lines")
    original_order_item = models.ForeignKey(OrderItem, on_delete=models.PROTECT, related_name="replacement_lines")
    mixed_case_component = models.ForeignKey(MixedCaseComponent, on_delete=models.PROTECT, blank=True, null=True, related_name="replacement_lines")
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "ReplacementLine"
        constraints = [
            models.UniqueConstraint(
                fields=["replacement", "original_order_item", "mixed_case_component", "product"],
                name="unique_replacement_source_line",
            )
        ]


class ReturnReceipt(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    request_id = models.CharField(max_length=120, unique=True)
    replacement = models.ForeignKey("Replacement", on_delete=models.CASCADE, related_name="return_receipts")
    received_by = models.CharField(max_length=100, blank=True, null=True)
    received_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ReturnReceipt"


class ReturnReceiptLine(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    receipt = models.ForeignKey(ReturnReceipt, on_delete=models.CASCADE, related_name="lines")
    replacement_line = models.ForeignKey(ReplacementLine, on_delete=models.PROTECT, related_name="return_receipt_lines")
    product = models.ForeignKey(Product, on_delete=models.SET_NULL, blank=True, null=True, related_name="return_receipt_lines")
    stock_batch = models.ForeignKey("StockBatch", on_delete=models.PROTECT, blank=True, null=True, related_name="return_receipt_lines")
    quantity_base_units = models.PositiveIntegerField()

    class Meta:
        db_table = "ReturnReceiptLine"


class ContainerType(models.Model):
    """Physical container configuration shared by orders, returns, and POS."""

    class Category(models.TextChoices):
        BOTTLE = "BOTTLE", "Bottle"
        CRATE = "CRATE", "Crate"

    class Material(models.TextChoices):
        GLASS = "GLASS", "Glass"
        PLASTIC = "PLASTIC", "Plastic"
        ALUMINUM = "ALUMINUM", "Aluminum"

    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=255)
    category = models.CharField(max_length=50, choices=Category.choices, default=Category.BOTTLE)
    material = models.CharField(max_length=50, choices=Material.choices, default=Material.GLASS)
    volume_ml = models.FloatField(blank=True, null=True)
    capacity_units = models.IntegerField(blank=True, null=True, help_text="For crates — e.g., 24 bottles per crate")
    deposit_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    is_returnable = models.BooleanField(default=True)
    expected_lifespan_cycles = models.IntegerField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "ContainerType"
        verbose_name = "Container Type"
        verbose_name_plural = "Container Types"


class ProductPackaging(models.Model):
    """Existing product-level deposit and physical packaging source of truth."""

    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="packaging_options")
    container_type = models.ForeignKey(ContainerType, on_delete=models.PROTECT, related_name="product_packagings")
    packaging_profile = models.ForeignKey(
        PackagingProfile,
        on_delete=models.SET_NULL,
        related_name="product_packagings",
        blank=True,
        null=True,
    )
    units_per_container = models.IntegerField(default=1, help_text="e.g., 1 (bottle), 24 (crate)")
    containers_per_case = models.IntegerField(default=24, help_text="e.g., 24 bottles per case")
    is_primary = models.BooleanField(default=False, help_text="Default packaging for ordering")
    is_returnable = models.BooleanField(default=False)
    deposit_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    case_deposit_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "ProductPackaging"
        verbose_name = "Product Packaging"
        verbose_name_plural = "Product Packaging"
        constraints = [
            models.UniqueConstraint(fields=["product", "container_type"], name="unique_product_container_type")
        ]


class CustomerDepositLedger(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    customer = models.OneToOneField(Customer, on_delete=models.CASCADE, related_name="deposit_ledger")
    balance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    currency = models.CharField(max_length=3, default="PHP")
    last_transaction_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "CustomerDepositLedger"
        verbose_name = "Customer Deposit Ledger"
        verbose_name_plural = "Customer Deposit Ledgers"


class DepositTransaction(models.Model):
    class TransactionType(models.TextChoices):
        CHARGE = "CHARGE", "Charge"
        REFUND = "REFUND", "Refund"
        ADJUSTMENT = "ADJUSTMENT", "Adjustment"
        WRITE_OFF = "WRITE_OFF", "Write Off"

    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="deposit_transactions", blank=True, null=True)
    ledger = models.ForeignKey(CustomerDepositLedger, on_delete=models.CASCADE, related_name="transactions", blank=True, null=True)
    type = models.CharField(max_length=30, choices=TransactionType.choices)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    balance_before = models.DecimalField(max_digits=12, decimal_places=2)
    balance_after = models.DecimalField(max_digits=12, decimal_places=2)
    order = models.ForeignKey(Order, on_delete=models.SET_NULL, blank=True, null=True, related_name="deposit_transactions")
    order_item = models.ForeignKey(OrderItem, on_delete=models.SET_NULL, blank=True, null=True, related_name="deposit_transactions")
    container_type = models.ForeignKey(ContainerType, on_delete=models.SET_NULL, blank=True, null=True, related_name="deposit_transactions")
    container_count = models.IntegerField(blank=True, null=True)
    reason = models.TextField()
    reference_type = models.CharField(max_length=50, blank=True, null=True)
    reference_id = models.CharField(max_length=25, blank=True, null=True)
    performed_by = models.CharField(max_length=100, blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "DepositTransaction"
        verbose_name = "Deposit Transaction"
        verbose_name_plural = "Deposit Transactions"
        indexes = [
            models.Index(fields=["customer", "created_at"], name="dep_tx_customer_created_idx"),
            models.Index(fields=["order"], name="dep_tx_order_idx"),
        ]


class CustomerBottleBalance(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="bottle_balances")
    container_type = models.ForeignKey(ContainerType, on_delete=models.PROTECT, related_name="customer_balances")
    bottles_outstanding = models.IntegerField(default=0)
    deposit_balance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    bottles_returned_total = models.IntegerField(default=0)
    bottles_sold_total = models.IntegerField(default=0)
    last_return_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "CustomerBottleBalance"
        verbose_name = "Customer Bottle Balance"
        verbose_name_plural = "Customer Bottle Balances"
        constraints = [
            models.UniqueConstraint(fields=["customer", "container_type"], name="unique_customer_container_balance")
        ]


class BottleReturn(models.Model):
    class ReturnStatus(models.TextChoices):
        PENDING = "PENDING", "Pending"
        GRADED = "GRADED", "Graded"
        PARTIALLY_ACCEPTED = "PARTIALLY_ACCEPTED", "Partially Accepted"
        ACCEPTED = "ACCEPTED", "Accepted"
        REJECTED = "REJECTED", "Rejected"

    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    return_number = models.CharField(max_length=120, unique=True)
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="bottle_returns", blank=True, null=True)
    order = models.ForeignKey(Order, on_delete=models.SET_NULL, blank=True, null=True, related_name="bottle_returns")
    trip = models.ForeignKey(Trip, on_delete=models.SET_NULL, blank=True, null=True, related_name="bottle_returns")
    drop_point = models.ForeignKey(TripDropPoint, on_delete=models.SET_NULL, blank=True, null=True, related_name="bottle_returns")
    status = models.CharField(max_length=30, choices=ReturnStatus.choices, default=ReturnStatus.PENDING)
    received_by = models.CharField(max_length=100, blank=True, null=True)
    received_at = models.DateTimeField(blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "BottleReturn"
        verbose_name = "Bottle Return"
        verbose_name_plural = "Bottle Returns"


class BottleReturnLine(models.Model):
    id = models.CharField(primary_key=True, max_length=25, default=generate_cuid, editable=False)
    bottle_return = models.ForeignKey(BottleReturn, on_delete=models.CASCADE, related_name="lines")
    container_type = models.ForeignKey(ContainerType, on_delete=models.PROTECT, related_name="return_lines")
    quantity_claimed = models.IntegerField()
    quantity_graded_reusable = models.IntegerField(default=0)
    quantity_graded_damaged = models.IntegerField(default=0)
    quantity_rejected = models.IntegerField(default=0)
    deposit_refund_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "BottleReturnLine"
        verbose_name = "Bottle Return Line"
        verbose_name_plural = "Bottle Return Lines"
