"""Opening stock needs review and must not create a paid deposit or duplicate stock."""
import json
from decimal import Decimal
from io import BytesIO

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from PIL import Image

from .auth import create_token
from .bottle_services import get_or_create_product_packaging
from .empties_verification import record_collected_empties
from .models import Customer, CustomerBottleBalance, DepositTransaction, Notification, OpeningEmptiesDeclaration, Order, OrderItem, Product, ProductPackaging, User
from .order_lifecycle import _create_deposit_refund_claims, _create_order_from_checkout_payload
from .rgb.services import get_customer_bottle_balances, process_bottle_return


class OpeningEmptiesTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(email="opening@example.com", password="hashed", name="New Customer")
        self.other = Customer.objects.create(email="other-opening@example.com", password="hashed", name="Other Customer")
        self.admin = User.objects.create(email="opening-admin@example.com", password="hashed", name="Admin", role="ADMIN")
        self.warehouse = User.objects.create(email="opening-wh@example.com", password="hashed", name="Warehouse", role="WAREHOUSE_STAFF")
        self.driver = User.objects.create(email="opening-driver@example.com", password="hashed", name="Driver", role="DRIVER")
        self.product = Product.objects.create(sku="OPENING-GLASS", name="Opening Glass", unit="case", quantity_per_unit=24, category="Carbonated (Glass)")
        self.packaging, self.container = get_or_create_product_packaging(self.product)
        self.url = "/api/customer/empty-bottles/opening"
        self.photos = {}

    def headers(self, actor):
        customer = isinstance(actor, Customer)
        token = create_token({"userId": actor.id, "type": "customer" if customer else "staff", "role": "CUSTOMER" if customer else actor.role})
        return {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    def upload_photo(self, actor=None, content_type="image/png"):
        image = BytesIO()
        Image.new("RGB", (40, 30), "green").save(image, format="PNG")
        upload = SimpleUploadedFile("empties.png", image.getvalue(), content_type=content_type)
        return self.client.post(f"{self.url}/evidence", {"file": upload}, **self.headers(actor or self.customer))

    def photo_for(self, actor, request_id):
        # A retry of the same request reuses its photo, as the web client does.
        key = (actor.id, request_id)
        if key not in self.photos:
            response = self.upload_photo(actor)
            self.assertEqual(response.status_code, 200, response.content)
            self.photos[key] = response.json()["imageUrl"]
        return self.photos[key]

    def declare(self, actor=None, **overrides):
        actor = actor or self.customer
        body = {"requestId": "opening-1", "productId": self.product.id, "cases": 2, "bottles": 3, "notes": "Owned before launch"}
        body.update(overrides)
        body.setdefault("evidencePhotoUrl", self.photo_for(actor, body["requestId"]))
        return self.client.post(self.url, json.dumps(body), content_type="application/json", **self.headers(actor))

    def review(self, declaration_id, actor=None, decision="APPROVED", notes="Count verified"):
        return self.client.post(f"/api/staff/empty-bottles/opening/{declaration_id}/review", json.dumps({"decision": decision, "reviewNotes": notes}), content_type="application/json", **self.headers(actor or self.admin))

    def approve(self, **kwargs):
        response = self.declare(**kwargs)
        self.assertEqual(response.status_code, 201, response.content)
        declaration_id = response.json()["declaration"]["id"]
        review = self.review(declaration_id)
        self.assertEqual(review.status_code, 200, review.content)
        return OpeningEmptiesDeclaration.objects.get(id=declaration_id)

    def test_new_customer_can_declare_but_pending_stock_is_unavailable(self):
        result = self.client.get(self.url, **self.headers(self.customer))
        self.assertEqual(result.status_code, 200)
        self.assertIn(self.product.id, [row["productId"] for row in result.json()["products"]])
        response = self.declare()
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["declaration"]["status"], "PENDING")
        self.assertEqual(get_customer_bottle_balances(self.customer), [])
        self.assertFalse(DepositTransaction.objects.filter(customer=self.customer).exists())

    def test_approval_is_idempotent_and_does_not_credit_a_paid_deposit(self):
        declaration = self.approve()
        self.assertEqual(self.review(declaration.id).status_code, 200)
        balance = CustomerBottleBalance.objects.get(customer=self.customer)
        self.assertEqual(balance.bottles_outstanding, 51)
        self.assertEqual(balance.deposit_balance, Decimal("0"))
        self.assertEqual(balance.bottles_sold_total, 0)
        entry = DepositTransaction.objects.get(customer=self.customer)
        self.assertEqual(entry.amount, Decimal("0"))
        self.assertEqual(entry.reference_type, "opening_product")
        self.assertEqual(declaration.remaining_bottles, 51)
        self.assertEqual(declaration.reviewed_by_id, self.admin.id)
        row = get_customer_bottle_balances(self.customer)[0]["productBalances"][0]
        self.assertEqual(row["bottlesAvailable"], 51)
        self.assertEqual(row["openingBottlesAvailable"], 51)
        self.assertEqual(row["refundableBottlesAvailable"], 0)
        self.assertEqual(row["refundableDepositAvailable"], 0)

    def test_retries_and_duplicate_declarations_cannot_add_stock_twice(self):
        first = self.declare()
        retry = self.declare()
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(first.json()["declaration"]["id"], retry.json()["declaration"]["id"])
        self.assertEqual(self.declare(requestId="different").status_code, 409)
        self.assertEqual(self.declare(cases=3).status_code, 409)
        self.review(first.json()["declaration"]["id"])
        self.assertEqual(self.declare(requestId="after-approval").status_code, 409)

    def test_rejection_preserves_balances_and_allows_correction(self):
        declaration_id = self.declare().json()["declaration"]["id"]
        self.assertEqual(self.review(declaration_id, decision="REJECTED", notes="").status_code, 400)
        self.assertEqual(self.review(declaration_id, decision="REJECTED", notes="Count differs").status_code, 200)
        self.assertFalse(CustomerBottleBalance.objects.filter(customer=self.customer).exists())
        self.assertEqual(self.review(declaration_id).status_code, 409)
        self.assertEqual(self.declare(requestId="corrected", cases=1).status_code, 201)

    def test_only_active_admin_and_warehouse_can_review(self):
        declaration_id = self.declare().json()["declaration"]["id"]
        for actor in [self.customer, self.other, self.driver]:
            self.assertIn(self.review(declaration_id, actor).status_code, [401, 403])
        self.admin.is_active = False
        self.admin.save(update_fields=["is_active"])
        self.assertIn(self.review(declaration_id).status_code, [401, 403])
        self.assertEqual(self.review(declaration_id, self.warehouse).status_code, 200)

    def test_history_is_private_and_staff_queue_is_protected(self):
        self.declare()
        self.assertEqual(self.client.get(self.url, **self.headers(self.other)).json()["declarations"], [])
        queue = "/api/staff/empty-bottles/opening"
        self.assertIn(self.client.get(queue, **self.headers(self.customer)).status_code, [401, 403])
        self.assertEqual(len(self.client.get(queue, **self.headers(self.admin)).json()["declarations"]), 1)
        self.assertEqual(self.client.get(queue, {"customerId": self.other.id}, **self.headers(self.warehouse)).json()["declarations"], [])
        self.assertEqual(self.client.get(self.url).status_code, 401)

    def test_invalid_quantities_and_nonreturnable_products_are_rejected(self):
        for overrides in [{"cases": -1}, {"bottles": 1.5}, {"cases": True}, {"cases": "2"}, {"cases": 0, "bottles": 0}, {"bottles": 24}, {"notes": "x" * 1001}, {"cases": 2147483647}]:
            with self.subTest(overrides=overrides):
                self.assertEqual(self.declare(**overrides).status_code, 400)
        plastic = Product.objects.create(sku="OPENING-PET", name="Plastic", category="Carbonated (PET/PLASTIC)")
        self.assertEqual(self.declare(productId=plastic.id).status_code, 400)

    def test_each_declaration_needs_its_own_photo_from_this_customer(self):
        other_photo = self.photo_for(self.other, "theirs")
        for evidence in [None, "", other_photo, "/api/media/replacement-evidence/replacement-evidence-" + "a" * 32 + ".webp", 42]:
            with self.subTest(evidence=evidence):
                self.assertEqual(self.declare(evidencePhotoUrl=evidence).status_code, 400)
        self.assertEqual(self.upload_photo(content_type="application/pdf").status_code, 400)
        self.assertIn(self.upload_photo(self.admin).status_code, [401, 403])
        created = self.declare()
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()["declaration"]["evidencePhotoUrl"], self.photo_for(self.customer, "opening-1"))
        second = self.glass_product("OPENING-REUSE", "Reuse Glass")
        reused = self.declare(requestId="second", productId=second.id, evidencePhotoUrl=self.photo_for(self.customer, "opening-1"))
        self.assertEqual(reused.status_code, 400)

    def photo_status(self, url, actor=None):
        response = self.client.get(url, **(self.headers(actor) if actor else {}))
        response.close()  # Release the served file so the temporary media folder can be removed.
        return response.status_code

    def test_photo_is_visible_to_its_customer_and_reviewers_only(self):
        photo = self.declare().json()["declaration"]["evidencePhotoUrl"]
        for actor in [self.customer, self.admin, self.warehouse]:
            self.assertEqual(self.photo_status(photo, actor), 200)
        for actor in [self.other, self.driver]:
            self.assertEqual(self.photo_status(photo, actor), 403)
        self.assertEqual(self.photo_status(photo), 401)
        # A photo no declaration references is served to no one.
        stray = self.photo_for(self.customer, "never-submitted")
        self.assertEqual(self.photo_status(stray, self.admin), 403)

    def glass_product(self, sku, name, **fields):
        product = Product.objects.create(sku=sku, name=name, unit=fields.pop("unit", "case"), quantity_per_unit=24, category="Carbonated (Glass)", **fields)
        get_or_create_product_packaging(product)
        return product

    def test_product_list_is_deposit_products_with_sizes_and_writes_nothing(self):
        liter = self.glass_product("OPENING-1L", "Opening Glass", sizes=["1 Liter"])
        no_packaging = Product.objects.create(sku="OPENING-BARE", name="Bare Glass", category="Carbonated (Glass)")
        free = self.glass_product("OPENING-FREE", "Free Glass")
        ProductPackaging.objects.filter(product=free).update(deposit_amount=0, case_deposit_amount=0)
        plastic = Product.objects.create(sku="OPENING-PET-LIST", name="Plastic", category="Carbonated (PET/PLASTIC)")
        packaging_rows = ProductPackaging.objects.count()
        products = self.client.get(self.url, **self.headers(self.customer)).json()["products"]
        labels = {row["productId"]: row["productLabel"] for row in products}
        self.assertEqual(labels, {self.product.id: "Opening Glass", liter.id: "Opening Glass - 1 Liter"})
        self.assertNotIn(no_packaging.id, labels)
        self.assertNotIn(plastic.id, labels)
        self.assertEqual(ProductPackaging.objects.count(), packaging_rows)
        self.assertEqual(Product.objects.get(id=no_packaging.id).packaging_type, "NON_RETURNABLE")

    def declare_many(self, *items):
        body = {"items": [{
            "notes": "", "cases": 1, "bottles": 0, **item,
            "evidencePhotoUrl": item.get("evidencePhotoUrl") or self.photo_for(self.customer, item["requestId"]),
        } for item in items]}
        return self.client.post(self.url, json.dumps(body), content_type="application/json", **self.headers(self.customer))

    def test_several_products_are_declared_together_or_not_at_all(self):
        second = self.glass_product("OPENING-BATCH", "Batch Glass", sizes=["8oz"])
        plastic = Product.objects.create(sku="OPENING-PET-BATCH", name="Plastic", category="Carbonated (PET/PLASTIC)")
        refused = self.declare_many({"requestId": "a", "productId": self.product.id}, {"requestId": "b", "productId": plastic.id})
        self.assertEqual(refused.status_code, 400)
        self.assertFalse(OpeningEmptiesDeclaration.objects.exists())
        self.assertEqual(self.declare_many({"requestId": "a", "productId": self.product.id}, {"requestId": "b", "productId": self.product.id}).status_code, 400)
        shared = self.photo_for(self.customer, "a")
        self.assertEqual(self.declare_many({"requestId": "a", "productId": self.product.id}, {"requestId": "b", "productId": second.id, "evidencePhotoUrl": shared}).status_code, 400)

        both = self.declare_many({"requestId": "a", "productId": self.product.id}, {"requestId": "b", "productId": second.id, "cases": 2})
        self.assertEqual(both.status_code, 201, both.content)
        rows = both.json()["declarations"]
        self.assertEqual([row["productLabel"] for row in rows], ["Opening Glass", "Batch Glass - 8oz"])
        self.assertEqual(len({row["evidencePhotoUrl"] for row in rows}), 2)
        retry = self.declare_many({"requestId": "a", "productId": self.product.id}, {"requestId": "b", "productId": second.id, "cases": 2})
        self.assertEqual(retry.status_code, 200)
        self.assertEqual([row["id"] for row in retry.json()["declarations"]], [row["id"] for row in rows])
        self.assertEqual(OpeningEmptiesDeclaration.objects.count(), 2)

    def review_submission(self, submission_id, decision="APPROVED", notes="Count verified"):
        return self.client.post(f"/api/staff/empty-bottles/opening/submissions/{submission_id}/review",
            json.dumps({"decision": decision, "reviewNotes": notes}), content_type="application/json", **self.headers(self.warehouse))

    def test_products_submitted_together_are_one_declaration_reviewed_together(self):
        second = self.glass_product("OPENING-TOGETHER", "Together Glass", sizes=["8oz"])
        created = self.declare_many({"requestId": "a", "productId": self.product.id}, {"requestId": "b", "productId": second.id, "cases": 2})
        submission = {row["submissionId"] for row in created.json()["declarations"]}
        self.assertEqual(len(submission), 1)
        submission_id = submission.pop()
        retry = self.declare_many({"requestId": "a", "productId": self.product.id}, {"requestId": "b", "productId": second.id, "cases": 2})
        self.assertEqual({row["submissionId"] for row in retry.json()["declarations"]}, {submission_id})

        self.assertEqual(self.review_submission(submission_id, "REJECTED", "").status_code, 400)
        approved = self.review_submission(submission_id)
        self.assertEqual(approved.status_code, 200, approved.content)
        self.assertEqual([row["status"] for row in approved.json()["declarations"]], ["APPROVED", "APPROVED"])
        # Both products share the 330ml container: 1 case + 2 cases of 24.
        self.assertEqual(CustomerBottleBalance.objects.get(customer=self.customer).bottles_outstanding, 72)
        self.assertEqual(DepositTransaction.objects.filter(customer=self.customer, reference_type="opening_product").count(), 2)
        self.assertEqual(self.review_submission(submission_id).status_code, 200)
        self.assertEqual(self.review_submission(submission_id, "REJECTED", "Too late").status_code, 409)
        self.assertEqual(self.review_submission("missing").status_code, 404)

    def test_staff_hear_about_a_new_declaration_once(self):
        second = self.glass_product("OPENING-NOTIFY", "Notify Glass", sizes=["8oz"])
        items = ({"requestId": "a", "productId": self.product.id}, {"requestId": "b", "productId": second.id, "cases": 2})
        self.declare_many(*items)
        self.declare_many(*items)  # A retry must not alert anyone again.
        alerts = Notification.objects.filter(title="Existing empties declared")
        self.assertEqual(set(alerts.values_list("user_id", flat=True)), {self.admin.id, self.warehouse.id})
        self.assertFalse(alerts.filter(user=self.driver).exists())
        message = alerts.first().message
        self.assertIn("New Customer declared existing empties for review", message)
        self.assertIn("Opening Glass (1 case), Notify Glass - 8oz (2 cases)", message)
        self.assertEqual(alerts.first().reference_type, "opening_empties")

    def test_customer_hears_the_review_outcome_once_per_declaration(self):
        second = self.glass_product("OPENING-OUTCOME", "Outcome Glass")
        submission = self.declare_many({"requestId": "a", "productId": self.product.id}, {"requestId": "b", "productId": second.id}).json()["declarations"][0]["submissionId"]
        self.review_submission(submission)
        self.review_submission(submission)  # Retried approval.
        approved = Notification.objects.filter(customer=self.customer, title="Existing empties approved")
        self.assertEqual(approved.count(), 1)
        self.assertIn("Opening Glass (1 case), Outcome Glass (1 case)", approved.get().message)

        rejected_id = self.declare(requestId="later", productId=self.glass_product("OPENING-REJ", "Rejected Glass").id).json()["declaration"]["submissionId"]
        self.review_submission(rejected_id, "REJECTED", "Only one case was present")
        rejected = Notification.objects.get(customer=self.customer, title="Existing empties declaration rejected")
        self.assertIn("Reason: Only one case was present. You can declare them again", rejected.message)

    def test_one_blocked_product_keeps_the_whole_declaration_pending(self):
        second = self.glass_product("OPENING-BLOCKED", "Blocked Glass", sizes=["12oz"])
        rows = self.declare_many({"requestId": "a", "productId": self.product.id}, {"requestId": "b", "productId": second.id}).json()["declarations"]
        ProductPackaging.objects.filter(product=second).update(containers_per_case=12)
        refused = self.review_submission(rows[0]["submissionId"])
        self.assertEqual(refused.status_code, 409)
        self.assertIn("Blocked Glass - 12oz", refused.json()["error"])
        self.assertEqual(set(OpeningEmptiesDeclaration.objects.values_list("status", flat=True)), {"PENDING"})
        self.assertFalse(CustomerBottleBalance.objects.filter(customer=self.customer).exists())
        self.assertEqual(self.review_submission(rows[0]["submissionId"], "REJECTED", "Packaging changed").status_code, 200)
        self.assertEqual(set(OpeningEmptiesDeclaration.objects.values_list("status", flat=True)), {"REJECTED"})

    def test_existing_rows_are_grouped_into_submissions_by_the_migration(self):
        from datetime import timedelta
        from importlib import import_module

        from django.apps import apps
        from django.utils import timezone

        start = timezone.now()
        others = [self.glass_product(f"OPENING-MIG-{n}", f"Migrated {n}") for n in range(3)]
        def row(customer, product, seconds):
            return OpeningEmptiesDeclaration.objects.create(
                request_id=f"{product.id}-{customer.id}", customer=customer, product=product, container_type=self.container,
                cases=1, containers_per_case=24, created_at=start + timedelta(seconds=seconds))
        together = [row(self.customer, self.product, 0), row(self.customer, others[0], 1)]
        later = row(self.customer, others[1], 120)
        elsewhere = row(self.other, others[2], 1)
        import_module("core.migrations.0152_opening_empties_submission").group_existing_rows(apps, None)
        for declaration in [*together, later, elsewhere]:
            declaration.refresh_from_db()
        self.assertEqual({d.submission_id for d in together}, {together[0].id})
        self.assertEqual(later.submission_id, later.id)
        self.assertEqual(elsewhere.submission_id, elsewhere.id)

    def test_bottle_product_accepts_bottles_without_cases(self):
        product = self.glass_product("OPENING-SINGLE", "Single Glass", unit="bottle")
        self.approve(productId=product.id, cases=0, bottles=8)

    def test_changed_packaging_requires_a_new_declaration(self):
        declaration_id = self.declare().json()["declaration"]["id"]
        self.packaging.containers_per_case = 12
        self.packaging.save(update_fields=["containers_per_case"])
        self.assertEqual(self.review(declaration_id).status_code, 409)
        self.assertFalse(CustomerBottleBalance.objects.filter(customer=self.customer).exists())

    def exchange_order(self, quantity=24):
        order = Order.objects.create(order_number="OPENING-EXCHANGE", customer=self.customer, subtotal=240, total_amount=240)
        OrderItem.objects.create(order=order, product=self.product, quantity=1, unit_price=240, total_price=240,
                                 container_type_id=self.container.id, empty_returned_quantity=quantity,
                                 deposit_refunded=Decimal(quantity) * Decimal("3.75"))
        return order

    def test_opening_stock_cannot_fund_invoice_refund_or_unallocated_return(self):
        self.approve()
        order = Order.objects.create(order_number="OPENING-REFUND", customer=self.customer, subtotal=240, total_amount=240)
        with self.assertRaisesMessage(ValueError, "exceeds the verified available empties"):
            _create_deposit_refund_claims(order=order, customer=self.customer, maximum_order_credit=Decimal("240"),
                raw_refund_lines=[{"productId": self.product.id, "containerTypeId": self.container.id, "cases": 1, "bottles": 0}])
        with self.assertRaisesMessage(ValueError, "matching product exchange"):
            process_bottle_return(customer=self.customer, lines=[{"containerTypeId": self.container.id, "quantityClaimed": 24, "quantityGradedReusable": 24}])

    def test_delivery_consumes_only_collected_opening_stock_once_without_refund(self):
        declaration = self.approve()
        order = self.exchange_order()
        result = record_collected_empties(order=order, drop_point=None, submitted_lines=[{"containerTypeId": self.container.id, "returnedQuantity": 12}])
        self.assertEqual(result["shortfallAmount"], 45)
        declaration.refresh_from_db()
        self.assertEqual(declaration.remaining_bottles, 39)
        self.assertEqual(CustomerBottleBalance.objects.get(customer=self.customer).bottles_outstanding, 39)
        self.assertFalse(DepositTransaction.objects.filter(customer=self.customer, type="REFUND").exists())
        retry = record_collected_empties(order=order, drop_point=None, submitted_lines=[{"containerTypeId": self.container.id, "returnedQuantity": 12}])
        self.assertTrue(retry["alreadyRecorded"])
        declaration.refresh_from_db()
        self.assertEqual(declaration.remaining_bottles, 39)

    def test_checkout_reserves_opening_stock_and_cancellation_releases_it(self):
        self.approve()
        order = _create_order_from_checkout_payload(
            customer=self.customer, body={},
            normalized_items=[{"productId": self.product.id, "quantity": 1, "unitPrice": 240,
                               "totalPrice": 240, "emptyReturnedQuantity": 24}],
            subtotal=240, discount=0, total_amount=240, selected_warehouse_id=None,
            shipping_latitude=None, shipping_longitude=None, payment_status="pending", performed_by=self.customer.id,
        )
        self.assertEqual(order.total_amount, 240)
        self.assertEqual(order.items.get().net_deposit, 0)
        row = get_customer_bottle_balances(self.customer)[0]["productBalances"][0]
        self.assertEqual(row["bottlesAvailable"], 27)
        self.assertEqual(row["refundableBottlesAvailable"], 0)
        order.status = "CANCELLED"
        order.save(update_fields=["status"])
        self.assertEqual(get_customer_bottle_balances(self.customer)[0]["productBalances"][0]["bottlesAvailable"], 51)

    def test_opening_and_paid_quantities_remain_separate_when_reserved(self):
        self.approve(cases=1, bottles=0)
        balance = CustomerBottleBalance.objects.get(customer=self.customer)
        balance.bottles_outstanding += 24
        balance.deposit_balance = Decimal("90")
        balance.save()
        DepositTransaction.objects.create(customer=self.customer, type="ADJUSTMENT", amount=90,
            balance_before=0, balance_after=90, container_type=self.container, container_count=24,
            reference_type="product", reference_id=self.product.id, reason=f"Customer declared 1 empty case(s) of {self.product.name}")
        row = get_customer_bottle_balances(self.customer)[0]["productBalances"][0]
        self.assertEqual((row["openingBottlesAvailable"], row["refundableBottlesAvailable"]), (24, 24))
        self.exchange_order()
        row = get_customer_bottle_balances(self.customer)[0]["productBalances"][0]
        self.assertEqual((row["openingBottlesAvailable"], row["refundableBottlesAvailable"]), (0, 24))
        self.assertEqual(row["refundableDepositAvailable"], 90)

    def test_collection_preserves_uncollected_product_sharing_the_same_container(self):
        first = self.approve(cases=1, bottles=0)
        other_product = self.glass_product("OPENING-SECOND", "Second Glass")
        second = self.approve(productId=other_product.id, requestId="second", cases=1, bottles=0)
        order = self.exchange_order()
        OrderItem.objects.create(order=order, product=other_product, quantity=1, unit_price=240, total_price=240,
            container_type_id=self.container.id, empty_returned_quantity=24, deposit_refunded=90)
        # Ambiguous legacy totals must not consume the wrong brand's starting stock.
        with self.assertRaisesMessage(ValueError, "separately for each product"):
            record_collected_empties(order=order, drop_point=None, submitted_lines=[{"containerTypeId": self.container.id, "returnedQuantity": 24}])
        record_collected_empties(order=order, drop_point=None, submitted_lines=[
            {"declarationId": f"{self.container.id}:{self.product.id}", "containerTypeId": self.container.id, "returnedQuantity": 0},
            {"declarationId": f"{self.container.id}:{other_product.id}", "containerTypeId": self.container.id, "returnedQuantity": 24},
        ])
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual((first.remaining_bottles, second.remaining_bottles), (24, 0))
        self.assertEqual(CustomerBottleBalance.objects.get(customer=self.customer).bottles_outstanding, 24)
        self.assertFalse(DepositTransaction.objects.filter(customer=self.customer, type="REFUND").exists())
