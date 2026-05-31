"""Widen value_numeric precision to avoid upload-time overflow.

Revision ID: 20260531200000
Revises: 20260531180000
Create Date: 2026-05-31 20:00:00

MD07-4 hotfix: ``operational_facts.value_numeric`` (and the matching
``report_metrics.value_numeric``) were ``Numeric(18, 4)``, whose maximum
absolute magnitude is just under 10^14. Real workbooks contain larger derived
values (e.g. a GSM cell evaluating to 1.6e17), and a single such cell raised
``NumericValueOutOfRangeError`` which aborted the *entire* workbook upload
transaction.

Widening to ``Numeric(30, 4)`` (max magnitude < 10^26) lets these values be
stored. This is a storage-capacity change only; no extraction, evaluation, or
aggregation logic is touched.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260531200000"
down_revision = "20260531180000"
branch_labels = None
depends_on = None

_WIDE = sa.Numeric(30, 4)
_NARROW = sa.Numeric(18, 4)


def upgrade() -> None:
    # The numeric widening forces a full table rewrite + verification scan,
    # which can exceed the server's default ``statement_timeout`` on larger
    # fact tables. Lift the timeout for this migration's transaction only.
    op.execute("SET statement_timeout = 0")
    op.execute("SET lock_timeout = 0")
    op.alter_column(
        "operational_facts",
        "value_numeric",
        existing_type=_NARROW,
        type_=_WIDE,
        existing_nullable=True,
    )
    op.alter_column(
        "report_metrics",
        "value_numeric",
        existing_type=_NARROW,
        type_=_WIDE,
        existing_nullable=True,
    )


def downgrade() -> None:
    # Note: downgrade can fail if rows hold values that no longer fit in
    # Numeric(18, 4). That is expected — the wider precision exists precisely
    # because such values are valid.
    op.alter_column(
        "report_metrics",
        "value_numeric",
        existing_type=_WIDE,
        type_=_NARROW,
        existing_nullable=True,
    )
    op.alter_column(
        "operational_facts",
        "value_numeric",
        existing_type=_WIDE,
        type_=_NARROW,
        existing_nullable=True,
    )
