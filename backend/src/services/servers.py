"""
LLM Providers service - CRUD operations for managing LLM providers.
Supports Ollama servers and cloud providers (OpenAI, Anthropic, etc.)
Part of Phase 7: Dynamic Worker Scaling
"""

from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
import logging
import requests

from sqlalchemy.orm import Session
from src.db.models import LLMProvider

logger = logging.getLogger(__name__)

# Provider type constants
PROVIDER_OLLAMA = 'ollama'
PROVIDER_OPENAI = 'openai'
PROVIDER_ANTHROPIC = 'anthropic'
PROVIDER_GOOGLE = 'google'
PROVIDER_QWEN = 'qwen'          # Alibaba Cloud Qwen / DashScope
PROVIDER_DEEPSEEK = 'deepseek'  # DeepSeek AI
PROVIDER_ZHIPU = 'zhipu'        # Zhipu AI (GLM / ChatGLM)

# Default API endpoints for each provider
PROVIDER_DEFAULT_URLS = {
    PROVIDER_OPENAI: 'https://api.openai.com/v1',
    PROVIDER_ANTHROPIC: 'https://api.anthropic.com',
    PROVIDER_QWEN: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    PROVIDER_DEEPSEEK: 'https://api.deepseek.com/v1',
    PROVIDER_ZHIPU: 'https://open.bigmodel.cn/api/paas/v4',
}

CLOUD_PROVIDERS = [
    PROVIDER_OPENAI, PROVIDER_ANTHROPIC, PROVIDER_GOOGLE,
    PROVIDER_QWEN, PROVIDER_DEEPSEEK, PROVIDER_ZHIPU,
]

# Providers that use an OpenAI-compatible /chat/completions + /models API
OPENAI_COMPATIBLE_PROVIDERS = [
    PROVIDER_OPENAI, PROVIDER_QWEN, PROVIDER_DEEPSEEK, PROVIDER_ZHIPU,
]


def get_all_servers(db: Session, enabled_only: bool = False) -> List[LLMProvider]:
    """Get all registered Ollama servers."""
    query = db.query(LLMProvider)
    if enabled_only:
        query = query.filter(LLMProvider.enabled == True)
    return query.order_by(LLMProvider.priority.desc(), LLMProvider.name).all()


def get_server(db: Session, server_id: int) -> Optional[LLMProvider]:
    """Get a specific server by ID."""
    return db.query(LLMProvider).filter(LLMProvider.id == server_id).first()


def get_server_by_name(db: Session, name: str) -> Optional[LLMProvider]:
    """Get a specific server by name."""
    return db.query(LLMProvider).filter(LLMProvider.name == name).first()


def get_server_by_url(db: Session, url: str) -> Optional[LLMProvider]:
    """Get a specific server by URL."""
    normalized_url = url.rstrip('/')
    return db.query(LLMProvider).filter(LLMProvider.url == normalized_url).first()


def create_server(
    db: Session,
    name: str,
    url: str,
    enabled: bool = True,
    priority: int = 0,
    provider_type: str = PROVIDER_OLLAMA,
    api_key: Optional[str] = None,
    default_model: Optional[str] = None
) -> LLMProvider:
    """Create a new LLM provider entry."""
    normalized_url = url.rstrip('/')
    
    server = LLMProvider(
        name=name,
        url=normalized_url,
        enabled=enabled,
        priority=priority,
        status='unknown' if provider_type == PROVIDER_OLLAMA else ('unconfigured' if not api_key else 'unknown'),
        provider_type=provider_type,
        api_key=api_key,
        default_model=default_model
    )
    
    db.add(server)
    db.commit()
    db.refresh(server)
    
    logger.info(f"Created LLM provider: {name} ({provider_type}) at {normalized_url}")
    return server


def update_server(
    db: Session,
    server_id: int,
    name: Optional[str] = None,
    url: Optional[str] = None,
    enabled: Optional[bool] = None,
    priority: Optional[int] = None,
    api_key: Optional[str] = None,
    default_model: Optional[str] = None
) -> Optional[LLMProvider]:
    """Update an existing provider's configuration."""
    server = get_server(db, server_id)
    if not server:
        return None
    
    if name is not None:
        server.name = name
    if url is not None:
        server.url = url.rstrip('/')
    if enabled is not None:
        server.enabled = enabled
    if priority is not None:
        server.priority = priority
    if api_key is not None:
        server.api_key = api_key
        # Update status if cloud provider gets API key
        if server.provider_type in CLOUD_PROVIDERS and api_key:
            server.status = 'unknown'  # Ready to test
    if default_model is not None:
        server.default_model = default_model
    
    db.commit()
    db.refresh(server)
    
    logger.info(f"Updated LLM provider {server_id}: {server.name}")
    return server


