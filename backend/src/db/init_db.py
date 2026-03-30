import time
import os
from sqlalchemy.exc import OperationalError
from sqlalchemy import text
from src.db.session import engine
from src.db.models import Base
# Import Setting to ensure it's registered with Base
from src.db.settings import Setting


_ALLOWED_TABLES_COLUMNS = {
    "raw_files": {"doc_embedding"},
    "entries": {"embedding"},
}


def _get_vector_dim(conn, table: str, column: str):
    """Return the current vector dimension of a column, or None if not a vector column."""
    type_row = conn.execute(text(
        "SELECT pg_catalog.format_type(atttypid, atttypmod) "
        "FROM pg_attribute "
        "JOIN pg_class ON pg_attribute.attrelid = pg_class.oid "
        "WHERE pg_class.relname = :table AND pg_attribute.attname = :column"
    ), {"table": table, "column": column}).fetchone()
    if type_row is None:
        return None
    type_str = type_row[0]  # e.g. "vector(768)"
    if type_str.startswith("vector(") and type_str.endswith(")"):
        try:
            return int(type_str[7:-1])
        except ValueError:
            pass
    return None


def _alter_vector_column(conn, table: str, column: str, dim: int):
    """
    Alter a vector column to the given dimension.

    If the column already holds data with a different dimension, pgvector will
    refuse the ALTER.  In that case we NULL-out the old embeddings first (so
    the entries will be re-embedded by the worker) and then retry the ALTER.
    """
    if table not in _ALLOWED_TABLES_COLUMNS or column not in _ALLOWED_TABLES_COLUMNS[table]:
        raise ValueError(f"Unexpected table/column: {table}.{column}")
    current_dim = _get_vector_dim(conn, table, column)
    if current_dim == dim:
        print(f"  {table}.{column} already {dim}-dimensional, skipping ALTER.")
        return

    print(f"  Altering {table}.{column}: {current_dim} → {dim} dims …")
    try:
        conn.execute(text(f'ALTER TABLE {table} ALTER COLUMN {column} TYPE vector({dim})'))
    except Exception as first_err:
        # The ALTER may fail because existing rows contain vectors with the old
        # dimension.  Clear the stale embeddings so that the worker will
        # re-embed everything with the correct model, then retry the ALTER.
        print(
            f"  ALTER failed ({first_err}); clearing stale {current_dim}-dim embeddings "
            f"in {table}.{column} so entries will be re-embedded …"
        )
        conn.execute(text(f'UPDATE {table} SET {column} = NULL'))
        # Reset processing status so the worker picks entries up again.
        if table == "entries":
            conn.execute(text(
                "UPDATE entries SET status = 'enriched' WHERE status = 'embedded'"
            ))
        elif table == "raw_files":
            conn.execute(text(
                "UPDATE raw_files SET doc_status = 'pending' WHERE doc_status = 'embedded'"
            ))
        conn.execute(text(f'ALTER TABLE {table} ALTER COLUMN {column} TYPE vector({dim})'))
        print(f"  {table}.{column} altered to {dim} dims. Stale embeddings cleared for re-processing.")


def init_db():
    print("Creating database tables...")
    # Simple retry logic for waiting for DB to be ready
    retries = 5
    while retries > 0:
        try:
            with engine.connect() as conn:
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
                conn.commit()
            
            Base.metadata.create_all(bind=engine)
            from src.constants import EMBEDDING_DIMENSIONS
            EMBED_DIM = EMBEDDING_DIMENSIONS
            with engine.connect() as conn:
                _alter_vector_column(conn, "raw_files", "doc_embedding", EMBED_DIM)
                _alter_vector_column(conn, "entries", "embedding", EMBED_DIM)
                conn.commit()
            print(f"Tables created successfully (embedding dim = {EMBED_DIM}).")
            return
        except OperationalError as e:
            print(f"Database not ready yet, retrying in 2 seconds... ({e})")
            time.sleep(2)
            retries -= 1
    print("Could not connect to database.")

if __name__ == "__main__":
    init_db()
