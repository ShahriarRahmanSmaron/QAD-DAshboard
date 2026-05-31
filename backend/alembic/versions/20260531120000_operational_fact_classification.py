"""Add MD07-2B operational fact classification + active-fact columns.

Revision ID: 20260531120000
Revises: 20260529120000
Create Date: 2026-05-31 12:00:00

MD07-2B stabilization adds:

* ``row_classification`` — explicit rollup taxonomy (detail / subtotal /
  grand_total / previous_day / summary) so Grand Total and Previous Day stay
  distinct and never mix during aggregation.
* ``is_active`` — soft-cleanup flag; legacy composite / ambiguous facts are
  marked inactive (never deleted) and excluded from queries + dropdowns.
* ``inactive_reason`` — why a fact was deactivated (auditability).

All columns are added with safe server defaults so existing rows remain valid;
a rebuild pass (see ``rebuild_operational_facts``) recomputes the real values
for already-uploaded workbooks without requiring re-upload.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260531120000"
down_revision = "20260529120000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "operational_facts",
        sa.Column(
            "row_classification",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'detail'"),
        ),
    )
    op.add_column(
        "operational_facts",
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    op.add_column(
        "operational_facts",
        sa.Column("inactive_reason", sa.String(length=64), nullable=True),
    )

    op.create_check_constraint(
        "operational_facts_row_classification_check",
        "operational_facts",
        "row_classification in "
        "('detail', 'subtotal', 'grand_total', 'previous_day', 'summary')",
    )

    op.execute(
        "create index if not exists operational_facts_is_active_idx "
        "on public.operational_facts (is_active)"
    )
    op.execute(
        "create index if not exists operational_facts_classification_idx "
        "on public.operational_facts (row_classification)"
    )
    op.execute(
        "create index if not exists operational_facts_active_metric_date_idx "
        "on public.operational_facts (is_active, metric_key, report_date)"
    )


def downgrade() -> None:
    op.execute("drop index if exists operational_facts_active_metric_date_idx")
    op.execute("drop index if exists operational_facts_classification_idx")
    op.execute("drop index if exists operational_facts_is_active_idx")
    op.drop_constraint(
        "operational_facts_row_classification_check",
        "operational_facts",
        type_="check",
    )
    op.drop_column("operational_facts", "inactive_reason")
    op.drop_column("operational_facts", "is_active")
    op.drop_column("operational_facts", "row_classification")
