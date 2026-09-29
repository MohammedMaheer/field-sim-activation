"""Invoice projections from recorded evidence; no inferred payment or activation."""

import re

MISSING = "Not recorded"


def invoice(row, data):
    intake = data.get("intake") or {}
    order_mode = intake.get("capture_mode") == "SCREENSHOT_ORDER"
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
                field("Invoice number", "PAY-" + row.id[:8].upper()),
                field("Date", row.created_at.strftime("%d %b %Y, %H:%M UTC")),
                field("Review", review),
                field("Activation", activation.get("status") or "Awaiting backend team"),
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
                field(
                    "Plan price",
                    f"AED {plan['monthly_cost']:.2f}" if "monthly_cost" in plan else None,
                ),
                field("Plan benefits", plan.get("promotion")),
            ],
        },
        {
            "title": "Payment",
            "fields": [
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
                    if intake.get("capture_mode") == "SCREENSHOT_ORDER"
                    else "Identity document",
                    "Captured" if intake.get("document_image") else None,
                ),
                field("Order details screen", "Captured" if intake.get("order_image") else None),
                field("Selfie", "Captured" if intake.get("selfie_image") else None),
                field("Customer signature", "Captured" if intake.get("signature") else None),
                field("Payment confirmation", "Uploaded"),
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
    if uploaded:
        sections.append(
            {
                "title": "Confirmation details",
                "fields": [field(f["label"], f.get("value")) for f in uploaded],
            }
        )
    return {
        "heading": "Correction required"
        if row.status == "REJECTED"
        else "Payment recorded"
        if order_mode
        else "Payment successful",
        "status": review,
        "sections": sections,
    }
