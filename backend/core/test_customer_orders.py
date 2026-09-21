"""Customer-facing order, tracking, and account creation API contracts."""

import json
from datetime import datetime, timedelta
from unittest.mock import patch

from django.test import Client, TestCase
from django.utils import timezone

from .auth import create_token
from .models import (
    ContainerType,
    Customer,
    DropPointType,
    Inventory,
    InventoryTransaction,
    Notification,
    Order,
    OrderItem,
    OrderTimeline,
    OrderStatus,
    Product,
    ProductPackaging,
    StockBatch,
    Trip,
    TripDropPoint,
    TripStatus,
    User,
    Vehicle,
    VehicleType,
    Warehouse,
)
from .test_support import Role, Driver



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

    def test_customer_profile_put_persists_first_and_last_names(self) -> None:
        response = self.client.put(
            f"/api/customers/{self.customer.id}",
            data={
                "name": "Updated Customer Name",
                "firstName": "Updated",
                "lastName": "Customer",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["customer"]["firstName"], "Updated")
        self.assertEqual(payload["customer"]["lastName"], "Customer")
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.first_name, "Updated")
        self.assertEqual(self.customer.last_name, "Customer")


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
            phone="+63 9171234567",
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
        self.assertEqual(order_row["adminPhone"], self.staff_user.phone)
        self.assertEqual(order_row["sellerPhone"], self.staff_user.phone)
        self.assertIn("items", order_row)
        self.assertIn("logistics", order_row)
        self.assertIn("timeline", order_row)

    def test_order_payload_exposes_inventory_transaction_ids_only_after_delivery(self) -> None:
        warehouse = Warehouse.objects.create(
            name="Delivery Transaction Warehouse",
            code="WH-DELIVERY-TX",
            address="Warehouse Road",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
        )
        product = Product.objects.create(
            sku="SKU-DELIVERY-TX",
            name="Delivery Transaction Product",
            unit="case",
            price=100,
        )
        delivered_order = Order.objects.create(
            order_number="ORD-DELIVERY-TX",
            customer=self.customer,
            status=OrderStatus.DELIVERED,
            subtotal=100,
            total_amount=100,
            warehouse_id=warehouse.id,
        )
        delivered_item = OrderItem.objects.create(
            order=delivered_order,
            product=product,
            product_name=product.name,
            quantity=1,
            unit_price=100,
            total_price=100,
        )
        OrderTimeline.objects.create(order=delivered_order, delivered_at=timezone.now())
        delivery_transaction = InventoryTransaction.objects.create(
            warehouse=warehouse,
            product=product,
            type="OUT",
            quantity=1,
            reference_type="order_item",
            reference_id=delivered_item.id,
        )
        related_delivery_transaction = InventoryTransaction.objects.create(
            warehouse=warehouse,
            product=product,
            type="OUT",
            quantity=1,
            order_item=delivered_item,
            reference_type="mixed_case_component",
            reference_id="component-transaction",
        )

        pending_order = Order.objects.create(
            order_number="ORD-NOT-DELIVERED-TX",
            customer=self.customer,
            status=OrderStatus.PREPARING,
            subtotal=100,
            total_amount=100,
            warehouse_id=warehouse.id,
        )
        OrderItem.objects.create(
            order=pending_order,
            product=product,
            product_name=product.name,
            quantity=1,
            unit_price=100,
            total_price=100,
        )

        response = self.client.get(
            "/api/customer/orders",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 200)
        orders_by_id = {row["id"]: row for row in response.json()["orders"]}
        expected_transaction_ids = [delivery_transaction.id, related_delivery_transaction.id]
        self.assertEqual(orders_by_id[delivered_order.id]["inventoryTransactionIds"], expected_transaction_ids)
        self.assertEqual(orders_by_id[delivered_order.id]["inventoryTransactionId"], delivery_transaction.id)
        delivered_items_by_id = {row["id"]: row for row in orders_by_id[delivered_order.id]["items"]}
        self.assertEqual(delivered_items_by_id[delivered_item.id]["inventoryTransactionIds"], expected_transaction_ids)
        self.assertEqual(orders_by_id[pending_order.id]["inventoryTransactionIds"], [])
        self.assertIsNone(orders_by_id[pending_order.id]["inventoryTransactionId"])
        self.assertEqual(orders_by_id[pending_order.id]["items"][0]["inventoryTransactionIds"], [])

    def test_customer_orders_falls_back_to_completed_stop_pod_photo(self) -> None:
        order = Order.objects.create(
            order_number="ORD-CUSTOMER-LEGACY-POD",
            customer=self.customer,
            status=OrderStatus.DELIVERED,
            subtotal=100,
            total_amount=100,
        )
        driver = User.objects.create(
            email="legacy.pod.driver@example.com",
            password="hashed",
            name="Legacy POD Driver",
            role="DRIVER",
            is_active=True,
        )
        vehicle = Vehicle.objects.create(
            license_plate="LEGACY-POD-001",
            type=VehicleType.VAN,
            status="AVAILABLE",
            is_active=True,
        )
        trip = Trip.objects.create(
            trip_number="TRIP-CUSTOMER-LEGACY-POD",
            driver=driver,
            vehicle=vehicle,
            status=TripStatus.COMPLETED,
        )
        TripDropPoint.objects.create(
            trip=trip,
            order=order,
            sequence=1,
            status="COMPLETED",
            location_name="Customer Address",
            address="123 Main St",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            recipient_name="Customer Recipient",
            delivery_photo="/uploads/pods/legacy-customer-pod.jpg",
            actual_departure=timezone.now(),
        )

        response = self.client.get(
            "/api/customer/orders",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 200)
        payload = next(row for row in response.json()["orders"] if row["id"] == order.id)
        self.assertEqual(payload["pod"]["deliveryPhoto"], "/uploads/pods/legacy-customer-pod.jpg")
        self.assertEqual(payload["pod"]["recipientName"], "Customer Recipient")

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

    def test_customer_cancellation_requires_and_saves_reason(self) -> None:
        order = Order.objects.create(
            order_number="ORD-CANCEL-REASON-001",
            customer=self.customer,
            status=OrderStatus.PENDING,
            subtotal=100,
            total_amount=110,
        )

        missing_reason = self.client.patch(
            f"/api/customer/orders/{order.id}/cancel",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(missing_reason.status_code, 400)
        self.assertEqual(missing_reason.json()["error"], "A cancellation reason is required")

        response = self.client.patch(
            f"/api/customer/orders/{order.id}/cancel",
            data={"reason": "Incorrect delivery address"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(response.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.CANCELLED)
        self.assertEqual(order.cancellation_reason, "Incorrect delivery address")

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
            threshold=1,
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
                "shippingLatitude": 10.67,
                "shippingLongitude": 122.95,
                "shippingProvince": "Negros Occidental",
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


class CustomerOrdersPostApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.customer = Customer.objects.create(
            email="post.customer@example.com",
            password="hashed",
            name="Post Customer",
            phone="+1-555-1000",
            address="123 Test Ave",
            city="Talisay",
            province="Negros Occidental",
            zip_code="6115",
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
            threshold=2,
        )
        StockBatch.objects.create(
            batch_number="BATCH-POST-001",
            inventory=self.inventory,
            quantity=20,
            receipt_date=timezone.now(),
            status="ACTIVE",
        )

    def test_customer_orders_post_reserves_and_cancellation_releases_inventory(self) -> None:
        warehouse_staff = User.objects.create(
            email="order.alert.warehouse@example.com",
            password="hashed",
            name="Order Alert Warehouse Staff",
            role=Role.objects.create(name="WAREHOUSE_STAFF", description="Warehouse staff"),
            is_active=True,
        )
        response = self.client.post(
            "/api/customer/orders",
            data={
                "customerId": self.other_customer.id,
                "warehouseId": self.warehouse.id,
                "shippingAddress": "Overridden Shipping Address",
                "shippingLatitude": 10.67,
                "shippingLongitude": 122.95,
                "shippingCity": "Talisay",
                "shippingProvince": "Negros Occidental",
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

        self.assertEqual(response.status_code, 201, response.content.decode())
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
        # Added: customer checkout must create a navigable warehouse notification.
        self.assertTrue(
            Notification.objects.filter(
                user=warehouse_staff,
                title="New order received",
                type="ORDER",
                reference_type="order",
                reference_id=created_order.id,
                is_read=False,
            ).exists()
        )

        self.inventory.refresh_from_db()
        self.assertEqual(self.inventory.quantity, 20)
        self.assertEqual(self.inventory.reserved_quantity, 2)

        reserve_count = InventoryTransaction.objects.filter(
            reference_type="order_item_reserve",
            type="RESERVE",
        ).count()
        self.assertEqual(reserve_count, 1)

        cancelled = self.client.patch(
            f"/api/customer/orders/{created_order.id}/cancel",
            data={"reason": "Order no longer needed"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(cancelled.status_code, 200, cancelled.content)
        self.inventory.refresh_from_db()
        self.assertEqual(self.inventory.reserved_quantity, 0)

    def test_customer_orders_post_adds_standard_case_deposit_to_total(self) -> None:
        container_type = ContainerType.objects.create(
            code="RGB-TOTAL-330",
            name="330ml Returnable Glass Bottle",
            deposit_amount=2,
        )
        self.product.category = "Carbonated (Glass)"
        self.product.packaging_type = "RETURNABLE"
        self.product.quantity_per_unit = 24
        self.product.price = 240
        self.product.save(update_fields=["category", "packaging_type", "quantity_per_unit", "price", "updated_at"])
        ProductPackaging.objects.create(
            product=self.product,
            container_type=container_type,
            containers_per_case=24,
            is_primary=True,
            is_returnable=True,
            deposit_amount=2,
            case_deposit_amount=42,
        )

        response = self.client.post(
            "/api/customer/orders",
            data={
                "warehouseId": self.warehouse.id,
                "shippingLatitude": 10.67,
                "shippingLongitude": 122.95,
                "shippingCity": "Talisay",
                "shippingProvince": "Negros Occidental",
                "items": [{"productId": self.product.id, "quantity": 1}],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 201, response.content.decode())
        created_order = Order.objects.get(id=response.json()["order"]["id"])
        # The product subtotal and new container deposit must both be payable.
        self.assertEqual(created_order.subtotal, 240)
        self.assertEqual(created_order.total_amount, 330)
        self.assertEqual(created_order.items.get().net_deposit, 90)

    @patch("core.views_api._email_new_order_to_warehouse_staff")
    @patch("core.views_api._email_order_confirmed_to_customer")
    def test_second_purchase_request_submission_does_not_overbook_reserved_stock(
        self,
        _mock_approval_email,
        _mock_new_order_email,
    ) -> None:
        # The first submission reserves immediately. A second insufficient request
        # remains reviewable without reserving beyond physical stock.
        self.inventory.quantity = 10
        self.inventory.reserved_quantity = 0
        self.inventory.save(update_fields=["quantity", "reserved_quantity", "updated_at"])
        StockBatch.objects.filter(inventory=self.inventory).update(quantity=10)

        warehouse_staff = User.objects.create(
            email="approval.stock.staff@example.com",
            password="hashed",
            name="Approval Stock Staff",
            role="WAREHOUSE_STAFF",
            is_active=True,
        )
        staff_token = create_token(
            {
                "userId": warehouse_staff.id,
                "email": warehouse_staff.email,
                "name": warehouse_staff.name,
                "role": "WAREHOUSE_STAFF",
                "type": "staff",
            }
        )
        other_customer_token = create_token(
            {
                "userId": self.other_customer.id,
                "email": self.other_customer.email,
                "name": self.other_customer.name,
                "role": "CUSTOMER",
                "type": "customer",
            }
        )
        order_payload = {
            "warehouseId": self.warehouse.id,
            "shippingAddress": "Approval Test Address",
            "shippingCity": "Talisay",
            "shippingProvince": "Negros Occidental",
            "shippingLatitude": 10.67,
            "shippingLongitude": 122.95,
            "items": [{"productId": self.product.id, "quantity": 10}],
        }

        first_request = self.client.post(
            "/api/customer/orders",
            data=order_payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        second_request = self.client.post(
            "/api/customer/orders",
            data=order_payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {other_customer_token}",
        )
        self.assertEqual(first_request.status_code, 201, first_request.content)
        self.assertEqual(second_request.status_code, 201, second_request.content)
        first_order_id = first_request.json()["order"]["id"]
        second_order_id = second_request.json()["order"]["id"]

        first_approval = self.client.patch(
            f"/api/orders/{first_order_id}/status",
            data={"status": "CONFIRMED"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {staff_token}",
        )
        second_approval = self.client.patch(
            f"/api/orders/{second_order_id}/status",
            data={"status": "CONFIRMED"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {staff_token}",
        )
        self.assertEqual(first_approval.status_code, 200, first_approval.content)
        self.assertEqual(second_approval.status_code, 409, second_approval.content)
        self.assertIn("Available: 0 cases; required: 10 cases", second_approval.json()["error"])
        self.inventory.refresh_from_db()
        self.assertEqual(self.inventory.reserved_quantity, 10)
        self.assertLessEqual(self.inventory.reserved_quantity, self.inventory.quantity)
        self.assertEqual(Order.objects.get(id=second_order_id).request_status, "PENDING_APPROVAL")

    @patch("core.views_api._create_staff_notifications", side_effect=RuntimeError("notification unavailable"))
    @patch("core.views_api._email_new_order_to_warehouse_staff", side_effect=RuntimeError("email unavailable"))
    def test_customer_orders_post_succeeds_when_post_commit_notifications_fail(
        self,
        _mock_email,
        _mock_staff_notifications,
    ) -> None:
        # Fix: a committed purchase request must never be reported to the customer as failed.
        response = self.client.post(
            "/api/customer/orders",
            data={
                "warehouseId": self.warehouse.id,
                "shippingAddress": "Notification Failure Address",
                "shippingLatitude": 10.67,
                "shippingLongitude": 122.95,
                "shippingCity": "Talisay",
                "shippingProvince": "Negros Occidental",
                "items": [{"productId": self.product.id, "quantity": 2}],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 201, response.content.decode())
        self.assertTrue(response.json()["success"])
        self.assertEqual(Order.objects.filter(customer=self.customer).count(), 1)

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
            city="Talisay",
            province="Negros Occidental",
            zip_code="6115",
            latitude=10.6760,
            longitude=122.9500,
            is_active=True,
        )
        far_warehouse = Warehouse.objects.create(
            name="Far Warehouse",
            code="WH-POST-FAR-001",
            address="Far Road",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            latitude=9.3000,
            longitude=122.3000,
            is_active=True,
        )

        near_inventory = Inventory.objects.create(
            warehouse=near_warehouse,
            product=self.product,
            quantity=20,
            reserved_quantity=0,
            threshold=2,
        )
        far_inventory = Inventory.objects.create(
            warehouse=far_warehouse,
            product=self.product,
            quantity=20,
            reserved_quantity=0,
            threshold=2,
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
                "shippingLatitude": 10.6765,
                "shippingLongitude": 122.9505,
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

    def test_large_insufficient_request_remains_visible_without_over_reserving(self) -> None:
        warehouse_staff = User.objects.create(
            email="split.stock.staff@example.com",
            password="hashed",
            name="Split Stock Staff",
            role="WAREHOUSE_STAFF",
            is_active=True,
        )
        self.warehouse.manager_id = warehouse_staff.id
        self.warehouse.save(update_fields=["manager_id", "updated_at"])
        self.inventory.quantity = 200
        self.inventory.save(update_fields=["quantity", "updated_at"])
        StockBatch.objects.filter(inventory=self.inventory).update(quantity=200)

        response = self.client.post(
            "/api/customer/orders",
            data={
                "shippingLatitude": 10.67,
                "shippingLongitude": 122.95,
                "shippingCity": "Talisay",
                "shippingProvince": "Negros Occidental",
                "items": [{"productId": self.product.id, "quantity": 297}],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )

        self.assertEqual(response.status_code, 201, response.content.decode())
        created_order_id = response.json()["order"]["id"]
        self.assertEqual(response.json()["order"]["warehouseId"], self.warehouse.id)
        self.inventory.refresh_from_db()
        self.assertEqual(self.inventory.reserved_quantity, 0)

        staff_token = create_token({
            "userId": warehouse_staff.id,
            "email": warehouse_staff.email,
            "name": warehouse_staff.name,
            "role": "WAREHOUSE_STAFF",
            "type": "staff",
        })
        visible_response = self.client.get(
            "/api/orders",
            HTTP_AUTHORIZATION=f"Bearer {staff_token}",
        )
        self.assertEqual(visible_response.status_code, 200)
        self.assertIn(created_order_id, [row["id"] for row in visible_response.json()["orders"]])


class CustomerCreationPermissionContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.owner_user = User.objects.create(
            email="owner.customer.create@gmail.com",
            password="hashed",
            name="Owner User",
            role="SUPER_ADMIN",
            is_active=True,
        )
        self.owner_token = create_token(
            {
                "userId": self.owner_user.id,
                "email": self.owner_user.email,
                "name": self.owner_user.name,
                "role": self.owner_user.role,
                "type": "staff",
            }
        )

    def test_super_admin_cannot_create_customer_account(self) -> None:
        response = self.client.post(
            "/api/customers",
            data={
                "name": "Blocked Customer",
                "email": "blocked.customer.create@gmail.com",
                "password": "StrongPass1!",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.owner_token}",
        )
        self.assertEqual(response.status_code, 403)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Forbidden")


# API failures must remain diagnosable without leaking database or application details.



from .models import InventoryReservation, ReservationStatus  # noqa: E402


class PurchaseOrderApprovalStockTests(TestCase):
    """Approving a purchase request must reserve stock the catalog can see and deduct it once."""

    def setUp(self) -> None:
        self.client = Client()
        self.customer = Customer.objects.create(
            email="approval.stock.customer@example.com",
            password="hashed",
            name="Approval Stock Customer",
            phone="+1-555-2000",
            address="12 Test Ave",
            city="Talisay",
            province="Negros Occidental",
            zip_code="6115",
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
        self.staff = User.objects.create(
            email="approval.stock.warehouse@example.com",
            password="hashed",
            name="Approval Stock Warehouse",
            role="WAREHOUSE_STAFF",
            is_active=True,
        )
        self.staff_token = create_token(
            {
                "userId": self.staff.id,
                "email": self.staff.email,
                "name": self.staff.name,
                "role": "WAREHOUSE_STAFF",
                "type": "staff",
            }
        )
        self.warehouse = Warehouse.objects.create(
            name="Approval Warehouse",
            code="WH-APPROVAL-001",
            address="Warehouse Road",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
            is_active=True,
        )
        self.product = Product.objects.create(
            sku="SKU-APPROVAL-001",
            name="Approval Mineral Water",
            unit="case",
            quantity_per_unit=24,
            price=120,
            is_active=True,
        )
        self.inventory = Inventory.objects.create(
            warehouse=self.warehouse,
            product=self.product,
            quantity=116,
            reserved_quantity=0,
            threshold=2,
        )

    def _seed_batch(self, quantity: int = 116) -> StockBatch:
        return StockBatch.objects.create(
            batch_number=f"BATCH-APPROVAL-{quantity}",
            inventory=self.inventory,
            quantity=quantity,
            receipt_date=timezone.now(),
            expiry_date=timezone.now() + timedelta(days=90),
            status="ACTIVE",
        )

    def _checkout(self, items: list[dict]) -> str:
        response = self.client.post(
            "/api/customer/orders",
            data={
                "warehouseId": self.warehouse.id,
                "shippingAddress": "Approval Address",
                "shippingCity": "Talisay",
                "shippingProvince": "Negros Occidental",
                "shippingLatitude": 10.67,
                "shippingLongitude": 122.95,
                "items": items,
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(response.status_code, 201, response.content.decode())
        return response.json()["order"]["id"]

    def _catalog_available(self) -> int:
        response = self.client.get(
            "/api/products?pageSize=100",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(response.status_code, 200, response.content.decode())
        row = next(row for row in response.json()["products"] if row["id"] == self.product.id)
        return row["availableQuantity"]

    def _set_status(self, order_id: str, status: str, reason: str | None = None):
        body = {"status": status}
        if reason:
            body["reason"] = reason
        return self.client.patch(
            f"/api/orders/{order_id}/status",
            data=body,
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.staff_token}",
        )

    @patch("core.views_api._email_order_delivered_to_customer")
    @patch("core.views_api._email_purchase_request_approved_to_customer")
    @patch("core.views_api._email_new_order_to_warehouse_staff")
    def test_catalog_hides_reserved_cases_and_delivery_deducts_once(self, *_mocks) -> None:
        batch = self._seed_batch()
        self.assertEqual(self._catalog_available(), 116)

        order_id = self._checkout([{"productId": self.product.id, "quantity": 10}])
        self.inventory.refresh_from_db()
        self.assertEqual((self.inventory.quantity, self.inventory.reserved_quantity), (116, 10))
        # Fix: cases reserved for a purchase request are no longer sellable to other customers.
        self.assertEqual(self._catalog_available(), 106)

        approval = self._set_status(order_id, "CONFIRMED")
        self.assertEqual(approval.status_code, 200, approval.content.decode())
        self.inventory.refresh_from_db()
        # Approval must not reserve the same cases a second time.
        self.assertEqual((self.inventory.quantity, self.inventory.reserved_quantity), (116, 10))
        self.assertEqual(
            InventoryTransaction.objects.filter(reference_type="order_item_reserve", type="RESERVE").count(),
            1,
        )
        self.assertEqual(self._catalog_available(), 106)

        # Dispatch is trip-driven; jump straight to the delivery transition.
        Order.objects.filter(id=order_id).update(status=OrderStatus.OUT_FOR_DELIVERY)
        delivered = self._set_status(order_id, "DELIVERED")
        self.assertEqual(delivered.status_code, 200, delivered.content.decode())
        self.inventory.refresh_from_db()
        batch.refresh_from_db()
        self.assertEqual(
            (self.inventory.quantity, self.inventory.reserved_quantity, self.inventory.reserved_base_units),
            (106, 0, 0),
        )
        self.assertEqual(batch.quantity, 106)
        order_item = OrderItem.objects.get(order_id=order_id)
        out_rows = list(InventoryTransaction.objects.filter(type="OUT", reference_id=order_item.id))
        self.assertEqual([row.quantity for row in out_rows], [10])
        self.assertEqual((out_rows[0].previous_stock, out_rows[0].updated_stock), (116, 106))
        self.assertFalse(
            InventoryReservation.objects.filter(order_item=order_item, status=ReservationStatus.RESERVED).exists()
        )
        self.assertEqual(self._catalog_available(), 106)

        # A repeated delivery update is a no-op and never deducts again.
        again = self._set_status(order_id, "DELIVERED")
        self.assertEqual(again.status_code, 200, again.content.decode())
        self.inventory.refresh_from_db()
        self.assertEqual(self.inventory.quantity, 106)

    @patch("core.views_api._email_order_cancelled_to_customer")
    @patch("core.views_api._email_purchase_request_approved_to_customer")
    @patch("core.views_api._email_new_order_to_warehouse_staff")
    def test_staff_cancellation_after_approval_releases_reserved_cases(self, *_mocks) -> None:
        self._seed_batch()
        order_id = self._checkout([{"productId": self.product.id, "quantity": 10}])
        self.assertEqual(self._set_status(order_id, "CONFIRMED").status_code, 200)
        self.assertEqual(self._catalog_available(), 106)

        cancelled = self._set_status(order_id, "CANCELLED", reason="Customer requested cancellation")
        self.assertEqual(cancelled.status_code, 200, cancelled.content.decode())
        self.inventory.refresh_from_db()
        self.assertEqual(
            (self.inventory.quantity, self.inventory.reserved_quantity, self.inventory.reserved_base_units),
            (116, 0, 0),
        )
        self.assertEqual(self._catalog_available(), 116)

    @patch("core.views_api._email_order_cancelled_to_customer")
    @patch("core.views_api._email_new_order_to_warehouse_staff")
    def test_customer_cancellation_of_pending_request_releases_reserved_cases(self, *_mocks) -> None:
        self._seed_batch()
        order_id = self._checkout([{"productId": self.product.id, "quantity": 10}])
        self.assertEqual(self._catalog_available(), 106)

        cancelled = self.client.patch(
            f"/api/customer/orders/{order_id}/cancel",
            data={"reason": "Ordered by mistake"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(cancelled.status_code, 200, cancelled.content.decode())
        self.inventory.refresh_from_db()
        self.assertEqual((self.inventory.reserved_quantity, self.inventory.reserved_base_units), (0, 0))
        self.assertEqual(self._catalog_available(), 116)

    @patch("core.views_api._email_order_rejected_to_customer")
    @patch("core.views_api._email_new_order_to_warehouse_staff")
    def test_staff_rejection_of_pending_request_releases_reserved_cases(self, *_mocks) -> None:
        self._seed_batch()
        order_id = self._checkout([{"productId": self.product.id, "quantity": 10}])
        self.assertEqual(self._catalog_available(), 106)

        rejected = self._set_status(order_id, "REJECTED", reason="Out of delivery area")
        self.assertEqual(rejected.status_code, 200, rejected.content.decode())
        self.inventory.refresh_from_db()
        self.assertEqual((self.inventory.reserved_quantity, self.inventory.reserved_base_units), (0, 0))
        self.assertEqual(self._catalog_available(), 116)

    @patch("core.views_api._email_new_order_to_warehouse_staff")
    def test_approval_rechecks_stock_and_returns_conflict_without_reserving(self, *_mocks) -> None:
        self._seed_batch(5)
        self.inventory.quantity = 5
        self.inventory.save(update_fields=["quantity", "updated_at"])
        order_id = self._checkout([{"productId": self.product.id, "quantity": 10}])
        self.inventory.refresh_from_db()
        # The oversized request stays reviewable but reserves nothing at submission.
        self.assertEqual(self.inventory.reserved_quantity, 0)

        approval = self._set_status(order_id, "CONFIRMED")
        self.assertEqual(approval.status_code, 409, approval.content.decode())
        self.assertEqual(
            approval.json()["error"],
            "Insufficient stock for Approval Mineral Water. Available: 5 cases; required: 10 cases.",
        )
        self.inventory.refresh_from_db()
        self.assertEqual(self.inventory.reserved_quantity, 0)
        order = Order.objects.get(id=order_id)
        self.assertEqual((order.status, order.request_status), (OrderStatus.PENDING, "PENDING_APPROVAL"))
        self.assertFalse(order.purchase_order_number)
        self.assertFalse(InventoryTransaction.objects.filter(reference_type="order_item_reserve").exists())

    @patch("core.views_api._email_new_order_to_warehouse_staff")
    def test_approval_is_all_or_nothing_across_products(self, *_mocks) -> None:
        self._seed_batch()
        soda = Product.objects.create(
            sku="SKU-APPROVAL-002",
            name="Approval Soda",
            unit="case",
            quantity_per_unit=24,
            price=150,
            is_active=True,
        )
        soda_inventory = Inventory.objects.create(
            warehouse=self.warehouse,
            product=soda,
            quantity=3,
            reserved_quantity=0,
            threshold=1,
        )
        StockBatch.objects.create(
            batch_number="BATCH-APPROVAL-SODA",
            inventory=soda_inventory,
            quantity=3,
            receipt_date=timezone.now(),
            status="ACTIVE",
        )
        order_id = self._checkout([
            {"productId": self.product.id, "quantity": 10},
            {"productId": soda.id, "quantity": 4},
        ])
        # Submission reserves nothing when any line cannot be fulfilled.
        self.inventory.refresh_from_db()
        soda_inventory.refresh_from_db()
        self.assertEqual((self.inventory.reserved_quantity, soda_inventory.reserved_quantity), (0, 0))

        approval = self._set_status(order_id, "CONFIRMED")
        self.assertEqual(approval.status_code, 409, approval.content.decode())
        self.assertEqual(
            approval.json()["error"],
            "Insufficient stock for Approval Soda. Available: 3 cases; required: 4 cases.",
        )
        self.inventory.refresh_from_db()
        soda_inventory.refresh_from_db()
        # Nothing may stay reserved for the product that did have enough stock.
        self.assertEqual((self.inventory.reserved_quantity, soda_inventory.reserved_quantity), (0, 0))
        self.assertEqual(self._catalog_available(), 116)
        self.assertEqual(Order.objects.get(id=order_id).request_status, "PENDING_APPROVAL")

    @patch("core.views_api._email_new_order_to_warehouse_staff")
    def test_approval_counts_stock_already_reserved_by_other_requests(self, *_mocks) -> None:
        self._seed_batch(12)
        self.inventory.quantity = 12
        self.inventory.save(update_fields=["quantity", "updated_at"])
        self._checkout([{"productId": self.product.id, "quantity": 8}])
        self.assertEqual(self._catalog_available(), 4)
        second_id = self._checkout([{"productId": self.product.id, "quantity": 6}])

        approval = self._set_status(second_id, "CONFIRMED")
        self.assertEqual(approval.status_code, 409, approval.content.decode())
        self.assertEqual(
            approval.json()["error"],
            "Insufficient stock for Approval Mineral Water. Available: 4 cases; required: 6 cases.",
        )
        self.inventory.refresh_from_db()
        self.assertEqual(self.inventory.reserved_quantity, 8)

    @patch("core.views_api._email_new_order_to_warehouse_staff")
    def test_unbatched_legacy_inventory_is_not_sellable_and_approval_says_so(self, *_mocks) -> None:
        # Legacy rows carry a quantity but no batch, so nothing can be allocated FEFO.
        self.assertEqual(self._catalog_available(), 0)
        order_id = self._checkout([{"productId": self.product.id, "quantity": 10}])
        self.inventory.refresh_from_db()
        self.assertEqual(self.inventory.reserved_quantity, 0)

        approval = self._set_status(order_id, "CONFIRMED")
        self.assertEqual(approval.status_code, 409, approval.content.decode())
        # Fix: the message used to claim 116 cases were available while refusing the approval.
        self.assertEqual(
            approval.json()["error"],
            "Insufficient stock for Approval Mineral Water. Available: 0 cases; required: 10 cases.",
        )
        self.inventory.refresh_from_db()
        self.assertEqual((self.inventory.quantity, self.inventory.reserved_quantity), (116, 0))
