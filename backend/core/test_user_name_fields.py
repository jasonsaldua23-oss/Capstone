"""A user's structured name parts must survive creation and stay the source of truth.

Before this, POST /api/users accepted firstName/lastName and dropped them, so every
account existed as a flat display name with no parts. The profile editors then had to
recover the parts by splitting the string, which is how a single-word name such as
"jandriver" ended up saved as "jandriver jandriver".
"""
import json
from unittest.mock import patch

from django.test import RequestFactory, TestCase

from .models import DriverServiceArea, RoleType, User
from .views_api import user_detail, users_collection

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
            "serviceArea": "silay",
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

    def _update(self, user, payload):
        request = self.factory.put("/", data=json.dumps(payload), content_type="application/json")
        with patch("core.views_api._require_staff", return_value=(self.admin_auth, None)):
            return user_detail(request, user.id)

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

    def test_driver_service_area_is_saved_during_creation(self):
        response = self._create({"name": "Driver", "serviceArea": "talisay"})
        self.assertEqual(response.status_code, 201, response.content)
        user = User.objects.get(email="new.driver@gmail.com")
        area = user.service_areas.get()
        self.assertEqual((area.city, area.assigned_by), ("talisay", "admin-1"))

    def test_driver_requires_supported_service_area(self):
        for area in ["", "bacolod"]:
            response = self._create({"name": "Driver", "serviceArea": area})
            self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(User.objects.filter(email="new.driver@gmail.com").exists())

    def test_non_driver_does_not_require_service_area(self):
        response = self._create({"name": "Staff", "roleId": RoleType.WAREHOUSE_STAFF, "serviceArea": ""})
        self.assertEqual(response.status_code, 201, response.content)
        self.assertFalse(User.objects.get(email="new.driver@gmail.com").service_areas.exists())

    def test_driver_service_area_is_returned_for_editing(self):
        self._create({"name": "Driver", "serviceArea": "silay"})
        request = self.factory.get("/")
        with patch("core.views_api._require_staff", return_value=(self.admin_auth, None)):
            response = users_collection(request)

        self.assertEqual(response.status_code, 200, response.content)
        row = json.loads(response.content)["users"][0]
        self.assertEqual(row["serviceArea"], "silay")
        self.assertEqual(row["serviceAreas"], ["silay"])

    def test_admin_can_change_driver_service_area(self):
        self._create({"name": "Driver", "serviceArea": "silay"})
        user = User.objects.get(email="new.driver@gmail.com")

        response = self._update(user, {"roleId": RoleType.DRIVER, "serviceArea": "talisay"})

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(list(DriverServiceArea.objects.filter(driver=user).values_list("city", flat=True)), ["talisay"])
        self.assertEqual(json.loads(response.content)["user"]["serviceArea"], "talisay")

    def test_invalid_driver_service_area_is_rejected_without_removing_existing_area(self):
        self._create({"name": "Driver", "serviceArea": "silay"})
        user = User.objects.get(email="new.driver@gmail.com")

        response = self._update(user, {"roleId": RoleType.DRIVER, "serviceArea": "bacolod"})

        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(list(user.service_areas.values_list("city", flat=True)), ["silay"])
