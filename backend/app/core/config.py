from functools import lru_cache
from pathlib import Path

from pydantic import AnyUrl, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    app_name: str = "DBL QAD Portal API"
    app_env: str = "local"
    api_v1_prefix: str = "/api/v1"
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/dbl_qad"
    supabase_url: AnyUrl | None = None
    supabase_anon_key: str | None = None
    supabase_service_role_key: str | None = None
    uploaded_workbook_storage_dir: str = "storage/uploads/workbooks"
    cors_origins_raw: str = Field(default="http://localhost:3000", alias="CORS_ORIGINS")
    slow_request_threshold_ms: float = 500.0
    slow_query_threshold_ms: float = 250.0

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins_raw.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
