# ISO 27001 Preparation Checklist

## Required for SEAP Registration

### A.5 Information Security Policies
- [x] Information security policy documented
- [x] Review of information security policies
- [ ] Management approval of policies

### A.6 Organization of Information Security
- [x] Information security roles and responsibilities defined
- [ ] Segregation of duties implemented
- [x] Contact with authorities (ANSPDCP, CERT-RO)

### A.7 Human Resource Security
- [ ] Background verification procedures
- [ ] Information security awareness training
- [ ] Disciplinary process documented

### A.8 Asset Management
- [x] Inventory of information assets
- [x] Acceptable use of assets policy
- [x] Classification of information (public, internal, confidential, restricted)

### A.9 Access Control
- [x] Access control policy
- [x] User registration and de-registration
- [x] Privilege management (RBAC)
- [x] Password policy enforcement
- [x] Review of user access rights (quarterly)
- [x] Multi-factor authentication available

### A.10 Cryptography
- [x] Policy on use of cryptographic controls
- [x] TLS 1.2+ for data in transit
- [x] AES-256 for data at rest
- [x] QES via certSIGN (eIDAS compliant)
- [x] Key management procedures

### A.11 Physical and Environmental Security
- [x] AWS data center physical security (SOC 2, ISO 27001)
- [x] Equipment security (cloud-managed)

### A.12 Operations Security
- [x] Documented operating procedures
- [x] Change management process
- [x] Capacity management (auto-scaling)
- [x] Separation of development, staging, and production
- [x] Protection from malware (container scanning)
- [x] Backup procedures (daily, 30-day retention)
- [x] Logging and monitoring (CloudWatch, Sentry, Prometheus)
- [x] Technical vulnerability management (weekly scans)

### A.13 Communications Security
- [x] Network controls (VPC, security groups)
- [x] Network segmentation (private subnets for DB)
- [x] Information transfer policies (API encryption)

### A.14 System Acquisition, Development and Maintenance
- [x] Security requirements in development
- [x] Secure development policy
- [x] CI/CD with security scanning
- [x] Test data protection (no production PII in dev)
- [x] Security testing (OWASP ZAP, penetration testing)

### A.15 Supplier Relationships
- [ ] Information security policy for supplier relationships
- [x] Addressing security within supplier agreements (DPA with subprocessors)
- [x] Monitoring of supplier service delivery (API health checks)

### A.16 Information Security Incident Management
- [x] Incident response plan documented
- [x] Responsibilities and procedures defined
- [x] GDPR breach notification (72-hour ANSPDCP)
- [ ] Collection of evidence procedures
- [x] Post-incident review process

### A.17 Business Continuity
- [x] Disaster recovery plan
- [x] Multi-AZ deployment
- [x] Automated backups with tested restore
- [ ] Annual DR drill documented

### A.18 Compliance
- [x] GDPR compliance (DPIA completed)
- [x] ANSPDCP registration
- [x] eIDAS compliance (QES)
- [x] Intellectual property rights
- [x] Privacy policy (Romanian and English)
- [x] Audit trail for data processing

## Status: ~85% Ready
## Next Steps:
1. Complete management approval of all policies
2. Implement background verification procedures
3. Conduct annual DR drill
4. Engage ISO 27001 certification body
