"""Move locally stored uploads into the Supabase bucket and repoint the database rows.

Run this once per machine that still holds uploaded files under backend/media/uploads,
including the live server. Files that are already absolute URLs are left alone, so the
command is safe to run repeatedly.

    python manage.py migrate_uploads_to_storage --dry-run
    python manage.py migrate_uploads_to_storage
"""
from __future__ import annotations

import json
import mimetypes
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from core import object_storage
from core.models import Customer, Order, Product, Replacement, TripDropPoint, User

# Each entry is the model, the field holding the URL, and a label for the output.
URL_FIELDS = [
    (Product, "image_url", "product image"),
    (User, "avatar", "staff avatar"),
    (User, "license_photo_url", "license photo"),
    (Customer, "avatar", "customer avatar"),
    (TripDropPoint, "delivery_photo", "proof of delivery"),
    (Order, "pod_photo_url", "order proof of delivery"),
    (Replacement, "damage_photo_url", "damage photo"),
]

# damage_photo_urls holds a JSON array of URLs rather than a single one.
JSON_LIST_FIELDS = [(Replacement, "damage_photo_urls", "damage photo list")]


class Command(BaseCommand):
    help = "Upload local media files to object storage and rewrite the stored URLs."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report what would change, write nothing.")

    def handle(self, *args, **options):
        if not object_storage.is_configured():
            raise CommandError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set before running this."
            )
        dry_run = bool(options.get("dry_run"))

        if not dry_run:
            result = object_storage.ensure_bucket()
            self.stdout.write(
                f"Bucket '{result['bucket']}' {'created' if result['created'] else 'already exists'}."
            )

        media_root = Path(settings.MEDIA_ROOT) / "uploads"
        uploaded: dict[str, str] = {}
        moved = skipped = missing = 0

        for model, field, label in URL_FIELDS:
            rows = model.objects.exclude(**{f"{field}__isnull": True}).exclude(**{field: ""})
            for row in rows:
                value = str(getattr(row, field) or "").strip()
                if not value.startswith("/uploads/"):
                    skipped += 1
                    continue

                object_path = value[len("/uploads/"):]
                if object_path in uploaded:
                    new_url = uploaded[object_path]
                else:
                    local_file = media_root / object_path
                    if not local_file.is_file():
                        # The file is already gone on this machine — nothing to move.
                        self.stdout.write(self.style.WARNING(f"  missing {label}: {value}"))
                        missing += 1
                        continue
                    if dry_run:
                        self.stdout.write(f"  would upload {label}: {value}")
                        moved += 1
                        continue
                    new_url = object_storage.upload_bytes(
                        object_path,
                        local_file.read_bytes(),
                        content_type=mimetypes.guess_type(local_file.name)[0],
                    )
                    uploaded[object_path] = new_url

                if dry_run:
                    continue
                setattr(row, field, new_url)
                row.save(update_fields=[field])
                moved += 1

        for model, field, label in JSON_LIST_FIELDS:
            rows = model.objects.exclude(**{f"{field}__isnull": True}).exclude(**{field: ""})
            for row in rows:
                raw = str(getattr(row, field) or "").strip()
                try:
                    urls = json.loads(raw)
                except (TypeError, ValueError):
                    continue
                if not isinstance(urls, list):
                    continue
                changed = False
                next_urls = []
                for value in urls:
                    value = str(value or "").strip()
                    if not value.startswith("/uploads/"):
                        next_urls.append(value)
                        continue
                    object_path = value[len("/uploads/"):]
                    if object_path in uploaded:
                        next_urls.append(uploaded[object_path])
                        changed = True
                        continue
                    local_file = media_root / object_path
                    if not local_file.is_file():
                        self.stdout.write(self.style.WARNING(f"  missing {label}: {value}"))
                        missing += 1
                        next_urls.append(value)
                        continue
                    if dry_run:
                        self.stdout.write(f"  would upload {label}: {value}")
                        moved += 1
                        next_urls.append(value)
                        continue
                    new_url = object_storage.upload_bytes(
                        object_path,
                        local_file.read_bytes(),
                        content_type=mimetypes.guess_type(local_file.name)[0],
                    )
                    uploaded[object_path] = new_url
                    next_urls.append(new_url)
                    changed = True
                    moved += 1
                if changed and not dry_run:
                    setattr(row, field, json.dumps(next_urls))
                    row.save(update_fields=[field])

        verb = "would move" if dry_run else "moved"
        # `skipped` covers anything not stored under /uploads/ — rows already pointing
        # at the bucket, and seed rows pointing at static paths such as /images/.
        self.stdout.write(
            self.style.SUCCESS(
                f"{verb} {moved}; not a local upload path {skipped}; local file missing {missing}."
            )
        )
        if missing:
            self.stdout.write(
                "Rows whose file is missing keep their old path. Re-upload those images "
                "through the portal, or run this on the machine that still has the files."
            )
