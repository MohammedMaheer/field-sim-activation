"""Approved October incentive rates and explicit, audited eligibility inputs."""
from datetime import datetime, timezone
import json
from alembic import op
import sqlalchemy as sa

revision = "016"
down_revision = "015"

# Frozen business tables. Personal source profiles and email images are excluded.
POLICIES = json.loads(r'''[{"id":"mbo_staff_oct2026","name":"MBO staff","family":"MBO_STAFF","valid_from":"2026-10","valid_until":null,"rules":{"bands":[80,90,100,110],"monthly_rates":{"SLAB_1":["25","30","30","50"],"SLAB_2":["50","60","75","90"],"SLAB_3":["75","90","100","125"]},"product_slabs":{"HW":"SLAB_2","ELIFE":"SLAB_3"},"cumulative_products":["ELIFE","HW","MNP","NEW","P2P"],"gate_rates":{"GATE_1":{"MNP":"50","NEW":"30","P2P":"25","slab3_mrc_percent":"5"},"GATE_2":{"MNP":"60","NEW":"40","P2P":"30","slab3_mrc_percent":"7"}},"gate_contract_share_min":75,"gate_quality_min":80,"gate_mrc_exclusive_min":125,"source":"MBO Staff Incentive Plan - October,26 - Effective Until Further Notice","notes":["HW and eLife each count as one sale","No average MRC condition for monthly staff incentives","Gate incentives are additional","Gate targets must be configured for the kiosk"]}},{"id":"postpaid_tl_oct2026","name":"Postpaid team leader","family":"POSTPAID_TL","valid_from":"2026-10","valid_until":null,"rules":{"bands":[90,100,110,120],"monthly_rates":{"MNP":{"SLAB_1":["2.5","5","7.5","10"],"SLAB_2":["5","10","12.5","15"],"SLAB_3":["10","15","17.5","20"]},"NEW":{"SLAB_1":["2","2.5","5","7.5"],"SLAB_2":["5","7.5","10","12.5"],"SLAB_3":["7.5","10","12.5","15"]},"P2P":{"SLAB_1":["1.5","2","2.5","5"],"SLAB_2":["2.5","5","5","10"],"SLAB_3":["5","10","10","12.5"]}},"mnp_achievement_min":70,"contract_share_min":75,"disconnection_exclusion_threshold":7,"elife_rates":{"2P_299":["5","7.5","10","15"],"3P_389":["15","20","25","30"],"3P_NEO_399":["15","20","25","30"],"3P_429":["15","20","25","30"],"3P_515":["20","25","30","40"],"3P_639":["25","30","30","40"]},"elife_postpaid_achievement_min":80,"mrc_adjustment_percentages":[-20,-10,0,10,20,30],"gate_rates":{"GATE_1":{"target":1945,"MNP":"12.5","NEW":"8","P2P":"5"},"GATE_2":{"target":2000,"MNP":"15","NEW":"10","P2P":"7"}},"gate_valid_until":"2026-10","source":"Team Leaders Incentive plan - October,26 - Effective Until Further Notice","notes":["Per-sale rates by product and slab","Individual MRC profiles require explicit configuration","Gate disconnection exclusion differs from monthly achievement","Any applicable store incentive split requires explicit configuration"]}},{"id":"mbo_tl_oct2026","name":"MBO team leader","family":"MBO_TL","valid_from":"2026-10","valid_until":null,"rules":{"bands":[80,90,100,110],"target":150,"monthly_rates":["10","12.5","15","17.5"],"contract_share_min":80,"full_commission_mrc_min":185,"postpaid_uplifts":[{"mrc_exclusive_min":200,"percent":15},{"mrc_exclusive_min":220,"percent":20}],"disconnection_exclusion_threshold":7,"gate_rates":{"GATE_1":{"target":1945,"MNP":"12.5","NEW":"8","P2P":"5"},"GATE_2":{"target":2000,"MNP":"15","NEW":"10","P2P":"7"}},"gate_valid_until":"2026-10","source":"MBO Team Leader Incentive Plan \u2013 October,26 - Effective Until Further Notice","notes":["PP, HW and eLife achievement is cumulative","Below-185 MRC payment rule requires confirmation","Above-220 MRC uplift combination requires confirmation"]}},{"id":"sm_gate_oct2026","name":"Sales Manager gates","family":"SM_GATE","valid_from":"2026-10","valid_until":"2026-10","rules":{"gate_rates":{"GATE_1":{"target":1945,"MNP":"2.5","NEW":"1.75","P2P":"0.75"},"GATE_2":{"target":2000,"MNP":"3","NEW":"2.5","P2P":"1"}},"source":"Approved Gate Incentive plan - Oct,26","notes":["The source labels both SM rows Gate 1; second target is 2000","SM allocation and entitlement require confirmation","Gate attainment must reach 100% without rounding up"]}}]''')


def upgrade():
    op.create_table("commission_policies",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("family", sa.String(30), nullable=False),
        sa.Column("valid_from", sa.String(7), nullable=False),
        sa.Column("valid_until", sa.String(7), nullable=True),
        sa.Column("rules", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    op.create_index("ix_commission_policies_created_at", "commission_policies", ["created_at"])
    op.create_index("ix_commission_policies_family", "commission_policies", ["family"])
    op.create_table("commission_configurations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("period", sa.String(7), nullable=False),
        sa.Column("policy_id", sa.String(36), sa.ForeignKey("commission_policies.id"), nullable=False),
        sa.Column("inputs", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("updated_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.UniqueConstraint("user_id", "period", name="uq_commission_user_period"))
    for column in ("created_at", "user_id", "period"):
        op.create_index("ix_commission_configurations_" + column, "commission_configurations", [column])
    table = sa.table("commission_policies", sa.column("id",sa.String()), sa.column("created_at",sa.DateTime()),
        sa.column("name",sa.String()),sa.column("family",sa.String()),sa.column("valid_from",sa.String()),
        sa.column("valid_until",sa.String()),sa.column("rules",sa.JSON()),sa.column("version",sa.Integer()))
    stamp = datetime.now(timezone.utc).replace(tzinfo=None)
    op.bulk_insert(table, [{**row,"created_at":stamp,"version":1} for row in POLICIES])


def downgrade():
    op.drop_table("commission_configurations")
    op.drop_table("commission_policies")
