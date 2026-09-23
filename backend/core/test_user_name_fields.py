"""A user's structured name parts must survive creation and stay the source of truth.

Before this, POST /api/users accepted firstName/lastName and dropped them, so every
account existed as a flat display name with no parts. The profile editors then had to
recover the parts by splitting the string, which is how a single-word name such as
"jandriver" ended up saved as "jandriver jandriver".
"""
import json
from unittest.mock import patch

from django.test import RequestFactory, TestCase

from .models import Customer, RoleType, User
from .views_api import auth_register, customer_detail, user_detail, users_collection

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

    def test_staff_creation_rejects_numbers_in_name_parts(self):
        response = self._create({"firstName": "Janrick", "middleName": "123", "lastName": "Saldua"})

        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(json.loads(response.content)["error"], "Names cannot contain numbers.")
        self.assertFalse(User.objects.filter(email="new.driver@gmail.com").exists())

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
        area = user.service_areas[0]
        self.assertEqual((area["city"], area["assigned_by"]), ("talisay", "admin-1"))

    def test_driver_requires_supported_service_area(self):
        for area in ["", "bacolod"]:
            response = self._create({"name": "Driver", "serviceArea": area})
            self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(User.objects.filter(email="new.driver@gmail.com").exists())

    def test_non_driver_does_not_require_service_area(self):
        response = self._create({"name": "Staff", "roleId": RoleType.WAREHOUSE_STAFF, "serviceArea": ""})
        self.assertEqual(response.status_code, 201, response.content)
        self.assertFalse(User.objects.get(email="new.driver@gmail.com").service_areas)

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
        user.refresh_from_db()
        self.assertEqual(user.service_area_cities, ["talisay"])
        self.assertEqual(json.loads(response.content)["user"]["serviceArea"], "talisay")

    def test_staff_update_rejects_numbers_without_changing_the_name(self):
        user = User.objects.create(
            email="warehouse@gmail.com",
            password="unused",
            name="Jan Staff",
            first_name="Jan",
            last_name="Staff",
            role=RoleType.WAREHOUSE_STAFF,
        )

        response = self._update(user, {"firstName": "Jan2"})

        self.assertEqual(response.status_code, 400, response.content)
        user.refresh_from_db()
        self.assertEqual((user.first_name, user.name), ("Jan", "Jan Staff"))

    def test_invalid_driver_service_area_is_rejected_without_removing_existing_area(self):
        self._create({"name": "Driver", "serviceArea": "silay"})
        user = User.objects.get(email="new.driver@gmail.com")

        response = self._update(user, {"roleId": RoleType.DRIVER, "serviceArea": "bacolod"})

        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(user.service_area_cities, ["silay"])


class CustomerNameValidationTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_registration_rejects_a_numeric_middle_name(self):
        request = self.factory.post(
            "/",
            data=json.dumps({
                "firstName": "Jan",
                "middleName": "123",
                "lastName": "Test",
                "email": "jan.test@gmail.com",
                "password": VALID_PASSWORD,
            }),
            content_type="application/json",
        )

        response = auth_register(request)

        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(json.loads(response.content)["error"], "Names cannot contain numbers.")
        self.assertFalse(Customer.objects.filter(email="jan.test@gmail.com").exists())

    def test_profile_update_rejects_a_numeric_last_name(self):
        customer = Customer.objects.create(
            email="customer@gmail.com",
            password="unused",
            name="Jan Test",
            first_name="Jan",
            last_name="Test",
        )
        request = self.factory.put(
            "/",
            data=json.dumps({"lastName": "Test2"}),
            content_type="application/json",
        )
        with patch("core.views_api._require_auth", return_value={"type": "customer", "userId": customer.id}):
            response = customer_detail(request, customer.id)

        self.assertEqual(response.status_code, 400, response.content)
        customer.refresh_from_db()
        self.assertEqual((customer.last_name, customer.name), ("Test", "Jan Test"))
