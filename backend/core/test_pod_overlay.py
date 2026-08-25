from datetime import datetime, timezone
from io import BytesIO

from django.test import SimpleTestCase
from PIL import Image

from .pod_overlay import PodOverlayMetadata, burn_pod_overlay, parse_pod_overlay_metadata


class PodOverlayTests(SimpleTestCase):
    def test_parses_valid_capture_metadata(self) -> None:
        result = parse_pod_overlay_metadata({
            "capturedAt": "2026-08-26T12:34:56+08:00",
            "latitude": "10.743872",
            "longitude": "122.966716",
            "address": "Gamboa Warehouse, Talisay",
        })
        self.assertIsNotNone(result)
        self.assertEqual(result.latitude, 10.743872)

    def test_rejects_out_of_range_coordinates(self) -> None:
        with self.assertRaisesRegex(ValueError, "GPS coordinates"):
            parse_pod_overlay_metadata({
                "capturedAt": "2026-08-26T12:34:56+08:00",
                "latitude": "91",
                "longitude": "122",
            })

    def test_burns_overlay_into_readable_jpeg(self) -> None:
        source = BytesIO()
        Image.new("RGB", (900, 1200), "#416b4f").save(source, format="JPEG")
        metadata = PodOverlayMetadata(
            datetime(2026, 8, 26, 12, 34, 56, tzinfo=timezone.utc),
            10.743872,
            122.966716,
            "Gamboa Warehouse, Talisay City",
        )
        stamped, extension = burn_pod_overlay(source.getvalue(), metadata, "Jason Middle Saldua")
        result = Image.open(BytesIO(stamped))
        self.assertEqual(extension, ".jpg")
        self.assertEqual(result.size, (900, 1200))
        self.assertNotEqual(result.getpixel((20, 1100)), (65, 107, 79))
