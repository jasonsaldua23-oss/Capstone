"""Self-registered clients wait for an administrator before they can sign in.

Covers the approval gate on every path that can hand a Customer a session
(password, unified password, Google, unified Google, the 2FA completion and the
session restore), the pending registration response, and the admin review action.
"""

import json
from unittest.mock import patch

from django.test import TestCase, override_settings

from .auth import create_token, hash_password
from .models import Customer, CustomerApprovalStatus, Notification, RoleType, User

PASSWORD = "Str0ng!Passw0rd"
PENDING_ERROR = "Your account is pending approval. You'll be notified once an administrator reviews it."
PENDING_REGISTRATION_MESSAGE = (
    "Your registration was received and is pending approval. "
    "You'll be notified by email once an administrator reviews it."
)
GOOGLE_SETTINGS = {
    "DEBUG": True,
    "GOOGLE_OAUTH_CLIENT_ID": "gmail-client.apps.googleusercontent.com",
    "GOOGLE_OAUTH_CLIENT_IDS": ["gmail-client.apps.googleusercontent.com"],
}


def _customer(email="maria.santos@gmail.com", status=CustomerApprovalStatus.PENDING_APPROVAL, **extra):
    return Customer.objects.create(
        email=email,
        password=hash_password(PASSWORD),
        name="Maria Santos",
        first_name="Maria",
        last_name="Santos",
        approval_status=status,
        **extra,
    )


def _staff_token(user):
    return create_token({"userId": user.id, "type": "staff", "role": user.role, "name": user.name, "email": user.email})


class RegistrationIsPendingTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create(email="admin.one@gmail.com", name="Admin One", role=RoleType.ADMIN)
        self.owner = User.objects.create(email="owner.one@gmail.com", name="Owner One", role=RoleType.SUPER_ADMIN)
        self.warehouse = User.objects.create(email="wh.one@gmail.com", name="Warehouse One", role=RoleType.WAREHOUSE_STAFF)

    def register(self, **overrides):
        body = {
            "firstName": "Maria",
            "middleName": "Reyes",
            "lastName": "Santos",
            "email": "maria.santos@gmail.com",
            "password": PASSWORD,
            "emailVerificationToken": "verified-by-mock",
            **overrides,
        }
        with patch("core.views_api._is_email_verification_token_valid", return_value=True):
            return self.client.post("/api/auth/register", json.dumps(body), content_type="application/json")

    def test_registration_is_received_without_a_session(self):
        response = self.register()

        self.assertEqual(response.status_code, 201, response.content)
        payload = response.json()
        self.assertEqual(
            payload, {"success": True, "pendingApproval": True, "message": PENDING_REGISTRATION_MESSAGE}
        )
        self.assertNotIn("token", payload)
        # No session cookie of any kind is issued before approval.
        self.assertEqual(list(response.cookies.keys()), [])
        customer = Customer.objects.get(email="maria.santos@gmail.com")
        self.assertEqual(customer.approval_status, CustomerApprovalStatus.PENDING_APPROVAL)
        self.assertIsNone(customer.approval_reviewed_at)

    def test_registration_notifies_administrators_only(self):
        self.register()
        customer = Customer.objects.get(email="maria.santos@gmail.com")

        rows = Notification.objects.filter(title="New client registration awaiting approval")
        self.assertEqual({row.user_id for row in rows}, {self.admin.id, self.owner.id})
        self.assertTrue(all(row.reference_type == "CUSTOMER" and row.reference_id == customer.id for row in rows))

    def test_the_new_account_cannot_restore_or_sign_in(self):
        self.register()
        response = self.client.post(
            "/api/auth/customer/login",
            json.dumps({"email": "maria.santos@gmail.com", "password": PASSWORD}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()["code"], "PENDING_APPROVAL")
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)


