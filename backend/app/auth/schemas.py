from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.auth.constants import UserRole


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=256)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1)


class AuthUser(BaseModel):
    id: UUID
    email: str
    full_name: str | None = None
    role: UserRole
    permissions: list[str]


class AuthSessionResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    expires_at: int | None = None
    token_type: str
    user: AuthUser


class CurrentUserResponse(BaseModel):
    user: AuthUser


class AuthStatusResponse(BaseModel):
    ok: bool


class SupabaseSessionPayload(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    access_token: str
    refresh_token: str
    expires_in: int
    expires_at: int | None = None
    token_type: str
