# Ingest service: downloads nflverse data on a schedule and publishes nfl.duckdb.
# Build from the repository root:  docker build -f services/ingest/Dockerfile .

FROM python:3.12-slim AS build
WORKDIR /src
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip wheel --wheel-dir /wheels .

FROM python:3.12-slim
LABEL org.opencontainers.image.source="https://github.com/chihlasm/nfl-analytics" \
      org.opencontainers.image.description="NFL Analytics ingest: nflverse -> DuckDB"

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    NFL_DATA_DIR=/data \
    TZ=America/New_York

COPY --from=build /wheels /wheels
RUN pip install /wheels/*.whl && rm -rf /wheels \
    && useradd --uid 1000 --create-home --shell /usr/sbin/nologin nfl \
    && mkdir -p /data && chown nfl:nfl /data

USER nfl
VOLUME ["/data"]

HEALTHCHECK --interval=15m --timeout=30s --start-period=30m --retries=2 \
    CMD ["nfl", "health", "--max-age-hours", "30"]

ENTRYPOINT ["nfl"]
CMD ["schedule"]
