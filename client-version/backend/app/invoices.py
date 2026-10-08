"""Invoice projections from recorded evidence; no inferred payment or activation."""

import re

MISSING = "Not recorded"


def invoice(row, data):
    intake = data.get("intake") or {}
    sale_mode = intake.get("capture_mode") == "SCREENSHOT_SALE"
    order_mode = intake.get("capture_mode") in {"SCREENSHOT_ORDER", "SCREENSHOT_SALE"}
    plan = data.get("plan_snapshot") or {}
    uploaded = [f for item in data.get("rows", []) for f in (item.get("fields") or [])]

    def field(label, value):
        text = str(value).strip() if value is not None else ""
        if text and re.search(
            r"document.*(?:number|id)|passport.*(?:number|no)|identity.*(?:number|id)|subscriber.*id|customer.*id|emirates.*id|national.*id|^id(?:\s|$)",
            label,
            re.I,
        ):
            text = "**** " + text[-4:]
        return {"label": label, "value": text or MISSING}

    def find(labels):
        return next(
            (
                f.get("value")
                for f in uploaded
                if str(f.get("label", "")).strip().casefold() in labels
                and str(f.get("value", "")).strip()
            ),
            None,
        )

    activation = data.get("activation") or {}
    review = (
        "Verified"
        if row.status == "VERIFIED"
        else "Correction required"
        if row.status == "REJECTED"
        else "Pending backend confirmation"
        if order_mode
        else "Pending verification"
    )
    sections = [
        {
            "title": "Invoice",
            "fields": [
                field("Sale reference" if sale_mode else "Invoice number", ("SALE-" if sale_mode else "PAY-") + row.id[:8].upper()),
                field("Date", row.created_at.strftime("%d %b %Y, %H:%M UTC")),
                field("Review", review),
                field("Activation", ("Confirmed by backend" if row.status == "VERIFIED" else "Recorded by agent") if order_mode else activation.get("status") or "Awaiting backend team"),
            ],
        },
        {
            "title": "Customer",
            "fields": [
                field(label, intake.get(key))
                for key, label in [
                    ("name", "Customer name"),
                    ("arabic_name", "Arabic name"),
                    ("gender", "Gender"),
                    ("issue_date", "Issue date"),
                    ("document_type", "Document type"),
                    ("document_number", "Document number"),
                    ("nationality", "Nationality"),
                    ("birth_date", "Date of birth"),
                    ("expiry_date", "Document expiry"),
                    ("msisdn", "Phone number"),
                ]
            ],
        },
        {
            "title": "SIM & plan",
            "fields": [
                field(
                    "SIM type",
                    {"PHYSICAL": "Physical SIM", "ESIM": "eSIM"}.get(intake.get("sim_type"))
                    if intake.get("sim_identifier")
                    else None,
                ),
                field("SIM serial", intake.get("sim_identifier")),
                field("Plan", intake.get("plan_name")),
                field("Package", intake.get("package_name")),
                field("Request ID", intake.get("order_reference")),
                field("Monthly charge", intake.get("monthly_cost")),
                field("Prepayment on order", intake.get("prepayment")),
                *([field(label, intake.get(key)) for key, label in [
                    ("order_type", "Order type"), ("account_number", "Account number"),
                    ("router_serial", "Router serial"), ("advance_transaction_number", "Advance transaction number"),
                    ("sr_number", "SR number"), ("alternate_number", "Alternate contact number"),
                ]] if order_mode else []),
                *([field("Router fulfilment", {"DELIVERY": "Delivery", "ON_SPOT": "On spot", "WITHOUT_ROUTER": "Without router"}.get(intake.get("router_fulfilment")))] if sale_mode and intake.get("order_type") == "HW" else []),
                field(
                    "Plan price",
                    f"AED {plan['monthly_cost']:.2f}" if "monthly_cost" in plan else None,
                ),
                field("Plan benefits", plan.get("promotion")),
            ],
        },
        {
            "title": "Payment receipt" if sale_mode else "Payment",
            "fields": [
                field("Receipt", "Received" if intake.get("payment_image") else None),
                field("Payment", "Recorded" if intake.get("payment_image") else None),
            ] if sale_mode else [
                field("Request ID", intake.get("order_reference")),
                field("Agent payment record", "Uploaded"),
                field("Backend confirmation", review),
            ]
            if order_mode
            else [
                field(
                    "Payment reference",
                    find({"payment reference", "transaction reference", "reference"})
                    or data.get("payment_reference"),
                ),
                field(
                    "Total paid",
                    find({"total paid", "amount paid", "total amount", "transaction amount"}),
                ),
                field("Payment method", find({"payment method", "method"})),
                field("VAT", find({"vat", "vat amount", "tax"})),
            ],
        },
        {
            "title": "Records",
            "fields": [
                field(
                    "Customer details screen"
                    if order_mode
                    else "Identity document",
                    "Captured" if intake.get("document_image") else None,
                ),
                field("Order details screen", "Captured" if intake.get("order_image") else None),
                field("Selfie", "Captured" if intake.get("selfie_image") else None),
                *([field("Customer signature", "Captured" if intake.get("signature") else None)]
                  if not order_mode else []),
                field("Payment receipt" if sale_mode else "Payment confirmation", ("Received" if intake.get("payment_image") else None) if sale_mode else "Uploaded"),
                field("Verified by", (data.get("review") or {}).get("reviewer")),
                field("Activation reference", activation.get("reference")),
            ],
        },
    ]
    if intake.get("order_fields"):
        sections.append(
            {
                "title": "Order details",
                "fields": [
                    field(item.get("label", "Order detail"), item.get("value"))
                    for item in intake["order_fields"]
                ],
            }
        )
    state, sale_status = None, None
    if sale_mode:
        from sqlalchemy import select
        from sqlalchemy.orm import object_session
        from .db import SalesRecord
        from .sr_verification import sale_state
        session = object_session(row)
        sale = session.scalar(select(SalesRecord).where(SalesRecord.capture_id == row.id)) if session else None
        state = sale_state(session, sale) if sale else {"status": "PENDING_SR_VERIFICATION", "reason": "Daily SR report not checked"}
        sale_status = sale.status if sale else "IN_PROGRESS"
        sections[0]["fields"][3] = field("Activation", {
            "CLOSED": "Confirmed by backend", "CANCELLED": "Cancelled", "IN_PROGRESS": "Pending backend confirmation",
        }.get(sale_status, sale_status))
        sections.append({"title": "SR verification", "fields": [
            field("Status", state["status"].replace("_", " ").title()),
            field("Result", state["reason"]), field("Report date", state.get("business_date")),
        ]})
    if uploaded and not sale_mode:
        sections.append(
            {
                "title": "Confirmation details",
                "fields": [field(f["label"], f.get("value")) for f in uploaded],
            }
        )
    return {
        "heading": "Sale cancelled"
        if sale_status == "CANCELLED"
        else "Sale confirmed"
        if sale_status == "CLOSED" and sale_mode
        else "Correction required"
        if row.status == "REJECTED"
        else "Sale submitted"
        if sale_mode
        else "Payment recorded"
        if order_mode
        else "Payment successful",
        "status": review,
        "sections": sections,
        **({"sale_status": sale_status, "sr_verification": state,
            "payment_record_status": "RECORDED" if intake.get("payment_image") else "NOT_RECORDED"} if sale_mode else {}),
    }
