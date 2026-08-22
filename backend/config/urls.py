from django.urls import include, path, re_path
from django.views.static import serve

from .settings import BASE_DIR, MEDIA_ROOT

urlpatterns = [    path("api/", include("core.urls")),
    path("uploads/<path:path>", serve, {"document_root": MEDIA_ROOT / "uploads"}),
    # Email clients need a backend-served URL for the system logo.
    re_path(r"^email-assets/(?P<path>ann-anns-logo\.png)$", serve, {"document_root": BASE_DIR.parent / "public"}),
]

