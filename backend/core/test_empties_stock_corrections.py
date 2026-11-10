"""Incomplete empties returns: the warehouse's empty stock holds only what arrived."""

from datetime import timedelta
from decimal import Decimal

from django.test import Client, TestCase
from django.utils import timezone

from .auth import create_token
from .deposit_lifecycle import get_empty_bottle_changes, get_product_empty_case_balance
from .empties_verification import record_collected_empties, serialize_declared_empties
from .models import (
    BottleReturnLine,
    ContainerType,
    Customer,
    EmptiesStockCorrection,
    Inventory,
    Order,
    OrderCharge,
    OrderDepositRefundClaim,
    OrderItem,
    OrderStatus,
    Product,
    ProductPackaging,
    User,
    Warehouse,
)


class _EmptiesFixture(TestCase):
    def setUp(self) -> None:
        self.staff = User.objects.create(
            email="empties.staff@example.com", password="hashed", name="Wally Warehouse", role="WAREHOUSE_STAFF", is_active=True,
        )
        self.warehouse = Warehouse.objects.create(
            name="Silay Warehouse", code="WH-EMPTIES", address="Rizal St", city="Silay",
            province="Negros Occidental", zip_code="6116", manager_id=self.staff.id,
        )
        self.customer = Customer.objects.create(email="store@example.com", password="hashed", name="Lopez Store")
        # Two brands in the same 12oz glass bottle.
        self.container = ContainerType.objects.create(
            code="RGB-12OZ", name="12oz Glass Bottle", category=ContainerType.Category.BOTTLE,
            material=ContainerType.Material.GLASS, is_returnable=True, deposit_amount=Decimal("2.00"),
        )
        self.pepsi = self._product("PEPS-12OZ", "Pepsi 12oz")
        self.sarsi = self._product("SARS-12OZ", "Sarsi 12oz")
        self.pepsi_stock = Inventory.objects.create(warehouse=self.warehouse, product=self.pepsi)
        self.sarsi_stock = Inventory.objects.create(warehouse=self.warehouse, product=self.sarsi)

    def _product(self, sku: str, name: str) -> Product:
        product = Product.objects.create(sku=sku, name=name, unit="case", quantity_per_unit=24, packaging_type="RETURNABLE")
        ProductPackaging.objects.create(
            product=product, container_type=self.container, containers_per_case=24, is_primary=True, is_returnable=True,
        )
        return product

    def _order(self, number: str, declared: dict[Product, int], warehouse: Warehouse | None = None) -> Order:
        order = Order.objects.create(
            order_number=number, customer=self.customer, status=OrderStatus.OUT_FOR_DELIVERY,
            warehouse_id=(warehouse or self.warehouse).id, subtotal=0, total_amount=0,
        )
        for product, bottles in declared.items():
            OrderItem.objects.create(
                order=order, product=product, product_name=product.name, product_unit="case", quantity=1,
                unit_price=0, total_price=0, container_type_id=self.container.id, empty_returned_quantity=bottles,
                deposit_refunded=Decimal("2.00") * bottles,
            )
        return order

    def _deliver(self, order: Order, counted: dict[Product, int] | None = None, container_total: int | None = None):
        lines = (
            [{"containerTypeId": self.container.id, "returnedQuantity": container_total}]
            if container_total is not None
            else [
                {"containerTypeId": self.container.id, "declarationId": f"{self.container.id}:{product.id}", "returnedQuantity": bottles}
                for product, bottles in (counted or {}).items()
            ]
        )
        result = record_collected_empties(order=order, drop_point=None, submitted_lines=lines, performed_by="driver-1")
        Order.objects.filter(id=order.id).update(status=OrderStatus.DELIVERED)
        return result

    def available(self, inventory: Inventory) -> int:
        return get_product_empty_case_balance(inventory)["availableBottles"]


