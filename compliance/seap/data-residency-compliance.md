# EU Data Residency Compliance

## Data Localization

### Storage Locations
| Data Type | Location | Provider | Encryption |
|-----------|----------|----------|------------|
| Application Database | AWS eu-west-2 (London) | RDS Aurora PostgreSQL | AES-256 |
| Cache/Sessions | AWS eu-west-2 | ElastiCache Redis | AES-256 + TLS |
| Backups | AWS eu-west-2 | S3 (same region) | AES-256 |
| Logs | AWS eu-west-2 | CloudWatch | AES-256 |
| Static Assets | EU edge locations | CloudFront | TLS |
| Container Images | AWS eu-west-2 | ECR | AES-256 |

### No Data Transfers Outside EU/EEA
- ✅ All infrastructure in EU AWS regions
- ✅ No US data centers used
- ✅ CloudFront restricted to EU edge locations for PII
- ✅ Backups encrypted and stored in same region

### Subprocessors (Data Processing)
| Subprocessor | Purpose | Data Location | DPA |
|--------------|---------|---------------|-----|
| AWS (Ireland/London) | Infrastructure | EU | ✅ |
| OpenAI | AI text generation | EU API endpoint | ✅ |
| certSIGN | QES signatures | Romania | ✅ |
| Sentry | Error tracking | EU (Frankfurt) | ✅ |

### Cross-Border Transfer Safeguards
- Standard Contractual Clauses (SCC) with all non-EU subprocessors
- Data Processing Agreements (DPA) with all processors
- Transfer Impact Assessments (TIA) completed
- EU-US Data Privacy Framework relied upon where applicable

### Romanian-Specific Requirements
- CNP (Cod Numeric Personal) processed only within EU
- CUI (Cod Unic de Identificare) data from ONRC - Romanian government API
- ANAF fiscal data - never leaves Romanian/EU infrastructure
- QES certificates - Romanian TSP (certSIGN) only

### ANSPDCP Compliance
- Registration with Romanian DPA: [pending]
- DPO designated: [pending]
- DPIA completed: ✅
- Breach notification procedures: ✅ (72-hour)
