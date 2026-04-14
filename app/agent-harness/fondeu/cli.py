import click


@click.group()
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
@click.pass_context
def cli(ctx, as_json):
    """FondEU Platform CLI Harness"""
    ctx.ensure_object(dict)
    ctx.obj["json"] = as_json


# Commands will be registered as they're implemented in Tasks 7-10
# Use try/except to allow partial installation during development
_command_modules = [
    ("fondeu.commands.health", "health"),
    ("fondeu.commands.db", "db"),
    ("fondeu.commands.auth", "auth"),
    ("fondeu.commands.projects", "projects"),
    ("fondeu.commands.ai", "ai"),
    ("fondeu.commands.rag", "rag"),
    ("fondeu.commands.calls", "calls"),
    ("fondeu.commands.connectors", "connectors"),
    ("fondeu.commands.test", "test"),
]

for module_path, command_name in _command_modules:
    try:
        import importlib
        mod = importlib.import_module(module_path)
        cmd = getattr(mod, command_name)
        cli.add_command(cmd)
    except (ImportError, AttributeError):
        pass  # Command not yet implemented


if __name__ == "__main__":
    cli()
