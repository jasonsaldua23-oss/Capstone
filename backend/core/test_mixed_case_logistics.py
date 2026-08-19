import json
from datetime import timedelta
from unittest.mock import patch

from django.test import RequestFactory, TestCase
from django.utils import timezone

from .mixed_case import reserve_order_item
from .models import (
    Inventory,
    InventoryQuantityUnit,
    InventoryReservation,
    InventoryTransaction,
    OrderStatus,
    ReservationStatus,
    RoleType,
    StockBatch,
    Trip,
    TripDropPoint,
    User,
    Vehicle,
)
from .test_mixed_case import MixedCaseFixtureMixin
from .views_api import (
    _assign_order_items_to_trip_for_warehouse,
    _build_order_item_trip_assignments_map,
    _build_order_item_warehouse_allocations_map,
    _build_order_warehouse_allocations_map,
    _calculate_order_weight,
    trip_drop_point_update,
    trips_route_plan,
)


class MixedCaseLogisticsTests(MixedCaseFixtureMixin, TestCase):
    def setUp(self):
        self.build_fixture(case_stock=10)
        self.customer.email = "customer@capstone.local"
        self.customer.name = "Beverage Customer"
        self.customer.latitude = 10.72
        self.customer.longitude = 122.56
        self.customer.save(update_fields=["email", "name", "latitude", "longitude", "updated_at"])

        for product, weight in zip(self.products, (10.0, 20.0, 8.0)):
            product.weight = weight
            product.save(update_fields=["weight", "updated_at"])

        self.driver = User.objects.create(
            email="driver@capstone.local",
            password="hashed",
            name="Route Driver",
            role=RoleType.DRIVER,
            license_number="LIC-MIX-001",
        )
        self.vehicle = Vehicle.objects.create(
            license_plate="CAP-1001",
            type="TRUCK",
            capacity=100,
            driver=self.driver,
        )
        self.factory = RequestFactory()

    def _reserved_order(self, number: str, *, status: str = OrderStatus.CONFIRMED):
        order, item = self.create_mixed_item(number=number)
        order.status = status
        order.shipping_name = self.customer.name
        order.shipping_phone = "+63-900-000-0000"
        order.shipping_address = "1 Route Street"
        order.shipping_city = "Bacolod"
        order.shipping_province = "Negros Occidental"
        order.shipping_zip_code = "6100"
        order.shipping_latitude = 10.72
        order.shipping_longitude = 122.56
        order.save(
            update_fields=[
                "status",
                "shipping_name",
                "shipping_phone",
                "shipping_address",
                "shipping_city",
                "shipping_province",
                "shipping_zip_code",
                "shipping_latitude",
                "shipping_longitude",
                "updated_at",
            ]
        )
        reserve_order_item(item, "FEFO", "logistics-test")
        return order, item

    def _trip_with_drop_point(self, order, suffix: str):
        trip = Trip.objects.create(
            trip_number=f"TRIP-{suffix}",
            driver=self.driver,
            vehicle=self.vehicle,
            warehouse_id=self.warehouse.id,
            total_drop_points=1,
        )
        drop_point = TripDropPoint.objects.create(
            trip=trip,
            order=order,
            sequence=1,
            location_name=order.shipping_name,
            address=order.shipping_address,
            city=order.shipping_city,
            province=order.shipping_province,
            zip_code=order.shipping_zip_code,
        )
        return trip, drop_point

    def _patch_drop_point(self, trip, drop_point, body):
        request = self.factory.patch(
            f"/api/trips/{trip.id}/drop-points/{drop_point.id}",
            data=json.dumps(body),
            content_type="application/json",
        )
        staff = ({"userId": "admin-logistics", "name": "Admin", "role": RoleType.ADMIN}, None)
        with patch("core.views_api._require_staff", return_value=staff):
            return trip_drop_point_update(request, trip.id, drop_point.id)

    def test_trip_assignment_uses_component_rows_and_item_case_counts(self):
        order, item = self._reserved_order("ORD-LOG-ASSIGN")
        trip = Trip.objects.create(
            trip_number="TRIP-LOG-ASSIGN",
            driver=self.driver,
            vehicle=self.vehicle,
            warehouse_id=self.warehouse.id,
        )

        item_allocations = _build_order_item_warehouse_allocations_map([order.id])
        self.assertEqual(item_allocations[order.id][item.id][0]["allocatedQty"], 1)
        self.assertEqual(_build_order_warehouse_allocations_map([order.id])[order.id][0]["allocatedQty"], 1)

        created = _assign_order_items_to_trip_for_warehouse(
            trip=trip,
            order_ids=[order.id],
            warehouse_id=self.warehouse.id,
            performed_by="admin-logistics",
        )
        self.assertEqual(created, 2)

        assignments = list(
            InventoryTransaction.objects.filter(
                reference_type="order_item_trip_assign",
                reference_id=item.id,
                type="ASSIGN",
            ).order_by("product_id")
        )
        self.assertEqual(len(assignments), 2)
        self.assertEqual({row.product_id for row in assignments}, {self.products[0].id, self.products[1].id})
        self.assertEqual({row.quantity for row in assignments}, {12})
        self.assertEqual({row.quantity_unit for row in assignments}, {InventoryQuantityUnit.BASE_UNIT})
        self.assertTrue(all(row.order_item_id == item.id for row in assignments))
        self.assertTrue(all(row.mixed_case_component_id for row in assignments))
        self.assertEqual({row.case_capacity_snapshot for row in assignments}, {24})
        self.assertEqual({row.case_count_snapshot for row in assignments}, {1})

        trip_assignments = _build_order_item_trip_assignments_map([order.id], trip_id=trip.id)
        self.assertEqual(trip_assignments[order.id][item.id][0]["allocatedQty"], 1)
        self.assertEqual(
            _assign_order_items_to_trip_for_warehouse(
                trip=trip,
                order_ids=[order.id],
                warehouse_id=self.warehouse.id,
                performed_by="admin-logistics",
            ),
            0,
        )
        self.assertEqual(
            InventoryTransaction.objects.filter(
                reference_type="order_item_trip_assign",
                reference_id=item.id,
                type="ASSIGN",
            ).count(),
            2,
        )

    def test_route_plan_serializes_mixed_case_and_weight_uses_components(self):
        order, _ = self._reserved_order("ORD-LOG-ROUTE")
        self.assertAlmostEqual(_calculate_order_weight(order), 15.0)

        request = self.factory.get("/api/trips/route-plan", {"warehouseId": self.warehouse.id})
        staff = ({"userId": "admin-logistics", "name": "Admin", "role": RoleType.ADMIN}, None)
        with (
            patch("core.views_api._require_staff", return_value=staff),
            patch("core.views_api._resolve_single_warehouse", return_value=(self.warehouse, None)),
            patch("core.views_api._real_orders", side_effect=lambda qs: qs),
        ):
            response = trips_route_plan(request)

        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        route_order = next(row for row in payload["orders"] if row["id"] == order.id)
        self.assertIn("Mixed Case 1 mixed case(s)", route_order["products"])
        self.assertEqual(route_order["allocatedQtyForSelectedWarehouse"], 1)
        self.assertEqual(len(route_order["productAllocations"]), 1)
        allocation = route_order["productAllocations"][0]
        self.assertEqual(allocation["itemType"], "MIXED_CASE")
        self.assertEqual(allocation["unitLabel"], "mixed case(s)")
        self.assertEqual(allocation["allocatedQtyForSelectedWarehouse"], 1)
        self.assertEqual(len(allocation["components"]), 2)

    def test_failed_delivery_rolls_back_drop_point_and_partial_consumption(self):
        order, _ = self._reserved_order("ORD-LOG-ROLLBACK", status=OrderStatus.OUT_FOR_DELIVERY)
        trip, drop_point = self._trip_with_drop_point(order, "LOG-ROLLBACK")
        StockBatch.objects.filter(inventory__product_id__in=[self.products[0].id, self.products[1].id]).update(
            quantity=0
        )

        response = self._patch_drop_point(
            trip,
            drop_point,
            {
                "status": "COMPLETED",
                "recipientName": "Receiver",
                "deliveryPhoto": "proof.jpg",
            },
        )

        self.assertEqual(response.status_code, 400)
        drop_point.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(drop_point.status, "PENDING")
        self.assertIsNone(drop_point.recipient_name)
        self.assertEqual(order.status, OrderStatus.OUT_FOR_DELIVERY)
        self.assertIsNone(order.pod_recipient_name)
        self.assertEqual(
            set(InventoryReservation.objects.filter(order_item__order=order).values_list("status", flat=True)),
            {ReservationStatus.RESERVED},
        )

    def test_reschedule_keeps_reservations_and_terminal_failure_always_releases(self):
        rescheduled_order, _ = self._reserved_order(
            "ORD-LOG-RESCHEDULE",
            status=OrderStatus.OUT_FOR_DELIVERY,
        )
        rescheduled_trip, rescheduled_drop = self._trip_with_drop_point(
            rescheduled_order,
            "LOG-RESCHEDULE",
        )
        response = self._patch_drop_point(
            rescheduled_trip,
            rescheduled_drop,
            {
                "status": "FAILED",
                "rescheduleRequested": True,
                "rescheduleWindow": "tomorrow",
                "rescheduleDate": (timezone.now() + timedelta(days=1)).date().isoformat(),
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            set(
                InventoryReservation.objects.filter(order_item__order=rescheduled_order).values_list(
                    "status", flat=True
                )
            ),
            {ReservationStatus.RESERVED},
        )

        cancelled_order, _ = self._reserved_order(
            "ORD-LOG-CANCEL",
            status=OrderStatus.OUT_FOR_DELIVERY,
        )
        cancelled_trip, cancelled_drop = self._trip_with_drop_point(cancelled_order, "LOG-CANCEL")
        response = self._patch_drop_point(
            cancelled_trip,
            cancelled_drop,
            {"status": "FAILED", "releaseInventory": False},
        )
        self.assertEqual(response.status_code, 200)
        cancelled_order.refresh_from_db()
        self.assertEqual(cancelled_order.status, OrderStatus.CANCELLED)
        self.assertEqual(
            set(
                InventoryReservation.objects.filter(order_item__order=cancelled_order).values_list(
                    "status", flat=True
                )
            ),
            {ReservationStatus.RELEASED},
        )
        self.assertEqual(
            set(
                InventoryReservation.objects.filter(order_item__order=rescheduled_order).values_list(
                    "status", flat=True
                )
            ),
            {ReservationStatus.RESERVED},
        )
        self.assertEqual(
            set(Inventory.objects.filter(product_id__in=[self.products[0].id, self.products[1].id]).values_list("reserved_base_units", flat=True)),
            {12},
        )
