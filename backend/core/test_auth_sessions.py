"""Session tokens, tab-scoped auth, portal cookies, password policy, and API error responses."""

import json
from unittest.mock import patch

from django.test import Client, TestCase, SimpleTestCase, RequestFactory
from django.http import HttpResponse
from django.db import OperationalError

from .auth import (
    create_token,
    decode_token,
)
from .auth_response_middleware import ApiErrorResponseMiddleware
from .models import (
    Customer,
    User,
)
from .test_support import Role, Driver



class SessionTokenContractTests(TestCase):
    def test_customer_session_token_excludes_large_profile_data(self) -> None:
        customer = Customer.objects.create(
            email="compact-session@example.com",
            password="hashed",
            name="Compact Session",
            is_active=True,
        )
        token = create_token(
            {
                "userId": customer.id,
                "email": customer.email,
                "name": customer.name,
                "role": "CUSTOMER",
                "type": "customer",
                "rememberMe": True,
                # Regression: the full profile's balance list made Set-Cookie
                # exceed Nginx's upstream response-header buffer during Google login.
                "bottleBalances": [{"productId": f"product-{index}", "balance": index} for index in range(200)],
            },
            exp_hours=24 * 30,
        )

        claims = decode_token(token)
        self.assertIsNotNone(claims)
        self.assertNotIn("bottleBalances", claims)
        self.assertLess(len(token), 1024)


class StaffPhoneValidationContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin = User.objects.create(
            email="phone.admin@example.com",
            password="hashed",
            name="Phone Admin",
            phone="09171234567",
            role="ADMIN",
            is_active=True,
        )
        self.staff = User.objects.create(
            email="phone.staff@example.com",
            password="hashed",
            name="Phone Staff",
            phone="639181234567",
            role="WAREHOUSE_STAFF",
            is_active=True,
        )
        self.admin_token = create_token(
            {
                "userId": self.admin.id,
                "email": self.admin.email,
                "name": self.admin.name,
                "role": "ADMIN",
                "type": "staff",
            }
        )
        self.staff_token = create_token(
            {
                "userId": self.staff.id,
                "email": self.staff.email,
                "name": self.staff.name,
                "role": "WAREHOUSE_STAFF",
                "type": "staff",
            }
        )

    def test_auth_me_returns_saved_phone_for_admin_and_warehouse_staff(self) -> None:
        admin_response = self.client.get(
            "/api/auth/me",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        staff_response = self.client.get(
            "/api/auth/me",
            HTTP_AUTHORIZATION=f"Bearer {self.staff_token}",
        )

        self.assertEqual(admin_response.status_code, 200)
        self.assertEqual(admin_response.json()["user"]["phone"], self.admin.phone)
        self.assertEqual(staff_response.status_code, 200)
        self.assertEqual(staff_response.json()["user"]["phone"], self.staff.phone)

    def test_staff_phone_update_persists_valid_philippine_mobile(self) -> None:
        response = self.client.put(
            f"/api/users/{self.staff.id}",
            data={"phone": "639171234567"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 200)
        self.staff.refresh_from_db()
        self.assertEqual(self.staff.phone, "639171234567")
        self.assertEqual(response.json()["user"]["phone"], "639171234567")

    def test_staff_phone_update_rejects_non_numeric_or_invalid_mobile(self) -> None:
        response = self.client.put(
            f"/api/users/{self.staff.id}",
            data={"phone": "09AB1234567"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "Please enter a valid Philippine mobile number")


class PasswordPolicyContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.admin_user = User.objects.create(
            email="password.policy.admin@gmail.com",
            password="hashed",
            name="Password Policy Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.admin_token = create_token(
            {
                "userId": self.admin_user.id,
                "email": self.admin_user.email,
                "name": self.admin_user.name,
                "role": self.admin_role.name,
                "type": "staff",
            }
        )
        self.customer = Customer.objects.create(
            email="password.policy.customer@gmail.com",
            password="hashed",
            name="Password Policy Customer",
            is_active=True,
        )
        self.customer_token = create_token(
            {
                "userId": self.customer.id,
                "email": self.customer.email,
                "name": self.customer.name,
                "role": "CUSTOMER",
                "type": "customer",
            }
        )

    def test_auth_register_rejects_weak_password(self) -> None:
        response = self.client.post(
            "/api/auth/register",
            data={
                "name": "Weak Password Customer",
                "email": "weak.register@gmail.com",
                "password": "weakpass",
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertIn("Password must be at least 8 characters", payload["error"])

    def test_users_collection_rejects_weak_password(self) -> None:
        response = self.client.post(
            "/api/users",
            data={
                "name": "Weak Staff",
                "email": "weak.staff@gmail.com",
                "password": "weakpass",
                "roleId": self.driver_role.id,
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertIn("Password must be at least 8 characters", payload["error"])

    def test_customer_update_rejects_weak_password(self) -> None:
        response = self.client.put(
            f"/api/customers/{self.customer.id}",
            data={"password": "weakpass"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertIn("Password must be at least 8 characters", payload["error"])

    def test_password_reset_rejects_weak_password_before_otp_validation(self) -> None:
        response = self.client.post(
            "/api/auth/password-reset/reset",
            data={
                "email": "password.policy.admin@gmail.com",
                "accountType": "staff",
                "portal": "admin",
                "otp": "123456",
                "newPassword": "weakpass",
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertIn("Password must be at least 8 characters", payload["error"])


class ApiErrorResponseTests(SimpleTestCase):
    @patch('core.auth_response_middleware.logging.getLogger')
    def test_api_exceptions_have_safe_json_and_matching_log_reference(self, logger):
        middleware = ApiErrorResponseMiddleware(lambda request: HttpResponse())
        for exception, expected_status in [(RuntimeError('private internals'), 500), (OperationalError('private database address'), 503)]:
            with self.subTest(status=expected_status):
                response = middleware.process_exception(RequestFactory().patch('/api/orders'), exception)
                payload = json.loads(response.content)
                self.assertEqual(response.status_code, expected_status)
                self.assertFalse(payload['success'])
                self.assertNotIn('private', payload['error'])
                self.assertEqual(response['X-Request-ID'], payload['requestId'])
                self.assertEqual(response['Cache-Control'], 'no-store')
                self.assertEqual(logger.return_value.error.call_args.args[1], payload['requestId'])

    def test_non_api_exceptions_keep_existing_handling(self):
        middleware = ApiErrorResponseMiddleware(lambda request: HttpResponse())
        self.assertIsNone(middleware.process_exception(RequestFactory().get('/admin'), RuntimeError('test')))


class AuthMeTabSessionTests(TestCase):
    def setUp(self):
        # Live session validation needs real disposable accounts.
        User.objects.create(id='admin-test', email='admin-test@audit.invalid', name='Admin', role='ADMIN')
        Customer.objects.create(id='customer-test', email='customer-test@audit.invalid', name='Customer')

    def test_staff_restore_returns_existing_verified_token_without_cache(self):
        from .views_api import auth_me
        token = create_token({'userId': 'admin-test', 'type': 'staff', 'role': 'ADMIN'})
        request = RequestFactory().get('/api/auth/me', HTTP_AUTHORIZATION=f'Bearer {token}')
        response = auth_me(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['token'], token)
        self.assertIn('no-store', response['Cache-Control'])

    def test_unauthenticated_restore_never_returns_a_token(self):
        from .views_api import auth_me
        response = auth_me(RequestFactory().get('/api/auth/me'))
        self.assertEqual(response.status_code, 401)
        self.assertNotIn('token', json.loads(response.content))
        self.assertIn('no-store', response['Cache-Control'])

    def test_customer_restore_returns_existing_verified_token_without_cache(self):
        # Customer tabs must also retain their verified session independently of shared cookies.
        from .views_api import auth_me
        token = create_token({'userId': 'customer-test', 'type': 'customer'})
        request = RequestFactory().get('/api/auth/me', HTTP_AUTHORIZATION=f'Bearer {token}')
        response = auth_me(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['token'], token)
        self.assertIn('no-store', response['Cache-Control'])


class ConcurrentPortalCookieTests(TestCase):
    def setUp(self):
        # Each cookie represents a real account with independently revocable sessions.
        for name, role in [('admin', 'ADMIN'), ('warehouse', 'WAREHOUSE_STAFF'), ('driver', 'DRIVER')]:
            User.objects.create(id=name, email=f'{name}@audit.invalid', name=name, role=role)
        Customer.objects.create(id='customer', email='customer@audit.invalid', name='Customer')

    def test_four_cookie_sessions_restore_and_logout_independently(self):
        from .auth import PORTAL_TOKEN_NAMES, extract_token
        from .views_api import _set_auth_cookie, auth_logout
        from django.http import JsonResponse
        roles = {'admin': 'ADMIN', 'warehouse': 'WAREHOUSE_STAFF', 'driver': 'DRIVER', 'customer': 'CUSTOMER'}
        cookies, tokens = {}, {}
        for portal, role in roles.items():
            tokens[portal] = create_token({'userId': portal, 'type': 'customer' if portal == 'customer' else 'staff', 'role': role})
            response = JsonResponse({})
            _set_auth_cookie(response, tokens[portal])
            cookies.update({name: cookie.value for name, cookie in response.cookies.items() if cookie.value})
        # All logins have finished; refreshing any portal still resolves its own signed account.
        for portal in roles:
            request = RequestFactory().get('/api/auth/me', HTTP_X_PORTAL=portal)
            request.COOKIES = cookies.copy()
            self.assertEqual(extract_token(request), tokens[portal])
            logout_request = RequestFactory().post('/api/auth/logout', HTTP_X_PORTAL=portal)
            logout_request.COOKIES = cookies.copy()
            logout = auth_logout(logout_request)
            self.assertEqual(logout.cookies[PORTAL_TOKEN_NAMES[portal]]['max-age'], 0)
            for other in roles.keys() - {portal}:
                self.assertNotIn(PORTAL_TOKEN_NAMES[other], logout.cookies)

    def test_warehouse_legacy_cookie_cannot_restore_or_authorize_admin(self):
        from .auth import STAFF_TOKEN_NAME, extract_token
        from .views_api import _require_staff
        request = RequestFactory().get('/api/auth/me', HTTP_X_PORTAL='admin')
        request.COOKIES[STAFF_TOKEN_NAME] = create_token({'userId': 'warehouse', 'type': 'staff', 'role': 'WAREHOUSE_STAFF'})
        self.assertIsNone(extract_token(request))
        staff, error = _require_staff(request)
        self.assertIsNone(staff)
        self.assertEqual(error.status_code, 401)
