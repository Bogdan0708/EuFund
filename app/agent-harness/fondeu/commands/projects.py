import click
from rich.console import Console
from rich.table import Table

from ..http import api_get, api_post, print_json

console = Console()


@click.group()
def projects():
    """Project management commands"""
    pass


@projects.command("list")
@click.option("--limit", default=20, help="Number of results")
@click.pass_context
def list_projects(ctx, limit):
    """List projects (GET /api/v1/projects)"""
    resp = api_get(f"/api/v1/projects?limit={limit}")
    data = resp.json()

    if ctx.obj.get("json"):
        print_json(data, as_json=True)
        return

    items = data.get("projects", data.get("data", []))
    if not items:
        console.print("[yellow]No projects found[/yellow]")
        return

    table = Table(title="Projects")
    table.add_column("ID")
    table.add_column("Name")
    table.add_column("Status")
    table.add_column("Created")

    for p in items:
        table.add_row(
            str(p.get("id", ""))[:12],
            p.get("name", p.get("title", "N/A")),
            p.get("status", "N/A"),
            str(p.get("createdAt", ""))[:10],
        )
    console.print(table)


@projects.command()
@click.argument("project_id")
@click.pass_context
def get(ctx, project_id):
    """Get project details (GET /api/v1/projects/<id>)"""
    resp = api_get(f"/api/v1/projects/{project_id}")
    if resp.status_code == 404:
        console.print(f"[red]Project {project_id} not found[/red]")
        return
    print_json(resp.json(), as_json=ctx.obj.get("json", False))


@projects.command()
@click.argument("project_id")
@click.pass_context
def compliance(ctx, project_id):
    """Check project compliance (GET /api/v1/projects/<id>/compliance)"""
    resp = api_get(f"/api/v1/projects/{project_id}/compliance")
    if resp.status_code == 404:
        console.print(f"[red]Project {project_id} not found[/red]")
        return
    print_json(resp.json(), as_json=ctx.obj.get("json", False))


@projects.command()
@click.option("--name", prompt=True, help="Project name")
@click.option("--org-id", prompt=True, help="Organization ID")
@click.pass_context
def create(ctx, name, org_id):
    """Create a new project (POST /api/v1/projects)"""
    resp = api_post(
        "/api/v1/projects",
        json={"name": name, "organizationId": org_id},
    )
    if resp.status_code in (200, 201):
        console.print("[green]Project created[/green]")
        print_json(resp.json(), as_json=ctx.obj.get("json", False))
    else:
        console.print(f"[red]Failed: {resp.status_code}[/red]")
        console.print(resp.text[:200])
