"""Bounded, encrypted OCR jobs shared by every API process.

The database owns admission and processing leases. Tesseract runs after the claim
transaction closes; a stale worker can never overwrite a newer lease's result.
Jobs are temporary extraction aids, not permanent customer evidence.
"""
import base64
import hashlib
import json
import subprocess
from datetime import datetime, timedelta
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, delete, func, select, text
from sqlalchemy.orm import Mapped, mapped_column

from .capture_ocr import OcrBusy, extractor, inspect_image
from .db import Agent, DB, Entity, KycCapture, Role, User, get_db, now
from .security import CAPTURE_WRITERS, cipher, permissions, principal

router = APIRouter(prefix="/api/kyc-captures/ocr-jobs", tags=["Document extraction"])
ACTIVE = {"QUEUED", "PROCESSING"}
QUEUE_LIMIT = 20
USER_QUEUE_LIMIT = 2
LEASE_SECONDS = 90
MAX_ATTEMPTS = 3
MAX_QUEUE_AGE = timedelta(minutes=15)
RETENTION = timedelta(hours=24)
MAX_RETAINED = 500
RETRY_AFTER = 2
# Stable shared namespace, independent of Python's randomized hash seed.
ADMISSION_LOCK = 71621934017001


class OcrJob(Entity):
    __tablename__ = "ocr_jobs"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    operation_id: Mapped[str] = mapped_column(String(80))
    stage: Mapped[str] = mapped_column(String(12))
    image_hash: Mapped[str] = mapped_column(String(64))
    image_encrypted: Mapped[str] = mapped_column(Text)
    result_encrypted: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(12), default="QUEUED")
    error: Mapped[str] = mapped_column(String(200), default="")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    lease_token: Mapped[str | None] = mapped_column(String(36), nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    available_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    __table_args__ = (
        UniqueConstraint("user_id", "operation_id", name="uq_ocr_job_owner_operation"),
        Index("ix_ocr_job_status_available", "status", "available_at", "created_at"),
        Index("ix_ocr_job_owner_created", "user_id", "created_at"),
        Index("ix_ocr_job_lease", "status", "lease_until"),
    )


def capture_access(db, user):
    """Recheck effective access even after a persisted job outlives its request."""
    role = db.get(Role, user.role_id) if user else None
    grants = permissions(db, user) if user and role else set()
    agent = db.scalar(select(Agent).where(Agent.user_id == user.id)) if user else None
    if (not role or role.name not in CAPTURE_WRITERS or not {"read", "ekyc.write"} <= grants
            or (agent and agent.employment_status != "ACTIVE")):
        raise HTTPException(403, "Your account cannot capture customer or order screens")


def admission_lock(db):
    """Serialize counts and writes until the caller commits or rolls back.

    Production uses PostgreSQL's transaction-scoped advisory lock. SQLite's
    immediate write transaction gives disposable local tests the same contract.
    Do not hold this lock while doing OCR.
    """
    if db.bind.dialect.name == "postgresql":
        if not db.scalar(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": ADMISSION_LOCK}):
            raise HTTPException(429, "Scanner queue is busy. Retry shortly.",
                                headers={"Retry-After": str(RETRY_AFTER)})
    elif db.bind.dialect.name == "sqlite":
        connection = db.connection().connection.driver_connection
        if not connection.in_transaction:
            db.execute(text("BEGIN IMMEDIATE"))


def terminal(row, error, stamp=None):
    row.status, row.error = "FAILED", error
    row.image_encrypted = row.result_encrypted = ""
    row.lease_token = row.lease_until = None
    row.finished_at = stamp or now()


def maintain_jobs(db, stamp=None):
    """Bound lease recovery, queued photos, result age and retained record count."""
    stamp = stamp or now()
    expired = list(db.scalars(select(OcrJob).where(
        OcrJob.status == "PROCESSING", OcrJob.lease_until <= stamp
    ).order_by(OcrJob.lease_until).limit(QUEUE_LIMIT).with_for_update(skip_locked=True)))
    for row in expired:
        if row.stage == "SYNC" or row.attempts >= MAX_ATTEMPTS or row.created_at <= stamp - MAX_QUEUE_AGE:
            terminal(row, "The scan timed out. Capture the screen again.", stamp)
        else:
            row.status, row.error = "QUEUED", ""
            row.lease_token = row.lease_until = None
            row.available_at = stamp
    stale = db.scalars(select(OcrJob).where(
        OcrJob.status == "QUEUED", OcrJob.created_at <= stamp - MAX_QUEUE_AGE
    ).limit(QUEUE_LIMIT).with_for_update(skip_locked=True))
    for row in stale:
        terminal(row, "This scan expired. Capture the screen again.", stamp)
    db.flush()
    old = list(db.scalars(select(OcrJob.id).where(
        OcrJob.status.not_in(ACTIVE), OcrJob.finished_at < stamp - RETENTION
    ).order_by(OcrJob.finished_at).limit(MAX_RETAINED)))
    if old:
        db.execute(delete(OcrJob).where(OcrJob.id.in_(old)))
    # Keep space for one admission; never evict live jobs.
    count = db.scalar(select(func.count()).select_from(OcrJob))
    overflow = max(0, count - MAX_RETAINED + 1)
    if overflow:
        old = list(db.scalars(select(OcrJob.id).where(OcrJob.status.not_in(ACTIVE))
            .order_by(OcrJob.finished_at, OcrJob.created_at, OcrJob.id).limit(overflow)))
        if old:
            db.execute(delete(OcrJob).where(OcrJob.id.in_(old)))


def ensure_admission(db, user_id):
    """Called after admission_lock by both stage jobs and legacy upload/retry."""
    maintain_jobs(db)
    staged = db.scalar(select(func.count()).select_from(OcrJob).where(OcrJob.status.in_(ACTIVE)))
    legacy = db.scalar(select(func.count()).select_from(KycCapture).where(KycCapture.status == "QUEUED"))
    owned = db.scalar(select(func.count()).select_from(OcrJob).where(
        OcrJob.status.in_(ACTIVE), OcrJob.user_id == user_id))
    owned += db.scalar(select(func.count()).select_from(KycCapture).where(
        KycCapture.status == "QUEUED", KycCapture.creator_id == user_id))
    if staged + legacy >= QUEUE_LIMIT or owned >= USER_QUEUE_LIMIT:
        raise HTTPException(429, "Scanner queue is busy. Keep the photo and retry shortly.",
                            headers={"Retry-After": str(RETRY_AFTER)})


class JobBody(BaseModel):
    operation_id: str = Field(min_length=16, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    stage: Literal["DOCUMENT", "ORDER", "RECEIPT"]
    image_base64: str = Field(max_length=5_333_336)


def view(row):
    result = json.loads(cipher.decrypt(row.result_encrypted.encode())) if row.status == "COMPLETED" and row.result_encrypted else None
    return {"id": row.id, "stage": row.stage, "status": row.status, "result": result,
            "error": row.error, "retry_after": RETRY_AFTER if row.status in ACTIVE else 0}


@router.post("", status_code=202)
def create_job(body: JobBody, response: Response, user=Depends(principal), db=Depends(get_db)):
    capture_access(db, user)
    try:
        data = base64.b64decode(body.image_base64, validate=True)
        inspect_image(data)
    except (ValueError, TypeError):
        raise HTTPException(422, "Choose a clear PNG or JPEG photo up to 4 MB") from None
    fingerprint = hashlib.sha256(data).hexdigest()
    admission_lock(db)
    existing = db.scalar(select(OcrJob).where(OcrJob.user_id == user.id,
                                             OcrJob.operation_id == body.operation_id))
    if existing:
        if existing.image_hash != fingerprint or existing.stage != body.stage:
            raise HTTPException(409, "This scan identifier was already used for another photo")
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["Retry-After"] = str(RETRY_AFTER)
        result = view(existing)
        db.commit()
        return result
    ensure_admission(db, user.id)
    row = OcrJob(user_id=user.id, operation_id=body.operation_id, stage=body.stage,
                 image_hash=fingerprint, image_encrypted=cipher.encrypt(data).decode())
    db.add(row)
    db.flush()
    result = view(row)
    db.commit()
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Retry-After"] = str(RETRY_AFTER)
    return result


@router.get("/{job_id}")
def get_job(job_id: str, response: Response, user=Depends(principal), db=Depends(get_db)):
    capture_access(db, user)
    row = db.scalar(select(OcrJob).where(OcrJob.id == job_id, OcrJob.user_id == user.id))
    if not row:
        raise HTTPException(404, "Scan not found")
    response.headers["Cache-Control"] = "private, no-store"
    if row.status in ACTIVE:
        response.headers["Retry-After"] = str(RETRY_AFTER)
    return view(row)


def claim_job():
    with DB() as db:
        try:
            admission_lock(db)
        except HTTPException:
            return None
        maintain_jobs(db)
        stamp = now()
        # Enforce the same one-job budget across API processes, not just threads.
        if (db.scalar(select(OcrJob.id).where(OcrJob.status == "PROCESSING",
                                             OcrJob.lease_until > stamp).limit(1))
                or db.scalar(select(KycCapture.id).where(KycCapture.status == "QUEUED",
                     KycCapture.ocr_lease_until > stamp).limit(1))):
            db.commit()
            return None
        row = db.scalar(select(OcrJob).where(OcrJob.status == "QUEUED", OcrJob.available_at <= stamp,
                        OcrJob.stage.in_({"DOCUMENT", "ORDER", "RECEIPT"}))
                        .order_by(OcrJob.created_at, OcrJob.id).limit(1).with_for_update(skip_locked=True))
        if not row:
            db.commit()
            return None
        try:
            capture_access(db, db.get(User, row.user_id))
        except HTTPException:
            terminal(row, "Capture access changed. Contact your administrator.", stamp)
            db.commit()
            return None
        row.status, row.error = "PROCESSING", ""
        row.attempts += 1
        row.lease_token, row.lease_until = str(uuid4()), stamp + timedelta(seconds=LEASE_SECONDS)
        claimed = {"id": row.id, "token": row.lease_token, "user_id": row.user_id,
                   "stage": row.stage, "image": row.image_encrypted, "hash": row.image_hash}
        db.commit()
        return claimed


def finish_job(claimed, extracted=None, *, error="", transient=False, busy=False):
    """Only the current unexpired lease can publish results or schedule a retry."""
    from .captures import parse_document_result, parse_order_result, parse_receipt_result
    with DB() as db:
        row = db.scalar(select(OcrJob).where(OcrJob.id == claimed["id"],
            OcrJob.status == "PROCESSING", OcrJob.lease_token == claimed["token"],
            OcrJob.lease_until > now()).with_for_update())
        if not row:
            return False
        try:
            capture_access(db, db.get(User, row.user_id))
        except HTTPException:
            terminal(row, "Capture access changed. Contact your administrator.")
            db.commit()
            return True
        if error:
            if transient and (busy or row.attempts < MAX_ATTEMPTS) and row.created_at > now() - MAX_QUEUE_AGE:
                row.status, row.error = "QUEUED", ""
                row.lease_token = row.lease_until = None
                if busy:
                    row.attempts = max(0, row.attempts - 1)
                row.available_at = now() + timedelta(seconds=RETRY_AFTER if busy else min(30, 2 ** row.attempts))
            else:
                terminal(row, error)
        else:
            try:
                image = base64.b64encode(cipher.decrypt(claimed["image"].encode())).decode()
                if claimed["stage"] == "DOCUMENT":
                    result = parse_document_result(extracted, image, claimed["user_id"])
                elif claimed["stage"] == "ORDER":
                    result = parse_order_result(extracted, image, claimed["user_id"], db)
                else:
                    result = parse_receipt_result(extracted, image, claimed["user_id"])
                encoded = json.dumps(result, ensure_ascii=False).encode()
                if len(encoded) > 512_000:
                    raise ValueError("Extraction result exceeds its storage bound")
                row.result_encrypted = cipher.encrypt(encoded).decode()
                row.status, row.error = "COMPLETED", ""
                row.image_encrypted = ""
                row.lease_token = row.lease_until = None
                row.finished_at = now()
            except (ValueError, TypeError, HTTPException):
                terminal(row, "The screen wasn't captured clearly. Take a clearer photo.")
        db.commit()
        return True


def process_ocr_job():
    claimed = claim_job()
    if not claimed:
        return False
    try:
        data = cipher.decrypt(claimed["image"].encode())
        if hashlib.sha256(data).hexdigest() != claimed["hash"]:
            raise ValueError("Stored image integrity mismatch")
        extracted = extractor.extract(data)
    except OcrBusy:
        return finish_job(claimed, error="Scanner is busy. Retry shortly.", transient=True, busy=True)
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError, OSError):
        return finish_job(claimed, error="The scan timed out. Capture the screen again.", transient=True)
    except Exception:
        return finish_job(claimed, error="No readable screen found. Take a clearer photo.")
    return finish_job(claimed, extracted)


def extract_compatibility(data, user_id):
    """Old APKs share the database resource lease without holding a connection.

    The image is kept only in this request. A crashed synchronous request cannot
    be recovered as a durable photo job; its reservation expires instead.
    """
    inspect_image(data)
    identifier, token = str(uuid4()), str(uuid4())
    with DB() as db:
        capture_access(db, db.get(User, user_id))
        try:
            admission_lock(db)
        except HTTPException:
            raise OcrBusy() from None
        maintain_jobs(db)
        if (db.scalar(select(OcrJob.id).where(OcrJob.status.in_(ACTIVE)).limit(1))
                or db.scalar(select(KycCapture.id).where(KycCapture.status == "QUEUED").limit(1))):
            db.commit()
            raise OcrBusy()
        stamp = now()
        db.add(OcrJob(id=identifier, user_id=user_id, operation_id=str(uuid4()),
                     stage="SYNC", image_hash=hashlib.sha256(data).hexdigest(), image_encrypted="",
                     status="PROCESSING", attempts=1, lease_token=token,
                     lease_until=stamp + timedelta(seconds=LEASE_SECONDS)))
        db.commit()
    try:
        result = extractor.extract(data)
        with DB() as db:
            row = db.scalar(select(OcrJob).where(OcrJob.id == identifier, OcrJob.lease_token == token,
                            OcrJob.status == "PROCESSING", OcrJob.lease_until > now()))
            if not row:
                raise OcrBusy()
            capture_access(db, db.get(User, user_id))
        return result
    finally:
        with DB() as db:
            db.execute(delete(OcrJob).where(OcrJob.id == identifier, OcrJob.lease_token == token))
            db.commit()
