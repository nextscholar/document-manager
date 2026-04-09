"""
search_engine.py — Upgraded search pipeline
============================================
Integrates three new components on top of the existing document-manager RAG stack:

  1. **Embedding**  : google/embeddinggemma-300m (384-dim, via sentence-transformers)
  2. **Reranker**   : sam860/qwen3-reranker:0.6b-F16 (via Ollama *or* HuggingFace CrossEncoder)
  3. **Chat model** : gemma4:e2b (via Ollama)

Pipeline
--------
query
  │
  ▼ embed with google/embeddinggemma-300m
vector search (pgvector cosine similarity, top-K candidates)
  │
  ▼ rerank with qwen3-reranker
top-N reranked passages
  │
  ▼ generate answer with gemma4:e2b

Usage — standalone
------------------
    python -m src.rag.search_engine "What is the capital of France?" -k 5

Usage — as a module
-------------------
    from src.rag.search_engine import SearchEngine
    from src.db.session import get_db

    db   = next(get_db())
    se   = SearchEngine()
    resp = se.search(db, "What is the capital of France?", k=5)
    print(resp["answer"])

Environment variables
---------------------
OLLAMA_URL            Ollama server URL              (default: http://localhost:11434)
RERANKER_MODEL        Ollama model tag for reranker  (default: sam860/qwen3-reranker:0.6b-F16)
CHAT_MODEL            Ollama model tag for chat      (default: gemma4:e2b)
RERANKER_BACKEND      "ollama" or "huggingface"      (default: ollama)
RERANKER_HF_MODEL     HuggingFace model ID used when RERANKER_BACKEND=huggingface
                      (default: Qwen/Qwen3-Reranker-0.6B)
EMBED_MODEL           HuggingFace model ID for embeddings
                      (default: google/embeddinggemma-300m)
EMBED_DIM             Embedding dimension            (default: 384)
SEARCH_TOP_K          Candidates retrieved before reranking (default: 20)
RERANK_TOP_N          Passages kept after reranking  (default: 5)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

import requests
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

OLLAMA_URL: str = os.getenv("OLLAMA_URL", "http://localhost:11434")
RERANKER_MODEL: str = os.getenv("RERANKER_MODEL", "sam860/qwen3-reranker:0.6b-F16")
CHAT_MODEL: str = os.getenv("CHAT_MODEL", "gemma4:e2b")
RERANKER_BACKEND: str = os.getenv("RERANKER_BACKEND", "ollama")
RERANKER_HF_MODEL: str = os.getenv("RERANKER_HF_MODEL", "Qwen/Qwen3-Reranker-0.6B")
EMBED_MODEL: str = os.getenv("EMBED_MODEL", "google/embeddinggemma-300m")
EMBED_DIM: int = int(os.getenv("EMBED_DIM", "384"))
SEARCH_TOP_K: int = int(os.getenv("SEARCH_TOP_K", "20"))
RERANK_TOP_N: int = int(os.getenv("RERANK_TOP_N", "5"))

# Prompt used when the Qwen3-Reranker is invoked via Ollama generate endpoint.
# The model is a cross-encoder: it reads the query and the document together and
# outputs a binary relevance judgement ("yes" / "no").
_RERANKER_SYSTEM = (
    "Judge whether the Document meets the requirements based on the Query and the "
    "Instruct provided. Note only output yes or no."
)
_RERANKER_USER_TMPL = (
    "<Instruct>: Given a query, retrieve relevant passages that answer the query\n"
    "<Query>: {query}\n"
    "<Document>: {document}"
)

# ---------------------------------------------------------------------------
# Embedding model (sentence-transformers, loaded lazily on first use)
# ---------------------------------------------------------------------------

_st_model = None


def _get_st_model():
    """Load (and cache) the sentence-transformers embedding model."""
    global _st_model
    if _st_model is not None:
        return _st_model
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:
        raise ImportError(
            "sentence-transformers is not installed. Run:\n"
            "  pip install sentence-transformers torch --extra-index-url "
            "https://download.pytorch.org/whl/cpu"
        ) from exc
    logger.info("Loading embedding model %s (dim=%d) …", EMBED_MODEL, EMBED_DIM)
    _st_model = SentenceTransformer(EMBED_MODEL, truncate_dim=EMBED_DIM)
    return _st_model


# ---------------------------------------------------------------------------
# Reranker (HuggingFace CrossEncoder, loaded lazily on first use)
# ---------------------------------------------------------------------------

_hf_reranker = None


def _get_hf_reranker():
    """Load (and cache) the HuggingFace CrossEncoder reranker."""
    global _hf_reranker
    if _hf_reranker is not None:
        return _hf_reranker
    try:
        from sentence_transformers import CrossEncoder
    except ImportError as exc:
        raise ImportError(
            "sentence-transformers is not installed. Run:\n"
            "  pip install sentence-transformers torch --extra-index-url "
            "https://download.pytorch.org/whl/cpu"
        ) from exc
    logger.info("Loading reranker model %s …", RERANKER_HF_MODEL)
    _hf_reranker = CrossEncoder(RERANKER_HF_MODEL)
    return _hf_reranker


# ---------------------------------------------------------------------------
# Core building blocks
# ---------------------------------------------------------------------------


class EmbeddingModel:
    """
    Wraps google/embeddinggemma-300m via sentence-transformers.
    The model is loaded once and reused for the lifetime of the process.
    """

    def embed(self, text: str) -> Optional[List[float]]:
        """Embed a single text. Returns None on failure."""
        try:
            model = _get_st_model()
            vectors = model.encode([text[:8000]], show_progress_bar=False)
            v = vectors[0].tolist() if hasattr(vectors[0], "tolist") else list(vectors[0])
            if len(v) != EMBED_DIM:
                logger.error(
                    "Embedding dimension mismatch: expected %d, got %d", EMBED_DIM, len(v)
                )
                return None
            return v
        except Exception as exc:
            logger.error("Embedding failed: %s", exc, exc_info=True)
            return None

    def embed_batch(self, texts: List[str]) -> List[Optional[List[float]]]:
        """Embed multiple texts. Returns a list of embeddings (None on error)."""
        try:
            model = _get_st_model()
            clean = [t[:8000] if t else "" for t in texts]
            vectors = model.encode(clean, batch_size=32, show_progress_bar=False)
            result = []
            for vec in vectors:
                v = vec.tolist() if hasattr(vec, "tolist") else list(vec)
                result.append(v if len(v) == EMBED_DIM else None)
            return result
        except Exception as exc:
            logger.error("Batch embedding failed: %s", exc, exc_info=True)
            return [None] * len(texts)


class Reranker:
    """
    Cross-encoder reranker — supports two backends:

    * ``ollama``      – calls sam860/qwen3-reranker:0.6b-F16 via the Ollama
                        generate API; parses the "yes"/"no" output to assign
                        a binary score (1 / 0).
    * ``huggingface`` – loads RERANKER_HF_MODEL as a sentence-transformers
                        CrossEncoder and scores pairs directly.
    """

    def __init__(
        self,
        backend: str = RERANKER_BACKEND,
        ollama_url: str = OLLAMA_URL,
        ollama_model: str = RERANKER_MODEL,
    ):
        self.backend = backend
        self.ollama_url = ollama_url.rstrip("/")
        self.ollama_model = ollama_model

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def rerank(
        self, query: str, passages: List[Dict[str, Any]], top_n: int = RERANK_TOP_N
    ) -> List[Dict[str, Any]]:
        """
        Rerank *passages* by relevance to *query* and return the top *top_n*.

        Each passage dict must have at least a ``"text"`` key.
        The returned list includes the original passage dict plus a
        ``"rerank_score"`` key.
        """
        if not passages:
            return []

        if self.backend == "huggingface":
            scored = self._rerank_hf(query, passages)
        else:
            scored = self._rerank_ollama(query, passages)

        scored.sort(key=lambda x: x.get("rerank_score", 0.0), reverse=True)
        return scored[:top_n]

    # ------------------------------------------------------------------
    # Ollama backend
    # ------------------------------------------------------------------

    def _score_ollama(self, query: str, document: str) -> float:
        """
        Ask the Qwen3-Reranker via Ollama to judge relevance.
        Returns 1.0 for "yes", 0.0 for "no" (or on error).
        """
        prompt = (
            f"<|im_start|>system\n{_RERANKER_SYSTEM}\n<|im_end|>\n"
            f"<|im_start|>user\n"
            f"{_RERANKER_USER_TMPL.format(query=query, document=document[:2000])}\n"
            f"<|im_end|>\n"
            f"<|im_start|>assistant\n<think>\n\n</think>\n"
        )
        try:
            resp = requests.post(
                f"{self.ollama_url}/api/generate",
                json={
                    "model": self.ollama_model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"num_predict": 32, "temperature": 0.0},
                },
                timeout=30,
            )
            resp.raise_for_status()
            output: str = resp.json().get("response", "").strip().lower()
            if "yes" in output:
                return 1.0
            if "no" in output:
                return 0.0
            # Fallback: try to parse a numeric score in "0-10" style answers
            for token in output.split():
                try:
                    return float(token) / 10.0
                except ValueError:
                    continue
            return 0.0
        except Exception as exc:
            logger.warning("Ollama reranker call failed: %s", exc)
            return 0.0

    def _rerank_ollama(
        self, query: str, passages: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Score all passages sequentially via Ollama."""
        result = []
        for p in passages:
            score = self._score_ollama(query, p.get("text", ""))
            result.append({**p, "rerank_score": score})
        return result

    # ------------------------------------------------------------------
    # HuggingFace backend
    # ------------------------------------------------------------------

    def _rerank_hf(
        self, query: str, passages: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Score all passages using the HuggingFace CrossEncoder."""
        try:
            model = _get_hf_reranker()
            pairs = [(query, p.get("text", "")[:2000]) for p in passages]
            scores = model.predict(pairs)
            return [
                {**p, "rerank_score": float(s)}
                for p, s in zip(passages, scores)
            ]
        except Exception as exc:
            logger.error("HuggingFace reranker failed: %s", exc, exc_info=True)
            return [{**p, "rerank_score": 0.0} for p in passages]


class ChatModel:
    """
    Wraps gemma4:e2b running in Ollama.
    Formats a RAG prompt and returns the generated answer.
    """

    def __init__(self, ollama_url: str = OLLAMA_URL, model: str = CHAT_MODEL):
        self.ollama_url = ollama_url.rstrip("/")
        self.model = model

    def generate(self, query: str, context_passages: List[str]) -> str:
        """
        Generate an answer for *query* grounded in *context_passages*.
        Returns the model's text response, or an error string on failure.
        """
        context = "\n\n---\n\n".join(context_passages)
        prompt = (
            "You are a helpful assistant. Answer the question below using only the "
            "provided context. If the context does not contain enough information, "
            "say so clearly.\n\n"
            f"Context:\n{context}\n\n"
            f"Question: {query}\n\n"
            "Answer:"
        )
        try:
            resp = requests.post(
                f"{self.ollama_url}/api/generate",
                json={
                    "model": self.model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.2, "num_predict": 512},
                },
                timeout=120,
            )
            resp.raise_for_status()
            return resp.json().get("response", "").strip()
        except Exception as exc:
            logger.error("Chat model generation failed: %s", exc, exc_info=True)
            return f"[Error generating answer: {exc}]"


# ---------------------------------------------------------------------------
# Vector search helper
# ---------------------------------------------------------------------------


def _vec_literal(v: List[float]) -> str:
    return "[" + ",".join(str(float(x)) for x in v) + "]"


def vector_search(
    db: Session,
    query_embedding: List[float],
    k: int = SEARCH_TOP_K,
    filters: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """
    Retrieve the top-*k* chunks from `entries` by cosine similarity.

    Returns a list of dicts with keys:
        id, entry_text, title, author, file_id, vector_score
    """
    filter_sql = ""
    params: Dict[str, Any] = {
        "embedding": _vec_literal(query_embedding),
        "limit": k,
    }

    if filters:
        if filters.get("uploaded_by"):
            filter_sql += " AND (rf.uploaded_by = :uploaded_by OR rf.uploaded_by IS NULL)"
            params["uploaded_by"] = filters["uploaded_by"]
        if filters.get("extension"):
            filter_sql += " AND rf.extension = :ext_filter"
            params["ext_filter"] = filters["extension"]

    sql = text(
        f"""
        SELECT
            e.id,
            e.entry_text,
            e.title,
            e.author,
            e.file_id,
            1.0 - (e.embedding <=> CAST(:embedding AS vector)) AS vector_score
        FROM entries e
        JOIN raw_files rf ON e.file_id = rf.id
        WHERE e.embedding IS NOT NULL
        {filter_sql}
        ORDER BY e.embedding <=> CAST(:embedding AS vector)
        LIMIT :limit
        """
    )

    rows = db.execute(sql, params).fetchall()
    return [
        {
            "id": r[0],
            "text": r[1] or "",
            "title": r[2],
            "author": r[3],
            "file_id": r[4],
            "vector_score": float(r[5]) if r[5] is not None else 0.0,
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Main search pipeline
# ---------------------------------------------------------------------------


class SearchEngine:
    """
    Full RAG pipeline:
      embed → retrieve → rerank → generate

    All three model objects are instantiated once per SearchEngine instance
    and reused across calls so the model weights are not reloaded every query.
    """

    def __init__(
        self,
        ollama_url: str = OLLAMA_URL,
        reranker_backend: str = RERANKER_BACKEND,
        reranker_model: str = RERANKER_MODEL,
        chat_model: str = CHAT_MODEL,
        top_k: int = SEARCH_TOP_K,
        rerank_top_n: int = RERANK_TOP_N,
    ):
        self.top_k = top_k
        self.rerank_top_n = rerank_top_n
        self.embedder = EmbeddingModel()
        self.reranker = Reranker(
            backend=reranker_backend,
            ollama_url=ollama_url,
            ollama_model=reranker_model,
        )
        self.chat = ChatModel(ollama_url=ollama_url, model=chat_model)

    def search(
        self,
        db: Session,
        query: str,
        k: Optional[int] = None,
        top_n: Optional[int] = None,
        filters: Optional[Dict[str, Any]] = None,
        generate_answer: bool = True,
    ) -> Dict[str, Any]:
        """
        Run the full pipeline for *query* and return a response dict:

        {
            "query":    str,
            "answer":   str | None,
            "passages": [ {id, text, title, author, file_id,
                           vector_score, rerank_score}, … ],
            "stats":    {embed_ms, retrieve_ms, rerank_ms, generate_ms, total_ms}
        }
        """
        k = k or self.top_k
        top_n = top_n or self.rerank_top_n
        t0 = time.perf_counter()

        # ---- 1. Embed query ----
        t1 = time.perf_counter()
        query_embedding = self.embedder.embed(query)
        embed_ms = int((time.perf_counter() - t1) * 1000)

        if query_embedding is None:
            logger.error("Query embedding failed for: %s", query)
            return {
                "query": query,
                "answer": "[Error: could not embed query]",
                "passages": [],
                "stats": {"error": "embedding_failed"},
            }

        # ---- 2. Vector retrieval ----
        t2 = time.perf_counter()
        candidates = vector_search(db, query_embedding, k=k, filters=filters)
        retrieve_ms = int((time.perf_counter() - t2) * 1000)
        logger.info("Retrieved %d candidates in %d ms", len(candidates), retrieve_ms)

        # ---- 3. Rerank ----
        t3 = time.perf_counter()
        reranked = self.reranker.rerank(query, candidates, top_n=top_n)
        rerank_ms = int((time.perf_counter() - t3) * 1000)
        logger.info(
            "Reranked to %d passages in %d ms (backend=%s)",
            len(reranked),
            rerank_ms,
            self.reranker.backend,
        )

        # ---- 4. Generate answer ----
        generate_ms = 0
        answer: Optional[str] = None
        if generate_answer and reranked:
            context_texts = [p["text"] for p in reranked]
            t4 = time.perf_counter()
            answer = self.chat.generate(query, context_texts)
            generate_ms = int((time.perf_counter() - t4) * 1000)
            logger.info("Generated answer in %d ms", generate_ms)

        total_ms = int((time.perf_counter() - t0) * 1000)

        return {
            "query": query,
            "answer": answer,
            "passages": reranked,
            "stats": {
                "embed_ms": embed_ms,
                "retrieve_ms": retrieve_ms,
                "rerank_ms": rerank_ms,
                "generate_ms": generate_ms,
                "total_ms": total_ms,
                "candidates_retrieved": len(candidates),
                "passages_after_rerank": len(reranked),
            },
        }


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stdout,
    )

    parser = argparse.ArgumentParser(description="Search documents with reranking and Gemma 4 E2B.")
    parser.add_argument("query", help="Search query")
    parser.add_argument("-k", type=int, default=SEARCH_TOP_K, help="Vector retrieval top-K")
    parser.add_argument("-n", "--top-n", type=int, default=RERANK_TOP_N, help="Rerank top-N")
    parser.add_argument(
        "--no-answer", action="store_true", help="Skip answer generation (retrieval + rerank only)"
    )
    parser.add_argument(
        "--json", dest="output_json", action="store_true", help="Output results as JSON"
    )
    args = parser.parse_args()

    from src.db.session import get_db

    db = next(get_db())
    engine = SearchEngine()

    result = engine.search(
        db,
        args.query,
        k=args.k,
        top_n=args.top_n,
        generate_answer=not args.no_answer,
    )

    if args.output_json:
        print(json.dumps(result, indent=2, default=str))
        return

    print(f"\nQuery : {result['query']}")
    print(f"Stats : {result['stats']}\n")
    print("=== Top passages (after reranking) ===")
    for i, p in enumerate(result["passages"], 1):
        title = p.get("title") or "(no title)"
        print(f"\n[{i}] {title}  (vector={p['vector_score']:.3f}, rerank={p.get('rerank_score', 0):.3f})")
        print(f"    {p['text'][:200]} …")

    if result.get("answer"):
        print("\n=== Answer (Gemma 4 E2B) ===")
        print(result["answer"])


if __name__ == "__main__":
    main()
