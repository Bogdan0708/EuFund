#!/usr/bin/env bash
# Disaster Recovery - Database Restore
set -euo pipefail

REGION="${AWS_REGION:-eu-west-2}"
DB_CLUSTER="eu-funds-db"

echo "=== Disaster Recovery - Database Restore ==="
echo "⚠️  This will create a NEW cluster from a snapshot"

# List available snapshots
echo -e "\nAvailable snapshots:"
aws rds describe-db-cluster-snapshots \
  --db-cluster-identifier "$DB_CLUSTER" \
  --query 'DBClusterSnapshots | sort_by(@, &SnapshotCreateTime) | [-10:].[DBClusterSnapshotIdentifier, SnapshotCreateTime, Status]' \
  --output table --region "$REGION"

# Select snapshot
read -rp "Enter snapshot identifier to restore: " SNAPSHOT_ID
[ -z "$SNAPSHOT_ID" ] && echo "No snapshot selected" && exit 1

RESTORE_CLUSTER="${DB_CLUSTER}-restore-$(date +%s)"
echo -e "\nRestoring to new cluster: $RESTORE_CLUSTER"

# Restore
aws rds restore-db-cluster-from-snapshot \
  --db-cluster-identifier "$RESTORE_CLUSTER" \
  --snapshot-identifier "$SNAPSHOT_ID" \
  --engine aurora-postgresql \
  --vpc-security-group-ids "${DB_SECURITY_GROUP}" \
  --db-subnet-group-name "${DB_SUBNET_GROUP:-eu-funds-db-subnet}" \
  --region "$REGION"

echo "Waiting for cluster to become available..."
aws rds wait db-cluster-available \
  --db-cluster-identifier "$RESTORE_CLUSTER" \
  --region "$REGION"

# Create instance
aws rds create-db-instance \
  --db-instance-identifier "${RESTORE_CLUSTER}-0" \
  --db-cluster-identifier "$RESTORE_CLUSTER" \
  --db-instance-class db.r6g.large \
  --engine aurora-postgresql \
  --region "$REGION"

echo "✅ Restore initiated: $RESTORE_CLUSTER"
echo "Next steps:"
echo "  1. Wait for instance to become available"
echo "  2. Update DATABASE_URL to point to new cluster"
echo "  3. Redeploy application"
echo "  4. Verify data integrity"
echo "  5. Rename/swap clusters when confirmed"