class EmptiesStockCorrectionTests(_EmptiesFixture):
    def test_a_complete_return_needs_no_correction(self) -> None:
        self._deliver(self._order("ORD-FULL", {self.pepsi: 24}), {self.pepsi: 24})

        self.assertFalse(EmptiesStockCorrection.objects.exists())
        self.assertEqual(self.available(self.pepsi_stock), 24)

    def test_an_incomplete_return_puts_only_what_arrived_into_stock(self) -> None:
        order = self._order("ORD-SHORT", {self.pepsi: 24})

        result = self._deliver(order, {self.pepsi: 20})

        balance = get_product_empty_case_balance(self.pepsi_stock)
        self.assertEqual((balance["availableBottles"], balance["availableCases"], balance["looseBottles"]), (20, 0, 20))
        correction = EmptiesStockCorrection.objects.get(order=order)
        self.assertEqual((correction.declared_bottles, correction.counted_bottles, correction.bottles), (24, 20, -4))
        # The customer pays the deposit of the four bottles they kept.
        self.assertEqual(result["shortfallAmount"], 8.0)
        self.assertEqual(OrderCharge.objects.get(order=order, reason="EMPTIES_SHORTFALL").amount, Decimal("8.00"))

    def test_nothing_handed_over_adds_nothing_to_stock(self) -> None:
        order = self._order("ORD-NONE", {self.pepsi: 24})

        self._deliver(order, {self.pepsi: 0})

        self.assertEqual(self.available(self.pepsi_stock), 0)
        self.assertEqual(EmptiesStockCorrection.objects.get(order=order).bottles, -24)

    def test_each_brand_keeps_its_own_count_in_a_shared_bottle(self) -> None:
        order = self._order("ORD-TWO", {self.pepsi: 24, self.sarsi: 24})

        self._deliver(order, {self.pepsi: 24, self.sarsi: 12})

        self.assertEqual(self.available(self.pepsi_stock), 24)
        self.assertEqual(self.available(self.sarsi_stock), 12)
        self.assertEqual(list(EmptiesStockCorrection.objects.values_list("product_id", "bottles")), [(self.sarsi.id, -12)])

    def test_a_count_for_the_whole_container_fills_declarations_in_turn(self) -> None:
        # An older client sends one number per container type.
        order = self._order("ORD-TOTAL", {self.pepsi: 24, self.sarsi: 24})

        self._deliver(order, container_total=36)

        self.assertEqual(self.available(self.pepsi_stock) + self.available(self.sarsi_stock), 36)
        self.assertEqual(EmptiesStockCorrection.objects.get(order=order).bottles, -12)

    def test_a_retried_count_corrects_once(self) -> None:
        order = self._order("ORD-RETRY", {self.pepsi: 24})
        self._deliver(order, {self.pepsi: 20})
        retry = record_collected_empties(
            order=order, drop_point=None,
            submitted_lines=[{"containerTypeId": self.container.id, "declarationId": f"{self.container.id}:{self.pepsi.id}", "returnedQuantity": 20}],
        )
        self.assertTrue(retry["alreadyRecorded"])
        self.assertEqual(EmptiesStockCorrection.objects.count(), 1)
        self.assertEqual(self.available(self.pepsi_stock), 20)

    def test_the_dated_history_lands_the_correction_with_its_delivery(self) -> None:
        order = self._order("ORD-DATED", {self.pepsi: 24})
        self._deliver(order, {self.pepsi: 18})

        changes = get_empty_bottle_changes([self.pepsi_stock])[self.pepsi_stock.id]
        self.assertEqual(sum(change["bottles"] for change in changes), 18)
        self.assertEqual(get_empty_bottle_changes([self.pepsi_stock], since=timezone.now() + timedelta(days=1))[self.pepsi_stock.id], [])

    def test_an_order_that_never_completes_leaves_stock_untouched(self) -> None:
        order = self._order("ORD-OPEN", {self.pepsi: 24})
        record_collected_empties(
            order=order, drop_point=None,
            submitted_lines=[{"containerTypeId": self.container.id, "declarationId": f"{self.container.id}:{self.pepsi.id}", "returnedQuantity": 10}],
        )
        # Not delivered: neither the declaration nor its correction counts.
        self.assertEqual(self.available(self.pepsi_stock), 0)


