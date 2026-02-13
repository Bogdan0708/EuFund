# Operational Runbook

## Common Operations

### Restart Application
```bash
aws ecs update-service --cluster eu-funds-production --service eu-funds-app-production --force-new-deployment
```

### Scale Up/Down
```bash
aws ecs update-service --cluster eu-funds-production --service eu-funds-app-production --desired-count 4
```

### View Logs
```bash
aws logs tail /ecs/eu-funds --follow --since 1h
```

### Database Connection
```bash
# Via SSM Session Manager (no SSH needed)
aws ssm start-session --target <bastion-instance-id> --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters '{"portNumber":["5432"],"localPortNumber":["5432"],"host":["eu-funds-db.cluster-xxx.eu-west-2.rds.amazonaws.com"]}'
```

### Clear Redis Cache
```bash
redis-cli -h <elasticache-endpoint> -p 6379 --tls FLUSHDB
```

### Run Database Migrations
```bash
DATABASE_URL=<prod-url> npx drizzle-kit push
```

## Troubleshooting

### High Error Rate
1. Check Sentry for error details
2. Check CloudWatch logs: `aws logs tail /ecs/eu-funds --since 30m`
3. Check external API health: `curl https://funduri-ue.example.ro/api/health`
4. If specific API: check ONRC/ANAF/certSIGN status pages

### High Latency
1. Check database: `SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;`
2. Check Redis: `redis-cli INFO stats`
3. Check ECS CPU/memory: CloudWatch → ECS → Service metrics
4. Check if auto-scaling is responding

### Memory Issues
1. Check ECS task memory: `aws ecs describe-tasks --cluster eu-funds-production --tasks <task-id>`
2. Increase task memory in task definition if needed
3. Check for memory leaks in application logs

### External API Failures
- **ONRC down:** Proposals can still be created, company verification deferred
- **ANAF down:** Fiscal data cached for 1 hour, degrade gracefully
- **certSIGN down:** QES signing queued, retry when available
- **MySMIS down:** Submission queued, manual retry needed

## Maintenance Windows
- **Preferred:** Tuesday-Thursday, 02:00-04:00 EET
- **Notify users:** 48 hours in advance for planned maintenance
- **Emergency:** Can deploy anytime with incident documentation
