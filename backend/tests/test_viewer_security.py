from uuid import uuid4
from sqlalchemy import true, select, func
from sqlalchemy.dialects import postgresql
from app.auth.constants import Permission, UserRole
from app.auth.schemas import AuthUser
from app.reporting.repository import get_fact_visibility_filter, _operational_fact_filters, OperationalFactFilters


def test_admin_fact_visibility_filter():
    user = AuthUser(
        id=uuid4(),
        email="admin@example.com",
        role=UserRole.ADMIN,
        permissions=[]
    )
    clause = get_fact_visibility_filter(user)
    assert clause.compare(true())


def test_editor_fact_visibility_filter():
    user = AuthUser(
        id=uuid4(),
        email="editor@example.com",
        role=UserRole.EDITOR,
        permissions=[]
    )
    clause = get_fact_visibility_filter(user)
    assert clause.compare(true())


def test_standard_viewer_fact_visibility_filter():
    user = AuthUser(
        id=uuid4(),
        email="viewer@example.com",
        role=UserRole.VIEWER,
        permissions=[]
    )
    clause = get_fact_visibility_filter(user)
    assert clause.compare(true())


def test_viewer_with_buyer_access_fact_visibility_filter():
    user_id = uuid4()
    user = AuthUser(
        id=user_id,
        email="viewer-buyer@example.com",
        role=UserRole.VIEWER,
        permissions=[Permission.BUYERS_ACCESS.value]
    )
    clause = get_fact_visibility_filter(user)
    assert clause is not None
    
    # Compile the expression using PostgreSQL dialect to verify structure
    dialect = postgresql.dialect()
    compiled_sql = str(clause.compile(dialect=dialect, compile_kwargs={"literal_binds": True}))
    
    # It should perform an IN check on lower(operational_facts.buyer) with subquery on user_buyers table
    assert "lower(operational_facts.buyer) IN" in compiled_sql
    assert "SELECT lower(user_buyers.buyer_name)" in compiled_sql
    assert f"user_buyers.user_id = '{user_id}'" in compiled_sql


def test_operational_fact_filters_does_not_apply_buyer_visibility():
    """General-purpose filters should NOT include buyer visibility (MD11-2.1)."""
    user = AuthUser(
        id=uuid4(),
        email="viewer@example.com",
        role=UserRole.VIEWER,
        permissions=[]
    )
    filters = OperationalFactFilters()
    clauses = _operational_fact_filters(user, filters)
    
    # Minimum clauses: fact.deleted_at, file.deleted_at + active/governance
    assert len(clauses) >= 2
    
    # Verify get_fact_visibility_filter is NOT in the general-purpose filters
    visibility_clause = get_fact_visibility_filter(user)
    has_visibility_clause = any(c.compare(visibility_clause) for c in clauses)
    assert has_visibility_clause is False
