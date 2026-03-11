#!/bin/bash
# GCP Setup Script for EU Funding Platform
# Run this script after creating your GCP account and project

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

ensure_secret_version() {
    local secret_name="$1"
    local secret_value="$2"

    if [ -z "$secret_value" ]; then
        print_warning "Skipping secret $secret_name (no value provided)"
        return
    fi

    if gcloud secrets describe "$secret_name" >/dev/null 2>&1; then
        echo -n "$secret_value" | gcloud secrets versions add "$secret_name" --data-file=-
        print_status "Updated secret version: $secret_name"
    else
        echo -n "$secret_value" | gcloud secrets create "$secret_name" --data-file=-
        print_status "Created secret: $secret_name"
    fi
}

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    print_error "gcloud CLI is not installed. Please install it first:"
    echo "https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Get project information
echo "=== EU Funding Platform - GCP Setup ==="
echo ""

# Your project configuration
PROJECT_ID="eufunding"
PROJECT_NUMBER="857599941951"
BILLING_ACCOUNT_ID="013EC5-706D8C-B680DC"

echo "=== EU Funding Platform - GCP Setup ==="
echo "Project ID: $PROJECT_ID"
echo "Project Number: $PROJECT_NUMBER"
echo "Billing Account: $BILLING_ACCOUNT_ID"
echo ""
read -s -p "Enter a strong password for PostgreSQL: " DB_PASSWORD
echo ""
read -s -p "Enter NextAuth secret (32 characters): " NEXTAUTH_SECRET
echo ""
print_status "Optional production secrets can be supplied via environment before running:"
echo "  REDIS_URL SENTRY_DSN QDRANT_API_KEY SMTP_PASS DB_PASS AI_GATEWAY_API_KEY"
echo "  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET HEALTHCHECK_AUTH_TOKEN"

# Validate inputs
if [ -z "$PROJECT_ID" ] || [ -z "$BILLING_ACCOUNT_ID" ]; then
    print_error "Project ID and Billing Account ID are required"
    exit 1
fi

# Set default project
print_status "Setting default project to $PROJECT_ID"
gcloud config set project $PROJECT_ID

# Enable billing
print_status "Linking billing account"
gcloud billing projects link $PROJECT_ID --billing-account=$BILLING_ACCOUNT_ID

# Enable required APIs
print_status "Enabling required APIs (this may take a few minutes)..."
APIS=(
    "run.googleapis.com"
    "sql-component.googleapis.com"
    "sqladmin.googleapis.com"
    "cloudbuild.googleapis.com"
    "storage.googleapis.com"
    "redis.googleapis.com"
    "logging.googleapis.com"
    "monitoring.googleapis.com"
    "compute.googleapis.com"
    "dns.googleapis.com"
    "certificatemanager.googleapis.com"
    "aiplatform.googleapis.com"
    "artifactregistry.googleapis.com"
    "secretmanager.googleapis.com"
)

for api in "${APIS[@]}"; do
    print_status "Enabling $api"
    gcloud services enable $api
done

print_success "All APIs enabled"

# Create Artifact Registry repository
print_status "Creating Artifact Registry repository"
gcloud artifacts repositories create fondeu \
    --repository-format=docker \
    --location=europe-west2 \
    --description="FondEU Platform container images" || print_warning "Repository might already exist"

# Create service account
print_status "Creating service account"
gcloud iam service-accounts create fondeu-app-runner \
    --display-name="FondEU App Cloud Run Service Account" || print_warning "Service account might already exist"

# Grant necessary permissions
print_status "Granting IAM permissions"
ROLES=(
    "roles/cloudsql.client"
    "roles/storage.objectAdmin"
    "roles/secretmanager.secretAccessor"
    "roles/logging.logWriter"
    "roles/monitoring.metricWriter"
    "roles/redis.editor"
)

for role in "${ROLES[@]}"; do
    gcloud projects add-iam-policy-binding $PROJECT_ID \
        --member="serviceAccount:fondeu-app-runner@$PROJECT_ID.iam.gserviceaccount.com" \
        --role="$role"
done

# Create database connection string
DB_CONNECTION_STRING="postgresql://fondeu_app:$DB_PASSWORD@/fondeu?host=/cloudsql/$PROJECT_ID:europe-west2:fondeu-postgres-prod"

# Create Cloud SQL instance
print_status "Creating Cloud SQL PostgreSQL instance (this will take several minutes)..."
gcloud sql instances create fondeu-postgres-prod \
    --database-version=POSTGRES_16 \
    --tier=db-custom-4-16384 \
    --region=europe-west2 \
    --availability-type=regional \
    --storage-type=SSD \
    --storage-size=100GB \
    --backup-start-time=03:00 \
    --backup-location=europe-west2 \
    --maintenance-release-channel=production \
    --maintenance-window-day=SUN \
    --maintenance-window-hour=04 \
    --deletion-protection || print_warning "Database instance might already exist"

