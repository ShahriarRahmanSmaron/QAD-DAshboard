"""Add operational semantic fact storage.

Revision ID: 20260526190000
Revises: 20260525210000
Create Date: 2026-05-26 19:00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260526190000"
down_revision = "20260525210000"
branch_labels = None
depends_on = None


def _uuid_fk(
    column_name: str,
    table_name: str,
    *,
    nullable: bool = True,
    ondelete: str = "SET NULL",
) -> sa.Column:
    return sa.Column(
        column_name,
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey(f"{table_name}.id", ondelete=ondelete),
        nullable=nullable,
    )


def _timestamps() -> tuple[sa.Column, sa.Column]:
    return (
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def _soft_delete() -> tuple[sa.Column, sa.Column]:
    return (
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        _uuid_fk("deleted_by_user_id", "users"),
    )


def _audit_fields() -> tuple[sa.Column, sa.Column]:
    return (
        _uuid_fk("created_by_user_id", "users"),
        _uuid_fk("updated_by_user_id", "users"),
    )


def upgrade() -> None:
    op.create_table(
        "operational_facts",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        _uuid_fk("uploaded_file_id", "uploaded_files", nullable=False, ondelete="CASCADE"),
        _uuid_fk("report_id", "reports"),
        _uuid_fk("buyer_id", "buyers"),
        _uuid_fk("unit_id", "units"),
        sa.Column("buyer", sa.String(length=255), nullable=True),
        sa.Column("unit", sa.String(length=255), nullable=True),
        sa.Column("report_date", sa.Date(), nullable=True),
        sa.Column("metric_key", sa.String(length=128), nullable=False),
        sa.Column("metric_label", sa.String(length=255), nullable=False),
        sa.Column("operational_section", sa.String(length=128), nullable=False),
        sa.Column("operational_section_label", sa.String(length=255), nullable=False),
        sa.Column("operational_row_key", sa.String(length=255), nullable=True),
        sa.Column("operational_row_label", sa.String(length=512), nullable=True),
        sa.Column("column_label", sa.String(length=512), nullable=True),
        sa.Column("value_type", sa.String(length=32), nullable=False),
        sa.Column("value_numeric", sa.Numeric(18, 4), nullable=True),
        sa.Column("value_text", sa.Text(), nullable=True),
        sa.Column("value_date", sa.Date(), nullable=True),
        sa.Column("value_boolean", sa.Boolean(), nullable=True),
        sa.Column("unit_of_measure", sa.String(length=64), nullable=True),
        sa.Column("is_formula", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("formula", sa.Text(), nullable=True),
        sa.Column(
            "calculated_state",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'static'"),
        ),
        sa.Column("source_sheet_name", sa.String(length=255), nullable=False),
        sa.Column("source_sheet_index", sa.Integer(), nullable=True),
        sa.Column("source_cell_address", sa.String(length=32), nullable=False),
        sa.Column("source_row_number", sa.Integer(), nullable=False),
        sa.Column("source_column_number", sa.Integer(), nullable=False),
        sa.Column("source_region_id", sa.String(length=255), nullable=True),
        sa.Column("source_region_kind", sa.String(length=128), nullable=True),
        sa.Column("source_region_range", sa.String(length=64), nullable=True),
        sa.Column(
            "workbook_sheet_identity",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "workbook_source",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        *_timestamps(),
        *_soft_delete(),
        *_audit_fields(),
        sa.CheckConstraint(
            "length(trim(metric_key)) > 0",
            name="operational_facts_metric_not_blank",
        ),
        sa.CheckConstraint(
            "length(trim(operational_section)) > 0",
            name="operational_facts_section_not_blank",
        ),
        sa.CheckConstraint(
            "value_type in ('text', 'number', 'date', 'boolean', 'blank')",
            name="operational_facts_value_type_check",
        ),
        sa.CheckConstraint(
            "calculated_state in ('static', 'formula', 'calculated', 'blank')",
            name="operational_facts_calculated_state_check",
        ),
        sa.CheckConstraint(
            "source_row_number > 0 and source_column_number > 0",
            name="operational_facts_source_position_positive",
        ),
    )

    op.create_index("operational_facts_uploaded_file_idx", "operational_facts", ["uploaded_file_id"])
    op.create_index("operational_facts_report_date_idx", "operational_facts", ["report_date"])
    op.create_index("operational_facts_buyer_date_idx", "operational_facts", ["buyer", "report_date"])
    op.create_index("operational_facts_unit_date_idx", "operational_facts", ["unit", "report_date"])
    op.create_index(
        "operational_facts_metric_date_idx",
        "operational_facts",
        ["metric_key", "report_date"],
    )
    op.create_index("operational_facts_section_idx", "operational_facts", ["operational_section"])
    op.create_index(
        "operational_facts_source_cell_idx",
        "operational_facts",
        ["source_sheet_name", "source_cell_address"],
    )
    op.create_index("operational_facts_deleted_at_idx", "operational_facts", ["deleted_at"])
    op.execute(
        "create unique index operational_facts_upload_source_active_key "
        "on public.operational_facts "
        "(uploaded_file_id, source_sheet_name, source_cell_address, metric_key, operational_section) "
        "where deleted_at is null"
    )
    op.execute(
        """
        create trigger operational_facts_set_updated_at
        before update on public.operational_facts
        for each row execute function public.set_updated_at()
        """
    )
    op.execute("alter table public.operational_facts enable row level security")

    op.execute(
        """
        create policy "Users read accessible operational facts"
        on public.operational_facts for select
        to authenticated
        using (
          deleted_at is null
          and exists (
            select 1
            from public.uploaded_files uf
            where uf.id = operational_facts.uploaded_file_id
              and uf.deleted_at is null
              and (
                uf.uploaded_by_user_id = auth.uid()
                or exists (
                  select 1 from public.users u
                  join public.roles role on role.id = u.role_id
                  where u.id = auth.uid() and u.is_active = true and role.name = 'admin'
                )
                or exists (
                  select 1 from public.user_permissions up
                  where up.user_id = auth.uid()
                    and up.permission = 'reports:read'
                    and up.resource_id is null
                )
              )
          )
        )
        """
    )
    op.execute(
        """
        create policy "Users create own upload operational facts"
        on public.operational_facts for insert
        to authenticated
        with check (
          exists (
            select 1
            from public.uploaded_files uf
            where uf.id = operational_facts.uploaded_file_id
              and (
                uf.uploaded_by_user_id = auth.uid()
                or exists (
                  select 1 from public.users u
                  join public.roles role on role.id = u.role_id
                  where u.id = auth.uid() and u.is_active = true and role.name = 'admin'
                )
              )
          )
        )
        """
    )
    op.execute(
        """
        create policy "Users sync own upload operational facts"
        on public.operational_facts for update
        to authenticated
        using (
          exists (
            select 1
            from public.uploaded_files uf
            where uf.id = operational_facts.uploaded_file_id
              and (
                uf.uploaded_by_user_id = auth.uid()
                or exists (
                  select 1 from public.users u
                  join public.roles role on role.id = u.role_id
                  where u.id = auth.uid() and u.is_active = true and role.name = 'admin'
                )
              )
          )
        )
        with check (
          exists (
            select 1
            from public.uploaded_files uf
            where uf.id = operational_facts.uploaded_file_id
              and (
                uf.uploaded_by_user_id = auth.uid()
                or exists (
                  select 1 from public.users u
                  join public.roles role on role.id = u.role_id
                  where u.id = auth.uid() and u.is_active = true and role.name = 'admin'
                )
              )
          )
        )
        """
    )


def downgrade() -> None:
    op.execute("drop trigger if exists operational_facts_set_updated_at on public.operational_facts")
    op.drop_table("operational_facts")
