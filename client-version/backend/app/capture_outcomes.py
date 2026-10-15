"""Serialize draft closure with draft saving and sale submission.

The creator lock is shared by all intake terminal actions. The durable outcome
also protects delayed requests and retries after the originating draft is gone.
"""
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .db import CaptureTransactionOutcome, User


def creator_lock(db, user):
    db.scalar(select(User).where(User.id == user.id).with_for_update())


def transaction_outcome(db, user, transaction_id):
    if not transaction_id:
        return None
    return db.scalar(select(CaptureTransactionOutcome).where(
        CaptureTransactionOutcome.transaction_id == transaction_id,
    ))


def ensure_open(db, user, transaction_id, agent_id=None):
    if not transaction_id:
        return None
    outcome = transaction_outcome(db, user, transaction_id)
    if outcome and outcome.creator_id != user.id:
        raise HTTPException(404, "Transaction not found")
    if not outcome:
        try:
            with db.begin_nested():
                outcome = CaptureTransactionOutcome(creator_id=user.id, transaction_id=transaction_id,
                    agent_id=agent_id, status="ACTIVE")
                db.add(outcome)
                db.flush()
        except IntegrityError:
            # A different account can race the first request for an identifier;
            # the unique key is authoritative without leaking the other account.
            outcome = transaction_outcome(db, user, transaction_id)
            if not outcome or outcome.creator_id != user.id:
                raise HTTPException(404, "Transaction not found") from None
    if outcome.status != "ACTIVE":
        message = ("This customer backed out and the transaction was closed. Start a new transaction."
                   if outcome.status == "CUSTOMER_BACKED_OUT"
                   else "This transaction was already submitted. Open its recorded sale instead.")
        raise HTTPException(409, message)
    if agent_id:
        if outcome.agent_id and outcome.agent_id != agent_id:
            raise HTTPException(409, "This transaction belongs to another sales agent. Start a new transaction.")
        outcome.agent_id = agent_id
    return outcome


def mark_submitted(db, user, agent_id, transaction_id, capture_id):
    if transaction_id:
        outcome = ensure_open(db, user, transaction_id, agent_id)
        outcome.status, outcome.capture_id = "SUBMITTED", capture_id
        db.flush()
