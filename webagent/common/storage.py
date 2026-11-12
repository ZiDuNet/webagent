"""SQLite transaction contexts that also release their file descriptors."""

from __future__ import annotations

import sqlite3


class SQLiteConnection(sqlite3.Connection):
    def __exit__(self, exception_type, exception_value, traceback):
        try:
            return super().__exit__(exception_type, exception_value, traceback)
        finally:
            self.close()
