from django.test import TestCase
from django.utils import timezone

from .deposit_lifecycle import get_product_empty_case_balance
from .models import (
    ContainerType,
    Inventory,
    InventoryTransaction,
    Order,
    OrderItem,
    OrderStatus,
    Product,
    ProductPackaging,
    StockBatch,
    Warehouse,
)


class EmptyCaseInventoryTests(TestCase):
    def setUp(self) -> None:
        self.warehouse = Warehouse.objects.create(
            name="Gamboa Warehouse",
            code="GAMBOA-EMPTY-TEST",
            address="Test Address",
            city="Manila",
            province="Metro Manila",
            zip_code="1000",
        )
        self.product = self._create_returnable_product("RGB-A", "Product A")
        self.other_product = self._create_returnable_product("RGB-B", "Product B")
        self.inventory = Inventory.objects.create(warehouse=self.warehouse, product=self.product)
        Inventory.objects.create(warehouse=self.warehouse, product=self.other_product)

    @staticmethod
    def _create_returnable_product(sku: str, name: str) -> Product:
        product = Product.objects.create(sku=sku, name=name, packaging_type="RETURNABLE")
        container = ContainerType.objects.create(
            code=f"{sku}-BOTTLE",
            name=f"{name} Bottle",
            category=ContainerType.Category.BOTTLE,
            material=ContainerType.Material.GLASS,
            is_returnable=True,
        )
        ProductPackaging.objects.create(
            product=product,
            container_type=container,
            containers_per_case=24,
            is_primary=True,
            is_returnable=True,
        )
        return product

    @staticmethod
    def _create_order_item(
        *, order_number: str, status: str, warehouse_id: str, product: Product, returned_bottles: int
    ) -> None:
        order = Order.objects.create(
            order_number=order_number,
            status=status,
            warehouse_id=warehouse_id,
            subtotal=0,
            total_amount=0,
        )
        OrderItem.objects.create(
            order=order,
            product=product,
            quantity=1,
            unit_price=0,
            total_price=0,
            empty_returned_quantity=returned_bottles,
        )

    def test_balance_uses_only_delivered_returns_for_exact_product_and_warehouse(self) -> None:
        self._create_order_item(
            order_number="DELIVERED-A",
            status=OrderStatus.DELIVERED,
            warehouse_id=self.warehouse.id,
            product=self.product,
            returned_bottles=60,
        )
        # Customer checkout reservations must not become warehouse stock before delivery.
        self._create_order_item(
            order_number="PENDING-A",
            status=OrderStatus.PENDING,
            warehouse_id=self.warehouse.id,
            product=self.product,
            returned_bottles=240,
        )
        self._create_order_item(
            order_number="DELIVERED-B",
            status=OrderStatus.DELIVERED,
            warehouse_id=self.warehouse.id,
            product=self.other_product,
            returned_bottles=240,
        )
        self._create_order_item(
            order_number="DELIVERED-A-OTHER-WAREHOUSE",
            status=OrderStatus.DELIVERED,
            warehouse_id="different-warehouse-id",
            product=self.product,
            returned_bottles=240,
        )

        balance = get_product_empty_case_balance(self.inventory)

        self.assertEqual(balance["returnedBottles"], 60)
        self.assertEqual(balance["availableCases"], 2)
        self.assertEqual(balance["looseBottles"], 12)

    def test_stock_in_leaves_customer_returns_available(self) -> None:
        self._create_order_item(order_number="RESTOCK", status=OrderStatus.DELIVERED,
            warehouse_id=self.warehouse.id, product=self.product, returned_bottles=60)
        StockBatch.objects.create(batch_number="RESTOCK", inventory=self.inventory,
            quantity=3, receipt_date=timezone.now())
        self.assertEqual(get_product_empty_case_balance(self.inventory)["availableBottles"], 60)

    def test_manual_return_deducts_only_warehouse_empties(self) -> None:
        import json
        from unittest.mock import patch
        from django.test import RequestFactory
        from .views_api import record_returned_empty_containers

        self._create_order_item(order_number="MANUAL", status=OrderStatus.DELIVERED,
            warehouse_id=self.warehouse.id, product=self.product, returned_bottles=60)
        with patch("core.views_api._require_warehouse_operator", return_value=({"userId": "staff", "name": "Staff"}, None)), patch(
            "core.views_api._get_allowed_warehouse_ids_for_staff", return_value=[self.warehouse.id]
        ):
            for quantity, unit, expected in [(1, "CASE", 201), (13, "BOTTLE", 201), (24, "BOTTLE", 400), (1.5, "CASE", 400), (0, "CASE", 400)]:
                request = RequestFactory().post("/api/inventory/empty-returns", data=json.dumps({
                    "inventoryId": self.inventory.id, "containerUnit": unit, "quantity": quantity,
                }), content_type="application/json")
                response = record_returned_empty_containers(request)
                self.assertEqual(response.status_code, expected, response.content)
        # Customer return history is preserved while only warehouse availability decreases.
        self.assertEqual(OrderItem.objects.get(order__order_number="MANUAL").empty_returned_quantity, 60)
        self.assertEqual(get_product_empty_case_balance(self.inventory)["availableBottles"], 23)

    def test_return_history_filters_before_pagination_and_keeps_empty_balances(self):
        import json
        from unittest.mock import patch
        from django.test import RequestFactory
        from .views_api import inventory_transactions_list

        # History remains available even when the product has no current empty balance.
        first = InventoryTransaction.objects.create(
            warehouse=self.warehouse, product=self.product, type="CONSUME_EMPTY", quantity=29,
            quantity_unit="BASE_UNIT", reference_type="manual_empty_return", performed_by="Warehouse Staff",
            notes="Warehouse return: 29 bottle(s). 1 full cases and 5 loose bottles. Supplier pickup",
        )
        latest = InventoryTransaction.objects.create(
            warehouse=self.warehouse, product=self.product, type="CONSUME_EMPTY", quantity=24,
            quantity_unit="BASE_UNIT", reference_type="manual_empty_return",
            notes="Warehouse return: 1 case(s).",
        )
        InventoryTransaction.objects.create(
            warehouse=self.warehouse, product=self.product, type="IN", quantity=10,
            reference_type="stock_in",
        )
        with patch("core.views_api._require_staff", return_value=({"role": "ADMIN", "userId": "admin"}, None)):
            response = inventory_transactions_list(RequestFactory().get("/api/inventory-transactions", {
                "referenceType": "manual_empty_return", "pageSize": 1,
            }))
            self.assertEqual(response.status_code, 200)
            payload = json.loads(response.content)
            self.assertEqual(payload["total"], 2)
            self.assertEqual(payload["totalPages"], 2)
            self.assertEqual([row["id"] for row in payload["transactions"]], [latest.id])
            response = inventory_transactions_list(RequestFactory().get("/api/inventory-transactions", {
                "referenceType": "manual_empty_return", "pageSize": 1, "page": 2,
            }))
            record = json.loads(response.content)["transactions"][0]
            self.assertEqual(record["id"], first.id)
            self.assertEqual(record["performedBy"], "Warehouse Staff")
            self.assertEqual(record["notes"], first.notes)
            self.assertEqual(record["product"]["name"], self.product.name)

    def _dated_delivery(self, *, order_number: str, product: Product, bottles: int, delivered_at, with_timeline: bool = True) -> Order:
        from .models import OrderTimeline

        order = Order.objects.create(
            order_number=order_number,
            status=OrderStatus.DELIVERED,
            warehouse_id=self.warehouse.id,
            subtotal=0,
            total_amount=0,
        )
        OrderItem.objects.create(
            order=order, product=product, quantity=1, unit_price=0, total_price=0,
            empty_returned_quantity=bottles,
        )
        if with_timeline:
            OrderTimeline.objects.create(order=order, delivered_at=delivered_at)
        else:
            # A walk-in sale is delivered when rung up, so its creation time dates it.
            Order.objects.filter(id=order.id).update(created_at=delivered_at)
        return order

    def test_bulk_balances_match_the_single_row_balance(self) -> None:
        from .deposit_lifecycle import get_empty_case_balances

        other_inventory = Inventory.objects.get(warehouse=self.warehouse, product=self.other_product)
        self._create_order_item(order_number="BULK-A", status=OrderStatus.DELIVERED,
            warehouse_id=self.warehouse.id, product=self.product, returned_bottles=100)
        self._create_order_item(order_number="BULK-B", status=OrderStatus.DELIVERED,
            warehouse_id=self.warehouse.id, product=self.other_product, returned_bottles=30)
        InventoryTransaction.objects.create(
            warehouse=self.warehouse, product=self.product, type="CONSUME_EMPTY", quantity=2,
            reference_type="stock_batch_empty_consumed", reference_id="batch-1",
        )
        InventoryTransaction.objects.create(
            warehouse=self.warehouse, product=self.product, type="CONSUME_EMPTY", quantity=5,
            quantity_unit="BASE_UNIT", reference_type="manual_empty_return",
        )

        bulk = get_empty_case_balances([self.inventory, other_inventory])

        self.assertEqual(bulk[self.inventory.id], get_product_empty_case_balance(self.inventory))
        self.assertEqual(bulk[other_inventory.id], get_product_empty_case_balance(other_inventory))
        # 100 returned - 2 cases x 24 used for a stock-in - 5 sent back to the supplier.
        self.assertEqual(bulk[self.inventory.id]["availableBottles"], 47)
        self.assertEqual(bulk[other_inventory.id]["availableBottles"], 30)

    def test_empty_bottle_changes_are_dated_signed_and_limited_by_since(self) -> None:
        from datetime import timedelta
        from .deposit_lifecycle import get_empty_bottle_changes

        now = timezone.now()
        self._dated_delivery(order_number="OLD", product=self.product, bottles=48, delivered_at=now - timedelta(days=20))
        self._dated_delivery(order_number="RECENT", product=self.product, bottles=36, delivered_at=now - timedelta(days=2))
        self._dated_delivery(order_number="WALK-IN", product=self.product, bottles=12,
            delivered_at=now - timedelta(days=1), with_timeline=False)
        consumed = InventoryTransaction.objects.create(
            warehouse=self.warehouse, product=self.product, type="CONSUME_EMPTY", quantity=1,
            reference_type="stock_batch_empty_consumed", reference_id="batch-2",
        )
        InventoryTransaction.objects.filter(id=consumed.id).update(created_at=now - timedelta(hours=5))

        every = get_empty_bottle_changes([self.inventory])[self.inventory.id]
        self.assertEqual([change["bottles"] for change in every], [48, 36, 12, -24])

        recent = get_empty_bottle_changes([self.inventory], since=now - timedelta(days=7))[self.inventory.id]
        self.assertEqual([change["bottles"] for change in recent], [36, 12, -24])
        # Replaying the recent changes backwards from today reaches the balance a week ago.
        balance = get_product_empty_case_balance(self.inventory)["availableBottles"]
        self.assertEqual(balance - sum(change["bottles"] for change in recent), 48)

    def test_inventory_list_carries_empties_only_when_asked(self) -> None:
        import json
        from unittest.mock import patch
        from django.test import RequestFactory
        from .views_inventory import inventory_collection

        self._create_order_item(order_number="LIST", status=OrderStatus.DELIVERED,
            warehouse_id=self.warehouse.id, product=self.product, returned_bottles=60)
        with patch("core.views_api._require_staff", return_value=({"role": "ADMIN", "userId": "admin"}, None)):
            plain = json.loads(inventory_collection(RequestFactory().get("/api/inventory")).content)
            self.assertNotIn("emptyBottles", plain["inventory"][0])

            response = inventory_collection(RequestFactory().get("/api/inventory", {
                "includeEmpties": "1", "emptiesSince": "2000-01-01",
            }))
            self.assertEqual(response.status_code, 200, response.content)
            rows = {row["product"]["id"]: row for row in json.loads(response.content)["inventory"]}
            self.assertEqual(rows[self.product.id]["emptyBottles"], 60)
            self.assertEqual(rows[self.product.id]["emptyContainersPerCase"], 24)
            self.assertEqual([change["bottles"] for change in rows[self.product.id]["emptyBottleChanges"]], [60])
            self.assertEqual(rows[self.other_product.id]["emptyBottles"], 0)

            bad = inventory_collection(RequestFactory().get("/api/inventory", {
                "includeEmpties": "1", "emptiesSince": "last week",
            }))
            self.assertEqual(bad.status_code, 400)

    def test_return_history_respects_warehouse_scope(self):
        import json
        from unittest.mock import patch
        from django.test import RequestFactory
        from .views_api import inventory_transactions_list

        # Respect the single-warehouse constraint; simulate a different staff scope instead.
        InventoryTransaction.objects.create(
            warehouse=self.warehouse, product=self.product, type="CONSUME_EMPTY", quantity=24,
            quantity_unit="BASE_UNIT", reference_type="manual_empty_return",
        )
        with patch("core.views_api._require_staff", return_value=({"role": "WAREHOUSE_STAFF", "userId": "staff"}, None)), patch(
            "core.views_api._get_allowed_warehouse_ids_for_staff", return_value=[self.warehouse.id]
        ):
            response = inventory_transactions_list(RequestFactory().get("/api/inventory-transactions", {
                "referenceType": "manual_empty_return",
            }))
            payload = json.loads(response.content)
            self.assertEqual(payload["total"], 1)
            self.assertEqual(payload["transactions"][0]["warehouse"]["id"], self.warehouse.id)
            response = inventory_transactions_list(RequestFactory().get("/api/inventory-transactions", {
                "referenceType": "manual_empty_return", "warehouseId": "outside-scope",
            }))
            self.assertEqual(response.status_code, 403)
        with patch("core.views_api._require_staff", return_value=({"role": "WAREHOUSE_STAFF", "userId": "other-staff"}, None)), patch(
            "core.views_api._get_allowed_warehouse_ids_for_staff", return_value=["outside-scope"]
        ):
            response = inventory_transactions_list(RequestFactory().get("/api/inventory-transactions", {
                "referenceType": "manual_empty_return",
            }))
            self.assertEqual(json.loads(response.content)["transactions"], [])
        with patch("core.views_api._require_staff", return_value=({"role": "ADMIN", "userId": "admin"}, None)):
            response = inventory_transactions_list(RequestFactory().get("/api/inventory-transactions", {
                "referenceType": "manual_empty_return",
            }))
            self.assertEqual(json.loads(response.content)["total"], 1)
