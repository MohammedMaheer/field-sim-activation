"""Cached or concurrent backend writes must preserve later sale decisions."""
# Injectable pytest fixture imports deliberately share their argument names.
# ruff: noqa: F811
import base64
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from starlette.requests import Request

from test_client_scope import client, database, login  # noqa: F401
from test_sales_policy_october import agents, new_sale, policy_records  # noqa: F401
from app.db import DB, SalesRecord, User
from app import sales_management as sales


request = Request({"type": "http", "method": "POST", "path": "/qa/sale-consistency",
                   "headers": [], "client": ("127.0.0.1", 0)})


def test_sale_correction_refreshes_later_status_and_stock_marker(client):
    agent, _ = agents(client)
    row = new_sale(client, agent)
    stock_marker = "synthetic-consumed-" + str(uuid4())
    with DB() as cached, DB() as changed:
        before = cached.get(SalesRecord, row["id"])
        assert before.status == "IN_PROGRESS"
        later = changed.get(SalesRecord, row["id"])
        later.status = "CLOSED"
        later.details = {**later.details, "stock_deducted_sim_id": stock_marker,
                         "payment_record_status": "RECORDED"}
        changed.commit()
        admin = cached.scalar(select(User).where(User.email == "admin@relay.demo"))
        result = sales.correct_sale(row["id"], sales.SaleCorrection(order_type="HW",
            router_fulfilment="DELIVERY", reason="Correct the recorded product after review"),
            request, user=admin, db=cached)
        assert result["status"] == "CLOSED"
        assert result["payment_record_status"] == "RECORDED"
    with DB() as db:
        stored = db.get(SalesRecord, row["id"])
        assert stored.status == "CLOSED"
        assert stored.details["stock_deducted_sim_id"] == stock_marker


def test_status_import_rejects_stale_status_without_overwriting_later_review(client):
    agent, _ = agents(client)
    row = new_sale(client, agent)
    text = f"sale_id,current_status,new_status\n{row['id']},IN_PROGRESS,CANCELLED\n"
    body = sales.StatusFile(filename="stale.csv", apply=True,
        content_base64=base64.b64encode(text.encode()).decode())
    with DB() as cached, DB() as changed:
        before = cached.get(SalesRecord, row["id"])
        assert before.status == "IN_PROGRESS"
        changed.get(SalesRecord, row["id"]).status = "CLOSED"
        changed.commit()
        admin = cached.scalar(select(User).where(User.email == "admin@relay.demo"))
        with pytest.raises(HTTPException) as rejected:
            sales.status_file(body, request, user=admin, db=cached)
        assert rejected.value.status_code == 422
        assert "status changed" in str(rejected.value.detail).lower()
    with DB() as db:
        assert db.get(SalesRecord, row["id"]).status == "CLOSED"


@pytest.mark.parametrize("change", ["cancelled", "product_corrected"])
def test_call_rechecks_the_latest_sale_before_recording(client, change):
    agent, _ = agents(client)
    row = new_sale(client, agent)
    with DB() as cached, DB() as changed:
        before = cached.get(SalesRecord, row["id"])
        assert before.status == "IN_PROGRESS" and before.order_type == "NEW"
        later = changed.get(SalesRecord, row["id"])
        if change == "cancelled":
            later.status = "CANCELLED"
        else:
            later.order_type = "WASEL"
        changed.commit()
        officer = cached.scalar(select(User).where(User.email == "tele@relay.demo"))
        with pytest.raises(HTTPException) as rejected:
            sales.record_call(row["id"], sales.CallWrite(stage="TELE_VERIFICATION",
                outcome="NO_ANSWER", remark="Customer did not answer"), request, user=officer, db=cached)
        assert rejected.value.status_code == 409