class EmptiesShortfallListTests(_EmptiesFixture):
    """The Empties tab's list of incomplete returns: read-only, scoped by warehouse."""

    def setUp(self) -> None:
        super().setUp()
        self.client = Client()
        self.admin = User.objects.create(email="empties.admin@example.com", password="hashed", name="Ana Admin", role="ADMIN", is_active=True)
        self.driver = User.objects.create(email="empties.driver@example.com", password="hashed", name="Juan Driver", role="DRIVER", is_active=True)
        self.other_staff = User.objects.create(
            email="empties.other@example.com", password="hashed", name="Olga Other", role="WAREHOUSE_STAFF", is_active=True,
        )
        self.other_warehouse = Warehouse.objects.create(
            name="Talisay Warehouse", code="WH-EMPTIES-2", address="Mabini St", city="Talisay",
            province="Negros Occidental", zip_code="6115", manager_id=self.other_staff.id,
        )

    def get(self, user: User | None, query: str = ""):
        headers = {}
        if user is not None:
            token = create_token({"userId": user.id, "email": user.email, "name": user.name, "role": user.role, "type": "staff"})
            headers["HTTP_AUTHORIZATION"] = f"Bearer {token}"
        return self.client.get(f"/api/inventory/empties-shortfalls{query}", **headers)

    def test_lists_what_went_missing_and_the_deposit_charged(self) -> None:
        self._deliver(self._order("ORD-SHORT", {self.pepsi: 24, self.sarsi: 24}), {self.pepsi: 24, self.sarsi: 20})
        self._deliver(self._order("ORD-FULL", {self.pepsi: 24}), {self.pepsi: 24})

        response = self.get(self.staff)

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        [row] = payload["shortfalls"]
        self.assertEqual((row["orderNumber"], row["customerName"], row["warehouseName"]), ("ORD-SHORT", "Lopez Store", "Silay Warehouse"))
        # Only the brand that came back short; Pepsi arrived in full.
        self.assertEqual(
            [(line["productName"], line["declaredBottles"], line["countedBottles"], line["missingBottles"]) for line in row["lines"]],
            [("Sarsi 12oz", 24, 20, 4)],
        )
        self.assertEqual((row["missingBottles"], row["depositCharged"]), (4, 8.0))
        self.assertTrue(row["returnNumber"].startswith("RTR-"))
        self.assertEqual(payload["summary"], {"orders": 1, "missingBottles": 4, "depositCharged": 8.0})

    def test_an_order_still_on_the_road_is_not_listed(self) -> None:
        order = self._order("ORD-OPEN", {self.pepsi: 24})
        record_collected_empties(
            order=order, drop_point=None,
            submitted_lines=[{"containerTypeId": self.container.id, "declarationId": f"{self.container.id}:{self.pepsi.id}", "returnedQuantity": 10}],
        )

        self.assertEqual(self.get(self.staff).json()["shortfalls"], [])

    def test_staff_see_only_their_own_warehouse(self) -> None:
        self._deliver(self._order("ORD-SILAY", {self.pepsi: 24}), {self.pepsi: 12})
        self._deliver(self._order("ORD-TALISAY", {self.pepsi: 24}, self.other_warehouse), {self.pepsi: 6})

        self.assertEqual([row["orderNumber"] for row in self.get(self.staff).json()["shortfalls"]], ["ORD-SILAY"])
        self.assertEqual([row["orderNumber"] for row in self.get(self.other_staff).json()["shortfalls"]], ["ORD-TALISAY"])
        self.assertEqual(self.get(self.staff, f"?warehouseId={self.other_warehouse.id}").status_code, 403)

    def test_admins_read_every_warehouse(self) -> None:
        self._deliver(self._order("ORD-SILAY", {self.pepsi: 24}), {self.pepsi: 12})
        self._deliver(self._order("ORD-TALISAY", {self.pepsi: 24}, self.other_warehouse), {self.pepsi: 6})

        listed = self.get(self.admin).json()
        self.assertEqual(sorted(row["orderNumber"] for row in listed["shortfalls"]), ["ORD-SILAY", "ORD-TALISAY"])
        self.assertEqual(listed["summary"]["missingBottles"], 30)
        only_talisay = self.get(self.admin, f"?warehouseId={self.other_warehouse.id}").json()
        self.assertEqual([row["orderNumber"] for row in only_talisay["shortfalls"]], ["ORD-TALISAY"])

    def test_drivers_and_signed_out_visitors_are_refused(self) -> None:
        self._deliver(self._order("ORD-SILAY", {self.pepsi: 24}), {self.pepsi: 12})

        self.assertEqual(self.get(self.driver).status_code, 403)
        self.assertEqual(self.get(None).status_code, 401)