class SignInGateTests(TestCase):
    """One test per path that can issue a Customer session."""

    def post(self, url, body):
        return self.client.post(url, json.dumps(body), content_type="application/json")

    def assert_pending(self, response):
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json(), {"success": False, "error": PENDING_ERROR, "code": "PENDING_APPROVAL"})
        self.assertNotIn("token", response.json())
        self.assertEqual(list(response.cookies.keys()), [])

    def test_password_login_refuses_a_pending_account(self):
        _customer()
        self.assert_pending(self.post("/api/auth/customer/login", {"email": "maria.santos@gmail.com", "password": PASSWORD}))

    def test_password_login_states_the_rejection_reason(self):
        _customer(status=CustomerApprovalStatus.REJECTED, approval_notes="Address is outside our delivery area.")
        response = self.post("/api/auth/customer/login", {"email": "maria.santos@gmail.com", "password": PASSWORD})

        self.assertEqual(response.status_code, 403, response.content)
        payload = response.json()
        self.assertEqual(payload["code"], "REGISTRATION_REJECTED")
        self.assertEqual(payload["approvalNotes"], "Address is outside our delivery area.")
        self.assertIn("Address is outside our delivery area.", payload["error"])

    def test_a_wrong_password_never_reveals_the_review_status(self):
        _customer()
        response = self.post("/api/auth/customer/login", {"email": "maria.santos@gmail.com", "password": "Wr0ng!Password"})
        self.assertEqual(response.status_code, 401, response.content)
        self.assertNotIn("code", response.json())

    def test_unified_login_refuses_a_pending_account(self):
        _customer()
        self.assert_pending(self.post("/api/auth/unified/login", {"email": "maria.santos@gmail.com", "password": PASSWORD}))

    @override_settings(**GOOGLE_SETTINGS)
    def test_customer_google_refuses_an_existing_pending_account(self):
        _customer()
        claims = {"email": "maria.santos@gmail.com", "email_verified": True, "given_name": "Maria", "family_name": "Santos"}
        with patch("core.views_api._verify_google_token", return_value=claims):
            self.assert_pending(self.post("/api/auth/customer/google", {"credential": "verified-by-mock"}))

    @override_settings(**GOOGLE_SETTINGS)
    def test_customer_google_registers_a_new_account_as_pending(self):
        admin = User.objects.create(email="admin.one@gmail.com", name="Admin One", role=RoleType.ADMIN)
        claims = {"email": "new.client@gmail.com", "email_verified": True, "given_name": "New", "family_name": "Client"}
        with patch("core.views_api._verify_google_token", return_value=claims):
            response = self.post("/api/auth/customer/google", {"credential": "verified-by-mock"})

        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(
            response.json(),
            {"success": True, "pendingApproval": True, "message": PENDING_REGISTRATION_MESSAGE, "created": True},
        )
        self.assertEqual(list(response.cookies.keys()), [])
        customer = Customer.objects.get(email="new.client@gmail.com")
        self.assertEqual(customer.approval_status, CustomerApprovalStatus.PENDING_APPROVAL)
        self.assertTrue(Notification.objects.filter(user=admin, reference_id=customer.id).exists())

    @override_settings(**GOOGLE_SETTINGS)
    def test_unified_google_refuses_a_pending_account(self):
        _customer()
        claims = {"email": "maria.santos@gmail.com", "email_verified": True}
        with patch("core.views_api._verify_google_token", return_value=claims):
            self.assert_pending(self.post("/api/auth/unified/google", {"credential": "verified-by-mock"}))

    def test_two_factor_account_is_refused_before_a_code_is_sent(self):
        _customer(two_factor_enabled=True)
        with patch("core.views_api._otp_mail_ready", return_value=True), patch(
            "core.views_api._send_login_otp_email"
        ) as send_otp:
            self.assert_pending(self.post("/api/auth/customer/login", {"email": "maria.santos@gmail.com", "password": PASSWORD}))
        send_otp.assert_not_called()

    def test_two_factor_completion_refuses_a_pending_account(self):
        customer = _customer(two_factor_enabled=True)
        # A challenge minted before the account left review must not finish the sign-in.
        challenge = create_token(
            {"type": "login_2fa", "accountType": "customer", "userId": customer.id,
             "email": customer.email, "portal": "customer", "rememberMe": False},
            exp_hours=1,
        )
        self.assert_pending(self.post("/api/auth/login/verify-otp", {"challengeToken": challenge, "otp": "123456"}))

    def test_session_restore_refuses_a_pending_account(self):
        customer = _customer()
        token = create_token({"userId": customer.id, "type": "customer", "role": "CUSTOMER"})
        response = self.client.get("/api/auth/me", HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()["code"], "PENDING_APPROVAL")
        self.assertNotIn("user", response.json())

    def test_approved_and_existing_accounts_still_sign_in(self):
        _customer(status=CustomerApprovalStatus.APPROVED)
        response = self.post("/api/auth/customer/login", {"email": "maria.santos@gmail.com", "password": PASSWORD})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.client.get("/api/auth/me").status_code, 200)

    def test_accounts_created_outside_registration_default_to_approved(self):
        # Existing rows are backfilled by the same default in migration 0126.
        customer = Customer.objects.create(email="legacy.client@gmail.com", password="unused", name="Legacy Client")
        self.assertEqual(customer.approval_status, CustomerApprovalStatus.APPROVED)


