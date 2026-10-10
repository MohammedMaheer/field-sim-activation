"""Durable SR alert delivery. SMTP acceptance is not inbox delivery."""
import os
import re
import smtplib
import ssl
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, select, or_
from sqlalchemy.orm import Mapped, mapped_column

from .db import Entity, DB, User, Agent, SalesRecord, now
from .security import cipher, permissions


class EmailOutbox(Entity):
    __tablename__ = "email_outbox"
    __table_args__ = (UniqueConstraint("event_key", "user_id", name="uq_email_event_recipient"),)
    event_key: Mapped[str] = mapped_column(String(180))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    sale_id: Mapped[str] = mapped_column(ForeignKey("sales_records.id"), index=True)
    recipient_encrypted: Mapped[str] = mapped_column(Text)
    subject: Mapped[str] = mapped_column(String(180))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="QUEUED", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str] = mapped_column(String(180), default="")


def smtp_ready():
    return os.getenv("SMTP_ENABLED", "false").casefold() == "true" and bool(os.getenv("SMTP_HOST") and os.getenv("SMTP_FROM"))


def queue_sr_email(db, sale, user_id, batch_id, status, reason, *, evaluation=False):
    person = db.get(User, user_id)
    if not person:
        return
    label = "SR mismatch" if status == "MISMATCH" else "Pending SR verification"
    base = os.getenv("WEB_ORIGIN", "").rstrip("/")
    link = f"{base}/sales?selected={sale.id}"
    db.add(EmailOutbox(event_key=f"sr:{batch_id}:{sale.id}", user_id=user_id, sale_id=sale.id,
                       recipient_encrypted=cipher.encrypt(person.email.encode()).decode(),
                       status="SKIPPED" if evaluation else "QUEUED",
                       last_error="Synthetic evaluation alert; external delivery disabled" if evaluation else "",
                       subject=f"Relay | {label}",
                       body=f"{label}\n{reason}\nSale reference: {sale.request_id or sale.id}\nReview the sale: {link}\nActivation status: {sale.status}\n"))


def smtp_send(recipient, subject, body, event_key):
    sender = os.environ["SMTP_FROM"]
    if any("\n" in value or "\r" in value for value in (sender, recipient, subject)):
        raise ValueError("Invalid mail header")
    message = EmailMessage()
    message["From"] = formataddr((os.getenv("SMTP_FROM_NAME", "Relay"), sender))
    message["To"] = recipient
    message["Subject"] = subject
    message["Message-ID"] = f"<{event_key.replace(':', '.')}@relay-notifications>"
    message.set_content(body)
    host, port = os.environ["SMTP_HOST"], int(os.getenv("SMTP_PORT", "587"))
    secure = os.getenv("SMTP_SECURITY", "starttls").casefold()
    if secure not in {"starttls", "ssl", "plain"}:
        raise ValueError("Invalid SMTP security setting")
    if secure == "plain" and host not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("Remote SMTP requires TLS")
    context = ssl.create_default_context()
    connection = smtplib.SMTP_SSL(host, port, timeout=15, context=context) if secure == "ssl" else smtplib.SMTP(host, port, timeout=15)
    with connection as server:
        if secure == "starttls":
            server.starttls(context=context)
        if os.getenv("SMTP_USERNAME"):
            server.login(os.environ["SMTP_USERNAME"], os.environ["SMTP_PASSWORD"])
        refused = server.send_message(message)
        if refused:
            raise smtplib.SMTPRecipientsRefused(refused)


def deliver_pending(limit=10):
    if not smtp_ready():
        return 0
    delivered = 0
    for _ in range(limit):
        with DB() as db:
            item = db.scalar(select(EmailOutbox).where(
                or_(EmailOutbox.status.in_(["QUEUED", "RETRY"]),
                    (EmailOutbox.status == "SENDING") & (EmailOutbox.next_attempt_at <= now())),
                EmailOutbox.next_attempt_at <= now(), EmailOutbox.attempts < 5,
            ).order_by(EmailOutbox.created_at).with_for_update(skip_locked=True).limit(1))
            if not item:
                break
            person, sale = db.get(User, item.user_id), db.get(SalesRecord, item.sale_id)
            agent = db.get(Agent, sale.agent_id) if sale else None
            from .sales_management import permitted
            from .sr_verification import sale_state
            eligible = person and sale and agent and item.user_id in {agent.user_id, sale.leader_id} and permissions(db, person) and permitted(db, person, sale)
            if eligible and item.user_id == agent.user_id and agent.employment_status != "ACTIVE":
                eligible = False
            if not eligible or sale_state(db, sale)["status"] == "MATCHED":
                item.status, item.last_error = "SKIPPED", "Alert resolved or account access changed"
                db.commit()
                continue
            recipient = cipher.decrypt(item.recipient_encrypted.encode()).decode()
            if recipient.casefold() != person.email.casefold():
                item.status, item.last_error = "SKIPPED", "Account email changed; original recipient is no longer valid"
                db.commit()
                continue
            if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", recipient) or recipient.casefold().endswith((".demo", ".invalid", ".test", ".example")):
                item.status, item.last_error = "SKIPPED", "Evaluation or invalid email address"
                db.commit()
                continue
            item.status, item.attempts, item.next_attempt_at = "SENDING", item.attempts + 1, now() + timedelta(minutes=5)
            identifier, subject, body, key = item.id, item.subject, item.body, item.event_key
            db.commit()
        try:
            smtp_send(recipient, subject, body, key)
        except Exception as error:
            with DB() as db:
                item = db.get(EmailOutbox, identifier)
                item.status = "FAILED" if item.attempts >= 5 else "RETRY"
                item.next_attempt_at = now() + timedelta(minutes=min(60, 2 ** item.attempts))
                item.last_error = f"SMTP failed ({type(error).__name__}); check mail configuration"
                db.commit()
        else:
            with DB() as db:
                item = db.get(EmailOutbox, identifier)
                item.status, item.sent_at, item.last_error = "SENT", now(), ""
                db.commit()
            delivered += 1
    return delivered
