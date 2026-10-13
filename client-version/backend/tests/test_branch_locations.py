from uuid import uuid4
import pytest
from sqlalchemy import select, func, delete
from test_client_scope import client, database, login  # noqa: F401
from test_work_location import clean_geo  # noqa: F401
from app.db import DB, Branch, Outlet, Permission, Role
from app.location_tracking import WorkFence

SITE = {"latitude": 25.08, "longitude": 55.14, "radius_m": 250, "enabled": True}


@pytest.fixture(autouse=True)
def clean_branches(database):
    with DB() as db:
        branches = set(db.scalars(select(Branch.id)))
    yield
    with DB() as db:
        new = list(db.scalars(select(Branch.id).where(Branch.id.not_in(branches))))
        db.execute(delete(WorkFence).where(WorkFence.branch_id.in_(new)))
        db.execute(delete(Outlet).where(Outlet.branch_id.in_(new)))
        db.execute(delete(Branch).where(Branch.id.in_(new)))
        db.commit()


def make(client, location=None):
    login(client)
    body = {"name": "Branch location " + str(uuid4())[:8]}
    if location is not None:
        body["location"] = location
    response = client.post("/api/organization/branches", json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_optional_location_and_branch_saved_together_without_enabling_enforcement(client):
    branch = make(client, SITE)
    actual = client.get(f"/api/organization/branches/{branch}/location").json()["location"]
    assert all(actual[key] == value for key, value in SITE.items())
    assert actual["branch_id"] == branch and actual["updated_at"]
    assert client.get("/api/location-tracking/settings").json()["enabled"] is False
    with DB() as db:
        assert db.scalar(select(Outlet).where(Outlet.branch_id == branch))
        assert db.scalar(select(func.count()).select_from(WorkFence)) == 1


def test_no_location_does_not_create_a_boundary_and_can_be_added_later(client):
    branch = make(client)
    route = f"/api/organization/branches/{branch}/location"
    assert client.get(route).json()["location"] is None
    response = client.put(
        route, json={"location": SITE, "expected": None, "reason": "Set real worksite"}
    )
    assert response.status_code == 200, response.text
    current = response.json()["location"]
    expected = {
        key: current[key]
        for key in ("id", "latitude", "longitude", "radius_m", "enabled", "updated_at")
    }
    response = client.put(
        route,
        json={
            "location": {**SITE, "radius_m": 500},
            "expected": expected,
            "reason": "Adjust work radius",
        },
    )
    assert response.status_code == 200 and response.json()["location"]["id"] == current["id"]
    assert (
        client.put(
            route, json={"location": SITE, "expected": expected, "reason": "Stale browser edit"}
        ).status_code
        == 409
    )
    assert client.get(route).json()["location"]["radius_m"] == 500


@pytest.mark.parametrize(
    "location",
    [
        {**SITE, "latitude": 91},
        {**SITE, "longitude": 181},
        {**SITE, "radius_m": 0},
        {**SITE, "radius_m": 250.5},
        {**SITE, "surprise": True},
    ],
)
def test_invalid_location_never_leaves_a_partial_branch(client, location):
    login(client)
    name = "Invalid branch " + str(uuid4())[:8]
    assert (
        client.post(
            "/api/organization/branches", json={"name": name, "location": location}
        ).status_code
        == 422
    )
    with DB() as db:
        assert db.scalar(select(Branch.id).where(Branch.name == name)) is None
        assert db.scalar(select(func.count()).select_from(WorkFence)) == 0


def test_revoked_location_grant_cannot_save_it_through_branch_creation(client):
    login(client)
    with DB() as db:
        role = db.scalar(select(Role).where(Role.name == "Administrator"))
        grant = db.scalar(
            select(Permission).where(
                Permission.role_id == role.id, Permission.name == "location.manage"
            )
        )
        db.delete(grant)
        db.commit()
    try:
        assert (
            client.post(
                "/api/organization/branches", json={"name": "No grant location", "location": SITE}
            ).status_code
            == 403
        )
        assert (
            client.post(
                "/api/organization/branches", json={"name": "No location allowed"}
            ).status_code
            == 201
        )
        with DB() as db:
            assert db.scalar(select(func.count()).select_from(WorkFence)) == 0
    finally:
        with DB() as db:
            db.add(Permission(role_id=role.id, name="location.manage"))
            db.commit()


@pytest.mark.parametrize(
    "account", ["agent1", "leader", "salesmanager", "compliance", "tele", "welcome", "inventory"]
)
def test_location_read_edit_scoped_to_authorized_management(client, account):
    branch = make(client, SITE)
    login(client, account)
    route = f"/api/organization/branches/{branch}/location"
    assert client.get(route).status_code == 403
    assert (
        client.put(
            route, json={"location": SITE, "expected": None, "reason": "Forbidden edit"}
        ).status_code
        == 403
    )


def test_closed_branch_and_wrong_record_do_not_accept_location(client):
    branch = make(client, SITE)
    with DB() as db:
        db.get(Branch, branch).lifecycle_status = "CLOSED"
        db.commit()
    route = f"/api/organization/branches/{branch}/location"
    assert (
        client.put(
            route, json={"location": SITE, "expected": None, "reason": "Inactive worksite"}
        ).status_code
        == 409
    )
    assert client.get(f"/api/organization/branches/{uuid4()}/location").status_code == 404
