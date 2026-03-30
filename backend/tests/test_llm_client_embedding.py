"""
Tests for LLMClient embedding error handling, focusing on 429 billing errors.
"""
import json
import os
import pytest
from unittest.mock import MagicMock, patch
import requests

from src.llm_client import LLMClient, _looks_like_billing_error


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
