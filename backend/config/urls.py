from django.urls import include, path, re_path
from django.views.static import serve

from .settings import BASE_DIR, MEDIA_ROOT


def serve_cached_upload(request, path):
    """Serve uniquely named uploaded assets with durable browser caching."""
    response = serve(request, path, document_root=MEDIA_ROOT / "uploads")
    if response.status_code == 200:
        # Added: upload filenames contain timestamps, so existing POD URLs are immutable.
        response["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


urlpatterns = [    path("api/", include("core.urls")),
    path("uploads/<path:path>", serve_cached_upload),
    # Email clients need a backend-served URL for the system logo.
    re_path(r"^email-assets/(?P<path>ann-anns-logo\.png)$", serve, {"document_root": BASE_DIR.parent / "public"}),
]

