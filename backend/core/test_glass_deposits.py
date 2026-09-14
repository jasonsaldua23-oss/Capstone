from decimal import Decimal

from django.test import TestCase

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
from .rgb.services import calculate_deposit_for_order_item, process_order_deposits
from .views_api import _get_or_create_product_packaging, _is_returnable_product


class GlassDepositCalculationTests(TestCase):
    def setUp(self) -> None:
        self.product = Product.objects.create(
            sku="GLASS-CALC-12OZ",
            name="Glass Deposit Calculation Product",
            unit="case",
            quantity_per_unit=24,
            category="Carbonated(Glass)",
            sizes=["12oz"],
        )
        self.packaging, _ = _get_or_create_product_packaging(self.product)

    def test_full_container_purchase_uses_registered_unit_deposit(self) -> None:
        result = calculate_deposit_for_order_item(
            self.product,
            full_quantity=24,
            empty_returned_quantity=0,
        )
        self.assertEqual(result["depositCharged"], 90.0)
        self.assertEqual(result["netDeposit"], 90.0)

    def test_returned_containers_credit_the_registered_unit_deposit(self) -> None:
        result = calculate_deposit_for_order_item(
            self.product,
            full_quantity=24,
            empty_returned_quantity=24,
        )
        self.assertEqual(result["depositRefunded"], 90.0)
        self.assertEqual(result["netDeposit"], 0.0)

    def test_individual_bottles_use_per_bottle_deposit(self) -> None:
        result = calculate_deposit_for_order_item(
            self.product,
            full_quantity=5,
            empty_returned_quantity=2,
        )
        self.assertEqual(result["depositCharged"], 10.0)
        self.assertEqual(result["depositRefunded"], 4.0)
        self.assertEqual(result["netDeposit"], 6.0)

    def test_non_glass_product_has_no_returnable_deposit(self) -> None:
        product = Product.objects.create(
            sku="CAN-CALC-12OZ",
            name="Can Deposit Calculation Product",
            category="Carbonated(Cans)",
        )
        self.assertFalse(_is_returnable_product(product))
        result = calculate_deposit_for_order_item(product, full_quantity=1, empty_returned_quantity=0)
        self.assertFalse(result["is_returnable"])

    def test_pet_product_stays_ineligible_with_stale_returnable_packaging(self) -> None:
        product = Product.objects.create(
            sku="PET-STALE-RGB",
            name="PET Product With Stale Packaging",
            category="Carbonated (PET/PLASTIC)",
            packaging_type="RETURNABLE",
        )
        container = ContainerType.objects.create(
            code="PET-STALE-CONTAINER",
            name="Stale Returnable Container",
            deposit_amount=Decimal("6.00"),
        )
        ProductPackaging.objects.create(
            product=product,
            container_type=container,
            is_returnable=True,
            is_active=True,
            deposit_amount=Decimal("6.00"),
        )

        self.assertFalse(_is_returnable_product(product))
        result = calculate_deposit_for_order_item(product, full_quantity=12, empty_returned_quantity=0)
        self.assertFalse(result["is_returnable"])
        self.assertEqual(result["depositCharged"], Decimal("0"))


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

        packaging, _ = _get_or_create_product_packaging(product)

        self.assertIsNotNone(packaging)
        assert packaging is not None
        self.assertEqual(packaging.deposit_amount, Decimal("2.00"))
        self.assertEqual(packaging.case_deposit_amount, Decimal("42.00"))
        self.assertEqual(packaging.container_type.material, ContainerType.Material.GLASS)
        product.refresh_from_db()
        self.assertEqual(product.packaging_type, "RETURNABLE")

    def test_one_liter_product_persists_its_distinct_deposits(self) -> None:
        product = Product.objects.create(
            sku="GLASS-TEST-1L",
            name="Test 1L Glass Product",
            unit="case",
            quantity_per_unit=12,
            category="Carbonated(Glass)",
            sizes=["1 Liter"],
        )

        packaging, _ = _get_or_create_product_packaging(product)

        self.assertIsNotNone(packaging)
        assert packaging is not None
        self.assertEqual(packaging.deposit_amount, Decimal("6.00"))
        self.assertEqual(packaging.case_deposit_amount, Decimal("52.00"))

    def test_non_glass_product_does_not_create_returnable_packaging(self) -> None:
        product = Product.objects.create(
            sku="CAN-TEST-12OZ",
            name="Test Can Product",
            unit="case",
            quantity_per_unit=24,
            category="Carbonated(Cans)",
            sizes=["12oz"],
        )

        self.assertFalse(_is_returnable_product(product))
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
        self.packaging, _ = _get_or_create_product_packaging(self.product)

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

        process_order_deposits(order, "tester")

        balance = CustomerBottleBalance.objects.get(
            customer=self.customer,
            container_type=self.packaging.container_type,
        )
        self.assertEqual(balance.bottles_outstanding, 24)
        self.assertEqual(CustomerDepositLedger.objects.get(customer=self.customer).balance, Decimal("90.00"))

    def test_fully_covered_exchange_records_matching_charge_and_refund(self) -> None:
        CustomerBottleBalance.objects.create(
            customer=self.customer,
            container_type=self.packaging.container_type,
            bottles_outstanding=24,
            deposit_balance=Decimal("90.00"),
        )
        CustomerDepositLedger.objects.create(customer=self.customer, balance=Decimal("90.00"))
        order = self._create_order_item(empties=24, net_deposit=Decimal("0.00"))

        transactions = process_order_deposits(order, "tester")

        balance = CustomerBottleBalance.objects.get(
            customer=self.customer,
            container_type=self.packaging.container_type,
        )
        self.assertEqual(balance.bottles_outstanding, 24)
        self.assertEqual(len(transactions), 2)
        self.assertEqual(CustomerDepositLedger.objects.get(customer=self.customer).balance, Decimal("90.00"))
