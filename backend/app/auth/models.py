"""SQLAlchemy stub for the externally-managed ``public.users`` table.

The ``users`` table is created and maintained by the Supabase SQL migrations
under ``supabase/migrations``. The reporting models declare foreign keys to
``users.id``, so SQLAlchemy needs to know the table exists in order to compute
table-insertion order and resolve FK targets when persisting ORM rows. Only the
columns that the reporting models reference are declared here; the rest of the
schema lives in the SQL migrations and is intentionally not duplicated.
"""

from __future__ import annotations

import uuid

from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
