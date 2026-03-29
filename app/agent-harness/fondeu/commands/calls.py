import click
from rich.console import Console
from rich.table import Table

from ..http import api_get, print_json

console = Console()


@click.group()
def calls():
    """Funding calls commands"""
    pass


@calls.command("list")
@click.option("--status", default=None, help="Filter by status (deschis, inchis, previzionat)")
@click.option("--limit", default=20)
@click.pass_context
def list_calls(ctx, status, limit):
    """List funding calls (GET /api/v1/calls)"""
    params = {"limit": limit}
    if status:
        params["status"] = status

    resp = api_get("/api/v1/calls", params=params)
    data = resp.json()

    if ctx.obj.get("json"):
        print_json(data, as_json=True)
        return

    items = data.get("calls", data.get("data", []))
    if not items:
        console.print("[yellow]No funding calls found[/yellow]")
        return

    table = Table(title="Funding Calls")
    table.add_column("ID", max_width=12)
    table.add_column("Title", max_width=40)
    table.add_column("Program")
    table.add_column("Status")
    table.add_column("Deadline")

    for c in items:
        table.add_row(
            str(c.get("id", ""))[:12],
            (c.get("titleRo", c.get("title", "N/A")))[:40],
            c.get("programmeCode", "N/A"),
            c.get("status", "N/A"),
            str(c.get("submissionEnd", ""))[:10],
        )
    console.print(table)


@calls.command()
@click.argument("call_id")
@click.pass_context
def verify(ctx, call_id):
    """Verify a funding call against its live source"""
    import hashlib
    import httpx as hx

    console.print(f"[dim]Verifying call {call_id}...[/dim]")

    resp = api_get(f"/api/v1/calls/{call_id}")
    if resp.status_code != 200:
        console.print(f"[red]Call {call_id} not found[/red]")
        return

    call_data = resp.json()
    source_url = call_data.get("guideUrl") or call_data.get("sourceUrl")

    if not source_url:
        console.print("[yellow]No source URL for this call — cannot verify[/yellow]")
        return

    try:
        live_resp = hx.get(source_url, timeout=15.0, follow_redirects=True)
        live_hash = hashlib.sha256(live_resp.content).hexdigest()
        stored_hash = call_data.get("contentHash", "")

        if stored_hash and live_hash == stored_hash:
            console.print(f"[green]VERIFIED — content matches stored hash[/green]")
        elif stored_hash:
            console.print(f"[yellow]STALE — content has changed since ingestion[/yellow]")
            console.print(f"  Stored hash: {stored_hash[:16]}...")
            console.print(f"  Live hash:   {live_hash[:16]}...")
        else:
            console.print(f"[dim]Source reachable but no stored hash to compare[/dim]")

        console.print(f"  Source: {source_url}")
        console.print(f"  HTTP status: {live_resp.status_code}")
    except Exception as e:
        console.print(f"[red]UNVERIFIABLE — cannot reach source: {e}[/red]")


@calls.command()
@click.pass_context
def refresh(ctx):
    """Run all connectors and report changes"""
    console.print("[yellow]Connector refresh requires Task 13[/yellow]")
