"""
Document-level embedding pipeline.

This module embeds doc_summary into doc_embedding for:
1. Fast "similar documents" search (125k vectors vs 8M)
2. Two-stage retrieval (find docs first, then chunks)
"""

import logging
from typing import Dict, List

from sqlalchemy.orm import Session
from sqlalchemy import text

from src.db.session import SessionLocal
from src.db.models import RawFile
from src.llm_client import embed_texts
from src.constants import DOC_EMBED_BATCH_SIZE, EMBEDDING_DIMENSIONS

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def embed_docs_batch(limit: int = DOC_EMBED_BATCH_SIZE) -> int:
    """
    Embed a batch of documents that have been enriched but not yet embedded.
    Also retries documents that previously failed embedding (embed_error) so
    that a model change or transient error doesn't permanently block them.

    Uses the provider's native batch API (single HTTP round-trip for all
    summaries) to maximise throughput on local Ollama.

    Returns the number of documents successfully embedded.
    """
    db = SessionLocal()
    embedded_count = 0

    try:
        # Get batch of docs needing embedding:
        # - 'enriched': first-time embedding
        # - 'embed_error': previous attempt failed (retry so model changes are picked up)
        docs = db.execute(text("""
            SELECT id, doc_summary
            FROM raw_files
            WHERE doc_status IN ('enriched', 'embed_error')
              AND doc_summary IS NOT NULL
              AND LENGTH(doc_summary) > 10
            ORDER BY CASE WHEN doc_status = 'enriched' THEN 0 ELSE 1 END, id
            LIMIT :limit
            FOR UPDATE SKIP LOCKED
        """), {"limit": limit}).fetchall()

        if not docs:
            logger.info("No documents pending doc-level embedding")
            return 0

        logger.info(f"Embedding {len(docs)} documents...")

        # Single batch call — one HTTP round-trip for all summaries
        summaries = [doc[1] for doc in docs]
        embeddings = embed_texts(summaries)

        # Safety: pad if batch returned fewer results than expected
        if len(embeddings) < len(docs):
            embeddings.extend([None] * (len(docs) - len(embeddings)))

        for (doc_id, _), embedding in zip(docs, embeddings):
            if embedding:
                if len(embedding) != EMBEDDING_DIMENSIONS:
                    logger.error(
                        f"Doc {doc_id}: embedding dimension mismatch "
                        f"(expected {EMBEDDING_DIMENSIONS}, got {len(embedding)}). "
                        f"The active embedding model produces {len(embedding)}-dimensional "
                        f"vectors but the database schema expects {EMBEDDING_DIMENSIONS}. "
                        f"Ensure the model returns {EMBEDDING_DIMENSIONS}-dimensional embeddings."
                    )
                    db.execute(text("""
                        UPDATE raw_files
                        SET doc_status = 'embed_error'
                        WHERE id = :id
                    """), {"id": doc_id})
                    db.commit()
                    continue
                # Update the database – cast the text literal to vector explicitly so
                # PostgreSQL does not raise "expression is of type text, not vector".
                db.execute(text("""
                    UPDATE raw_files
                    SET doc_embedding = :embedding::vector,
                        doc_status = 'embedded'
                    WHERE id = :id
                """), {"embedding": str(embedding), "id": doc_id})
                embedded_count += 1
            else:
                # Mark as error
                db.execute(text("""
                    UPDATE raw_files
                    SET doc_status = 'embed_error'
                    WHERE id = :id
                """), {"id": doc_id})
                logger.warning(f"Failed to embed doc {doc_id}")

        db.commit()
        logger.info(f"Batch complete: {embedded_count}/{len(docs)} docs embedded")
        return embedded_count

    except Exception as e:
        logger.error(f"Doc embedding batch error: {e}", exc_info=True)
        db.rollback()
        return 0
    finally:
        db.close()


def get_doc_embedding_stats() -> Dict[str, int]:
    """Get current doc embedding statistics."""
    db = SessionLocal()
    try:
        result = db.execute(text("""
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE doc_status = 'pending') as pending,
                COUNT(*) FILTER (WHERE doc_status = 'enriched') as enriched,
                COUNT(*) FILTER (WHERE doc_status = 'embedded') as embedded,
                COUNT(*) FILTER (WHERE doc_status IN ('error', 'embed_error')) as error,
                COUNT(doc_embedding) as has_embedding
            FROM raw_files
        """)).fetchone()
        
        return {
            "total": result[0],
            "pending": result[1],
            "enriched": result[2],
            "embedded": result[3],
            "error": result[4],
            "has_embedding": result[5]
        }
    finally:
        db.close()


def main():
    """Main entry point for doc embedding."""
    stats = get_doc_embedding_stats()
    logger.info(f"Doc embedding stats: {stats}")
    
    embedded = embed_docs_batch()
    logger.info(f"Embedded {embedded} documents this batch")
    
    return embedded


if __name__ == "__main__":
    main()
