from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

from app.auth.constants import Permission
from app.auth.service import has_explicit_permission


class MockResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


@pytest.mark.asyncio
async def test_has_explicit_permission_no_resource_filters():
    session = AsyncMock()
    session.execute.return_value = MockResult(1)

    result = await has_explicit_permission(
        session,
        user_id=uuid4(),
        permission=Permission.BUYERS_ACCESS,
        resource_type=None,
        resource_id=None,
    )

    assert result is True
    session.execute.assert_awaited_once()
    stmt = session.execute.await_args.args[0]
    compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    assert "resource_type" not in compiled
    assert "resource_id" not in compiled


@pytest.mark.asyncio
async def test_has_explicit_permission_resource_type_only():
    session = AsyncMock()
    session.execute.return_value = MockResult(1)

    result = await has_explicit_permission(
        session,
        user_id=uuid4(),
        permission=Permission.BUYERS_ACCESS,
        resource_type="buyer",
        resource_id=None,
    )

    assert result is True
    session.execute.assert_awaited_once()
    stmt = session.execute.await_args.args[0]
    compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    assert "'buyer'" in compiled
    assert "resource_id" not in compiled


@pytest.mark.asyncio
async def test_has_explicit_permission_both_resource_filters():
    session = AsyncMock()
    session.execute.return_value = MockResult(1)
    buyer_id = uuid4()

    result = await has_explicit_permission(
        session,
        user_id=uuid4(),
        permission=Permission.BUYERS_ACCESS,
        resource_type="buyer",
        resource_id=str(buyer_id),
    )

    assert result is True
    session.execute.assert_awaited_once()
    stmt = session.execute.await_args.args[0]
    compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    assert "'buyer'" in compiled
    assert "resource_id" in compiled


@pytest.mark.asyncio
async def test_has_explicit_permission_no_match():
    session = AsyncMock()
    session.execute.return_value = MockResult(None)

    result = await has_explicit_permission(
        session,
        user_id=uuid4(),
        permission=Permission.BUYERS_ACCESS,
    )

    assert result is False


@pytest.mark.asyncio
async def test_has_explicit_permission_coerces_resource_id_to_uuid():
    session = AsyncMock()
    session.execute.return_value = MockResult(1)
    resource_id_str = "00000000-0000-0000-0000-000000000001"
    resource_id_uuid = UUID(resource_id_str)

    result = await has_explicit_permission(
        session,
        user_id=uuid4(),
        permission=Permission.REPORTS_READ,
        resource_type="report",
        resource_id=resource_id_str,
    )

    assert result is True
    stmt = session.execute.await_args.args[0]
    assert stmt._where_criteria[-1].right.value == resource_id_uuid
