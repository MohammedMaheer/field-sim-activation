"""Align the active subscriber plans with the approved Qanawat flow."""

from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

revision = "007"
down_revision = "006"

PLANS = (
    ("70000000-0000-4000-8000-000000000001", "5G Unlimited Ultra", 350.0, 0, "Unlimited 5G Data + 1500 Flexi Mins"),
    ("70000000-0000-4000-8000-000000000002", "Flexi Postpaid", 250.0, 100, "100GB 5G Data + 500 Local Mins"),
    ("70000000-0000-4000-8000-000000000003", "Tourist Prepaid", 199.0, 50, "50GB High Speed + Free Roaming"),
    ("70000000-0000-4000-8000-000000000004", "Enterprise M2M", 85.0, 0, "Telemetry VPN + Fixed IP"),
)
LEGACY_PLANS = ("Essential 125", "Everyday 200", "Unlimited 350")


def upgrade():
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if not {"products", "plans"}.issubset(tables):
        return

    product = bind.execute(
        sa.text("SELECT id FROM products WHERE name = :name ORDER BY created_at LIMIT 1"),
        {"name": "Relay Mobile"},
    ).first()
    if product is None:
        return
    product_id = product[0]
    bind.execute(
        sa.text("UPDATE plans SET active = FALSE WHERE name IN :names AND product_id = :product_id")
        .bindparams(sa.bindparam("names", expanding=True)),
        {"names": list(LEGACY_PLANS), "product_id": product_id},
    )

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for plan_id, name, price, data_gb, details in PLANS:
        existing = bind.execute(
            sa.text("SELECT id FROM plans WHERE id = :id OR (name = :name AND product_id = :product_id)"),
            {"id": plan_id, "name": name, "product_id": product_id},
        ).first()
        if existing:
            bind.execute(
                sa.text("""
                    UPDATE plans
                    SET name = :name, monthly_cost = :monthly_cost, data_gb = :data_gb,
                        speed = :speed, roaming = :roaming, promotion = :promotion,
                        active = TRUE
                    WHERE id = :existing_id
                """),
                {
                    "existing_id": existing[0],
                    "name": name,
                    "monthly_cost": price,
                    "data_gb": data_gb,
                    "speed": "5G",
                    "roaming": "Included",
                    "promotion": details,
                },
            )
            continue
        bind.execute(
            sa.text("""
                INSERT INTO plans
                    (id, created_at, product_id, name, monthly_cost, data_gb, speed,
                     roaming, contract, promotion, advance, vat, active)
                VALUES
                    (:id, :created_at, :product_id, :name, :monthly_cost, :data_gb, :speed,
                     :roaming, :contract, :promotion, 0, 5, TRUE)
            """),
            {
                "id": plan_id,
                "created_at": now,
                "product_id": product_id,
                "name": name,
                "monthly_cost": price,
                "data_gb": data_gb,
                "speed": "5G",
                "roaming": "Included",
                "contract": "As selected in Etisalat",
                "promotion": details,
            },
        )


def downgrade():
    bind = op.get_bind()
    if "plans" not in sa.inspect(bind).get_table_names():
        return
    bind.execute(
        sa.text("UPDATE plans SET active = FALSE WHERE id IN :ids").bindparams(
            sa.bindparam("ids", expanding=True)
        ),
        {"ids": [p[0] for p in PLANS]},
    )
    bind.execute(
        sa.text("UPDATE plans SET active = TRUE WHERE name IN :names").bindparams(
            sa.bindparam("names", expanding=True)
        ),
        {"names": list(LEGACY_PLANS)},
    )
