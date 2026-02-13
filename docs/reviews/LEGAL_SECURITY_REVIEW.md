# Legal & Security Compliance Review — FondEU Platform

**Date:** 2026-02-13
**Reviewer:** Automated compliance audit
**Documents reviewed:** PRD.md, ARCHITECTURE.md, IMPLEMENTATION.md, DATA_MODEL.md, RESEARCH_REPORT.md
**Severity levels:** 🔴 CRITICAL | 🟠 HIGH | 🟡 MEDIUM | 🟢 LOW

---

## Executive Summary

The FondEU platform documentation demonstrates a solid security-aware architecture with encryption, RLS, audit logging, and GDPR basics in place. However, **critical gaps exist** in GDPR Article 35 DPIA documentation, Romanian Law 190/2018 specifics, breach notification procedures, data retention policies, and API security for external integrations. This review identifies **8 critical**, **11 high**, **6 medium**, and **4 low** severity findings.

---

## 1. Legal Compliance

### 1.1 GDPR Article 35 — Data Protection Impact Assessment (DPIA)

| # | Finding | Severity | Location |
|---|---------|----------|----------|
| L-01 | **No DPIA documented or referenced anywhere.** The platform performs automated profiling (grant matching scores organizations 0-100%), processes sensitive business data (financial records, tax status via ANAF), and uses AI for automated decision-making (compliance verdicts). All three trigger DPIA requirements under Art. 35(3). | 🔴 CRITICAL | All docs |
| L-02 | **AI compliance checks constitute automated decision-making** with legal effects (conform/neconform verdicts influence funding applications). Art. 22 GDPR requires explicit consent and human review safeguards. The disclaimer text exists but no opt-out or human review mechanism is documented. | 🔴 CRITICAL | ARCHITECTURE §3.5, PRD §J2 |
| L-03 | **Grant matching algorithm** scores organizations (0-100%) using CAEN codes, revenue, region, and employee count — this is profiling under Art. 4(4) GDPR. No profiling-specific transparency or objection mechanism documented. | 🟠 HIGH | IMPLEMENTATION §4.3 |

**Required fixes:**
1. Conduct and document a full DPIA covering: grant matching profiling, AI compliance verdicts, document OCR/extraction of personal data, ANAF/ONRC data retrieval
2. Add Art. 22 human review mechanism for AI compliance results (e.g., mandatory consultant review before "neconform" verdicts affect submissions)
3. Document profiling logic transparency per Art. 13(2)(f) and Art. 14(2)(g)
4. Create a DPIA template and schedule for re-assessment (annually or when processing changes)

### 1.2 Romanian Law No. 190/2018 — Supplemental Data Protection

| # | Finding | Severity | Location |
|---|---------|----------|----------|
| L-04 | **Law 190/2018 not referenced in any document.** This law supplements GDPR in Romania with specific provisions on: processing of national ID numbers (CNP), employee data processing, children's consent age (16 in Romania), and ANSPDCP notification requirements. | 🔴 CRITICAL | All docs |
| L-05 | **CNP (Cod Numeric Personal) handling not addressed.** Organizations store `legal_rep_name` and potentially CNP through ONRC/ANAF integrations. Law 190/2018 Art. 3 restricts CNP processing — requires explicit legal basis. No data minimization assessment for CNP. | 🟠 HIGH | DATA_MODEL §1.1 |
| L-06 | **No ANSPDCP registration/notification procedure documented.** Law 190/2018 requires certain processing activities to be reported to the Romanian supervisory authority. | 🟠 HIGH | All docs |
| L-07 | **Children's data:** Platform allows user registration with no documented age verification. Romanian law sets consent age at 16, not 13. | 🟡 MEDIUM | IMPLEMENTATION §2.1 |

**Required fixes:**
1. Add explicit Law 190/2018 compliance section to ARCHITECTURE.md
2. Document CNP handling policy: avoid storing CNP unless legally required; if stored, apply pseudonymization
3. Implement ANSPDCP notification procedures where required
4. Add age verification (minimum 16) to registration flow per Romanian law
5. Review ONRC/ANAF integration data flows for CNP/personal ID exposure

### 1.3 EU Funding Regulation Compliance (Shared Management)

