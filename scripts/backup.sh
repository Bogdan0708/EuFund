#!/usr/bin/env bash
# Database Backup with S3 Upload
set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_BUCKET="${BACKUP_BUCKET:-eu-funds-backups}"
REGION="${AWS_REGION:-eu-west-2}"
DB_CLUSTER="eu-funds-db"

echo "=== Database Backup - $TIMESTAMP ==="

# RDS automated snapshot
echo "Creating RDS snapshot..."
SNAPSHOT_ID="manual-backup-$TIMESTAMP"
aws rds create-db-cluster-snapshot \
  --db-cluster-identifier "$DB_CLUSTER" \
  --db-cluster-snapshot-identifier "$SNAPSHOT_ID" \
  --region "$REGION"

echo "Waiting for snapshot to complete..."
aws rds wait db-cluster-snapshot-available \
  --db-cluster-snapshot-identifier "$SNAPSHOT_ID" \
  --region "$REGION"

# Export to S3 (for portability)
echo "Exporting snapshot to S3..."
aws rds start-export-task \
  --export-task-identifier "export-$TIMESTAMP" \
  --source-arn "$(aws rds describe-db-cluster-snapshots --db-cluster-snapshot-identifier $SNAPSHOT_ID --query 'DBClusterSnapshots[0].DBClusterSnapshotArn' --output text)" \
  --s3-bucket-name "$BACKUP_BUCKET" \
  --s3-prefix "database/$TIMESTAMP" \
  --iam-role-arn "${EXPORT_ROLE_ARN}" \
  --kms-key-id "${KMS_KEY_ID}" \
  --region "$REGION" || echo "S3 export requires EXPORT_ROLE_ARN and KMS_KEY_ID"

# Cleanup old snapshots (keep last 30)
echo "Cleaning up old manual snapshots..."
aws rds describe-db-cluster-snapshots \
  --db-cluster-identifier "$DB_CLUSTER" \
  --snapshot-type manual \
  --query 'DBClusterSnapshots | sort_by(@, &SnapshotCreateTime) | [:-30].DBClusterSnapshotIdentifier' \
  --output text --region "$REGION" | tr '\t' '\n' | while read -r old; do
    [ -n "$old" ] && aws rds delete-db-cluster-snapshot --db-cluster-snapshot-identifier "$old" --region "$REGION" && echo "Deleted: $old"
done

echo "✅ Backup complete: $SNAPSHOT_ID"
