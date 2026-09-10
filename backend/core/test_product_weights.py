import json

from django.test import Client, TestCase

from .auth import create_token
from .models import (
    Inventory,
    InventoryReservation,
    InventoryTransaction,
    Order,
    OrderItem,
    Product,
    ReservationStatus,
    RoleType,
    User,
    Warehouse,
)
from .product_weights import calculate_product_weight, normalize_product_size


class ProductWeightCalculationTests(TestCase):
    def test_normalizes_legacy_size_labels(self) -> None:
        self.assertEqual(normalize_product_size("1 Liter"), "1l")
        self.assertEqual(normalize_product_size("1L"), "1l")
        self.assertEqual(normalize_product_size("330ml (11 oz)"), "330ml")

    def test_calculates_returnable_glass_case_weight(self) -> None:
        weight = calculate_product_weight(
            sizes=["12oz"],
            quantity_per_unit=24,
            category="Carbonated (Glass)",
        )
        self.assertEqual(weight, 16.32)

    def test_calculates_non_returnable_case_from_container_size(self) -> None:
        # A case is an order format; it must not automatically use glass weight.
        weight = calculate_product_weight(
            sizes=["330ml (11 oz)"],
            quantity_per_unit=24,
            category="Carbonated (PET/PLASTIC)",
        )
        self.assertEqual(weight, 7.92)


class ProductWeightApiContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin = User.objects.create(
            email="product.weight.admin@example.com",
            password="hashed",
            name="Product Weight Admin",
            role=RoleType.WAREHOUSE_STAFF,
            is_active=True,
        )
        self.token = create_token(
            {
                "userId": self.admin.id,
                "email": self.admin.email,
                "name": self.admin.name,
                "role": RoleType.WAREHOUSE_STAFF,
                "type": "staff",
            }
        )
        self.warehouse = Warehouse.objects.create(
            name="Product Weight Warehouse",
            code="PWW",
            address="Test Address",
            manager_id=self.admin.id,
        )

    def _post_product(self, payload: dict):
        return self.client.post(
            "/api/products",
            data=json.dumps({"warehouseId": self.warehouse.id, **payload}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

    def test_registration_calculates_weight_without_client_value(self) -> None:
        response = self._post_product(
            {
                "sku": "PEPS-WEIGHT-330",
                "name": "Pepsi",
                "unit": "case",
                "category": "Carbonated (PET/PLASTIC)",
                "sizes": ["330ml (11 oz)"],
                "quantityPerUnit": 24,
                "price": 120,
            }
        )

        self.assertEqual(response.status_code, 201, response.content.decode())
        product = Product.objects.get(sku="PEPS-WEIGHT-330")
        self.assertEqual(product.weight, 7.92)

    def test_registration_rejects_product_when_weight_cannot_be_calculated(self) -> None:
        response = self._post_product(
            {
                "sku": "PEPS-WEIGHT-UNKNOWN",
                "name": "Pepsi Unknown Size",
                "unit": "case",
                "category": "Carbonated (PET/PLASTIC)",
                "sizes": ["Unknown"],
                "quantityPerUnit": 24,
                "price": 120,
            }
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("calculate weight", response.json()["error"])
        self.assertFalse(Product.objects.filter(sku="PEPS-WEIGHT-UNKNOWN").exists())

    def test_registration_rejects_duplicate_name_size_and_category(self) -> None:
        Product.objects.create(
            sku="PEPS-DUPLICATE-EXISTING",
            name="Pepsi",
            unit="case",
            category="Carbonated (PET/PLASTIC)",
            sizes=["330ml (11 oz)"],
            quantity_per_unit=24,
            weight=7.92,
        )

        response = self._post_product(
            {
                "sku": "PEPS-DUPLICATE-NEW",
                "name": "  PEPSI  ",
                "unit": "case",
                "category": "carbonated (pet/plastic)",
                "sizes": ["330ML (11 OZ)"],
                "quantityPerUnit": 24,
                "price": 120,
            }
        )

        self.assertEqual(response.status_code, 409, response.content.decode())
        self.assertIn("same name, size, and category", response.json()["error"])
        self.assertFalse(Product.objects.filter(sku="PEPS-DUPLICATE-NEW").exists())

    def test_registration_rejects_duplicate_of_archived_product(self) -> None:
        Product.objects.create(
            sku="PEPS-ARCHIVED-EXISTING",
            name="Pepsi",
            unit="case",
            category="Carbonated (PET/PLASTIC)",
            sizes=["330ml (11 oz)"],
            quantity_per_unit=24,
            weight=7.92,
            is_active=False,
        )

        response = self._post_product(
            {
                "sku": "PEPS-ARCHIVED-NEW",
                "name": "pepsi",
                "unit": "case",
                "category": "carbonated (pet/plastic)",
                "sizes": ["330ML (11 OZ)"],
                "quantityPerUnit": 24,
                "price": 120,
            }
        )

        self.assertEqual(response.status_code, 409, response.content.decode())
        self.assertIn("same name, size, and category", response.json()["error"])
        self.assertFalse(Product.objects.filter(sku="PEPS-ARCHIVED-NEW").exists())

    def test_product_edit_cannot_duplicate_another_product_variant(self) -> None:
        existing = Product.objects.create(
            sku="PEPS-EDIT-DUPLICATE-EXISTING",
            name="Pepsi",
            unit="case",
            category="Carbonated (Glass)",
            sizes=["12oz"],
            quantity_per_unit=24,
            weight=16.32,
        )
        edited = Product.objects.create(
            sku="COKE-EDIT-DUPLICATE",
            name="Coke",
            unit="case",
            category="Carbonated (Glass)",
            sizes=["1 Liter"],
            quantity_per_unit=12,
            weight=18.6,
        )

        response = self.client.put(
            f"/api/products/{edited.id}",
            data=json.dumps({
                "name": existing.name,
                "category": existing.category,
                "sizes": existing.sizes,
            }),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 409, response.content.decode())
        edited.refresh_from_db()
        self.assertEqual((edited.name, edited.sizes), ("Coke", ["1 Liter"]))

    def test_product_edit_recalculates_weight(self) -> None:
        product = Product.objects.create(
            sku="PEPS-WEIGHT-EDIT",
            name="Pepsi",
            unit="case",
            category="Carbonated (Glass)",
            sizes=["12oz"],
            quantity_per_unit=24,
            weight=16.32,
        )

        response = self.client.put(
            f"/api/products/{product.id}",
            data=json.dumps({"sizes": ["1 Liter"], "quantityPerUnit": 12}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200, response.content.decode())
        product.refresh_from_db()
        self.assertEqual(product.weight, 18.6)

    def test_zero_stock_product_archive_can_be_listed_and_restored(self) -> None:
        product = Product.objects.create(
            sku="PRODUCT-DELETE-HISTORY",
            name="Archived Product",
            category="Carbonated (Glass)",
            sizes=["12oz"],
            quantity_per_unit=24,
            weight=16.32,
        )
        Inventory.objects.create(warehouse=self.warehouse, product=product, quantity=0)
        transaction = InventoryTransaction.objects.create(
            warehouse=self.warehouse,
            product=product,
            type="OUT",
            quantity=1,
        )

        response = self.client.delete(
            f"/api/products/{product.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 200, response.content.decode())
        product.refresh_from_db()
        self.assertFalse(product.is_active)
        # The product leaves active inventory without deleting its audit trail.
        self.assertTrue(InventoryTransaction.objects.filter(id=transaction.id, product=product).exists())
        catalog = self.client.get("/api/products", HTTP_AUTHORIZATION=f"Bearer {self.token}")
        self.assertNotIn(product.id, [row["id"] for row in catalog.json()["products"]])
        archived_catalog = self.client.get(
            "/api/products?archived=true",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertIn(product.id, [row["id"] for row in archived_catalog.json()["products"]])

        restored = self.client.put(
            f"/api/products/{product.id}",
            data=json.dumps({"isActive": True}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(restored.status_code, 200, restored.content.decode())
        product.refresh_from_db()
        self.assertTrue(product.is_active)

    def test_product_archive_requires_zero_available_loose_and_reserved_stock(self) -> None:
        product = Product.objects.create(sku="PRODUCT-ARCHIVE-STOCK", name="Stocked Product")
        inventory = Inventory.objects.create(warehouse=self.warehouse, product=product, quantity=1)

        for changes in (
            {"quantity": 1, "loose_bottles": 0, "reserved_quantity": 0},
            {"quantity": 0, "loose_bottles": 1, "reserved_quantity": 0},
            {"quantity": 0, "loose_bottles": 0, "reserved_quantity": 1},
        ):
            Inventory.objects.filter(id=inventory.id).update(**changes)
            response = self.client.delete(
                f"/api/products/{product.id}",
                HTTP_AUTHORIZATION=f"Bearer {self.token}",
            )
            self.assertEqual(response.status_code, 409, response.content.decode())

        product.refresh_from_db()
        self.assertTrue(product.is_active)

    def test_product_archive_is_blocked_by_an_active_order_reservation(self) -> None:
        product = Product.objects.create(sku="PRODUCT-ARCHIVE-ORDER", name="Reserved Product")
        inventory = Inventory.objects.create(warehouse=self.warehouse, product=product, quantity=0)
        order = Order.objects.create(order_number="ORDER-ARCHIVE-RESERVED", subtotal=100, total_amount=100)
        order_item = OrderItem.objects.create(
            order=order,
            product=product,
            quantity=1,
            unit_price=100,
            total_price=100,
        )
        InventoryReservation.objects.create(
            inventory=inventory,
            order_item=order_item,
            product=product,
            quantity_base_units=1,
            status=ReservationStatus.RESERVED,
        )

        response = self.client.delete(
            f"/api/products/{product.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 409, response.content.decode())
        self.assertIn("order reservation", response.json()["error"])

    def test_admin_cannot_restore_archived_product(self) -> None:
        admin = User.objects.create(
            email="product.archive.admin@example.com",
            password="hashed",
            name="Archive Admin",
            role=RoleType.ADMIN,
            is_active=True,
        )
        admin_token = create_token({
            "userId": admin.id,
            "email": admin.email,
            "name": admin.name,
            "role": RoleType.ADMIN,
            "type": "staff",
        })
        product = Product.objects.create(
            sku="PRODUCT-ADMIN-RESTORE",
            name="Admin Archived Product",
            is_active=False,
        )

        response = self.client.put(
            f"/api/products/{product.id}",
            data=json.dumps({"isActive": True}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {admin_token}",
        )

        self.assertEqual(response.status_code, 403, response.content.decode())
        product.refresh_from_db()
        self.assertFalse(product.is_active)
