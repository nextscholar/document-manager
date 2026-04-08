"""
migrate_embeddings.py — Replace embeddings with google/embeddinggemma-300m (384 dims)
======================================================================================
This script migrates all document-chunk and document-level embeddings stored in
PostgreSQL (pgvector) to a new 384-dimensional space produced by the
`google/embeddinggemma-300m` sentence-transformers model.

NOTE: Despite the problem statement referencing SQLite/sqlite-vss, this project uses
PostgreSQL with the pgvector extension. This script is written for that stack.

Steps
-----
1. Load the new embedding model (sentence-transformers).
2. Drop IVFFlat/HNSW indexes on the vector columns so ALTER TABLE can proceed.
3. Clear stale embeddings and ALTER columns to vector(384).
4. Recreate the vector indexes (HNSW for recall, IVFFlat as fallback).
5. Re-embed every row in `entries` (chunks) in configurable batches — resumable.
6. Re-embed every row in `raw_files` (doc-level, from doc_summary) in batches.

Resumability
------------
The script checks which rows already have a non-NULL embedding and skips them,
so it is safe to run multiple times or restart after a crash.

Usage
-----
    # Run inside the backend container (or with DATABASE_URL set):
    python migrate_embeddings.py

    # With custom batch size and Ollama URL:
    BATCH_SIZE=64 python migrate_embeddings.py

    # Dry run (schema changes only, no re-embedding):
    python migrate_embeddings.py --dry-run

Environment variables
---------------------
DATABASE_URL      Full PostgreSQL URL (preferred).
DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
                  Individual connection parameters (used when DATABASE_URL is not set).
EMBED_MODEL       Override the HuggingFace model ID (default: google/embeddinggemma-300m).
EMBED_DIM         Override expected output dimension (default: 384).
BATCH_SIZE        Rows processed per batch (default: 32).
"""

import argparse
import logging
import os
import sys
import time
from typing import List, Optional, Tuple

import psycopg2
import psycopg2.extras

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

EMBED_MODEL = os.getenv("EMBED_MODEL", "google/embeddinggemma-300m")
NEW_DIM = int(os.getenv("EMBED_DIM", "384"))
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "32"))

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------


def _get_dsn() -> str:
    """Build a psycopg2-compatible DSN from environment variables."""
    dsn = os.getenv("DATABASE_URL")
    if dsn:
        return dsn
    host = os.getenv("DB_HOST", "db")
    port = os.getenv("DB_PORT", "5432")
    user = os.getenv("DB_USER", "postgres")
    password = os.getenv("DB_PASSWORD", "password")
    dbname = os.getenv("DB_NAME", "archive_brain")
    return f"postgresql://{user}:{password}@{host}:{port}/{dbname}"


def _connect(dsn: str, retries: int = 5) -> psycopg2.extensions.connection:
    for attempt in range(1, retries + 1):
        try:
            conn = psycopg2.connect(dsn)
            conn.autocommit = False
            return conn
        except psycopg2.OperationalError as exc:
            if attempt == retries:
                raise
            logger.warning("DB not ready (attempt %d/%d): %s — retrying in 3 s", attempt, retries, exc)
            time.sleep(3)
    raise RuntimeError("Could not connect to database")


def _get_column_vector_dim(cur, table: str, column: str) -> Optional[int]:
    """Return the current vector dimension for a column, or None."""
    cur.execute(
        """
        SELECT pg_catalog.format_type(a.atttypid, a.atttypmod)
        FROM   pg_attribute a
        JOIN   pg_class     c ON a.attrelid = c.oid
        WHERE  c.relname = %s AND a.attname = %s
        """,
        (table, column),
    )
    row = cur.fetchone()
    if row is None:
        return None
    type_str: str = row[0]
    if type_str.startswith("vector(") and type_str.endswith(")"):
        try:
            return int(type_str[7:-1])
        except ValueError:
            pass
    return None