| # | Finding | Severity | Location |
|---|---------|----------|----------|
| L-08 | **No documentation of shared management obligations.** Platform generates funding proposals but doesn't document compliance with Regulation (EU) 2021/1060 (Common Provisions Regulation) requirements for beneficiary record-keeping, audit trails, and document retention periods. | 🟠 HIGH | PRD, RESEARCH_REPORT |
| L-09 | **MySMIS 2021+ integration is listed as "manual/RSS"** but no compliance verification for data format requirements. The Romanian government requires specific XML schemas for electronic submissions. | 🟡 MEDIUM | ARCHITECTURE §4.1 |
| L-10 | **No anti-fraud measures documented** despite MIPE providing anti-fraud body access (EPPO, DNA, DLAF) to MySMIS. Platform should support anti-fraud requirements for generated proposals. | 🟠 HIGH | RESEARCH_REPORT §2 |
| L-11 | **State aid scheme compliance** is referenced in `calls_for_proposals.state_aid_scheme` field but no validation logic or compliance checking is documented for De Minimis, GBER, or regional aid rules. | 🟡 MEDIUM | DATA_MODEL §1.2 |

**Required fixes:**
1. Document CPR 2021/1060 compliance requirements: beneficiary obligations, document retention (per Art. 82: minimum 5 years from Dec 31 of year of final payment), audit trail specifications
2. Implement MySMIS XML schema validation for export functionality
3. Add anti-fraud declaration generation and conflict-of-interest checks
4. Implement state aid cumulation checking (De Minimis €300k ceiling, GBER thresholds)

### 1.4 Cross-Border Data Transfer (EU-Romania)

| # | Finding | Severity | Location |
|---|---------|----------|----------|
| L-12 | **Data residency stated as "Hetzner Frankfurt" (Germany)** — within EU, so no Chapter V GDPR transfer issues for EU data. ✅ | 🟢 OK | ARCHITECTURE §7 |
| L-13 | **LLM API calls to US-based providers (Anthropic Claude, OpenAI GPT-4.1-mini)** constitute cross-border transfers to the US. No documentation of: Standard Contractual Clauses (SCCs), Transfer Impact Assessment (TIA), or EU-US Data Privacy Framework adequacy. | 🔴 CRITICAL | ARCHITECTURE §3.4 |
| L-14 | **Cloudflare CDN** processes request data globally. No documentation of Cloudflare's DPA or data processing addendum. | 🟡 MEDIUM | ARCHITECTURE §2 |
| L-15 | **SendGrid (email)** — US-based processor. No DPA or SCC documentation. | 🟡 MEDIUM | ARCHITECTURE §4.2 |

**Required fixes:**
1. **Urgent:** Document legal basis for LLM API data transfers to US providers. Options: (a) verify Anthropic/OpenAI participation in EU-US Data Privacy Framework, (b) execute SCCs, (c) implement EU-hosted LLM alternative for personal data processing
2. Conduct Transfer Impact Assessment for each US-based sub-processor
3. Maintain a public register of sub-processors (GDPR Art. 28)
4. Execute DPAs with Cloudflare, SendGrid, and all sub-processors
5. Consider EU-hosted LLM inference (e.g., self-hosted models on Hetzner) to eliminate transfer risk for sensitive data

---

## 2. Security Review

### 2.1 Data Encryption

| # | Finding | Severity | Location |
|---|---------|----------|----------|
| S-01 | **Encryption at rest: well-documented.** AES-256 (PostgreSQL TDE + LUKS), AES-256-GCM per-file encryption for documents, Vault transit engine for secrets. ✅ | 🟢 OK | ARCHITECTURE §6.3 |
| S-02 | **Encryption in transit: well-documented.** TLS 1.3 everywhere, mTLS for internal services in production. ✅ | 🟢 OK | ARCHITECTURE §6.3 |
| S-03 | **Key management:** Vault referenced but no key rotation policy documented. | 🟡 MEDIUM | ARCHITECTURE §6.3 |
| S-04 | **Redis sessions/cache:** No encryption at rest mentioned for Redis. Session tokens and cached data may contain PII. | 🟠 HIGH | ARCHITECTURE §2, §6.3 |

**Required fixes:**
1. Document key rotation schedule (recommend: 90 days for data keys, annually for master keys)
2. Enable Redis TLS and consider Redis encryption at rest (or use encrypted disk)
3. Ensure Redis session data is encrypted or tokenized

### 2.2 API Security for External Integrations

