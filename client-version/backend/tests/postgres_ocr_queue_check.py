"""Durable OCR races against an explicitly isolated PostgreSQL database.

Run with its API worker stopped so the assertions own the queue. The deployed
database is deliberately rejected. Only this runner's synthetic jobs are removed.
"""
import base64
import io
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from uuid import uuid4
from unittest.mock import patch

from fastapi import HTTPException, Response
from PIL import Image
from sqlalchemy import delete, func, select
from sqlalchemy.engine import make_url

qa_name = os.environ.get("RELAY_QA_DATABASE", "")
if not re.fullmatch(r"relay_(?:ocr\d+_qa|rigorous_qa_\d+)", qa_name):
    raise RuntimeError("OCR contention tests require an explicitly isolated QA database")
source = make_url(os.environ["DATABASE_URL"])
if source.database != qa_name:
    raise RuntimeError("DATABASE_URL must already point to the explicitly isolated QA database")

from app import captures, ocr_queue as jobs  # noqa: E402
from app.db import Agent, DB, KycCapture, Role, User, engine, now  # noqa: E402

if engine.dialect.name != "postgresql":
    raise RuntimeError("Durable OCR contention requires PostgreSQL")


def main():
    with DB() as db:
        actors = list(db.scalars(select(User).join(Role).join(Agent, Agent.user_id == User.id)
            .where(Role.name == "Field Agent", Agent.employment_status == "ACTIVE").order_by(User.id).limit(2)))
        assert len(actors) == 2
        actors = [person.id for person in actors]
        assert not db.scalar(select(func.count()).select_from(jobs.OcrJob).where(jobs.OcrJob.status.in_(jobs.ACTIVE))), "Drain the isolated stage queue before this check"
        assert not db.scalar(select(func.count()).select_from(KycCapture).where(KycCapture.status == "QUEUED")), "Drain the isolated legacy queue before this check"
    operations = []
    image = io.BytesIO()
    Image.new("RGB", (200, 100), "white").save(image, format="PNG")
    encoded = base64.b64encode(image.getvalue()).decode()

    def create(owner, operation=None):
        operation = operation or str(uuid4())
        operations.append(operation)
        with DB() as db:
            return jobs.create_job(jobs.JobBody(operation_id=operation, stage="DOCUMENT", image_base64=encoded),
                                   Response(), db.get(User, owner), db)

    def remove_owned():
        with DB() as db:
            db.execute(delete(jobs.OcrJob).where(jobs.OcrJob.operation_id.in_(operations)))
            db.commit()

    def concurrent(callbacks):
        ready = Barrier(len(callbacks))

        def run(callback):
            ready.wait(5)
            try:
                return callback()
            except HTTPException as exc:
                return exc.status_code

        with ThreadPoolExecutor(max_workers=len(callbacks)) as executor:
            return [future.result(15) for future in [executor.submit(run, callback) for callback in callbacks]]

    try:
        # Cross-user simultaneous admission at one remaining global slot.
        with patch.object(jobs, "QUEUE_LIMIT", 2):
            create(actors[0])
            results = concurrent([lambda: create(actors[0]), lambda: create(actors[1])])
            assert sum(isinstance(result, dict) for result in results) == 1, results
            assert results.count(429) == 1, results
            with DB() as db:
                assert db.scalar(select(func.count()).select_from(jobs.OcrJob).where(jobs.OcrJob.status.in_(jobs.ACTIVE))) == 2
        print("PASS global queue count-and-insert is serialized across concurrent owners")
        remove_owned()

        operation = str(uuid4())
        results = concurrent([lambda: create(actors[0], operation), lambda: create(actors[0], operation)])
        accepted = next(result for result in results if isinstance(result, dict))
        replay = create(actors[0], operation)
        assert replay["id"] == accepted["id"]
        with DB() as db:
            assert db.scalar(select(func.count()).select_from(jobs.OcrJob).where(jobs.OcrJob.operation_id == operation)) == 1
            foreign = db.get(User, actors[1])
            try:
                jobs.get_job(accepted["id"], Response(), foreign, db)
            except HTTPException as exc:
                assert exc.status_code == 404
            else:
                raise AssertionError("A foreign owner could read the scan")
        print("PASS exact-operation retries create one job and disclose nothing to another owner")

        claims = concurrent([jobs.claim_job, jobs.claim_job])
        claim = next(value for value in claims if isinstance(value, dict))
        assert sum(isinstance(value, dict) for value in claims) == 1
        assert engine.pool.checkedout() == 0
        print("PASS SKIP LOCKED claims release all DB checkouts and only one worker owns OCR")

        with DB() as db:
            db.get(jobs.OcrJob, claim["id"]).lease_until = now() - timedelta(seconds=1)
            db.commit()
        replacement = jobs.claim_job()
        assert replacement and replacement["token"] != claim["token"]
        with patch.object(captures, "parse_document_result", lambda *_: {"name": "Synthetic Queue Customer"}):
            assert not jobs.finish_job(claim, {"lines": []})
            assert jobs.finish_job(replacement, {"lines": []})
            assert not jobs.finish_job(replacement, {"lines": []})
        with DB() as db:
            stored = db.get(jobs.OcrJob, claim["id"])
            assert stored.status == "COMPLETED" and stored.attempts == 2 and stored.image_encrypted == ""
        print("PASS expired leases recover and stale or duplicate completion cannot overwrite results")

        remove_owned()
        job = create(actors[0])
        claim = jobs.claim_job()
        for attempt in range(jobs.MAX_ATTEMPTS):
            with DB() as db:
                db.get(jobs.OcrJob, job["id"]).lease_until = now() - timedelta(seconds=1)
                db.commit()
            claim = jobs.claim_job()
            if attempt < jobs.MAX_ATTEMPTS - 1:
                assert claim
            else:
                assert claim is None
        with DB() as db:
            stored = db.get(jobs.OcrJob, job["id"])
            assert stored.status == "FAILED" and stored.image_encrypted == stored.result_encrypted == ""
        print("PASS repeated crashed workers stop after the bounded retry budget and remove temporary photos")
    finally:
        remove_owned()


if __name__ == "__main__":
    main()
