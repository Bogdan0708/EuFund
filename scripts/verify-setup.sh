#!/bin/bash
# Verification script for GCP setup

set -e

PROJECT_ID="eufunding"
REGION="europe-west2"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=== EU Funding Platform - Setup Verification ==="
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo ""

# Check gcloud authentication
echo -n "Checking gcloud authentication... "
if gcloud auth list --filter="status:ACTIVE" --format="value(account)" | grep -q "@"; then
    echo -e "${GREEN}✓ Authenticated${NC}"
    CURRENT_USER=$(gcloud auth list --filter="status:ACTIVE" --format="value(account)")
    echo "  Logged in as: $CURRENT_USER"
else
    echo -e "${RED}✗ Not authenticated${NC}"
    echo "Run: gcloud auth login"
    exit 1
fi

# Check project access
echo -n "Checking project access... "
if gcloud projects describe $PROJECT_ID >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Project accessible${NC}"
else
    echo -e "${RED}✗ Cannot access project${NC}"
    echo "Run: gcloud config set project $PROJECT_ID"
    exit 1
fi

# Check billing
echo -n "Checking billing status... "
BILLING_ENABLED=$(gcloud billing projects describe $PROJECT_ID --format="value(billingEnabled)" 2>/dev/null)
if [ "$BILLING_ENABLED" = "True" ]; then
    echo -e "${GREEN}✓ Billing enabled${NC}"
else
    echo -e "${YELLOW}⚠ Billing not enabled${NC}"
    echo "This will be fixed by the setup script"
fi

# Check key APIs
echo -n "Checking required APIs... "
REQUIRED_APIS=("run.googleapis.com" "sql-component.googleapis.com" "cloudbuild.googleapis.com")
MISSING_APIS=()

for api in "${REQUIRED_APIS[@]}"; do
    if ! gcloud services list --enabled --filter="name:$api" --format="value(name)" | grep -q "$api"; then
        MISSING_APIS+=("$api")
    fi
done

if [ ${#MISSING_APIS[@]} -eq 0 ]; then
    echo -e "${GREEN}✓ All APIs enabled${NC}"
else
    echo -e "${YELLOW}⚠ ${#MISSING_APIS[@]} APIs need to be enabled${NC}"
    echo "Setup script will enable: ${MISSING_APIS[@]}"
fi

# Check existing resources
echo ""
echo "=== Existing Resources Check ==="

# Check if Cloud SQL instance exists
echo -n "Cloud SQL instance... "
if gcloud sql instances describe fondeu-db --region=$REGION >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ Already exists${NC}"
    echo "  Instance: fondeu-db"
else
    echo -e "${GREEN}✓ Ready to create${NC}"
fi

# Check if Redis instance exists
echo -n "Redis instance... "
if gcloud redis instances describe fondeu-redis-prod --region=$REGION >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ Already exists${NC}"
    echo "  Instance: fondeu-redis-prod"
else
    echo -e "${GREEN}✓ Ready to create${NC}"
fi

# Check if service account exists
echo -n "Service account... "
if gcloud iam service-accounts describe fondeu-app-runner@$PROJECT_ID.iam.gserviceaccount.com >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ Already exists${NC}"
    echo "  Account: fondeu-app-runner@$PROJECT_ID.iam.gserviceaccount.com"
else
    echo -e "${GREEN}✓ Ready to create${NC}"
fi

# Check if Artifact Registry repository exists
echo -n "Artifact Registry... "
if gcloud artifacts repositories describe fondeu --location=$REGION >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ Already exists${NC}"
    echo "  Repository: $REGION-docker.pkg.dev/$PROJECT_ID/fondeu"
else
    echo -e "${GREEN}✓ Ready to create${NC}"
fi

echo ""
echo "=== Cost Estimation ==="
echo "Expected monthly costs:"
echo "  Cloud SQL (4 vCPU, 16GB, HA): ~€280"
echo "  Redis (6.5GB): ~€103" 
echo "  Cloud Run (moderate traffic): ~€45"
echo "  Storage + Monitoring: ~€25"
echo "  Load Balancer: ~€42"
echo "  Total: ~€495/month"
echo ""
echo -e "${GREEN}Free credits available: \$300 (covers ~2-3 months)${NC}"

echo ""
echo "=== Ready for Setup! ==="
echo "Run: ./scripts/setup-gcp.sh"
echo ""
echo "Estimated setup time: 20-30 minutes"
echo "Services that take longest: Cloud SQL (~15 min), Redis (~5 min)"
