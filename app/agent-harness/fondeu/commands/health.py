import click
from rich.console import Console
from rich.table import Table

from ..http import api_get, print_json

console = Console()


@click.command()
@click.pass_context
def health(ctx):
    """Check platform health (GET /api/health + /api/ready)"""
    results = {}

    for endpoint in ["/api/health", "/api/ready"]:
        try:
            resp = api_get(endpoint)
            results[endpoint] = {"status": resp.status_code, "body": resp.json()}
        except Exception as e:
            results[endpoint] = {"status": "error", "body": str(e)}

    if ctx.obj.get("json"):
        print_json(results, as_json=True)
        return

    table = Table(title="Platform Health")
    table.add_column("Endpoint")
    table.add_column("Status")
    table.add_column("Details")

    for endpoint, result in results.items():
        status = str(result["status"])
        color = "green" if status == "200" else "red"
        table.add_row(endpoint, f"[{color}]{status}[/{color}]", str(result["body"])[:80])

    console.print(table)