def delete_server(db: Session, server_id: int) -> bool:
    """Delete a server from the registry."""
    server = get_server(db, server_id)
    if not server:
        return False
    
    name = server.name
    db.delete(server)
    db.commit()
    
    logger.info(f"Deleted Ollama server: {name}")
    return True


def detect_model_capabilities(model: Dict[str, Any]) -> Dict[str, bool]:
    """Detect capabilities from model info."""
    name = model.get("name", "").lower()
    details = model.get("details", {})
    families = details.get("families", [])
    
    caps = {"chat": True, "embedding": False, "vision": False}
    
    # Embedding models
    if any(x in name for x in ["embed", "nomic", "bge", "e5-", "gte-"]):
        caps = {"chat": False, "embedding": True, "vision": False}
    
    # Vision models
    if any(x in name for x in ["llava", "vision", "bakllava", "moondream"]):
        caps["vision"] = True
    
    if "clip" in families:
        caps["vision"] = True
    
    return caps


def check_server_health(db: Session, server_id: int, timeout: int = 10) -> Dict[str, Any]:
    """
    Check the health of an Ollama server and update its status.
    Returns detailed health info.
    """
    server = get_server(db, server_id)
    if not server:
        return {"success": False, "error": "Server not found"}
    
    result = {
        "server_id": server_id,
        "name": server.name,
        "url": server.url,
        "connected": False,
        "models": [],
        "capabilities": {"chat": False, "embedding": False, "vision": False},
        "gpu_info": None,
        "error": None
    }
    
    try:
        # Check /api/tags endpoint for models
        resp = requests.get(f"{server.url}/api/tags", timeout=timeout)
        
        if resp.status_code == 200:
            data = resp.json()
            models = data.get("models", [])
            
            result["connected"] = True
            result["models"] = [m.get("name") for m in models]
            
            # Aggregate capabilities from all models
            for m in models:
                model_caps = detect_model_capabilities(m)
                for cap, has in model_caps.items():
                    if has:
                        result["capabilities"][cap] = True
            
            # Update server status in DB
            server.status = "online"
            server.status_message = None
            server.models_available = result["models"]
            server.capabilities = result["capabilities"]
            
        else:
            result["error"] = f"HTTP {resp.status_code}"
            server.status = "error"
            server.status_message = result["error"]
            
    except requests.Timeout:
        result["error"] = "Connection timed out"
        server.status = "offline"
        server.status_message = result["error"]
        
    except requests.ConnectionError as e:
        result["error"] = "Connection refused"
        server.status = "offline"
        server.status_message = result["error"]
        
    except Exception as e:
        result["error"] = str(e)[:200]
        server.status = "error"
        server.status_message = result["error"]
    
    # Update health check timestamp
    server.last_health_check = datetime.now(timezone.utc)
    db.commit()
    
    logger.info(f"Health check for {server.name}: {server.status}")
    return result


def check_openai_health(db: Session, server_id: int, timeout: int = 10) -> Dict[str, Any]:
    """Check health of an OpenAI API connection."""
    server = get_server(db, server_id)
    if not server:
        return {"success": False, "error": "Provider not found"}
    
    result = {
        "server_id": server_id,
        "name": server.name,
        "url": server.url,
        "connected": False,
        "models": [],
        "capabilities": {"chat": True, "embedding": True, "vision": True},
        "error": None
    }
    
    if not server.api_key:
        result["error"] = "API key not configured"
        server.status = "unconfigured"
        server.status_message = result["error"]
        db.commit()
        return result
    
    try:
        headers = {"Authorization": f"Bearer {server.api_key}"}
        resp = requests.get(
            f"{server.url or 'https://api.openai.com/v1'}/models",
            headers=headers,
            timeout=timeout
        )
        
        if resp.status_code == 200:
            data = resp.json()
            models = [m.get("id") for m in data.get("data", [])]
            
            result["connected"] = True
            result["models"] = models
            
            server.status = "online"
            server.status_message = None
            server.models_available = models
            server.capabilities = result["capabilities"]
        elif resp.status_code == 401:
            result["error"] = "Invalid API key"
            server.status = "error"
            server.status_message = result["error"]
        else:
            result["error"] = f"HTTP {resp.status_code}"
            server.status = "error"
            server.status_message = result["error"]
            
    except Exception as e:
        result["error"] = str(e)[:200]
        server.status = "error"
        server.status_message = result["error"]
    
    server.last_health_check = datetime.now(timezone.utc)
    db.commit()
    
    return result


