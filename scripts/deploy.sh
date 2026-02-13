#!/usr/bin/env bash
# Blue-Green Deployment Script
set -euo pipefail

CLUSTER="${ECS_CLUSTER:-eu-funds-production}"
SERVICE="${ECS_SERVICE:-eu-funds-app-production}"
REGION="${AWS_REGION:-eu-west-2}"
HEALTH_URL="${HEALTH_URL:-https://funduri-ue.example.ro/api/health}"

echo "=== EU Funds Platform - Production Deployment ==="
echo "Cluster: $CLUSTER | Service: $SERVICE | Region: $REGION"
echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 1. Pre-deployment backup
echo -e "\n--- Creating pre-deployment backup ---"
aws rds create-db-cluster-snapshot \
  --db-cluster-identifier eu-funds-db \
  --db-cluster-snapshot-identifier "pre-deploy-$(date +%s)" \
  --region "$REGION" || echo "Backup warning (non-fatal)"

# 2. Deploy new version
echo -e "\n--- Deploying new version ---"
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --force-new-deployment \
  --region "$REGION"

# 3. Wait for stability
echo -e "\n--- Waiting for deployment to stabilize ---"
aws ecs wait services-stable \
  --cluster "$CLUSTER" \
  --services "$SERVICE" \
  --region "$REGION"

# 4. Health check
echo -e "\n--- Running health checks ---"
for i in $(seq 1 10); do
  STATUS=$(curl -sf "$HEALTH_URL" | jq -r '.status' 2>/dev/null || echo "unreachable")
  if [ "$STATUS" = "healthy" ]; then
    echo "✅ Deployment successful - service healthy"
    exit 0
  fi
  echo "  Attempt $i/10: $STATUS"
  sleep 15
done

echo "❌ Health check failed after 10 attempts"
echo "Consider running: ./scripts/rollback.sh"
exit 1
