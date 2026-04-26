import json
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase
from django.utils import timezone

from .auth import create_token
from .models import (
    Customer,
    Driver,
    DriverSpareStock,
    DropPointType,
    Inventory,
    InventoryTransaction,
    LocationLog,
    Notification,
    Order,
    OrderItem,
    OrderLogistics,
    OrderTimeline,
    OrderStatus,
    Product,
    Replacement,
    Role,
    SavedRouteDraft,
    SpareStockTransaction,
    StockBatch,
    Trip,
    TripDropPoint,
    TripStatus,
    User,
    Vehicle,
    VehicleType,
    Warehouse,
    WarehouseStage,
)


class NotificationsApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.primary_user = User.objects.create(
            email="primary.admin@example.com",
            password="hashed",
            name="Primary Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.other_user = User.objects.create(
            email="other.admin@example.com",
            password="hashed",
            name="Other Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.primary_token = create_token(
            {
                "userId": self.primary_user.id,
                "email": self.primary_user.email,
                "name": self.primary_user.name,
                "role": self.admin_role.name,
                "type": "staff",
            }
        )

    def test_get_notifications_includes_unread_count_and_scopes_to_authenticated_user(self) -> None:
        Notification.objects.create(
            user=self.primary_user,
            title="Unread 1",
            message="Primary unread 1",
            type="order_update",
            is_read=False,
        )
        Notification.objects.create(
            user=self.primary_user,
            title="Unread 2",
            message="Primary unread 2",
            type="order_update",
            is_read=False,
        )
        Notification.objects.create(
            user=self.primary_user,
            title="Read 1",
            message="Primary read 1",
            type="order_update",
            is_read=True,
            read_at=timezone.now(),
        )
        Notification.objects.create(
            user=self.other_user,
            title="Other unread",
            message="Other unread",
            type="order_update",
            is_read=False,
        )

        response = self.client.get(
            "/api/notifications",
            HTTP_AUTHORIZATION=f"Bearer {self.primary_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["unreadCount"], 2)
        self.assertEqual(len(payload["notifications"]), 3)
        for item in payload["notifications"]:
            self.assertEqual(item["user"], self.primary_user.id)

    def test_patch_notifications_mark_all_marks_only_current_user_and_returns_unread_count(self) -> None:
        primary_unread_1 = Notification.objects.create(
            user=self.primary_user,
            title="Unread 1",
            message="Primary unread 1",
            type="order_update",
            is_read=False,
        )
        primary_unread_2 = Notification.objects.create(
            user=self.primary_user,
            title="Unread 2",
            message="Primary unread 2",
            type="order_update",
            is_read=False,
        )
        other_unread = Notification.objects.create(
            user=self.other_user,
            title="Other unread",
            message="Other unread",
            type="order_update",
            is_read=False,
        )

        response = self.client.patch(
            "/api/notifications",
            data='{"markAll": true}',
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.primary_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["updated"], 2)
        self.assertEqual(payload["unreadCount"], 0)

        primary_unread_1.refresh_from_db()
        primary_unread_2.refresh_from_db()
        other_unread.refresh_from_db()

        self.assertTrue(primary_unread_1.is_read)
        self.assertTrue(primary_unread_2.is_read)
        self.assertIsNotNone(primary_unread_1.read_at)
        self.assertIsNotNone(primary_unread_2.read_at)
        self.assertFalse(other_unread.is_read)

    def test_patch_notifications_by_ids_marks_selected_owned_records_only(self) -> None:
        target_1 = Notification.objects.create(
            user=self.primary_user,
            title="Target 1",
            message="Target 1",
            type="order_update",
            is_read=False,
        )
        target_2 = Notification.objects.create(
            user=self.primary_user,
            title="Target 2",
            message="Target 2",
            type="order_update",
            is_read=False,
        )
        untouched_same_user = Notification.objects.create(
            user=self.primary_user,
            title="Untouched",
            message="Untouched",
            type="order_update",
            is_read=False,
        )
        other_user_notification = Notification.objects.create(
            user=self.other_user,
            title="Other user",
            message="Other user",
            type="order_update",
            is_read=False,
        )

        response = self.client.patch(
            "/api/notifications",
            data=f'{{"ids": ["{target_1.id}", "{other_user_notification.id}", "{target_2.id}"]}}',
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.primary_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["updated"], 2)
        self.assertEqual(payload["unreadCount"], 1)

        target_1.refresh_from_db()
        target_2.refresh_from_db()
        untouched_same_user.refresh_from_db()
        other_user_notification.refresh_from_db()

        self.assertTrue(target_1.is_read)
        self.assertTrue(target_2.is_read)
        self.assertFalse(untouched_same_user.is_read)
        self.assertFalse(other_user_notification.is_read)

    def test_notifications_requires_authentication(self) -> None:
        response = self.client.get("/api/notifications")
        self.assertEqual(response.status_code, 401)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Unauthorized")

    def test_patch_notifications_requires_ids_when_mark_all_is_not_used(self) -> None:
        response = self.client.patch(
            "/api/notifications",
            data="{}",
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.primary_token}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "ids is required")

    def test_patch_notifications_mark_all_takes_precedence_over_ids(self) -> None:
        n1 = Notification.objects.create(
            user=self.primary_user,
            title="N1",
            message="N1",
            type="order_update",
            is_read=False,
        )
        n2 = Notification.objects.create(
            user=self.primary_user,
            title="N2",
            message="N2",
            type="order_update",
            is_read=False,
        )

        response = self.client.patch(
            "/api/notifications",
            data=f'{{"markAll": true, "ids": ["{n1.id}"]}}',
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.primary_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["updated"], 2)
        self.assertEqual(payload["unreadCount"], 0)

        n1.refresh_from_db()
        n2.refresh_from_db()
        self.assertTrue(n1.is_read)
        self.assertTrue(n2.is_read)


class CustomerTrackingApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.driver_user = User.objects.create(
            email="driver.contract@example.com",
            password="hashed",
            name="Driver Contract",
            role=self.driver_role,
            is_active=True,
        )
        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="LIC-CONTRACT-001",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            phone="+1-555-0101",
            is_active=True,
        )
        self.vehicle = Vehicle.objects.create(
            license_plate="TEST-TRACK-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )

        self.customer = Customer.objects.create(
            email="customer.contract@example.com",
            password="hashed",
            name="Customer Contract",
            is_active=True,
        )
        self.other_customer = Customer.objects.create(
            email="other.customer.contract@example.com",
            password="hashed",
            name="Other Customer Contract",
            is_active=True,
        )

        self.customer_token = create_token(
            {
                "userId": self.customer.id,
                "email": self.customer.email,
                "name": self.customer.name,
                "role": "CUSTOMER",
                "type": "customer",
            }
        )

    def test_customer_tracking_returns_status_and_order_status_for_compatibility(self) -> None:
        order = Order.objects.create(
            order_number="ORD-CONTRACT-001",
            customer=self.customer,
            status=OrderStatus.OUT_FOR_DELIVERY,
            subtotal=100,
            total_amount=110,
        )
        Order.objects.create(
            order_number="ORD-CONTRACT-OTHER-001",
            customer=self.other_customer,
            status=OrderStatus.PREPARING,
            subtotal=80,
            total_amount=85,
        )

        trip = Trip.objects.create(
            trip_number="TRIP-CONTRACT-001",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.IN_PROGRESS,
        )
        TripDropPoint.objects.create(
            trip=trip,
            order=order,
            drop_point_type=DropPointType.DELIVERY,
            sequence=1,
            location_name="Customer Address",
            address="123 Main St",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
        )

        response = self.client.get(
            "/api/customer/tracking",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(len(payload["tracking"]), 1)

        item = payload["tracking"][0]
        self.assertEqual(item["orderId"], order.id)
        self.assertEqual(item["status"], OrderStatus.OUT_FOR_DELIVERY)
        self.assertEqual(item["orderStatus"], OrderStatus.OUT_FOR_DELIVERY)
        self.assertIn("trip", item)
        self.assertIsNotNone(item["trip"])


class CustomerOrdersApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.customer = Customer.objects.create(
            email="orders.customer@example.com",
            password="hashed",
            name="Orders Customer",
            is_active=True,
        )
        self.other_customer = Customer.objects.create(
            email="orders.other@example.com",
            password="hashed",
            name="Orders Other Customer",
            is_active=True,
        )
        self.customer_token = create_token(
            {
                "userId": self.customer.id,
                "email": self.customer.email,
                "name": self.customer.name,
                "role": "CUSTOMER",
                "type": "customer",
            }
        )
        self.staff_role = Role.objects.create(name="ADMIN", description="Admin")
        self.staff_user = User.objects.create(
            email="orders.staff@example.com",
            password="hashed",
            name="Orders Staff",
            role=self.staff_role,
            is_active=True,
        )
        self.staff_token = create_token(
            {
                "userId": self.staff_user.id,
                "email": self.staff_user.email,
                "name": self.staff_user.name,
                "role": self.staff_role.name,
                "type": "staff",
            }
        )

    def test_customer_orders_returns_only_authenticated_customer_orders_and_shape(self) -> None:
        own_order = Order.objects.create(
            order_number="ORD-CUST-001",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=500,
            total_amount=550,
        )
        Order.objects.create(
            order_number="ORD-CUST-OTHER-001",
            customer=self.other_customer,
            status=OrderStatus.CONFIRMED,
            subtotal=300,
            total_amount=330,
        )

        response = self.client.get(
            "/api/customer/orders",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["total"], 1)
        self.assertEqual(len(payload["orders"]), 1)
        order_row = payload["orders"][0]
        self.assertEqual(order_row["id"], own_order.id)
        self.assertEqual(order_row["orderNumber"], own_order.order_number)
        self.assertEqual(order_row["customer"]["id"], self.customer.id)
        self.assertIn("items", order_row)
        self.assertIn("logistics", order_row)
        self.assertIn("timeline", order_row)

    def test_customer_orders_rejects_non_customer_tokens(self) -> None:
        response = self.client.get(
            "/api/customer/orders",
            HTTP_AUTHORIZATION=f"Bearer {self.staff_token}",
        )

        self.assertEqual(response.status_code, 401)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Unauthorized")

    def test_customer_cannot_cancel_preparing_order(self) -> None:
        order = Order.objects.create(
            order_number="ORD-CANCEL-PREPARING-001",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=100,
            total_amount=110,
        )

        response = self.client.patch(
            f"/api/customer/orders/{order.id}/cancel",
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Order cannot be cancelled")

        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.PREPARING)

    def test_customer_order_create_defaults_to_pending(self) -> None:
        warehouse = Warehouse.objects.create(
            name="Pending Warehouse",
            code="WH-PENDING-001",
            address="Warehouse Road",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            is_active=True,
        )
        product = Product.objects.create(
            sku="SKU-PENDING-001",
            name="Pending Product",
            unit="piece",
            price=25,
        )
        inventory = Inventory.objects.create(
            warehouse=warehouse,
            product=product,
            quantity=10,
            reserved_quantity=0,
            min_stock=1,
            max_stock=20,
            reorder_point=2,
        )
        StockBatch.objects.create(
            batch_number="BATCH-PENDING-001",
            inventory=inventory,
            quantity=10,
            receipt_date=timezone.now(),
            status="ACTIVE",
        )

        response = self.client.post(
            "/api/customer/orders",
            data={
                "warehouseId": warehouse.id,
                "items": [
                    {
                        "productId": product.id,
                        "quantity": 2,
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["order"]["status"], OrderStatus.PENDING)


class DriverTripsApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")

        self.driver_user = User.objects.create(
            email="driver.trips@example.com",
            password="hashed",
            name="Driver Trips",
            role=self.driver_role,
            is_active=True,
        )
        self.other_driver_user = User.objects.create(
            email="driver.trips.other@example.com",
            password="hashed",
            name="Driver Trips Other",
            role=self.driver_role,
            is_active=True,
        )
        self.admin_user = User.objects.create(
            email="driver.trips.admin@example.com",
            password="hashed",
            name="Driver Trips Admin",
            role=self.admin_role,
            is_active=True,
        )

        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="LIC-TRIPS-001",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.other_driver = Driver.objects.create(
            user=self.other_driver_user,
            license_number="LIC-TRIPS-002",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )

        self.vehicle = Vehicle.objects.create(
            license_plate="TRIPS-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )
        self.other_vehicle = Vehicle.objects.create(
            license_plate="TRIPS-002",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )

        self.driver_token = create_token(
            {
                "userId": self.driver_user.id,
                "email": self.driver_user.email,
                "name": self.driver_user.name,
                "role": "DRIVER",
                "type": "staff",
            }
        )
        self.admin_token = create_token(
            {
                "userId": self.admin_user.id,
                "email": self.admin_user.email,
                "name": self.admin_user.name,
                "role": "ADMIN",
                "type": "staff",
            }
        )

    def test_driver_trips_returns_only_authenticated_driver_trips_with_latest_location(self) -> None:
        own_trip = Trip.objects.create(
            trip_number="TRP-DRIVER-001",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.IN_PROGRESS,
        )
        Trip.objects.create(
            trip_number="TRP-DRIVER-OTHER-001",
            driver=self.other_driver,
            vehicle=self.other_vehicle,
            status=TripStatus.PLANNED,
        )

        LocationLog.objects.create(
            driver=self.driver,
            trip=own_trip,
            latitude=10.1001,
            longitude=123.9001,
            recorded_at=timezone.now() - timedelta(minutes=3),
        )
        latest_log = LocationLog.objects.create(
            driver=self.driver,
            trip=own_trip,
            latitude=10.2002,
            longitude=123.8002,
            recorded_at=timezone.now(),
        )

        response = self.client.get(
            "/api/driver/trips",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(len(payload["trips"]), 1)

        row = payload["trips"][0]
        self.assertEqual(row["id"], own_trip.id)
        self.assertEqual(row["tripNumber"], own_trip.trip_number)
        self.assertIn("dropPoints", row)
        self.assertIn("driver", row)
        self.assertIn("vehicle", row)
        self.assertIsNotNone(row["latestLocation"])
        self.assertEqual(row["latestLocation"]["latitude"], float(latest_log.latitude))
        self.assertEqual(row["latestLocation"]["longitude"], float(latest_log.longitude))

    def test_driver_trips_forbidden_for_non_driver_staff(self) -> None:
        response = self.client.get(
            "/api/driver/trips",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 403)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Forbidden")


class CustomerOrdersPostApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.customer = Customer.objects.create(
            email="post.customer@example.com",
            password="hashed",
            name="Post Customer",
            phone="+1-555-1000",
            address="123 Test Ave",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            is_active=True,
        )
        self.other_customer = Customer.objects.create(
            email="post.other.customer@example.com",
            password="hashed",
            name="Post Other Customer",
            is_active=True,
        )
        self.customer_token = create_token(
            {
                "userId": self.customer.id,
                "email": self.customer.email,
                "name": self.customer.name,
                "role": "CUSTOMER",
                "type": "customer",
            }
        )

        self.warehouse = Warehouse.objects.create(
            name="Main Warehouse",
            code="WH-POST-001",
            address="Warehouse Road",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            is_active=True,
        )
        self.product = Product.objects.create(
            sku="SKU-POST-001",
            name="Mineral Water",
            unit="case",
            price=120,
            is_active=True,
        )
        self.inventory = Inventory.objects.create(
            warehouse=self.warehouse,
            product=self.product,
            quantity=20,
            reserved_quantity=0,
            min_stock=2,
            max_stock=100,
            reorder_point=5,
        )
        StockBatch.objects.create(
            batch_number="BATCH-POST-001",
            inventory=self.inventory,
            quantity=20,
            receipt_date=timezone.now(),
            status="ACTIVE",
        )

    def test_customer_orders_post_creates_order_for_authenticated_customer_and_reserves_inventory(self) -> None:
        response = self.client.post(
            "/api/customer/orders",
            data={
                "customerId": self.other_customer.id,
                "warehouseId": self.warehouse.id,
                "paymentMethod": "COD",
                "shippingAddress": "Overridden Shipping Address",
                "items": [
                    {
                        "productId": self.product.id,
                        "quantity": 2,
                        "unitPrice": 120,
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertIn("order", payload)

        order_row = payload["order"]
        self.assertEqual(order_row["customer"]["id"], self.customer.id)
        self.assertEqual(order_row["warehouseId"], self.warehouse.id)
        self.assertEqual(len(order_row["items"]), 1)
        self.assertEqual(order_row["items"][0]["product"]["id"], self.product.id)
        self.assertEqual(order_row["items"][0]["quantity"], 2)

        created_order = Order.objects.get(id=order_row["id"])
        self.assertEqual(created_order.customer_id, self.customer.id)

        self.inventory.refresh_from_db()
        self.assertEqual(self.inventory.quantity, 20)
        self.assertEqual(self.inventory.reserved_quantity, 2)

        reserve_count = InventoryTransaction.objects.filter(
            reference_type="order_item_reserve",
            type="RESERVE",
        ).count()
        self.assertEqual(reserve_count, 1)

    def test_customer_orders_post_requires_items(self) -> None:
        response = self.client.post(
            "/api/customer/orders",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "items are required")

    def test_customer_orders_post_auto_assigns_nearest_fulfillable_warehouse_when_not_provided(self) -> None:
        near_warehouse = Warehouse.objects.create(
            name="Near Warehouse",
            code="WH-POST-NEAR-001",
            address="Near Road",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            latitude=10.3150,
            longitude=123.8854,
            is_active=True,
        )
        far_warehouse = Warehouse.objects.create(
            name="Far Warehouse",
            code="WH-POST-FAR-001",
            address="Far Road",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            latitude=10.1200,
            longitude=123.7000,
            is_active=True,
        )

        near_inventory = Inventory.objects.create(
            warehouse=near_warehouse,
            product=self.product,
            quantity=20,
            reserved_quantity=0,
            min_stock=2,
            max_stock=100,
            reorder_point=5,
        )
        far_inventory = Inventory.objects.create(
            warehouse=far_warehouse,
            product=self.product,
            quantity=20,
            reserved_quantity=0,
            min_stock=2,
            max_stock=100,
            reorder_point=5,
        )
        StockBatch.objects.create(
            batch_number="BATCH-POST-NEAR-001",
            inventory=near_inventory,
            quantity=20,
            receipt_date=timezone.now(),
            status="ACTIVE",
        )
        StockBatch.objects.create(
            batch_number="BATCH-POST-FAR-001",
            inventory=far_inventory,
            quantity=20,
            receipt_date=timezone.now(),
            status="ACTIVE",
        )

        response = self.client.post(
            "/api/customer/orders",
            data={
                "shippingLatitude": 10.3140,
                "shippingLongitude": 123.8860,
                "items": [
                    {
                        "productId": self.product.id,
                        "quantity": 2,
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["order"]["warehouseId"], near_warehouse.id)

    def test_customer_orders_post_leaves_warehouse_unassigned_when_no_single_warehouse_can_fulfill(self) -> None:
        product_two = Product.objects.create(
            sku="SKU-POST-002",
            name="Sparkling Water",
            unit="case",
            price=140,
            is_active=True,
        )

        warehouse_two = Warehouse.objects.create(
            name="Secondary Warehouse",
            code="WH-POST-002",
            address="Secondary Road",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            is_active=True,
        )

        self.inventory.quantity = 5
        self.inventory.reserved_quantity = 0
        self.inventory.save(update_fields=["quantity", "reserved_quantity", "updated_at"])

        inventory_two = Inventory.objects.create(
            warehouse=warehouse_two,
            product=product_two,
            quantity=5,
            reserved_quantity=0,
            min_stock=1,
            max_stock=50,
            reorder_point=2,
        )
        StockBatch.objects.create(
            batch_number="BATCH-POST-002",
            inventory=inventory_two,
            quantity=5,
            receipt_date=timezone.now(),
            status="ACTIVE",
        )

        response = self.client.post(
            "/api/customer/orders",
            data={
                "items": [
                    {
                        "productId": self.product.id,
                        "quantity": 2,
                    },
                    {
                        "productId": product_two.id,
                        "quantity": 2,
                    },
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertIsNone(payload["order"]["warehouseId"])


class DriverProfileApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")

        self.driver_user = User.objects.create(
            email="profile.driver@example.com",
            password="hashed",
            name="Profile Driver",
            phone="+1-555-2222",
            role=self.driver_role,
            is_active=True,
        )
        self.admin_user = User.objects.create(
            email="profile.admin@example.com",
            password="hashed",
            name="Profile Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="LIC-PROFILE-001",
            license_type="C",
            license_expiry=timezone.now() + timedelta(days=365),
            phone="+1-555-3333",
            emergency_contact="Old Contact",
            is_active=True,
        )

        self.driver_token = create_token(
            {
                "userId": self.driver_user.id,
                "email": self.driver_user.email,
                "name": self.driver_user.name,
                "role": "DRIVER",
                "type": "staff",
            }
        )
        self.admin_token = create_token(
            {
                "userId": self.admin_user.id,
                "email": self.admin_user.email,
                "name": self.admin_user.name,
                "role": "ADMIN",
                "type": "staff",
            }
        )

    def test_driver_profile_get_returns_driver_and_user_shape(self) -> None:
        response = self.client.get(
            "/api/driver/profile",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertIn("driver", payload)
        self.assertEqual(payload["driver"]["id"], self.driver.id)
        self.assertEqual(payload["driver"]["user"]["id"], self.driver_user.id)
        self.assertEqual(payload["driver"]["user"]["email"], self.driver_user.email)

    def test_driver_profile_put_updates_driver_and_user_fields(self) -> None:
        response = self.client.put(
            "/api/driver/profile",
            data={
                "name": "Updated Driver Name",
                "phone": "+1-555-4444",
                "avatar": "/uploads/avatars/new.png",
                "emergencyContact": "Updated Emergency Contact",
                "licenseNumber": "LIC-PROFILE-UPDATED",
                "licenseType": "B",
                "licensePhoto": "/uploads/license/new.jpg",
                "licenseExpiry": "2030-01-15T10:00:00Z",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["driver"]["user"]["name"], "Updated Driver Name")
        self.assertEqual(payload["driver"]["user"]["phone"], "+1-555-4444")
        self.assertEqual(payload["driver"]["licenseNumber"], "LIC-PROFILE-UPDATED")
        self.assertEqual(payload["driver"]["licenseType"], "B")
        self.assertEqual(payload["driver"]["licensePhoto"], "/uploads/license/new.jpg")

        self.driver.refresh_from_db()
        self.driver_user.refresh_from_db()
        self.assertEqual(self.driver.emergency_contact, "Updated Emergency Contact")
        self.assertEqual(self.driver.license_number, "LIC-PROFILE-UPDATED")
        self.assertEqual(self.driver.license_type, "B")
        self.assertEqual(self.driver_user.name, "Updated Driver Name")
        self.assertEqual(self.driver_user.phone, "+1-555-4444")
        self.assertEqual(self.driver_user.avatar, "/uploads/avatars/new.png")
        self.assertEqual(self.driver.license_expiry.year, 2030)

    def test_driver_profile_forbidden_for_non_driver_staff(self) -> None:
        response = self.client.get(
            "/api/driver/profile",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 403)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Forbidden")


class OrderStatusTransitionApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.admin_user = User.objects.create(
            email="status.admin@example.com",
            password="hashed",
            name="Status Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.admin_token = create_token(
            {
                "userId": self.admin_user.id,
                "email": self.admin_user.email,
                "name": self.admin_user.name,
                "role": self.admin_role.name,
                "type": "staff",
            }
        )
        self.customer = Customer.objects.create(
            email="status.customer@example.com",
            password="hashed",
            name="Status Customer",
            is_active=True,
        )

    def _create_order(self, **overrides):
        base = {
            "order_number": f"ORD-STATUS-{Order.objects.count() + 1:03d}",
            "customer": self.customer,
            "status": OrderStatus.PREPARING,
            "subtotal": 100,
            "total_amount": 110,
        }
        base.update(overrides)
        return Order.objects.create(**base)

    def _patch_status(self, order_id: str, payload: dict):
        return self.client.patch(
            f"/api/orders/{order_id}/status",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

    def test_order_status_update_requires_status(self) -> None:
        order = self._create_order()

        response = self._patch_status(order.id, {})
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "status is required")

    def test_dispatched_status_is_automatic_when_trip_starts(self) -> None:
        order = self._create_order(
            warehouse_stage=WarehouseStage.READY_TO_LOAD,
            checklist_items_verified=True,
            checklist_quantity_verified=True,
            checklist_packaging_verified=True,
            checklist_spare_products_verified=True,
            checklist_vehicle_assigned=True,
            checklist_driver_assigned=True,
            dispatch_signed_off_by="Warehouse Lead",
            dispatch_signed_off_at=timezone.now(),
        )

        response = self._patch_status(order.id, {"status": "DISPATCHED"})
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "OUT_FOR_DELIVERY is set automatically when the trip starts")

    def test_out_for_delivery_status_is_automatic_when_trip_starts(self) -> None:
        order = self._create_order(status=OrderStatus.PREPARING)

        response = self._patch_status(order.id, {"status": "OUT_FOR_DELIVERY"})
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "OUT_FOR_DELIVERY is set automatically when the trip starts")


class OrderWarehouseStageTransitionApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.admin_user = User.objects.create(
            email="stage.admin@example.com",
            password="hashed",
            name="Stage Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.driver_user = User.objects.create(
            email="stage.driver@example.com",
            password="hashed",
            name="Stage Driver",
            role=self.driver_role,
            is_active=True,
        )
        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="LIC-STAGE-001",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.vehicle = Vehicle.objects.create(
            license_plate="STAGE-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )
        self.admin_token = create_token(
            {
                "userId": self.admin_user.id,
                "email": self.admin_user.email,
                "name": self.admin_user.name,
                "role": self.admin_role.name,
                "type": "staff",
            }
        )
        self.driver_token = create_token(
            {
                "userId": self.driver_user.id,
                "email": self.driver_user.email,
                "name": self.driver_user.name,
                "role": self.driver_role.name,
                "type": "staff",
            }
        )
        self.customer = Customer.objects.create(
            email="stage.customer@example.com",
            password="hashed",
            name="Stage Customer",
            is_active=True,
        )

    def _create_order(self, **overrides):
        base = {
            "order_number": f"ORD-STAGE-{Order.objects.count() + 1:03d}",
            "customer": self.customer,
            "status": OrderStatus.PREPARING,
            "warehouse_stage": WarehouseStage.READY_TO_LOAD,
            "subtotal": 100,
            "total_amount": 110,
        }
        base.update(overrides)
        return Order.objects.create(**base)

    def _assign_order_to_driver(self, order: Order) -> Trip:
        trip = Trip.objects.create(
            trip_number=f"TRP-STAGE-{Trip.objects.count() + 1:03d}",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.PLANNED,
            total_drop_points=1,
        )
        TripDropPoint.objects.create(
            trip=trip,
            order=order,
            sequence=1,
            location_name=order.order_number,
            address="Stage Address",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            drop_point_type=DropPointType.DELIVERY,
        )
        return trip

    def _patch_stage(self, order_id: str, payload: dict):
        return self.client.patch(
            f"/api/orders/{order_id}/warehouse-stage",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

    def test_warehouse_stage_requires_valid_value(self) -> None:
        order = self._create_order()
        response = self._patch_stage(order.id, {"warehouseStage": "INVALID"})

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "warehouseStage is required and must be READY_TO_LOAD, LOADED, or DISPATCHED")

    def test_warehouse_stage_cannot_move_backward(self) -> None:
        order = self._create_order(warehouse_stage=WarehouseStage.LOADED)
        response = self._patch_stage(order.id, {"warehouseStage": "READY_TO_LOAD"})

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Warehouse stage cannot move backward")

    def test_loaded_requires_completed_checklist(self) -> None:
        order = self._create_order()
        response = self._patch_stage(order.id, {"warehouseStage": "LOADED"})

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Order must be assigned to a driver before LOADED")

    def test_loaded_requires_driver_assignment(self) -> None:
        order = self._create_order()
        response = self._patch_stage(
            order.id,
            {
                "warehouseStage": "LOADED",
                "checklist": {
                    "itemsVerified": True,
                    "quantityVerified": True,
                    "packagingVerified": True,
                    "spareProductsVerified": True,
                    "vehicleAssigned": True,
                    "driverAssigned": True,
                },
            },
        )

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Order must be assigned to a driver before LOADED")

    def test_loaded_requires_completed_checklist_when_driver_is_assigned(self) -> None:
        order = self._create_order()
        self._assign_order_to_driver(order)
        response = self._patch_stage(order.id, {"warehouseStage": "LOADED"})

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Checklist must be completed before LOADED")

    def test_loaded_stage_keeps_order_status_preparing(self) -> None:
        order = self._create_order(status=OrderStatus.PREPARING)
        self._assign_order_to_driver(order)
        response = self._patch_stage(
            order.id,
            {
                "warehouseStage": "LOADED",
                "checklist": {
                    "itemsVerified": True,
                    "quantityVerified": True,
                    "packagingVerified": True,
                    "spareProductsVerified": True,
                    "vehicleAssigned": True,
                    "driverAssigned": True,
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["order"]["warehouseStage"], WarehouseStage.LOADED)
        self.assertEqual(payload["order"]["status"], OrderStatus.PREPARING)

        order.refresh_from_db()
        self.assertEqual(order.warehouse_stage, WarehouseStage.LOADED)
        self.assertEqual(order.status, OrderStatus.PREPARING)
        self.assertIsNotNone(order.loaded_at)

    def test_loaded_stage_auto_allocates_spare_products_for_driver(self) -> None:
        order = self._create_order(status=OrderStatus.PREPARING)
        product = Product.objects.create(
            sku="SKU-STAGE-SPARE-CASE-001",
            name="Stage Spare Case",
            unit="case",
            price=25,
        )
        order_item = OrderItem.objects.create(
            order=order,
            product=product,
            quantity=25,
            unit_price=25,
            total_price=625,
        )
        self._assign_order_to_driver(order)

        response = self._patch_stage(
            order.id,
            {
                "warehouseStage": "LOADED",
                "checklist": {
                    "itemsVerified": True,
                    "quantityVerified": True,
                    "packagingVerified": True,
                    "spareProductsVerified": True,
                    "vehicleAssigned": True,
                    "driverAssigned": True,
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        order.refresh_from_db()
        self.assertTrue(order.checklist_spare_products_verified)

        spare_products = DriverSpareStock.objects.get(driver=self.driver, product=product)
        self.assertEqual(spare_products.quantity, 3)
        self.assertEqual(spare_products.min_quantity, 3)

        transaction = SpareStockTransaction.objects.get(
            driver=self.driver,
            product=product,
            reference_type="order_spare_products_auto_load",
            reference_id=order_item.id,
        )
        self.assertEqual(transaction.quantity, 3)

    def test_driver_trips_includes_spare_product_policy_per_item(self) -> None:
        order = self._create_order(status=OrderStatus.PREPARING)
        product = Product.objects.create(
            sku="SKU-STAGE-SPARE-PACK-001",
            name="Stage Spare Pack",
            unit="pack(bundle)",
            price=12,
        )
        OrderItem.objects.create(
            order=order,
            product=product,
            quantity=100,
            unit_price=12,
            total_price=1200,
        )
        self._assign_order_to_driver(order)

        response = self.client.get(
            "/api/driver/trips",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        trip_order = payload["trips"][0]["dropPoints"][0]["order"]
        self.assertIn("items", trip_order)
        self.assertEqual(trip_order["items"][0]["spareProducts"]["minPercent"], 3)
        self.assertEqual(trip_order["items"][0]["spareProducts"]["maxPercent"], 5)
        self.assertEqual(trip_order["items"][0]["spareProducts"]["recommendedPercent"], 4)
        self.assertEqual(trip_order["items"][0]["spareProducts"]["recommendedQuantity"], 4)

    def test_dispatched_stage_is_automatic_when_trip_starts(self) -> None:
        order = self._create_order(warehouse_stage=WarehouseStage.LOADED)
        response = self._patch_stage(order.id, {"warehouseStage": "DISPATCHED"})

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "DISPATCHED is set automatically when the trip starts")


class TripExecutionApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")

        self.driver_user = User.objects.create(
            email="trip.exec.driver@example.com",
            password="hashed",
            name="Trip Exec Driver",
            role=self.driver_role,
            is_active=True,
        )
        self.other_driver_user = User.objects.create(
            email="trip.exec.driver.other@example.com",
            password="hashed",
            name="Trip Exec Driver Other",
            role=self.driver_role,
            is_active=True,
        )
        self.admin_user = User.objects.create(
            email="trip.exec.admin@example.com",
            password="hashed",
            name="Trip Exec Admin",
            role=self.admin_role,
            is_active=True,
        )

        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="LIC-EXEC-001",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.other_driver = Driver.objects.create(
            user=self.other_driver_user,
            license_number="LIC-EXEC-002",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )

        self.customer = Customer.objects.create(
            email="trip.exec.customer@example.com",
            password="hashed",
            name="Trip Exec Customer",
            is_active=True,
        )

        self.vehicle = Vehicle.objects.create(
            license_plate="EXEC-TRIP-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )
        self.other_vehicle = Vehicle.objects.create(
            license_plate="EXEC-TRIP-002",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )

        self.driver_token = create_token(
            {
                "userId": self.driver_user.id,
                "email": self.driver_user.email,
                "name": self.driver_user.name,
                "role": "DRIVER",
                "type": "staff",
            }
        )
        self.other_driver_token = create_token(
            {
                "userId": self.other_driver_user.id,
                "email": self.other_driver_user.email,
                "name": self.other_driver_user.name,
                "role": "DRIVER",
                "type": "staff",
            }
        )
        self.admin_token = create_token(
            {
                "userId": self.admin_user.id,
                "email": self.admin_user.email,
                "name": self.admin_user.name,
                "role": "ADMIN",
                "type": "staff",
            }
        )
        self.customer_token = create_token(
            {
                "userId": self.customer.id,
                "email": self.customer.email,
                "name": self.customer.name,
                "role": "CUSTOMER",
                "type": "customer",
            }
        )

        self.trip = Trip.objects.create(
            trip_number="TRP-EXEC-001",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.PLANNED,
            total_drop_points=2,
        )
        self.other_trip = Trip.objects.create(
            trip_number="TRP-EXEC-002",
            driver=self.other_driver,
            vehicle=self.other_vehicle,
            status=TripStatus.PLANNED,
            total_drop_points=1,
        )

        self.dp_1 = TripDropPoint.objects.create(
            trip=self.trip,
            sequence=1,
            location_name="Stop 1",
            address="Address 1",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            drop_point_type=DropPointType.DELIVERY,
        )
        self.dp_2 = TripDropPoint.objects.create(
            trip=self.trip,
            sequence=2,
            location_name="Stop 2",
            address="Address 2",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            drop_point_type=DropPointType.DELIVERY,
        )
        self.other_dp = TripDropPoint.objects.create(
            trip=self.other_trip,
            sequence=1,
            location_name="Other Stop",
            address="Other Address",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            drop_point_type=DropPointType.DELIVERY,
        )

    def test_trip_start_requires_staff_authentication(self) -> None:
        response = self.client.post(f"/api/trips/{self.trip.id}/start")
        self.assertEqual(response.status_code, 401)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Unauthorized")

    def test_trip_start_rejects_missing_trip(self) -> None:
        response = self.client.post(
            "/api/trips/missing-trip-id/start",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response.status_code, 404)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Trip not found")

    def test_trip_start_forbidden_for_customer_token(self) -> None:
        response = self.client.post(
            f"/api/trips/{self.trip.id}/start",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(response.status_code, 403)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Forbidden")

    def test_trip_start_forbidden_for_other_driver(self) -> None:
        response = self.client.post(
            f"/api/trips/{self.trip.id}/start",
            HTTP_AUTHORIZATION=f"Bearer {self.other_driver_token}",
        )
        self.assertEqual(response.status_code, 403)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Forbidden")

    def test_trip_start_rejects_orders_that_are_not_loaded(self) -> None:
        order = Order.objects.create(
            order_number="ORD-TRIP-NOT-LOADED-001",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            warehouse_stage=WarehouseStage.READY_TO_LOAD,
            subtotal=100,
            total_amount=110,
        )
        self.dp_1.order = order
        self.dp_1.save(update_fields=["order", "updated_at"])

        response = self.client.post(
            f"/api/trips/{self.trip.id}/start",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertIn("Orders not loaded yet", payload["error"])
        self.assertIn(order.order_number, payload["error"])

    def test_trip_start_sets_in_progress_and_actual_start_at(self) -> None:
        order = Order.objects.create(
            order_number="ORD-TRIP-LOADED-001",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            warehouse_stage=WarehouseStage.LOADED,
            subtotal=100,
            total_amount=110,
            checklist_items_verified=True,
            checklist_quantity_verified=True,
            checklist_packaging_verified=True,
            checklist_spare_products_verified=True,
            checklist_vehicle_assigned=True,
            checklist_driver_assigned=True,
        )
        self.dp_1.order = order
        self.dp_1.save(update_fields=["order", "updated_at"])

        response = self.client.post(
            f"/api/trips/{self.trip.id}/start",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["trip"]["status"], TripStatus.IN_PROGRESS)
        self.assertIsNotNone(payload["trip"]["actualStartAt"])

        self.trip.refresh_from_db()
        self.assertEqual(self.trip.status, TripStatus.IN_PROGRESS)
        self.assertIsNotNone(self.trip.actual_start_at)
        order.refresh_from_db()
        self.assertEqual(order.warehouse_stage, WarehouseStage.DISPATCHED)
        self.assertEqual(order.status, OrderStatus.OUT_FOR_DELIVERY)
        self.assertIsNotNone(order.warehouse_dispatched_at)

    def test_drop_point_update_requires_staff_auth(self) -> None:
        response = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={"status": "ARRIVED"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Unauthorized")

    def test_drop_point_update_forbidden_for_customer_token(self) -> None:
        response = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={"status": "ARRIVED"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(response.status_code, 403)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Forbidden")

    def test_drop_point_update_forbidden_for_other_driver(self) -> None:
        response = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={"status": "ARRIVED"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.other_driver_token}",
        )
        self.assertEqual(response.status_code, 403)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Forbidden")

    def test_drop_point_arrived_sets_actual_arrival(self) -> None:
        response = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={"status": "ARRIVED"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["dropPoint"]["status"], "ARRIVED")
        self.assertIsNotNone(payload["dropPoint"]["actualArrival"])

        self.dp_1.refresh_from_db()
        self.assertEqual(self.dp_1.status, "ARRIVED")
        self.assertIsNotNone(self.dp_1.actual_arrival)

    def test_drop_point_completion_updates_trip_completion_fields(self) -> None:
        response_first = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={"status": "COMPLETED"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response_first.status_code, 200)
        self.trip.refresh_from_db()
        self.assertEqual(self.trip.completed_drop_points, 1)
        self.assertEqual(self.trip.status, TripStatus.PLANNED)

        response_second = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_2.id}",
            data={"status": "COMPLETED"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response_second.status_code, 200)
        payload_second = response_second.json()
        self.assertTrue(payload_second["success"])
        self.assertEqual(payload_second["dropPoint"]["status"], "COMPLETED")
        self.assertIsNotNone(payload_second["dropPoint"]["actualDeparture"])

        self.trip.refresh_from_db()
        self.assertEqual(self.trip.completed_drop_points, 2)
        self.assertEqual(self.trip.status, TripStatus.COMPLETED)
        self.assertIsNotNone(self.trip.actual_end_at)

    def test_trip_completes_when_remaining_drop_point_is_skipped(self) -> None:
        response_first = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={"status": "COMPLETED"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response_first.status_code, 200)

        response_second = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_2.id}",
            data={"status": "SKIPPED", "notes": "Customer unavailable"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response_second.status_code, 200)

        self.trip.refresh_from_db()
        self.assertEqual(self.trip.completed_drop_points, 2)
        self.assertEqual(self.trip.status, TripStatus.COMPLETED)
        self.assertIsNotNone(self.trip.actual_end_at)

    def test_drop_point_failed_reschedule_today_moves_stop_to_route_end(self) -> None:
        response = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={
                "status": "FAILED",
                "notes": "Customer asked for later today",
                "releaseInventory": False,
                "rescheduleRequested": True,
                "rescheduleWindow": "today",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["dropPoint"]["status"], "PENDING")
        self.assertEqual(payload["dropPoint"]["sequence"], 2)
        self.assertFalse(payload.get("requeuedToRoutePool"))

        self.dp_1.refresh_from_db()
        self.dp_2.refresh_from_db()
        self.trip.refresh_from_db()

        self.assertEqual(self.dp_1.status, "PENDING")
        self.assertEqual(self.dp_1.sequence, 2)
        self.assertEqual(self.dp_2.sequence, 1)
        self.assertEqual(self.trip.completed_drop_points, 0)
        self.assertEqual(self.trip.status, TripStatus.PLANNED)

    def test_drop_point_failed_reschedule_other_date_requeues_order_to_route_pool(self) -> None:
        warehouse = Warehouse.objects.create(
            name="Other Date Warehouse",
            code="WH-OTHER-DATE-001",
            address="Warehouse Address",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            country="Philippines",
        )
        product = Product.objects.create(
            sku="SKU-OTHER-DATE-001",
            name="Other Date Product",
            unit="piece",
            price=20,
        )
        Inventory.objects.create(
            warehouse=warehouse,
            product=product,
            quantity=10,
            reserved_quantity=1,
            min_stock=0,
            max_stock=100,
            reorder_point=0,
        )
        order = Order.objects.create(
            order_number="ORD-OTHER-DATE-001",
            customer=self.customer,
            status=OrderStatus.OUT_FOR_DELIVERY,
            subtotal=20,
            total_amount=20,
            warehouse_id=warehouse.id,
            warehouse_stage=WarehouseStage.DISPATCHED,
            ready_to_load_at=timezone.now() - timedelta(days=1),
            loaded_at=timezone.now() - timedelta(hours=8),
            warehouse_dispatched_at=timezone.now() - timedelta(hours=2),
        )
        OrderTimeline.objects.create(order=order, delivery_date=timezone.now())
        order_item = OrderItem.objects.create(
            order=order,
            product=product,
            quantity=1,
            unit_price=20,
            total_price=20,
        )
        InventoryTransaction.objects.create(
            warehouse=warehouse,
            product=product,
            type="RESERVE",
            quantity=1,
            reference_type="order_item_reserve",
            reference_id=order_item.id,
            notes="Initial reservation for other date",
            performed_by=self.admin_user.id,
        )
        self.dp_1.order = order
        self.dp_1.save(update_fields=["order", "updated_at"])

        target_date = (timezone.now() + timedelta(days=3)).date().isoformat()
        response = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={
                "status": "FAILED",
                "notes": "Reschedule on custom date",
                "releaseInventory": False,
                "rescheduleRequested": True,
                "rescheduleWindow": "other_date",
                "rescheduleDate": target_date,
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertTrue(payload.get("requeuedToRoutePool"))
        self.assertEqual(payload["dropPoint"]["status"], "FAILED")

        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.PREPARING)
        self.assertEqual(order.warehouse_stage, WarehouseStage.READY_TO_LOAD)

    def test_drop_point_failed_reschedule_keeps_inventory_reserved_while_cancel_releases_it(self) -> None:
        warehouse = Warehouse.objects.create(
            name="Lifecycle Warehouse",
            code="WH-LIFECYCLE-001",
            address="Warehouse Address",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            country="Philippines",
        )
        product = Product.objects.create(
            sku="SKU-LIFECYCLE-001",
            name="Lifecycle Product",
            unit="piece",
            price=25,
        )
        inventory = Inventory.objects.create(
            warehouse=warehouse,
            product=product,
            quantity=10,
            reserved_quantity=2,
            min_stock=0,
            max_stock=100,
            reorder_point=0,
        )
        batch = StockBatch.objects.create(
            batch_number="BATCH-LIFECYCLE-001",
            inventory=inventory,
            quantity=2,
            receipt_date=timezone.now(),
        )
        order = Order.objects.create(
            order_number="ORD-LIFECYCLE-001",
            customer=self.customer,
            status=OrderStatus.OUT_FOR_DELIVERY,
            subtotal=50,
            total_amount=50,
            warehouse_id=warehouse.id,
            warehouse_stage=WarehouseStage.DISPATCHED,
            ready_to_load_at=timezone.now() - timedelta(days=1),
            loaded_at=timezone.now() - timedelta(hours=8),
            warehouse_dispatched_at=timezone.now() - timedelta(hours=2),
        )
        OrderLogistics.objects.create(
            order=order,
            shipping_name="Trip Exec Customer",
            shipping_phone="+63-900-000-0000",
            shipping_address="123 Reschedule Street",
            shipping_city="Bacolod",
            shipping_province="Negros Occidental",
            shipping_zip_code="6100",
            shipping_country="Philippines",
        )
        OrderTimeline.objects.create(order=order, delivery_date=timezone.now())
        order_item = OrderItem.objects.create(
            order=order,
            product=product,
            quantity=2,
            unit_price=25,
            total_price=50,
        )
        InventoryTransaction.objects.create(
            warehouse=warehouse,
            product=product,
            type="RESERVE",
            quantity=2,
            reference_type="order_item_reserve",
            reference_id=order_item.id,
            notes="Initial reservation for lifecycle test",
            performed_by=self.admin_user.id,
        )
        self.dp_1.order = order
        self.dp_1.save(update_fields=["order", "updated_at"])
        self.dp_2.order = order
        self.dp_2.save(update_fields=["order", "updated_at"])

        reschedule_response = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={
                "status": "FAILED",
                "notes": "Reschedule later",
                "releaseInventory": False,
                "rescheduleRequested": True,
                "rescheduleWindow": "tomorrow",
                "rescheduleDate": (timezone.now() + timedelta(days=1)).date().isoformat(),
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(reschedule_response.status_code, 200)
        self.assertTrue(reschedule_response.json().get("requeuedToRoutePool"))
        self.dp_1.refresh_from_db()
        inventory.refresh_from_db()
        order.refresh_from_db()
        self.trip.refresh_from_db()
        self.assertEqual(self.dp_1.status, "FAILED")
        self.assertEqual(inventory.reserved_quantity, 2)
        self.assertEqual(order.status, OrderStatus.PREPARING)
        self.assertEqual(order.warehouse_stage, WarehouseStage.READY_TO_LOAD)
        self.assertIsNone(order.loaded_at)
        self.assertIsNone(order.warehouse_dispatched_at)
        self.assertEqual(self.trip.completed_drop_points, 1)
        self.assertEqual(self.trip.status, TripStatus.PLANNED)
        self.assertIsNone(self.trip.actual_end_at)
        route_plan_response = self.client.get(
            "/api/trips/route-plan",
            data={"warehouseId": warehouse.id},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(route_plan_response.status_code, 200)
        route_plan_payload = route_plan_response.json()
        self.assertTrue(route_plan_payload["success"])
        route_plan_order_ids = {str(row.get("id")) for row in route_plan_payload.get("orders", [])}
        self.assertIn(str(order.id), route_plan_order_ids)
        self.assertEqual(
            InventoryTransaction.objects.filter(
                reference_type="order_item_reserve",
                reference_id=order_item.id,
                type="UNRESERVE",
            ).count(),
            0,
        )

        cancel_response = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_2.id}",
            data={"status": "SKIPPED", "notes": "Cancel delivery"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(cancel_response.status_code, 200)
        self.assertFalse(cancel_response.json().get("requeuedToRoutePool"))
        self.dp_2.refresh_from_db()
        inventory.refresh_from_db()
        self.assertEqual(self.dp_2.status, "SKIPPED")
        self.assertEqual(inventory.reserved_quantity, 0)
        self.assertEqual(
            InventoryTransaction.objects.filter(
                reference_type="order_item_reserve",
                reference_id=order_item.id,
                type="UNRESERVE",
            ).count(),
            1,
        )

    def test_drop_point_failed_without_reschedule_cancels_order_for_customer_tracking(self) -> None:
        warehouse = Warehouse.objects.create(
            name="Failed Delivery Warehouse",
            code="WH-FAILED-001",
            address="Warehouse Address",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            country="Philippines",
        )
        product = Product.objects.create(
            sku="SKU-FAILED-001",
            name="Failed Delivery Product",
            unit="piece",
            price=25,
        )
        inventory = Inventory.objects.create(
            warehouse=warehouse,
            product=product,
            quantity=10,
            reserved_quantity=2,
            min_stock=0,
            max_stock=100,
            reorder_point=0,
        )
        StockBatch.objects.create(
            batch_number="BATCH-FAILED-001",
            inventory=inventory,
            quantity=2,
            receipt_date=timezone.now(),
        )
        order = Order.objects.create(
            order_number="ORD-FAILED-001",
            customer=self.customer,
            status=OrderStatus.OUT_FOR_DELIVERY,
            subtotal=50,
            total_amount=50,
            warehouse_id=warehouse.id,
            warehouse_stage=WarehouseStage.DISPATCHED,
        )
        OrderTimeline.objects.create(order=order, delivery_date=timezone.now())
        order_item = OrderItem.objects.create(
            order=order,
            product=product,
            quantity=2,
            unit_price=25,
            total_price=50,
        )
        InventoryTransaction.objects.create(
            warehouse=warehouse,
            product=product,
            type="RESERVE",
            quantity=2,
            reference_type="order_item_reserve",
            reference_id=order_item.id,
            notes="Initial reservation for failed delivery test",
            performed_by=self.admin_user.id,
        )
        self.dp_1.order = order
        self.dp_1.save(update_fields=["order", "updated_at"])

        response = self.client.patch(
            f"/api/trips/{self.trip.id}/drop-points/{self.dp_1.id}",
            data={
                "status": "FAILED",
                "notes": "Customer unavailable",
                "failureReason": "Customer unavailable",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json().get("requeuedToRoutePool"))

        order.refresh_from_db()
        inventory.refresh_from_db()
        self.trip.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.CANCELLED)
        self.assertEqual(inventory.reserved_quantity, 0)
        self.assertIsNotNone(order.timeline.cancelled_at)
        self.assertEqual(self.trip.completed_drop_points, 1)
        self.assertEqual(self.trip.status, TripStatus.PLANNED)
        self.assertIsNone(self.trip.actual_end_at)

    def test_single_failed_drop_point_completes_trip(self) -> None:
        single_trip = Trip.objects.create(
            trip_number="TRP-EXEC-FAILED-ONLY-001",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.IN_PROGRESS,
            total_drop_points=1,
            actual_start_at=timezone.now() - timedelta(hours=1),
        )
        single_drop_point = TripDropPoint.objects.create(
            trip=single_trip,
            sequence=1,
            location_name="Only Stop",
            address="Only Address",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            drop_point_type=DropPointType.DELIVERY,
        )

        response = self.client.patch(
            f"/api/trips/{single_trip.id}/drop-points/{single_drop_point.id}",
            data={
                "status": "FAILED",
                "notes": "Customer unavailable",
                "failureReason": "Customer unavailable",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)

        single_trip.refresh_from_db()
        single_drop_point.refresh_from_db()
        self.assertEqual(single_drop_point.status, "FAILED")
        self.assertEqual(single_trip.completed_drop_points, 1)
        self.assertEqual(single_trip.total_drop_points, 1)
        self.assertEqual(single_trip.status, TripStatus.COMPLETED)
        self.assertIsNotNone(single_trip.actual_end_at)


class TripStopAliasContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.driver_user = User.objects.create(
            email="trip.stop.alias.driver@example.com",
            password="hashed",
            name="Trip Stop Alias Driver",
            role=self.driver_role,
            is_active=True,
        )
        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="LIC-STOP-ALIAS-001",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.customer = Customer.objects.create(
            email="trip.stop.alias.customer@example.com",
            password="hashed",
            name="Trip Stop Alias Customer",
            is_active=True,
        )
        self.vehicle = Vehicle.objects.create(
            license_plate="STOP-ALIAS-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )
        self.trip = Trip.objects.create(
            trip_number="TRP-STOP-ALIAS-001",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.IN_PROGRESS,
            total_drop_points=1,
        )
        self.stop = TripDropPoint.objects.create(
            trip=self.trip,
            sequence=1,
            location_name="Alias Stop",
            address="Alias Address",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            drop_point_type=DropPointType.DELIVERY,
        )
        self.driver_token = create_token(
            {
                "userId": self.driver_user.id,
                "email": self.driver_user.email,
                "name": self.driver_user.name,
                "role": "DRIVER",
                "type": "staff",
            }
        )
        self.customer_token = create_token(
            {
                "userId": self.customer.id,
                "email": self.customer.email,
                "name": self.customer.name,
                "role": "CUSTOMER",
                "type": "customer",
            }
        )

    def test_trip_stop_alias_behaves_like_drop_point_update(self) -> None:
        response = self.client.patch(
            f"/api/trips/{self.trip.id}/stops/{self.stop.id}",
            data={"status": "ARRIVED", "notes": "Reached stop"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["dropPoint"]["status"], "ARRIVED")
        self.assertEqual(payload["dropPoint"]["notes"], "Reached stop")
        self.assertIsNotNone(payload["dropPoint"]["actualArrival"])

    def test_trip_stop_alias_enforces_same_auth_rules(self) -> None:
        unauthorized = self.client.patch(
            f"/api/trips/{self.trip.id}/stops/{self.stop.id}",
            data={"status": "ARRIVED"},
            content_type="application/json",
        )
        self.assertEqual(unauthorized.status_code, 401)

        forbidden = self.client.patch(
            f"/api/trips/{self.trip.id}/stops/{self.stop.id}",
            data={"status": "ARRIVED"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(forbidden.status_code, 403)


class UploadEndpointsAuthContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")

        self.driver_user = User.objects.create(
            email="upload.driver@example.com",
            password="hashed",
            name="Upload Driver",
            role=self.driver_role,
            is_active=True,
        )
        self.admin_user = User.objects.create(
            email="upload.admin@example.com",
            password="hashed",
            name="Upload Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.customer = Customer.objects.create(
            email="upload.customer@example.com",
            password="hashed",
            name="Upload Customer",
            is_active=True,
        )

        self.driver_token = create_token(
            {
                "userId": self.driver_user.id,
                "email": self.driver_user.email,
                "name": self.driver_user.name,
                "role": "DRIVER",
                "type": "staff",
            }
        )
        self.admin_token = create_token(
            {
                "userId": self.admin_user.id,
                "email": self.admin_user.email,
                "name": self.admin_user.name,
                "role": "ADMIN",
                "type": "staff",
            }
        )
        self.customer_token = create_token(
            {
                "userId": self.customer.id,
                "email": self.customer.email,
                "name": self.customer.name,
                "role": "CUSTOMER",
                "type": "customer",
            }
        )

    def test_upload_product_image_requires_staff_auth(self) -> None:
        response = self.client.post("/api/uploads/product-image")
        self.assertEqual(response.status_code, 401)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Unauthorized")

    def test_upload_pod_and_driver_license_require_driver_role(self) -> None:
        pod_as_admin = self.client.post(
            "/api/uploads/pod-image",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(pod_as_admin.status_code, 403)
        self.assertEqual(pod_as_admin.json()["error"], "Forbidden")

        license_as_admin = self.client.post(
            "/api/uploads/driver-license",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(license_as_admin.status_code, 403)
        self.assertEqual(license_as_admin.json()["error"], "Forbidden")

    def test_upload_customer_avatar_requires_authenticated_user(self) -> None:
        response = self.client.post("/api/uploads/customer-avatar")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"], "Unauthorized")

    def test_upload_endpoints_validate_missing_and_non_image_files(self) -> None:
        missing_file = self.client.post(
            "/api/uploads/pod-image",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(missing_file.status_code, 400)
        self.assertEqual(missing_file.json()["error"], "Image file is required")

        text_file = SimpleUploadedFile("notes.txt", b"not-an-image", content_type="text/plain")
        non_image = self.client.post(
            "/api/uploads/pod-image",
            data={"file": text_file},
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(non_image.status_code, 400)
        self.assertEqual(non_image.json()["error"], "Only image files are allowed")

    def test_upload_customer_avatar_accepts_authenticated_customer_with_image(self) -> None:
        image_file = SimpleUploadedFile("avatar.png", b"\x89PNG\r\n\x1a\nfake", content_type="image/png")
        response = self.client.post(
            "/api/uploads/customer-avatar",
            data={"file": image_file},
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertIn("/uploads/customers/customer-", payload["imageUrl"])


class TripsCollectionTrackingContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.admin_user = User.objects.create(
            email="trips.collection.admin@example.com",
            password="hashed",
            name="Trips Collection Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.admin_token = create_token(
            {
                "userId": self.admin_user.id,
                "email": self.admin_user.email,
                "name": self.admin_user.name,
                "role": "ADMIN",
                "type": "staff",
            }
        )
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.driver_user = User.objects.create(
            email="trips.collection.driver@example.com",
            password="hashed",
            name="Trips Collection Driver",
            role=self.driver_role,
            is_active=True,
        )
        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="LIC-TRIPS-COLLECTION-001",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.vehicle = Vehicle.objects.create(
            license_plate="TRIPS-COLLECTION-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )

    def test_trips_collection_include_tracking_and_date_filter(self) -> None:
        target_date = timezone.now().date()
        other_date = target_date - timedelta(days=1)

        trip_on_target = Trip.objects.create(
            trip_number="TRP-COLLECTION-001",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.IN_PROGRESS,
            planned_start_at=timezone.make_aware(
                timezone.datetime(target_date.year, target_date.month, target_date.day, 9, 0, 0)
            ),
        )
        Trip.objects.create(
            trip_number="TRP-COLLECTION-002",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.PLANNED,
            created_at=timezone.make_aware(
                timezone.datetime(other_date.year, other_date.month, other_date.day, 7, 0, 0)
            ),
            planned_start_at=timezone.make_aware(
                timezone.datetime(other_date.year, other_date.month, other_date.day, 9, 0, 0)
            ),
        )

        LocationLog.objects.create(
            driver=self.driver,
            trip=trip_on_target,
            latitude=10.01,
            longitude=123.01,
            recorded_at=timezone.make_aware(
                timezone.datetime(target_date.year, target_date.month, target_date.day, 10, 0, 0)
            ),
        )
        latest_target_log = LocationLog.objects.create(
            driver=self.driver,
            trip=trip_on_target,
            latitude=10.02,
            longitude=123.02,
            recorded_at=timezone.make_aware(
                timezone.datetime(target_date.year, target_date.month, target_date.day, 11, 0, 0)
            ),
        )
        LocationLog.objects.create(
            driver=self.driver,
            trip=trip_on_target,
            latitude=9.99,
            longitude=122.99,
            recorded_at=timezone.make_aware(
                timezone.datetime(other_date.year, other_date.month, other_date.day, 8, 0, 0)
            ),
        )

        response = self.client.get(
            "/api/trips",
            data={"includeTracking": "true", "trackingDate": target_date.isoformat()},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(len(payload["trips"]), 1)

        trip_row = payload["trips"][0]
        self.assertEqual(trip_row["id"], trip_on_target.id)
        self.assertIn("locationLogs", trip_row)
        self.assertIn("latestLocation", trip_row)
        self.assertEqual(len(trip_row["locationLogs"]), 2)
        self.assertIsNotNone(trip_row["latestLocation"])
        self.assertEqual(trip_row["latestLocation"]["id"], latest_target_log.id)

    def test_trips_collection_rejects_invalid_tracking_date(self) -> None:
        response = self.client.get(
            "/api/trips",
            data={"trackingDate": "2026-99-99"},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Invalid trackingDate. Expected YYYY-MM-DD")


class SavedRoutesContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.warehouse_role = Role.objects.create(name="WAREHOUSE_STAFF", description="Warehouse Staff")

        self.admin_user = User.objects.create(
            email="saved.routes.admin@example.com",
            password="hashed",
            name="Saved Routes Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.warehouse_user = User.objects.create(
            email="saved.routes.warehouse@example.com",
            password="hashed",
            name="Saved Routes Warehouse",
            role=self.warehouse_role,
            is_active=True,
        )
        self.other_warehouse_user = User.objects.create(
            email="saved.routes.warehouse.other@example.com",
            password="hashed",
            name="Saved Routes Warehouse Other",
            role=self.warehouse_role,
            is_active=True,
        )

        self.admin_token = create_token(
            {
                "userId": self.admin_user.id,
                "email": self.admin_user.email,
                "name": self.admin_user.name,
                "role": "ADMIN",
                "type": "staff",
            }
        )
        self.warehouse_token = create_token(
            {
                "userId": self.warehouse_user.id,
                "email": self.warehouse_user.email,
                "name": self.warehouse_user.name,
                "role": "WAREHOUSE_STAFF",
                "type": "staff",
            }
        )
        self.other_warehouse_token = create_token(
            {
                "userId": self.other_warehouse_user.id,
                "email": self.other_warehouse_user.email,
                "name": self.other_warehouse_user.name,
                "role": "WAREHOUSE_STAFF",
                "type": "staff",
            }
        )

    def test_saved_routes_post_sets_created_by_user_and_returns_saved_route(self) -> None:
        response = self.client.post(
            "/api/trips/saved-routes",
            data={
                "date": "2026-05-10",
                "warehouseId": "wh-001",
                "warehouseName": "Main Warehouse",
                "city": "Bacolod",
                "totalDistanceKm": 15.5,
                "orderIds": ["ord-1"],
                "orders": [{"id": "ord-1", "sequence": 1}],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertIn("savedRoute", payload)
        self.assertEqual(payload["savedRoute"]["createdByUserId"], self.warehouse_user.id)

        saved = SavedRouteDraft.objects.get(id=payload["savedRoute"]["id"])
        self.assertEqual(saved.created_by_user_id, self.warehouse_user.id)

    def test_saved_routes_get_for_warehouse_staff_returns_only_own_routes(self) -> None:
        own_route = SavedRouteDraft.objects.create(
            date=timezone.now().date(),
            warehouse_id="wh-001",
            warehouse_name="Main Warehouse",
            city="Bacolod",
            total_distance_km=12,
            order_ids=["ord-own"],
            orders_json=[],
            created_by_user=self.warehouse_user,
        )
        SavedRouteDraft.objects.create(
            date=timezone.now().date(),
            warehouse_id="wh-001",
            warehouse_name="Main Warehouse",
            city="Bacolod",
            total_distance_km=10,
            order_ids=["ord-other"],
            orders_json=[],
            created_by_user=self.other_warehouse_user,
        )

        response = self.client.get(
            "/api/trips/saved-routes",
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(len(payload["savedRoutes"]), 1)
        self.assertEqual(payload["savedRoutes"][0]["id"], own_route.id)

    def test_saved_routes_delete_forbidden_for_other_warehouse_staff_owner(self) -> None:
        route = SavedRouteDraft.objects.create(
            date=timezone.now().date(),
            warehouse_id="wh-001",
            warehouse_name="Main Warehouse",
            city="Bacolod",
            total_distance_km=10,
            order_ids=["ord-other"],
            orders_json=[],
            created_by_user=self.other_warehouse_user,
        )

        response = self.client.delete(
            f"/api/trips/saved-routes?id={route.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )
        self.assertEqual(response.status_code, 403)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Forbidden")

    def test_saved_routes_delete_allowed_for_admin(self) -> None:
        route = SavedRouteDraft.objects.create(
            date=timezone.now().date(),
            warehouse_id="wh-001",
            warehouse_name="Main Warehouse",
            city="Bacolod",
            total_distance_km=10,
            order_ids=["ord-admin-delete"],
            orders_json=[],
            created_by_user=self.warehouse_user,
        )

        response = self.client.delete(
            f"/api/trips/saved-routes?id={route.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertFalse(SavedRouteDraft.objects.filter(id=route.id).exists())

    def test_saved_routes_post_validates_required_fields(self) -> None:
        response = self.client.post(
            "/api/trips/saved-routes",
            data={"city": "Bacolod"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "date, warehouseId, and city are required")

    def test_saved_routes_post_validates_date_order_ids_and_orders_shape(self) -> None:
        invalid_date = self.client.post(
            "/api/trips/saved-routes",
            data={
                "date": "2026-99-10",
                "warehouseId": "wh-001",
                "city": "Bacolod",
                "orderIds": ["ord-1"],
                "orders": [],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )
        self.assertEqual(invalid_date.status_code, 400)
        self.assertEqual(invalid_date.json()["error"], "Invalid date. Expected YYYY-MM-DD")

        empty_order_ids = self.client.post(
            "/api/trips/saved-routes",
            data={
                "date": "2026-05-10",
                "warehouseId": "wh-001",
                "city": "Bacolod",
                "orderIds": [],
                "orders": [],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )
        self.assertEqual(empty_order_ids.status_code, 400)
        self.assertEqual(empty_order_ids.json()["error"], "At least one orderId is required")

        invalid_orders_shape = self.client.post(
            "/api/trips/saved-routes",
            data={
                "date": "2026-05-10",
                "warehouseId": "wh-001",
                "city": "Bacolod",
                "orderIds": ["ord-1"],
                "orders": {"id": "ord-1"},
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.warehouse_token}",
        )
        self.assertEqual(invalid_orders_shape.status_code, 400)
        self.assertEqual(invalid_orders_shape.json()["error"], "orders must be an array")

    def test_saved_routes_delete_requires_route_id(self) -> None:
        response = self.client.delete(
            "/api/trips/saved-routes",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Route id is required")


class RoutePlanContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.admin_user = User.objects.create(
            email="route.plan.admin@example.com",
            password="hashed",
            name="Route Plan Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.admin_token = create_token(
            {
                "userId": self.admin_user.id,
                "email": self.admin_user.email,
                "name": self.admin_user.name,
                "role": "ADMIN",
                "type": "staff",
            }
        )

    def test_route_plan_requires_staff_auth(self) -> None:
        response = self.client.get("/api/trips/route-plan")
        self.assertEqual(response.status_code, 401)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Unauthorized")

    def test_route_plan_get_rejects_invalid_date(self) -> None:
        response = self.client.get(
            "/api/trips/route-plan",
            data={"date": "2026-13-01"},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Invalid date. Expected YYYY-MM-DD")

    def test_route_plan_post_accepts_payload_echo(self) -> None:
        response = self.client.post(
            "/api/trips/route-plan",
            data={"city": "Bacolod", "orders": [{"id": "ord-1"}]},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["message"], "Route plan accepted")
        self.assertEqual(payload["routePlan"]["city"], "Bacolod")


class RoutePlanStructureContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.admin_user = User.objects.create(
            email="route.plan.structure.admin@route.local",
            password="hashed",
            name="Route Plan Structure Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.driver_user = User.objects.create(
            email="route.plan.structure.driver@route.local",
            password="hashed",
            name="Route Plan Structure Driver",
            role=self.driver_role,
            is_active=True,
        )
        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="LIC-ROUTE-STRUCTURE-001",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.vehicle = Vehicle.objects.create(
            license_plate="ROUTE-STRUCTURE-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )
        self.customer = Customer.objects.create(
            email="route.plan.structure.customer@route.local",
            password="hashed",
            name="Route Plan Structure Customer",
            latitude=10.31,
            longitude=123.89,
            is_active=True,
        )
        self.warehouse = Warehouse.objects.create(
            name="Route Plan WH",
            code="WH-ROUTE-STRUCT-001",
            address="Route Plan Road",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            latitude=10.30,
            longitude=123.90,
            is_active=True,
        )
        self.product = Product.objects.create(
            sku="SKU-ROUTE-STRUCT-001",
            name="Sparkling Water",
            unit="case",
            price=100,
            is_active=True,
        )
        self.admin_token = create_token(
            {
                "userId": self.admin_user.id,
                "email": self.admin_user.email,
                "name": self.admin_user.name,
                "role": "ADMIN",
                "type": "staff",
            }
        )

    def test_route_plan_get_returns_drivers_vehicles_orders_and_grouped_plans(self) -> None:
        order = Order.objects.create(
            order_number="ORD-ROUTE-STRUCT-001",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=200,
            total_amount=220,
            warehouse_id=self.warehouse.id,
        )
        OrderItem.objects.create(
            order=order,
            product=self.product,
            quantity=2,
            unit_price=100,
            total_price=200,
        )
        OrderLogistics.objects.create(
            order=order,
            shipping_name="Customer A",
            shipping_phone="+1-555-0100",
            shipping_address="123 Structure Street",
            shipping_city="Bacolod",
            shipping_province="Negros Occidental",
            shipping_zip_code="6100",
            shipping_country="Philippines",
            shipping_latitude=10.32,
            shipping_longitude=123.88,
        )
        OrderTimeline.objects.create(order=order, delivery_date=timezone.now())

        response = self.client.get(
            "/api/trips/route-plan",
            data={"warehouseId": self.warehouse.id},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertIn("drivers", payload)
        self.assertIn("vehicles", payload)
        self.assertIn("orders", payload)
        self.assertIn("routePlans", payload)
        self.assertGreaterEqual(len(payload["drivers"]), 1)
        self.assertGreaterEqual(len(payload["vehicles"]), 1)
        self.assertGreaterEqual(len(payload["orders"]), 1)
        self.assertGreaterEqual(len(payload["routePlans"]), 1)

        plan = payload["routePlans"][0]
        self.assertIn("city", plan)
        self.assertIn("orderCount", plan)
        self.assertIn("totalDistanceKm", plan)
        self.assertIn("orders", plan)

    def test_route_plan_uses_rescheduled_delivery_date_not_created_date(self) -> None:
        future_delivery = timezone.now() + timedelta(days=2)
        order = Order.objects.create(
            order_number="ORD-ROUTE-RESCHEDULED-001",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=200,
            total_amount=220,
            warehouse_id=self.warehouse.id,
        )
        OrderItem.objects.create(
            order=order,
            product=self.product,
            quantity=2,
            unit_price=100,
            total_price=200,
        )
        OrderLogistics.objects.create(
            order=order,
            shipping_name="Customer A",
            shipping_phone="+1-555-0100",
            shipping_address="123 Structure Street",
            shipping_city="Bacolod",
            shipping_province="Negros Occidental",
            shipping_zip_code="6100",
            shipping_country="Philippines",
            shipping_latitude=10.32,
            shipping_longitude=123.88,
        )
        OrderTimeline.objects.create(order=order, delivery_date=future_delivery)

        today_response = self.client.get(
            "/api/trips/route-plan",
            data={"warehouseId": self.warehouse.id, "date": timezone.now().date().isoformat()},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(today_response.status_code, 200)
        today_order_ids = [row["id"] for row in today_response.json()["orders"]]
        self.assertNotIn(order.id, today_order_ids)

        future_response = self.client.get(
            "/api/trips/route-plan",
            data={"warehouseId": self.warehouse.id, "date": future_delivery.date().isoformat()},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(future_response.status_code, 200)
        future_order_ids = [row["id"] for row in future_response.json()["orders"]]
        self.assertIn(order.id, future_order_ids)

    def test_route_plan_hides_order_assigned_to_trip_until_trip_deleted(self) -> None:
        delivery_date = timezone.now() + timedelta(days=1)
        order = Order.objects.create(
            order_number="ORD-ROUTE-ASSIGNED-001",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=200,
            total_amount=220,
            warehouse_id=self.warehouse.id,
        )
        OrderItem.objects.create(
            order=order,
            product=self.product,
            quantity=2,
            unit_price=100,
            total_price=200,
        )
        OrderLogistics.objects.create(
            order=order,
            shipping_name="Customer A",
            shipping_phone="+1-555-0100",
            shipping_address="123 Structure Street",
            shipping_city="Bacolod",
            shipping_province="Negros Occidental",
            shipping_zip_code="6100",
            shipping_country="Philippines",
            shipping_latitude=10.32,
            shipping_longitude=123.88,
        )
        OrderTimeline.objects.create(order=order, delivery_date=delivery_date)
        trip = Trip.objects.create(
            trip_number="TRP-ROUTE-ASSIGNED-001",
            driver=self.driver,
            vehicle=self.vehicle,
            warehouse_id=self.warehouse.id,
            status=TripStatus.PLANNED,
            planned_start_at=delivery_date,
        )
        TripDropPoint.objects.create(
            trip=trip,
            order=order,
            sequence=1,
            status="PENDING",
            location_name="Customer A",
            address="123 Structure Street",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
        )

        assigned_response = self.client.get(
            "/api/trips/route-plan",
            data={"warehouseId": self.warehouse.id, "date": delivery_date.date().isoformat()},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(assigned_response.status_code, 200)
        assigned_order_ids = [row["id"] for row in assigned_response.json()["orders"]]
        self.assertNotIn(order.id, assigned_order_ids)

        delete_response = self.client.delete(
            f"/api/trips/{trip.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(delete_response.status_code, 200)

        released_response = self.client.get(
            "/api/trips/route-plan",
            data={"warehouseId": self.warehouse.id, "date": delivery_date.date().isoformat()},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(released_response.status_code, 200)
        released_order_ids = [row["id"] for row in released_response.json()["orders"]]
        self.assertIn(order.id, released_order_ids)

    def test_trip_delete_rejects_non_planned_trip(self) -> None:
        trip = Trip.objects.create(
            trip_number="TRP-DELETE-IN-PROGRESS-001",
            driver=self.driver,
            vehicle=self.vehicle,
            warehouse_id=self.warehouse.id,
            status=TripStatus.IN_PROGRESS,
            planned_start_at=timezone.now(),
            actual_start_at=timezone.now(),
        )

        response = self.client.delete(
            f"/api/trips/{trip.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "Only planned trips can be deleted")
        self.assertTrue(Trip.objects.filter(id=trip.id).exists())


class TripsPostCreationContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.admin_user = User.objects.create(
            email="trips.post.admin@example.com",
            password="hashed",
            name="Trips Post Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.driver_user = User.objects.create(
            email="trips.post.driver@example.com",
            password="hashed",
            name="Trips Post Driver",
            role=self.driver_role,
            is_active=True,
        )
        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="LIC-TRIPS-POST-001",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.vehicle = Vehicle.objects.create(
            license_plate="TRIPS-POST-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )
        self.customer = Customer.objects.create(
            email="trips.post.customer@example.com",
            password="hashed",
            name="Trips Post Customer",
            latitude=10.40,
            longitude=123.80,
            is_active=True,
        )
        self.order_1 = Order.objects.create(
            order_number="ORD-TRIPS-POST-001",
            customer=self.customer,
            status=OrderStatus.OUT_FOR_DELIVERY,
            subtotal=120,
            total_amount=132,
        )
        self.order_2 = Order.objects.create(
            order_number="ORD-TRIPS-POST-002",
            customer=self.customer,
            status=OrderStatus.OUT_FOR_DELIVERY,
            subtotal=140,
            total_amount=154,
        )
        OrderLogistics.objects.create(
            order=self.order_1,
            shipping_name="Customer 1",
            shipping_phone="+1-555-0001",
            shipping_address="Address 1",
            shipping_city="Bacolod",
            shipping_province="Negros Occidental",
            shipping_zip_code="6100",
            shipping_country="Philippines",
            shipping_latitude=10.41,
            shipping_longitude=123.81,
        )
        OrderLogistics.objects.create(
            order=self.order_2,
            shipping_name="Customer 2",
            shipping_phone="+1-555-0002",
            shipping_address="Address 2",
            shipping_city="Bacolod",
            shipping_province="Negros Occidental",
            shipping_zip_code="6100",
            shipping_country="Philippines",
            shipping_latitude=10.42,
            shipping_longitude=123.82,
        )
        self.admin_token = create_token(
            {
                "userId": self.admin_user.id,
                "email": self.admin_user.email,
                "name": self.admin_user.name,
                "role": "ADMIN",
                "type": "staff",
            }
        )

    def test_trips_post_creates_trip_with_drop_points_and_total_count(self) -> None:
        response = self.client.post(
            "/api/trips",
            data={
                "driverId": self.driver.id,
                "vehicleId": self.vehicle.id,
                "orderIds": [self.order_1.id, self.order_2.id],
                "status": "PLANNED",
                "notes": "Test trip creation",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertIn("trip", payload)
        trip = payload["trip"]
        self.assertEqual(trip["driver"]["id"], self.driver.id)
        self.assertEqual(trip["vehicle"]["id"], self.vehicle.id)
        self.assertEqual(trip["status"], TripStatus.PLANNED)
        self.assertEqual(len(trip["dropPoints"]), 2)
        self.assertEqual(trip["totalDropPoints"], 2)

        trip_db = Trip.objects.get(id=trip["id"])
        self.assertEqual(trip_db.total_drop_points, 2)
        self.assertEqual(trip_db.drop_points.count(), 2)

    def test_trips_post_returns_404_when_driver_or_vehicle_missing(self) -> None:
        response = self.client.post(
            "/api/trips",
            data={
                "driverId": "missing-driver",
                "vehicleId": self.vehicle.id,
                "orderIds": [self.order_1.id],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 404)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Driver or vehicle not found")


class PaginationGuardsContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.admin_user = User.objects.create(
            email="pagination.admin@example.com",
            password="hashed",
            name="Pagination Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.driver_user = User.objects.create(
            email="pagination.driver@example.com",
            password="hashed",
            name="Pagination Driver",
            role=self.driver_role,
            is_active=True,
        )
        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="LIC-PAGINATION-001",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.vehicle = Vehicle.objects.create(
            license_plate="PAGINATION-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )
        self.customer = Customer.objects.create(
            email="pagination.customer@logitrack.local",
            password="hashed",
            name="Pagination Customer",
            is_active=True,
        )
        self.admin_token = create_token(
            {
                "userId": self.admin_user.id,
                "email": self.admin_user.email,
                "name": self.admin_user.name,
                "role": "ADMIN",
                "type": "staff",
            }
        )

        for idx in range(3):
            Order.objects.create(
                order_number=f"ORD-PAGINATION-{idx + 1:03d}",
                customer=self.customer,
                status=OrderStatus.PREPARING,
                subtotal=100 + idx,
                total_amount=110 + idx,
            )
            Trip.objects.create(
                trip_number=f"TRP-PAGINATION-{idx + 1:03d}",
                driver=self.driver,
                vehicle=self.vehicle,
                status=TripStatus.PLANNED,
            )

    def test_orders_endpoint_uses_expected_default_pagination(self) -> None:
        response = self.client.get("/api/orders", HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["page"], 1)
        self.assertEqual(payload["pageSize"], 20)
        self.assertEqual(payload["total"], 3)
        self.assertEqual(payload["totalPages"], 1)
        self.assertEqual(len(payload["orders"]), 3)

    def test_orders_endpoint_clamps_invalid_and_extreme_pagination_values(self) -> None:
        low_bound = self.client.get(
            "/api/orders",
            data={"page": -7, "pageSize": 0},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(low_bound.status_code, 200)
        low_payload = low_bound.json()
        self.assertEqual(low_payload["page"], 1)
        self.assertEqual(low_payload["pageSize"], 1)
        self.assertEqual(len(low_payload["orders"]), 1)

        high_bound = self.client.get(
            "/api/orders",
            data={"pageSize": 50000},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(high_bound.status_code, 200)
        high_payload = high_bound.json()
        self.assertEqual(high_payload["pageSize"], 1000)
        self.assertEqual(len(high_payload["orders"]), 3)

    def test_orders_include_returns_always_exposes_customer_display_name(self) -> None:
        order = Order.objects.create(
            order_number="ORD-RETURN-CUSTOMER",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=100,
            total_amount=110,
        )
        OrderLogistics.objects.create(
            order=order,
            shipping_name="Fallback Shipping Customer",
            shipping_phone="555-0100",
            shipping_address="123 Return Street",
            shipping_city="Return City",
            shipping_province="Return Province",
            shipping_zip_code="5000",
            shipping_country="Philippines",
        )
        self.customer.name = ""
        self.customer.save(update_fields=["name", "updated_at"])
        Replacement.objects.create(
            replacement_number="RET-CUSTOMER-001",
            order=order,
            customer_id=self.customer.id,
            reason="Damaged item",
            pickup_address="123 Return Street",
            pickup_city="Return City",
            pickup_province="Return Province",
            pickup_zip_code="5000",
        )

        response = self.client.get(
            "/api/orders",
            data={"includeReplacements": "true", "includeOrders": "false", "includeItems": "none", "limit": 10},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        returned = next(row for row in payload["replacements"] if row["replacementNumber"] == "RET-CUSTOMER-001")
        self.assertEqual(returned["customerName"], "Fallback Shipping Customer")
        self.assertEqual(returned["order"]["customer"]["id"], self.customer.id)

    def test_orders_include_returns_exposes_replacement_item_quantities(self) -> None:
        order = Order.objects.create(
            order_number="ORD-RETURN-QUANTITIES",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=100,
            total_amount=110,
        )
        product = Product.objects.create(sku="RET-COKE-001", name="coke", price=10)
        order_item = OrderItem.objects.create(
            order=order,
            product=product,
            quantity=7,
            unit_price=10,
            total_price=70,
        )
        Replacement.objects.create(
            replacement_number="RET-QUANTITY-001",
            order=order,
            customer_id=self.customer.id,
            reason="Damaged item",
            status="NEEDS_FOLLOW_UP",
            original_order_item_id=order_item.id,
            replacement_product_id=product.id,
            replacement_quantity=1,
            pickup_address="123 Return Street",
            pickup_city="Return City",
            pickup_province="Return Province",
            pickup_zip_code="5000",
            notes='Partial replacement reported by driver\nMeta: {"quantityToReplace": 6, "quantityReplaced": 1}',
        )

        response = self.client.get(
            "/api/orders",
            data={"includeReplacements": "true", "includeOrders": "false", "includeItems": "none", "limit": 10},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )

        self.assertEqual(response.status_code, 200)
        returned = next(row for row in response.json()["replacements"] if row["replacementNumber"] == "RET-QUANTITY-001")
        self.assertEqual(returned["quantityToReplace"], 6)
        self.assertEqual(returned["quantityReplaced"], 1)
        self.assertEqual(returned["remainingQuantity"], 5)
        self.assertEqual(returned["replacementItems"][0]["quantityToReplace"], 6)
        self.assertEqual(returned["replacementItems"][0]["quantityReplaced"], 1)

    def test_driver_spare_replacement_accepts_multiple_damaged_products(self) -> None:
        driver_token = create_token(
            {
                "userId": self.driver_user.id,
                "email": self.driver_user.email,
                "name": self.driver_user.name,
                "role": "DRIVER",
                "type": "staff",
            }
        )
        order = Order.objects.create(
            order_number="ORD-MULTI-DAMAGE",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=100,
            total_amount=110,
        )
        coke = Product.objects.create(sku="MULTI-COKE-001", name="coke", price=10)
        sprite = Product.objects.create(sku="MULTI-SPRITE-001", name="sprite", price=12)
        coke_item = OrderItem.objects.create(order=order, product=coke, quantity=8, unit_price=10, total_price=80)
        sprite_item = OrderItem.objects.create(order=order, product=sprite, quantity=5, unit_price=12, total_price=60)
        DriverSpareStock.objects.create(driver=self.driver, product=coke, quantity=10, min_quantity=0)
        DriverSpareStock.objects.create(driver=self.driver, product=sprite, quantity=10, min_quantity=0)

        response = self.client.post(
            "/api/driver/replacements/from-spare-products",
            data=json.dumps({
                "orderId": order.id,
                "tripId": "trip-multi-damage",
                "dropPointId": "drop-multi-damage",
                "outcome": "PARTIALLY_REPLACED",
                "reason": "Multiple damaged products",
                "damagePhotos": ["/uploads/pods/multi-damage.jpg"],
                "items": [
                    {"orderItemId": coke_item.id, "quantityToReplace": 6, "quantityReplaced": 1},
                    {"orderItemId": sprite_item.id, "quantityToReplace": 3, "quantityReplaced": 2},
                ],
            }),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {driver_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["replacements"]), 2)
        quantities = sorted((row["originalProductName"], row["quantityToReplace"], row["quantityReplaced"]) for row in payload["replacements"])
        self.assertEqual(quantities, [("coke", 6, 1), ("sprite", 3, 2)])
        self.assertEqual(Replacement.objects.filter(order=order).count(), 2)

    def test_trips_endpoint_uses_expected_pagination_defaults_and_bounds(self) -> None:
        default_response = self.client.get("/api/trips", HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        self.assertEqual(default_response.status_code, 200)
        default_payload = default_response.json()
        self.assertEqual(default_payload["page"], 1)
        self.assertEqual(default_payload["pageSize"], 20)
        self.assertEqual(default_payload["total"], 3)
        self.assertEqual(len(default_payload["trips"]), 3)

        bounded_response = self.client.get(
            "/api/trips",
            data={"page": 0, "pageSize": 0},
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(bounded_response.status_code, 200)
        bounded_payload = bounded_response.json()
        self.assertEqual(bounded_payload["page"], 1)
        self.assertEqual(bounded_payload["pageSize"], 1)
        self.assertEqual(len(bounded_payload["trips"]), 1)


class DeliveryLifecycleFlowContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")

        self.admin_user = User.objects.create(
            email="lifecycle.admin@example.com",
            password="hashed",
            name="Lifecycle Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.driver_user = User.objects.create(
            email="lifecycle.driver@example.com",
            password="hashed",
            name="Lifecycle Driver",
            role=self.driver_role,
            is_active=True,
        )
        self.driver = Driver.objects.create(
            user=self.driver_user,
            license_number="LIC-LIFECYCLE-001",
            license_type="B",
            license_expiry=timezone.now() + timedelta(days=365),
            is_active=True,
        )
        self.vehicle = Vehicle.objects.create(
            license_plate="LIFECYCLE-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )
        self.customer = Customer.objects.create(
            email="lifecycle.customer@example.com",
            password="hashed",
            name="Lifecycle Customer",
            is_active=True,
        )
        self.order = Order.objects.create(
            order_number="ORD-LIFECYCLE-001",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            warehouse_stage=WarehouseStage.READY_TO_LOAD,
            subtotal=200,
            total_amount=220,
        )
        self.trip = Trip.objects.create(
            trip_number="TRP-LIFECYCLE-001",
            driver=self.driver,
            vehicle=self.vehicle,
            status=TripStatus.PLANNED,
            total_drop_points=1,
        )
        TripDropPoint.objects.create(
            trip=self.trip,
            order=self.order,
            sequence=1,
            location_name=self.order.order_number,
            address="Lifecycle Address",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            drop_point_type=DropPointType.DELIVERY,
        )
        self.admin_token = create_token(
            {
                "userId": self.admin_user.id,
                "email": self.admin_user.email,
                "name": self.admin_user.name,
                "role": "ADMIN",
                "type": "staff",
            }
        )
        self.driver_token = create_token(
            {
                "userId": self.driver_user.id,
                "email": self.driver_user.email,
                "name": self.driver_user.name,
                "role": "DRIVER",
                "type": "staff",
            }
        )

    def test_delivery_lifecycle_end_to_end(self) -> None:
        loaded = self.client.patch(
            f"/api/orders/{self.order.id}/warehouse-stage",
            data={
                "warehouseStage": "LOADED",
                "checklist": {
                    "itemsVerified": True,
                    "quantityVerified": True,
                    "packagingVerified": True,
                    "spareProductsVerified": True,
                    "vehicleAssigned": True,
                    "driverAssigned": True,
                },
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(loaded.status_code, 200)
        self.assertEqual(loaded.json()["order"]["status"], OrderStatus.PREPARING)

        create_trip = self.client.post(
            "/api/trips",
            data={
                "driverId": self.driver.id,
                "vehicleId": self.vehicle.id,
                "orderIds": [self.order.id],
                "status": "PLANNED",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(create_trip.status_code, 201)
        trip_payload = create_trip.json()["trip"]
        trip_id = trip_payload["id"]
        drop_point_id = trip_payload["dropPoints"][0]["id"]

        start_trip = self.client.post(
            f"/api/trips/{trip_id}/start",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(start_trip.status_code, 200)
        self.assertEqual(start_trip.json()["trip"]["status"], TripStatus.IN_PROGRESS)
        self.order.refresh_from_db()
        self.assertEqual(self.order.warehouse_stage, WarehouseStage.DISPATCHED)
        self.assertEqual(self.order.status, OrderStatus.OUT_FOR_DELIVERY)

        arrived = self.client.patch(
            f"/api/trips/{trip_id}/drop-points/{drop_point_id}",
            data={"status": "ARRIVED"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(arrived.status_code, 200)
        self.assertEqual(arrived.json()["dropPoint"]["status"], "ARRIVED")

        completed = self.client.patch(
            f"/api/trips/{trip_id}/drop-points/{drop_point_id}",
            data={"status": "COMPLETED"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(completed.status_code, 200)
        self.assertEqual(completed.json()["dropPoint"]["status"], "COMPLETED")
        self.assertEqual(completed.json()["order"]["status"], OrderStatus.DELIVERED)

        trip_db = Trip.objects.get(id=trip_id)
        self.assertEqual(trip_db.status, TripStatus.COMPLETED)
        self.assertEqual(trip_db.completed_drop_points, 1)
        self.assertIsNotNone(trip_db.actual_end_at)

        self.order.refresh_from_db()
        self.assertEqual(self.order.status, OrderStatus.DELIVERED)
        order_timeline = OrderTimeline.objects.get(order=self.order)
        self.assertIsNotNone(order_timeline.delivered_at)
