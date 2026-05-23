from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.auth.constants import Permission, UserRole

GLOBAL_ADMIN_PERMISSIONS = {Permission.REPORTS_READ, Permission.USERS_MANAGE}


class AdminUser(BaseModel):
    id: UUID
    email: str
    full_name: str | None = None
    role: UserRole
    is_active: bool
    is_provisioned: bool
    permissions: list[Permission]
    created_at: str
    updated_at: str


class AdminUserListResponse(BaseModel):
    users: list[AdminUser]
    total: int
    page: int
    page_size: int


class AdminRoleOption(BaseModel):
    id: int
    name: UserRole
    description: str


class AdminRoleListResponse(BaseModel):
    roles: list[AdminRoleOption]


class AdminUserCreateRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    full_name: str = Field(min_length=1, max_length=120)
    role: UserRole
    permissions: list[Permission] = Field(default_factory=list, max_length=10)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        email = value.strip().lower()
        if "@" not in email:
            raise ValueError("Enter a valid email address.")
        return email

    @field_validator("permissions")
    @classmethod
    def normalize_permissions(cls, value: list[Permission]) -> list[Permission]:
        permissions = set(value)
        if not permissions <= GLOBAL_ADMIN_PERMISSIONS:
            raise ValueError("Only reports:read and users:manage can be assigned globally.")
        return sorted(permissions, key=lambda permission: permission.value)


class AdminUserUpdateRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    role: UserRole
    is_active: bool
    permissions: list[Permission] = Field(default_factory=list, max_length=10)

    @field_validator("permissions")
    @classmethod
    def normalize_permissions(cls, value: list[Permission]) -> list[Permission]:
        permissions = set(value)
        if not permissions <= GLOBAL_ADMIN_PERMISSIONS:
            raise ValueError("Only reports:read and users:manage can be assigned globally.")
        return sorted(permissions, key=lambda permission: permission.value)


class AdminPasswordResetRequest(BaseModel):
    password: str = Field(min_length=8, max_length=256)


class AdminStatusResponse(BaseModel):
    ok: bool


class SupabaseAdminUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str | None = None
    user_metadata: dict[str, Any] | None = None
    created_at: object | None = None
    updated_at: object | None = None
