"""A review says whether each rating is for the products or for the service."""

from django.test import Client, TestCase

from .auth import create_token
from .models import Customer, Feedback, Order, OrderStatus


class FeedbackRatingTargetTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()
        self.customer = Customer.objects.create(email="rater@example.com", password="hashed", name="Lopez Store", is_active=True)
        self.other = Customer.objects.create(email="other@example.com", password="hashed", name="Other Store", is_active=True)
        self.order = Order.objects.create(
            order_number="ORD-RATE-1", customer=self.customer, status=OrderStatus.DELIVERED, subtotal=100, total_amount=100,
        )
        self.token = create_token({"userId": self.customer.id, "email": self.customer.email, "role": "CUSTOMER", "type": "customer"})

    def post(self, body: dict, token: str | None = None):
        return self.client.post(
            "/api/feedback", data=body, content_type="application/json", HTTP_AUTHORIZATION=f"Bearer {token or self.token}",
        )

    def both(self, **overrides) -> dict:
        body = {
            "orderId": self.order.id,
            "ratings": [
                {"ratingTarget": "PRODUCT", "rating": 2, "type": "COMPLAINT", "subject": "Order Review - ORD-RATE-1",
                 "message": "- Some products or packaging were damaged"},
                {"ratingTarget": "SERVICE", "rating": 5, "type": "COMPLIMENT", "subject": "Order Review - ORD-RATE-1",
                 "message": "- Delivery was on time as scheduled"},
            ],
        }
        body.update(overrides)
        return body

    def test_products_and_service_are_rated_as_two_tagged_ratings(self) -> None:
        response = self.post(self.both())

        self.assertEqual(response.status_code, 201, response.content)
        items = response.json()["feedbackItems"]
        self.assertEqual([(row["ratingTarget"], row["rating"]) for row in items], [("PRODUCT", 2), ("SERVICE", 5)])
        listed = self.client.get("/api/feedback", HTTP_AUTHORIZATION=f"Bearer {self.token}").json()["feedback"]
        self.assertEqual(sorted(row["ratingTarget"] for row in listed), ["PRODUCT", "SERVICE"])

    def test_a_bare_rating_is_the_service_rating_it_always_was(self) -> None:
        response = self.post({"orderId": self.order.id, "rating": 4, "message": "- Delivery was on time"})

        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["feedback"]["ratingTarget"], "SERVICE")
        # That order's products can still be rated afterwards; its service cannot be rated twice.
        self.assertEqual(self.post({"orderId": self.order.id, "rating": 4, "message": "- x"}).status_code, 409)
        product = self.post({"orderId": self.order.id, "ratings": [
            {"ratingTarget": "PRODUCT", "rating": 3, "message": "- Product condition was acceptable"},
        ]})
        self.assertEqual(product.status_code, 201, product.content)

    def test_a_rated_target_cannot_be_rated_again(self) -> None:
        self.post(self.both())
        response = self.post(self.both())
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"], "Feedback already submitted for this order")
        self.assertEqual(Feedback.objects.filter(order=self.order).count(), 2)

    def test_a_refused_submission_saves_neither_rating(self) -> None:
        cases = [
            (self.both(ratings=[{"ratingTarget": "PRODUCT", "rating": 2, "message": "- a"},
                                {"ratingTarget": "PRODUCT", "rating": 3, "message": "- b"}]),
             "Rate the products and the service once each"),
            (self.both(ratings=[{"ratingTarget": "DRIVER", "rating": 2, "message": "- a"}]),
             "ratingTarget must be PRODUCT or SERVICE"),
            (self.both(ratings=[{"ratingTarget": "PRODUCT", "rating": 2, "message": "- a"},
                                {"ratingTarget": "SERVICE", "rating": 5, "message": "  "}]),
             "Feedback is required when submitting a rating"),
            (self.both(ratings=[{"ratingTarget": "PRODUCT", "rating": 6, "message": "- a"}]),
             "Rating must be an integer from 1 to 5"),
            (self.both(ratings=[]), "Send at most one rating for the products and one for the service"),
            (self.both(ratings="PRODUCT"), "Send at most one rating for the products and one for the service"),
        ]
        for body, message in cases:
            with self.subTest(message=message):
                response = self.post(body)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertEqual(response.json()["error"], message)
        self.assertFalse(Feedback.objects.exists())

    def test_a_customer_rates_only_their_own_order(self) -> None:
        other_token = create_token({"userId": self.other.id, "email": self.other.email, "role": "CUSTOMER", "type": "customer"})
        self.assertEqual(self.post(self.both(), token=other_token).status_code, 403)
        self.assertFalse(Feedback.objects.exists())
