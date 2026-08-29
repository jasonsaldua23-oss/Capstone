from django.test import TestCase
from django.utils import timezone

from .deposit_lifecycle import get_product_empty_case_balance, record_stockin_empty_consumption
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

    def test_stock_in_consumes_available_cases_without_requiring_the_full_restock_amount(self) -> None:
        self._create_order_item(
            order_number="DELIVERED-STOCK-IN",
            status=OrderStatus.DELIVERED,
            warehouse_id=self.warehouse.id,
            product=self.product,
            returned_bottles=60,
        )
        batch = StockBatch.objects.create(
            batch_number="EMPTY-CONSUME-BATCH",
            inventory=self.inventory,
            quantity=2,
            receipt_date=timezone.now(),
        )

        record_stockin_empty_consumption(self.inventory, batch, 2)

        transaction = InventoryTransaction.objects.get(
            product=self.product,
            warehouse=self.warehouse,
            reference_type="stock_batch_empty_consumed",
            reference_id=batch.id,
        )
        self.assertEqual(transaction.quantity, 2)
        self.assertEqual(get_product_empty_case_balance(self.inventory)["availableBottles"], 12)

        # Fix: the third restocked case is allowed even though no full empty case remains.
        record_stockin_empty_consumption(self.inventory, batch, 3)
        transaction.refresh_from_db()
        self.assertEqual(transaction.quantity, 2)

        # Reducing an edited batch releases the no-longer-consumed case.
        record_stockin_empty_consumption(self.inventory, batch, 1)
        balance = get_product_empty_case_balance(self.inventory)
        self.assertEqual(balance["availableCases"], 1)
        self.assertEqual(balance["looseBottles"], 12)
