from django.test import SimpleTestCase

from .beverage_categories import category_spec, require_category_spec


class BeverageCategorySpecificationTests(SimpleTestCase):
    def test_every_supported_category_has_the_required_container(self) -> None:
        expected = {
            "Carbonated (Glass)": ("Glass Bottle", True),
            "Carbonated (PET/PLASTIC)": ("PET/Plastic Bottle", False),
            "Carbonated (Cans)": ("Can", False),
            "Energy Drinks (Glass)": ("Glass Bottle", True),
            "Energy Drinks": ("PET/Plastic Bottle", False),
            "Sport Drinks": ("PET/Plastic Bottle", False),
            "Alcohol": ("Glass Bottle", False),
        }
        for category, (packaging_type, deposit_allowed) in expected.items():
            spec = require_category_spec(category)
            self.assertEqual(spec["packagingType"], packaging_type)
            self.assertEqual(spec["looseUnit"], packaging_type)
            self.assertEqual(spec["depositAllowed"], deposit_allowed)

    def test_legacy_category_spacing_is_canonicalized(self) -> None:
        self.assertEqual(category_spec("Carbonated(Glass)")["category"], "Carbonated (Glass)")

    def test_alcohol_is_glass_but_deposit_exempt(self) -> None:
        spec = require_category_spec("Alcohol")
        self.assertEqual(spec["packagingType"], "Glass Bottle")
        self.assertTrue(spec["depositExempt"])
