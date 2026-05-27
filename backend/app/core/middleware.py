"""Lightweight request instrumentation middleware."""

import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("app.requests")

REQUEST_ID_HEADER = "X-Request-Id"
PROCESS_TIME_HEADER = "X-Process-Time-Ms"


class RequestInstrumentationMiddleware(BaseHTTPMiddleware):
    """Adds request-id, measures duration, and logs slow requests."""

    slow_threshold_ms: float

    def __init__(self, app, slow_threshold_ms: float = 500.0) -> None:  # noqa: ANN001
        super().__init__(app)
        self.slow_threshold_ms = slow_threshold_ms

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = request.headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex
        request.state.request_id = request_id

        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start) * 1000

        response.headers[REQUEST_ID_HEADER] = request_id
        response.headers[PROCESS_TIME_HEADER] = f"{duration_ms:.1f}"

        log_data = {
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "duration_ms": round(duration_ms, 1),
        }

        if duration_ms >= self.slow_threshold_ms:
            logger.warning(
                "slow request: %(method)s %(path)s %(status)s %(duration_ms).1fms",
                log_data,
            )
        else:
            logger.info("%(method)s %(path)s %(status)s %(duration_ms).1fms", log_data)

        return response
