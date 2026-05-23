from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ReportStatus(StrEnum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"
    ARCHIVED = "archived"


class UploadedFileStatus(StrEnum):
    UPLOADED = "uploaded"
    PROCESSING = "processing"
    PROCESSED = "processed"
    FAILED = "failed"


class ReportValueType(StrEnum):
    TEXT = "text"
    NUMBER = "number"
    DATE = "date"
    BOOLEAN = "boolean"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )


class SoftDeleteMixin:
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
    )


class AuditFieldsMixin:
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
    )


class Buyer(TimestampMixin, SoftDeleteMixin, AuditFieldsMixin, Base):
    __tablename__ = "buyers"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    notes: Mapped[str | None] = mapped_column(Text)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata",
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )

    reports: Mapped[list[Report]] = relationship(back_populates="buyer")

    __table_args__ = (
        CheckConstraint("length(trim(code)) > 0", name="buyers_code_not_blank"),
        CheckConstraint("length(trim(name)) > 0", name="buyers_name_not_blank"),
        Index(
            "buyers_code_active_key",
            text("lower(code)"),
            unique=True,
            postgresql_where=text("deleted_at is null"),
        ),
        Index(
            "buyers_name_active_key",
            text("lower(name)"),
            unique=True,
            postgresql_where=text("deleted_at is null"),
        ),
        Index("buyers_is_active_idx", "is_active"),
        Index("buyers_deleted_at_idx", "deleted_at"),
    )


class Unit(TimestampMixin, SoftDeleteMixin, AuditFieldsMixin, Base):
    __tablename__ = "units"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata",
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )

    reports: Mapped[list[Report]] = relationship(back_populates="unit")

    __table_args__ = (
        CheckConstraint("length(trim(code)) > 0", name="units_code_not_blank"),
        CheckConstraint("length(trim(name)) > 0", name="units_name_not_blank"),
        Index(
            "units_code_active_key",
            text("lower(code)"),
            unique=True,
            postgresql_where=text("deleted_at is null"),
        ),
        Index(
            "units_name_active_key",
            text("lower(name)"),
            unique=True,
            postgresql_where=text("deleted_at is null"),
        ),
        Index("units_is_active_idx", "is_active"),
        Index("units_deleted_at_idx", "deleted_at"),
    )


class ReportType(TimestampMixin, SoftDeleteMixin, AuditFieldsMixin, Base):
    __tablename__ = "report_types"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    excel_template_key: Mapped[str | None] = mapped_column(String(255))
    metric_schema: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))

    reports: Mapped[list[Report]] = relationship(back_populates="report_type")

    __table_args__ = (
        CheckConstraint("length(trim(code)) > 0", name="report_types_code_not_blank"),
        CheckConstraint("length(trim(name)) > 0", name="report_types_name_not_blank"),
        CheckConstraint("version > 0", name="report_types_version_positive"),
        Index(
            "report_types_code_version_active_key",
            text("lower(code)"),
            "version",
            unique=True,
            postgresql_where=text("deleted_at is null"),
        ),
        Index("report_types_is_active_idx", "is_active"),
        Index("report_types_deleted_at_idx", "deleted_at"),
    )


