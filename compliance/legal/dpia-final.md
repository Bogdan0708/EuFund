# Data Protection Impact Assessment (DPIA)
## EU Funds Platform - Final Version

### 1. Description of Processing

**Controller:** [Company Name]
**DPO:** [Name, Contact]
**Date:** 2026-02-13
**Version:** 1.0 - Final

#### 1.1 Purpose of Processing
Management of EU funding proposals for Romanian organizations, including:
- Organization registration and verification (ONRC/ANAF)
- AI-assisted proposal generation
- Qualified Electronic Signature (QES) via certSIGN
- Proposal submission to MySMIS 2021

#### 1.2 Categories of Data Subjects
- Organization administrators and users
- Organization representatives (authorized signatories)
- Contact persons for funding proposals

#### 1.3 Categories of Personal Data
| Category | Data Elements | Legal Basis |
|----------|--------------|-------------|
| Identity | Name, CNP, position | Contract performance |
| Contact | Email, phone, address | Contract performance |
| Professional | Organization role, qualifications | Legitimate interest |
| Financial | Organization fiscal data (via ANAF) | Contract performance |
| Authentication | Password hash, session tokens | Contract performance |
| Usage | IP address, browser, actions | Legitimate interest |
| Signatures | QES certificate data | Legal obligation (eIDAS) |

#### 1.4 Recipients
- ONRC (company verification)
- ANAF (fiscal verification)
- MySMIS 2021 (proposal submission)
- certSIGN (QES signing)
- OpenAI (AI text generation - no PII sent)

### 2. Necessity and Proportionality

#### 2.1 Necessity Assessment
- ✅ All data collected is necessary for funding proposal management
- ✅ CNP required only for QES signing (eIDAS regulation)
- ✅ Financial data retrieved only for eligibility checks
- ✅ AI processing uses anonymized/aggregated text only

#### 2.2 Data Minimization Measures
- PII detection and redaction before AI processing
- CNP masked in logs and UI (shows only last 4 digits)
- Session data minimized to authentication needs
- Automatic data deletion after retention period

### 3. Risk Assessment

| Risk | Likelihood | Impact | Mitigation | Residual Risk |
|------|-----------|--------|------------|---------------|
| Unauthorized data access | Low | High | RBAC, MFA, encryption, audit logs | Low |
| Data breach via external API | Low | High | TLS, API key rotation, WAF | Low |
| CNP exposure in logs | Medium | High | PII detection, log sanitization | Low |
| AI model data leakage | Low | Medium | No PII to AI, EU API endpoint | Low |
| Cross-border data transfer | Low | High | EU-only infrastructure, SCC | Very Low |
| Insider threat | Low | Medium | Audit trail, least privilege, background checks | Low |
| Ransomware/data loss | Low | Critical | Multi-AZ, backups, DR plan | Low |

### 4. Measures to Address Risks

#### 4.1 Technical Measures (Article 32)
- [x] Encryption at rest (AES-256) and in transit (TLS 1.2+)
- [x] Access control (RBAC with least privilege)
- [x] Multi-factor authentication
- [x] WAF with OWASP Top 10 protection
- [x] Automated vulnerability scanning
- [x] Comprehensive audit logging
- [x] Automated backup with tested restore
- [x] Network segmentation (VPC, private subnets)
- [x] Container security scanning

#### 4.2 Organizational Measures
- [x] Data protection policy
- [x] Incident response plan
- [x] Employee training on data protection
- [x] DPA with all subprocessors
- [x] Regular security assessments
- [x] Data retention policy with automatic enforcement

#### 4.3 Data Subject Rights Implementation
- [x] Right of access (automated export)
- [x] Right to rectification (self-service + support)
- [x] Right to erasure (automated with audit trail)
- [x] Right to data portability (JSON/CSV export)
- [x] Right to restrict processing (account suspension)
- [x] Right to object (opt-out mechanisms)

### 5. Consultation

#### 5.1 DPO Consultation
- Date: [TBD]
- Opinion: [TBD]

#### 5.2 ANSPDCP Prior Consultation
Required: No (residual risks adequately mitigated)
Note: If high residual risks remain after mitigation, prior consultation with ANSPDCP is mandatory under Article 36.

### 6. Conclusion

The processing activities described in this DPIA are necessary and proportionate. Technical and organizational measures adequately mitigate identified risks. The residual risk level is **LOW** for all categories.

**Approval:**
- DPO: _________________ Date: _________
- Controller: _________________ Date: _________

**Review Schedule:** Annual or upon significant change to processing activities.
