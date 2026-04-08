# ---- OpenSentry Backend ----
# Multi-stage build: slim Python image with only runtime deps.

# --- Stage 1: Install dependencies ---
FROM python:3.13-slim AS builder

WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# --- Stage 2: Runtime image ---
FROM python:3.13-slim

LABEL maintainer="OpenSentry" \
      description="C-UAS DTID training simulator — backend API"

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Create non-root user
RUN useradd --create-home --shell /bin/bash opensentry
USER opensentry

WORKDIR /app
COPY --chown=opensentry:opensentry . .

EXPOSE 8000

# Health check — hit the root endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/')" || exit 1

# Production: use uvicorn with sensible defaults
# Workers can be overridden via UVICORN_WORKERS env var
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1", \
     "--ws-max-size", "8192", \
     "--log-level", "info"]