def check_anthropic_health(db: Session, server_id: int, timeout: int = 10) -> Dict[str, Any]:
    """Check health of an Anthropic API connection."""
    server = get_server(db, server_id)
    if not server:
        return {"success": False, "error": "Provider not found"}
    
    result = {
        "server_id": server_id,
        "name": server.name,
        "url": server.url,
        "connected": False,
        "models": [],
        "capabilities": {"chat": True, "embedding": False, "vision": True},
        "error": None
    }
    
    if not server.api_key:
        result["error"] = "API key not configured"
        server.status = "unconfigured"
        server.status_message = result["error"]
        db.commit()
        return result
    
    try:
        # Anthropic doesn't have a models list endpoint, so we test with a minimal request
        headers = {
            "x-api-key": server.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
        }
        # Use a count_tokens request as a health check (minimal cost)
        resp = requests.post(
            f"{server.url or 'https://api.anthropic.com'}/v1/messages",
            headers=headers,
            json={
                "model": "claude-3-haiku-20240307",
                "max_tokens": 1,
                "messages": [{"role": "user", "content": "hi"}]
            },
            timeout=timeout
        )
        
        # Any response means we connected (even 400 for bad request is ok)
        if resp.status_code in [200, 400]:
            result["connected"] = True
            # Anthropic's available models
            result["models"] = [
                "claude-3-5-sonnet-20241022",
                "claude-3-5-haiku-20241022", 
                "claude-3-opus-20240229",
                "claude-3-sonnet-20240229",
                "claude-3-haiku-20240307"
            ]
            
            server.status = "online"
            server.status_message = None
            server.models_available = result["models"]
            server.capabilities = result["capabilities"]
        elif resp.status_code == 401:
            result["error"] = "Invalid API key"
            server.status = "error"
            server.status_message = result["error"]
        else:
            result["error"] = f"HTTP {resp.status_code}"
            server.status = "error"
            server.status_message = result["error"]
            
    except Exception as e:
        result["error"] = str(e)[:200]
        server.status = "error"
        server.status_message = result["error"]
    
    server.last_health_check = datetime.now(timezone.utc)
    db.commit()
    
    return result


def check_openai_compatible_health(
    db: Session,
    server_id: int,
    timeout: int = 10,
    provider_type: str = PROVIDER_OPENAI,
    models_list: Optional[List[str]] = None,
    capabilities: Optional[Dict[str, bool]] = None,
) -> Dict[str, Any]:
    """
    Generic health check for providers that expose an OpenAI-compatible API.
    Used by Qwen (DashScope), DeepSeek, and Zhipu AI in addition to OpenAI itself.
    """
    server = get_server(db, server_id)
    if not server:
        return {"success": False, "error": "Provider not found"}

    default_caps = {"chat": True, "embedding": False, "vision": False}
    caps = capabilities or default_caps

    result = {
        "server_id": server_id,
        "name": server.name,
        "url": server.url,
        "connected": False,
        "models": models_list or [],
        "capabilities": caps,
        "error": None,
    }

    if not server.api_key:
        result["error"] = "API key not configured"
        server.status = "unconfigured"
        server.status_message = result["error"]
        db.commit()
        return result

    try:
        base_url = server.url or PROVIDER_DEFAULT_URLS.get(provider_type, "")
        base_url = base_url.rstrip("/")

        # Build auth header (all these providers use Bearer token auth)
        headers = {
            "Authorization": f"Bearer {server.api_key}",
            "Content-Type": "application/json",
        }

        # Try the /models endpoint first (OpenAI-compatible)
        try:
            resp = requests.get(f"{base_url}/models", headers=headers, timeout=timeout)
            if resp.status_code == 200:
                data = resp.json()
                fetched = [m.get("id") for m in data.get("data", [])]
                if fetched:
                    # Merge fetched models with known defaults so that embedding /
                    # vision models defined in models_list are never lost even when
                    # the provider's /models endpoint omits them (e.g. Qwen may not
                    # list text-embedding-v3 under every account tier).
                    merged = list(fetched)
                    for m in (models_list or []):
                        if m not in merged:
                            merged.append(m)
                    result["models"] = merged
                result["connected"] = True
                server.status = "online"
                server.status_message = None
                server.models_available = result["models"]
                server.capabilities = result["capabilities"]
                server.last_health_check = datetime.now(timezone.utc)
                db.commit()
                return result
        except Exception:
            pass  # Fall through to a chat-based probe

        # Some providers (e.g. Zhipu) may not expose /models; probe with a chat call
        probe_model = server.default_model or (result["models"][0] if result["models"] else None)
        if probe_model:
            resp = requests.post(
                f"{base_url}/chat/completions",
                headers=headers,
                json={
                    "model": probe_model,
                    "messages": [{"role": "user", "content": "hi"}],
                    "max_tokens": 1,
                },
                timeout=timeout,
            )
            # Any non-401 response means connectivity is OK
            if resp.status_code in (200, 400, 422):
                result["connected"] = True
                server.status = "online"
                server.status_message = None
                server.models_available = result["models"]
                server.capabilities = result["capabilities"]
            elif resp.status_code == 401:
                result["error"] = "Invalid API key"
                server.status = "error"
                server.status_message = result["error"]
            else:
                result["error"] = f"HTTP {resp.status_code}"
                server.status = "error"
                server.status_message = result["error"]
        else:
            result["error"] = "No model specified for health probe"
            server.status = "unconfigured"
            server.status_message = result["error"]

    except requests.Timeout:
        result["error"] = "Connection timed out"
        server.status = "offline"
        server.status_message = result["error"]
    except requests.ConnectionError:
        result["error"] = "Connection refused"
        server.status = "offline"
        server.status_message = result["error"]
    except Exception as e:
        result["error"] = str(e)[:200]
        server.status = "error"
        server.status_message = result["error"]

    server.last_health_check = datetime.now(timezone.utc)
    db.commit()
    return result


