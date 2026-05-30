"""Add operational query-layer indexes (MD07-2).

Revision ID: 20260529120000
Revises: 20260526190000
Create Date: 2026-05-29 12:00:00

Adds the indexes the operational intelligence query layer relies on:

* ``buyer_id`` / ``unit_id`` foreign-key lookups
* a standalone ``metric_key`` index for metric filtering
* composite buyer/unit + metric + date indexes for trend/history retrieval

These complement the indexes created in ``20260526190000`` (report_date,
buyer/date, unit/date, metric/date, section, source-cell). All indexes are
created ``IF NOT EXISTS`` so the migration is safe to re-run against a
database that was hand-patched.
"""

from __future__ import annotations

from alembic import op

revision = "20260529120000"
down_revision = "20260526190000"
branch_labels = None
depends_on = None


_INDEXES: tuple[tuple[str, str], ...] = (
    ("operational_facts_buyer_id_idx", "(buyer_id)"),
    ("operational_facts_unit_id_idx", "(unit_id)"),
    ("operational_facts_metric_key_idx", "(metric_key)"),
    (
        "operational_facts_buyer_metric_date_idx",
        "(buyer, metric_key, report_date)",
    ),
    (
        "operational_facts_unit_metric_date_idx",
        "(unit, metric_key, report_date)",
    ),
)


def upgrade() -> None:
    for name, columns in _INDEXES:
        op.execute(
            f"create index if not exists {name} "
            f"on public.operational_facts {columns}"
        )


def downgrade() -> None:
    for name, _columns in _INDEXES:
        op.execute(f"drop index if exists {name}")