# Set database password
print_status "Setting database root password"
gcloud sql users set-password postgres \
    --instance=fondeu-postgres-prod \
    --password="$DB_PASSWORD"

# Create application database user
print_status "Creating application database user"
gcloud sql users create fondeu_app \
    --instance=fondeu-postgres-prod \
    --password="$DB_PASSWORD" || print_warning "User might already exist"

# Create database
print_status "Creating application database"
gcloud sql databases create fondeu \
    --instance=fondeu-postgres-prod || print_warning "Database might already exist"

# Create Redis instance
print_status "Creating Redis instance (this will take a few minutes)..."
gcloud redis instances create fondeu-redis-prod \
    --size=6 \
    --region=europe-west2 \
    --redis-version=redis_7_0 \
    --auth-enabled \
    --transit-encryption-mode=server-only || print_warning "Redis instance might already exist"

REDIS_HOST=$(gcloud redis instances describe fondeu-redis-prod --region=europe-west2 --format='get(host)' 2>/dev/null || true)
if [ -n "$REDIS_HOST" ] && [ -z "$REDIS_URL" ]; then
    REDIS_URL="redis://$REDIS_HOST:6379"
    print_status "Derived REDIS_URL from Memorystore host"
fi

# Create storage buckets
print_status "Creating Cloud Storage buckets"
gsutil mb -l europe-west2 gs://$PROJECT_ID-fondeu-documents || print_warning "Bucket might already exist"
gsutil mb -l europe-west2 gs://$PROJECT_ID-fondeu-assets || print_warning "Bucket might already exist"
gsutil mb -l europe-west2 gs://$PROJECT_ID-fondeu-backups || print_warning "Bucket might already exist"

# Set up billing budget and alerts
print_status "Creating billing budget and alerts"
gcloud billing budgets create \
    --billing-account=$BILLING_ACCOUNT_ID \
    --display-name="FondEU Monthly Budget Alert" \
    --budget-amount=400EUR \
    --threshold-rule=percent=0.25,spend-basis=current-spend \
    --threshold-rule=percent=0.75,spend-basis=current-spend || print_warning "Budget might already exist"

# Store canonical application secrets used by deploy-production.yml
print_status "Storing canonical application secrets in Secret Manager"
ensure_secret_version "DATABASE_URL" "$DB_CONNECTION_STRING"
ensure_secret_version "NEXTAUTH_SECRET" "$NEXTAUTH_SECRET"
ensure_secret_version "REDIS_URL" "$REDIS_URL"
ensure_secret_version "SENTRY_DSN" "$SENTRY_DSN"
ensure_secret_version "QDRANT_API_KEY" "$QDRANT_API_KEY"
ensure_secret_version "SMTP_PASS" "$SMTP_PASS"
ensure_secret_version "DB_PASS" "${DB_PASS:-$DB_PASSWORD}"
ensure_secret_version "AI_GATEWAY_API_KEY" "$AI_GATEWAY_API_KEY"
ensure_secret_version "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" "$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"
ensure_secret_version "STRIPE_SECRET_KEY" "$STRIPE_SECRET_KEY"
ensure_secret_version "STRIPE_WEBHOOK_SECRET" "$STRIPE_WEBHOOK_SECRET"
ensure_secret_version "HEALTHCHECK_AUTH_TOKEN" "$HEALTHCHECK_AUTH_TOKEN"

print_success "All secrets stored in Secret Manager (no local .env.production generated)"
print_warning "Production env vars are managed via Cloud Run --set-env-vars and --update-secrets in deploy-production.yml"

print_success "GCP setup completed!"
echo ""
echo "=== Next Steps ==="
echo "1. Verify optional production secrets/vars are populated:"
echo "   REDIS_URL SENTRY_DSN QDRANT_API_KEY SMTP_PASS DB_PASS AI_GATEWAY_API_KEY"
echo "   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET HEALTHCHECK_AUTH_TOKEN"
echo ""
echo "2. Set GitHub Actions vars/secrets used by deploy-production.yml if not already configured:"
echo "   GCS_BUCKET GCS_KEY_FILENAME QDRANT_URL AI_GATEWAY_URL PRODUCTION_URL DB_SOCKET_PATH DB_NAME DB_USER"
echo ""
echo "3. Deploy the application:"
echo "   gcloud builds submit --config cloudbuild.yaml"
echo ""
echo "4. Set up custom domain (replace your-domain.com):"
echo "   gcloud run domain-mappings create --service=fondeu-platform --domain=fondeu.your-domain.com --region=europe-west2"
echo ""
echo "5. Monitor costs in the GCP Console billing section"
echo ""
echo "=== Important Information ==="
echo "Project ID: $PROJECT_ID"
echo "Region: europe-west2"
echo "Database: fondeu-postgres-prod"
echo "Redis: fondeu-redis-prod"
echo "Service Account: fondeu-app-runner@$PROJECT_ID.iam.gserviceaccount.com"
echo ""
echo "Keep your credentials secure and never commit .env.production to git!"
