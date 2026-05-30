from django.urls import include, path
from django.views.static import serve

from .settings import MEDIA_ROOT

urlpatterns = [    path("api/", include("core.urls")),
    path("uploads/<path:path>", serve, {"document_root": MEDIA_ROOT / "uploads"}),
]

