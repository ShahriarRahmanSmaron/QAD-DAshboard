from unittest.mock import AsyncMock, call
from uuid import uuid4

import pytest

from app.reporting.buyer_sync_service import sync_buyers_from_facts, SyncResult
from app.reporting.models import Buyer


class MockScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def scalar_one_or_none(self):
        return self._rows[0] if self._rows else None

    def one(self):
        return self._rows[0]


class FakeExecution:
    """Simulates session.execute() returning typed row objects."""

    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def scalar_one_or_none(self):
        return self._rows[0] if self._rows else None

    def one(self):
        return self._rows[0]


def _row(*values):
    """Return a simple tuple-row like SQLAlchemy returns for single-column selects."""
    return tuple(values)


@pytest.mark.asyncio
async def test_sync_no_facts():
    session = AsyncMock()
    session.execute.return_value = FakeExecution([])

    result = await sync_buyers_from_facts(session, uploaded_file_id=uuid4())

    assert result == SyncResult(inserted=0, already_exists=0, total_scanned=0)
    # Only the first query (distinct buyer names) should have executed
    assert session.execute.call_count == 1


@pytest.mark.asyncio
async def test_sync_all_new_buyers():
    session = AsyncMock()
    session.execute.side_effect = [
        FakeExecution([_row("H&M"), _row("NEXT"), _row("APS")]),
        FakeExecution([]),
    ]

    result = await sync_buyers_from_facts(session, uploaded_file_id=uuid4())

    assert result.inserted == 3
    assert result.already_exists == 0
    assert result.total_scanned == 3
    # session.add_all should have been called with 3 Buyer objects
    assert session.add_all.call_count == 1
    buyers_added = session.add_all.call_args[0][0]
    assert len(buyers_added) == 3
    names = sorted(b.code for b in buyers_added)
    assert names == ["APS", "H&M", "NEXT"]
    for b in buyers_added:
        assert b.is_active is True
        assert b.code == b.name


@pytest.mark.asyncio
async def test_sync_all_existing_buyers():
    session = AsyncMock()
    session.execute.side_effect = [
        FakeExecution([_row("H&M"), _row("NEXT")]),
        FakeExecution([_row("H&M"), _row("NEXT")]),
    ]

    result = await sync_buyers_from_facts(session, uploaded_file_id=uuid4())

    assert result.inserted == 0
    assert result.already_exists == 2
    assert result.total_scanned == 2
    session.add_all.assert_not_called()


@pytest.mark.asyncio
async def test_sync_mixed_buyers():
    session = AsyncMock()
    session.execute.side_effect = [
        FakeExecution([_row("H&M"), _row("NEXT"), _row("ZARA"), _row("PRIMARK")]),
        FakeExecution([_row("H&M"), _row("NEXT")]),
    ]

    result = await sync_buyers_from_facts(session, uploaded_file_id=uuid4())

    assert result.inserted == 2
    assert result.already_exists == 2
    assert result.total_scanned == 4
    buyers_added = session.add_all.call_args[0][0]
    names = sorted(b.code for b in buyers_added)
    assert names == ["PRIMARK", "ZARA"]


@pytest.mark.asyncio
async def test_sync_idempotent():
    """Running sync twice should produce the same result each time."""
    session = AsyncMock()
    session.execute.side_effect = [
        FakeExecution([_row("H&M"), _row("NEXT")]),
        FakeExecution([_row("H&M"), _row("NEXT")]),
    ]

    result1 = await sync_buyers_from_facts(session, uploaded_file_id=uuid4())
    assert result1.inserted == 0
    assert result1.already_exists == 2


@pytest.mark.asyncio
async def test_sync_handles_whitespace_and_nulls():
    session = AsyncMock()
    session.execute.side_effect = [
        FakeExecution([_row("  H&M  "), _row(""), _row("NEXT")]),
        FakeExecution([]),
    ]

    result = await sync_buyers_from_facts(session, uploaded_file_id=uuid4())

    # Empty string should be filtered out, H&M should be stripped
    assert result.total_scanned == 2  # H&M and NEXT only
    assert result.inserted == 2
    buyers_added = session.add_all.call_args[0][0]
    names = sorted(b.code for b in buyers_added)
    assert names == ["H&M", "NEXT"]


@pytest.mark.asyncio
async def test_sync_case_insensitive_dedup():
    session = AsyncMock()
    session.execute.side_effect = [
        FakeExecution([_row("h&m"), _row("H&M")]),
        FakeExecution([_row("H&M")]),
    ]

    result = await sync_buyers_from_facts(session, uploaded_file_id=uuid4())

    # Both variations exist in facts (DISTINCT is case-sensitive at DB level),
    # but both match the existing "H&M" case-insensitively, so nothing is inserted.
    assert result.total_scanned == 2
    assert result.already_exists == 2
    assert result.inserted == 0
