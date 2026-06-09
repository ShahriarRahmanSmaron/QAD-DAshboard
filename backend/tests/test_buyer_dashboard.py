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
        return [MockMapping(r) if isinstance(r, dict) else r for r in self._val_or_rows]

    def mappings(self):
        if isinstance(self._val_or_rows, list):
            return MockMappings(self._val_or_rows)
        return MockMappings([self._val_or_rows])


@pytest.mark.asyncio
async def test_get_buyer_dashboard_bootstrap(mock_user):
    session = AsyncMock()

    # Mock report type query
    rt = ReportType(id=uuid4(), code="wf_test_and_shade", name="WF Test & Shade")
    rt_res = MockResult(rt)

    # Mock latest date query
    date_res = MockResult(date(2026, 5, 20))

    # Mock get_user_buyer_filter list of buyers
    buyer_res = MockResult([{"buyer_name": "George"}, {"buyer_name": "H&M"}])

    session.execute.side_effect = [rt_res, date_res, buyer_res]

    response = await get_buyer_dashboard_bootstrap(session, mock_user)

    assert response.default_report_type_id == rt.id
    assert response.latest_date == "2026-05-20"
    assert len(response.available_reports) == 1
    assert response.available_reports[0].name == "WF Test & Shade"
    assert len(response.available_buyers) == 2
    assert response.available_buyers[0].name == "George"


@pytest.mark.asyncio
async def test_get_buyer_qad_analysis_forbidden(mock_user):
    session = AsyncMock()

    # User only has access to George, but requests H&M
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

    # User has access to George
    buyer_res = MockResult([{"buyer_name": "George"}])
    # Count query returns 0 records
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

    buyer_res = MockResult([{"buyer_name": "George"}])
    count_res = MockResult(10)
    # Diagnostic keys query returns rows of (key, count) tuples
    diag_keys_res = MockResult([
        ("wait_for_test", 50),
        ("pass", 50),
        ("fail", 50),
        ("total_weight", 50),
    ])

    # 6 metrics queries
    metric_values = [
        Decimal("2561"),  # wait_for_test
        Decimal("94.2"),  # pass_pct
        Decimal("3.8"),   # fail_pct
        Decimal("1.1"),   # need_approval_pct
        Decimal("0.9"),   # no_app_pct
        Decimal("3245"),  # total_weight
    ]
    side_effects = [buyer_res, count_res, diag_keys_res]
    for val in metric_values:
        side_effects.append(MockResult(val))

    session.execute.side_effect = side_effects

    response = await get_buyer_qad_analysis(
        session=session,
        user=mock_user,
        report_type_id=uuid4(),
        buyer="George",
        date=date(2026, 5, 20),
    )

    assert response is not None
    assert len(response.cards) == 6
    assert response.cards[0].key == "wait_for_test"
    assert response.cards[0].value == 2561.0
    assert response.cards[1].key == "pass_pct"
    assert response.cards[1].value == 94.2
