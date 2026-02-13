# Production Launch Checklist

## Infrastructure
- [ ] Terraform applied successfully
- [ ] VPC, subnets, security groups verified
- [ ] RDS Aurora cluster running (Multi-AZ)
- [ ] ElastiCache Redis cluster running
- [ ] ECS Fargate service running (min 2 tasks)
- [ ] ALB with SSL certificate (A+ rating)
- [ ] CloudFront distribution active
- [ ] WAF rules enabled
- [ ] Route53 DNS configured
- [ ] Auto-scaling policies configured and tested

## Security
- [ ] All secrets in AWS Secrets Manager (no hardcoded)
- [ ] Security headers verified (securityheaders.com → A+)
- [ ] SSL Labs test → A+
- [ ] OWASP ZAP baseline scan clean
- [ ] npm audit shows no high/critical
- [ ] WAF rate limiting tested
- [ ] CORS configuration verified
- [ ] CSP headers working correctly

## Application
- [ ] All 112 tests passing
- [ ] Production build successful
- [ ] Health endpoint responding
- [ ] Authentication flow working
- [ ] Romanian locale working
- [ ] English locale working
- [ ] File upload working
- [ ] API rate limiting working

## Integrations
- [ ] ONRC API connected and responding
- [ ] ANAF API connected and responding
- [ ] MySMIS integration tested
- [ ] certSIGN QES signing working
- [ ] OpenAI API working (proposal generation)

## Monitoring
- [ ] Sentry configured and receiving errors
- [ ] Prometheus scraping metrics
- [ ] Grafana dashboards imported
- [ ] Alert rules configured
- [ ] On-call rotation set up
- [ ] Health check monitoring (external)

## Performance
- [ ] Database indexes applied
- [ ] Redis caching working
- [ ] Page load <2s (Romanian users)
- [ ] API response <500ms (local endpoints)
- [ ] Load test passed (1000 concurrent users)
- [ ] CDN caching verified for static assets

## Compliance
- [ ] DPIA approved and signed
- [ ] ANSPDCP notification submitted
- [ ] Privacy policy published (RO + EN)
- [ ] Terms of service published (RO + EN)
- [ ] Cookie consent banner working
- [ ] DPA template ready for customers
- [ ] Incident response plan reviewed

## Backup & DR
- [ ] Automated backups verified
- [ ] Restore tested from snapshot
- [ ] Rollback procedure tested
- [ ] DR plan documented
- [ ] Cross-region backup configured

## Documentation
- [ ] Production deployment guide complete
- [ ] Runbook reviewed
- [ ] DR procedures documented
- [ ] API documentation published

## Final Sign-off
- [ ] Engineering lead approval
- [ ] Security review approval
- [ ] DPO approval
- [ ] Business stakeholder approval

**Launch date:** _______________
**Approved by:** _______________