| # | Finding | Severity | Location |
|---|---------|----------|----------|
| S-05 | **EUR-Lex integration uses SPARQL + REST** — no authentication/authorization details documented. EUR-Lex webservice requires registration; credentials storage not specified. | 🟠 HIGH | ARCHITECTURE §4.1 |
| S-06 | **data.gov.ro noted as lacking HTTPS and CORS.** Ingestion service connects over HTTP — data integrity and confidentiality risk. | 🔴 CRITICAL | RESEARCH_REPORT §3 |
| S-07 | **Web scraping of legislatie.just.ro, fonduri-structurale.ro, SEAP** — no rate limiting, retry logic, or legal compliance (robots.txt respect) documented. | 🟠 HIGH | ARCHITECTURE §4.1 |
| S-08 | **ONRC and ANAF API credentials** — storage mechanism not specified (Vault implied but not confirmed). | 🟠 HIGH | ARCHITECTURE §4.1 |
| S-09 | **Ingestion service is Python + FastAPI** — isolated from Node.js stack but no network segmentation or security hardening documented for this service. | 🟡 MEDIUM | ARCHITECTURE §2 |

**Required fixes:**
1. Document all external API credential storage in Vault with rotation policies
2. For data.gov.ro: implement certificate pinning or use a secure proxy; validate all ingested data; log integrity checksums
3. Document web scraping compliance: robots.txt respect, rate limiting, terms of service review
4. Network-segment the ingestion service; apply principle of least privilege for its database access
5. Implement mutual authentication for all inter-service communication

### 2.3 Authentication & Authorization

| # | Finding | Severity | Location |
|---|---------|----------|----------|
| S-10 | **Auth architecture is solid:** Keycloak with OAuth 2.0/OIDC, RS256 JWT, MFA for admins/consultants, PostgreSQL RLS. ✅ | 🟢 OK | ARCHITECTURE §6.1 |
| S-11 | **MFA only "obligatoriu pentru consultanți și admin"** — not required for all users accessing sensitive legal/financial documents. | 🟠 HIGH | ARCHITECTURE §6.1 |
| S-12 | **No document-level access control.** Documents table has org-level RLS but no classification system (public/internal/confidential/restricted). Bilanțuri, studii de fezabilitate are highly sensitive. | 🟠 HIGH | DATA_MODEL §1.5 |
| S-13 | **API key management for external API** (Phase 4 public API) not documented. | 🟡 MEDIUM | IMPLEMENTATION §Faza 4 |

**Required fixes:**
1. Implement progressive MFA: require MFA when accessing financial documents, compliance reports, or organization settings
2. Add document classification field and classification-based access controls
3. Design API key management with scoped permissions, rate limiting, and rotation for the public API
4. Implement session timeout and re-authentication for sensitive operations

### 2.4 Audit Logging

| # | Finding | Severity | Location |
|---|---------|----------|----------|
| S-14 | **Audit log table exists** with user_id, action, resource, old/new values, IP, user agent. ✅ | 🟢 OK | DATA_MODEL §1.8 |
| S-15 | **No log integrity protection.** Audit logs in PostgreSQL can be modified by database admins. No append-only storage, log signing, or WORM compliance. | 🔴 CRITICAL | DATA_MODEL §1.8 |
| S-16 | **AI interaction logging documented** (ai_conversations, ai_messages tables with model, tokens, sources). ✅ | 🟢 OK | DATA_MODEL §1.6 |
| S-17 | **No audit log retention policy** specified. EU funding regulations require minimum 5-year retention. | 🟠 HIGH | DATA_MODEL §1.8 |
| S-18 | **No SIEM integration** or real-time audit alerting for suspicious activities. | 🟡 MEDIUM | IMPLEMENTATION §7 |

**Required fixes:**
1. Implement tamper-evident audit logging: append-only table with hash chaining, or export to immutable storage (e.g., S3 with Object Lock)
2. Define audit log retention: minimum 5 years per CPR 2021/1060 Art. 82, minimum 3 years per GDPR accountability
3. Implement real-time alerting on: privilege escalation, bulk data access, failed auth attempts, data export events
4. Consider centralized log management with integrity verification

### 2.5 Romanian Personal Data Handling

| # | Finding | Severity | Location |
|---|---------|----------|----------|
| S-19 | **Users table stores:** email, full_name, phone, password_hash, mfa_secret, IP addresses (via audit log). Organizations store: CUI, legal rep name, financial data. This is proportionate. ✅ | 🟢 OK | DATA_MODEL §1.1 |
| S-20 | **Soft delete implemented** (deleted_at field) but **hard purge timing unclear.** ARCHITECTURE says "hard purge after 30 days" but no automated mechanism documented. | 🟠 HIGH | ARCHITECTURE §6.2, DATA_MODEL |
| S-21 | **No data anonymization/pseudonymization strategy** for analytics, AI training, or when legal basis expires. | 🟠 HIGH | All docs |
| S-22 | **OCR/document extraction** may capture personal data from uploaded documents (bilanțuri contain employee names, salaries). No PII detection or redaction pipeline documented. | 🔴 CRITICAL | ARCHITECTURE §4.2, IMPLEMENTATION §4.2 |

