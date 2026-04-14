import click
from rich.console import Console

from ..http import api_post, print_json

console = Console()


@click.group()
def ai():
    """AI feature commands"""
    pass


@ai.command()
@click.argument("message")
@click.pass_context
def chat(ctx, message):
    """Send a chat message (POST /api/ai/chat)"""
    console.print("[dim]Sending to AI...[/dim]")
    resp = api_post("/api/ai/chat", json={"message": message})
    if resp.status_code == 200:
        data = resp.json()
        if ctx.obj.get("json"):
            print_json(data, as_json=True)
        else:
            console.print(data.get("response", data.get("message", str(data))))
    else:
        console.print(f"[red]AI chat failed: {resp.status_code}[/red]")
        console.print(resp.text[:300])
