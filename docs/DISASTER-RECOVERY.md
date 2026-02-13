# Disaster Recovery Procedures

## Recovery Objectives
- **RPO (Recovery Point Objective):** <1 hour (continuous backup)
- **RTO (Recovery Time Objective):** <4 hours

## Backup Strategy

### Database (Aurora PostgreSQL)
- **Automated backups:** Continuous, 30-day retention
- **Manual snapshots:** Before each deployment
- **Cross-region:** Copy to eu-central-1 (Frankfurt) weekly
- **Point-in-time recovery:** Available for last 30 days

### Redis (ElastiCache)
- **Snapshots:** Daily at 04:00 UTC, 7-day retention
- **Data is cache-only:** Can be rebuilt from database

### Application
- **Container images:** Stored in ECR with immutable tags
- **Infrastructure:** Terraform state in S3 with versioning
- **Secrets:** AWS Secrets Manager with versioning

## Scenarios

### 1. Application Failure
```bash
./scripts/rollback.sh
```
RTO: ~5 minutes

### 2. Database Corruption
```bash
# Restore from point-in-time or snapshot
./scripts/restore.sh
```
RTO: ~30 minutes

### 3. Region Failure
1. Switch DNS to GCP europe-west3 (Frankfurt) backup
2. Restore database from cross-region snapshot
3. Deploy application to GCP GKE
RTO: ~4 hours

### 4. Complete Data Loss
1. Restore from S3 cross-region backup
2. Rebuild infrastructure with Terraform
3. Restore database from backup
4. Redeploy application
RTO: ~4 hours

## Testing Schedule
- **Monthly:** Restore from snapshot to test cluster
- **Quarterly:** Full DR drill with documentation
- **Annually:** Region failover test

## Contacts
- On-call engineer: [TBD]
- AWS Support: Enterprise console
- Database admin: [TBD]
