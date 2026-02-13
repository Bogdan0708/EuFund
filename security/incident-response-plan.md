# Security Incident Response Plan

## EU Funds Platform - Version 1.0

### 1. Overview

This plan covers security incident detection, response, and recovery for the EU Funds Platform, compliant with GDPR Article 33 (72-hour notification requirement) and ANSPDCP regulations.

### 2. Severity Classification

| Level | Description | Response Time | Examples |
|-------|-------------|---------------|----------|
| **P1 - Critical** | Active breach, data exfiltration | 15 minutes | Database breach, credential leak, ransomware |
| **P2 - High** | Potential breach, service degradation | 1 hour | Unauthorized access attempt, DDoS, vulnerability exploit |
| **P3 - Medium** | Security concern, no immediate impact | 4 hours | Failed pen test finding, misconfiguration, suspicious activity |
| **P4 - Low** | Minor issue, informational | 24 hours | Policy violation, minor vulnerability, log anomaly |

### 3. Response Phases

#### Phase 1: Detection & Triage (0-15 min)
1. Alert received via monitoring (Sentry/Prometheus/CloudWatch)
2. On-call engineer assesses severity
3. Create incident ticket with timestamp
4. Classify using severity matrix above

#### Phase 2: Containment (15 min - 1 hour)
- **P1**: Immediately isolate affected systems, rotate credentials
- **P2**: Block suspicious IPs, enable enhanced logging
- Preserve forensic evidence (logs, snapshots)
- Notify incident commander

#### Phase 3: Investigation (1-24 hours)
- Determine scope of breach
- Identify affected data subjects
- Assess if personal data was compromised
- Document timeline of events

#### Phase 4: GDPR Notification (within 72 hours)
If personal data breach confirmed:
1. **ANSPDCP Notification** (within 72 hours of awareness)
   - Portal: https://www.dataprotection.ro/
   - Include: nature of breach, categories of data, approximate number of subjects, DPO contact, consequences, mitigation measures
2. **Data Subject Notification** (without undue delay if high risk)
   - Clear Romanian language description
   - Contact information for DPO
   - Measures taken and recommended actions

#### Phase 5: Recovery
- Deploy fixes
- Verify integrity of systems
- Restore from clean backups if needed
- Re-enable services gradually

#### Phase 6: Post-Incident Review (within 1 week)
- Root cause analysis
- Update security measures
- Document lessons learned
- Update this plan if needed

### 4. Contact List

| Role | Name | Contact |
|------|------|---------|
| Incident Commander | [TBD] | [phone/email] |
| DPO | [TBD] | [phone/email] |
| ANSPDCP | Romanian DPA | https://www.dataprotection.ro/ |
| AWS Support | Enterprise Support | AWS Console |
| certSIGN Support | QES Provider | support@certsign.ro |

### 5. Communication Templates

#### ANSPDCP Breach Notification Template
```
Referință: [Incident-YYYY-MM-DD-NNN]
Data constatării: [date]
Natura încălcării: [description in Romanian]
Categorii de date afectate: [CNP, email, etc.]
Număr aproximativ de persoane vizate: [number]
Consecințe probabile: [description]
Măsuri luate: [containment actions]
Responsabil protecția datelor: [DPO name, contact]
```

### 6. Runbook Quick Actions

```bash
# Rotate all secrets immediately
./scripts/rotate-secrets.sh

# Block suspicious IP
aws wafv2 update-ip-set --name blocked-ips --addresses "x.x.x.x/32"

# Enable enhanced logging
aws logs put-retention-policy --log-group-name /ecs/eu-funds --retention-in-days 365

# Create forensic snapshot
aws rds create-db-cluster-snapshot --db-cluster-id eu-funds-db --db-cluster-snapshot-id incident-$(date +%s)

# Scale down to maintenance mode
aws ecs update-service --cluster eu-funds-cluster --service eu-funds-app --desired-count 0
```
