"""Security middleware and utilities for OpenSentry.

Provides:
- SecurityHeadersMiddleware — adds standard security headers to every response
- RateLimitMiddleware — per-IP HTTP request rate limiting
- ConnectionTracker — tracks and limits concurrent WebSocket sessions
- ws_rate_check — per-connection message rate limiting helper
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app import config

logger = logging.getLogger("opensentry.security")


# ---------------------------------------------------------------------------
# Security headers
# ---------------------------------------------------------------------------


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add standard security headers to all HTTP responses."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=()"
        )
        # Content-Security-Policy — allow self + map tile servers
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "connect-src 'self' ws: wss:; "
            "img-src 'self' https://*.tile.openstreetmap.org https://server.arcgisonline.com data:; "
            "style-src 'self' 'unsafe-inline'; "
            "script-src 'self' 'unsafe-inline'"
        )
        return response


# ---------------------------------------------------------------------------
# HTTP rate limiting (in-memory, per-IP)
# ---------------------------------------------------------------------------


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple sliding-window rate limiter per client IP.

    Limits to ``config.HTTP_RATE_LIMIT`` requests per 60-second window.
    WebSocket upgrade requests are exempt (they have their own limits).
    """

    def __init__(self, app):
        super().__init__(app)
        # {ip: [timestamp, ...]}
        self._requests: dict[str, list[float]] = defaultdict(list)
        self._window = 60.0  # seconds

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Don't rate-limit WebSocket upgrades
        if request.headers.get("upgrade", "").lower() == "websocket":
            return await call_next(request)

        ip = _client_ip(request)
        now = time.monotonic()
        window_start = now - self._window

        # Prune old entries
        timestamps = self._requests[ip]
        self._requests[ip] = [t for t in timestamps if t > window_start]

        if len(self._requests[ip]) >= config.HTTP_RATE_LIMIT:
            retry_after = int(self._window - (now - self._requests[ip][0])) + 1
            logger.warning("Rate limit exceeded for %s (%d req/min)",
                           ip, len(self._requests[ip]))
            return JSONResponse(
                {"error": "Rate limit exceeded. Try again later."},
                status_code=429,
                headers={"Retry-After": str(retry_after)},
            )

        self._requests[ip].append(now)
        return await call_next(request)


# ---------------------------------------------------------------------------
# WebSocket connection tracker
# ---------------------------------------------------------------------------


class ConnectionTracker:
    """Track active WebSocket connections and enforce a global limit."""

    def __init__(self, max_connections: int | None = None):
        self.max_connections = max_connections or config.MAX_WS_CONNECTIONS
        self._active: set[str] = set()

    @property
    def count(self) -> int:
        return len(self._active)

    def try_connect(self, connection_id: str) -> bool:
        """Attempt to register a new connection.

        Returns ``True`` if allowed, ``False`` if at capacity.
        """
        if len(self._active) >= self.max_connections:
            logger.warning(
                "WebSocket connection rejected — at capacity (%d/%d)",
                len(self._active), self.max_connections,
            )
            return False
        self._active.add(connection_id)
        logger.info("WebSocket connected: %s (%d active)",
                     connection_id, len(self._active))
        return True

    def disconnect(self, connection_id: str) -> None:
        self._active.discard(connection_id)
        logger.info("WebSocket disconnected: %s (%d active)",
                     connection_id, len(self._active))


# Singleton tracker used by the game endpoint
connection_tracker = ConnectionTracker()


# ---------------------------------------------------------------------------
# WebSocket message rate limiter
# ---------------------------------------------------------------------------


class WSRateChecker:
    """Per-connection sliding-window message rate checker.

    Call ``check()`` before processing each inbound message.  Returns
    ``True`` if the message should be processed, ``False`` if the client
    is sending too fast.
    """

    def __init__(self, max_per_second: int | None = None):
        self.max_per_second = max_per_second or config.WS_MSG_RATE_LIMIT
        self._timestamps: list[float] = []

    def check(self) -> bool:
        now = time.monotonic()
        cutoff = now - 1.0
        self._timestamps = [t for t in self._timestamps if t > cutoff]
        if len(self._timestamps) >= self.max_per_second:
            return False
        self._timestamps.append(now)
        return True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _client_ip(request: Request) -> str:
    """Best-effort client IP extraction (respects X-Forwarded-For behind a
    reverse proxy)."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
