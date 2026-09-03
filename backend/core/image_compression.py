"""Central image optimization used by every server-side upload endpoint."""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError


@dataclass(frozen=True)
class ImageCompressionProfile:
    max_dimension: int
    max_bytes: int


# Evidence keeps more pixels than catalog/profile images so labels and damage remain legible.
IMAGE_COMPRESSION_PROFILES = {
    "customers": ImageCompressionProfile(max_dimension=512, max_bytes=200 * 1024),
    "products": ImageCompressionProfile(max_dimension=1600, max_bytes=500 * 1024),
    "pods": ImageCompressionProfile(max_dimension=2000, max_bytes=800 * 1024),
    "damages": ImageCompressionProfile(max_dimension=2000, max_bytes=800 * 1024),
    "replacement-evidence": ImageCompressionProfile(max_dimension=2000, max_bytes=800 * 1024),
}
DEFAULT_IMAGE_PROFILE = ImageCompressionProfile(max_dimension=1600, max_bytes=500 * 1024)


def _encode_webp(image: Image.Image, quality: int) -> bytes:
    output = BytesIO()
    # WebP preserves transparency while usually producing smaller uploads than PNG/JPEG.
    # Method 2 keeps synchronous API uploads responsive while retaining good compression.
    image.save(output, format="WEBP", quality=quality, method=2)
    return output.getvalue()


def optimize_image_upload(
    data: bytes,
    *,
    folder: str,
    original_extension: str,
    original_content_type: str | None,
) -> tuple[bytes, str, str | None]:
    """Resize and compress a static raster image, preserving unsupported inputs unchanged."""
    profile = IMAGE_COMPRESSION_PROFILES.get(folder, DEFAULT_IMAGE_PROFILE)
    try:
        with Image.open(BytesIO(data)) as source:
            # Animated images must not silently lose frames during optimization.
            if bool(getattr(source, "is_animated", False)):
                return data, original_extension, original_content_type
            source.load()
            working = ImageOps.exif_transpose(source)
            if "A" in working.getbands():
                working = working.convert("RGBA")
            else:
                working = working.convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError):
        # Keep compatibility for formats Pillow cannot decode; endpoint MIME checks still apply.
        return data, original_extension, original_content_type

    requires_resize = max(working.size) > profile.max_dimension
    working.thumbnail((profile.max_dimension, profile.max_dimension), Image.Resampling.LANCZOS)
    smallest = data

    try:
        # A short quality ladder avoids expensive repeated encodes on high-detail photos.
        for _ in range(4):
            last_encoded = data
            for quality in (82, 70, 58, 46):
                encoded = _encode_webp(working, quality)
                last_encoded = encoded
                if len(encoded) < len(smallest):
                    smallest = encoded
                if len(encoded) <= profile.max_bytes:
                    if not requires_resize and len(encoded) >= len(data) and len(data) <= profile.max_bytes:
                        return data, original_extension, original_content_type
                    return encoded, ".webp", "image/webp"

            if min(working.size) <= 320:
                break
            ratio = min(0.9, (profile.max_bytes / max(1, len(last_encoded))) ** 0.5 * 0.95)
            next_size = (
                max(320, round(working.width * ratio)),
                max(320, round(working.height * ratio)),
            )
            if next_size == working.size:
                break
            working = working.resize(next_size, Image.Resampling.LANCZOS)
    except OSError:
        # Deployments without a WebP encoder continue accepting the original image.
        return data, original_extension, original_content_type

    if len(smallest) < len(data):
        return smallest, ".webp", "image/webp"
    return data, original_extension, original_content_type
