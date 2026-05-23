from enum import StrEnum

ACCESS_TOKEN_COOKIE = "qad_access_token"
REFRESH_TOKEN_COOKIE = "qad_refresh_token"


class UserRole(StrEnum):
    ADMIN = "admin"
    EDITOR = "editor"
    VIEWER = "viewer"


class Permission(StrEnum):
    REPORTS_READ = "reports:read"
    REPORTS_EDIT = "reports:edit"
    USERS_MANAGE = "users:manage"
