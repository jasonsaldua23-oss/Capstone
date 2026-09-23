"""Shims shared by the contract tests: the Role and Driver models were folded into User."""

from .models import User


class _RoleValue(str):
    def __new__(cls, value: str):
        obj = str.__new__(cls, value)
        obj.id = value
        obj.name = value
        return obj


class Role:
    class objects:
        @staticmethod
        def create(name: str, description: str | None = None):
            return _RoleValue(name)


class Driver:
    class objects:
        @staticmethod
        def create(*, user: User, **kwargs):
            user.role = "DRIVER"
            if "license_number" in kwargs:
                user.license_number = kwargs.get("license_number")
            if "license_type" in kwargs:
                user.license_type = kwargs.get("license_type")
            if "license_expiry" in kwargs:
                user.license_expiry = kwargs.get("license_expiry")
            if "is_active" in kwargs:
                user.is_active = bool(kwargs.get("is_active"))
            user.save()
            user.user = user
            return user
