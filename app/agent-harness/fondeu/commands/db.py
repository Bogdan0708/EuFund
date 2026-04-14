import subprocess
from pathlib import Path

import click
from rich.console import Console

APP_DIR = Path(__file__).resolve().parents[3]  # agent-harness -> app
console = Console()


@click.group()
def db():
    """Database management commands"""
    pass


@db.command()
def status():
    """Check database connection and table counts"""
    result = subprocess.run(
        ["npx", "drizzle-kit", "check"],
        cwd=str(APP_DIR),
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        console.print("[green]Database connection OK[/green]")
        console.print(result.stdout)
    else:
        console.print("[red]Database connection failed[/red]")
        console.print(result.stderr)


@db.command()
def migrate():
    """Run drizzle migrations (db:push)"""
    console.print("Running db:push...")
    result = subprocess.run(
        ["npm", "run", "db:push"],
        cwd=str(APP_DIR),
        capture_output=False,
    )
    if result.returncode == 0:
        console.print("[green]Migration complete[/green]")
    else:
        console.print("[red]Migration failed[/red]")


@db.command()
def seed():
    """Seed database with base data"""
    console.print("Seeding database...")
    result = subprocess.run(
        ["npm", "run", "db:seed"],
        cwd=str(APP_DIR),
        capture_output=False,
    )
    if result.returncode == 0:
        console.print("[green]Seed complete[/green]")
    else:
        console.print("[red]Seed failed[/red]")


@db.command()
def studio():
    """Launch Drizzle Studio"""
    console.print("Launching Drizzle Studio...")
    subprocess.run(["npx", "drizzle-kit", "studio"], cwd=str(APP_DIR))
