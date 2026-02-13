# Production Deployment Guide

## Prerequisites
- AWS account with eu-west-2 access
- Terraform >= 1.6
- Docker
- AWS CLI configured
- Domain name with Route53 hosted zone
- ACM certificates (eu-west-2 for ALB, us-east-1 for CloudFront)

## 1. Infrastructure Setup

```bash
cd infrastructure/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

terraform init
terraform plan
terraform apply
```

## 2. Build & Push Container

```bash
# Login to ECR
aws ecr get-login-password --region eu-west-2 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.eu-west-2.amazonaws.com

# Build
docker build -f infrastructure/Dockerfile.prod -t eu-funds-app:latest .

# Tag & push
docker tag eu-funds-app:latest <account-id>.dkr.ecr.eu-west-2.amazonaws.com/eu-funds-app:latest
docker push <account-id>.dkr.ecr.eu-west-2.amazonaws.com/eu-funds-app:latest
```

## 3. Database Migration

```bash
# Run Drizzle migrations
DATABASE_URL=<production-url> npx drizzle-kit push

# Apply performance indexes
psql $DATABASE_URL -f performance/database-indexes.sql
```

## 4. Environment Variables

Required in ECS task definition / Secrets Manager:
- `DATABASE_URL` - Aurora PostgreSQL connection string
- `REDIS_URL` - ElastiCache Redis URL
- `NEXTAUTH_URL` - Public URL
- `NEXTAUTH_SECRET` - Random 32+ char secret
- `OPENAI_API_KEY` - OpenAI API key
- `CERTSIGN_API_KEY` - certSIGN API credentials
- `SENTRY_DSN` - Sentry error tracking

## 5. Deploy

```bash
./scripts/deploy.sh
```

## 6. Verify

```bash
./scripts/health-check.sh https://funduri-ue.example.ro
```

## 7. Monitoring Setup

```bash
cd monitoring
docker compose -f docker-compose.monitoring.yml up -d
# Access Grafana at :3001, import dashboards from grafana-dashboards/
```

## Local Development (Docker Compose)

```bash
cd infrastructure
docker compose -f docker-compose.prod.yml up -d
```

## Kubernetes Alternative

```bash
kubectl apply -f infrastructure/kubernetes/deployment.yaml
```
