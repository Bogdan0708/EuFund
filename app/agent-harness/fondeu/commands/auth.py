import click
from rich.console import Console

from ..config import save_session, clear_session
from ..http import api_get, api_post, print_json

console = Console()


@click.group()
def auth():
    """Authentication commands"""
    pass


@auth.command()
@click.option("--email", prompt=True)
@click.option("--password", prompt=True, hide_input=True)
@click.pass_context
def login(ctx, email, password):
    """Login and store session token"""
    resp = api_post(
        "/api/auth/callback/credentials",
        data={"email": email, "password": password, "redirect": "false"},
    )

    if resp.status_code == 200:
        session_token = resp.cookies.get("next-auth.session-token")
        csrf_token = resp.cookies.get("csrf-token")

        if session_token:
            save_session(session_token, csrf_token)
            console.print("[green]Login successful. Session saved.[/green]")
        else:
            for cookie_name, cookie_value in resp.cookies.items():
                if "session" in cookie_name.lower():
                    save_session(cookie_value, csrf_token)
                    console.print("[green]Login successful. Session saved.[/green]")
                    return
            console.print("[yellow]Login response OK but no session cookie found.[/yellow]")
            console.print(f"Cookies: {dict(resp.cookies)}")
    else:
        console.print(f"[red]Login failed: {resp.status_code}[/red]")
        if ctx.obj.get("json"):
            print_json(resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {"error": resp.text}, as_json=True)


@auth.command()
@click.pass_context
def whoami(ctx):
    """Show current session info (GET /api/auth/session)"""
    resp = api_get("/api/auth/session")

    if resp.status_code == 200:
        data = resp.json()
        if ctx.obj.get("json"):
            print_json(data, as_json=True)
        elif data.get("user"):
            console.print(f"[green]Logged in as:[/green] {data['user'].get('email', 'unknown')}")
            console.print(f"Name: {data['user'].get('name', 'N/A')}")
        else:
            console.print("[yellow]No active session[/yellow]")
    else:
        console.print(f"[red]Session check failed: {resp.status_code}[/red]")


@auth.command()
def logout():
    """Clear stored session"""
    clear_session()
    console.print("[green]Session cleared[/green]")
