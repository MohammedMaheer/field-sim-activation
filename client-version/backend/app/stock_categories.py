"""Business category is independent of physical/eSIM form factor."""
from fastapi import HTTPException

SIM_CATEGORIES = ("Not recorded", "Wasel / Prepaid", "Postpaid", "Home Wireless", "Visitor")


def validate_category(value):
    if value not in SIM_CATEGORIES:
        raise HTTPException(422, "Select a valid SIM business category")
    return value
