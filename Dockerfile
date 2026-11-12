FROM node:22-bookworm-slim AS frontend-build

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/tmp \
    WEBAGENT_DATA_DIR=/app/data \
    WEBAGENT_CHROME_PATH=/usr/bin/chromium

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium ffmpeg fonts-noto-cjk ca-certificates libatomic1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 webagent \
    && useradd --uid 10001 --gid webagent --no-create-home --shell /usr/sbin/nologin webagent

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=webagent:webagent webagent/ ./webagent/
COPY --chown=webagent:webagent web/ ./web/
COPY --chown=webagent:webagent scripts/healthcheck.py ./scripts/healthcheck.py
COPY --from=frontend-build --chown=webagent:webagent /build/frontend/dist/ ./frontend/dist/
COPY --from=frontend-build --chown=webagent:webagent /build/web/vendor/ ./web/vendor/
RUN mkdir -p /app/data && chown webagent:webagent /app/data

USER webagent
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "webagent.business.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