**Required fixes:**
1. Implement automated hard purge job with configurable retention period
2. Build PII detection pipeline for OCR-extracted text: identify and flag CNP, names, addresses, financial details
3. Document pseudonymization strategy for analytics and AI model evaluation
4. Implement data subject access request (DSAR) automation covering all data stores including Qdrant vectors, Redis cache, MinIO documents, and audit logs

---

## 3. Regulatory Gaps

### 3.1 Missing Compliance Checks for Specific EU Programs

| # | Gap | Severity | Recommendation |
|---|-----|----------|----------------|
| G-01 | **No program-specific compliance rules engine.** Each EU program (POCIDIF, POEO, PNRR, Interreg, Horizon Europe, Erasmus+, LIFE) has unique eligibility rules, but no structured rule definitions exist — only AI/RAG-based checks. | 🔴 CRITICAL | Implement a deterministic rules engine alongside AI for hard eligibility criteria (budget ceilings, eligible CAEN codes, region restrictions, org type). AI should handle soft/subjective criteria. |
| G-02 | **PNRR-specific requirements missing.** PNRR has distinct milestone/target reporting, "Do No Significant Harm" (DNSH) climate tagging, and reform conditionality — none documented in compliance checks. | 🟠 HIGH | Add PNRR module: DNSH assessment, milestone tracking, climate contribution tagging per EU Taxonomy. |
| G-03 | **Interreg cross-border partnership validation** not implemented. Interreg requires partners from multiple countries with specific geographic eligibility. | 🟡 MEDIUM | Add partnership validation rules per Interreg program area definitions. |
| G-04 | **Public procurement compliance** (HG 399/2015, OUG 114/2011) referenced in PRD but no actual checking logic or integration with SEAP documented. | 🟠 HIGH | Implement procurement threshold checking and SEAP cross-reference for UAT projects. |

### 3.2 Incomplete GDPR Implementation

| # | Gap | Severity | Recommendation |
|---|-----|----------|----------------|
| G-05 | **Privacy policy / terms of service** not referenced in any document. | 🟠 HIGH | Draft and integrate: Privacy Policy (Art. 13/14), Terms of Service, Cookie Policy, DPA template for Enterprise clients. |
| G-06 | **Consent management:** "Cookie banner + CMP" mentioned but no granular consent tracking for different processing purposes (marketing, analytics, AI processing). | 🟠 HIGH | Implement purpose-based consent management with withdrawal capability. Store consent records with timestamp, version, and specific purposes. |
| G-07 | **Data portability (Art. 20):** "Export complet cont în format standard" mentioned but format not specified. | 🟡 MEDIUM | Define export format: JSON + CSV for structured data, original format for documents. Ensure machine-readable and commonly used format. |
| G-08 | **DPO contact:** "Desemnat, contact pe platformă" — no further details. | 🟡 MEDIUM | Document DPO appointment, qualifications, contact method, and independence guarantees per Art. 37-39. |

### 3.3 Data Retention Policies

| # | Gap | Severity | Recommendation |
|---|-----|----------|----------------|
| G-09 | **No data retention policy document exists.** Multiple conflicting requirements: GDPR minimization vs. EU funding 5-year retention vs. Romanian fiscal 10-year retention. | 🔴 CRITICAL | Create comprehensive data retention schedule covering every data category: |

**Required retention schedule:**

| Data Category | Minimum Retention | Maximum Retention | Legal Basis |
|---------------|-------------------|-------------------|-------------|
| User account data | Duration of account | 30 days post-deletion | GDPR Art. 17 |
| Project data | 5 years from final EU payment | 10 years (fiscal) | CPR Art. 82, Romanian fiscal law |
| Financial documents | 10 years | 10 years | Romanian fiscal regulations |
| AI conversation logs | 1 year | 3 years | Legitimate interest + accountability |
| Audit logs | 5 years | 7 years | CPR Art. 82, GDPR accountability |
| Compliance reports | 5 years from project close | 7 years | EU funding requirements |
| Marketing consent records | Duration of consent + 3 years | 5 years | GDPR Art. 7(1) proof of consent |
| Session/security logs | 90 days | 1 year | Security legitimate interest |

### 3.4 Breach Notification Procedures

| # | Gap | Severity | Recommendation |
|---|-----|----------|----------------|
| G-10 | **"Breach notification: Proces automat < 72h" — one line, no actual procedure.** This is grossly insufficient for GDPR Art. 33/34 compliance. | 🔴 CRITICAL | Implement full breach response plan: |

