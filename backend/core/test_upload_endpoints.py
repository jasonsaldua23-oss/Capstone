"""Authorization contracts for the media upload endpoints."""

import json

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings

from .test_upload_storage import PNG_BYTES
from .auth import create_token
from .models import (
    Customer,
    User,
)
from .test_support import Role, Driver


@override_settings(SUPABASE_URL="", SUPABASE_SERVICE_ROLE_KEY="")
class UploadEndpointsAuthContractTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.driver_role = Role.objects.create(name="DRIVER", description="Driver")
        self.admin_role = Role.objects.create(name="ADMIN", description="Admin")

        self.driver_user = User.objects.create(
            email="upload.driver@example.com",
            password="hashed",
            name="Upload Driver",
            role=self.driver_role,
            is_active=True,
        )
        self.admin_user = User.objects.create(
            email="upload.admin@example.com",
            password="hashed",
            name="Upload Admin",
            role=self.admin_role,
            is_active=True,
        )
        self.customer = Customer.objects.create(
            email="upload.customer@example.com",
            password="hashed",
            name="Upload Customer",
            is_active=True,
        )

        self.driver_token = create_token(
            {
                "userId": self.driver_user.id,
                "email": self.driver_user.email,
                "name": self.driver_user.name,
                "role": "DRIVER",
                "type": "staff",
            }
        )
        self.admin_token = create_token(
            {
                "userId": self.admin_user.id,
                "email": self.admin_user.email,
                "name": self.admin_user.name,
                "role": "ADMIN",
                "type": "staff",
            }
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

    def test_upload_product_image_requires_staff_auth(self) -> None:
        response = self.client.post("/api/uploads/product-image")
        self.assertEqual(response.status_code, 401)
        payload = response.json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Unauthorized")

    def test_upload_pod_image_requires_driver_role(self) -> None:
        pod_as_admin = self.client.post(
            "/api/uploads/pod-image",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_token}",
        )
        self.assertEqual(pod_as_admin.status_code, 403)
        self.assertEqual(pod_as_admin.json()["error"], "Forbidden")

    def test_upload_customer_avatar_requires_authenticated_user(self) -> None:
        response = self.client.post("/api/uploads/customer-avatar")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"], "Unauthorized")

    def test_upload_endpoints_validate_missing_and_non_image_files(self) -> None:
        missing_file = self.client.post(
            "/api/uploads/pod-image",
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(missing_file.status_code, 400)
        self.assertEqual(missing_file.json()["error"], "Image file is required")

        text_file = SimpleUploadedFile("notes.txt", b"not-an-image", content_type="text/plain")
        non_image = self.client.post(
            "/api/uploads/pod-image",
            data={"file": text_file},
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )
        self.assertEqual(non_image.status_code, 400)
        self.assertEqual(non_image.json()["error"], "Only image files are allowed")

    def test_upload_customer_avatar_accepts_authenticated_customer_with_image(self) -> None:
        image_file = SimpleUploadedFile("avatar.png", PNG_BYTES, content_type="image/png")
        response = self.client.post(
            "/api/uploads/customer-avatar",
            data={"file": image_file},
            HTTP_AUTHORIZATION=f"Bearer {self.customer_token}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertIn("/api/media/customers/customer-", payload["imageUrl"])

    def test_upload_customer_avatar_accepts_authenticated_driver_with_image(self) -> None:
        image_file = SimpleUploadedFile("driver-avatar.png", PNG_BYTES, content_type="image/png")
        response = self.client.post(
            "/api/uploads/customer-avatar",
            data={"file": image_file},
            HTTP_AUTHORIZATION=f"Bearer {self.driver_token}",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["success"])
