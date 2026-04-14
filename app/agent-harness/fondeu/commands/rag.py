import subprocess
from pathlib import Path

import click
import httpx
from rich.console import Console
from rich.table import Table

from ..config import get_qdrant_url
from ..http import print_json

APP_DIR = Path(__file__).resolve().parents[3]
console = Console()


@click.group()
def rag():
    """RAG / Qdrant knowledge base commands"""
    pass


@rag.command()
@click.pass_context
def stats(ctx):
    """Show Qdrant collection stats (no app needed)"""
    url = get_qdrant_url()
    try:
        resp = httpx.get(f"{url}/collections/eu_legislation")
        data = resp.json()
        result = data.get("result", {})

        if ctx.obj.get("json"):
            print_json(data, as_json=True)
            return

        table = Table(title="Qdrant Collection: eu_legislation")
        table.add_column("Metric")
        table.add_column("Value")
        table.add_row("Points", str(result.get("points_count", "N/A")))
        table.add_row("Segments", str(result.get("segments_count", "N/A")))
        table.add_row("Status", str(result.get("status", "N/A")))
        table.add_row("Vectors Size", str(result.get("config", {}).get("params", {}).get("vectors", {}).get("size", "N/A")))
        console.print(table)
    except httpx.ConnectError:
        console.print(f"[red]Cannot connect to Qdrant at {url}[/red]")


@rag.command()
@click.argument("query")
@click.option("--limit", default=5, help="Number of results")
@click.pass_context
def search(ctx, query, limit):
    """Search Qdrant directly (no app needed). Requires embeddings API."""
    try:
        import openai
        import os

        client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        embedding_resp = client.embeddings.create(
            model="text-embedding-3-small",
            input=query,
        )
        vector = embedding_resp.data[0].embedding
    except Exception as e:
        console.print(f"[red]Embedding failed: {e}[/red]")
        console.print("[dim]Set OPENAI_API_KEY env var for direct RAG search[/dim]")
        return

    url = get_qdrant_url()
    resp = httpx.post(
        f"{url}/collections/eu_legislation/points/search",
        json={"vector": vector, "limit": limit, "with_payload": True},
    )
    data = resp.json()

    if ctx.obj.get("json"):
        print_json(data, as_json=True)
        return

    results = data.get("result", [])
    if not results:
        console.print("[yellow]No results found[/yellow]")
        return

    for i, r in enumerate(results, 1):
        payload = r.get("payload", {})
        score = r.get("score", 0)
        console.print(f"\n[bold]Result {i}[/bold] (score: {score:.3f})")
        console.print(f"  Source: {payload.get('source', 'N/A')}")
        console.print(f"  Program: {payload.get('program', 'N/A')}")
        text = payload.get("text", payload.get("content", ""))
        console.print(f"  Content: {text[:200]}...")


@rag.command()
def ingest():
    """Run bulk ingestion script"""
    console.print("Running bulk-ingest-rag-knowledge.ts...")
    subprocess.run(
        ["npx", "tsx", "scripts/bulk-ingest-rag-knowledge.ts"],
        cwd=str(APP_DIR),
    )
