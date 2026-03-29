import json
from pathlib import Path

CONFIG_DIR = Path.home() / ".fondeu"
SESSION_FILE = CONFIG_DIR / "session.json"
DEFAULT_BASE_URL = "http://localhost:3000"
DEFAULT_QDRANT_URL = "http://localhost:6333"


def ensure_config_dir():
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)


def get_base_url() -> str:
    return DEFAULT_BASE_URL


def get_qdrant_url() -> str:
    return DEFAULT_QDRANT_URL


def save_session(token: str, csrf_token: str | None = None):
    ensure_config_dir()
    SESSION_FILE.write_text(
        json.dumps({"session_token": token, "csrf_token": csrf_token})
    )


def load_session() -> dict | None:
    if not SESSION_FILE.exists():
        return None
    try:
        return json.loads(SESSION_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def clear_session():
    if SESSION_FILE.exists():
        SESSION_FILE.unlink()
