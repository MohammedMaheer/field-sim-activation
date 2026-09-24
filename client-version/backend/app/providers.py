"""Only mock adapters are shipped. Production must supply certified implementations."""

import os
from typing import Protocol


class IdentityProvider(Protocol):
    def verify(self, scenario: str) -> dict: ...


class TelecomProvider(Protocol):
    def activate(self, order_id: str) -> dict: ...


class MessagingProvider(Protocol):
    def send(self, destination: str, template: str) -> dict: ...


class PaymentProvider(Protocol):
    def authorize(self, order_id: str, amount: float) -> dict: ...


class MapProvider(Protocol):
    def configuration(self) -> dict: ...


class MockIdentity:
    def verify(self, scenario="pass"):
        return {
            "provider": "MOCK",
            "status": {"pass": "VERIFIED", "review": "MANUAL REVIEW", "fail": "FAILED"}[scenario],
            "confidence": 99.4 if scenario == "pass" else 72.1,
            "fields": {"name": 99.8, "document": 99.5, "dob": 99.9},
            "authenticity": "SIMULATED",
            "face_match": scenario == "pass",
            "liveness": scenario == "pass",
        }


class MockTelecom:
    def activate(self, order_id):
        return {"reference": f"MOCK-{order_id[:8]}", "status": "ACTIVATED"}


class MockMessaging:
    def send(self, destination, template):
        return {"status": "SIMULATED", "delivered": False}


class MockPayment:
    def authorize(self, order_id, amount):
        return {"status": "SIMULATED", "reference": f"MOCK-PAY-{order_id[:8]}", "amount": amount}


class MockMaps:
    def configuration(self):
        return {"mode": "schematic", "provider": "MOCK"}


if os.getenv("APP_ENV") == "production" or os.getenv("PROVIDER_MODE", "mock") != "mock":
    raise RuntimeError(
        "Certified production adapters are not configured. Demo providers cannot run in production."
    )

identity = MockIdentity()
ocr = MockIdentity()
liveness = MockIdentity()
telecom = MockTelecom()
payment = MockPayment()
sms = MockMessaging()
email = MockMessaging()
push = MockMessaging()
maps = MockMaps()