class UploadedFile(TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "uploaded_files"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    uploaded_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )
    buyer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("buyers.id", ondelete="SET NULL"),
    )
    unit_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("units.id", ondelete="SET NULL"),
    )
    report_type_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("report_types.id", ondelete="SET NULL"),
    )
    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    storage_bucket: Mapped[str] = mapped_column(String(128), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(255))
    file_size_bytes: Mapped[int | None] = mapped_column(Integer)
    checksum_sha256: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        server_default=text("'uploaded'"),
    )
    processing_error: Mapped[str | None] = mapped_column(Text)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata",
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )

    reports: Mapped[list[Report]] = relationship(back_populates="source_file")

    __table_args__ = (
        CheckConstraint(
            "status in ('uploaded', 'processing', 'processed', 'failed')",
            name="uploaded_files_status_check",
        ),
        CheckConstraint(
            "length(trim(original_filename)) > 0", name="uploaded_files_name_not_blank"
        ),
        CheckConstraint("length(trim(storage_bucket)) > 0", name="uploaded_files_bucket_not_blank"),
        CheckConstraint("length(trim(storage_path)) > 0", name="uploaded_files_path_not_blank"),
        CheckConstraint(
            "file_size_bytes is null or file_size_bytes >= 0",
            name="uploaded_files_size_nonnegative",
        ),
        Index(
            "uploaded_files_storage_path_key",
            "storage_bucket",
            "storage_path",
            unique=True,
            postgresql_where=text("deleted_at is null"),
        ),
        Index("uploaded_files_report_type_id_idx", "report_type_id"),
        Index("uploaded_files_buyer_id_idx", "buyer_id"),
        Index("uploaded_files_unit_id_idx", "unit_id"),
        Index("uploaded_files_status_idx", "status"),
        Index("uploaded_files_created_at_idx", "created_at"),
    )


class Report(TimestampMixin, SoftDeleteMixin, AuditFieldsMixin, Base):
    __tablename__ = "reports"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    report_type_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("report_types.id", ondelete="RESTRICT"),
        nullable=False,
    )
    buyer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("buyers.id", ondelete="RESTRICT"),
        nullable=False,
    )
    unit_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("units.id", ondelete="RESTRICT"),
        nullable=False,
    )
    source_file_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("uploaded_files.id", ondelete="SET NULL"),
    )
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )
    report_date: Mapped[date] = mapped_column(Date, nullable=False)
    period_start: Mapped[date | None] = mapped_column(Date)
    period_end: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default=text("'draft'"))
    title: Mapped[str | None] = mapped_column(String(255))
    remarks: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata",
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )

    buyer: Mapped[Buyer] = relationship(back_populates="reports")
    unit: Mapped[Unit] = relationship(back_populates="reports")
    report_type: Mapped[ReportType] = relationship(back_populates="reports")
    source_file: Mapped[UploadedFile | None] = relationship(back_populates="reports")
    rows: Mapped[list[ReportRow]] = relationship(
        back_populates="report", cascade="all, delete-orphan"
    )
    metrics: Mapped[list[ReportMetric]] = relationship(
        back_populates="report",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint(
            "status in ('draft', 'submitted', 'approved', 'rejected', 'archived')",
            name="reports_status_check",
        ),
        CheckConstraint(
            "period_start is null or period_end is null or period_start <= period_end",
            name="reports_period_order_check",
        ),
        Index(
            "reports_active_natural_key",
            "report_type_id",
            "buyer_id",
            "unit_id",
            "report_date",
            unique=True,
            postgresql_where=text("deleted_at is null"),
        ),
        Index("reports_report_date_idx", "report_date"),
        Index("reports_report_type_date_idx", "report_type_id", "report_date"),
        Index("reports_buyer_unit_date_idx", "buyer_id", "unit_id", "report_date"),
        Index("reports_status_idx", "status"),
        Index("reports_source_file_id_idx", "source_file_id"),
        Index("reports_deleted_at_idx", "deleted_at"),
    )


class ReportRow(TimestampMixin, SoftDeleteMixin, AuditFieldsMixin, Base):
    __tablename__ = "report_rows"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    report_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("reports.id", ondelete="CASCADE"),
        nullable=False,
    )
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )
    row_key: Mapped[str | None] = mapped_column(String(128))
    row_label: Mapped[str | None] = mapped_column(String(255))
    row_group: Mapped[str | None] = mapped_column(String(128))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    source_sheet_name: Mapped[str | None] = mapped_column(String(255))
    source_row_number: Mapped[int | None] = mapped_column(Integer)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata",
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )

    report: Mapped[Report] = relationship(back_populates="rows")
    metrics: Mapped[list[ReportMetric]] = relationship(
        back_populates="row",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint(
            "source_row_number is null or source_row_number > 0",
            name="report_rows_source_row_positive",
        ),
        Index(
            "report_rows_report_row_key_active_key",
            "report_id",
            "row_key",
            unique=True,
            postgresql_where=text("row_key is not null and deleted_at is null"),
        ),
        Index("report_rows_report_id_sort_order_idx", "report_id", "sort_order"),
        Index("report_rows_report_id_group_idx", "report_id", "row_group"),
        Index("report_rows_deleted_at_idx", "deleted_at"),
    )


