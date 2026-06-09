from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.auth.constants import UserRole
from app.auth.schemas import AuthUser
from app.api.buyer_dashboard import (
    get_buyer_dashboard_bootstrap,
    get_buyer_qad_analysis,
)
from app.reporting.models import ReportType


@pytest.fixture
def mock_user():
    return AuthUser(
        id=uuid4(),
        email="buyer@example.com",
        role=UserRole.VIEWER,
        is_active=True,
        permissions=["buyers:access"],
    )


@pytest.fixture
def mock_admin():
    return AuthUser(
        id=uuid4(),
        email="admin@example.com",
        role=UserRole.ADMIN,
        is_active=True,
        permissions=[],
    )


class MockMapping:
    def __init__(self, data):
        self._data = data
        for k, v in data.items():
            setattr(self, k, v)

    def __getitem__(self, item):
        return self._data[item]

    @property
    def _mapping(self):
        return self._data


class MockMappings:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return [MockMapping(r) if isinstance(r, dict) else r for r in self._rows]


class MockResult:
    def __init__(self, val_or_rows):
        self._val_or_rows = val_or_rows

    def scalar_one_or_none(self):
        return self._val_or_rows

    def scalar_one(self):
        return self._val_or_rows

    def one(self):
        return MockMapping(self._val_or_rows) if isinstance(self._val_or_rows, dict) else self._val_or_rows

    def all(self):
        if isinstance(self._val_or_rows, list):
            return [MockMapping(r) if isinstance(r, dict) else r for r in self._val_or_rows]
        return [MockMapping(self._val_or_rows) if isinstance(self._val_or_rows, dict) else self._val_or_rows]

    def mappings(self):
        if isinstance(self._val_or_rows, list):
            return MockMappings(self._val_or_rows)
        return MockMappings([self._val_or_rows])


@pytest.mark.asyncio
async def test_get_buyer_dashboard_bootstrap(mock_user):
    session = AsyncMock()

    rt = ReportType(id=uuid4(), code="wf_test_and_shade", name="WF Test & Shade")
    rt_res = MockResult(rt)

    date_res = MockResult(date(2026, 5, 20))

    buyer_res = MockResult([{"buyer_name": "George"}, {"buyer_name": "H&M"}])

    session.execute.side_effect = [rt_res, date_res, buyer_res]

    response = await get_buyer_dashboard_bootstrap(session, mock_user)

    assert response.default_report_type_id == rt.id
    assert response.latest_date == "2026-05-20"
    assert response.report_type_name == "WF Test & Shade"
    assert response.default_analysis_metric == "wait_for_test"
    assert response.primary_metrics == ["t_stock", "wait_for_test", "wait_for_shade", "wait_for_rfd"]
    assert len(response.available_reports) == 1
    assert response.available_reports[0].name == "WF Test & Shade"
    assert len(response.available_buyers) == 2
    assert response.available_buyers[0].name == "George"


@pytest.mark.asyncio
async def test_get_buyer_qad_analysis_forbidden(mock_user):
    session = AsyncMock()

    buyer_res = MockResult([{"buyer_name": "George"}])
    session.execute.side_effect = [buyer_res]

    with pytest.raises(HTTPException) as exc_info:
        await get_buyer_qad_analysis(
            session=session,
            user=mock_user,
            report_type_id=uuid4(),
            buyer="H&M",
            date=date(2026, 5, 20),
        )

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_get_buyer_qad_analysis_no_data(mock_user):
    session = AsyncMock()

    buyer_res = MockResult([{"buyer_name": "George"}])
    count_res = MockResult(0)

    session.execute.side_effect = [buyer_res, count_res]

    response = await get_buyer_qad_analysis(
        session=session,
        user=mock_user,
        report_type_id=uuid4(),
        buyer="George",
        date=date(2026, 5, 20),
    )

    assert response is None


@pytest.mark.asyncio
async def test_get_buyer_qad_analysis_with_data(mock_user):
    session = AsyncMock()
    report_type_id = uuid4()

    buyer_res = MockResult([{"buyer_name": "George"}])
    count_res = MockResult(10)
    rt_name_res = MockResult("WF Test & Shade")

    # Discovery query: (metric_key, metric_label, unit_of_measure)
    discovery_res = MockResult([
        ("t_stock", "T Stock", "kg"),
        ("wait_for_test", "Wait For Test", "kg"),
        ("wait_for_shade", "Wait For Shade", "kg"),
        ("wait_for_rfd", "Wait For RFD", "kg"),
    ])

    # 4 metric aggregation queries (one per discovered metric)
    metric_values = [
        Decimal("1500"),   # t_stock (display_order=1)
        Decimal("2561"),   # wait_for_test (display_order=2)
        Decimal("1200"),   # wait_for_shade (display_order=3)
        Decimal("800"),    # wait_for_rfd (display_order=4)
    ]

    side_effects = [buyer_res, count_res, rt_name_res, discovery_res]
    for val in metric_values:
        side_effects.append(MockResult(val))

    session.execute.side_effect = side_effects

    response = await get_buyer_qad_analysis(
        session=session,
        user=mock_user,
        report_type_id=report_type_id,
        buyer="George",
        date=date(2026, 5, 20),
    )

    assert response is not None
    assert response.report_type == "WF Test & Shade"
    assert response.report_date == "2026-05-20"
    assert response.buyer == "George"
    assert len(response.cards) == 4

    # Cards sorted by display_order
    assert response.cards[0].key == "t_stock"
    assert response.cards[0].value == 1500.0
    assert response.cards[0].label == "T Stock"
    assert response.cards[0].unit == "kg"
    assert response.cards[0].display_format == "number"
    assert response.cards[0].display_order == 1

    assert response.cards[1].key == "wait_for_test"
    assert response.cards[1].value == 2561.0

    assert response.cards[2].key == "wait_for_shade"
    assert response.cards[3].key == "wait_for_rfd"


