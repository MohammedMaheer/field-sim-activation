"""Connected rules for backend calls, monthly SR, imports and role separation."""

# ruff: noqa: F401,F811
import base64
import csv
import io
from datetime import datetime
from uuid import uuid4
import pytest
from sqlalchemy import select
from test_client_scope import client, database, login
from test_capture_identity import new_records, sale_body, submit
from test_sr_reconciliation import make_sale
from app.db import Agent, Branch, DB, FieldAsset, Role, SalesRecord, User
from app.sr_verification import SrCheck


def upload(rows, **extra):
    stream = io.StringIO()
    csv.writer(stream).writerows(rows)
    return {
        "filename": "import.csv",
        "content_base64": base64.b64encode(stream.getvalue().encode()).decode(),
        **extra,
    }


@pytest.mark.parametrize("older_submission", [False, True])
def test_new_backend_review_requires_customer_active_plan_confirmation(client, older_submission):
    body = sale_body(client)
    capture = submit(client, body).json()
    if older_submission:
        from app import captures
        from app.db import KycCapture
        with DB() as db:
            row=db.get(KycCapture,capture['id']);data=captures.payload(row)
            data.pop('customer_call_required',None);captures.store(row,data);db.commit()
    login(client)
    endpoint = f"/api/kyc-captures/{capture['id']}/review"
    decision = {
        "version": capture["version"],
        "outcome": "VERIFIED",
        "reason": "Compared original customer and order evidence",
    }
    for outcome in (None, "NOT_ACTIVE", "NO_ANSWER", "WRONG_NUMBER"):
        result = client.post(
            endpoint,
            json={
                **decision,
                "customer_call_outcome": outcome,
                "customer_call_note": "Customer call recorded",
            },
        )
        assert result.status_code == 422, result.text
        assert client.get(endpoint.rsplit("/", 1)[0]).json()["status"] == "SUBMITTED"
    result = client.post(
        endpoint,
        json={
            **decision,
            "customer_call_outcome": "ACTIVE_CONFIRMED",
            "customer_call_note": "Customer confirmed the plan is active",
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["review"]["customer_call"]["phone"] == body["intake"]["msisdn"]
    assert result.json()["backend_review_status"] == "VERIFIED"
    assert client.post(endpoint, json=decision).status_code == 409


def test_call_attempt_keeps_review_pending_and_is_independent_versioned(client):
    body = sale_body(client)
    capture = submit(client, body).json()
    endpoint = f"/api/kyc-captures/{capture['id']}/customer-call"
    call = {
        "version": capture["version"],
        "outcome": "NO_ANSWER",
        "note": "Customer did not answer; retry planned",
    }
    assert client.post(endpoint, json=call).status_code == 403
    login(client, "tele")
    assert client.post(endpoint, json=call).status_code == 403
    login(client)
    result = client.post(endpoint, json=call)
    assert result.status_code == 200, result.text
    assert result.json()["status"] == "SUBMITTED"
    assert len(result.json()["customer_calls"]) == 1
    assert result.json()["customer_calls"][0]["outcome"] == "NO_ANSWER"
    assert client.post(endpoint, json=call).status_code == 409
    login(client, "leader")
    assert (
        client.post(endpoint, json={**call, "version": result.json()["version"]}).status_code == 403
    )


def test_activations_include_current_sales_and_keep_saved_scope(client):
    body = sale_body(client)
    result = submit(client, body)
    assert result.status_code == 201, result.text
    capture = result.json()
    rows = client.get("/api/resources/activations").json()
    current = next(row for row in rows if row.get("capture_id") == capture["id"])
    assert current["source"] == "SCREENSHOT_SALE" and current["id"].startswith("sale:")
    detail = client.get("/api/activations/" + current["id"])
    assert detail.status_code == 200, detail.text
    assert detail.json()["sr_id"] == "Not recorded"
    assert len(detail.json()["events"]) == 1  # No invented SR verification timestamp.
    login(client, "agent2")
    assert client.get("/api/activations/" + current["id"]).status_code == 404
    assert not any(
        row["id"] == current["id"] for row in client.get("/api/resources/activations").json()
    )


def test_monthly_sr_covers_multiple_days_and_history_preserves_whole_range(client):
    sr1, sr2 = "MONTH-" + str(uuid4()), "MONTH-" + str(uuid4())
    first, second = make_sale(client, sr1), make_sale(client, sr2)
    with DB() as db:
        db.get(SalesRecord, second).created_at = datetime(2026, 10, 8, 8)
        db.commit()
    login(client)
    body = upload([["sr_number", "status"], [sr1, "CLOSED"], [sr2, "CANCELLED"]], period="2026-10")
    preview = client.post("/api/sales-management/sr/file", json=body)
    assert preview.status_code == 200 and not preview.json()["errors"], preview.text
    assert {row["sale_id"] for row in preview.json()["changes"]} >= {first, second}
    applied = client.post(
        "/api/sales-management/sr/file",
        json={**body, "apply": True, "preview_token": preview.json()["preview_token"]},
    )
    assert applied.status_code == 200, applied.text
    with DB() as db:
        assert (
            db.scalar(select(SrCheck).where(SrCheck.sale_id == first)).business_date == "2026-10-07"
        )
        assert (
            db.scalar(select(SrCheck).where(SrCheck.sale_id == second)).business_date
            == "2026-10-08"
        )
        assert db.get(SalesRecord, second).status == "CANCELLED"
    batch = client.get("/api/sales-management/sr/batches").json()[0]
    assert batch["report_period"] == "2026-10"
    details = client.get(f"/api/sales-management/sr/batches/{batch['id']}").json()
    assert {row["sale_id"] for row in details["changes"]} >= {first, second}
    assert client.get("/api/sales-management/sr/template?period=2026-10").status_code == 200
    assert (
        client.post(
            "/api/sales-management/sr/file", json={**body, "business_date": "2026-10-07"}
        ).status_code
        == 422
    )
    assert client.get("/api/sales-management/sr/results?period=2999-01").status_code == 422


def test_admin_daily_operations_cannot_provision_staff_or_control_roles(client):
    login(client, "ops")
    assert client.get("/api/organization/access").status_code == 403
    assert client.get("/api/organization/import/agents/template").status_code == 403
    branch = client.get("/api/resources/branches").json()[0]
    assert (
        client.post(
            "/api/organization/teams",
            json={
                "name": "Test leader",
                "email": "staff@example.test",
                "password": "private-test-password",
                "branch_id": branch["id"],
            },
        ).status_code
        == 403
    )
    assert client.get("/api/organization/import/branches/template").status_code == 200
    assert client.get("/api/inventory/bulk-template").status_code == 200
    login(client)
    directory = client.get("/api/organization/access")
    assert directory.status_code == 200
    tele = next(
        role for role in directory.json()["roles"] if role["name"] == "Tele Verification Officer"
    )
    account = {
        "name": "Test tele staff",
        "email": f"tele-{uuid4()}@example.test",
        "password": "private-test-password",
        "role_id": tele["id"],
    }
    created = client.post("/api/organization/access/accounts", json=account)
    assert created.status_code == 201, created.text
    assert client.post("/api/organization/access/accounts", json=account).status_code == 409
    assert "password" not in str(directory.json())


def test_branch_and_staff_import_order_replay_and_invalid_file_atomicity(client):
    login(client)
    name, email = "Import " + str(uuid4()), f"leader-{uuid4()}@example.test"
    body = upload([["name"], [name]])
    path = "/api/organization/import/branches"
    assert client.post(path, json=body).json()["count"] == 1
    with DB() as db:
        assert not db.scalar(select(Branch.id).where(Branch.name == name))
    assert client.post(path, json={**body, "apply": True}).json()["count"] == 1
    assert client.post(path, json={**body, "apply": True}).json()["already_recorded"] == 1
    leader = upload(
        [
            ["name", "email", "password", "branch_name"],
            ["Imported leader", email, "private-test-password", name],
        ]
    )
    assert (
        client.post("/api/organization/import/teams", json={**leader, "apply": True}).status_code
        == 200
    )
    agent_email = f"agent-{uuid4()}@example.test"
    columns = [
        "name",
        "email",
        "password",
        "branch_name",
        "leader_email",
        "employee_id",
        "daily_target",
    ]
    agent = [
        "Imported sales agent",
        agent_email,
        "private-test-password",
        name,
        email,
        "TEST_" + uuid4().hex[:12],
        "12",
    ]
    bad = [
        "Bad agent",
        f"bad-{uuid4()}@example.test",
        "private-test-password",
        name,
        "missing@example.test",
        "BAD_" + uuid4().hex[:12],
        "12",
    ]
    response = client.post(
        "/api/organization/import/agents", json=upload([columns, agent, bad], apply=True)
    )
    assert response.status_code == 422, response.text
    with DB() as db:
        assert not db.scalar(select(User.id).where(User.email == agent_email))
    good = upload([columns, agent], apply=True)
    assert client.post("/api/organization/import/agents", json=good).json()["count"] == 1
    assert client.post("/api/organization/import/agents", json=good).json()["already_recorded"] == 1


def test_branch_asset_import_is_atomic_and_repeat_safe(client):
    login(client)
    branch = client.get("/api/resources/branches").json()[0]["id"]
    serial = "ROUTER-" + str(uuid4())
    columns = ["category", "label", "serial", "quantity", "note"]
    body = upload(
        [
            columns,
            ["ROUTER", "Import router", serial, "1", "Branch stock"],
            ["UNIFORM", "Shirts", "", "4", "Branch supplies"],
        ],
        branch_id=branch,
    )
    preview = client.post("/api/field-assets/import", json=body)
    assert preview.status_code == 200 and preview.json()["quantity"] == 5, preview.text
    with DB() as db:
        assert not db.scalar(select(FieldAsset.id).where(FieldAsset.serial == serial))
    assert (
        client.post("/api/field-assets/import", json={**body, "apply": True}).json()["count"] == 2
    )
    assert client.post("/api/field-assets/import", json={**body, "apply": True}).json()[
        "already_imported"
    ]
    bad = upload(
        [columns, ["ROUTER", "Bad", serial + "X", "2", "Wrong serialized quantity"]],
        branch_id=branch,
        apply=True,
    )
    assert client.post("/api/field-assets/import", json=bad).status_code == 422
    login(client, "agent1")
    assert client.post("/api/field-assets/import", json=body).status_code == 403


def test_super_admin_account_edit_is_versioned_and_cannot_change_staff_role(client):
    login(client)
    directory = client.get("/api/organization/access").json()
    tele = next(r for r in directory["roles"] if r["name"] == "Tele Verification Officer")
    welcome = next(r for r in directory["roles"] if r["name"] == "Welcome Call Officer")
    created = client.post(
        "/api/organization/access/accounts",
        json={
            "name": "Synthetic caller",
            "email": f"edit-{uuid4()}@example.test",
            "password": "private-test-password",
            "role_id": tele["id"],
        },
    ).json()
    expected = {
        "name": created["name"],
        "email": created["email"],
        "role_id": tele["id"],
        "branch_id": None,
    }
    body = {
        **expected,
        "name": "Updated caller",
        "role_id": welcome["id"],
        "expected": expected,
        "reason": "Move to the welcome call queue",
    }
    endpoint = "/api/organization/access/accounts/" + created["id"]
    assert client.put(endpoint, json=body).status_code == 200
    assert client.put(endpoint, json=body).status_code == 409
    login(client, "ops")
    assert client.put(endpoint, json=body).status_code == 403
    login(client)
    agent = next(a for a in directory["accounts"] if a["email"] == "agent1@relay.demo")
    assert (
        client.put(
            "/api/organization/access/accounts/" + agent["id"],
            json={**body, "expected": {k: agent[k] for k in expected}},
        ).status_code
        == 422
    )


def test_legacy_staff_mutations_cannot_bypass_super_admin_account_controls(client):
    login(client)
    staff = client.get("/api/sales-management/staff").json()[0]
    payload = {"name": "Legacy staff account", "email": f"legacy-{uuid4()}@example.test",
               "password": "private-test-password", "role": "Tele Verification Officer"}
    changed_role = "Sales Manager" if staff["role"] != "Sales Manager" else "Welcome Call Officer"
    assignment = {"role": changed_role, "branch_id": "", "reason": "Change the call queue assignment"}
    login(client, "ops")
    assert client.get("/api/sales-management/staff").status_code == 200
    assert client.post("/api/sales-management/staff", json=payload).status_code == 403
    assert client.patch("/api/sales-management/staff/" + staff["id"], json=assignment).status_code == 403
    login(client)
    created = client.post("/api/sales-management/staff", json=payload)
    assert created.status_code == 201, created.text
    assert client.patch("/api/sales-management/staff/" + created.json()["id"], json=assignment).status_code == 200


def test_role_permission_editor_limits_grants_and_revokes_existing_sessions(client):
    from app.db import Permission

    with DB() as db:
        role = db.scalar(select(Role).where(Role.name == "Tele Verification Officer"))
        role_id = role.id
        original = list(db.scalars(select(Permission.name).where(Permission.role_id == role.id)))
        original_rows = [
            {"id": p.id, "name": p.name, "role_id": p.role_id, "created_at": p.created_at}
            for p in db.scalars(select(Permission).where(Permission.role_id == role.id))
        ]
    token = login(client, "tele")["access_token"]
    login(client)
    endpoint = "/api/organization/access/roles/" + role_id
    body = {
        "permissions": original,
        "expected": original,
        "reason": "Review tele-verification queue access",
    }
    assert (
        client.put(
            endpoint, json={**body, "permissions": original + ["settings.write"]}
        ).status_code
        == 422
    )
    assert client.put(endpoint, json={**body, "expected": []}).status_code == 409
    try:
        chosen = [name for name in original if name != "call.tele.write"]
        response = client.put(endpoint, json={**body, "permissions": chosen})
        assert response.status_code == 200, response.text
        assert (
            client.get("/api/auth/me", headers={"Authorization": "Bearer " + token}).status_code
            == 401
        )
    finally:
        client.put(endpoint, json={**body, "expected": chosen})
        from sqlalchemy import delete

        with DB() as db:
            db.execute(delete(Permission).where(Permission.role_id == role_id))
            for row in original_rows:
                db.add(Permission(**row))
            db.commit()
    admin = next(
        r
        for r in client.get("/api/organization/access").json()["roles"]
        if r["name"] == "Administrator"
    )
    assert (
        client.put(
            "/api/organization/access/roles/" + admin["id"],
            json={
                "permissions": ["read"],
                "expected": admin["permissions"],
                "reason": "Prevent accidental recovery lockout",
            },
        ).status_code
        == 409
    )
