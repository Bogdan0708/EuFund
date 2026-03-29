import click
from rich.console import Console
from rich.table import Table

console = Console()

KNOWN_SOURCES = [
    {"id": "oportunitati-ue", "name": "Oportunitati UE Gov", "type": "national"},
    {"id": "afm", "name": "AFM (Mediu)", "type": "national"},
    {"id": "fngcimm", "name": "FNGCIMM (Garantii)", "type": "national"},
    {"id": "adr-nord-est", "name": "ADR Nord-Est", "type": "regional"},
    {"id": "adr-centru", "name": "ADR Centru", "type": "regional"},
    {"id": "adr-sud-est", "name": "ADR Sud-Est", "type": "regional"},
    {"id": "adr-sud-muntenia", "name": "ADR Sud-Muntenia", "type": "regional"},
    {"id": "adr-sud-vest", "name": "ADR Sud-Vest", "type": "regional"},
    {"id": "adr-vest", "name": "ADR Vest", "type": "regional"},
    {"id": "adr-nord-vest", "name": "ADR Nord-Vest", "type": "regional"},
    {"id": "adr-bucuresti-ilfov", "name": "ADR Bucuresti-Ilfov", "type": "regional"},
    {"id": "ec-portal", "name": "EC Portal", "type": "eu"},
    {"id": "mipe-pnrr", "name": "MIPE/MySMIS", "type": "national"},
]


@click.group()
def connectors():
    """External data source connector commands"""
    pass


@connectors.command("list")
@click.pass_context
def list_connectors(ctx):
    """List all registered connectors and their status"""
    from ..http import print_json

    if ctx.obj.get("json"):
        print_json(KNOWN_SOURCES, as_json=True)
        return

    table = Table(title="Registered Connectors")
    table.add_column("ID")
    table.add_column("Name")
    table.add_column("Type")

    for src in KNOWN_SOURCES:
        table.add_row(src["id"], src["name"], src["type"])

    console.print(table)


@connectors.command()
@click.option("--source", default=None, help="Test specific source by ID")
@click.pass_context
def test(ctx, source):
    """Test connector(s) by checking if source URLs are reachable"""
    sources_to_test = KNOWN_SOURCES
    if source:
        sources_to_test = [s for s in KNOWN_SOURCES if s["id"] == source]
        if not sources_to_test:
            console.print(f"[red]Unknown source: {source}[/red]")
            return

    console.print(f"Testing {len(sources_to_test)} connector(s)...")
    for src in sources_to_test:
        console.print(f"  [{src['type']}] {src['id']}: {src['name']}")

    console.print("[yellow]Full connector testing requires Task 13 (connector hardening)[/yellow]")


@connectors.command("run")
@click.option("--source", default=None, help="Run specific source by ID")
@click.option("--all", "run_all_flag", is_flag=True, help="Run all connectors")
@click.pass_context
def run(ctx, source, run_all_flag):
    """Run connector(s) to fetch and validate data"""
    if not source and not run_all_flag:
        console.print("[red]Specify --source <id> or --all[/red]")
        return

    console.print("[yellow]Connector execution requires Task 13[/yellow]")