@pytest.mark.asyncio
async def test_get_buyer_qad_analysis_with_compare(mock_user):
    session = AsyncMock()
    report_type_id = uuid4()

    buyer_res = MockResult([{"buyer_name": "George"}])
    count_res = MockResult(10)
    rt_name_res = MockResult("WF Test & Shade")

    discovery_res = MockResult([
        ("wait_for_test", "Wait For Test", "kg"),
        ("t_stock", "T Stock", "kg"),
    ])

    # Values interleaved: current then prev per metric, sorted by display_order (t_stock first, wait_for_test second)
    # t_stock (display_order=1): current=1500, prev=1450
    # wait_for_test (display_order=2): current=2561, prev=2400
    metric_values = [
        Decimal("1500"),   # t_stock current
        Decimal("1450"),   # t_stock compare
        Decimal("2561"),   # wait_for_test current
        Decimal("2400"),   # wait_for_test compare
    ]

    side_effects = [buyer_res, count_res, rt_name_res, discovery_res]
    for val in metric_values:
        side_effects.append(MockResult(val))

    session.execute.side_effect = side_effects

    response = await get_buyer_qad_analysis(
        session=session,
        user=mock_user,
        report_type_id=report_type_id,
        buyer="George",
        date=date(2026, 5, 20),
        compare_date=date(2026, 5, 13),
    )

    assert response is not None
    assert len(response.cards) == 2

    # Sorted by display_order: t_stock (1), wait_for_test (2)
    assert response.cards[0].key == "t_stock"
    assert response.cards[0].value == 1500.0
    assert response.cards[0].previous_value == 1450.0
    assert response.cards[0].delta == 50.0

    assert response.cards[1].key == "wait_for_test"
    assert response.cards[1].value == 2561.0
    assert response.cards[1].previous_value == 2400.0
    assert response.cards[1].delta == 161.0


@pytest.mark.asyncio
async def test_get_buyer_qad_analysis_unregistered_metric(mock_user):
    """Unregistered metrics default to SUM aggregation, display_format='number', display_order=999."""
    session = AsyncMock()
    report_type_id = uuid4()

    buyer_res = MockResult([{"buyer_name": "George"}])
    count_res = MockResult(5)
    rt_name_res = MockResult("Unknown Report")

    # Discovery includes an unregistered metric
    discovery_res = MockResult([
        ("new_metric_xyz", "New Metric XYZ", "pcs"),
        ("wait_for_test", "Wait For Test", "kg"),
    ])

    side_effects = [buyer_res, count_res, rt_name_res, discovery_res]
    # Sorted order: wait_for_test (display_order=2) first, then new_metric_xyz (display_order=999)
    side_effects.append(MockResult(Decimal("2561")))   # wait_for_test (SUM)
    side_effects.append(MockResult(Decimal("500")))    # new_metric_xyz (SUM)

    session.execute.side_effect = side_effects

    response = await get_buyer_qad_analysis(
        session=session,
        user=mock_user,
        report_type_id=report_type_id,
        buyer="George",
        date=date(2026, 5, 20),
    )

    assert response is not None
    assert len(response.cards) == 2

    # Registered metric comes first (display_order=2 vs 999)
    assert response.cards[0].key == "wait_for_test"
    assert response.cards[0].display_order == 2

    # Unregistered metric gets defaults
    unreg = response.cards[1]
    assert unreg.key == "new_metric_xyz"
    assert unreg.display_format == "number"
    assert unreg.display_order == 999
    assert unreg.unit == "pcs"
    assert unreg.value == 500.0


@pytest.mark.asyncio
async def test_get_buyer_qad_analysis_empty_discovery(mock_user):
    """When discovery returns no metrics, response is None."""
    session = AsyncMock()
    report_type_id = uuid4()

    buyer_res = MockResult([{"buyer_name": "George"}])
    count_res = MockResult(5)
    rt_name_res = MockResult("WF Test & Shade")
    discovery_res = MockResult([])  # empty

    session.execute.side_effect = [buyer_res, count_res, rt_name_res, discovery_res]

    response = await get_buyer_qad_analysis(
        session=session,
        user=mock_user,
        report_type_id=report_type_id,
        buyer="George",
        date=date(2026, 5, 20),
    )

    assert response is None
