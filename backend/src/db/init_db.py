import time
import os
from sqlalchemy.exc import OperationalError
from sqlalchemy import text
from src.db.session import engine
from src.db.models import Base
# Import Setting to ensure it's registered with Base
from src.db.settings import Setting
from src.constants import EMBEDDING_DIMENSIONS
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
            EMBED_DIM = EMBEDDING_DIMENSIONS
            with engine.connect() as conn:
                conn.execute(text(f'ALTER TABLE raw_files ALTER COLUMN doc_embedding TYPE vector({EMBED_DIM})'))
                conn.execute(text(f'ALTER TABLE entries  ALTER COLUMN embedding     TYPE vector({EMBED_DIM})'))
                conn.commit()
            print("Tables created successfully.")
            return
        except OperationalError as e:
            print(f"Database not ready yet, retrying in 2 seconds... ({e})")
            time.sleep(2)
            retries -= 1
    print("Could not connect to database.")

if __name__ == "__main__":
    init_db()
