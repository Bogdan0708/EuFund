#!/usr/bin/env bash
# Cloud SQL Restore Helper
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-eufunding}"
INSTANCE="${CLOUD_SQL_INSTANCE:-fondeu-db}"

echo "=== Cloud SQL Restore ==="
echo "Project:  $PROJECT_ID"
echo "Instance: $INSTANCE"
echo ""
echo "Recent backups:"
gcloud sql backups list \
  --project="$PROJECT_ID" \
  --instance="$INSTANCE" \
  --limit=10

echo ""
read -rp "Enter backup run ID to restore: " BACKUP_RUN_ID
[ -z "$BACKUP_RUN_ID" ] && echo "No backup selected" && exit 1

echo "This will restore backup run $BACKUP_RUN_ID into instance $INSTANCE."
read -rp "Proceed with restore? (y/N): " CONFIRM
[ "$CONFIRM" != "y" ] && echo "Cancelled" && exit 0

gcloud sql backups restore "$BACKUP_RUN_ID" \
  --project="$PROJECT_ID" \
  --restore-instance="$INSTANCE"

echo "Restore requested. Validate application data before reopening traffic."
