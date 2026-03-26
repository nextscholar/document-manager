"""
Stack Auth backend token validation for the Document Manager API.

Two validation strategies are supported (in priority order):

1. **HTTP API** (preferred when ``STACK_SECRET_SERVER_KEY`` is set):
   Calls ``GET {STACK_API_URL}/api/v1/users/me`` with the access token and
   the secret server key, as described in the Stack Auth REST API docs:
   https://docs.stack-auth.com/rest-api/auth/users/get-current-user

2. **Local JWT / JWKS** (fallback when only ``STACK_PROJECT_ID`` is set):
   Downloads the project's JWKS and verifies the token locally using PyJWT,
   as described in the Stack Auth backend integration guide:
   https://docs.stack-auth.com/concepts/backend-integration

Environment variables (all read from the container environment):
  STACK_PROJECT_ID        – Stack Auth project ID (required for both strategies).
  STACK_SECRET_SERVER_KEY – Secret server key (enables the HTTP API strategy).
  STACK_API_URL           – Base URL of the Stack Auth API
                            (defaults to https://api.stack-auth.com).
"""
import os
import logging
from typing import Optional
from functools import lru_cache

import httpx
import jwt
from jwt import PyJWKClient
from jwt.exceptions import InvalidTokenError
from fastapi import Request

logger = logging.getLogger(__name__)

STACK_API_URL = os.environ.get("STACK_API_URL", "https://api.stack-auth.com")
STACK_PROJECT_ID = os.environ.get("STACK_PROJECT_ID", "")
STACK_SECRET_SERVER_KEY = os.environ.get("STACK_SECRET_SERVER_KEY", "")


# ---------------------------------------------------------------------------
# Strategy 1: HTTP API validation (requires STACK_SECRET_SERVER_KEY)
# ---------------------------------------------------------------------------

def _get_user_id_via_http_api(access_token: str) -> Optional[str]:
    """
    Validate *access_token* by calling the Stack Auth REST API.

    Sends a GET request to ``{STACK_API_URL}/api/v1/users/me`` with the
    access token and secret server key headers.  Returns the user ID on
    success, or None if validation fails.
    """
    url = f"{STACK_API_URL}/api/v1/users/me"
    headers = {
        "x-stack-access-type": "server",
        "x-stack-project-id": STACK_PROJECT_ID,
        "x-stack-secret-server-key": STACK_SECRET_SERVER_KEY,
        "x-stack-access-token": access_token,
    }
    try:
        response = httpx.get(url, headers=headers, timeout=10)
        if response.status_code == 200:
            data = response.json()
            return data.get("id")
        logger.debug(
            "Stack Auth HTTP API returned %s for token validation",
            response.status_code,
        )
        return None
    except httpx.RequestError as exc:
        logger.warning("Stack Auth HTTP API request failed: %s", exc)
        return None
    except Exception as exc:
        logger.warning("Unexpected error calling Stack Auth HTTP API: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Strategy 2: Local JWT / JWKS validation (requires only STACK_PROJECT_ID)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _get_jwks_client() -> Optional[PyJWKClient]:
    """Return a cached JWKS client. Returns None if STACK_PROJECT_ID is not set."""
    if not STACK_PROJECT_ID:
        logger.warning(
            "STACK_PROJECT_ID is not configured; user authentication is disabled."
        )
        return None
    jwks_url = (
        f"{STACK_API_URL}/api/v1/projects/{STACK_PROJECT_ID}/.well-known/jwks.json"
    )
    return PyJWKClient(jwks_url)


def _get_user_id_via_jwks(access_token: str) -> Optional[str]:
    """
    Validate *access_token* locally using the project's JWKS endpoint.

    Returns the user ID (``sub`` claim) on success, or None on failure.
    """
    jwks_client = _get_jwks_client()
    if jwks_client is None:
        return None

    try:
        signing_key = jwks_client.get_signing_key_from_jwt(access_token)
        payload = jwt.decode(
            access_token,
            signing_key.key,
            algorithms=["ES256"],
            audience=STACK_PROJECT_ID,
        )
        return payload.get("sub")
    except InvalidTokenError as exc:
        logger.debug("Invalid Stack Auth token (JWKS): %s", exc)
        return None
    except Exception as exc:
        logger.warning("Unexpected error validating token via JWKS: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

def get_user_id(access_token: str) -> Optional[str]:
    """
    Validate a Stack Auth access token and return the user ID.

    Uses the HTTP API strategy when ``STACK_SECRET_SERVER_KEY`` is configured,
    otherwise falls back to local JWT/JWKS verification.

    Returns None if the token is invalid or if no Stack Auth credentials are
    configured.
    """
    if not STACK_PROJECT_ID:
        logger.warning(
            "STACK_PROJECT_ID is not configured; user authentication is disabled."
        )
        return None

    if STACK_SECRET_SERVER_KEY:
        return _get_user_id_via_http_api(access_token)

    return _get_user_id_via_jwks(access_token)


def get_current_user(request: Request) -> Optional[str]:
    """
    FastAPI dependency – extract the Stack Auth access token from the
    ``x-stack-access-token`` request header and return the validated user ID.

    Returns None when the header is absent or the token is invalid.
    """
    token = request.headers.get("x-stack-access-token", "").strip()
    if not token:
        return None
    return get_user_id(token)
