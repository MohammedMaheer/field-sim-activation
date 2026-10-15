"""Whole-branch boundary assignment must not silently retain personal overrides."""
import pytest
from sqlalchemy import select

from test_work_location import client, database, login, clean_geo, configure, gps, URL
from app.db import Agent, Branch, DB, Outlet, User
from app.location_tracking import FenceAssignment, WorkFence, WorkLocation


def worksite(client, **values):
    login(client)
    response = client.post(URL + "/fences", json={"name": "Alternate worksite", "branch_id": None,
        "latitude": 24.7, "longitude": 54.6, "radius_m": 750, "enabled": True, **values})
    assert response.status_code == 201, response.text
    return response.json()


def test_apply_branch_replaces_overrides_and_mobile_reads_same_boundary(client):
    person, original = configure(client)
    client.post(URL + "/start", json=gps())
    with DB() as db:
        history = [(row.id, row.coordinates_encrypted) for row in db.scalars(select(WorkLocation))]
        member_branch = db.get(Outlet, db.get(Agent, person["agent_id"]).outlet_id).branch_id
    alternate = worksite(client)
    assert client.put(URL + "/assignments/" + person["id"], json={"fence_id": alternate["id"]}).status_code == 200
    overview = next(row for row in client.get(URL + "/branch-assignments").json() if row["id"] == member_branch)
    assert overview["individual_count"] == 1 and overview["member_count"] >= 1
    path = URL + "/branch-assignments/" + member_branch
    blocked = client.put(path, json={"fence_id": original["id"]})
    assert blocked.status_code == 409
    login(client, "agent1")
    assert client.get(URL + "/me").json()["boundary"]["id"] == alternate["id"]
    login(client)
    applied = client.put(path, json={"fence_id": original["id"], "replace_individual": True})
    assert applied.status_code == 200, applied.text
    assert applied.json()["replaced_individual_count"] == 1
    for member in client.get(URL + "/members?branch_id=" + member_branch).json()["items"]:
        assert member["assignment_fence_id"] is None
        assert member["boundary"]["id"] == original["id"]
    assert client.put(path, json={"fence_id": original["id"]}).json()["replaced_individual_count"] == 0
    login(client, "agent1")
    state = client.get(URL + "/me").json()
    assert state["boundary"]["id"] == original["id"]
    with DB() as db:
        assert history == [(row.id, row.coordinates_encrypted) for row in db.scalars(select(WorkLocation))]
        assert db.scalar(select(FenceAssignment).where(FenceAssignment.user_id == person["id"])) is None
    # A later individual exception still changes only this member.
    login(client)
    assert client.put(URL + "/assignments/" + person["id"], json={"fence_id": alternate["id"]}).status_code == 200


def test_copy_worksite_preserves_other_branch_and_outside_personal_assignment(client):
    person, original = configure(client)
    login(client, "agent2")
    other = client.get("/api/auth/me").json()
    with DB() as db:
        branch = db.get(Outlet, db.get(Agent, person["agent_id"]).outlet_id).branch_id
        other_agent = db.get(Agent, other["agent_id"])
        previous_outlet = other_agent.outlet_id
        other_user = db.get(User, other["id"])
        previous_user_branch = other_user.branch_id
        other_user.branch_id = branch  # Deliberately stale account field.
        destination = db.scalar(select(Outlet).where(Outlet.branch_id != branch))
        other_agent.outlet_id = destination.id
        db.commit()
    try:
        login(client)
        assert client.put(URL + "/assignments/" + other["id"], json={"fence_id": original["id"]}).status_code == 200
        source = worksite(client, branch_id=destination.branch_id)
        result = client.put(URL + "/branch-assignments/" + branch,
                            json={"fence_id": source["id"], "replace_individual": True})
        assert result.status_code == 200, result.text
        assert result.json()["boundary"]["id"] not in {source["id"], original["id"]}
        login(client, "agent2")
        assert client.get(URL + "/me").json()["boundary"]["latitude"] == original["latitude"]
        login(client, "agent1")
        assert client.get(URL + "/me").json()["boundary"]["latitude"] == source["latitude"]
        with DB() as db:
            assert db.get(WorkFence, source["id"]).branch_id == destination.branch_id
            assert db.get(WorkFence, original["id"]).branch_id is None
    finally:
        with DB() as db:
            db.get(Agent, other["agent_id"]).outlet_id = previous_outlet
            db.get(User, other["id"]).branch_id = previous_user_branch
            db.commit()


@pytest.mark.parametrize("account", ["agent1", "leader", "cluster", "compliance", "inventory", "salesmanager", "tele", "welcome"])
def test_branch_management_is_never_granted_to_readers(client, account):
    login(client, account)
    assert client.get(URL + "/branch-assignments").status_code == 403
    assert client.put(URL + "/branch-assignments/missing", json={"fence_id": "missing"}).status_code == 403


def test_validation_and_empty_branch_inheritance(client):
    source = worksite(client)
    with DB() as db:
        empty = Branch(name="Isolated empty QA branch")
        closed = Branch(name="Isolated closed QA branch", lifecycle_status="CLOSED")
        db.add_all([empty, closed]); db.commit()
        branch_id, closed_id = empty.id, closed.id
    try:
        for invalid in ("missing", closed_id):
            assert client.put(URL + "/branch-assignments/" + invalid, json={"fence_id": source["id"]}).status_code == 422
        assert client.put(URL + "/branch-assignments/" + branch_id, json={"fence_id": "missing"}).status_code == 422
        result = client.put(URL + "/branch-assignments/" + branch_id, json={"fence_id": source["id"]})
        assert result.status_code == 200 and result.json()["member_count"] == 0
        overview = client.get(URL + "/branch-assignments").json()
        assert closed_id not in {item["id"] for item in overview}
        assert next(item for item in overview if item["id"] == branch_id)["boundary"]["radius_m"] == 750
        # Later branch members resolve the inherited boundary without a personal row.
        login(client, "leader2")
        member_id = client.get("/api/auth/me").json()["id"]
        with DB() as db:
            member = db.get(User, member_id); previous = member.branch_id
            member.branch_id = branch_id; db.commit()
        try:
            assert client.get(URL + "/me").json()["boundary"]["radius_m"] == 750
        finally:
            with DB() as db:
                db.get(User, member_id).branch_id = previous; db.commit()
    finally:
        with DB() as db:
            for row in db.scalars(select(WorkFence).where(WorkFence.branch_id == branch_id)):
                db.delete(row)
            db.delete(db.get(Branch, branch_id)); db.delete(db.get(Branch, closed_id)); db.commit()


def test_admin_can_manage_branch_and_disabled_site_is_rejected(client):
    site = worksite(client, enabled=False)
    login(client, "ops")
    rows = client.get(URL + "/branch-assignments")
    assert rows.status_code == 200
    assert client.put(URL + "/branch-assignments/" + rows.json()[0]["id"], json={"fence_id": site["id"]}).status_code == 422
