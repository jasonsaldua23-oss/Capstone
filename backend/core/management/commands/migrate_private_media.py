"""Move legacy private uploads out of the public bucket by explicit operator request."""

import json
import mimetypes
import uuid
from pathlib import Path
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from core import object_storage
from core.models import Customer, Order, Replacement, TripDropPoint, User


PRIVATE_MEDIA_PREFIX = "/api/media/"
PUBLIC_MEDIA_PREFIX = "/uploads/"


class Command(BaseCommand):
    help = "Preview or move legacy private uploads into the private storage bucket. Defaults to a read-only preview."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("--apply", action="store_true", help="Copy media, update database values, and remove copied public objects.")

    def _legacy_path(self, value: Any) -> str | None:
        raw = str(value or "").strip()
        if raw.startswith(PRIVATE_MEDIA_PREFIX):
            return None
        if raw.startswith(PUBLIC_MEDIA_PREFIX):
            path = raw[len(PUBLIC_MEDIA_PREFIX):]
        elif object_storage.is_configured() and raw.startswith(object_storage.public_url("")):
            path = raw[len(object_storage.public_url("")):]
        else:
            return None
        normalized = path.replace("\\", "/").strip("/")
        if not normalized or normalized.startswith("products/") or ".." in normalized.split("/"):
            return None
        return normalized

    def _read_legacy_bytes(self, path: str) -> tuple[bytes, str, bool]:
        local_file = Path(settings.MEDIA_ROOT) / "uploads" / path
        if local_file.is_file():
            return local_file.read_bytes(), mimetypes.guess_type(str(local_file))[0] or "application/octet-stream", True
        if object_storage.is_configured():
            data, content_type = object_storage.download_public_bytes(path)
            return data, content_type, False
        raise CommandError(f"Cannot read legacy media {path}: it is not on local disk and object storage is not configured.")

    def _simple_values(self):
        for model, field in (
            (User, "avatar"),
            (User, "license_photo_url"),
            (Customer, "avatar"),
            (Order, "pod_photo_url"),
            (TripDropPoint, "delivery_photo"),
            (Replacement, "damage_photo_url"),
        ):
            for record in model.objects.exclude(**{f"{field}__isnull": True}).exclude(**{field: ""}):
                yield record, field, None, str(getattr(record, field) or "")

        for replacement in Replacement.objects.exclude(damage_photo_urls__isnull=True).exclude(damage_photo_urls=""):
            try:
                values = json.loads(replacement.damage_photo_urls or "[]")
            except json.JSONDecodeError:
                continue
            if not isinstance(values, list):
                continue
            for index, value in enumerate(values):
                if isinstance(value, str):
                    yield replacement, "damage_photo_urls", index, value

    def handle(self, *args: Any, **options: Any) -> None:
        apply = bool(options["apply"])
        candidates = []
        for record, field, index, value in self._simple_values():
            path = self._legacy_path(value)
            if path:
                candidates.append((record, field, index, value, path))

        self.stdout.write(f"Found {len(candidates)} legacy private-media reference(s).")
        if not apply:
            self.stdout.write(self.style.WARNING("Preview only. Re-run with --apply after backing up and provisioning the private bucket."))
            return
        if not candidates:
            return
        if not object_storage.is_configured():
            raise CommandError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to migrate cloud private media.")

        migrated_paths: dict[str, tuple[str, bool]] = {}
        deleted_public_paths: set[str] = set()
        for record, field, index, value, legacy_path in candidates:
            if legacy_path not in migrated_paths:
                data, content_type, was_local = self._read_legacy_bytes(legacy_path)
                extension = Path(legacy_path).suffix or ".bin"
                destination_path = f"migrated/{uuid.uuid4().hex}{extension}"
                object_storage.upload_private_bytes(destination_path, data, content_type=content_type)
                migrated_paths[legacy_path] = (destination_path, was_local)

            destination_path, was_local = migrated_paths[legacy_path]
            private_url = f"{PRIVATE_MEDIA_PREFIX}{destination_path}"
            if index is None:
                setattr(record, field, private_url)
                record.save(update_fields=[field])
            else:
                values = json.loads(getattr(record, field) or "[]")
                values[index] = private_url
                setattr(record, field, json.dumps(values))
                record.save(update_fields=[field])
            if not was_local:
                deleted_public_paths.add(legacy_path)

        for legacy_path in deleted_public_paths:
            # Delete only after every record that shared the source has been updated.
            object_storage.delete_public_object(legacy_path)
        self.stdout.write(self.style.SUCCESS(f"Migrated {len(candidates)} reference(s) into private media."))
