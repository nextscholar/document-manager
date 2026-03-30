"""
Tests for LLMClient embedding error handling, focusing on 429 billing errors
and the new batch embedding (embed_texts / _ollama_embed_batch) path.
"""
import json
import os
import pytest
from unittest.mock import MagicMock, patch, call
import requests

from src.llm_client import LLMClient, _looks_like_billing_error, embed_texts


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _make_http_error(status_code: int, body: str) -> requests.HTTPError:
    """Build a requests.HTTPError with a mocked response."""
    resp = MagicMock(spec=requests.Response)
    resp.status_code = status_code
    resp.text = body
    http_err = requests.HTTPError(response=resp)
    return http_err


# ---------------------------------------------------------------------------
# _looks_like_billing_error
# ---------------------------------------------------------------------------

@pytest.mark.unit
def test_billing_error_zhipu_code_1113():
    resp = MagicMock(spec=requests.Response)
    resp.text = json.dumps({"error": {"code": "1113", "message": "余额不足或无可用资源包,请充值。"}})
    assert _looks_like_billing_error(resp) is True


@pytest.mark.unit
def test_billing_error_insufficient_balance_english():
    resp = MagicMock(spec=requests.Response)
    resp.text = '{"error": {"message": "Insufficient balance, please top up."}}'
    assert _looks_like_billing_error(resp) is True


@pytest.mark.unit
def test_billing_error_insufficient_quota():
    resp = MagicMock(spec=requests.Response)
    resp.text = '{"error": {"code": "insufficient_quota", "message": "You exceeded your current quota."}}'
    assert _looks_like_billing_error(resp) is True


@pytest.mark.unit
def test_billing_error_quota_exceeded():
    resp = MagicMock(spec=requests.Response)
    resp.text = '{"error": {"message": "quota exceeded for this month"}}'
    assert _looks_like_billing_error(resp) is True


@pytest.mark.unit
def test_billing_error_no_available_resource():
    resp = MagicMock(spec=requests.Response)
    resp.text = '{"error": {"message": "no available resource packages"}}'
    assert _looks_like_billing_error(resp) is True


@pytest.mark.unit
def test_billing_error_real_rate_limit_not_detected():
    """A genuine rate-limit 429 (no billing language) should NOT be flagged as a billing error."""
    resp = MagicMock(spec=requests.Response)
    resp.text = '{"error": {"message": "Rate limit exceeded, please slow down."}}'
    assert _looks_like_billing_error(resp) is False


@pytest.mark.unit
def test_billing_error_none_response():
    assert _looks_like_billing_error(None) is False


# ---------------------------------------------------------------------------
# LLMClient._openai_compat_embed  —  billing 429 stops immediately
# ---------------------------------------------------------------------------

@pytest.mark.unit
def test_openai_compat_embed_billing_429_returns_none_immediately():
    """Billing 429 should log a clear message and return None without retrying."""
    billing_body = json.dumps(
        {"error": {"code": "1113", "message": "余额不足或无可用资源包,请充值。"}}
    )
    client = LLMClient({"provider": "zhipu", "api_key": "test-key"})

    with patch("src.llm_client.requests.post") as mock_post:
        mock_resp = MagicMock(spec=requests.Response)
        mock_resp.status_code = 429
        mock_resp.text = billing_body
        mock_resp.raise_for_status.side_effect = requests.HTTPError(response=mock_resp)
        mock_post.return_value = mock_resp

        result = client._openai_compat_embed(
            "test text", "test-key", "https://open.bigmodel.cn/api/paas/v4", "embedding-3"
        )

    assert result is None
    # Should only have been called once — no retry for billing errors
    assert mock_post.call_count == 1


@pytest.mark.unit
def test_openai_compat_embed_rate_limit_429_retries():
    """Genuine rate-limit 429 (no billing language) should retry."""
    rate_limit_body = '{"error": {"message": "Rate limit exceeded, please slow down."}}'
    client = LLMClient({"provider": "zhipu", "api_key": "test-key"})

    with patch("src.llm_client.requests.post") as mock_post, \
         patch("src.llm_client.time.sleep"):
        mock_resp = MagicMock(spec=requests.Response)
        mock_resp.status_code = 429
        mock_resp.text = rate_limit_body
        mock_resp.raise_for_status.side_effect = requests.HTTPError(response=mock_resp)
        mock_post.return_value = mock_resp

        result = client._openai_compat_embed(
            "test text", "test-key", "https://open.bigmodel.cn/api/paas/v4", "embedding-3"
        )

    assert result is None
    # Should have been called more than once due to retry logic
    retry_attempts = int(os.getenv("EMBEDDING_RETRY_ATTEMPTS", "2"))
    assert mock_post.call_count == retry_attempts


# ---------------------------------------------------------------------------
# LLMClient._ollama_embed_batch  —  batch API (Ollama /api/embed)
# ---------------------------------------------------------------------------

