from decimal import Decimal
from types import SimpleNamespace

from django.test import SimpleTestCase, TestCase

from .models import (
    ContainerType,
    Customer,
    CustomerBottleBalance,
    CustomerDepositLedger,
    Order,
    OrderItem,
    Product,
    ProductPackaging,
)
from .views_api import (
    PRODUCT_UNIT_BOTTLE,
    PRODUCT_UNIT_CASE,
    _calculate_glass_checkout_deposit,
    _apply_delivered_order_deposits,
    _get_glass_deposit_preset,
    _sync_product_glass_packaging,
)


class GlassDepositCalculationTests(SimpleTestCase):
    def setUp(self) -> None:
        self.packaging = SimpleNamespace(
            containers_per_case=24,
            deposit_amount=Decimal("2.00"),
            case_deposit_amount=Decimal("90.00"),
        )

    def test_case_purchase_uses_registered_case_deposit(self) -> None:
        result = _calculate_glass_checkout_deposit(
            packaging=self.packaging,
            product_unit=PRODUCT_UNIT_CASE,
            purchase_quantity=1,
            available_empty_bottles=0,
        )
        self.assertEqual(result["depositCharged"], Decimal("90.00"))
        self.assertEqual(result["netDeposit"], Decimal("90.00"))

    def test_full_case_of_existing_empties_covers_case_deposit(self) -> None:
        result = _calculate_glass_checkout_deposit(
            packaging=self.packaging,
            product_unit=PRODUCT_UNIT_CASE,
            purchase_quantity=1,
            available_empty_bottles=24,
        )
        self.assertEqual(result["emptyBottlesUsed"], 24)
        self.assertEqual(result["depositCredit"], Decimal("90.00"))
        self.assertEqual(result["netDeposit"], Decimal("0.00"))

    def test_individual_bottles_use_per_bottle_deposit(self) -> None:
        result = _calculate_glass_checkout_deposit(
            packaging=self.packaging,
            product_unit=PRODUCT_UNIT_BOTTLE,
            purchase_quantity=5,
            available_empty_bottles=2,
        )
        self.assertEqual(result["depositCharged"], Decimal("10.00"))
        self.assertEqual(result["depositCredit"], Decimal("4.00"))
        self.assertEqual(result["netDeposit"], Decimal("6.00"))

    def test_non_glass_product_has_no_deposit_preset(self) -> None:
        self.assertIsNone(_get_glass_deposit_preset("Carbonated(Cans)", ["12oz"], "case"))
        self.assertIsNone(_get_glass_deposit_preset("Carbonated(PET/PLASTIC)", ["1 Liter"], "case"))


class GlassProductRegistrationTests(TestCase):
    def test_supported_sizes_persist_bottle_and_case_deposits(self) -> None:
        product = Product.objects.create(
            sku="GLASS-TEST-12OZ",
            name="Test Glass Product",
            unit="case",
            quantity_per_unit=24,
            category="Carbonated(Glass)",
            sizes=["12oz"],
        )

        packaging = _sync_product_glass_packaging(product)

        self.assertIsNotNone(packaging)
        assert packaging is not None
        self.assertEqual(packaging.deposit_amount, Decimal("2.00"))
        self.assertEqual(packaging.case_deposit_amount, Decimal("90.00"))
        self.assertEqual(packaging.container_type.material, ContainerType.Material.GLASS)
        product.refresh_from_db()
        self.assertEqual(product.packaging_type, Product.PackagingType.RETURNABLE)

    def test_one_liter_product_persists_its_distinct_deposits(self) -> None:
        product = Product.objects.create(
            sku="GLASS-TEST-1L",
            name="Test 1L Glass Product",
            unit="case",
            quantity_per_unit=12,
            category="Carbonated(Glass)",
            sizes=["1 Liter"],
        )

        packaging = _sync_product_glass_packaging(product)

        self.assertIsNotNone(packaging)
        assert packaging is not None
        self.assertEqual(packaging.deposit_amount, Decimal("6.00"))
        self.assertEqual(packaging.case_deposit_amount, Decimal("124.00"))

    def test_non_glass_product_does_not_create_returnable_packaging(self) -> None:
        product = Product.objects.create(
            sku="CAN-TEST-12OZ",
            name="Test Can Product",
            unit="case",
            quantity_per_unit=24,
            category="Carbonated(Cans)",
            sizes=["12oz"],
        )

        packaging = _sync_product_glass_packaging(product)

        self.assertIsNone(packaging)
        self.assertFalse(ProductPackaging.objects.filter(product=product, is_returnable=True, is_active=True).exists())


class CustomerGlassDepositBalanceTests(TestCase):
    def setUp(self) -> None:
        self.customer = Customer.objects.create(
            email="glass-balance@example.com",
            password="hashed",
            name="Glass Balance Customer",
        )
        self.product = Product.objects.create(
            sku="GLASS-BALANCE-12OZ",
            name="Balance Test Glass Product",
            unit="case",
            quantity_per_unit=24,
            category="Carbonated(Glass)",
            sizes=["12oz"],
        )
        self.packaging = _sync_product_glass_packaging(self.product)
        assert self.packaging is not None

    def _create_order_item(self, *, empties: int, net_deposit: Decimal) -> Order:
        order = Order.objects.create(
            order_number=f"ORD-GLASS-{empties}-{net_deposit}",
            customer=self.customer,
            subtotal=100,
            total_amount=100 + float(net_deposit),
        )
        OrderItem.objects.create(
            order=order,
            product=self.product,
            product_name=self.product.name,
            product_sku=self.product.sku,
            product_unit="case",
            quantity=1,
            unit_price=100,
            total_price=100,
            is_returnable_item=True,
            container_type_id=self.packaging.container_type_id,
            container_type_name=self.packaging.container_type.name,
            full_quantity=24,
            empty_returned_quantity=empties,
            deposit_per_unit=Decimal("2.00"),
            deposit_charged=Decimal("90.00"),
            deposit_refunded=Decimal("90.00") if empties else Decimal("0.00"),
            net_deposit=net_deposit,
        )
        return order

    def test_delivery_adds_new_case_deposit_to_the_matching_bottle_type(self) -> None:
        order = self._create_order_item(empties=0, net_deposit=Decimal("90.00"))

        _apply_delivered_order_deposits(order, "tester")

        balance = CustomerBottleBalance.objects.get(
            customer=self.customer,
            container_type=self.packaging.container_type,
        )
        self.assertEqual(balance.bottles_outstanding, 24)
        self.assertEqual(balance.deposit_balance, Decimal("90.00"))
        self.assertEqual(CustomerDepositLedger.objects.get(customer=self.customer).balance, Decimal("90.00"))

    def test_fully_covered_exchange_keeps_balance_and_is_idempotent(self) -> None:
        CustomerBottleBalance.objects.create(
            customer=self.customer,
            container_type=self.packaging.container_type,
            bottles_outstanding=24,
            deposit_balance=Decimal("90.00"),
        )
        CustomerDepositLedger.objects.create(customer=self.customer, balance=Decimal("90.00"))
        order = self._create_order_item(empties=24, net_deposit=Decimal("0.00"))

        _apply_delivered_order_deposits(order, "tester")
        _apply_delivered_order_deposits(order, "tester")

        balance = CustomerBottleBalance.objects.get(
            customer=self.customer,
            container_type=self.packaging.container_type,
        )
        self.assertEqual(balance.bottles_outstanding, 24)
        self.assertEqual(balance.deposit_balance, Decimal("90.00"))
