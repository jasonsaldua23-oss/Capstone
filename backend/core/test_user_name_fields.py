"""A user's structured name parts must survive creation and stay the source of truth.

Before this, POST /api/users accepted firstName/lastName and dropped them, so every
account existed as a flat display name with no parts. The profile editors then had to
recover the parts by splitting the string, which is how a single-word name such as
"jandriver" ended up saved as "jandriver jandriver".
"""
import json
from unittest.mock import patch

from django.test import RequestFactory, TestCase

from .models import RoleType, User
from .views_api import users_collection

VALID_PASSWORD = "Str0ng!Passw0rd"


class UserCreationNameFieldTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.admin_auth = {"type": "staff", "role": "ADMIN", "userId": "admin-1", "name": "Admin"}

    def _create(self, payload):
        body = {
            "email": "new.driver@gmail.com",
            "password": VALID_PASSWORD,
            "roleId": RoleType.DRIVER,
            "phone": "09171234567",
            **payload,
        }
        request = self.factory.post("/", data=json.dumps(body), content_type="application/json")
        with patch("core.views_api._require_staff", return_value=(self.admin_auth, None)), patch(
            "core.views_api._is_email_verification_token_valid", return_value=True
        ), patch("core.views_api._email_new_staff_credentials"), patch(
            "core.views_api._create_staff_notifications"
        ):
            return users_collection(request)

    def test_structured_name_parts_are_persisted(self):
        response = self._create(
            {
                "name": "ignored",
                "firstName": "Janrick",
                "middleName": "Alonzo",
                "lastName": "Saldua",
                "suffix": "Jr.",
            }
        )
        self.assertEqual(response.status_code, 201, response.content)
        user = User.objects.get(email="new.driver@gmail.com")
        self.assertEqual(user.first_name, "Janrick")
        self.assertEqual(user.middle_name, "Alonzo")
        self.assertEqual(user.last_name, "Saldua")
        self.assertEqual(user.suffix, "Jr.")

    def test_display_name_is_derived_from_the_parts(self):
        self._create({"name": "whatever", "firstName": "Janrick", "lastName": "Saldua"})
        self.assertEqual(User.objects.get(email="new.driver@gmail.com").name, "Janrick Saldua")

    def test_a_one_word_first_name_is_not_doubled(self):
        self._create({"name": "jandriver", "firstName": "jandriver"})
        user = User.objects.get(email="new.driver@gmail.com")
        self.assertEqual(user.name, "jandriver")
        self.assertEqual(user.first_name, "jandriver")
        self.assertIsNone(user.last_name)

    def test_a_flat_name_alone_still_works_and_leaves_the_parts_empty(self):
        response = self._create({"name": "Jan Driver"})
        self.assertEqual(response.status_code, 201, response.content)
        user = User.objects.get(email="new.driver@gmail.com")
        self.assertEqual(user.name, "Jan Driver")
        self.assertIsNone(user.first_name)
        self.assertIsNone(user.last_name)
