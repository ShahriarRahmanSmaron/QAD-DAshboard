from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.reporting.models import ReportStatus, ReportValueType

JsonObject = dict[str, Any]


class ReportCreateRequest(BaseModel):
    report_type_id: UUID
    buyer_id: UUID
    unit_id: UUID
    report_date: date
    period_start: date | None = None
    period_end: date | None = None
    title: str | None = Field(default=None, max_length=255)
    remarks: str | None = None
    metadata: JsonObject = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_period(self) -> "ReportCreateRequest":
        if self.period_start and self.period_end and self.period_start > self.period_end:
            raise ValueError("period_start must be before or equal to period_end.")
        return self


class ReportRowCreateRequest(BaseModel):
    row_key: str | None = Field(default=None, min_length=1, max_length=128)
    row_label: str | None = Field(default=None, max_length=255)
    row_group: str | None = Field(default=None, max_length=128)
    sort_order: int = 0
    source_sheet_name: str | None = Field(default=None, max_length=255)
    source_row_number: int | None = Field(default=None, gt=0)
    metadata: JsonObject = Field(default_factory=dict)


class ReportMetricCreateRequest(BaseModel):
    row_id: UUID | None = None
    metric_key: str = Field(min_length=1, max_length=128)
    metric_label: str | None = Field(default=None, max_length=255)
    value_type: ReportValueType
    value_numeric: Decimal | None = None
    value_text: str | None = None
    value_date: date | None = None
    value_boolean: bool | None = None
    unit_of_measure: str | None = Field(default=None, max_length=64)
    source_sheet_name: str | None = Field(default=None, max_length=255)
    source_cell_address: str | None = Field(default=None, max_length=32)
    sort_order: int = 0
    metadata: JsonObject = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_single_typed_value(self) -> "ReportMetricCreateRequest":
        values = {
            ReportValueType.NUMBER: self.value_numeric,
            ReportValueType.TEXT: self.value_text,
            ReportValueType.DATE: self.value_date,
            ReportValueType.BOOLEAN: self.value_boolean,
        }
        if values[self.value_type] is None:
            raise ValueError(f"value_{self.value_type.value} is required for this metric type.")

        for value_type, value in values.items():
            if value_type != self.value_type and value is not None:
                raise ValueError("Only the matching typed value field may be set.")
        return self


class ReportMetricResponse(BaseModel):
    id: UUID
    report_id: UUID
    row_id: UUID | None
    metric_key: str
    metric_label: str | None
    value_type: ReportValueType
    value_numeric: Decimal | None
    value_text: str | None
    value_date: date | None
    value_boolean: bool | None
    unit_of_measure: str | None
    source_sheet_name: str | None
    source_cell_address: str | None
    sort_order: int
    metadata: JsonObject
    created_at: datetime
    updated_at: datetime


class ReportRowResponse(BaseModel):
    id: UUID
    report_id: UUID
    owner_user_id: UUID | None
    row_key: str | None
    row_label: str | None
    row_group: str | None
    sort_order: int
    source_sheet_name: str | None
    source_row_number: int | None
    metadata: JsonObject
    created_at: datetime
    updated_at: datetime
    metrics: list[ReportMetricResponse] = Field(default_factory=list)


class ReportResponse(BaseModel):
    id: UUID
    report_type_id: UUID
    report_type_name: str | None
    buyer_id: UUID
    buyer_name: str | None
    unit_id: UUID
    unit_name: str | None
    owner_user_id: UUID | None
    report_date: date
    period_start: date | None
    period_end: date | None
    status: ReportStatus
    title: str | None
    remarks: str | None
    metadata: JsonObject
    created_at: datetime
    updated_at: datetime
    rows: list[ReportRowResponse] = Field(default_factory=list)
    metrics: list[ReportMetricResponse] = Field(default_factory=list)


class ReportListResponse(BaseModel):
    reports: list[ReportResponse]
    total: int
    page: int
    page_size: int


# ---------------------------------------------------------------------------
# Lightweight summary DTO for list/grid views (no rows or metrics)
# ---------------------------------------------------------------------------


class ReportSummary(BaseModel):
    id: UUID
    report_type_id: UUID
    report_type_name: str | None
    buyer_id: UUID
    buyer_name: str | None
    unit_id: UUID
    unit_name: str | None
    owner_user_id: UUID | None
    report_date: date
    period_start: date | None
    period_end: date | None
    status: ReportStatus
    title: str | None
    remarks: str | None
    row_count: int
    metric_count: int
    created_at: datetime
    updated_at: datetime


