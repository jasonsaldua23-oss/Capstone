import tempfile
from pathlib import Path
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings

from .auth import create_token, hash_password
from .models import Customer, Order
from .test_upload_storage import PNG_BYTES


class PrivateMediaAccessTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.owner = Customer.objects.create(
            email="private.owner@example.com",
            password=hash_password("Password1!"),
            name="Private Owner",
        )
        self.other_customer = Customer.objects.create(
            email="private.other@example.com",
            password=hash_password("Password1!"),
            name="Other Customer",
        )
        self.owner_token = create_token({"type": "customer", "userId": self.owner.id, "role": "CUSTOMER"})
        self.other_token = create_token({"type": "customer", "userId": self.other_customer.id, "role": "CUSTOMER"})

    def auth(self, token: str) -> dict[str, str]:
        return {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    def test_order_pod_requires_its_customer_and_legacy_upload_path_is_protected(self) -> None:
        private_path = "pods/private-pod.png"
        private_url = f"/api/media/{private_path}"
        Order.objects.create(
            order_number="ORD-PRIVATE-POD-001",
            customer=self.owner,
            subtotal=100,
            total_amount=100,
            pod_photo_url=private_url,
        )

        with tempfile.TemporaryDirectory() as media_root, override_settings(MEDIA_ROOT=Path(media_root)):
            target = Path(media_root) / "uploads" / private_path
            target.parent.mkdir(parents=True)
            target.write_bytes(PNG_BYTES)

            self.assertEqual(self.client.get(private_url).status_code, 401)
            self.assertEqual(self.client.get(private_url, **self.auth(self.other_token)).status_code, 403)

            owner_response = self.client.get(private_url, **self.auth(self.owner_token))
            self.assertEqual(owner_response.status_code, 200)
            self.assertEqual(b"".join(owner_response.streaming_content), PNG_BYTES)
            self.assertEqual(owner_response["Cache-Control"], "private, no-store")
            self.assertEqual(owner_response["X-Content-Type-Options"], "nosniff")

            # Existing /uploads links must receive the same access check during migration.
            legacy_url = f"/uploads/{private_path}"
            self.assertEqual(self.client.get(legacy_url).status_code, 401)
            self.assertEqual(self.client.get(legacy_url, **self.auth(self.other_token)).status_code, 403)

    def test_new_non_catalog_uploads_return_api_only_urls(self) -> None:
        with tempfile.TemporaryDirectory() as media_root, override_settings(MEDIA_ROOT=Path(media_root)):
            response = self.client.post(
                "/api/uploads/customer-avatar",
                data={"file": SimpleUploadedFile("avatar.png", PNG_BYTES, content_type="image/png")},
                **self.auth(self.owner_token),
            )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["imageUrl"].startswith("/api/media/customers/"))

    def test_catalog_images_remain_public_and_cacheable(self) -> None:
        with tempfile.TemporaryDirectory() as media_root, override_settings(MEDIA_ROOT=Path(media_root)):
            target = Path(media_root) / "uploads" / "products" / "catalog.png"
            target.parent.mkdir(parents=True)
            target.write_bytes(PNG_BYTES)
            # config.urls imports MEDIA_ROOT by value, so make the public static
            # route use this disposable directory as well.
            with patch("config.urls.MEDIA_ROOT", Path(media_root)):
                response = self.client.get("/uploads/products/catalog.png")
                response.close()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], "public, max-age=31536000, immutable")
