-- Migration 012: Add uploaded_by column to raw_files
-- Tracks which Stack Auth user uploaded a file via the web UI.
-- NULL = ingested from the filesystem by the background worker.

ALTER TABLE raw_files
    ADD COLUMN IF NOT EXISTS uploaded_by TEXT;

CREATE INDEX IF NOT EXISTS raw_files_uploaded_by_idx ON raw_files (uploaded_by);
