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
    MixedCaseComponent,
    OrderDepositRefundClaim,
    Order,
    OrderItem,
    Product,
    ProductPackaging,
)
from .views_api import _create_order_from_checkout_payload


class CustomerOrderDepositRefundTests(TestCase):
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
            category="Carbonated(Cans)",
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
        self.assertEqual(order.total_amount, 164)
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
            deposit_balance=Decimal("1248.00"),
        )
        order = Order.objects.create(
            order_number="PO-LATER-REFUND",
            purchase_order_number="PO-LATER-REFUND",
            customer=customer,
            subtotal=2000,
            total_amount=2000,
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
                "depositCreditAmount": 1248,
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
        self.assertEqual(order.total_amount, 752)
        self.assertEqual(balance.deposit_balance, Decimal("1248.00"))
        self.assertEqual(claim.requested_quantity, 288)
        self.assertEqual(claim.requested_cases, 24)
        self.assertEqual(claim.requested_loose_bottles, 0)
        self.assertEqual(claim.requested_amount, Decimal("1248.00"))
        self.assertEqual(response.json()["appliedAmount"], 1248.0)

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
        product = Product.objects.create(sku="MIXED-UNITS", name="Mixed Units Product", unit="case", price=200)
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
        self.assertEqual(balance.deposit_balance, (Decimal("42.00") * 34) + (Decimal("2.00") * 9))

    def test_mixed_case_components_are_eligible_as_loose_bottles(self) -> None:
        customer = Customer.objects.create(email="mixed-case-history@example.com", password="hashed", name="Mixed Case History")
        product = Product.objects.create(sku="MIXED-COMPONENT", name="Mixed Component", unit="case", price=240)
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
        self.assertEqual(eligible["availableCasesToReturn"], 0)
        self.assertEqual(eligible["availableLooseBottlesToReturn"], 9)
