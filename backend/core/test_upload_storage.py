"""Uploads must land in the object storage bucket, not on the API server's disk.

A file written under backend/media/uploads is lost the next time the service is
redeployed, which is what made product photos disappear from the inventory.
"""
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory, TestCase, override_settings

from . import object_storage
from .views_api import upload_product_image

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"0" * 32
BUCKET_SETTINGS = dict(
    SUPABASE_URL="https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY="service-role-key",
    SUPABASE_UPLOADS_BUCKET="uploads",
)


class ObjectStorageConfigTests(TestCase):
    @override_settings(**BUCKET_SETTINGS)
    def test_configured_when_url_and_key_are_present(self):
        self.assertTrue(object_storage.is_configured())

    @override_settings(SUPABASE_URL="", SUPABASE_SERVICE_ROLE_KEY="")
    def test_not_configured_without_credentials(self):
        self.assertFalse(object_storage.is_configured())

    @override_settings(**BUCKET_SETTINGS)
    def test_public_url_points_at_the_bucket(self):
        self.assertEqual(
            object_storage.public_url("products/product-1.png"),
            "https://project.supabase.co/storage/v1/object/public/uploads/products/product-1.png",
        )


class ProductImageUploadTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.staff_auth = {"type": "staff", "role": "ADMIN", "userId": "admin-1", "name": "Admin"}

    def _upload(self, filename="bottle.png", content_type="image/png"):
        upload = SimpleUploadedFile(filename, PNG_BYTES, content_type=content_type)
        request = self.factory.post("/", data={"file": upload})
        with patch("core.views_api._require_staff", return_value=(self.staff_auth, None)):
            return upload_product_image(request)

    @override_settings(**BUCKET_SETTINGS)
    def test_the_stored_url_is_the_bucket_url(self):
        with patch("core.object_storage.requests.post") as post:
            post.return_value.ok = True
            response = self._upload()
        self.assertEqual(response.status_code, 200)
        image_url = json.loads(response.content)["imageUrl"]
        self.assertTrue(
            image_url.startswith("https://project.supabase.co/storage/v1/object/public/uploads/products/"),
            image_url,
        )
        self.assertTrue(image_url.endswith(".png"), image_url)

    @override_settings(**BUCKET_SETTINGS)
    def test_the_file_bytes_are_sent_to_the_bucket(self):
        with patch("core.object_storage.requests.post") as post:
            post.return_value.ok = True
            self._upload()
        self.assertEqual(post.call_args.kwargs["data"], PNG_BYTES)
        self.assertIn("/storage/v1/object/uploads/products/", post.call_args.args[0])
        self.assertEqual(post.call_args.kwargs["headers"]["Content-Type"], "image/png")

    @override_settings(
        SUPABASE_URL="https://project.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY="sb_secret_server-key",
        SUPABASE_UPLOADS_BUCKET="uploads",
    )
    def test_new_secret_key_is_not_sent_as_a_bearer_jwt(self):
        with patch("core.object_storage.requests.post") as post:
            post.return_value.ok = True
            self._upload()
        headers = post.call_args.kwargs["headers"]
        self.assertEqual(headers["apikey"], "sb_secret_server-key")
        self.assertNotIn("Authorization", headers)

    def test_new_secret_key_falls_back_to_persistent_disk_when_storage_requires_a_jwt(self):
        with tempfile.TemporaryDirectory() as tmp:
            settings = {
                "SUPABASE_URL": "https://project.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_server-key",
                "SUPABASE_UPLOADS_BUCKET": "uploads",
                "MEDIA_ROOT": tmp,
            }
            with override_settings(**settings), patch("core.object_storage.requests.post") as post:
                post.return_value.ok = False
                post.return_value.status_code = 400
                post.return_value.text = "headers must have required property 'authorization'"
                response = self._upload()
                image_url = json.loads(response.content)["imageUrl"]
                stored_file = Path(tmp) / image_url.lstrip("/")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(stored_file.read_bytes(), PNG_BYTES)

    @override_settings(**BUCKET_SETTINGS)
    def test_legacy_service_role_key_remains_a_bearer_token(self):
        with patch("core.object_storage.requests.post") as post:
            post.return_value.ok = True
            self._upload()
        headers = post.call_args.kwargs["headers"]
        self.assertEqual(headers["Authorization"], "Bearer service-role-key")

    @override_settings(**BUCKET_SETTINGS)
    def test_a_rejected_upload_is_reported_rather_than_silently_lost(self):
        with patch("core.object_storage.requests.post") as post:
            post.return_value.ok = False
            post.return_value.status_code = 403
            post.return_value.text = "denied"
            response = self._upload()
        self.assertEqual(response.status_code, 502)
        self.assertIn("Could not store the image", json.loads(response.content)["error"])

    def test_without_credentials_it_falls_back_to_local_disk_for_development(self):
        # Into a temporary root, so the test does not leave files in the repo.
        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(SUPABASE_URL="", SUPABASE_SERVICE_ROLE_KEY="", MEDIA_ROOT=tmp):
                response = self._upload()
        self.assertEqual(response.status_code, 200)
        image_url = json.loads(response.content)["imageUrl"]
        self.assertTrue(image_url.startswith("/uploads/products/"), image_url)

    @override_settings(**BUCKET_SETTINGS)
    def test_non_image_uploads_are_still_rejected(self):
        response = self._upload(filename="notes.txt", content_type="text/plain")
        self.assertEqual(response.status_code, 400)