@pytest.mark.unit
def test_ollama_embed_batch_success():
    """_ollama_embed_batch sends all texts in one request and returns all embeddings."""
    vec_a = [0.1, 0.2, 0.3]
    vec_b = [0.4, 0.5, 0.6]
    client = LLMClient({"provider": "ollama", "url": "http://localhost:11434"})

    with patch("src.llm_client.requests.post") as mock_post:
        mock_resp = MagicMock(spec=requests.Response)
        mock_resp.status_code = 200
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {"embeddings": [vec_a, vec_b]}
        mock_post.return_value = mock_resp

        result = client._ollama_embed_batch(["hello", "world"])

    assert result == [vec_a, vec_b]
    # Should be exactly one HTTP request, not two
    assert mock_post.call_count == 1
    # That request goes to /api/embed (not /api/embeddings)
    url_called = mock_post.call_args[0][0]
    assert url_called.endswith("/api/embed")
    # The input field is a list
    payload_sent = mock_post.call_args[1]["json"]
    assert payload_sent["input"] == ["hello", "world"]


@pytest.mark.unit
def test_ollama_embed_batch_empty_input():
    """_ollama_embed_batch returns [] for empty input without making any requests."""
    client = LLMClient({"provider": "ollama", "url": "http://localhost:11434"})

    with patch("src.llm_client.requests.post") as mock_post:
        result = client._ollama_embed_batch([])

    assert result == []
    mock_post.assert_not_called()


@pytest.mark.unit
def test_ollama_embed_batch_fallback_on_404():
    """_ollama_embed_batch falls back to per-text /api/embeddings on 404 (old Ollama)."""
    vec = [0.1, 0.2]
    client = LLMClient({"provider": "ollama", "url": "http://localhost:11434"})

    not_found_resp = MagicMock(spec=requests.Response)
    not_found_resp.status_code = 404
    not_found_resp.text = "Not Found"

    single_resp = MagicMock(spec=requests.Response)
    single_resp.status_code = 200
    single_resp.raise_for_status = MagicMock()
    single_resp.json.return_value = {"embedding": vec}

    def post_side_effect(url, **kwargs):
        if url.endswith("/api/embed"):
            raise requests.HTTPError(response=not_found_resp)
        return single_resp

    with patch("src.llm_client.requests.post", side_effect=post_side_effect):
        result = client._ollama_embed_batch(["text1", "text2"])

    # Should have fallen back to two individual calls
    assert result == [vec, vec]


@pytest.mark.unit
def test_ollama_embed_batch_pads_short_response():
    """_ollama_embed_batch pads with None if server returns fewer embeddings than inputs."""
    vec = [0.1, 0.2]
    client = LLMClient({"provider": "ollama", "url": "http://localhost:11434"})

    with patch("src.llm_client.requests.post") as mock_post:
        mock_resp = MagicMock(spec=requests.Response)
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {"embeddings": [vec]}  # only 1 of 2
        mock_post.return_value = mock_resp

        result = client._ollama_embed_batch(["text1", "text2"])

    assert result == [vec, None]


# ---------------------------------------------------------------------------
# LLMClient.embed_texts  —  provider dispatch
# ---------------------------------------------------------------------------

@pytest.mark.unit
def test_embed_texts_ollama_uses_batch_api():
    """embed_texts routes Ollama provider to _ollama_embed_batch."""
    vecs = [[0.1], [0.2]]
    client = LLMClient({"provider": "ollama"})

    with patch.object(client, "_ollama_embed_batch", return_value=vecs) as mock_batch:
        result = client.embed_texts(["a", "b"])

    mock_batch.assert_called_once_with(["a", "b"], None)
    assert result == vecs


@pytest.mark.unit
def test_embed_texts_openai_uses_batch_api():
    """embed_texts routes OpenAI provider to _openai_embed_batch."""
    vecs = [[0.3], [0.4]]
    client = LLMClient({"provider": "openai", "api_key": "sk-test"})

    with patch.object(client, "_openai_embed_batch", return_value=vecs) as mock_batch:
        result = client.embed_texts(["x", "y"])

    mock_batch.assert_called_once_with(["x", "y"], None)
    assert result == vecs


@pytest.mark.unit
def test_embed_texts_empty_returns_empty_list():
    """embed_texts returns [] immediately for empty input."""
    client = LLMClient({"provider": "ollama"})
    with patch.object(client, "_ollama_embed_batch") as mock_batch:
        result = client.embed_texts([])
    mock_batch.assert_not_called()
    assert result == []


# ---------------------------------------------------------------------------
# Module-level embed_texts  —  mock mode
# ---------------------------------------------------------------------------

@pytest.mark.unit
def test_module_embed_texts_returns_list_for_each_input():
    """Module-level embed_texts returns one vector per input text."""
    vecs = [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]]
    texts = ["alpha", "beta", "gamma"]

    with patch("src.llm_client.requests.post") as mock_post:
        mock_resp = MagicMock(spec=requests.Response)
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {"embeddings": vecs}
        mock_post.return_value = mock_resp

        result = embed_texts(texts)

    assert len(result) == len(texts)
    for vec in result:
        assert isinstance(vec, list)
    assert result == vecs
