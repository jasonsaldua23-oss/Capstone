"""Small, framework-level helpers shared by API view modules.

Keeping these helpers independent prevents the main API controller from becoming
the dependency source for every future domain-specific view module.
"""

import json
import math
import re
from typing import Any

from django.http import HttpRequest, JsonResponse


def camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


def json_body(request: HttpRequest) -> dict[str, Any]:
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return {}


def ok(data: dict[str, Any], status: int = 200) -> JsonResponse:
    return JsonResponse(data, status=status)


def error(message: str, status: int = 400) -> JsonResponse:
    return JsonResponse({"success": False, "error": message}, status=status)


def to_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def is_whole_number(value: Any) -> bool:
    """Accept integer JSON values without silently truncating fractional input."""
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    if isinstance(value, float):
        return math.isfinite(value) and value.is_integer()
    return bool(re.fullmatch(r"[+-]?\d+", str(value or "").strip()))


def to_float_or_none(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None
