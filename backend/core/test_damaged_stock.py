"""Damaged warehouse stock: set aside from sellable stock, then disposed, returned or put back."""

import json
import tempfile
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from .auth import create_token
from .models import (
    Customer,
    DamagedStock,
    Inventory,
    InventoryReservation,
    InventoryTransaction,
    Notification,
    Order,
    OrderItem,
    Product,
    Replacement,
    ReplacementLine,
    StockBatch,
    User,
    Warehouse,
)
from .sync_stamps import scopes_for_path
from .test_upload_storage import PNG_BYTES


def _user(email: str, name: str, role: str) -> User:
    return User.objects.create(email=email, password="hashed", name=name, role=role, is_active=True)


class DamagedStockTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.staff = _user("damage.staff@example.com", "Wally Warehouse", "WAREHOUSE_STAFF")
        self.other_staff = _user("damage.other@example.com", "Olga Other", "WAREHOUSE_STAFF")
        self.admin = _user("damage.admin@example.com", "Ana Admin", "ADMIN")
        self.driver = _user("damage.driver@example.com", "Juan Driver", "DRIVER")
        self.warehouse = Warehouse.objects.create(
            name="Silay Warehouse", code="WH-DMG-1", address="Rizal St", city="Silay",
            province="Negros Occidental", zip_code="6116", manager_id=self.staff.id,
        )
        self.other_warehouse = Warehouse.objects.create(
            name="Talisay Warehouse", code="WH-DMG-2", address="Mabini St", city="Talisay",
            province="Negros Occidental", zip_code="6115", manager_id=self.other_staff.id,
        )
        self.product = Product.objects.create(
            sku="PEPS-12OZ", name="Pepsi 12oz", quantity_per_unit=24, price=240,
            case_price=Decimal("240.00"), retail_unit_price=Decimal("12.00"), sizes=["12oz"],
        )
        self.inventory = Inventory.objects.create(warehouse=self.warehouse, product=self.product, quantity=10, loose_bottles=5)
        self.batch = StockBatch.objects.create(
            inventory=self.inventory, batch_number="B-OLD", quantity=6, loose_units=5,
            receipt_date=timezone.now() - timedelta(days=10), expiry_date=timezone.now() + timedelta(days=90),
        )
        self.batch_b = StockBatch.objects.create(
            inventory=self.inventory, batch_number="B-NEW", quantity=4,
            receipt_date=timezone.now(), expiry_date=timezone.now() + timedelta(days=120),
        )

    # -- helpers -------------------------------------------------------------------

    def auth(self, user: User) -> dict[str, str]:
        token = create_token({"userId": user.id, "email": user.email, "name": user.name, "role": user.role, "type": "staff"})
        return {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    def record(self, user: User | None = None, **overrides):
        body = {
            "requestId": "dmg-1",
            "batchId": self.batch.id,
            "cases": 2,
            "looseUnits": 0,
            "cause": "BROKEN_IN_WAREHOUSE",
            "description": "Two cases fell off the pallet jack; most bottles shattered.",
        }
        body.update(overrides)
        return self.client.post(
            "/api/damaged-stock", data=json.dumps(body), content_type="application/json", **self.auth(user or self.staff)
        )

    def resolve(self, record_id: str, action: str, user: User | None = None, notes: str = ""):
        return self.client.patch(
            f"/api/damaged-stock/{record_id}", data=json.dumps({"action": action, "notes": notes}),
            content_type="application/json", **self.auth(user or self.staff),
        )

    def stock(self) -> tuple[int, int, int, int]:
        self.inventory.refresh_from_db()
        self.batch.refresh_from_db()
        return self.inventory.quantity, self.inventory.loose_bottles, self.batch.quantity, self.batch.loose_units

    def movements(self, record_id: str) -> list[tuple[str, str, int]]:
        return list(
            InventoryTransaction.objects.filter(reference_id=record_id)
            .order_by("created_at", "id")
            .values_list("type", "quantity_unit", "quantity")
        )

    # -- recording -----------------------------------------------------------------

    def test_only_warehouse_staff_record_damage(self) -> None:
        self.assertEqual(self.client.post("/api/damaged-stock", data="{}", content_type="application/json").status_code, 401)
        for user in (self.admin, self.driver):
            response = self.record(user)
            self.assertEqual(response.status_code, 403, response.content)
            self.assertEqual(response.json()["error"], "Only warehouse staff can record or resolve damaged stock")
        self.assertEqual(self.client.get("/api/damaged-stock", **self.auth(self.driver)).status_code, 403)
        self.assertEqual(self.stock(), (10, 5, 6, 5))

    def test_damaged_cases_leave_sellable_stock_at_once(self) -> None:
        response = self.record()

        self.assertEqual(response.status_code, 201, response.content)
        record = response.json()["record"]
        self.assertEqual(record["recordNumber"], f"DMG-{timezone.localdate().year}-0001")
        self.assertEqual((record["status"], record["statusLabel"]), ("PENDING", "Pending"))
        self.assertEqual(record["quantityLabel"], "2 cases")
        self.assertEqual(record["batchNumber"], "B-OLD")
        self.assertEqual(record["causeLabel"], "Broken or dropped in the warehouse")
        self.assertTrue(record["canManage"])
        self.assertEqual(self.stock(), (8, 5, 4, 5))
        self.assertEqual(self.movements(record["id"]), [("OUT", "CASE", 2)])
        movement = InventoryTransaction.objects.get(reference_id=record["id"])
        self.assertEqual((movement.reference_type, movement.previous_stock, movement.updated_stock), ("damaged_stock", 10, 8))
        self.assertEqual(movement.performed_by, "Wally Warehouse")
        # Administrators hear about the loss; the warehouse that recorded it does not.
        alert = Notification.objects.get(reference_type="damaged_stock", reference_id=record["id"])
        self.assertEqual(alert.user_id, self.admin.id)
        self.assertIn("2 cases of Pepsi 12oz (batch B-OLD)", alert.message)

    def test_broken_bottles_open_a_case_once_the_loose_ones_run_out(self) -> None:
        # 5 loose bottles in the batch, 7 broken: one case is opened, 22 good bottles stay.
        record = self.record(cases=0, looseUnits=7, cause="LEAKING_OR_SPOILED", description="Leaking caps").json()["record"]

        self.assertEqual(record["casesOpened"], 1)
        self.assertEqual(record["quantityLabel"], "7 bottles")
        self.assertEqual(self.stock(), (9, 22, 5, 22))
        self.assertEqual(self.movements(record["id"]), [("OUT", "CASE", 1), ("IN", "BASE_UNIT", 24), ("OUT", "BASE_UNIT", 7)])

    def test_damage_cannot_exceed_the_batch(self) -> None:
        response = self.record(cases=7)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "Batch B-OLD holds 6 cases and 5 bottles; record no more than that.")
        response = self.record(cases=6, looseUnits=6)  # the loose ones would need a seventh case
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.stock(), (10, 5, 6, 5))
        self.assertFalse(DamagedStock.objects.exists())

    def test_stock_reserved_for_orders_is_protected(self) -> None:
        order = Order.objects.create(order_number="ORD-DMG-1", warehouse_id=self.warehouse.id, subtotal=0, total_amount=0)
        item = OrderItem.objects.create(order=order, product=self.product, quantity=5, unit_price=0, total_price=0)
        InventoryReservation.objects.create(
            inventory=self.inventory, order_item=item, product=self.product, stock_batch=self.batch,
            quantity_base_units=120, standard_case_quantity=5,
        )

        response = self.record(cases=2)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.json()["error"],
            "That would use stock reserved for orders. Only 1 case and 5 bottles of batch B-OLD are free.",
        )
        self.assertEqual(self.stock(), (10, 5, 6, 5))
        # The free case can still be set aside.
        self.assertEqual(self.record(cases=1).status_code, 201)

    def test_recording_is_validated(self) -> None:
        cases = [
            ({"requestId": ""}, 400, "A requestId of 1 to 120 characters is required"),
            ({"cases": 0, "looseUnits": 0}, 400, "Enter how many cases or bottles are damaged"),
            ({"cases": -1}, 400, "Enter whole numbers of cases and bottles"),
            ({"cases": 1.5}, 400, "Enter whole numbers of cases and bottles"),
            ({"cause": "STOLEN"}, 400, "Choose what caused the damage"),
            ({"description": "  "}, 400, "Describe the damage"),
            ({"description": "x" * 1001}, 400, "The description must be 1000 characters or fewer"),
            ({"photoUrl": "/api/media/pods/pod-1.png"}, 400, "Attach a photo uploaded from this account"),
            ({"batchId": "missing"}, 404, "Stock batch not found"),
        ]
        for overrides, status, message in cases:
            with self.subTest(overrides=overrides):
                response = self.record(**overrides)
                self.assertEqual(response.status_code, status, response.content)
                self.assertEqual(response.json()["error"], message)
        self.assertFalse(DamagedStock.objects.exists())

    def test_a_retried_recording_takes_stock_out_once(self) -> None:
        first = self.record().json()["record"]
        second = self.record()

        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(second.json()["record"]["id"], first["id"])
        self.assertEqual(self.stock(), (8, 5, 4, 5))
        self.assertEqual(InventoryTransaction.objects.filter(reference_type="damaged_stock").count(), 1)
        reused = self.record(cases=1)
        self.assertEqual(reused.status_code, 409)
        self.assertEqual(reused.json()["error"], "This requestId was already used for another damaged stock record")

    def test_a_warehouse_only_handles_its_own_stock(self) -> None:
        response = self.record(self.other_staff)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"], "This batch is outside your assigned warehouse")
        record = self.record().json()["record"]
        self.assertEqual(self.resolve(record["id"], "DISPOSE", self.other_staff).status_code, 403)
        self.assertEqual(self.client.get("/api/damaged-stock", **self.auth(self.other_staff)).json()["records"], [])

    # -- resolving -----------------------------------------------------------------

    def test_disposing_records_the_loss_and_joins_the_disposal_history(self) -> None:
        record = self.record(cases=1, looseUnits=3).json()["record"]
        stock_before = self.stock()

        response = self.resolve(record["id"], "DISPOSE", notes="Crushed and sent to the recycler.")

        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()["record"]
        self.assertEqual(body["status"], "DISPOSED")
        self.assertEqual(body["lossAmount"], 276.0)  # 1 x 240 + 3 x 12
        self.assertEqual(body["resolvedBy"], "Wally Warehouse")
        self.assertFalse(body["canManage"])
        self.assertEqual(self.stock(), stock_before)

        history = self.client.get("/api/stock-batches/disposals?pageSize=20", **self.auth(self.staff)).json()
        self.assertEqual(history["total"], 2)
        rows = {row["quantityUnit"]: row for row in history["disposals"]}
        self.assertEqual((rows["CASE"]["quantity"], Decimal(str(rows["CASE"]["lossAmount"]))), (1, Decimal("240.00")))
        self.assertEqual((rows["BASE_UNIT"]["quantity"], Decimal(str(rows["BASE_UNIT"]["lossAmount"]))), (3, Decimal("36.00")))
        self.assertTrue(rows["CASE"]["reason"].startswith(f"Damaged ({record['recordNumber']})"))
        self.assertEqual(rows["CASE"]["batchNumber"], "B-OLD")
        # Other warehouses do not see it.
        self.assertEqual(self.client.get("/api/stock-batches/disposals", **self.auth(self.other_staff)).json()["total"], 0)

    def test_putting_stock_back_returns_it_to_its_batch(self) -> None:
        record = self.record(batchId=self.batch_b.id, cases=4, description="Dented cans, checking").json()["record"]
        self.batch_b.refresh_from_db()
        self.assertEqual((self.batch_b.quantity, self.batch_b.status), (0, "DEPLETED"))

        response = self.resolve(record["id"], "RESTOCK", notes="Only the outer boxes were dented.")

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["record"]["statusLabel"], "Back in stock")
        self.batch_b.refresh_from_db()
        self.assertEqual((self.batch_b.quantity, self.batch_b.status), (4, "HEALTHY"))
        self.assertEqual(self.stock()[0], 10)
        self.assertEqual(
            list(InventoryTransaction.objects.filter(reference_type="damaged_stock_restocked").values_list("type", "quantity")),
            [("IN", 4)],
        )

    def test_returning_to_the_supplier_changes_no_stock_and_records_no_loss(self) -> None:
        record = self.record(cause="DAMAGED_ON_ARRIVAL").json()["record"]
        stock_before = self.stock()

        body = self.resolve(record["id"], "RETURN_TO_SUPPLIER", notes="Returned with RMA 4471").json()["record"]

        self.assertEqual(body["status"], "RETURNED_TO_SUPPLIER")
        self.assertIsNone(body["lossAmount"])
        self.assertEqual(body["resolutionNotes"], "Returned with RMA 4471")
        self.assertEqual(self.stock(), stock_before)

    def test_a_record_is_resolved_once(self) -> None:
        record = self.record().json()["record"]
        self.resolve(record["id"], "DISPOSE")

        self.assertEqual(self.resolve(record["id"], "DISPOSE").status_code, 200)  # a retry
        refused = self.resolve(record["id"], "RESTOCK")
        self.assertEqual(refused.status_code, 409)
        self.assertEqual(refused.json()["error"], "This damaged stock is already disposed")
        self.assertEqual(self.resolve(record["id"], "THROW_AWAY").status_code, 400)
        self.assertEqual(self.resolve(record["id"], "DISPOSE", self.admin).status_code, 403)
        self.assertEqual(self.resolve("missing", "DISPOSE").status_code, 404)

    # -- reading -------------------------------------------------------------------

    def test_list_summarises_every_status_for_the_reader(self) -> None:
        disposed = self.record(requestId="a").json()["record"]
        self.resolve(disposed["id"], "DISPOSE")
        self.record(requestId="b", cases=1)
        self.record(requestId="c", batchId=self.batch_b.id, cases=1, cause="DAMAGED_IN_TRANSIT")

        admin_view = self.client.get("/api/damaged-stock", **self.auth(self.admin)).json()
        self.assertEqual(admin_view["total"], 3)
        self.assertEqual(admin_view["summary"], {
            "pending": 2, "disposed": 1, "returnedToSupplier": 0, "restocked": 0, "lossAmount": 480.0,
        })
        # The admin watches; only the warehouse acts.
        self.assertTrue(all(not row["canManage"] for row in admin_view["records"]))

        pending = self.client.get("/api/damaged-stock?status=PENDING", **self.auth(self.staff)).json()
        self.assertEqual(pending["total"], 2)
        self.assertTrue(all(row["canManage"] for row in pending["records"]))
        found = self.client.get("/api/damaged-stock?search=B-NEW", **self.auth(self.staff)).json()
        self.assertEqual([row["batchNumber"] for row in found["records"]], ["B-NEW"])
        self.assertEqual(self.client.get("/api/damaged-stock?status=LOST", **self.auth(self.staff)).status_code, 400)

    def test_damaged_items_customers_reported_are_listed_read_only(self) -> None:
        customer = Customer.objects.create(email="store@example.com", password="hashed", name="Lopez Store")
        order = Order.objects.create(
            order_number="ORD-CLAIM-1", customer=customer, warehouse_id=self.warehouse.id, subtotal=480, total_amount=480,
        )
        item = OrderItem.objects.create(order=order, product=self.product, quantity=2, unit_price=240, total_price=480)
        replacement = Replacement.objects.create(
            replacement_number="RPL-2026-0001", order=order, customer_id=customer.id, reason="Cracked bottle",
            status="UNDER_REVIEW", pickup_address="Purok 1", pickup_city="Silay", pickup_province="Negros Occidental",
            pickup_zip_code="6116",
        )
        ReplacementLine.objects.create(
            replacement=replacement, product=self.product, product_name="Pepsi 12oz", product_sku="PEPS-12OZ",
            base_unit_label="bottle", requested_base_units=6, reason="Cracked bottle", original_order_item=item,
        )

        rows = self.client.get("/api/damaged-stock/customer-reports", **self.auth(self.staff)).json()["reports"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(
            (rows[0]["replacementNumber"], rows[0]["customerName"], rows[0]["quantity"], rows[0]["unitLabel"], rows[0]["status"]),
            ("RPL-2026-0001", "Lopez Store", 6, "bottle", "UNDER_REVIEW"),
        )
        self.assertEqual(len(self.client.get("/api/damaged-stock/customer-reports", **self.auth(self.admin)).json()["reports"]), 1)
        self.assertEqual(self.client.get("/api/damaged-stock/customer-reports", **self.auth(self.other_staff)).json()["reports"], [])
        self.assertEqual(self.client.get("/api/damaged-stock/customer-reports", **self.auth(self.driver)).status_code, 403)

    # -- photos and sync ------------------------------------------------------------

    def test_photo_is_attached_by_its_uploader_and_shown_to_its_warehouse(self) -> None:
        with tempfile.TemporaryDirectory() as media_root, override_settings(
            MEDIA_ROOT=Path(media_root), SUPABASE_URL="", SUPABASE_SERVICE_ROLE_KEY="",
        ):
            upload = lambda user: self.client.post(  # noqa: E731
                "/api/damaged-stock/photo",
                data={"file": SimpleUploadedFile("broken.png", PNG_BYTES, content_type="image/png")},
                **self.auth(user),
            )
            self.assertEqual(upload(self.admin).status_code, 403)
            response = upload(self.staff)
            self.assertEqual(response.status_code, 200, response.content)
            photo_url = response.json()["imageUrl"]
            self.assertTrue(photo_url.startswith(f"/api/media/damaged-stock-photos/damaged-stock-{self.staff.id}-"))

            record = self.record(photoUrl=photo_url).json()["record"]
            self.assertEqual(record["photoUrl"], photo_url)
            for user, expected in [(self.staff, 200), (self.admin, 200), (self.other_staff, 403)]:
                with self.subTest(user=user.name):
                    media = self.client.get(photo_url, **self.auth(user))
                    self.assertEqual(media.status_code, expected)
                    if hasattr(media, "streaming_content"):
                        b"".join(media.streaming_content)
                        media.close()

    def test_damaged_stock_writes_refresh_the_stock_views(self) -> None:
        self.assertEqual(
            scopes_for_path("/api/damaged-stock"), ("inventory", "stocks", "stock-batches", "inventory-transactions"),
        )
        self.assertEqual(scopes_for_path("/api/damaged-stock/photo"), ())
