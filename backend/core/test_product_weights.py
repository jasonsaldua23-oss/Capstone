import json

from django.test import Client, TestCase

from .auth import create_token
from .models import Product, RoleType, User, Warehouse
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
            role=RoleType.SUPER_ADMIN,
            is_active=True,
        )
        self.token = create_token(
            {
                "userId": self.admin.id,
                "email": self.admin.email,
                "name": self.admin.name,
                "role": RoleType.SUPER_ADMIN,
                "type": "staff",
            }
        )
        self.warehouse = Warehouse.objects.create(
            name="Product Weight Warehouse",
            code="PWW",
            address="Test Address",
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
