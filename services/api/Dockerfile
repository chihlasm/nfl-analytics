# API service: read-only FastAPI over nfl.duckdb, plus the news feed reader.
# Build from the repository root:  docker build -f services/api/Dockerfile .

FROM python:3.12-slim AS build
WORKDIR /src
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip wheel --wheel-dir /wheels ".[api]"

FROM python:3.12-slim
LABEL org.opencontainers.image.source="https://github.com/chihlasm/nfl-analytics" \
      org.opencontainers.image.description="NFL Analytics read-only API"

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    NFL_DATA_DIR=/data \
    TZ=America/New_York

COPY --from=build /wheels /wheels
RUN pip install /wheels/*.whl && rm -rf /wheels \
    && useradd --uid 1000 --create-home --shell /usr/sbin/nologin nfl

USER nfl
EXPOSE 8000

HEALTHCHECK --interval=1m --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"]

CMD ["uvicorn", "--factory", "nfl_analytics.api.app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*", "--no-server-header"]
