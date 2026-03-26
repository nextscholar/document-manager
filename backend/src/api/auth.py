"""
Stack Auth backend token validation for the Document Manager API.

Uses the official Stack Auth Python JWT approach documented at:
https://docs.stack-auth.com/concepts/backend-integration
"""
import os
import logging
from typing import Optional
from functools import lru_cache

import jwt
from jwt import PyJWKClient
from jwt.exceptions import InvalidTokenError
from fastapi import Request

logger = logging.getLogger(__name__)

STACK_API_URL = os.environ.get("STACK_API_URL", "https://api.stack-auth.com")
STACK_PROJECT_ID = os.environ.get("STACK_PROJECT_ID", "")


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


def get_user_id(access_token: str) -> Optional[str]:
    """
    Validate a Stack Auth access token and return the user ID (``sub`` claim).

    Follows the official Stack Auth Python JWT verification example:

        signing_key = jwks_client.get_signing_key_from_jwt(access_token)
        payload = jwt.decode(access_token, signing_key.key,
                             algorithms=["ES256"], audience="<project-id>")

    Returns None if the token is invalid or if STACK_PROJECT_ID is unset.
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
        logger.debug("Invalid Stack Auth token: %s", exc)
        return None
    except Exception as exc:
        logger.warning("Unexpected error validating token: %s", exc)
        return None


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