class ReportMetric(TimestampMixin, SoftDeleteMixin, AuditFieldsMixin, Base):
    __tablename__ = "report_metrics"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    report_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("reports.id", ondelete="CASCADE"),
        nullable=False,
    )
    row_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("report_rows.id", ondelete="CASCADE"),
    )
    metric_key: Mapped[str] = mapped_column(String(128), nullable=False)
    metric_label: Mapped[str | None] = mapped_column(String(255))
    value_type: Mapped[str] = mapped_column(String(32), nullable=False)
    value_numeric: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    value_text: Mapped[str | None] = mapped_column(Text)
    value_date: Mapped[date | None] = mapped_column(Date)
    value_boolean: Mapped[bool | None] = mapped_column(Boolean)
    unit_of_measure: Mapped[str | None] = mapped_column(String(64))
    source_sheet_name: Mapped[str | None] = mapped_column(String(255))
    source_cell_address: Mapped[str | None] = mapped_column(String(32))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata",
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )

    report: Mapped[Report] = relationship(back_populates="metrics")
    row: Mapped[ReportRow | None] = relationship(back_populates="metrics")

    __table_args__ = (
        CheckConstraint("length(trim(metric_key)) > 0", name="report_metrics_key_not_blank"),
        CheckConstraint(
            "value_type in ('text', 'number', 'date', 'boolean')",
            name="report_metrics_value_type_check",
        ),
        CheckConstraint(
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
        Index(
            "report_metrics_row_metric_active_key",
            "row_id",
            "metric_key",
            unique=True,
            postgresql_where=text("row_id is not null and deleted_at is null"),
        ),
        Index(
            "report_metrics_report_metric_active_key",
            "report_id",
            "metric_key",
            unique=True,
            postgresql_where=text("row_id is null and deleted_at is null"),
        ),
        Index("report_metrics_report_id_metric_key_idx", "report_id", "metric_key"),
        Index("report_metrics_report_id_sort_order_idx", "report_id", "sort_order"),
        Index("report_metrics_metric_key_idx", "metric_key"),
        Index("report_metrics_value_numeric_idx", "metric_key", "value_numeric"),
        Index("report_metrics_deleted_at_idx", "deleted_at"),
    )


class AuditLog(TimestampMixin, Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    action: Mapped[str] = mapped_column(Text, nullable=False)
    entity_type: Mapped[str | None] = mapped_column(Text)
    entity_id: Mapped[str | None] = mapped_column(Text)
    target_type: Mapped[str] = mapped_column(Text, nullable=False)
    target_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    request_id: Mapped[str | None] = mapped_column(String(128))
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(Text)
    old_values: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )
    new_values: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata",
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )

    __table_args__ = (
        CheckConstraint("length(trim(action)) > 0", name="audit_logs_action_not_blank"),
        CheckConstraint("length(trim(target_type)) > 0", name="audit_logs_target_type_not_blank"),
        Index("audit_logs_actor_user_id_idx", "actor_user_id"),
        Index("audit_logs_actor_id_idx", "actor_id"),
        Index("audit_logs_entity_idx", "entity_type", "entity_id"),
        Index("audit_logs_target_idx", "target_type", "target_id"),
        Index("audit_logs_created_at_idx", "created_at"),
        Index("audit_logs_request_id_idx", "request_id"),
    )
