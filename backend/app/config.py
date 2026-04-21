"""OPENSENTRY server configuration — loaded from environment variables with
safe defaults for development.

Production deployments should set the relevant env vars (e.g.
``OPENSENTRY_ALLOWED_ORIGINS``, ``OPENSENTRY_MAX_WS_CONNECTIONS``).
"""

from __future__ import annotations

import os


def _csv_list(env_var: str, default: str) -> list[str]:
    """Read a comma-separated env var into a list of stripped strings."""
    raw = os.environ.get(env_var, default)
    return [s.strip() for s in raw.split(",") if s.strip()]


# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
# In development, allow the Vite dev server.  In production, set
# OPENSENTRY_ALLOWED_ORIGINS to the real frontend URL(s).
ALLOWED_ORIGINS: list[str] = _csv_list(
    "OPENSENTRY_ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:5175,http://127.0.0.1:5175,http://localhost:5176,http://127.0.0.1:5176,http://localhost:3000",
)

# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------
# Max HTTP requests per IP per minute
HTTP_RATE_LIMIT: int = int(os.environ.get("OPENSENTRY_HTTP_RATE_LIMIT", "60"))
# Max WebSocket messages per connection per second
WS_MSG_RATE_LIMIT: int = int(os.environ.get("OPENSENTRY_WS_MSG_RATE_LIMIT", "30"))

# ---------------------------------------------------------------------------
# WebSocket connection limits
# ---------------------------------------------------------------------------
MAX_WS_CONNECTIONS: int = int(os.environ.get("OPENSENTRY_MAX_WS_CONNECTIONS", "10"))
MAX_WS_MESSAGE_BYTES: int = int(os.environ.get("OPENSENTRY_MAX_WS_MESSAGE_BYTES", "8192"))

# ---------------------------------------------------------------------------
# General
# ---------------------------------------------------------------------------
DEBUG: bool = os.environ.get("OPENSENTRY_DEBUG", "false").lower() in ("1", "true", "yes")

# ---------------------------------------------------------------------------
# Physics constants
# ---------------------------------------------------------------------------
# Knots → km/s conversion factor (1 knot ≈ 0.000514444 km/s)
KTS_TO_KMS: float = 0.000514444
