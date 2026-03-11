#!/bin/bash
# Production deploy script for EU Funding Platform
# Default path: Cloud Build production pipeline (trigger-ready).
# Set BUILD_CONFIG=cloudbuild.yaml if you only want the legacy image build.

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

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the right directory
BUILD_CONFIG="${BUILD_CONFIG:-cloudbuild.production.yaml}"

if [ ! -f "$BUILD_CONFIG" ]; then
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
print_status "Using Cloud Build config: $BUILD_CONFIG"

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
print_status "Starting Cloud Build pipeline..."
print_status "This will:"
if [ "$BUILD_CONFIG" = "cloudbuild.production.yaml" ]; then
    echo "  - Build the Next.js application"
    echo "  - Push a versioned and latest image to Artifact Registry"
    echo "  - Create a pre-deploy Cloud SQL backup"
    echo "  - Run database migrations via Cloud Run Job"
    echo "  - Deploy fondeu-platform to Cloud Run"
    echo "  - Verify AI gateway and production health"
else
    echo "  - Build the Next.js application"
    echo "  - Create Docker container image"
    echo "  - Push to Artifact Registry"
fi
echo ""

read -p "Continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_status "Deployment cancelled"
    exit 0
fi

# Submit build
gcloud builds submit --config "$BUILD_CONFIG"

if [ $? -eq 0 ]; then
    print_success "Cloud Build pipeline completed successfully!"
    echo ""
    echo "=== Next Steps ==="
    if [ "$BUILD_CONFIG" = "cloudbuild.production.yaml" ]; then
        echo "1. Verify the new revision: gcloud run services describe fondeu-platform --region=europe-west2"
        echo "2. Monitor logs: gcloud run services logs tail fondeu-platform --region=europe-west2"
        echo "3. Create a Cloud Build trigger on master using cloudbuild.production.yaml for continuous production deploys"
    else
        echo "1. Deploy manually: gcloud run deploy fondeu-platform --image europe-west2-docker.pkg.dev/eufunding/fondeu/app:latest --region europe-west2 --memory 2Gi --cpu 2"
        echo "2. Or use the production pipeline: BUILD_CONFIG=cloudbuild.production.yaml ./scripts/deploy.sh"
    fi
else
    print_error "Image build failed. Check Cloud Build logs for details:"
    echo "gcloud builds list --limit=5"
    exit 1
fi
