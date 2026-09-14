"""Deposit refunds selected at checkout must apply to one specific order."""

import json
from decimal import Decimal

from django.test import TestCase

from .auth import create_token
from .empties_verification import record_collected_empties, serialize_declared_empties
from .models import (
    ContainerType,
    Customer,
    CustomerBottleBalance,
    DepositTransaction,
    MixedCaseComponent,
    OrderDepositRefundClaim,
    Order,
    OrderItem,
    Product,
    ProductPackaging,
)
from .rgb.services import get_customer_bottle_balances
from .views_api import _create_order_from_checkout_payload


class CustomerOrderDepositRefundTests(TestCase):
    def test_mixed_case_checkout_adds_one_physical_case_deposit(self) -> None:
        customer = Customer.objects.create(email="mixed-deposit@example.com", password="hashed", name="Mixed Deposit")
        container_type = ContainerType.objects.create(
            code="MIXED-DEPOSIT-GLASS",
            name="Mixed Deposit Glass",
            deposit_amount=Decimal("2.00"),
        )
        products = [
            Product.objects.create(
                sku=f"MIXED-DEPOSIT-{index}",
                name=f"Mixed Deposit {index}",
                unit="case",
                quantity_per_unit=24,
                price=240,
                category="Carbonated (Glass)",
                sizes=["12oz"],
            )
            for index in range(2)
        ]
        for product in products:
            ProductPackaging.objects.create(
                product=product,
                container_type=container_type,
                is_primary=True,
                is_returnable=True,
                deposit_amount=Decimal("2.00"),
                case_deposit_amount=Decimal("42.00"),
                containers_per_case=24,
            )

        order = _create_order_from_checkout_payload(
            customer=customer,
            body={},
            normalized_items=[{
                "itemType": "MIXED_CASE",
                "quantity": 1,
                "caseCapacity": 24,
                "unitPrice": 240,
                "totalPrice": 240,
                "components": [
                    {
                        "product": product,
                        "quantityPerCase": 12,
                        "caseCount": 1,
                        "totalBaseUnits": 12,
                        "unitPrice": 10,
                        "componentSubtotal": 120,
                    }
                    for product in products
                ],
            }],
            subtotal=240,
            tax=0,
            shipping_cost=0,
            discount=0,
            total_amount=240,
            selected_warehouse_id=None,
            shipping_latitude=None,
            shipping_longitude=None,
            payment_status="pending",
            performed_by=customer.id,
        )

        item = order.items.get()
        self.assertEqual(item.deposit_charged, Decimal("90.00"))
        self.assertEqual(item.net_deposit, Decimal("90.00"))
        self.assertEqual(order.total_amount, 330)

    def test_bottle_product_balance_keeps_per_bottle_quantity_and_value(self) -> None:
        customer = Customer.objects.create(email="bottle-balance@example.com", password="hashed", name="Bottle Balance")
        product = Product.objects.create(sku="BOTTLE-BALANCE", name="Bottle Product", unit="bottle", price=20, category="Carbonated (Glass)")
        container_type = ContainerType.objects.create(
            code="BOTTLE-BALANCE-GLASS",
            name="Bottle Balance Glass",
            deposit_amount=Decimal("6.00"),
        )
        ProductPackaging.objects.create(
            product=product,
            container_type=container_type,
            is_primary=True,
            is_returnable=True,
            deposit_amount=Decimal("6.00"),
            case_deposit_amount=Decimal("52.00"),
            containers_per_case=12,
        )
        CustomerBottleBalance.objects.create(
            customer=customer,
            container_type=container_type,
            bottles_outstanding=12,
            deposit_balance=Decimal("72.00"),
        )

        serialized = get_customer_bottle_balances(customer)[0]

        self.assertEqual(serialized["unit"], "bottle")
        self.assertEqual(serialized["bottlesAvailable"], 12)
        self.assertEqual(serialized["depositAvailable"], 72.0)
        self.assertEqual(serialized["productOptions"][0]["unit"], "bottle")

    def test_shared_container_balance_keeps_products_separate(self) -> None:
        customer = Customer.objects.create(email="separate-products@example.com", password="hashed", name="Separate Products")
        container_type = ContainerType.objects.create(
            code="SHARED-PRODUCT-GLASS",
            name="Shared Product Glass",
            deposit_amount=Decimal("2.00"),
        )
        products = [
            Product.objects.create(sku="SHARED-MD", name="Mountain Dew", unit="case", price=200, category="Carbonated (Glass)"),
            Product.objects.create(sku="SHARED-PEPSI", name="Pepsi", unit="case", price=200, category="Carbonated (Glass)"),
        ]
        for index, product in enumerate(products):
            ProductPackaging.objects.create(
                product=product,
                container_type=container_type,
                is_primary=True,
                is_returnable=True,
                deposit_amount=Decimal("2.00"),
                # The second product exercises the per-product fallback price.
                case_deposit_amount=Decimal("42.00") if index == 0 else Decimal("0.00"),
                containers_per_case=24,
            )
        CustomerBottleBalance.objects.create(
            customer=customer,
            container_type=container_type,
            bottles_outstanding=72,
            deposit_balance=Decimal("228.00"),
        )
        for product, cases, full_case_amount in zip(products, [2, 1], [Decimal("90.00"), Decimal("48.00")]):
            DepositTransaction.objects.create(
                customer=customer,
                type=DepositTransaction.TransactionType.ADJUSTMENT,
                amount=full_case_amount * cases,
                balance_before=Decimal("0.00"),
                balance_after=full_case_amount * cases,
                container_type=container_type,
                container_count=24 * cases,
                reason=f"Customer declared {cases} empty case(s) of {product.name}",
                reference_type="product",
                reference_id=product.id,
            )

        serialized = get_customer_bottle_balances(customer)[0]

        self.assertEqual(len(serialized["productBalances"]), 2)
        self.assertEqual(
            {row["productName"]: row["availableQuantity"] for row in serialized["productBalances"]},
            {"Mountain Dew": 2, "Pepsi": 1},
        )
        self.assertEqual(sum(row["bottlesAvailable"] for row in serialized["productBalances"]), 72)
        self.assertEqual(
            {row["productName"]: row["depositPerUnit"] for row in serialized["productBalances"]},
            {"Mountain Dew": 90.0, "Pepsi": 48.0},
        )

        # Checkout must validate the same per-product prices shown by the client.
        order = _create_order_from_checkout_payload(
            customer=customer,
            body={
                "depositRefundLines": [
                    {
                        "productId": products[0].id,
                        "containerTypeId": container_type.id,
                        "cases": 2,
                        "bottles": 0,
                    },
                    {
                        "productId": products[1].id,
                        "containerTypeId": container_type.id,
                        "cases": 1,
                        "bottles": 0,
                    },
                ],
            },
            normalized_items=[{
                "productId": products[0].id,
                "quantity": 1,
                "unitPrice": 200,
                "totalPrice": 200,
            }],
            subtotal=200,
            tax=0,
            shipping_cost=0,
            discount=0,
            total_amount=200,
            selected_warehouse_id=None,
            shipping_latitude=None,
            shipping_longitude=None,
            payment_status="pending",
            performed_by=customer.id,
        )
        # The purchased case adds its complete deposit before refunding the empties.
        self.assertEqual(order.total_amount, 62)
        self.assertEqual(
            sum(claim.requested_amount for claim in order.deposit_refund_claims.all()),
            Decimal("228.00"),
        )
        # Driver verification keeps each selected product on its own counter even
        # though both products settle into the same physical container ledger.
        declared = serialize_declared_empties(order)
        self.assertEqual(len(declared), 2)
        self.assertEqual(
            {row["productName"]: row["declaredCases"] for row in declared},
            {"Mountain Dew": 2, "Pepsi": 1},
        )
        self.assertEqual(len({row["declarationId"] for row in declared}), 2)
        self.assertEqual({row["containerTypeId"] for row in declared}, {container_type.id})

    def test_refund_reduces_the_selected_order_and_available_credit_once(self) -> None:
        customer = Customer.objects.create(
            email="order-refund@example.com",
            password="hashed",
            name="Order Refund Customer",
        )
        product = Product.objects.create(
            sku="ORDER-REFUND-PRODUCT",
            name="Order Refund Product",
            unit="case",
            price=200,
            category="Carbonated (Glass)",
        )
        container_type = ContainerType.objects.create(
            code="ORDER-REFUND-GLASS",
            name="Refundable Glass Bottle",
            deposit_amount=Decimal("2.00"),
        )
        ProductPackaging.objects.create(
            product=product,
            container_type=container_type,
            is_primary=True,
            is_returnable=True,
            deposit_amount=Decimal("2.00"),
            case_deposit_amount=Decimal("24.00"),
            containers_per_case=12,
        )
        balance = CustomerBottleBalance.objects.create(
            customer=customer,
            container_type=container_type,
            bottles_outstanding=45,
            deposit_balance=Decimal("90.00"),
        )

        order = _create_order_from_checkout_payload(
            customer=customer,
            body={
                "depositCreditAmount": 60,
                "depositRefundLines": [{
                    "productId": product.id,
                    "containerTypeId": container_type.id,
                    "quantity": 30,
                }],
            },
            normalized_items=[{
                "productId": product.id,
                "quantity": 1,
                "unitPrice": 200,
                "totalPrice": 200,
            }],
            subtotal=200,
            tax=0,
            shipping_cost=0,
            discount=0,
            total_amount=200,
            selected_warehouse_id=None,
            shipping_latitude=None,
            shipping_longitude=None,
            payment_status="pending",
            performed_by=customer.id,
        )

        balance.refresh_from_db()
        claim = OrderDepositRefundClaim.objects.get(order=order)
        self.assertEqual(order.total_amount, 188)
        self.assertEqual(balance.deposit_balance, Decimal("90.00"))
        self.assertEqual(claim.requested_quantity, 30)
        self.assertEqual(claim.requested_amount, Decimal("60.00"))
        serialized = serialize_declared_empties(order)[0]
        self.assertEqual(serialized["productName"], product.name)
        self.assertEqual(serialized["declaredCases"], 0)
        self.assertEqual(serialized["declaredLooseBottles"], 30)

        # The driver collects 25 of the 30 promised bottles at delivery.
        result = record_collected_empties(
            order=order,
            drop_point=None,
            submitted_lines=[{
                "containerTypeId": container_type.id,
                "returnedQuantity": 25,
            }],
            performed_by="driver-1",
            received_by="Test Driver",
        )

        balance.refresh_from_db()
        claim.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(claim.status, OrderDepositRefundClaim.ClaimStatus.PARTIAL)
        self.assertEqual(claim.collected_quantity, 25)
        self.assertEqual(claim.collected_amount, Decimal("50.00"))
        self.assertEqual(balance.bottles_outstanding, 20)
        self.assertEqual(balance.deposit_balance, Decimal("40.00"))
        self.assertEqual(order.remaining_balance, Decimal("10.00"))
        self.assertEqual(result["shortfallAmount"], 10.0)

    def test_customer_can_apply_empty_refund_to_an_existing_paid_but_undelivered_po(self) -> None:
        customer = Customer.objects.create(
            email="later-refund@example.com",
            password="hashed",
            name="Later Refund Customer",
        )
        product = Product.objects.create(
            sku="LATER-REFUND-PRODUCT",
            name="Later Refund Product",
            unit="case",
            price=100,
            category="Carbonated (Glass)",
        )
        container_type = ContainerType.objects.create(
            code="LATER-REFUND-GLASS",
            name="Later Refund Bottle",
            deposit_amount=Decimal("6.00"),
        )
        ProductPackaging.objects.create(
            product=product,
            container_type=container_type,
            is_primary=True,
            is_returnable=True,
            deposit_amount=Decimal("6.00"),
            case_deposit_amount=Decimal("52.00"),
            containers_per_case=12,
        )
        balance = CustomerBottleBalance.objects.create(
            customer=customer,
            container_type=container_type,
            bottles_outstanding=288,
            deposit_balance=Decimal("2976.00"),
        )
        serialized_balance = get_customer_bottle_balances(customer)[0]
        product_option = serialized_balance["productOptions"][0]
        self.assertEqual(product_option["unit"], "case")
        self.assertEqual(product_option["containersPerCase"], 12)
        self.assertEqual(product_option["depositAmount"], 6.0)
        self.assertEqual(product_option["caseDepositAmount"], 52.0)
        order = Order.objects.create(
            order_number="PO-LATER-REFUND",
            purchase_order_number="PO-LATER-REFUND",
            customer=customer,
            subtotal=2000,
            total_amount=4000,
            payment_status="paid",
        )
        token = create_token({"type": "customer", "userId": customer.id, "role": "CUSTOMER"})

        # A purchase request must be approved and assigned a PO before a refund can be attached.
        request_order = Order.objects.create(
            order_number="PR-NOT-REFUNDABLE",
            purchase_request_number="PR-NOT-REFUNDABLE",
            customer=customer,
            subtotal=100,
            total_amount=100,
        )
        request_response = self.client.post(
            f"/api/customer/orders/{request_order.id}/deposit-refund",
            data=json.dumps({
                "depositCreditAmount": 6,
                "depositRefundLines": [{
                    "productId": product.id,
                    "containerTypeId": container_type.id,
                    "quantity": 1,
                }],
            }),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(request_response.status_code, 400)

        response = self.client.post(
            f"/api/customer/orders/{order.id}/deposit-refund",
            data=json.dumps({
                "depositCreditAmount": 2976,
                "depositRefundLines": [{
                    "productId": product.id,
                    "containerTypeId": container_type.id,
                    "quantity": 288,
                    "cases": 24,
                    "bottles": 0,
                }],
            }),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(response.status_code, 200)
        order.refresh_from_db()
        balance.refresh_from_db()
        claim = OrderDepositRefundClaim.objects.get(order=order)
        self.assertEqual(order.total_amount, 1024)
        self.assertEqual(balance.deposit_balance, Decimal("2976.00"))
        self.assertEqual(claim.requested_quantity, 288)
        self.assertEqual(claim.requested_cases, 24)
        self.assertEqual(claim.requested_loose_bottles, 0)
        self.assertEqual(claim.requested_amount, Decimal("2976.00"))
        self.assertEqual(response.json()["appliedAmount"], 2976.0)

        # The driver must count a case-only declaration in cases while the stored
        # quantity remains in bottles for deposit settlement.
        declared = serialize_declared_empties(order)[0]
        self.assertEqual(declared["declaredQuantity"], 288)
        self.assertEqual(declared["declaredCases"], 24)
        self.assertEqual(declared["declaredLooseBottles"], 0)
        self.assertTrue(declared["isRefundClaim"])
        self.assertEqual(declared["declaredUnits"], 24)
        self.assertEqual(declared["containersPerUnit"], 12)
        self.assertTrue(declared["countsByCase"])
        self.assertEqual(declared["unitLabel"], "Case")

    def test_customer_records_cases_and_loose_bottles_from_purchase_history(self) -> None:
        customer = Customer.objects.create(email="mixed-units@example.com", password="hashed", name="Mixed Units")
        product = Product.objects.create(sku="MIXED-UNITS", name="Mixed Units Product", unit="case", price=200, category="Carbonated (Glass)")
        container_type = ContainerType.objects.create(
            code="MIXED-UNITS-GLASS",
            name="Mixed Units Bottle",
            deposit_amount=Decimal("2.00"),
        )
        ProductPackaging.objects.create(
            product=product,
            container_type=container_type,
            is_primary=True,
            is_returnable=True,
            deposit_amount=Decimal("2.00"),
            case_deposit_amount=Decimal("42.00"),
            containers_per_case=24,
        )
        order = Order.objects.create(order_number="PO-MIXED-UNITS", customer=customer, subtotal=1000, total_amount=1000)
        OrderItem.objects.create(
            order=order,
            product=product,
            product_name=product.name,
            product_unit="case",
            quantity=35,
            unit_price=200,
            total_price=7000,
        )
        token = create_token({"type": "customer", "userId": customer.id, "role": "CUSTOMER"})

        response = self.client.post(
            "/api/customer/empty-bottles/record",
            data=json.dumps({"productId": product.id, "cases": 34, "bottles": 9}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json().get("success"), response.json())
        balance = CustomerBottleBalance.objects.get(customer=customer, container_type=container_type)
        self.assertEqual(balance.bottles_outstanding, (34 * 24) + 9)
        self.assertEqual(balance.deposit_balance, (Decimal("90.00") * 34) + (Decimal("2.00") * 9))

    def test_mixed_case_components_are_eligible_as_loose_bottles(self) -> None:
        customer = Customer.objects.create(email="mixed-case-history@example.com", password="hashed", name="Mixed Case History")
        product = Product.objects.create(sku="MIXED-COMPONENT", name="Mixed Component", unit="case", price=240, category="Carbonated (Glass)")
        container_type = ContainerType.objects.create(
            code="MIXED-COMPONENT-GLASS",
            name="Mixed Component Bottle",
            deposit_amount=Decimal("2.00"),
        )
        ProductPackaging.objects.create(
            product=product,
            container_type=container_type,
            is_primary=True,
            is_returnable=True,
            deposit_amount=Decimal("2.00"),
            case_deposit_amount=Decimal("42.00"),
            containers_per_case=24,
        )
        order = Order.objects.create(order_number="PO-MIXED-HISTORY", customer=customer, subtotal=240, total_amount=240)
        item = OrderItem.objects.create(
            order=order,
            product_name="Mixed Case",
            product_unit="mixed case",
            item_type="MIXED_CASE",
            case_capacity=24,
            quantity=1,
            unit_price=240,
            total_price=240,
        )
        MixedCaseComponent.objects.create(
            order_item=item,
            product=product,
            product_name=product.name,
            product_sku=product.sku,
            base_unit_label="bottle",
            quantity_per_case=9,
            case_count=1,
            total_base_units=9,
            unit_price=Decimal("10.00"),
            component_subtotal=Decimal("90.00"),
            container_type_id=container_type.id,
            container_type_name=container_type.name,
            deposit_per_unit=Decimal("2.00"),
        )
        token = create_token({"type": "customer", "userId": customer.id, "role": "CUSTOMER"})

        response = self.client.get(
            "/api/customer/empty-bottles/eligible",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(response.status_code, 200)
        eligible = response.json()["eligibleItems"][0]
        self.assertEqual(eligible["productId"], product.id)
        self.assertEqual(eligible["unit"], "bottle")
        self.assertEqual(eligible["availableCasesToReturn"], 0)
        self.assertEqual(eligible["availableLooseBottlesToReturn"], 9)
