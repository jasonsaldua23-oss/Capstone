from django.urls import include, path, re_path
from django.views.static import serve

from core.views_api import private_media
from .settings import BASE_DIR, MEDIA_ROOT


def serve_cached_upload(request, path):
    """Serve public catalog assets; route all evidence through authorization checks."""
    if not path.startswith("products/"):
        # Legacy /uploads evidence links keep working, but no longer bypass access checks.
        return private_media(request, path)
    response = serve(request, path, document_root=MEDIA_ROOT / "uploads")
    # Fix: uploaded bytes must not execute as same-origin active content.
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'; sandbox"
    if response.status_code == 200:
        # Catalog image names are random and immutable, so they are safe to cache publicly.
        response["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


urlpatterns = [    path("api/", include("core.urls")),
    path("uploads/<path:path>", serve_cached_upload),
    # Email clients need a backend-served URL for the system logo.
    re_path(r"^email-assets/(?P<path>ann-anns-logo\.png)$", serve, {"document_root": BASE_DIR.parent / "public"}),
]