def check_qwen_health(db: Session, server_id: int, timeout: int = 10) -> Dict[str, Any]:
    """Check health of an Alibaba Cloud Qwen (DashScope) API connection."""
    return check_openai_compatible_health(
        db, server_id, timeout,
        provider_type=PROVIDER_QWEN,
        models_list=[
            "qwen-max", "qwen-plus", "qwen-turbo",
            "qwen-long", "qwen-max-latest",
            "text-embedding-v3",
        ],
        capabilities={"chat": True, "embedding": True, "vision": True},
    )


def check_deepseek_health(db: Session, server_id: int, timeout: int = 10) -> Dict[str, Any]:
    """Check health of a DeepSeek API connection."""
    return check_openai_compatible_health(
        db, server_id, timeout,
        provider_type=PROVIDER_DEEPSEEK,
        models_list=[
            "deepseek-chat", "deepseek-reasoner",
        ],
        capabilities={"chat": True, "embedding": False, "vision": False},
    )


def check_zhipu_health(db: Session, server_id: int, timeout: int = 10) -> Dict[str, Any]:
    """Check health of a Zhipu AI (GLM) API connection."""
    return check_openai_compatible_health(
        db, server_id, timeout,
        provider_type=PROVIDER_ZHIPU,
        models_list=[
            "glm-4-plus", "glm-4-air", "glm-4-flash",
            "glm-4v", "embedding-3",
        ],
        capabilities={"chat": True, "embedding": True, "vision": True},
    )


def check_provider_health(db: Session, server_id: int, timeout: int = 10) -> Dict[str, Any]:
    """Check health of any provider type."""
    server = get_server(db, server_id)
    if not server:
        return {"success": False, "error": "Provider not found"}

    provider_type = server.provider_type or PROVIDER_OLLAMA

    if provider_type == PROVIDER_OLLAMA:
        return check_server_health(db, server_id, timeout)
    elif provider_type == PROVIDER_OPENAI:
        return check_openai_health(db, server_id, timeout)
    elif provider_type == PROVIDER_ANTHROPIC:
        return check_anthropic_health(db, server_id, timeout)
    elif provider_type == PROVIDER_QWEN:
        return check_qwen_health(db, server_id, timeout)
    elif provider_type == PROVIDER_DEEPSEEK:
        return check_deepseek_health(db, server_id, timeout)
    elif provider_type == PROVIDER_ZHIPU:
        return check_zhipu_health(db, server_id, timeout)
    else:
        return {"success": False, "error": f"Unknown provider type: {provider_type}"}


def check_all_servers_health(db: Session, enabled_only: bool = True) -> List[Dict[str, Any]]:
    """Check health of all registered servers."""
    servers = get_all_servers(db, enabled_only=enabled_only)
    results = []

    for server in servers:
        # Use the unified dispatcher so cloud providers are handled correctly
        result = check_provider_health(db, server.id)
        results.append(result)

    return results


