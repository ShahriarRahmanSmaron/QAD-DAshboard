"""MD07-4 workbook management consolidation tests.

Covers the deterministic, DB-free units introduced by the Phase 5 hard-delete
flow:

* ``_remove_workbook_blob`` — best-effort on-disk cleanup that must (a) remove
  a local blob, (b) ignore non-local buckets, (c) refuse path traversal, and
  (d) never raise when the file is already gone.

The DB-backed hard delete (removing ``uploaded_files`` / ``operational_facts``
rows) is exercised through the API integration suite; here we lock down the
path-safety building block so deletion can never escape the storage root.
"""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from app.core.config import settings
from app.reporting.service import _remove_workbook_blob


def _storage_root() -> Path:
    configured_path = Path(settings.uploaded_workbook_storage_dir)
    if configured_path.is_absolute():
        return configured_path
    return Path(__file__).resolve().parents[1] / configured_path


def test_remove_workbook_blob_deletes_local_file():
    storage_root = _storage_root()
    storage_root.mkdir(parents=True, exist_ok=True)
    base = storage_root.parent

    stored_name = f"{uuid4()}-test.xlsx"
    blob_path = storage_root / stored_name
    blob_path.write_bytes(b"fake workbook bytes")
    assert blob_path.exists()

    relative = str(blob_path.relative_to(base))
    _remove_workbook_blob("local", relative, uuid4())

    assert not blob_path.exists()


def test_remove_workbook_blob_ignores_non_local_bucket(tmp_path: Path):
    # A non-local bucket must be a no-op; nothing on disk is touched.
    sentinel = tmp_path / "keep.xlsx"
    sentinel.write_bytes(b"data")
    _remove_workbook_blob("s3", "keep.xlsx", uuid4())
    assert sentinel.exists()


def test_remove_workbook_blob_missing_file_is_silent():
    # Already-deleted blob: must not raise.
    _remove_workbook_blob("local", f"{uuid4()}-gone.xlsx", uuid4())


def test_remove_workbook_blob_rejects_path_traversal():
    # A traversal path resolves outside the storage root and must be refused
    # without deleting anything (relative_to raises ValueError, swallowed).
    _remove_workbook_blob("local", "../../../etc/passwd", uuid4())


def test_remove_workbook_blob_handles_empty_path():
    _remove_workbook_blob("local", None, uuid4())
    _remove_workbook_blob("local", "", uuid4())
