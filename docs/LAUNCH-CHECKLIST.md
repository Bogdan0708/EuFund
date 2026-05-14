# Production Launch Checklist

## Infrastructure
- [ ] GCP project `eufunding` verified
- [ ] Cloud Run service `fondeu-platform` healthy in `europe-west2`
- [ ] Cloud SQL instance `fondeu-db` running (Postgres 16)
- [ ] Qdrant VM `fondeu-qdrant` running in `europe-west2-b`
- [ ] Qdrant persistent disk attached and healthy
- [ ] Qdrant internal routing verified (`10.154.0.3:6333` via VPC path)
- [ ] GCS buckets verified (`eufunding-backups`, build/source buckets, document bucket if applicable)
- [ ] DNS/TLS verified for production domains
- [ ] Cloud Run scaling settings reviewed and tested

## Security
- [ ] All secrets stored in GCP Secret Manager (no hardcoded)
- [ ] Security headers verified (securityheaders.com → A+)
- [ ] SSL Labs test → A+
- [ ] OWASP ZAP baseline scan clean
- [ ] npm audit shows no high/critical
- [ ] App rate limiting tested
- [ ] CORS configuration verified
- [ ] CSP headers working correctly
- [ ] Qdrant is not publicly reachable except by explicitly approved paths
- [ ] VM SSH access restricted to operators
- [ ] Qdrant port exposure verified (`6333` limited to `10.8.0.0/28`)

## Application
- [ ] All 112 tests passing
- [ ] Production build successful
- [ ] Health endpoint responding
- [ ] Readiness endpoint responding
- [ ] Authentication flow working
- [ ] Romanian locale working
- [ ] English locale working
- [ ] File upload working
- [ ] API rate limiting working
- [ ] Direct AI provider routing verified from FundEU production
- [ ] RAG retrieval path verified end-to-end

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
- [ ] Cloud Run logs and alerts verified
- [ ] VM disk / memory / Qdrant health alerts verified
- [ ] AI provider error-rate and latency alerts configured

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
- [ ] Cloud SQL automated backups verified
- [ ] Qdrant backup procedure verified
- [ ] VM disk backup schedule or equivalent snapshot process configured
- [ ] Restore tested from snapshot
- [ ] Rollback procedure tested
- [ ] DR plan documented
- [ ] Cross-region backup strategy documented if required

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
