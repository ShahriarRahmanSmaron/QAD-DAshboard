from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.core.logging_config import configure_logging
from app.core.middleware import RequestInstrumentationMiddleware

configure_logging()


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name)
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_headers=["*"],
        allow_methods=["*"],
        allow_origins=settings.cors_origins,
    )
    app.add_middleware(
        RequestInstrumentationMiddleware,
        slow_threshold_ms=settings.slow_request_threshold_ms,
    )
    app.include_router(api_router, prefix=settings.api_v1_prefix)
    return app


app = create_app()
