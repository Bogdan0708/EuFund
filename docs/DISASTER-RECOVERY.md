# Disaster Recovery Procedures

## Recovery Objectives
- **RPO (Recovery Point Objective):** <1 hour (continuous backup)
- **RTO (Recovery Time Objective):** <4 hours

## Backup Strategy

### Database (Cloud SQL PostgreSQL)
- **Automated backups:** Cloud SQL automated backups
- **Manual snapshots:** Before each deployment
- **Point-in-time recovery:** Validate configured retention in Cloud SQL
- **Manual trigger:** [backup.sh](/home/godja/Dev/EU-Funds/scripts/backup.sh)

### Redis (Memorystore)
- **Persistence/backup:** document actual Memorystore backup posture
- **Data is cache-only:** Can be rebuilt from database

### Application and AI Services
- **Container images:** stored in Artifact Registry / Cloud Build outputs
- **Runtime:** Cloud Run revisions for `fondeu-platform`
- **Secrets:** GCP Secret Manager with versioning

### Qdrant / Knowledge Data Plane
- **Host:** VM `fondeu-qdrant`
- **Disk:** persistent disk `fondeu-qdrant`
- **Ingress:** restricted to internal connector CIDR `10.8.0.0/28`
- **Backup policy:** daily disk snapshots via `daily-backups`, 04:00 UTC, 7-day retention
- **Remaining gap:** validate the documented Qdrant restore procedure end-to-end

## Scenarios

### 1. Application Failure
```bash
./scripts/rollback.sh
```
RTO: ~5 minutes

### 2. Database Corruption
```bash
# Restore from Cloud SQL backup
./scripts/restore.sh
```
RTO: ~30 minutes

### 3. Qdrant / Retrieval Failure
1. Stop publish/reindex activity
2. Check VM health, disk, and Qdrant process
3. Restore Qdrant data from backup if needed
4. Validate representative retrieval queries from FundEU
RTO: depends on backup maturity; currently this is a platform hardening priority

### 4. Complete Data Loss
1. Restore Cloud SQL from backup
2. Restore Qdrant from backup
3. Redeploy or rollback Cloud Run services if needed
4. Revalidate app and retrieval flows
RTO: ~4 hours

## Testing Schedule
- **Monthly:** Restore from snapshot to test cluster
- **Quarterly:** Full DR drill with documentation
- **Annually:** Region failover test

## Contacts
- On-call engineer: [TBD]
- GCP support / project operators: [TBD]
- Database admin: [TBD]
