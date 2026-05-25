"""Expand report workflow states.

Revision ID: 20260525210000
Revises: 20260523213000
Create Date: 2026-05-25 21:00:00
"""

from __future__ import annotations

from alembic import op

revision = "20260525210000"
down_revision = "20260523213000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("update public.reports set status = 'in_review' where status = 'submitted'")
    op.drop_constraint("reports_status_check", "reports", type_="check")
    op.create_check_constraint(
        "reports_status_check",
        "reports",
        "status in ('draft', 'in_review', 'approved', 'rejected', 'locked', 'archived')",
    )


def downgrade() -> None:
    op.execute("update public.reports set status = 'submitted' where status = 'in_review'")
    op.execute("update public.reports set status = 'approved' where status = 'locked'")
    op.drop_constraint("reports_status_check", "reports", type_="check")
    op.create_check_constraint(
        "reports_status_check",
        "reports",
        "status in ('draft', 'submitted', 'approved', 'rejected', 'archived')",
    )
