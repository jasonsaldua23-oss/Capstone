"""The change-stamp read endpoint every portal polls to stay in sync."""

from typing import Any

from django.http import HttpRequest, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from . import views_api as legacy
from .api_utils import error as _err, ok as _ok
from .sync_stamps import read_stamps


# Authentication retains the existing API-wide contract.
def _require_auth(request: HttpRequest) -> dict[str, Any] | None:
    return legacy._require_auth(request)


@csrf_exempt
@require_http_methods(["GET"])
def sync_stamps(request: HttpRequest) -> JsonResponse:
    """Return the current revision of every sync scope.

    This is the hot path for cross-device freshness: every signed-in portal polls
    it on a short interval, so it must stay a single indexed read of a table with
    one row per scope. It never returns record data - only counters the client
    diffs to decide which of its own collections to refresh.
    """
    payload = _require_auth(request)
    if not payload:
        return _err("Unauthorized", 401)

    response = _ok({
        "success": True,
        "stamps": read_stamps(),
        "serverTime": timezone.now().isoformat(),
    })
    # A cached stamp response would freeze the portal at an old revision.
    response["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return response
