#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=true
YES=false
FORCE=false

usage() {
  cat <<'EOF'
Usage: scripts/git-scrub.sh [--dry-run] [--apply] [--yes] [--force]

Rewrites git history with git-filter-repo to redact common secret patterns.

Options:
  --dry-run   Show what would happen without rewriting history (default)
  --apply     Rewrite history and redact matches
  --yes       Skip interactive confirmation prompt
  --force     Allow running with a dirty working tree
  -h, --help  Show this help message

Examples:
  scripts/git-scrub.sh --dry-run
  scripts/git-scrub.sh --apply --yes
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      ;;
    --apply)
      DRY_RUN=false
      ;;
    --yes)
      YES=true
      ;;
    --force)
      FORCE=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if ! command -v git >/dev/null 2>&1; then
  echo "git is required." >&2
  exit 1
fi

if ! command -v git-filter-repo >/dev/null 2>&1; then
  echo "git-filter-repo is required. Install it first:" >&2
  echo "  pip install git-filter-repo" >&2
  exit 1
fi

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "Run this script inside a git repository." >&2
  exit 1
}

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if [[ "$FORCE" != "true" ]] && [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit/stash changes first, or use --force." >&2
  exit 1
fi

REPLACE_FILE="$(mktemp "${TMPDIR:-/tmp}/git-scrub-replacements.XXXXXX")"
cleanup() {
  rm -f "$REPLACE_FILE"
}
trap cleanup EXIT

cat >"$REPLACE_FILE" <<'EOF'
regex:AKIA[0-9A-Z]{16}==>***REDACTED_AWS_ACCESS_KEY***
regex:ASIA[0-9A-Z]{16}==>***REDACTED_AWS_STS_KEY***
regex:AIza[0-9A-Za-z\-_]{35}==>***REDACTED_GOOGLE_API_KEY***
regex:gh[pousr]_[A-Za-z0-9_]{20,}==>***REDACTED_GITHUB_TOKEN***
regex:xox[baprs]-[A-Za-z0-9-]{10,}==>***REDACTED_SLACK_TOKEN***
regex:(?i)(api[_-]?key\s*[:=]\s*["']?)[A-Za-z0-9_\-+=\/]{16,}==>\1***REDACTED***
regex:(?i)(secret[_-]?key\s*[:=]\s*["']?)[^"'\s]{8,}==>\1***REDACTED***
regex:(?i)(access[_-]?token\s*[:=]\s*["']?)[^"'\s]{8,}==>\1***REDACTED***
regex:(?i)(private[_-]?key\s*[:=]\s*["']?)[^"'\s]{16,}==>\1***REDACTED***
EOF

echo "WARNING: This operation rewrites git history."
echo "WARNING: Everyone using this repository must re-clone or hard-reset after apply."
echo

if [[ "$DRY_RUN" == "true" ]]; then
  echo "Dry run mode enabled. No history will be rewritten."
  echo
  echo "Replacement rules prepared in: $REPLACE_FILE"
  echo "Command that would be executed:"
  echo "  git filter-repo --replace-text \"$REPLACE_FILE\" --force"
  echo
  echo "Optional pre-check for likely secrets:"
  echo "  gitleaks detect --source . --no-git"
  exit 0
fi

if [[ "$YES" != "true" ]]; then
  read -r -p "Type 'rewrite-history' to continue: " CONFIRM
  if [[ "$CONFIRM" != "rewrite-history" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

BACKUP_TAG="pre-scrub-backup-$(date +%Y%m%d%H%M%S)"
git tag "$BACKUP_TAG"
echo "Created backup tag: $BACKUP_TAG"

git filter-repo --replace-text "$REPLACE_FILE" --force

echo
echo "History rewritten successfully."
echo "Next steps:"
echo "  1) Review history and run tests."
echo "  2) Force push branches and tags:"
echo "     git push --force --all && git push --force --tags"
echo "  3) Rotate any leaked credentials immediately."