@patch("core.email_notifications._email_customer_registration_rejected")
@patch("core.email_notifications._email_customer_registration_approved")
class AdminReviewTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create(email="admin.one@gmail.com", name="Admin One", role=RoleType.ADMIN)
        self.customer = _customer()

    def review(self, body, *, user=None, token=None, method="patch"):
        headers = {}
        auth_token = token or (_staff_token(user or self.admin))
        headers["HTTP_AUTHORIZATION"] = f"Bearer {auth_token}"
        send = getattr(self.client, method)
        return send(f"/api/customers/{self.customer.id}", json.dumps(body), content_type="application/json", **headers)

    def test_approval_records_the_reviewer_and_opens_sign_in(self, approved_email, rejected_email):
        response = self.review({"approvalStatus": "APPROVED"})

        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()["customer"]
        self.assertEqual(data["approvalStatus"], "APPROVED")
        self.assertEqual(data["approvalReviewedByUserId"], self.admin.id)
        self.assertEqual(data["approvalReviewedByName"], "Admin One")
        self.assertIsNotNone(data["approvalReviewedAt"])
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.approval_status, CustomerApprovalStatus.APPROVED)
        approved_email.assert_called_once()
        rejected_email.assert_not_called()
        self.assertTrue(Notification.objects.filter(customer=self.customer, title="Registration approved").exists())

        login = self.client.post(
            "/api/auth/customer/login",
            json.dumps({"email": self.customer.email, "password": PASSWORD}),
            content_type="application/json",
        )
        self.assertEqual(login.status_code, 200, login.content)

    def test_put_is_accepted_like_patch(self, approved_email, rejected_email):
        response = self.review({"approvalStatus": "APPROVED"}, method="put")
        self.assertEqual(response.status_code, 200, response.content)
        approved_email.assert_called_once()

    def test_rejection_requires_a_reason(self, approved_email, rejected_email):
        for notes in (None, "", "   "):
            body = {"approvalStatus": "REJECTED"}
            if notes is not None:
                body["approvalNotes"] = notes
            response = self.review(body)
            self.assertEqual(response.status_code, 400, response.content)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.approval_status, CustomerApprovalStatus.PENDING_APPROVAL)
        rejected_email.assert_not_called()

    def test_rejection_stores_and_sends_the_reason(self, approved_email, rejected_email):
        response = self.review({"approvalStatus": "REJECTED", "approvalNotes": "Duplicate of an existing account."})

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["customer"]["approvalNotes"], "Duplicate of an existing account.")
        rejected_email.assert_called_once()
        self.assertEqual(rejected_email.call_args.args[1], "Duplicate of an existing account.")
        notification = Notification.objects.get(customer=self.customer)
        self.assertEqual(notification.title, "Registration not approved")
        self.assertIn("Duplicate of an existing account.", notification.message)

    def test_repeating_a_decision_is_a_no_op(self, approved_email, rejected_email):
        self.assertEqual(self.review({"approvalStatus": "APPROVED"}).status_code, 200)
        first_review = Customer.objects.get(id=self.customer.id).approval_reviewed_at

        response = self.review({"approvalStatus": "APPROVED"})

        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["unchanged"])
        self.assertEqual(Customer.objects.get(id=self.customer.id).approval_reviewed_at, first_review)
        approved_email.assert_called_once()
        self.assertEqual(Notification.objects.filter(customer=self.customer).count(), 1)

    def test_a_rejected_registration_can_be_approved_later(self, approved_email, rejected_email):
        self.review({"approvalStatus": "REJECTED", "approvalNotes": "Could not verify the address."})
        response = self.review({"approvalStatus": "APPROVED"})

        self.assertEqual(response.status_code, 200, response.content)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.approval_status, CustomerApprovalStatus.APPROVED)
        # The old rejection reason does not linger on an approved account.
        self.assertIsNone(self.customer.approval_notes)

    def test_an_approved_account_cannot_be_rejected(self, approved_email, rejected_email):
        self.review({"approvalStatus": "APPROVED"})
        response = self.review({"approvalStatus": "REJECTED", "approvalNotes": "Changed my mind."})
        self.assertEqual(response.status_code, 409, response.content)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.approval_status, CustomerApprovalStatus.APPROVED)

    def test_invalid_decisions_are_rejected(self, approved_email, rejected_email):
        for value in ("PENDING_APPROVAL", "CANCELLED", "", "approve"):
            response = self.review({"approvalStatus": value})
            self.assertEqual(response.status_code, 400, (value, response.content))

    def test_only_administrators_can_review(self, approved_email, rejected_email):
        owner = User.objects.create(email="owner.one@gmail.com", name="Owner One", role=RoleType.SUPER_ADMIN)
        for role in (RoleType.WAREHOUSE_STAFF, RoleType.DRIVER):
            staff = User.objects.create(email=f"{role.lower()}.one@gmail.com", name="Staff", role=role)
            response = self.review({"approvalStatus": "APPROVED"}, user=staff)
            self.assertEqual(response.status_code, 403, (role, response.content))

        # A customer session - even for the account under review - cannot approve it.
        customer_token = create_token({"userId": self.customer.id, "type": "customer", "role": "CUSTOMER"})
        response = self.review({"approvalStatus": "APPROVED"}, token=customer_token)
        self.assertEqual(response.status_code, 403, response.content)

        unauthenticated = self.client.patch(
            f"/api/customers/{self.customer.id}", json.dumps({"approvalStatus": "APPROVED"}), content_type="application/json"
        )
        self.assertEqual(unauthenticated.status_code, 401, unauthenticated.content)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.approval_status, CustomerApprovalStatus.PENDING_APPROVAL)
        approved_email.assert_not_called()

        self.assertEqual(self.review({"approvalStatus": "APPROVED"}, user=owner).status_code, 200)

    def test_unknown_customer_is_not_found(self, approved_email, rejected_email):
        response = self.client.patch(
            "/api/customers/missing-customer",
            json.dumps({"approvalStatus": "APPROVED"}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {_staff_token(self.admin)}",
        )
        self.assertEqual(response.status_code, 404, response.content)


class PendingFilterTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create(email="admin.one@gmail.com", name="Admin One", role=RoleType.ADMIN)
        _customer(email="pending.one@gmail.com")
        _customer(email="pending.two@gmail.com")
        _customer(email="approved.one@gmail.com", status=CustomerApprovalStatus.APPROVED)
        _customer(email="rejected.one@gmail.com", status=CustomerApprovalStatus.REJECTED, approval_notes="No.")

    def list(self, query=""):
        return self.client.get(f"/api/customers{query}", HTTP_AUTHORIZATION=f"Bearer {_staff_token(self.admin)}")

    def test_filter_returns_only_pending_registrations(self):
        response = self.list("?approvalStatus=PENDING_APPROVAL")

        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertEqual({row["email"] for row in payload["customers"]}, {"pending.one@gmail.com", "pending.two@gmail.com"})
        self.assertEqual(payload["total"], 2)
        self.assertEqual(payload["pendingApprovalCount"], 2)

    def test_unfiltered_list_exposes_the_review_fields(self):
        payload = self.list().json()
        self.assertEqual(payload["total"], 4)
        self.assertEqual(payload["pendingApprovalCount"], 2)
        rejected = next(row for row in payload["customers"] if row["email"] == "rejected.one@gmail.com")
        for key in ("approvalStatus", "approvalReviewedAt", "approvalReviewedByUserId", "approvalReviewedByName", "approvalNotes"):
            self.assertIn(key, rejected)
        self.assertEqual((rejected["approvalStatus"], rejected["approvalNotes"]), ("REJECTED", "No."))
        self.assertNotIn("password", rejected)

    def test_unknown_filter_value_is_rejected(self):
        self.assertEqual(self.list("?approvalStatus=CANCELLED").status_code, 400)


class DecisionEmailTests(TestCase):
    """The decision emails render through the shared structured template."""

    def test_rejection_email_carries_the_reason(self):
        from .email_notifications import _email_customer_registration_rejected

        customer = _customer(status=CustomerApprovalStatus.REJECTED)
        with patch("core.views_api._send_structured_email") as send:
            _email_customer_registration_rejected(customer, "Address is outside our delivery area.")

        kwargs = send.call_args.kwargs
        self.assertEqual(kwargs["recipients"], ["maria.santos@gmail.com"])
        self.assertEqual(kwargs["body"].reason_text, "Address is outside our delivery area.")
        self.assertEqual(kwargs["subject"], "Your registration was not approved")

    def test_approval_email_renders(self):
        from .email_notifications import _email_customer_registration_approved
        from .email_rendering import _render_email_parts

        customer = _customer(status=CustomerApprovalStatus.APPROVED)
        with patch("core.views_api._send_structured_email") as send:
            _email_customer_registration_approved(customer)

        kwargs = send.call_args.kwargs
        text, html = _render_email_parts(kwargs["body"], heading=kwargs["heading"], preheader=kwargs["preheader"])
        self.assertIn("approved your client registration", text)
        self.assertIn("Maria Santos", html)