def get_online_servers(db: Session) -> List[LLMProvider]:
    """Get all online and enabled servers, sorted by priority."""
    return (
        db.query(LLMProvider)
        .filter(LLMProvider.enabled == True)
        .filter(LLMProvider.status == "online")
        .order_by(LLMProvider.priority.desc())
        .all()
    )


def get_best_server_for_capability(db: Session, capability: str) -> Optional[LLMProvider]:
    """
    Get the best available server that has a specific capability.
    Returns the highest priority online server with that capability.
    """
    servers = get_online_servers(db)
    
    for server in servers:
        caps = server.capabilities or {}
        if caps.get(capability):
            return server
    
    return None


def server_to_dict(server: LLMProvider, include_api_key: bool = False) -> Dict[str, Any]:
    """Convert server model to dictionary for API responses."""
    result = {
        "id": server.id,
        "name": server.name,
        "url": server.url,
        "enabled": server.enabled,
        "status": server.status,
        "status_message": server.status_message,
        "last_health_check": server.last_health_check.isoformat() if server.last_health_check else None,
        "gpu_info": server.gpu_info,
        "models_available": server.models_available or [],
        "capabilities": server.capabilities or {},
        "priority": server.priority,
        "worker_count": len(server.workers) if server.workers else 0,
        "created_at": server.created_at.isoformat() if server.created_at else None,
        "updated_at": server.updated_at.isoformat() if server.updated_at else None,
        # New fields for cloud providers
        "provider_type": server.provider_type or PROVIDER_OLLAMA,
        "has_api_key": bool(server.api_key),
        "default_model": server.default_model,
        "rate_limits": server.rate_limits,
        "usage_stats": server.usage_stats
    }
    
    # Only include API key if explicitly requested (for security)
    if include_api_key and server.api_key:
        # Mask the API key for display (show first 8 and last 4 chars)
        key = server.api_key
        if len(key) > 12:
            result["api_key_masked"] = f"{key[:8]}...{key[-4:]}"
        else:
            result["api_key_masked"] = "****"
    
    return result


def get_providers_by_type(db: Session, provider_type: str, enabled_only: bool = False) -> List[LLMProvider]:
    """Get all providers of a specific type."""
    query = db.query(LLMProvider).filter(LLMProvider.provider_type == provider_type)
    if enabled_only:
        query = query.filter(LLMProvider.enabled == True)
    return query.order_by(LLMProvider.priority.desc(), LLMProvider.name).all()


def get_ollama_providers(db: Session, enabled_only: bool = False) -> List[LLMProvider]:
    """Get only Ollama providers (for workers)."""
    return get_providers_by_type(db, PROVIDER_OLLAMA, enabled_only)


def get_cloud_providers(db: Session, enabled_only: bool = False) -> List[LLMProvider]:
    """Get only cloud providers (OpenAI, Anthropic, etc.)."""
    query = db.query(LLMProvider).filter(LLMProvider.provider_type.in_(CLOUD_PROVIDERS))
    if enabled_only:
        query = query.filter(LLMProvider.enabled == True)
    return query.order_by(LLMProvider.priority.desc(), LLMProvider.name).all()


def get_enabled_providers_for_worker(db: Session) -> List[Dict[str, Any]]:
    """
    Get all enabled and online providers with full config for worker use.
    This includes API keys (for cloud providers) needed for LLM calls.
    """
    providers = get_all_servers(db, enabled_only=True)
    result = []
    
    for server in providers:
        # Skip providers that are offline or unconfigured
        if server.status not in ('online', 'unknown'):
            continue
            
        provider_config = {
            "id": server.id,
            "name": server.name,
            "url": server.url,
            "enabled": server.enabled,
            "status": server.status,
            "provider_type": server.provider_type or PROVIDER_OLLAMA,
            "default_model": server.default_model,
            "capabilities": server.capabilities or {},
            "priority": server.priority,
            # Include API key for cloud providers (needed for actual LLM calls)
            "api_key": server.api_key,
            # Model info from config or last known
            "embedding_model": (server.capabilities or {}).get('embedding_model'),
            "vision_model": (server.capabilities or {}).get('vision_model'),
        }
        result.append(provider_config)
    
    # Sort by priority (highest first)
    result.sort(key=lambda x: x.get('priority', 0), reverse=True)
    return result
