"""A scoped activity inbox. Reading a notification never approves its record."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from .db import Notification, NotificationRead, KycCapture, SupportTicket, Role, get_db, now
from .security import principal, permissions, visible_agents

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])


def feed(db, user):
    granted = permissions(db, user)
    role = db.get(Role, user.role_id).name
    agents = visible_agents(db, user)
    result = []

    def add(key, category, title, message, at, web, mobile, attention=False):
        result.append(dict(id=key, category=category, title=title, message=message,
                           created_at=at, web_path=web, mobile_path=mobile, attention=attention))

    if granted & {"activation.write", "ekyc.write", "compliance.write"}:
        rows = db.scalars(select(KycCapture).where(KycCapture.agent_id.in_(agents))
                          .order_by(KycCapture.updated_at.desc()).limit(150))
        labels = {"VERIFIED": "Confirmed by backend", "REJECTED": "Correction required",
                  "SUBMITTED": "Awaiting backend review", "EXTRACTED": "Ready to review", "VALIDATED": "Ready to submit",
                  "OCR_FAILED": "Capture needs attention"}
        for row in rows:
            if row.status not in labels:
                continue
            add(f"capture:{row.id}:{row.version}:{row.status}", "Transactions", labels[row.status],
                row.source_reference or "Transaction", row.updated_at,
                f"/kyc-capture?capture={row.id}", f"/transaction/{row.id}",
                row.status in {"REJECTED", "OCR_FAILED"} or (row.status == "SUBMITTED" and "compliance.write" in granted))

    # Saved assignment scopes are authoritative for leader/manager sale updates.
    if role in {"Team Leader", "Sales Manager", "Field Agent", "Administrator", "Operations Manager", "Compliance Officer"}:
        from .sales_management import scoped
        from .db import SalesRecord
        for row in db.scalars(scoped(db, user, SalesRecord)
                              .order_by(SalesRecord.status_updated_at.desc()).limit(150)):
            if role in {"Team Leader", "Sales Manager"} and row.status != "CLOSED":
                continue
            if role not in {"Team Leader", "Sales Manager"} and row.capture_id:
                continue
            add(f"sale:{row.id}:{row.status_updated_at.isoformat()}:{row.status}", "Transactions", {"CLOSED":"Confirmed by backend", "IN_PROGRESS":"Sale awaiting review", "CANCELLED":"Sale cancelled"}.get(row.status, "Sale updated"),
                row.request_id or "Sale confirmed", row.status_updated_at,
                f"/sales?selected={row.id}", f"/sales-management?selected={row.id}")
        # No duplicate current-agent capture notifications for leaders.
        if role in {"Team Leader", "Sales Manager"}:
            result = [r for r in result if not r["id"].startswith("capture:")]

    if granted & {"compliance.write", "call.tele.read", "call.welcome.read"}:
        from .sales_management import call_tasks
        for row in call_tasks(user, db):
            if row["status"] not in {"PENDING", "FAILED"}:
                continue
            add(f"call:{row['id']}:{row['updated_at'].isoformat()}", "Calls",
                "Tele-verification" if row["stage"] == "TELE_VERIFICATION" else "Welcome call",
                f"{row.get('customer_name', 'Customer')} · {row['status'].replace('_', ' ').title()}",
                row["updated_at"], f"/call-work?selected={row['id']}", f"/call-work?selected={row['id']}", True)

    if role in {"Administrator", "Operations Manager", "Inventory Manager", "Field Agent", "Team Leader", "Sales Manager", "Branch Manager"}:
        from .field_assets import requests, summary_rows
        from .db import StockThreshold
        thresholds = {(row.branch_id, row.category): row.created_at for row in db.scalars(select(StockThreshold))}
        for row in summary_rows(db, user):
            if row["low_stock"]:
                add(f"low:{row['branch_id']}:{row['category']}:{row['available']}:{row['minimum']}", "Stock", "Low stock",
                    f"{row['branch']} · {row['category']} · {row['available']} available (minimum {row['minimum']})",
                    thresholds[(row["branch_id"], row["category"])], "/equipment?tab=report", "/assets", True)
        for row in requests(user, db):
            at = row.get("responded_at") or row["created_at"]
            add(f"stock:{row['id']}:{row['status']}", "Stock", f"Stock request · {row['status'].title()}",
                f"{row['quantity']} {row['category'].replace('_', ' ').lower()} · {row['agent']}", at,
                "/equipment?tab=requests", "/assets", row["urgency"] == "URGENT" and row["status"] in {"REQUESTED", "APPROVED"})

    if role not in {"Tele Verification Officer", "Welcome Call Officer", "Sales Manager", "Compliance Officer"} and "read" in granted:
        for row in db.scalars(select(SupportTicket).where(SupportTicket.agent_id.in_(agents))
                              .order_by(SupportTicket.created_at.desc()).limit(150)):
            add(f"support:{row.id}:{row.status}", "Support", row.subject,
                row.status.replace('_', ' ').title(), row.created_at, f"/support?selected={row.id}", "/support",
                row.status == "OPEN" and "support.write" in granted)

    for row in db.scalars(select(Notification).where(Notification.user_id == user.id)
                          .order_by(Notification.created_at.desc()).limit(100)):
        # Transaction confirmations are represented above with scoped record links.
        if row.message.startswith("Transaction confirmed by backend:"):
            continue
        stock = "SIM transaction" in row.message
        if stock and "inventory.write" not in granted:
            continue
        add(f"notice:{row.id}", "Stock" if stock else "Workspace", "SIM activity" if stock else "Workspace update",
            row.message, row.created_at, "/inventory" if stock else "/", "/stock" if stock else "/")
    result.sort(key=lambda item: (item["created_at"], item["id"]), reverse=True)
    return result[:500]


@router.get("")
def inbox(user=Depends(principal), db=Depends(get_db)):
    rows = feed(db, user)
    reads = set(db.scalars(select(NotificationRead.event_key).where(NotificationRead.user_id == user.id)))
    for row in rows:
        row["read"] = row["id"] in reads
    return {"items": rows, "unread": sum(not row["read"] for row in rows)}


class ReadBody(BaseModel):
    ids: list[str] = Field(max_length=500)
    read: bool = True


@router.post("/read")
def mark_read(body: ReadBody, user=Depends(principal), db=Depends(get_db)):
    allowed = {row["id"] for row in feed(db, user)}
    if not set(body.ids) <= allowed:
        raise HTTPException(404, "Notification is no longer available")
    for key in set(body.ids):
        if body.read:
            insert = pg_insert if db.bind.dialect.name == "postgresql" else sqlite_insert
            db.execute(insert(NotificationRead).values(user_id=user.id, event_key=key, read_at=now())
                       .on_conflict_do_nothing(index_elements=["user_id", "event_key"]))
        else:
            row = db.get(NotificationRead, (user.id, key))
            if row:
                db.delete(row)
    db.commit()
    return {"updated": len(set(body.ids))}