class ReportSummaryListResponse(BaseModel):
    reports: list[ReportSummary]
    total: int
    page: int
    page_size: int


# ---------------------------------------------------------------------------
# Bulk save request: full report tree in one call
# ---------------------------------------------------------------------------


class BulkRowMetricCreate(BaseModel):
    """Metric nested inside a row for bulk save."""

    metric_key: str = Field(min_length=1, max_length=128)
    metric_label: str | None = Field(default=None, max_length=255)
    value_type: ReportValueType
    value_numeric: Decimal | None = None
    value_text: str | None = None
    value_date: date | None = None
    value_boolean: bool | None = None
    unit_of_measure: str | None = Field(default=None, max_length=64)
    source_sheet_name: str | None = Field(default=None, max_length=255)
    source_cell_address: str | None = Field(default=None, max_length=32)
    sort_order: int = 0
    metadata: JsonObject = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_single_typed_value(self) -> "BulkRowMetricCreate":
        values = {
            ReportValueType.NUMBER: self.value_numeric,
            ReportValueType.TEXT: self.value_text,
            ReportValueType.DATE: self.value_date,
            ReportValueType.BOOLEAN: self.value_boolean,
        }
        if values[self.value_type] is None:
            raise ValueError(f"value_{self.value_type.value} is required for this metric type.")
        for value_type, value in values.items():
            if value_type != self.value_type and value is not None:
                raise ValueError("Only the matching typed value field may be set.")
        return self


class BulkRowCreate(BaseModel):
    """Row with nested metrics for bulk save."""

    row_key: str | None = Field(default=None, min_length=1, max_length=128)
    row_label: str | None = Field(default=None, max_length=255)
    row_group: str | None = Field(default=None, max_length=128)
    sort_order: int = 0
    source_sheet_name: str | None = Field(default=None, max_length=255)
    source_row_number: int | None = Field(default=None, gt=0)
    metadata: JsonObject = Field(default_factory=dict)
    metrics: list[BulkRowMetricCreate] = Field(default_factory=list)


class BulkReportMetricCreate(BaseModel):
    """Report-level metric (not attached to a row) for bulk save."""

    metric_key: str = Field(min_length=1, max_length=128)
    metric_label: str | None = Field(default=None, max_length=255)
    value_type: ReportValueType
    value_numeric: Decimal | None = None
    value_text: str | None = None
    value_date: date | None = None
    value_boolean: bool | None = None
    unit_of_measure: str | None = Field(default=None, max_length=64)
    source_sheet_name: str | None = Field(default=None, max_length=255)
    source_cell_address: str | None = Field(default=None, max_length=32)
    sort_order: int = 0
    metadata: JsonObject = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_single_typed_value(self) -> "BulkReportMetricCreate":
        values = {
            ReportValueType.NUMBER: self.value_numeric,
            ReportValueType.TEXT: self.value_text,
            ReportValueType.DATE: self.value_date,
            ReportValueType.BOOLEAN: self.value_boolean,
        }
        if values[self.value_type] is None:
            raise ValueError(f"value_{self.value_type.value} is required for this metric type.")
        for value_type, value in values.items():
            if value_type != self.value_type and value is not None:
                raise ValueError("Only the matching typed value field may be set.")
        return self


class BulkReportSaveRequest(BaseModel):
    """Full report tree: header + rows (with metrics) + report-level metrics."""

    report_type_id: UUID
    buyer_id: UUID
    unit_id: UUID
    report_date: date
    period_start: date | None = None
    period_end: date | None = None
    title: str | None = Field(default=None, max_length=255)
    remarks: str | None = None
    metadata: JsonObject = Field(default_factory=dict)
    rows: list[BulkRowCreate] = Field(default_factory=list)
    metrics: list[BulkReportMetricCreate] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_period(self) -> "BulkReportSaveRequest":
        if self.period_start and self.period_end and self.period_start > self.period_end:
            raise ValueError("period_start must be before or equal to period_end.")
        return self


class BuyerOption(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    name: str
    is_active: bool


class UnitOption(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    name: str
    is_active: bool


class ReportTypeOption(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    name: str
    description: str | None
    version: int
    is_active: bool


class BuyerListResponse(BaseModel):
    buyers: list[BuyerOption]


class UnitListResponse(BaseModel):
    units: list[UnitOption]


class ReportTypeListResponse(BaseModel):
    report_types: list[ReportTypeOption]
