"""Durable transaction identity claims shared by upload and sale submissions.

Only explicit transaction references and exact order/receipt bytes are claimed.
A customer's identity or identity-document photograph is deliberately not a key.
"""
import base64
import hashlib
import re
import unicodedata

from fastapi import HTTPException
from sqlalchemy import select, tuple_

from .db import CaptureIdentityClaim

DUPLICATE_MESSAGE = (
    "This transaction or receipt is already recorded or being processed. "
    "Check your existing sales before submitting again."
)


def reference_key(value):
    normalized = re.sub(r"[^A-Z0-9]", "", unicodedata.normalize("NFKC", str(value or "")).upper())
    return hashlib.sha256(normalized.encode()).hexdigest() if normalized else None


def identity_keys(*, references=(), request_ids=(), sr_numbers=(), images=(), encoded_images=()):
    keys = {(kind, key) for kind, values in (("REFERENCE", references), ("REQUEST", request_ids), ("SR", sr_numbers))
            for value in values if (key := reference_key(value))}
    keys.update(("IMAGE", hashlib.sha256(data).hexdigest()) for data in images if data)
    keys.update(("IMAGE", hashlib.sha256(base64.b64decode(value, validate=True)).hexdigest()) for value in encoded_images if value)
    return sorted(keys)


def claim_identities(db, keys, *, capture_id=None, sale_id=None):
    """Claim inside the caller's transaction; a DB unique constraint wins races.

    Same-capture registration may add its linked sale to an existing claim. Claims
    remain after rejection or cancellation to prevent recording the same event twice.
    """
    if not keys:
        return
    existing = {(row.kind, row.fingerprint): row for row in db.scalars(
        select(CaptureIdentityClaim).where(tuple_(CaptureIdentityClaim.kind, CaptureIdentityClaim.fingerprint).in_(keys))
    )}
    for kind, fingerprint in keys:
        row = existing.get((kind, fingerprint))
        if row:
            same_capture = bool(capture_id and row.capture_id == capture_id)
            same_sale = bool(sale_id and row.sale_id == sale_id)
            if not (same_capture or same_sale):
                raise HTTPException(409, DUPLICATE_MESSAGE)
            if same_capture and sale_id and not row.sale_id:
                row.sale_id = sale_id
        else:
            db.add(CaptureIdentityClaim(kind=kind, fingerprint=fingerprint,
                                       capture_id=capture_id, sale_id=sale_id))
    db.flush()
