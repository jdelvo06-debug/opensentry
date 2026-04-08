# ---- OpenSentry Frontend ----
# Multi-stage: build with Node, serve with nginx.

# --- Stage 1: Build ---
FROM node:22-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Stage 2: Serve ---
FROM nginx:stable-alpine

LABEL maintainer="OpenSentry" \
      description="C-UAS DTID training simulator — frontend"

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our nginx config (proxies API + WebSocket to backend)
COPY nginx.conf /etc/nginx/conf.d/opensentry.conf

# Copy built frontend from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost/ || exit 1
