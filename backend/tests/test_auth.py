"""
Unit tests for the Stack Auth backend token validation module.

Covers both validation strategies:
  - HTTP API strategy (when STACK_SECRET_SERVER_KEY is set)
  - Local JWT/JWKS strategy (fallback when only STACK_PROJECT_ID is set)
"""
import pytest
from unittest.mock import patch, MagicMock


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _reload_auth(monkeypatch, project_id="test-project", secret_server_key="", api_url="https://api.stack-auth.com"):
    """Re-import auth module with the given environment variables."""
    import importlib
    import src.api.auth as auth_mod

    monkeypatch.setenv("STACK_PROJECT_ID", project_id)
    monkeypatch.setenv("STACK_SECRET_SERVER_KEY", secret_server_key)
    monkeypatch.setenv("STACK_API_URL", api_url)

    importlib.reload(auth_mod)
    # Clear JWKS cache so each test starts fresh
    auth_mod._get_jwks_client.cache_clear()
    return auth_mod


# ---------------------------------------------------------------------------
# get_current_user dependency
# ---------------------------------------------------------------------------

class TestGetCurrentUser:
    def test_returns_none_when_header_missing(self, monkeypatch):
        auth = _reload_auth(monkeypatch)
        request = MagicMock()
        request.headers.get.return_value = ""
        assert auth.get_current_user(request) is None

    def test_returns_none_when_header_whitespace_only(self, monkeypatch):
        auth = _reload_auth(monkeypatch)
        request = MagicMock()
        request.headers.get.return_value = "   "
        assert auth.get_current_user(request) is None

    def test_calls_get_user_id_with_token(self, monkeypatch):
        auth = _reload_auth(monkeypatch)
        request = MagicMock()
        request.headers.get.return_value = "my-token"

        with patch.object(auth, "get_user_id", return_value="user-123") as mock_fn:
            result = auth.get_current_user(request)

        mock_fn.assert_called_once_with("my-token")
        assert result == "user-123"


# ---------------------------------------------------------------------------
# get_user_id – no credentials configured
# ---------------------------------------------------------------------------

class TestGetUserIdUnconfigured:
    def test_returns_none_when_project_id_not_set(self, monkeypatch):
        auth = _reload_auth(monkeypatch, project_id="", secret_server_key="")
        assert auth.get_user_id("some-token") is None


# ---------------------------------------------------------------------------
# HTTP API strategy (STACK_SECRET_SERVER_KEY set)
# ---------------------------------------------------------------------------

class TestGetUserIdHttpApi:
    def test_returns_user_id_on_success(self, monkeypatch):
        auth = _reload_auth(monkeypatch, project_id="proj-1", secret_server_key="sk-secret")

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"id": "user-abc"}

        with patch("httpx.get", return_value=mock_response) as mock_get:
            result = auth.get_user_id("valid-token")

        assert result == "user-abc"
        mock_get.assert_called_once()
        call_kwargs = mock_get.call_args
        headers = call_kwargs.kwargs["headers"]
        assert headers["x-stack-access-token"] == "valid-token"
        assert headers["x-stack-project-id"] == "proj-1"
        assert headers["x-stack-secret-server-key"] == "sk-secret"
        assert headers["x-stack-access-type"] == "server"

    def test_returns_none_on_401(self, monkeypatch):
        auth = _reload_auth(monkeypatch, project_id="proj-1", secret_server_key="sk-secret")

        mock_response = MagicMock()
        mock_response.status_code = 401

        with patch("httpx.get", return_value=mock_response):
            result = auth.get_user_id("bad-token")

        assert result is None

    def test_returns_none_on_network_error(self, monkeypatch):
        import httpx as httpx_mod
        auth = _reload_auth(monkeypatch, project_id="proj-1", secret_server_key="sk-secret")

        with patch("httpx.get", side_effect=httpx_mod.RequestError("timeout")):
            result = auth.get_user_id("token")

        assert result is None

    def test_hits_correct_url(self, monkeypatch):
        auth = _reload_auth(
            monkeypatch,
            project_id="proj-1",
            secret_server_key="sk-secret",
            api_url="https://custom.stack-auth.example.com",
        )

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"id": "u1"}

        with patch("httpx.get", return_value=mock_response) as mock_get:
            auth.get_user_id("token")

        url = mock_get.call_args.args[0]
        assert url == "https://custom.stack-auth.example.com/api/v1/users/me"


# ---------------------------------------------------------------------------
# JWKS strategy (only STACK_PROJECT_ID set, no STACK_SECRET_SERVER_KEY)
# ---------------------------------------------------------------------------

class TestGetUserIdJwks:
    def test_returns_user_id_on_valid_token(self, monkeypatch):
        auth = _reload_auth(monkeypatch, project_id="proj-1", secret_server_key="")

        mock_jwks = MagicMock()
        mock_signing_key = MagicMock()
        mock_signing_key.key = "fake-key"
        mock_jwks.get_signing_key_from_jwt.return_value = mock_signing_key

        with patch.object(auth, "_get_jwks_client", return_value=mock_jwks):
            with patch("jwt.decode", return_value={"sub": "user-xyz"}):
                result = auth.get_user_id("valid-jwt")

        assert result == "user-xyz"

    def test_returns_none_on_invalid_token(self, monkeypatch):
        from jwt.exceptions import InvalidTokenError
        auth = _reload_auth(monkeypatch, project_id="proj-1", secret_server_key="")

        mock_jwks = MagicMock()
        mock_jwks.get_signing_key_from_jwt.side_effect = InvalidTokenError("bad sig")

        with patch.object(auth, "_get_jwks_client", return_value=mock_jwks):
            result = auth.get_user_id("bad-jwt")

        assert result is None

    def test_returns_none_when_jwks_client_is_none(self, monkeypatch):
        auth = _reload_auth(monkeypatch, project_id="proj-1", secret_server_key="")

        with patch.object(auth, "_get_jwks_client", return_value=None):
            result = auth.get_user_id("any-token")

        assert result is None
