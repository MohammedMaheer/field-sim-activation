"""Present external activation separately from evidence and daily SR checks."""


def activation_presentation(sale_status, sr_status, review_status="", external_recorded=False):
    if sale_status == "CANCELLED":
        state, label = "CANCELLED", "Cancelled"
    elif not external_recorded and sale_status != "CLOSED":
        state, label = "PENDING_BACKEND_REVIEW", "Pending backend review"
    elif review_status == "REJECTED":
        state, label = "ACTIVATED_REVIEW_ACTION_REQUIRED", "Activated · review action required"
    elif sr_status == "MISMATCH":
        state, label = "ACTIVATED_SR_MISMATCH", "Activated · SR mismatch"
    elif sr_status != "MATCHED":
        state, label = "ACTIVATED_PENDING_SR", "Activated · pending SR verification"
    elif sale_status == "CLOSED" and review_status in {"", "VERIFIED"}:
        state, label = "FULLY_ACTIVATED", "Fully activated"
    else:
        state, label = "ACTIVATED_PENDING_REVIEW", "Activated · pending backend review"
    return {"activation_state": state, "activation_label": label,
            "external_activation_recorded": external_recorded or sale_status == "CLOSED",
            "backend_review_status": review_status or ("VERIFIED" if sale_status == "CLOSED" else "PENDING")}
