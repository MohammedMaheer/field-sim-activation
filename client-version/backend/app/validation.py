"""Validate business text after trimming, while preserving passwords verbatim."""
from pydantic import BaseModel, ValidationInfo, field_validator


class BusinessInput(BaseModel):
    @field_validator("*", mode="before")
    @classmethod
    def trim_text(cls, value, info: ValidationInfo):
        if isinstance(value, str) and info.field_name != "password":
            return value.strip()
        return value
