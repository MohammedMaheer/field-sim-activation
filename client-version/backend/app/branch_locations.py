"""Optional branch worksite saved with branch creation, using the shared boundary."""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from .db import Branch, get_db
from .security import principal
from .location_tracking import (
    Input,
    WorkFence,
    FenceInput,
    fence_view,
    manage,
    lock_boundary_changes,
    save_fence,
)

router = APIRouter(prefix="/api/organization/branches", tags=["Branch location"])


class BranchLocation(Input):
    latitude: float = Field(ge=-85, le=85)
    longitude: float = Field(ge=-180, le=180)
    radius_m: int = Field(ge=25, le=100000)
    enabled: bool = True


class LocationSnapshot(BranchLocation):
    id: str = Field(min_length=1, max_length=36)
    updated_at: str = Field(min_length=1, max_length=40)


class LocationChange(Input):
    location: BranchLocation
    expected: LocationSnapshot | None = None
    reason: str = Field(min_length=5, max_length=300)


def save_branch_location(db, user, branch, location, request):
    """Caller holds the short boundary lock; no commit until the branch is saved."""
    manage(db, user)
    row = db.scalar(select(WorkFence).where(WorkFence.branch_id == branch.id))
    body = FenceInput(
        name=row.name if row else branch.name, branch_id=branch.id, **location.model_dump()
    )
    return save_fence(db, user, body, row, request, commit=False)


@router.get("/{branch_id}/location")
def get_location(branch_id: str, user=Depends(principal), db=Depends(get_db)):
    manage(db, user)
    branch = db.get(Branch, branch_id)
    if not branch:
        raise HTTPException(404, "Branch not found")
    boundary = db.scalar(select(WorkFence).where(WorkFence.branch_id == branch.id))
    return {"branch_id": branch.id, "location": fence_view(boundary) if boundary else None}


@router.put("/{branch_id}/location")
def update_location(
    branch_id: str,
    body: LocationChange,
    request: Request,
    user=Depends(principal),
    db=Depends(get_db),
):
    manage(db, user)
    lock_boundary_changes(db)
    branch = db.scalar(select(Branch).where(Branch.id == branch_id).with_for_update())
    if not branch:
        raise HTTPException(404, "Branch not found")
    if branch.lifecycle_status != "ACTIVE":
        raise HTTPException(409, "An inactive branch's location is retained as history")
    current = db.scalar(select(WorkFence).where(WorkFence.branch_id == branch.id))
    before = fence_view(current) if current else None
    expected = body.expected.model_dump() if body.expected else None
    actual = {key: before[key] for key in LocationSnapshot.model_fields} if before else None
    if actual != expected:
        raise HTTPException(409, "Branch location changed. Reload before saving.")
    result = save_branch_location(db, user, branch, body.location, request)
    from .services import audit

    audit(
        db,
        user,
        "Branch location updated",
        branch.id,
        old=before,
        new=result,
        reason=body.reason,
        request=request,
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Branch location changed. Reload before saving.") from None
    return {"branch_id": branch.id, "location": result}
