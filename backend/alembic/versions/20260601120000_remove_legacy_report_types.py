"""Remove legacy seeded report types (MD07-5 Phase 5).

Revision ID: 20260601120000
Revises: 20260531200000
Create Date: 2026-06-01 12:00:00

MD07-5 Phase 5 migrates Operational Query to a workbook-first architecture: the
report-type registry is generated dynamically from active workbook sources at
ingestion, never from seeded template metadata.

The three legacy template report types (WF Test & Shade Summary, RFT Summary,
Defect Summary) were inserted by the development seed independently of any
workbook, so they appeared in the Operational Query report-type dropdown even
when no corresponding workbook was uploaded, archived, or deleted. This
migration retires them.

They are soft-deleted (``deleted_at`` set, ``is_active = false``) rather than
hard-deleted so the ``reports.report_type_id`` RESTRICT foreign key is never
violated for any historical report that referenced them. The dynamic registry
query filters on ``deleted_at is null`` and active workbooks, so soft-deletion
removes them from Operational Query immediately. Workbooks that pointed at them
keep their ``report_type_id`` (FK is SET NULL only on hard delete); the rebuild
path re-classifies workbooks to their derived, workbook-driven report type.
"""

from __future__ import annotations

from alembic import op

revision = "20260601120000"
down_revision = "20260531200000"
branch_labels = None
depends_on = None

# Distinctive identifiers of the seeded template report types. ``excel_template_key``
# is unique to the seed and is never set by the dynamic, ingestion-time registry,
# so matching on it only ever targets legacy seeded rows.
_LEGACY_TEMPLATE_KEYS = (
    "wf-test-shade-summary",
    "rft-summary",
    "defect-summary",
)
_LEGACY_CODES = (
    "WF_TEST_SHADE",
    "RFT_SUMMARY",
    "DEFECT_SUMMARY",
)


def upgrade() -> None:
    template_keys = ", ".join(f"'{key}'" for key in _LEGACY_TEMPLATE_KEYS)
    codes = ", ".join(f"'{code}'" for code in _LEGACY_CODES)
    op.execute(
        f"""
        update public.report_types
        set deleted_at = now(),
            is_active = false
        where deleted_at is null
          and (
              excel_template_key in ({template_keys})
              or upper(code) in ({codes})
          )
        """
    )


def downgrade() -> None:
    # Best-effort restore of the legacy seeded report types. The exact
    # deleted_at timestamp is not recoverable, so we simply clear the soft-delete
    # marker and reactivate them for the legacy template keys.
    template_keys = ", ".join(f"'{key}'" for key in _LEGACY_TEMPLATE_KEYS)
    op.execute(
        f"""
        update public.report_types
        set deleted_at = null,
            is_active = true
        where excel_template_key in ({template_keys})
        """
    )
