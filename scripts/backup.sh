#!/usr/bin/env bash
# Cloud SQL Backup Trigger
set -euo pipefail

INSTANCE="${CLOUD_SQL_INSTANCE:-fondeu-db}"
PROJECT_ID="${GCP_PROJECT_ID:-eufunding}"
DESCRIPTION="${1:-manual-backup-$(date +%Y%m%d_%H%M%S)}"

echo "=== Cloud SQL Backup ==="
echo "Project:     $PROJECT_ID"
echo "Instance:    $INSTANCE"
echo "Description: $DESCRIPTION"

gcloud sql backups create \
  --project="$PROJECT_ID" \
  --instance="$INSTANCE" \
  --description="$DESCRIPTION"

echo "Backup requested successfully."
