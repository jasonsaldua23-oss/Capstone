"""Regression checks for pre-launch session and checkout isolation fixes."""

from unittest.mock import patch

from django.test import Client, TestCase
from django.utils import timezone

from .auth import create_token
from .models import Customer, Inventory, Order, Product, StockBatch, Warehouse
from .views_api import _is_email_verification_token_valid, _issue_email_verification_token


class PrelaunchAccessGuardTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(name="Audit Customer", email="first@audit.invalid")
        self.other = Customer.objects.create(name="Other Customer", email="second@audit.invalid")
        self.client = self.session("customer", self.customer.id)

    def session(self, token_type, user_id):
        token = create_token({"type": token_type, "userId": user_id})
        return Client(HTTP_AUTHORIZATION=f"Bearer {token}")

    def test_non_session_tokens_cannot_read_shared_data(self):
        # Proofs remain usable only by the explicit verification handlers.
        for token_type in ("email_verification", "login_2fa", "unknown"):
            client = self.session(token_type, self.customer.id)
            for route in ("/api/customers", "/api/orders", "/api/auth/me"):
                with self.subTest(token_type=token_type, route=route):
                    self.assertEqual(client.get(route).status_code, 401)

    def test_email_proof_still_validates_for_its_original_purpose(self):
        token = _issue_email_verification_token(self.customer.email, "customer")
        self.assertTrue(_is_email_verification_token_valid(token, self.customer.email, "customer"))

    def test_customer_directory_is_scoped_to_self(self):
        response = self.client.get("/api/customers")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["id"] for row in response.json()["customers"]], [self.customer.id])
        self.assertEqual(response.json()["total"], 1)

    def test_shared_checkout_rejects_other_customer_without_creating_order(self):
        response = self.client.post("/api/orders", {"customerId": self.other.id}, content_type="application/json")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Order.objects.exists())

    @patch("core.views_api._email_new_order_to_warehouse_staff")
    @patch("core.views_api._email_purchase_request_submitted_to_customer")
    def test_own_checkout_starts_pending_even_when_delivered_is_requested(self, *_mocks):
        # Exercise real creation and inventory using disposable data, with outbound email isolated.
        warehouse = Warehouse.objects.create(name="Audit Warehouse", code="AUDIT", address="Audit", city="Talisay", province="Negros Occidental", zip_code="6115")
        product = Product.objects.create(name="Audit Water", sku="AUDIT-WATER", unit="case", price=120, is_active=True)
        inventory = Inventory.objects.create(warehouse=warehouse, product=product, quantity=100, reserved_quantity=0, threshold=2)
        StockBatch.objects.create(batch_number="AUDIT-BATCH", inventory=inventory, quantity=100, receipt_date=timezone.now(), status="ACTIVE")
        response = self.client.post("/api/orders", {
            "customerId": self.customer.id, "warehouseId": warehouse.id,
            "shippingLatitude": 10.67, "shippingLongitude": 122.95,
            "shippingCity": "Talisay", "shippingProvince": "Negros Occidental",
            "items": [{"productId": product.id, "quantity": 2}], "status": "DELIVERED",
            # Older clients cannot add fees to a newly created order.
            "tax": 75, "shippingCost": 120,
        }, content_type="application/json")
        self.assertEqual(response.status_code, 201, response.content)
        order = Order.objects.get()
        self.assertEqual(order.customer_id, self.customer.id)
        self.assertEqual(order.status, "PENDING")
        self.assertEqual(order.request_status, "PENDING_APPROVAL")
        self.assertEqual(order.tax, 0)
        self.assertEqual(order.shipping_cost, 0)
        self.assertEqual(order.total_amount, 240)

    def test_order_totals_ignore_removed_fee_fields(self):
        from .views_api import _compute_order_totals
        for value in (75, -1000, "not-a-fee"):
            with self.subTest(value=value):
                self.assertEqual(
                    _compute_order_totals({"tax": value, "shippingCost": value, "discount": 20}, 240),
                    (0, 0, 20, 220),
                )