def _drop_vector_indexes(cur, table: str, column: str) -> List[str]:
    """
    Drop all indexes on *column* in *table* that are of type ivfflat or hnsw.
    Returns the list of dropped index names so they can be recreated later.
    """
    cur.execute(
        """
        SELECT i.relname
        FROM   pg_index     ix
        JOIN   pg_class     t  ON ix.indrelid  = t.oid
        JOIN   pg_class     i  ON ix.indexrelid = i.oid
        JOIN   pg_attribute a  ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
        JOIN   pg_am        am ON i.relam = am.oid
        WHERE  t.relname = %s AND a.attname = %s AND am.amname IN ('ivfflat', 'hnsw')
        """,
        (table, column),
    )
    index_names = [row[0] for row in cur.fetchall()]
    for name in index_names:
        logger.info("Dropping index %s", name)
        cur.execute(f'DROP INDEX IF EXISTS "{name}"')
    return index_names


# ---------------------------------------------------------------------------
# Schema migration helpers
# ---------------------------------------------------------------------------


def migrate_schema(conn, dry_run: bool = False) -> None:
    """
    Alter entries.embedding and raw_files.doc_embedding to vector(NEW_DIM).
    Clears stale embeddings when the existing dimension differs so that the
    worker (or this script) can re-embed them.
    """
    targets = [
        ("entries", "embedding"),
        ("raw_files", "doc_embedding"),
    ]

    with conn.cursor() as cur:
        for table, column in targets:
            current_dim = _get_column_vector_dim(cur, table, column)
            logger.info("%s.%s: current dim=%s  target dim=%d", table, column, current_dim, NEW_DIM)

            if current_dim == NEW_DIM:
                logger.info("  Already %d-dimensional, skipping.", NEW_DIM)
                continue

            if dry_run:
                logger.info("  [DRY RUN] Would alter %s.%s to vector(%d).", table, column, NEW_DIM)
                continue

            # Drop dependent indexes first (ALTER TYPE fails if indexes exist)
            _drop_vector_indexes(cur, table, column)

            # Try a direct ALTER; if it fails because existing rows contain
            # vectors of the old dimension, clear them first then retry.
            try:
                cur.execute(f"ALTER TABLE {table} ALTER COLUMN {column} TYPE vector({NEW_DIM})")
                logger.info("  Altered %s.%s → vector(%d).", table, column, NEW_DIM)
            except psycopg2.errors.InvalidParameterValue:
                conn.rollback()
                logger.warning(
                    "  ALTER failed (dimension mismatch in existing data). "
                    "Clearing stale embeddings in %s.%s …",
                    table,
                    column,
                )
                with conn.cursor() as c2:
                    c2.execute(f"UPDATE {table} SET {column} = NULL")
                    if table == "entries":
                        c2.execute(
                            "UPDATE entries SET status = 'enriched' "
                            "WHERE status IN ('embedded', 'error')"
                        )
                    elif table == "raw_files":
                        c2.execute(
                            "UPDATE raw_files SET doc_status = 'enriched' "
                            "WHERE doc_status IN ('embedded', 'embed_error')"
                        )
                    c2.execute(f"ALTER TABLE {table} ALTER COLUMN {column} TYPE vector({NEW_DIM})")
                logger.info(
                    "  Stale embeddings cleared and %s.%s altered to vector(%d).",
                    table,
                    column,
                    NEW_DIM,
                )

            # Recreate vector index (HNSW gives better recall on CPU than IVFFlat)
            index_name = f"{table}_{column}_hnsw_idx"
            cur.execute(
                f"""
                CREATE INDEX IF NOT EXISTS {index_name}
                ON {table}
                USING hnsw ({column} vector_cosine_ops)
                WITH (m = 16, ef_construction = 64)
                """
            )
            logger.info("  Created HNSW index %s.", index_name)

        conn.commit()


# ---------------------------------------------------------------------------
# Embedding model
# ---------------------------------------------------------------------------


