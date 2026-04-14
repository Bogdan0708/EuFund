import httpx
from rich.console import Console

from .config import get_base_url, load_session

console = Console()


def get_client() -> httpx.Client:
    session = load_session()
    cookies = {}
    headers = {}

    if session:
        cookies["next-auth.session-token"] = session["session_token"]
        if session.get("csrf_token"):
            headers["x-csrf-token"] = session["csrf_token"]
            cookies["csrf-token"] = session["csrf_token"]

    return httpx.Client(
        base_url=get_base_url(),
        cookies=cookies,
        headers=headers,
        timeout=120.0,
        follow_redirects=True,
    )


def api_get(path: str, **kwargs) -> httpx.Response:
    with get_client() as client:
        resp = client.get(path, **kwargs)
        return resp


def api_post(path: str, **kwargs) -> httpx.Response:
    with get_client() as client:
        resp = client.post(path, **kwargs)
        return resp


def api_put(path: str, **kwargs) -> httpx.Response:
    with get_client() as client:
        resp = client.put(path, **kwargs)
        return resp


def print_json(data: dict | list, as_json: bool = False):
    if as_json:
        import json
        console.print(json.dumps(data, indent=2, default=str))
    else:
        from rich.pretty import pprint
        pprint(data)
