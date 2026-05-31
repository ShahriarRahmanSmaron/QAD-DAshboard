"""Add MD07-3 workbook governance columns.

Revision ID: 20260531180000
Revises: 20260531120000
Create Date: 2026-05-31 18:00:00

MD07-3 (Workbook Governance & Active Source Management) adds workbook-level
state to ``uploaded_files`` so users can see which workbooks are active, which
are archived, and prevent accidental duplicate uploads:

* ``is_active_workbook`` — only active workbooks contribute to operational
  reporting (query, aggregation, comparison, trend, dimension dropdowns).
  Inactive workbooks remain stored but are ignored.
* ``archived_at`` / ``archived_by_user_id`` — soft-archive marker; archived
  workbooks are excluded from all reporting, dropdowns, and comparisons but
  remain stored.

All columns are additive with safe server defaults so existing rows remain
valid and continue to participate in reporting exactly as before.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260531180000"
down_revision = "20260531120000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "uploaded_files",
        sa.Column(
            "is_active_workbook",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    op.add_column(
        "uploaded_files",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "uploaded_files",
        sa.Column(
            "archived_by_user_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "uploaded_files_archived_by_user_id_fkey",
        "uploaded_files",
        "users",
        ["archived_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.execute(
        "create index if not exists uploaded_files_is_active_workbook_idx "
        "on public.uploaded_files (is_active_workbook)"
    )
    op.execute(
        "create index if not exists uploaded_files_archived_at_idx "
        "on public.uploaded_files (archived_at)"
    )


def downgrade() -> None:
    op.execute("drop index if exists uploaded_files_archived_at_idx")
    op.execute("drop index if exists uploaded_files_is_active_workbook_idx")
    op.drop_constraint(
        "uploaded_files_archived_by_user_id_fkey",
        "uploaded_files",
        type_="foreignkey",
    )
    op.drop_column("uploaded_files", "archived_by_user_id")
    op.drop_column("uploaded_files", "archived_at")
    op.drop_column("uploaded_files", "is_active_workbook")