class PrelaunchRemainingSecurityTests(TestCase):
    def setUp(self):
        from .models import User
        self.owner = User.objects.create(name="Owner", email="owner@audit.invalid", role="SUPER_ADMIN")
        self.admin = User.objects.create(name="Admin", email="admin@audit.invalid", role="ADMIN")
        self.driver = User.objects.create(name="Driver", email="driver@audit.invalid", role="DRIVER")
        self.customer = Customer.objects.create(name="Customer", email="customer@audit.invalid")

    def client_for(self, account, kind="staff"):
        token = create_token({"type": kind, "userId": account.id, "role": getattr(account, "role", "CUSTOMER")})
        return Client(HTTP_AUTHORIZATION=f"Bearer {token}"), token

    def test_driver_cannot_promote_disable_create_or_delete_accounts(self):
        from .models import User
        client, _ = self.client_for(self.driver)
        for target, body in [(self.driver, {"roleId": "SUPER_ADMIN"}), (self.admin, {"isActive": False})]:
            self.assertEqual(client.put(f"/api/users/{target.id}", body, content_type="application/json").status_code, 403)
        self.assertEqual(client.delete(f"/api/users/{self.admin.id}").status_code, 403)
        self.assertEqual(client.post("/api/users", {}, content_type="application/json").status_code, 403)
        self.driver.refresh_from_db()
        self.admin.refresh_from_db()
        self.assertEqual(self.driver.role, "DRIVER")
        self.assertTrue(self.admin.is_active)
        self.assertEqual(User.objects.count(), 3)

    def test_admin_cannot_modify_owner_but_can_edit_own_profile(self):
        client, _ = self.client_for(self.admin)
        self.assertEqual(client.put(f"/api/users/{self.owner.id}", {"isActive": False}, content_type="application/json").status_code, 403)
        self.assertEqual(client.put(f"/api/users/{self.admin.id}", {"roleId": "SUPER_ADMIN"}, content_type="application/json").status_code, 403)
        self.assertEqual(client.put(f"/api/users/{self.admin.id}", {"name": "Updated Admin"}, content_type="application/json").status_code, 200)

    def test_driver_cannot_change_customer_password(self):
        client, _ = self.client_for(self.driver)
        before = self.customer.password
        self.assertEqual(client.put(f"/api/customers/{self.customer.id}", {"password": "ChangedAudit!482Aa"}, content_type="application/json").status_code, 403)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.password, before)

    def test_logout_revokes_only_the_selected_session(self):
        first, _ = self.client_for(self.admin)
        second, _ = self.client_for(self.admin)
        self.assertEqual(first.post("/api/auth/logout").status_code, 200)
        self.assertEqual(first.get("/api/auth/me").status_code, 401)
        self.assertEqual(second.get("/api/auth/me").status_code, 200)

    def test_inactive_demoted_and_password_changed_sessions_fail(self):
        for field, value in [("is_active", False), ("role", "DRIVER"), ("password", "changed")]:
            client, _ = self.client_for(self.admin)
            previous = getattr(self.admin, field)
            setattr(self.admin, field, value)
            self.admin.save()
            self.assertEqual(client.get("/api/users").status_code, 401)
            setattr(self.admin, field, previous)
            self.admin.save()

    def test_reset_consumes_otp_and_revokes_old_session(self):
        from .views_api import _stateless_otp_for_bucket, _otp_bucket
        client, _ = self.client_for(self.customer, "customer")
        code = _stateless_otp_for_bucket(self.customer.email, "customer", "password_reset", _otp_bucket(timezone.now()))
        body = {"email": self.customer.email, "accountType": "customer", "portal": "customer", "otp": code, "newPassword": "ResetAudit!482Aa"}
        anonymous = Client()
        self.assertEqual(anonymous.post("/api/auth/password-reset/reset", body, content_type="application/json").status_code, 200)
        body["newPassword"] = "ResetAgainAudit!482Aa"
        self.assertEqual(anonymous.post("/api/auth/password-reset/reset", body, content_type="application/json").status_code, 400)
        self.assertEqual(client.get("/api/auth/me").status_code, 401)

    def test_cookie_write_requires_trusted_origin(self):
        from .auth import STAFF_TOKEN_NAME
        _, token = self.client_for(self.admin)
        client = Client(enforce_csrf_checks=True)
        client.cookies[STAFF_TOKEN_NAME] = token
        for origin in ("https://untrusted.invalid", None):
            headers = {"HTTP_ORIGIN": origin} if origin else {}
            self.assertEqual(client.put(f"/api/users/{self.admin.id}", {"name": "Changed"}, content_type="application/json", **headers).status_code, 403)
        self.assertEqual(client.put(f"/api/users/{self.admin.id}", {"name": "Changed"}, content_type="application/json", HTTP_ORIGIN="http://testserver").status_code, 200)

    def test_json_shapes_and_feedback_ranges_are_rejected(self):
        for body in ("[]", "null", "42", '\"text\"', "{"):
            self.assertEqual(Client().post("/api/auth/login", body, content_type="application/json").status_code, 400)
        client, _ = self.client_for(self.customer, "customer")
        for body in ({}, {"rating": -1, "message": "Review"}, {"rating": 999, "message": "Review"}, {"rating": True, "message": "Review"}):
            self.assertEqual(client.post("/api/feedback", body, content_type="application/json").status_code, 400)
        self.assertEqual(client.post("/api/feedback", {"rating": 5, "message": "Good delivery"}, content_type="application/json").status_code, 201)

    def test_invalid_images_rejected_and_upload_names_do_not_collide(self):
        import tempfile
        from pathlib import Path
        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings
        from .views_api import _store_upload_bytes
        client, _ = self.client_for(self.customer, "customer")
        with tempfile.TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=directory, SUPABASE_URL="", SUPABASE_SERVICE_ROLE_KEY=""):
            for data in (b"<html>inert</html>", b"x" * (6 * 1024 * 1024)):
                upload = SimpleUploadedFile("audit.html", data, content_type="image/png")
                self.assertEqual(client.post("/api/uploads/customer-avatar", {"file": upload}).status_code, 400)
            with patch("core.views_api.timezone.now", return_value=timezone.now()):
                first = _store_upload_bytes(b"first", "pods", "pod", ".png", "image/png")
                second = _store_upload_bytes(b"second", "pods", "pod", ".png", "image/png")
            self.assertNotEqual(first, second)
            # Private media returns an authorized API URL while retaining its file under uploads.
            self.assertTrue(first.startswith("/api/media/pods/"))
            self.assertEqual((Path(directory) / "uploads" / first.removeprefix("/api/media/")).read_bytes(), b"first")

    def test_database_rejects_case_insensitive_staff_duplicate(self):
        from django.db import IntegrityError, transaction
        from .models import User
        with self.assertRaises(IntegrityError), transaction.atomic():
            User.objects.create(name="Duplicate", email="ADMIN@audit.invalid", role="DRIVER")
