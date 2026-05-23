"""Create textile QAD reporting schema.

Revision ID: 20260523213000
Revises: None
Create Date: 2026-05-23 21:30:00
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260523213000"
down_revision = None
branch_labels = None
depends_on = None


REPORT_TABLES = (
    "buyers",
    "units",
    "report_types",
    "uploaded_files",
    "reports",
    "report_rows",
    "report_metrics",
)


def _uuid_pk() -> sa.Column:
    return sa.Column(
        "id",
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
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
        sa.Column(
            "deleted_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def _audit_fields() -> tuple[sa.Column, sa.Column]:
    return (
        sa.Column(
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "updated_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def _create_updated_at_trigger(table_name: str) -> None:
    op.execute(f"drop trigger if exists {table_name}_set_updated_at on public.{table_name}")
    op.execute(
        f"""
        create trigger {table_name}_set_updated_at
        before update on public.{table_name}
        for each row execute function public.set_updated_at()
        """
    )


def _drop_updated_at_trigger(table_name: str) -> None:
    op.execute(f"drop trigger if exists {table_name}_set_updated_at on public.{table_name}")


def upgrade() -> None:
    op.execute("create schema if not exists extensions")
    op.execute("create extension if not exists pgcrypto with schema extensions")
    op.execute(
        """
        create or replace function public.set_updated_at()
        returns trigger
        language plpgsql
        as $$
        begin
          new.updated_at = now();
          return new;
        end;
        $$
        """
    )

    op.create_table(
        "buyers",
        _uuid_pk(),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        *_timestamps(),
        *_soft_delete(),
        *_audit_fields(),
        sa.CheckConstraint("length(trim(code)) > 0", name="buyers_code_not_blank"),
        sa.CheckConstraint("length(trim(name)) > 0", name="buyers_name_not_blank"),
    )
    op.create_index("buyers_is_active_idx", "buyers", ["is_active"])
    op.create_index("buyers_deleted_at_idx", "buyers", ["deleted_at"])
    op.create_index("buyers_created_by_user_id_idx", "buyers", ["created_by_user_id"])
    op.execute(
        "create unique index buyers_code_active_key "
        "on public.buyers (lower(code)) "
        "where deleted_at is null"
    )
    op.execute(
        "create unique index buyers_name_active_key "
        "on public.buyers (lower(name)) "
        "where deleted_at is null"
    )

    op.create_table(
        "units",
        _uuid_pk(),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        *_timestamps(),
        *_soft_delete(),
        *_audit_fields(),
        sa.CheckConstraint("length(trim(code)) > 0", name="units_code_not_blank"),
        sa.CheckConstraint("length(trim(name)) > 0", name="units_name_not_blank"),
    )
    op.create_index("units_is_active_idx", "units", ["is_active"])
    op.create_index("units_deleted_at_idx", "units", ["deleted_at"])
    op.create_index("units_created_by_user_id_idx", "units", ["created_by_user_id"])
    op.execute(
        "create unique index units_code_active_key "
        "on public.units (lower(code)) "
        "where deleted_at is null"
    )
    op.execute(
        "create unique index units_name_active_key "
        "on public.units (lower(name)) "
        "where deleted_at is null"
    )

    op.create_table(
        "report_types",
        _uuid_pk(),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("excel_template_key", sa.String(length=255), nullable=True),
        sa.Column(
            "metric_schema",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        *_timestamps(),
        *_soft_delete(),
        *_audit_fields(),
        sa.CheckConstraint("length(trim(code)) > 0", name="report_types_code_not_blank"),
        sa.CheckConstraint("length(trim(name)) > 0", name="report_types_name_not_blank"),
        sa.CheckConstraint("version > 0", name="report_types_version_positive"),
    )
    op.create_index("report_types_is_active_idx", "report_types", ["is_active"])
    op.create_index("report_types_deleted_at_idx", "report_types", ["deleted_at"])
    op.create_index("report_types_created_by_user_id_idx", "report_types", ["created_by_user_id"])
    op.execute(
        "create unique index report_types_code_version_active_key "
        "on public.report_types (lower(code), version) where deleted_at is null"
    )

    op.create_table(
        "uploaded_files",
        _uuid_pk(),
        sa.Column(
            "uploaded_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "buyer_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("buyers.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "unit_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("units.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "report_type_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("report_types.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("original_filename", sa.String(length=512), nullable=False),
        sa.Column("storage_bucket", sa.String(length=128), nullable=False),
        sa.Column("storage_path", sa.String(length=1024), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=True),
        sa.Column("file_size_bytes", sa.Integer(), nullable=True),
        sa.Column("checksum_sha256", sa.String(length=64), nullable=True),
        sa.Column(
            "status", sa.String(length=32), nullable=False, server_default=sa.text("'uploaded'")
        ),
        sa.Column("processing_error", sa.Text(), nullable=True),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        *_timestamps(),
        *_soft_delete(),
        sa.CheckConstraint(
            "status in ('uploaded', 'processing', 'processed', 'failed')",
            name="uploaded_files_status_check",
        ),
        sa.CheckConstraint(
            "length(trim(original_filename)) > 0", name="uploaded_files_name_not_blank"
        ),
        sa.CheckConstraint(
            "length(trim(storage_bucket)) > 0", name="uploaded_files_bucket_not_blank"
        ),
        sa.CheckConstraint("length(trim(storage_path)) > 0", name="uploaded_files_path_not_blank"),
        sa.CheckConstraint(
            "file_size_bytes is null or file_size_bytes >= 0",
            name="uploaded_files_size_nonnegative",
        ),
    )
    op.create_index(
        "uploaded_files_uploaded_by_user_id_idx", "uploaded_files", ["uploaded_by_user_id"]
    )
    op.create_index("uploaded_files_report_type_id_idx", "uploaded_files", ["report_type_id"])
    op.create_index("uploaded_files_buyer_id_idx", "uploaded_files", ["buyer_id"])
    op.create_index("uploaded_files_unit_id_idx", "uploaded_files", ["unit_id"])
    op.create_index("uploaded_files_status_idx", "uploaded_files", ["status"])
    op.create_index("uploaded_files_created_at_idx", "uploaded_files", ["created_at"])
    op.execute(
        "create unique index uploaded_files_storage_path_key "
        "on public.uploaded_files (storage_bucket, storage_path) where deleted_at is null"
    )

    op.create_table(
        "reports",
        _uuid_pk(),
        sa.Column(
            "report_type_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("report_types.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "buyer_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("buyers.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "unit_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("units.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "source_file_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("uploaded_files.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "owner_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("report_date", sa.Date(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=True),
        sa.Column("period_end", sa.Date(), nullable=True),
        sa.Column(
            "status", sa.String(length=32), nullable=False, server_default=sa.text("'draft'")
        ),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "submitted_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "approved_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
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
            "status in ('draft', 'submitted', 'approved', 'rejected', 'archived')",
            name="reports_status_check",
        ),
        sa.CheckConstraint(
            "period_start is null or period_end is null or period_start <= period_end",
            name="reports_period_order_check",
        ),
    )
    op.create_index("reports_report_date_idx", "reports", ["report_date"])
    op.create_index("reports_report_type_date_idx", "reports", ["report_type_id", "report_date"])
    op.create_index(
        "reports_buyer_unit_date_idx", "reports", ["buyer_id", "unit_id", "report_date"]
    )
    op.create_index("reports_status_idx", "reports", ["status"])
    op.create_index("reports_owner_user_id_idx", "reports", ["owner_user_id"])
    op.create_index("reports_created_by_user_id_idx", "reports", ["created_by_user_id"])
    op.create_index("reports_source_file_id_idx", "reports", ["source_file_id"])
    op.create_index("reports_deleted_at_idx", "reports", ["deleted_at"])
    op.execute(
        "create unique index reports_active_natural_key "
        "on public.reports (report_type_id, buyer_id, unit_id, report_date) "
        "where deleted_at is null"
    )

    op.create_table(
        "report_rows",
        _uuid_pk(),
        sa.Column(
            "report_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("reports.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "owner_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("row_key", sa.String(length=128), nullable=True),
        sa.Column("row_label", sa.String(length=255), nullable=True),
        sa.Column("row_group", sa.String(length=128), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("source_sheet_name", sa.String(length=255), nullable=True),
        sa.Column("source_row_number", sa.Integer(), nullable=True),
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
            "source_row_number is null or source_row_number > 0",
            name="report_rows_source_row_positive",
        ),
    )
    op.create_index(
        "report_rows_report_id_sort_order_idx", "report_rows", ["report_id", "sort_order"]
    )
    op.create_index("report_rows_report_id_group_idx", "report_rows", ["report_id", "row_group"])
    op.create_index("report_rows_owner_user_id_idx", "report_rows", ["owner_user_id"])
    op.create_index("report_rows_created_by_user_id_idx", "report_rows", ["created_by_user_id"])
    op.create_index("report_rows_deleted_at_idx", "report_rows", ["deleted_at"])
    op.execute(
        "create unique index report_rows_report_row_key_active_key "
        "on public.report_rows (report_id, row_key) "
        "where row_key is not null and deleted_at is null"
    )

    op.create_table(
        "report_metrics",
        _uuid_pk(),
        sa.Column(
            "report_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("reports.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "row_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("report_rows.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("metric_key", sa.String(length=128), nullable=False),
        sa.Column("metric_label", sa.String(length=255), nullable=True),
        sa.Column("value_type", sa.String(length=32), nullable=False),
        sa.Column("value_numeric", sa.Numeric(18, 4), nullable=True),
        sa.Column("value_text", sa.Text(), nullable=True),
        sa.Column("value_date", sa.Date(), nullable=True),
        sa.Column("value_boolean", sa.Boolean(), nullable=True),
        sa.Column("unit_of_measure", sa.String(length=64), nullable=True),
        sa.Column("source_sheet_name", sa.String(length=255), nullable=True),
        sa.Column("source_cell_address", sa.String(length=32), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        *_timestamps(),
        *_soft_delete(),
        *_audit_fields(),
        sa.CheckConstraint("length(trim(metric_key)) > 0", name="report_metrics_key_not_blank"),
        sa.CheckConstraint(
            "value_type in ('text', 'number', 'date', 'boolean')",
            name="report_metrics_value_type_check",
        ),
        sa.CheckConstraint(
            """
            (
              value_type = 'number'
              and value_numeric is not null
              and value_text is null
              and value_date is null
              and value_boolean is null
            )
            or (
              value_type = 'text'
              and value_text is not null
              and value_numeric is null
              and value_date is null
              and value_boolean is null
            )
            or (
              value_type = 'date'
              and value_date is not null
              and value_numeric is null
              and value_text is null
              and value_boolean is null
            )
            or (
              value_type = 'boolean'
              and value_boolean is not null
              and value_numeric is null
              and value_text is null
              and value_date is null
            )
            """,
            name="report_metrics_single_typed_value_check",
        ),
    )
    op.create_index(
        "report_metrics_report_id_metric_key_idx", "report_metrics", ["report_id", "metric_key"]
    )
    op.create_index(
        "report_metrics_report_id_sort_order_idx", "report_metrics", ["report_id", "sort_order"]
    )
    op.create_index("report_metrics_metric_key_idx", "report_metrics", ["metric_key"])
    op.create_index(
        "report_metrics_value_numeric_idx", "report_metrics", ["metric_key", "value_numeric"]
    )
    op.create_index(
        "report_metrics_created_by_user_id_idx", "report_metrics", ["created_by_user_id"]
    )
    op.create_index("report_metrics_deleted_at_idx", "report_metrics", ["deleted_at"])
    op.execute(
        "create unique index report_metrics_row_metric_active_key "
        "on public.report_metrics (row_id, metric_key) "
        "where row_id is not null and deleted_at is null"
    )
    op.execute(
        "create unique index report_metrics_report_metric_active_key "
        "on public.report_metrics (report_id, metric_key) "
        "where row_id is null and deleted_at is null"
    )

    op.add_column(
        "audit_logs",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.add_column("audit_logs", sa.Column("request_id", sa.String(length=128), nullable=True))
    op.add_column("audit_logs", sa.Column("ip_address", sa.String(length=64), nullable=True))
    op.add_column("audit_logs", sa.Column("user_agent", sa.Text(), nullable=True))
    op.add_column(
        "audit_logs",
        sa.Column(
            "old_values",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.add_column(
        "audit_logs",
        sa.Column(
            "new_values",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.create_index("audit_logs_request_id_idx", "audit_logs", ["request_id"])

    for table_name in (*REPORT_TABLES, "audit_logs"):
        _create_updated_at_trigger(table_name)

    for table_name in REPORT_TABLES:
        op.execute(f"alter table public.{table_name} enable row level security")

    op.execute(
        """
        create policy "Admins manage buyers"
        on public.buyers for all
        to authenticated
        using (
          exists (
            select 1 from public.users u
            join public.roles r on r.id = u.role_id
            where u.id = auth.uid() and u.is_active = true and r.name = 'admin'
          )
        )
        with check (
          exists (
            select 1 from public.users u
            join public.roles r on r.id = u.role_id
            where u.id = auth.uid() and u.is_active = true and r.name = 'admin'
          )
        )
        """
    )
    op.execute(
        """
        create policy "Authenticated users read buyers"
        on public.buyers for select
        to authenticated
        using (deleted_at is null and is_active = true)
        """
    )
    op.execute(
        """
        create policy "Admins manage units"
        on public.units for all
        to authenticated
        using (
          exists (
            select 1 from public.users u
            join public.roles r on r.id = u.role_id
            where u.id = auth.uid() and u.is_active = true and r.name = 'admin'
          )
        )
        with check (
          exists (
            select 1 from public.users u
            join public.roles r on r.id = u.role_id
            where u.id = auth.uid() and u.is_active = true and r.name = 'admin'
          )
        )
        """
    )
    op.execute(
        """
        create policy "Authenticated users read units"
        on public.units for select
        to authenticated
        using (deleted_at is null and is_active = true)
        """
    )
    op.execute(
        """
        create policy "Admins manage report types"
        on public.report_types for all
        to authenticated
        using (
          exists (
            select 1 from public.users u
            join public.roles r on r.id = u.role_id
            where u.id = auth.uid() and u.is_active = true and r.name = 'admin'
          )
        )
        with check (
          exists (
            select 1 from public.users u
            join public.roles r on r.id = u.role_id
            where u.id = auth.uid() and u.is_active = true and r.name = 'admin'
          )
        )
        """
    )
    op.execute(
        """
        create policy "Authenticated users read report types"
        on public.report_types for select
        to authenticated
        using (deleted_at is null and is_active = true)
        """
    )
    op.execute(
        """
        create policy "Users read own uploads"
        on public.uploaded_files for select
        to authenticated
        using (
          uploaded_by_user_id = auth.uid()
          or exists (
            select 1 from public.users u
            join public.roles r on r.id = u.role_id
            where u.id = auth.uid() and u.is_active = true and r.name = 'admin'
          )
        )
        """
    )
    op.execute(
        """
        create policy "Users create own uploads"
        on public.uploaded_files for insert
        to authenticated
        with check (uploaded_by_user_id = auth.uid())
        """
    )
    op.execute(
        """
        create policy "Users read accessible reports"
        on public.reports for select
        to authenticated
        using (
          deleted_at is null
          and (
            owner_user_id = auth.uid()
            or created_by_user_id = auth.uid()
            or exists (
              select 1 from public.users u
              join public.roles r on r.id = u.role_id
              where u.id = auth.uid() and u.is_active = true and r.name = 'admin'
            )
            or exists (
              select 1 from public.user_permissions up
              where up.user_id = auth.uid()
                and up.permission = 'reports:read'
                and (
                  up.resource_id is null
                  or (up.resource_type = 'report' and up.resource_id = reports.id)
                )
            )
          )
        )
        """
    )
    op.execute(
        """
        create policy "Users create owned reports"
        on public.reports for insert
        to authenticated
        with check (
          owner_user_id = auth.uid()
          and created_by_user_id = auth.uid()
        )
        """
    )
    op.execute(
        """
        create policy "Users read accessible report rows"
        on public.report_rows for select
        to authenticated
        using (
          deleted_at is null
          and exists (
            select 1 from public.reports r
            where r.id = report_rows.report_id
              and r.deleted_at is null
              and (
                r.owner_user_id = auth.uid()
                or r.created_by_user_id = auth.uid()
                or report_rows.owner_user_id = auth.uid()
                or exists (
                  select 1 from public.users u
                  join public.roles role on role.id = u.role_id
                  where u.id = auth.uid() and u.is_active = true and role.name = 'admin'
                )
                or exists (
                  select 1 from public.user_permissions up
                  where up.user_id = auth.uid()
                    and up.permission = 'reports:read'
                    and (
                      up.resource_id is null
                      or (up.resource_type = 'report' and up.resource_id = r.id)
                    )
                )
              )
          )
        )
        """
    )
    op.execute(
        """
        create policy "Users read accessible report metrics"
        on public.report_metrics for select
        to authenticated
        using (
          deleted_at is null
          and exists (
            select 1 from public.reports r
            where r.id = report_metrics.report_id
              and r.deleted_at is null
              and (
                r.owner_user_id = auth.uid()
                or r.created_by_user_id = auth.uid()
                or exists (
                  select 1 from public.users u
                  join public.roles role on role.id = u.role_id
                  where u.id = auth.uid() and u.is_active = true and role.name = 'admin'
                )
                or exists (
                  select 1 from public.user_permissions up
                  where up.user_id = auth.uid()
                    and up.permission = 'reports:read'
                    and (
                      up.resource_id is null
                      or (up.resource_type = 'report' and up.resource_id = r.id)
                    )
                )
              )
          )
        )
        """
    )


def downgrade() -> None:
    op.drop_index("audit_logs_request_id_idx", table_name="audit_logs")
    op.drop_column("audit_logs", "new_values")
    op.drop_column("audit_logs", "old_values")
    op.drop_column("audit_logs", "user_agent")
    op.drop_column("audit_logs", "ip_address")
    op.drop_column("audit_logs", "request_id")
    op.drop_column("audit_logs", "updated_at")

    for table_name in (*REPORT_TABLES, "audit_logs"):
        _drop_updated_at_trigger(table_name)

    op.drop_table("report_metrics")
    op.drop_table("report_rows")
    op.drop_table("reports")
    op.drop_table("uploaded_files")
    op.drop_table("report_types")
    op.drop_table("units")
    op.drop_table("buyers")
