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


@ai.command()
@click.argument("project_id")
@click.pass_context
def propose(ctx, project_id):
    """Generate a proposal (POST /api/ai/generate-proposal)"""
    console.print("[dim]Generating proposal (this may take 30+ seconds)...[/dim]")
    resp = api_post("/api/ai/generate-proposal", json={"projectId": project_id})
    if resp.status_code == 200:
        print_json(resp.json(), as_json=ctx.obj.get("json", False))
    else:
        console.print(f"[red]Proposal generation failed: {resp.status_code}[/red]")
        console.print(resp.text[:300])


@ai.command()
@click.argument("project_id")
@click.pass_context
def match(ctx, project_id):
    """Match funding calls (POST /api/ai/match-grants)"""
    console.print("[dim]Matching grants...[/dim]")
    resp = api_post("/api/ai/match-grants", json={"projectId": project_id})
    if resp.status_code == 200:
        print_json(resp.json(), as_json=ctx.obj.get("json", False))
    else:
        console.print(f"[red]Grant matching failed: {resp.status_code}[/red]")
        console.print(resp.text[:300])


@ai.command()
@click.argument("project_id")
@click.pass_context
def eligibility(ctx, project_id):
    """Check eligibility (POST /api/ai/check-eligibility)"""
    resp = api_post("/api/ai/check-eligibility", json={"projectId": project_id})
    if resp.status_code == 200:
        print_json(resp.json(), as_json=ctx.obj.get("json", False))
    else:
        console.print(f"[red]Eligibility check failed: {resp.status_code}[/red]")
        console.print(resp.text[:300])


@ai.command()
@click.pass_context
def diagnose(ctx):
    """Check AI provider status (POST /api/ai/diagnostic)"""
    resp = api_post("/api/ai/diagnostic", json={})
    if resp.status_code == 200:
        print_json(resp.json(), as_json=ctx.obj.get("json", False))
    else:
        console.print(f"[red]Diagnostic failed: {resp.status_code}[/red]")
        console.print(resp.text[:300])
