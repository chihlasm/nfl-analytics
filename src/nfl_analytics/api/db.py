"""Read-only access to the live database that follows the ingest service's swaps.

The ingest service replaces `nfl.duckdb` with an atomic rename every morning. An
open connection keeps reading the old file, so before each request we compare the
file's identity (inode + modification time) with the one we opened and reconnect
when it changed. The stat call costs microseconds.

DuckDB caches one database instance per path inside a process: while ANY
connection to the old file is open, connecting again returns the old database.
So a swap is handled in order: stop handing out the old connection, let requests
already using it finish (they take milliseconds), close it, then connect to the
new file.

Each request gets its own cursor, which DuckDB documents as the way to share one
connection across threads.
"""

from __future__ import annotations

import logging
import tempfile
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import duckdb

log = logging.getLogger(__name__)

DRAIN_TIMEOUT_SECONDS = 10.0
TEMP_DIRECTORY = str(Path(tempfile.gettempdir()) / "nfl-duckdb")


class DatabaseUnavailable(RuntimeError):
    """No database has been published yet (first start) or it cannot be opened."""


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._cond = threading.Condition()
        self._con: duckdb.DuckDBPyConnection | None = None
        self._identity: tuple[int, int] | None = None
        self._active = 0

    def _current_identity(self) -> tuple[int, int]:
        try:
            st = self.path.stat()
        except FileNotFoundError as exc:
            raise DatabaseUnavailable(
                "The database has not been built yet. The ingest service builds it on first "
                "start; try again in a few minutes."
            ) from exc
        return (st.st_ino, st.st_mtime_ns)

    def _acquire(self) -> duckdb.DuckDBPyConnection:
        identity = self._current_identity()
        with self._cond:
            if self._con is not None and identity != self._identity:
                # Swap: wait for in-flight requests on the old build, then close it so
                # DuckDB's instance cache lets go of the old file.
                if not self._cond.wait_for(lambda: self._active == 0, DRAIN_TIMEOUT_SECONDS):
                    log.warning("Requests still running on the old build; closing it anyway")
                self._con.close()
                self._con = None
                log.info("Database file changed; reconnecting to the new build")
            if self._con is None:
                try:
                    # The data folder is mounted read-only; any spill-to-disk goes to /tmp.
                    self._con = duckdb.connect(
                        str(self.path),
                        read_only=True,
                        config={"temp_directory": TEMP_DIRECTORY},
                    )
                except duckdb.Error as exc:
                    raise DatabaseUnavailable(f"Could not open the database: {exc}") from exc
                self._identity = identity
            self._active += 1
            return self._con

    def _release(self) -> None:
        with self._cond:
            self._active -= 1
            self._cond.notify_all()

    @contextmanager
    def cursor(self) -> Iterator[duckdb.DuckDBPyConnection]:
        con = self._acquire()
        try:
            cur = con.cursor()
            try:
                yield cur
            finally:
                cur.close()
        finally:
            self._release()

    def close(self) -> None:
        with self._cond:
            if self._con is not None:
                self._con.close()
                self._con = None