class MissingBottleShortfallTests(_EmptiesFixture):
    """A case handed back short of a bottle is charged that bottle, not a share of its shell."""

    def _cased_order(self, number: str, cases: int) -> Order:
        # Price-list 12oz glass: 24 bottles at 2.00 plus a 42.00 shell, 90.00 a case.
        order = Order.objects.create(
            order_number=number, customer=self.customer, status=OrderStatus.OUT_FOR_DELIVERY,
            warehouse_id=self.warehouse.id, subtotal=0, total_amount=0,
        )
        OrderItem.objects.create(
            order=order, product=self.pepsi, product_name=self.pepsi.name, product_unit="case", quantity=cases,
            unit_price=0, total_price=0, container_type_id=self.container.id, empty_returned_quantity=cases * 24,
            deposit_per_unit=Decimal("2.00"), deposit_refunded=Decimal("90.00") * cases,
        )
        return order

    def _collect(self, order: Order, bottles: int, cases: int | None = None):
        line = {"containerTypeId": self.container.id, "declarationId": f"{self.container.id}:{self.pepsi.id}", "returnedQuantity": bottles}
        if cases is not None:
            line["returnedCases"] = cases
        return record_collected_empties(order=order, drop_point=None, submitted_lines=[line], performed_by="driver-1")

    def test_the_driver_sees_the_shell_part_of_the_declaration(self) -> None:
        [declared] = serialize_declared_empties(self._cased_order("ORD-SEE", 12))

        self.assertEqual((declared["declaredCases"], declared["declaredQuantity"]), (12, 288))
        self.assertEqual((declared["depositValue"], declared["shellDepositValue"]), (1080.0, 504.0))

    def test_one_bottle_missing_from_a_returned_case_costs_one_bottle_deposit(self) -> None:
        order = self._cased_order("ORD-ONE", 12)

        result = self._collect(order, 287, cases=12)

        self.assertEqual(result["shortfallAmount"], 2.0)
        self.assertEqual(OrderCharge.objects.get(order=order, reason="EMPTIES_SHORTFALL").amount, Decimal("2.00"))
        # The refund and the charge-back add up to what the customer was credited.
        self.assertEqual(BottleReturnLine.objects.get(bottle_return_id=result["bottleReturnId"]).deposit_refund_amount, Decimal("1078.00"))
        self.assertEqual(EmptiesStockCorrection.objects.get(order=order).bottles, -1)

    def test_a_case_not_handed_over_costs_its_bottles_and_shell(self) -> None:
        self.assertEqual(self._collect(self._cased_order("ORD-CASE", 12), 264, cases=11)["shortfallAmount"], 90.0)
        self.assertEqual(self._collect(self._cased_order("ORD-BOTH", 12), 263, cases=11)["shortfallAmount"], 92.0)

    def test_a_bottle_count_alone_reads_a_part_filled_case_as_returned(self) -> None:
        # The Expo driver app sends only the bottle total.
        self.assertEqual(self._collect(self._cased_order("ORD-OLD-1", 12), 287)["shortfallAmount"], 2.0)
        self.assertEqual(self._collect(self._cased_order("ORD-OLD-2", 12), 264)["shortfallAmount"], 90.0)

    def test_a_refund_claim_short_one_bottle_keeps_the_rest_of_its_credit(self) -> None:
        order = Order.objects.create(
            order_number="ORD-CLAIM", customer=self.customer, status=OrderStatus.OUT_FOR_DELIVERY,
            warehouse_id=self.warehouse.id, subtotal=0, total_amount=0,
        )
        claim = OrderDepositRefundClaim.objects.create(
            order=order, product=self.pepsi, product_name=self.pepsi.name, container_type=self.container,
            requested_quantity=48, requested_cases=2, containers_per_case=24,
            deposit_per_container=Decimal("2.00"), case_deposit_amount=Decimal("42.00"), requested_amount=Decimal("180.00"),
        )

        result = self._collect(order, 47, cases=2)

        claim.refresh_from_db()
        self.assertEqual(result["shortfallAmount"], 2.0)
        self.assertEqual((claim.status, claim.collected_quantity, claim.collected_amount), ("PARTIAL", 47, Decimal("178.00")))
