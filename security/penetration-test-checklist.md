# Penetration Testing Checklist - EU Funds Platform

## OWASP Top 10 (2021) Verification

### A01:2021 - Broken Access Control
- [ ] Verify role-based access control (admin, organization, user)
- [ ] Test horizontal privilege escalation (access other org's data)
- [ ] Test vertical privilege escalation (user → admin)
- [ ] Verify CORS configuration allows only trusted origins
- [ ] Test JWT/session token manipulation
- [ ] Verify API endpoints enforce authentication
- [ ] Test IDOR on /api/organizations/:id, /api/proposals/:id
- [ ] Verify multi-tenant data isolation

### A02:2021 - Cryptographic Failures
- [ ] Verify TLS 1.2+ enforced (no TLS 1.0/1.1)
- [ ] Check SSL Labs rating (target: A+)
- [ ] Verify database encryption at rest (RDS)
- [ ] Verify Redis transit encryption
- [ ] Check password hashing algorithm (bcrypt/argon2)
- [ ] Verify PII encryption in database
- [ ] Test certSIGN QES certificate validation

### A03:2021 - Injection
- [ ] SQL injection on all input fields
- [ ] NoSQL injection tests
- [ ] XSS (stored, reflected, DOM-based) on proposal forms
- [ ] Command injection on file upload processing
- [ ] LDAP injection (if applicable)
- [ ] Test Romanian diacritics in injection payloads (ă, â, î, ș, ț)

### A04:2021 - Insecure Design
- [ ] Review authentication flow (next-auth)
- [ ] Test rate limiting on login, registration, API
- [ ] Verify CSRF protection on state-changing operations
- [ ] Test file upload restrictions (type, size, content)
- [ ] Review QES signing workflow for bypass

### A05:2021 - Security Misconfiguration
- [ ] Check for default credentials
- [ ] Verify security headers (CSP, HSTS, X-Frame-Options)
- [ ] Test for information disclosure (stack traces, versions)
- [ ] Check exposed admin endpoints
- [ ] Verify error handling doesn't leak internals
- [ ] Test .env file accessibility

### A06:2021 - Vulnerable Components
- [ ] Run npm audit
- [ ] Run Snyk dependency scan
- [ ] Check for outdated packages
- [ ] Verify Docker base image security
- [ ] Review third-party API security (ONRC, ANAF)

### A07:2021 - Authentication Failures
- [ ] Test brute force protection on login
- [ ] Verify password complexity requirements
- [ ] Test session management (timeout, invalidation)
- [ ] Verify MFA implementation (if enabled)
- [ ] Test account lockout mechanism
- [ ] Check session fixation vulnerability

### A08:2021 - Software and Data Integrity
- [ ] Verify CSP for script integrity
- [ ] Check CI/CD pipeline security
- [ ] Verify package-lock.json integrity
- [ ] Test for deserialization vulnerabilities
- [ ] Verify Docker image signatures

### A09:2021 - Logging and Monitoring
- [ ] Verify audit logging captures all security events
- [ ] Test log injection
- [ ] Verify GDPR audit trail completeness
- [ ] Check alerting for suspicious activity
- [ ] Verify log retention policies

### A10:2021 - SSRF
- [ ] Test URL input fields for SSRF
- [ ] Check internal network access from application
- [ ] Verify external API call restrictions (ONRC, ANAF, certSIGN)
- [ ] Test file import/URL fetch features

## Romanian Government Integration Testing
- [ ] ONRC API - validate input sanitization
- [ ] ANAF API - verify data handling security
- [ ] MySMIS - test authentication flow
- [ ] certSIGN QES - verify certificate chain validation
- [ ] Test API timeout handling and error responses

## GDPR-Specific Tests
- [ ] Verify data subject access request flow
- [ ] Test data erasure (right to be forgotten)
- [ ] Verify consent management
- [ ] Test data portability export
- [ ] Verify cross-border transfer controls
- [ ] Test CNP/personal data masking in logs

## Testing Tools
- **OWASP ZAP** - Automated DAST scanning
- **Burp Suite** - Manual penetration testing
- **sqlmap** - SQL injection testing
- **nuclei** - Vulnerability scanning
- **k6** - Load/stress testing
- **sslyze** - SSL/TLS testing
