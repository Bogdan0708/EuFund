#!/bin/bash
# Image build script for EU Funding Platform
# NOTE: This script only builds and pushes the container image via Cloud Build.
# Actual deployment to Cloud Run is handled by GitHub Actions (deploy-production.yml).
# Use this for manual image builds, NOT for production deployments.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "cloudbuild.yaml" ]; then
    print_error "Please run this script from the EU-Funds project root directory"
    exit 1
fi

# Get current project
PROJECT_ID=$(gcloud config get-value project)
if [ -z "$PROJECT_ID" ]; then
    print_error "No GCP project set. Run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

print_status "Deploying EU Funding Platform to project: $PROJECT_ID"

# Check if required services are enabled
print_status "Checking if required services are enabled..."
REQUIRED_SERVICES=("run.googleapis.com" "cloudbuild.googleapis.com" "artifactregistry.googleapis.com")
for service in "${REQUIRED_SERVICES[@]}"; do
    if ! gcloud services list --enabled --filter="name:$service" --format="value(name)" | grep -q "$service"; then
        print_error "Required service $service is not enabled. Run the setup script first."
        exit 1
    fi
done

# Build and deploy
print_status "Starting Cloud Build image build..."
print_status "This will:"
echo "  - Build the Next.js application"
echo "  - Create Docker container image"
echo "  - Push to Artifact Registry"
echo ""
print_warning "This does NOT deploy to Cloud Run. Use GitHub Actions deploy-production.yml for production deployments."
echo ""

read -p "Continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_status "Deployment cancelled"
    exit 0
fi

# Submit build
gcloud builds submit --config cloudbuild.yaml

if [ $? -eq 0 ]; then
    print_success "Image build completed successfully!"
    echo ""
    echo "=== Next Steps ==="
    echo "1. Deploy to production via GitHub Actions: deploy-production.yml (workflow_dispatch)"
    echo "2. Or manually: gcloud run deploy fondeu-platform --image europe-west2-docker.pkg.dev/eufunding/fondeu/app:latest --region europe-west2 --memory 2Gi --cpu 2"
    echo "3. Monitor logs: gcloud run services logs tail fondeu-platform --region=europe-west2"
else
    print_error "Image build failed. Check Cloud Build logs for details:"
    echo "gcloud builds list --limit=5"
    exit 1
fi