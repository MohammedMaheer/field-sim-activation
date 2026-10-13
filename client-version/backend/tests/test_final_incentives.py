import base64
from uuid import uuid4
from datetime import timedelta
import pytest
from sqlalchemy import select, delete, event
from test_client_scope import client, database, login  # noqa: F401
from app.db import DB, User, Agent, business_date, engine
from app.final_incentives import FinalIncentive


@pytest.fixture(autouse=True)
def clean(database):
    with DB() as db:
        existing = set(db.scalars(select(FinalIncentive.id)))
    yield
    with DB() as db:
        db.execute(delete(FinalIncentive).where(FinalIncentive.id.not_in(existing)))
        db.commit()


def file(rows):
    text = "user_email,earned_on,amount,reference,note\n" + "".join(
        ",".join(map(str, row)) + "\n" for row in rows
    )
    return {
        "filename": "approved-final.csv",
        "content_base64": base64.b64encode(text.encode()).decode(),
    }


def test_final_amount_import_is_previewable_replay_safe_and_scoped(client):
    login(client)
    today = business_date().isoformat()
    ref = str(uuid4())
    body = file(
        [
            ["agent1@relay.demo", today, "125.25", ref, "Approved amount"],
            ["leader@relay.demo", today, "60", ref, "Approved leader amount"],
        ]
    )
    preview = client.post("/api/incentives/final/import", json=body)
    assert preview.status_code == 200 and preview.json()["new_rows"] == 2
    with DB() as db:
        assert db.scalar(select(FinalIncentive.id)) is None
    applied = client.post("/api/incentives/final/import", json={**body, "apply": True})
    assert applied.status_code == 200 and applied.json()["count"] == 2
    assert (
        client.post("/api/incentives/final/import", json={**body, "apply": True}).json()["count"]
        == 0
    )
    login(client, "agent1")
    assert client.get("/api/dashboard").json()["final_incentive_total"] == "125.25"
    mine = client.get("/api/incentives/final").json()
    assert (
        len(mine) == 1
        and mine[0]["user_email"] == "agent1@relay.demo"
        and mine[0]["amount"] == "125.25"
    )
    assert client.post("/api/incentives/final/import", json=body).status_code == 403
    assert client.get("/api/incentives/final/template").status_code == 403
    login(client, "leader")
    assert client.get("/api/dashboard").json()["final_incentive_total"] == "60.00"
    assert {row["user_email"] for row in client.get("/api/incentives/final").json()} == {
        "leader@relay.demo"
    }
    login(client)
    assert len(client.get("/api/incentives/final").json()) == 2
    for format in ("xlsx", "csv", "pdf"):
        response = client.get("/api/incentives/final/export?format=" + format)
        assert response.status_code == 200 and response.content


@pytest.mark.parametrize(
    "index,bad",
    [
        (0, "missing@relay.demo"),
        (1, "invalid"),
        (1, (business_date() + timedelta(days=1)).isoformat()),
        (2, "=1+1"),
        (2, "nan"),
        (2, "12.345"),
        (2, "-5"),
        (3, "=formula"),
    ],
)
def test_invalid_file_is_atomic(client, index, bad):
    login(client)
    row = [
        "agent1@relay.demo",
        business_date().isoformat(),
        "100",
        "Final " + str(uuid4()),
        "Approved",
    ]
    other = row.copy()
    other[index] = bad
    result = client.post("/api/incentives/final/import", json={**file([row, other]), "apply": True})
    assert result.status_code == 422, result.text
    with DB() as db:
        assert db.scalar(select(FinalIncentive.id)) is None


def test_conflicting_amount_and_duplicate_file_rows_do_not_double_record(client):
    login(client)
    row = ["agent1@relay.demo", business_date().isoformat(), "100", str(uuid4()), "Approved"]
    assert (
        client.post(
            "/api/incentives/final/import", json={**file([row, row]), "apply": True}
        ).status_code
        == 422
    )
    assert (
        client.post("/api/incentives/final/import", json={**file([row]), "apply": True}).status_code
        == 200
    )
    row[2] = "120"
    assert (
        client.post("/api/incentives/final/import", json={**file([row]), "apply": True}).status_code
        == 409
    )
    assert (
        client.get("/api/incentives/final?from_date=2026-10-13&to_date=2026-10-01").status_code
        == 422
    )


def test_saved_branch_and_leader_remain_on_imported_record_after_transfer(client):
    login(client)
    row = ["agent1@relay.demo", business_date().isoformat(), "100", str(uuid4()), "Approved"]
    client.post("/api/incentives/final/import", json={**file([row]), "apply": True})
    original = client.get("/api/incentives/final").json()[0]
    with DB() as db:
        agent = db.scalar(
            select(Agent)
            .join(User, User.id == Agent.user_id)
            .where(User.email == "agent1@relay.demo")
        )
        old = (agent.outlet_id, agent.leader_id)
        other = db.scalar(select(Agent).where(Agent.outlet_id != agent.outlet_id))
        agent.outlet_id, agent.leader_id = other.outlet_id, other.leader_id
        db.commit()
        agent_id = agent.id
    try:
        saved = client.get("/api/incentives/final").json()[0]
        assert (
            saved["branch_id"] == original["branch_id"]
            and saved["leader_id"] == original["leader_id"]
        )
        assert (
            client.get("/api/incentives/final?branch_id=" + original["branch_id"]).json()[0]["id"]
            == original["id"]
        )
    finally:
        with DB() as db:
            agent = db.get(Agent, agent_id)
            agent.outlet_id, agent.leader_id = old
            db.commit()


def test_final_amount_listing_and_export_reads_do_not_grow_per_record(client):
    login(client)
    today = business_date().isoformat()
    unique = str(uuid4())

    def imported_rows(first, last):
        rows = [
            ["agent1@relay.demo", today, "10.25", f"{unique}-{number}", "Approved"]
            for number in range(first, last)
        ]
        result = client.post("/api/incentives/final/import", json={**file(rows), "apply": True})
        assert result.status_code == 200, result.text

    def counted_get(path):
        reads = []

        def observe(connection, cursor, statement, parameters, context, executemany):
            if statement.lstrip().upper().startswith("SELECT"):
                reads.append(statement)

        event.listen(engine, "before_cursor_execute", observe)
        try:
            response = client.get(path)
        finally:
            event.remove(engine, "before_cursor_execute", observe)
        assert response.status_code == 200, response.text
        return response, len(reads)

    imported_rows(0, 1)
    single, single_reads = counted_get("/api/incentives/final")
    imported_rows(1, 51)
    many, many_reads = counted_get("/api/incentives/final")
    assert len(single.json()) == 1 and len(many.json()) == 51
    assert all(
        row["name"] == single.json()[0]["name"]
        and row["branch"] == single.json()[0]["branch"]
        and row["team_leader"] == single.json()[0]["team_leader"]
        and row["amount"] == "10.25"
        for row in many.json()
    )
    assert many_reads <= single_reads + 1
    assert many_reads <= 16, f"Listing made {many_reads} database reads"
    exported, export_reads = counted_get("/api/incentives/final/export?format=csv")
    assert unique in exported.text
    assert export_reads <= many_reads + 3