def load_embedding_model():
    """
    Load google/embeddinggemma-300m via sentence-transformers.

    The model supports flexible output dimensions; we request NEW_DIM (384).
    If the model ID is wrong or unavailable, the import will raise an informative error.
    """
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:
        logger.error(
            "sentence-transformers is not installed. Run:\n"
            "  pip install sentence-transformers torch --extra-index-url "
            "https://download.pytorch.org/whl/cpu\n"
        )
        raise SystemExit(1) from exc

    logger.info("Loading embedding model: %s (dim=%d) …", EMBED_MODEL, NEW_DIM)
    model = SentenceTransformer(EMBED_MODEL, truncate_dim=NEW_DIM)
    logger.info("Model loaded.")
    return model


def embed_texts(model, texts: List[str]) -> List[Optional[List[float]]]:
    """
    Embed a list of texts. Returns a list of float lists (or None on failure).
    Truncates each text to 8 000 characters to stay within model context.
    """
    MAX_CHARS = 8000
    sanitized = [(t[:MAX_CHARS] if t else "") for t in texts]
    try:
        vectors = model.encode(sanitized, batch_size=BATCH_SIZE, show_progress_bar=False)
        result = []
        for vec in vectors:
            if vec is None:
                result.append(None)
            else:
                v = vec.tolist() if hasattr(vec, "tolist") else list(vec)
                if len(v) != NEW_DIM:
                    logger.error(
                        "Unexpected embedding dimension %d (expected %d). "
                        "Check EMBED_MODEL / EMBED_DIM.",
                        len(v),
                        NEW_DIM,
                    )
                    result.append(None)
                else:
                    result.append(v)
        return result
    except Exception as exc:
        logger.error("Batch embedding failed: %s", exc, exc_info=True)
        return [None] * len(texts)


# ---------------------------------------------------------------------------
# Re-embedding passes
# ---------------------------------------------------------------------------


def _vec_literal(v: List[float]) -> str:
    """Convert a Python list of floats to a pgvector literal string '[x,y,…]'."""
    return "[" + ",".join(str(float(x)) for x in v) + "]"


def re_embed_entries(conn, model, dry_run: bool = False) -> Tuple[int, int]:
    """
    Re-embed all rows in `entries` that have a NULL embedding.
    Returns (processed_count, error_count).
    """
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM entries WHERE embedding IS NULL")
        total: int = cur.fetchone()[0]

    if total == 0:
        logger.info("All entries already have embeddings. Nothing to do.")
        return 0, 0

    logger.info("Re-embedding %d entries in batches of %d …", total, BATCH_SIZE)
    processed = errors = 0

    while True:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(
                """
                SELECT id,
                       COALESCE(
                           CASE
                               WHEN title IS NOT NULL THEN 'Title: ' || title || E'\n' ELSE '' END
                           || CASE
                               WHEN author IS NOT NULL THEN 'Author: ' || author || E'\n' ELSE '' END
                           || CASE
                               WHEN summary IS NOT NULL THEN 'Summary: ' || summary || E'\n' ELSE '' END
                           || 'Content:' || E'\n' || entry_text,
                           entry_text
                       ) AS text_to_embed
                FROM entries
                WHERE embedding IS NULL
                ORDER BY id
                LIMIT %s
                """,
                (BATCH_SIZE,),
            )
            batch = cur.fetchall()

        if not batch:
            break

        ids = [row["id"] for row in batch]
        texts = [row["text_to_embed"] for row in batch]

        if dry_run:
            logger.info("  [DRY RUN] Would embed entries %s … %s", ids[0], ids[-1])
            processed += len(ids)
            continue

        embeddings = embed_texts(model, texts)

        with conn.cursor() as cur:
            for eid, emb in zip(ids, embeddings):
                if emb is None:
                    errors += 1
                    logger.warning("Failed to embed entry %d", eid)
                else:
                    cur.execute(
                        "UPDATE entries SET embedding = %s::vector WHERE id = %s",
                        (_vec_literal(emb), eid),
                    )
                    processed += 1
        conn.commit()

        logger.info("  Entries progress: %d/%d (errors=%d)", processed + errors, total, errors)

    logger.info("Entries re-embedding complete: %d ok, %d errors.", processed, errors)
    return processed, errors


