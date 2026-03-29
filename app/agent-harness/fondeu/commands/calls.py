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
    console.print(f"[dim]Verifying call {call_id} against live source...[/dim]")
    console.print("[yellow]Freshness verification not yet implemented — see Task 15[/yellow]")


@calls.command()
@click.pass_context
def refresh(ctx):
    """Run all connectors and report changes"""
    console.print("[yellow]Connector refresh requires Task 13[/yellow]")
