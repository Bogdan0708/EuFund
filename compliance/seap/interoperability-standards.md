# EU Interoperability Standards Compliance

## European Interoperability Framework (EIF) Alignment

### Technical Interoperability
- **REST API** - OpenAPI 3.0 specification for all endpoints
- **Data Formats** - JSON (primary), XML (government integration)
- **Character Encoding** - UTF-8 with full Romanian diacritics support (ă, â, î, ș, ț)
- **Date/Time** - ISO 8601, Europe/Bucharest timezone support
- **Currency** - EUR and RON with ECB exchange rate integration

### Semantic Interoperability
- **NACE Codes** - EU economic activity classification
- **NUTS Codes** - EU territorial classification (Romania: RO1-RO4)
- **CPV Codes** - Common Procurement Vocabulary for SEAP

### eIDAS Compliance
- **QES** - Qualified Electronic Signatures via certSIGN.ro
- **Signature Formats** - PAdES (PDF), XAdES (XML), CAdES (binary)
- **Trust Services** - EU Trust List integration
- **Certificate Validation** - OCSP and CRL checking

### Romanian Government APIs
| API | Protocol | Auth | Format |
|-----|----------|------|--------|
| ONRC | REST/SOAP | API Key | JSON/XML |
| ANAF | REST | Certificate | JSON |
| MySMIS 2021 | REST | OAuth2 | JSON |
| certSIGN | REST | mTLS | JSON |
| SEAP | SOAP/REST | Certificate | XML/JSON |

### EU Digital Standards
- **WCAG 2.1 AA** - Web accessibility compliance
- **GDPR** - Data protection by design and by default
- **EU Web Accessibility Directive** - Public sector compliance
- **Once-Only Principle** - Reuse of government data (ONRC/ANAF)
