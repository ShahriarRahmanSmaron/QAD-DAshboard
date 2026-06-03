from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock
import pytest
from app.auth.schemas import AuthUser
from app.auth.constants import UserRole
from app.reporting.buyer_history_service import (
    get_buyer_history,
    get_buyer_presence_matrix,
    get_buyer_contribution,
    get_buyer_contribution_trend,
    get_buyer_unit_drilldown,
    get_buyer_date_comparison,
    get_buyer_ranking_trend,
    get_buyer_insights,
)

@pytest.fixture
def mock_user():
    return AuthUser(
        id="c5b8b981-d419-4822-a8c4-123456789abc",
        email="test@example.com",
        role=UserRole.ADMIN,
        is_active=True,
        permissions=["reports:read"],
    )

class MockMapping:
    def __init__(self, data):
        self._data = data
        # Allow dotted attribute access or dict mapping access
        for k, v in data.items():
            setattr(self, k, v)
    @property
    def _mapping(self):
        return self._data

class MockResult:
    def __init__(self, rows):
        self._rows = rows
    def all(self):
        return [MockMapping(r) if isinstance(r, dict) else r for r in self._rows]
    def one(self):
        return MockMapping(self._rows[0]) if isinstance(self._rows[0], dict) else self._rows[0]
    def scalar_one(self):
        return self._rows[0]
    def scalar_one_or_none(self):
        return self._rows[0] if self._rows else None

@pytest.mark.asyncio
async def test_get_buyer_history(mock_user):
    session = AsyncMock()
    
    # Mock active report dates query
    dates_result = MockResult([(date(2026, 5, 16),), (date(2026, 5, 17),), (date(2026, 5, 18),)])
    # Mock buyer data query
    buyer_data_result = MockResult([
        {"report_date": date(2026, 5, 16), "value": Decimal("100")},
        {"report_date": date(2026, 5, 18), "value": Decimal("150")},
    ])
    
    session.execute.side_effect = [dates_result, buyer_data_result]
    
    history = await get_buyer_history(session, mock_user, "NEXT", "wait_for_test")
    
    assert len(history) == 3
    assert history[0]["date"] == "2026-05-16"
    assert history[0]["value"] == 100.0
    assert history[0]["delta"] is None
    assert history[0]["is_present"] is True
    
    # 17-May is missing for NEXT, so value should be 0.0, delta: -100.0
    assert history[1]["date"] == "2026-05-17"
    assert history[1]["value"] == 0.0
    assert history[1]["delta"] == -100.0
    assert history[1]["percent_change"] == -100.0
    assert history[1]["is_present"] is False
    
    # 18-May value is 150.0, delta: 150.0 from 17-May (prev_val=0.0)
    assert history[2]["date"] == "2026-05-18"
    assert history[2]["value"] == 150.0
    assert history[2]["delta"] == 150.0
    assert history[2]["is_present"] is True

@pytest.mark.asyncio
async def test_get_buyer_presence_matrix(mock_user):
    session = AsyncMock()
    dates_result = MockResult([(date(2026, 5, 16),), (date(2026, 5, 17),)])
    presence_result = MockResult([(date(2026, 5, 17),)])
    session.execute.side_effect = [dates_result, presence_result]
    
    presence = await get_buyer_presence_matrix(session, mock_user, "NEXT")
    assert len(presence) == 2
    assert presence[0]["date"] == "2026-05-16"
    assert presence[0]["is_present"] is False
    assert presence[1]["date"] == "2026-05-17"
    assert presence[1]["is_present"] is True

@pytest.mark.asyncio
async def test_get_buyer_date_comparison(mock_user):
    session = AsyncMock()
    # Mock Date A value query then Date B value query
    session.execute.side_effect = [MockResult([Decimal("100")]), MockResult([Decimal("125")])]
    
    comp = await get_buyer_date_comparison(session, mock_user, "NEXT", "wait_for_test", date(2026, 5, 16), date(2026, 5, 20))
    assert comp["previous_value"] == 100.0
    assert comp["current_value"] == 125.0
    assert comp["delta"] == 25.0
    assert comp["percent_change"] == 25.0

@pytest.mark.asyncio
async def test_get_buyer_insights(mock_user):
    session = AsyncMock()
    dates_result = MockResult([(date(2026, 5, 16),), (date(2026, 5, 17),), (date(2026, 5, 18),)])
    buyer_data_result = MockResult([
        {"report_date": date(2026, 5, 16), "value": Decimal("100")},
        {"report_date": date(2026, 5, 17), "value": Decimal("150")},
        {"report_date": date(2026, 5, 18), "value": Decimal("120")},
    ])
    session.execute.side_effect = [dates_result, buyer_data_result]
    
    insights = await get_buyer_insights(session, mock_user, "NEXT", "wait_for_test")
    assert insights["largest_increase"]["delta"] == 50.0
    assert insights["largest_reduction"]["delta"] == -30.0
    assert insights["fastest_growth_pct"]["pct"] == 50.0

@pytest.mark.asyncio
async def test_get_buyer_ranking_trend(mock_user):
    session = AsyncMock()
    # Mock dates
    dates_result = MockResult([(date(2026, 5, 16),), (date(2026, 5, 17),)])
    # Mock all buyers data for ranking
    buyers_data_result = MockResult([
        {"date": date(2026, 5, 16), "buyer": "H&M", "value": Decimal("500")},
        {"date": date(2026, 5, 16), "buyer": "NEXT", "value": Decimal("300")},
        {"date": date(2026, 5, 17), "buyer": "NEXT", "value": Decimal("400")},
        {"date": date(2026, 5, 17), "buyer": "H&M", "value": Decimal("200")},
    ])
    session.execute.side_effect = [dates_result, buyers_data_result]
    
    ranks = await get_buyer_ranking_trend(session, mock_user, "NEXT", "wait_for_test")
    assert len(ranks) == 2
    # 16-May: H&M=500 (Rank 1), NEXT=300 (Rank 2)
    assert ranks[0]["date"] == "2026-05-16"
    assert ranks[0]["rank"] == 2
    # 17-May: NEXT=400 (Rank 1), H&M=200 (Rank 2)
    assert ranks[1]["date"] == "2026-05-17"
    assert ranks[1]["rank"] == 1
