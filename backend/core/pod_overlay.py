"""Proof-of-delivery image overlay validation and rendering."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from pathlib import Path
import textwrap

from PIL import Image, ImageDraw, ImageFont, ImageOps, UnidentifiedImageError
from django.utils import timezone


@dataclass(frozen=True)
class PodOverlayMetadata:
    captured_at: datetime
    latitude: float
    longitude: float
    address: str


def parse_pod_overlay_metadata(values) -> PodOverlayMetadata | None:
    """Return validated capture metadata, or None for legacy uploads without it."""
    raw_time = str(values.get("capturedAt") or "").strip()
    raw_latitude = str(values.get("latitude") or "").strip()
    raw_longitude = str(values.get("longitude") or "").strip()
    if not raw_time and not raw_latitude and not raw_longitude:
        return None
    try:
        captured_at = datetime.fromisoformat(raw_time.replace("Z", "+00:00"))
        latitude = float(raw_latitude)
        longitude = float(raw_longitude)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid proof-of-delivery capture metadata") from exc
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise ValueError("Invalid proof-of-delivery GPS coordinates")
    address = " ".join(str(values.get("address") or "Location address unavailable").split())[:500]
    return PodOverlayMetadata(captured_at, latitude, longitude, address)


def build_driver_full_name(user) -> str:
    """Use all profile name fields so the burned image identifies the account holder."""
    parts = [user.first_name, user.middle_name, user.last_name, user.suffix]
    full_name = " ".join(str(part).strip() for part in parts if str(part or "").strip())
    return full_name or str(user.name or "Driver").strip() or "Driver"


def _load_font(size: int):
    candidates = (
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("C:/Windows/Fonts/arial.ttf"),
    )
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    try:
        return ImageFont.truetype("DejaVuSans.ttf", size=size)
    except OSError:
        return ImageFont.load_default(size=size)


def burn_pod_overlay(image_bytes: bytes, metadata: PodOverlayMetadata, driver_name: str) -> tuple[bytes, str]:
    """Burn readable, resolution-aware POD details into an uploaded image."""
    try:
        source = Image.open(BytesIO(image_bytes))
        image = ImageOps.exif_transpose(source).convert("RGBA")
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("The uploaded proof photo is not a valid image") from exc

    width, height = image.size
    font_size = max(14, min(46, round(min(width, height) * 0.035)))
    font = _load_font(font_size)
    padding = max(12, round(font_size * 0.75))
    line_gap = max(3, round(font_size * 0.25))
    # Fix: wrap long reverse-geocoded addresses inside the lower-left safe area.
    address_width = max(24, round(width / max(font_size * 0.57, 1) * 0.78))
    address_lines = textwrap.wrap(metadata.address, width=address_width)[:3] or ["Location address unavailable"]
    # Fix: ISO uploads use UTC; render in the deployment's local timezone like the live preview.
    captured = timezone.localtime(metadata.captured_at) if metadata.captured_at.tzinfo else metadata.captured_at
    lines = [
        captured.strftime("%d %B %Y"),
        captured.strftime("%H:%M:%S"),
        driver_name,
        *address_lines,
        f"GPS: {metadata.latitude:.6f}, {metadata.longitude:.6f}",
    ]
    draw = ImageDraw.Draw(image, "RGBA")
    line_height = font_size + line_gap
    panel_height = padding * 2 + line_height * len(lines)
    panel_width = min(width - padding * 2, round(width * 0.9))
    left = padding
    top = max(padding, height - panel_height - padding)
    draw.rounded_rectangle(
        (left, top, left + panel_width, top + panel_height),
        radius=max(8, padding // 2),
        fill=(0, 0, 0, 118),
    )
    y = top + padding
    for line in lines:
        draw.text(
            (left + padding, y),
            line,
            font=font,
            fill=(255, 255, 255, 255),
            stroke_width=max(1, font_size // 18),
            stroke_fill=(0, 0, 0, 210),
        )
        y += line_height

    output = BytesIO()
    image.convert("RGB").save(output, format="JPEG", quality=90, optimize=True)
    return output.getvalue(), ".jpg"