**Required breach notification procedure:**

1. **Detection & Triage** (0-4h)
   - Automated detection: anomaly alerts from monitoring, failed login spikes, unusual data access patterns
   - Security team on-call rotation
   - Initial severity classification: Low / Medium / High / Critical

2. **Assessment** (4-24h)
   - Determine: nature of breach, categories of data, approximate number of records, likely consequences
   - Document in incident log
   - Engage DPO

3. **ANSPDCP Notification** (within 72h of awareness) — Art. 33
   - Nature of the breach
   - Categories and approximate number of data subjects
   - Name and contact of DPO
   - Likely consequences
   - Measures taken or proposed
   - Template: prepare standard ANSPDCP notification form

4. **Data Subject Notification** (without undue delay if high risk) — Art. 34
   - Clear language describing the breach
   - DPO contact
   - Likely consequences
   - Measures taken
   - Delivery: email + in-app notification

5. **EU Funding Authority Notification**
   - Notify relevant Managing Authority if breach affects EU-funded project data
   - MIPE notification for PNRR data

6. **Remediation & Post-Incident**
   - Root cause analysis
   - Remediation measures
   - Policy/procedure updates
   - Staff training updates
   - Breach register update (Art. 33(5))

---

## 4. Priority Action Plan

### Immediate (Before MVP — Weeks 1-8)

| Priority | Action | Findings |
|----------|--------|----------|
| 🔴 P0 | Conduct and document DPIA | L-01, L-02 |
| 🔴 P0 | Document LLM data transfer legal basis (SCCs or DPF verification) | L-13 |
| 🔴 P0 | Create breach notification procedure document | G-10 |
| 🔴 P0 | Implement PII detection for document OCR pipeline | S-22 |
| 🔴 P0 | Create data retention policy | G-09 |

### Before Beta (Weeks 9-14)

| Priority | Action | Findings |
|----------|--------|----------|
| 🟠 P1 | Add Law 190/2018 compliance (CNP handling, age verification) | L-04, L-05, L-07 |
| 🟠 P1 | Implement deterministic rules engine for hard eligibility criteria | G-01 |
| 🟠 P1 | Enable Redis encryption, document key rotation policy | S-03, S-04 |
| 🟠 P1 | Implement tamper-evident audit logging | S-15 |
| 🟠 P1 | Draft privacy policy, terms of service, DPA template | G-05 |
| 🟠 P1 | Secure external API credentials in Vault with rotation | S-05, S-08 |
| 🟠 P1 | Add human review mechanism for AI compliance verdicts | L-02 |

### Before Production Launch (Weeks 15-20)

| Priority | Action | Findings |
|----------|--------|----------|
| 🟠 P2 | Implement granular consent management | G-06 |
| 🟠 P2 | Add document classification and classification-based access control | S-12 |
| 🟠 P2 | Implement progressive MFA | S-11 |
| 🟠 P2 | Add PNRR DNSH module | G-02 |
| 🟠 P2 | Implement automated hard purge mechanism | S-20 |
| 🟠 P2 | Implement data anonymization strategy | S-21 |
| 🟠 P2 | Complete ANSPDCP notification procedures | L-06 |
| 🟡 P3 | Implement DSAR automation across all data stores | S-22 |
| 🟡 P3 | Secure data.gov.ro ingestion (HTTPS proxy, integrity checks) | S-06 |
| 🟡 P3 | Define audit log retention and SIEM integration | S-17, S-18 |

---

## 5. Compliance Checklist Summary

| Area | Status | Score |
|------|--------|-------|
| GDPR Article 35 (DPIA) | ❌ Not started | 0/10 |
| Romanian Law 190/2018 | ❌ Not referenced | 0/10 |
| EU Funding Regulations (CPR) | ⚠️ Partially addressed | 3/10 |
| Cross-border Data Transfers | ❌ Critical gaps (LLM APIs) | 2/10 |
| Encryption (rest + transit) | ✅ Well-documented | 8/10 |
| API Security (external) | ⚠️ Architecture exists, details missing | 4/10 |
| Authentication/Authorization | ✅ Solid architecture | 7/10 |
| Audit Logging | ⚠️ Exists but not tamper-proof | 5/10 |
| Data Retention Policies | ❌ Not documented | 0/10 |
| Breach Notification | ❌ One-liner, no procedure | 1/10 |
| **Overall Compliance Readiness** | **⚠️ Not ready for production** | **3/10** |

---

*This review should be updated after each remediation cycle. Next review recommended: before beta launch (Week 14).*