def re_embed_documents(conn, model, dry_run: bool = False) -> Tuple[int, int]:
    """
    Re-embed all rows in `raw_files` that have a non-NULL doc_summary but a
    NULL doc_embedding (i.e., need re-embedding).
    Returns (processed_count, error_count).
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*)
            FROM raw_files
            WHERE doc_embedding IS NULL
              AND doc_summary IS NOT NULL
              AND LENGTH(doc_summary) > 10
            """
        )
        total: int = cur.fetchone()[0]

    if total == 0:
        logger.info("All documents already have doc_embedding. Nothing to do.")
        return 0, 0

    logger.info("Re-embedding %d documents in batches of %d …", total, BATCH_SIZE)
    processed = errors = 0

    while True:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(
                """
                SELECT id, doc_summary
                FROM raw_files
                WHERE doc_embedding IS NULL
                  AND doc_summary IS NOT NULL
                  AND LENGTH(doc_summary) > 10
                ORDER BY id
                LIMIT %s
                """,
                (BATCH_SIZE,),
            )
            batch = cur.fetchall()

        if not batch:
            break

        ids = [row["id"] for row in batch]
        texts = [row["doc_summary"] for row in batch]

        if dry_run:
            logger.info("  [DRY RUN] Would embed documents %s … %s", ids[0], ids[-1])
            processed += len(ids)
            continue

        embeddings = embed_texts(model, texts)

        with conn.cursor() as cur:
            for doc_id, emb in zip(ids, embeddings):
                if emb is None:
                    errors += 1
                    logger.warning("Failed to embed document %d", doc_id)
                    cur.execute(
                        "UPDATE raw_files SET doc_status = 'embed_error' WHERE id = %s",
                        (doc_id,),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE raw_files
                        SET doc_embedding = %s::vector,
                            doc_status    = 'embedded'
                        WHERE id = %s
                        """,
                        (_vec_literal(emb), doc_id),
                    )
                    processed += 1
        conn.commit()

        logger.info("  Documents progress: %d/%d (errors=%d)", processed + errors, total, errors)

    logger.info("Document re-embedding complete: %d ok, %d errors.", processed, errors)
    return processed, errors


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Migrate embeddings to google/embeddinggemma-300m (384 dims)."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only log what would be done; do not modify the database.",
    )
    parser.add_argument(
        "--schema-only",
        action="store_true",
        help="Perform schema migration (ALTER TABLE, rebuild indexes) but skip re-embedding.",
    )
    args = parser.parse_args()

    dsn = _get_dsn()
    logger.info("Connecting to database …")
    conn = _connect(dsn)

    # ----- Step 1: Schema migration -----
    logger.info("=== Step 1: Schema migration ===")
    migrate_schema(conn, dry_run=args.dry_run)

    if args.schema_only:
        logger.info("--schema-only specified; skipping re-embedding pass.")
        conn.close()
        return

    # ----- Step 2: Load embedding model -----
    logger.info("=== Step 2: Loading embedding model ===")
    model = load_embedding_model()

    # ----- Step 3: Re-embed entries (chunks) -----
    logger.info("=== Step 3: Re-embedding chunks ===")
    entry_ok, entry_err = re_embed_entries(conn, model, dry_run=args.dry_run)

    # ----- Step 4: Re-embed documents -----
    logger.info("=== Step 4: Re-embedding documents ===")
    doc_ok, doc_err = re_embed_documents(conn, model, dry_run=args.dry_run)

    conn.close()

    logger.info(
        "=== Migration complete ===\n"
        "  Chunks  : %d embedded, %d errors\n"
        "  Documents: %d embedded, %d errors",
        entry_ok,
        entry_err,
        doc_ok,
        doc_err,
    )

    if entry_err or doc_err:
        logger.warning(
            "Some rows failed. Re-run the script to retry failed rows (they have "
            "NULL embeddings and will be picked up automatically)."
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
