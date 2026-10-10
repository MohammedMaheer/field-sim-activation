"""Notification reads honor effective grants, including call-only accounts."""
import pytest
from sqlalchemy import delete, select

from test_client_scope import client, database, login  # noqa: F401
from app.db import DB, Notification, NotificationRead, Permission, User


@pytest.fixture
def restrict_grants(database):  # noqa: F811
    """Restore shared role grants after each isolated authorization regression."""
    saved = {}

    def restrict(account, retained):
        with DB() as db:
            person = db.scalar(select(User).where(User.email == account + "@relay.demo"))
            saved.setdefault(person.role_id, list(db.scalars(
                select(Permission.name).where(Permission.role_id == person.role_id))))
            db.execute(delete(Permission).where(Permission.role_id == person.role_id,
                                               Permission.name.not_in(retained)))
            db.commit()
            return person.id

    yield restrict
    with DB() as db:
        for role_id, names in saved.items():
            db.execute(delete(Permission).where(Permission.role_id == role_id))
            db.add_all(Permission(role_id=role_id, name=name) for name in names)
        db.commit()


@pytest.mark.parametrize("account,retained", [
    ("leader", ["task.write"]),
    ("cluster", ["task.write"]),
    ("salesmanager", ["report.read"]),
    ("tele", ["call.tele.write"]),
    ("welcome", ["call.welcome.write"]),
])
def test_notifications_require_a_read_grant(client, restrict_grants, account, retained):  # noqa: F811
    login(client, account)
    user_id = restrict_grants(account, retained)
    # Non-read grants keep the account authenticated. This is an explicit
    # notification authorization rejection, not principal's zero-grant 401.
    assert client.get("/api/auth/me").status_code == 200
    with DB() as db:
        notice = Notification(user_id=user_id, message="Private workspace activity")
        db.add(notice)
        db.commit()
        notice_id = notice.id
    try:
        response = client.get("/api/notifications")
        assert response.status_code == 403, response.text
        assert client.post("/api/notifications/read", json={"ids": []}).status_code == 403
        assert client.post("/api/notifications/read", json={"ids": ["notice:" + notice_id]}).status_code == 403
        assert client.post("/api/notifications/read", json={"ids": ["notice:" + notice_id], "read": False}).status_code == 403
        with DB() as db:
            assert db.get(NotificationRead, (user_id, "notice:" + notice_id)) is None
    finally:
        with DB() as db:
            db.execute(delete(Notification).where(Notification.id == notice_id))
            db.commit()


@pytest.mark.parametrize("account,grant", [("tele", "call.tele.read"), ("welcome", "call.welcome.read")])
def test_call_read_grants_allow_notification_reads(client, restrict_grants, account, grant):  # noqa: F811
    login(client, account)
    user_id = restrict_grants(account, [grant])
    with DB() as db:
        notice = Notification(user_id=user_id, message="Call queue update")
        db.add(notice)
        db.commit()
        notice_id = notice.id
    key = "notice:" + notice_id
    try:
        response = client.get("/api/notifications")
        assert response.status_code == 200, response.text
        inbox = response.json()
        assert inbox["categories"] == ["Calls", "Workspace"]
        assert key in {row["id"] for row in inbox["items"]}
        assert client.post("/api/notifications/read", json={"ids": [key]}).status_code == 200
        assert next(row for row in client.get("/api/notifications").json()["items"] if row["id"] == key)["read"]
    finally:
        with DB() as db:
            db.execute(delete(NotificationRead).where(NotificationRead.user_id == user_id,
                                                     NotificationRead.event_key == key))
            db.execute(delete(Notification).where(Notification.id == notice_id))
            db.commit()


def test_zero_grant_account_is_rejected_by_principal(client, restrict_grants):  # noqa: F811
    login(client, "tele")
    restrict_grants("tele", [])
    assert client.get("/api/notifications").status_code == 401
    assert client.post("/api/notifications/read", json={"ids": []}).status_code == 401
