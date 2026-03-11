#!/usr/bin/env bash
# Quick GCP Cloud Run Rollback
set -euo pipefail

SERVICE="${CLOUD_RUN_SERVICE:-fondeu-platform}"
REGION="${GCP_REGION:-europe-west2}"

echo "=== Cloud Run Rollback ==="

CURRENT_REVISION=$(gcloud run services describe "$SERVICE" \
  --region "$REGION" \
  --format="value(status.traffic[0].revisionName)")

PREVIOUS_REVISION=$(gcloud run revisions list \
  --service "$SERVICE" \
  --region "$REGION" \
  --sort-by="~metadata.creationTimestamp" \
  --format="value(metadata.name)" | sed -n '2p')

if [ -z "$PREVIOUS_REVISION" ]; then
  echo "No previous revision found for service $SERVICE in $REGION"
  exit 1
fi

echo "Current revision:  $CURRENT_REVISION"
echo "Rollback target:   $PREVIOUS_REVISION"

read -rp "Proceed with traffic rollback? (y/N): " CONFIRM
[ "$CONFIRM" != "y" ] && echo "Cancelled" && exit 0

gcloud run services update-traffic "$SERVICE" \
  --region "$REGION" \
  --to-revisions "${PREVIOUS_REVISION}=100"

echo "Rollback complete: $SERVICE -> $PREVIOUS_REVISION"
