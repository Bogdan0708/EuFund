#!/usr/bin/env bash
# Quick Rollback to Previous Version
set -euo pipefail

CLUSTER="${ECS_CLUSTER:-eu-funds-production}"
SERVICE="${ECS_SERVICE:-eu-funds-app-production}"
REGION="${AWS_REGION:-eu-west-2}"

echo "=== Quick Rollback ==="

# Get previous task definition
CURRENT=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --region "$REGION" \
  --query 'services[0].taskDefinition' --output text)
CURRENT_REV=$(echo "$CURRENT" | grep -oP ':\K\d+$')
PREV_REV=$((CURRENT_REV - 1))
PREV_TASK="${CURRENT%:*}:$PREV_REV"

echo "Current: $CURRENT"
echo "Rolling back to: $PREV_TASK"

read -rp "Proceed? (y/N): " CONFIRM
[ "$CONFIRM" != "y" ] && echo "Cancelled" && exit 0

aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --task-definition "$PREV_TASK" \
  --force-new-deployment \
  --region "$REGION"

echo "Waiting for rollback..."
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE" --region "$REGION"

echo "✅ Rolled back to $PREV_TASK"
