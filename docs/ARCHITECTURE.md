# ARCHITECTURE.md – Arhitectura Sistemului FondEU

## 1. Prezentare Generală

```
┌──────────────────────────────────────────────────────────────┐
│                        CDN (Cloudflare)                       │
└──────────────┬───────────────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────────────┐
│              Next.js Frontend (Vercel / Docker)               │
│   React 18 + TypeScript + TailwindCSS + next-intl (ro/en)    │
└──────────────┬───────────────────────────────────────────────┘
               │ HTTPS
┌──────────────▼───────────────────────────────────────────────┐
│                    API Gateway (Kong / Traefik)                │
│            Rate limiting, Auth validation, CORS                │
└────┬─────────┬──────────┬──────────┬────────────────────────┘
     │         │          │          │
┌────▼───┐ ┌──▼────┐ ┌───▼───┐ ┌───▼──────┐
│ Auth   │ │Project│ │ AI    │ │ Grants   │
│Service │ │Service│ │Service│ │ Service  │
│(Node)  │ │(Node) │ │(Node) │ │ (Node)   │
└───┬────┘ └──┬────┘ └───┬───┘ └───┬──────┘
    │         │          │          │
┌───▼─────────▼──────────▼──────────▼──────┐
│          PostgreSQL 16 (Primary)          │
│              + Read Replica               │
├───────────────────────────────────────────┤
│          Qdrant (Vector Database)         │
├───────────────────────────────────────────┤
│          Redis (Cache + Sessions)         │
├───────────────────────────────────────────┤
│          MinIO / S3 (Documents)           │
└───────────────────────────────────────────┘
```

---

## 2. Tech Stack

### Frontend
| Component | Technology | Justificare |
|-----------|-----------|-------------|
| Framework | Next.js 14 (App Router) | SSR, SEO, performance |
| Language | TypeScript 5.x | Type safety |
| Styling | TailwindCSS + shadcn/ui | Rapid UI development |
| i18n | next-intl | Suport ro/en cu plural forms |
| State | Zustand + TanStack Query | Light, cache-efficient |
| Forms | React Hook Form + Zod | Validation cu mesaje ro |
| Rich Text | TipTap | Editor WYSIWYG pentru propuneri |
| PDF | react-pdf + pdf-lib | Preview și generare PDF |
| Charts | Recharts | Dashboard vizualizări |

### Backend (Microservicii)
| Service | Tech | Responsabilitate |
|---------|------|-----------------|
| auth-service | Node.js + Fastify | Autentificare, autorizare, RBAC |
| project-service | Node.js + Fastify | CRUD proiecte, versioning |
| ai-service | Node.js + Fastify | Orchestrare LLM, RAG pipeline |
| grants-service | Node.js + Fastify | Catalog finanțări, matching |
| document-service | Node.js + Fastify | Upload, OCR, parsare documente |
| notification-service | Node.js + Fastify | Email, in-app, push |
| ingestion-service | Python + FastAPI | Crawling legislație, indexare |

### Data Layer
| Component | Technology | Rol |
|-----------|-----------|-----|
| RDBMS | PostgreSQL 16 | Date structurate principale |
| Vector DB | Qdrant | Embeddings legislație + ghiduri |
| Cache | Redis 7 | Sessions, rate limiting, cache |
| Object Storage | MinIO (self-hosted) / S3 | Documente uploadate |
| Search | PostgreSQL FTS + pg_trgm | Full-text search în română |
| Queue | BullMQ (Redis) | Job processing asincron |

### Infrastructure
| Component | Technology |
|-----------|-----------|
| Container | Docker + Docker Compose (dev), Kubernetes (prod) |
| CI/CD | GitHub Actions |
| Monitoring | Prometheus + Grafana |
| Logging | Pino → Loki |
| Hosting | Hetzner Cloud (Frankfurt) – date în EU |
| DNS/CDN | Cloudflare |
| Secrets | HashiCorp Vault / Doppler |

---

## 3. AI Architecture

### 3.1 RAG Pipeline (Retrieval-Augmented Generation)

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Legislație  │────▶│  Chunking +  │────▶│   Qdrant    │
│  (PDF/HTML)  │     │  Embedding   │     │  Collection │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                 │
┌─────────────┐     ┌──────────────┐     ┌──────▼──────┐
│ User Query  │────▶│  Embedding   │────▶│  Semantic   │
│             │     │  (same model)│     │  Search     │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                 │
                    ┌──────────────┐     ┌──────▼──────┐
                    │   Response   │◀────│  LLM +      │
                    │   to User    │     │  Context    │
                    └──────────────┘     └─────────────┘
```

### 3.2 Document Collections (Qdrant)

| Collection | Sursa | Update | Chunks |
|-----------|-------|--------|--------|
| `eu_regulations` | EUR-Lex (ERDF, ESF+, CF regs) | Lunar | ~50K |
| `ro_legislation` | Legislatie.just.ro, ANAP | Săptămânal | ~30K |
| `applicant_guides` | Site-uri AM/OI (PDF) | La publicare | ~20K |
| `project_templates` | Proiecte model interne | Manual | ~5K |
| `faq_knowledge` | Întrebări frecvente, clarificări | Continuu | ~10K |

### 3.3 Embedding Model
- **Primary:** `text-multilingual-embedding-002` (Google) – excelent pe română
- **Fallback:** `multilingual-e5-large` (self-hosted pe GPU)
- **Chunk size:** 512 tokens, overlap 64 tokens
- **Metadata per chunk:** source_doc, article_number, date_published, program, language

### 3.4 LLM Strategy

| Task | Model | Temp | Max Tokens |
|------|-------|------|------------|
| Compliance check | Claude Sonnet 4 | 0.1 | 4096 |
| Proposal generation | Claude Sonnet 4 | 0.4 | 8192 |
| Grant matching | GPT-4.1-mini | 0.0 | 2048 |
| Document summarization | Claude Haiku | 0.2 | 4096 |
| Translation ro↔en | Claude Haiku | 0.1 | 4096 |

**Router:** Folosim un model router care selectează modelul optim per task bazat pe complexitate și cost.

### 3.5 AI Safety
- Toate output-urile AI au disclaimer: *"Generat automat. Verificați cu ghidul oficial."*
- Referințe obligatorii la articole/secțiuni pentru orice afirmație legală
- Filtrare hallucination: cross-reference output cu chunks retrived
- Rate limiting per user: 100 AI calls/zi (Pro), 500 (Business)
- Logging complet al tuturor interacțiunilor AI (audit trail)

---

## 4. External Integrations

### 4.1 Surse de Date

| Integare | Protocol | Frecvență | Date |
|----------|----------|-----------|------|
| EUR-Lex | SPARQL + REST | Zilnic | Regulamente EU |
| Legislatie.just.ro | Web scraping | Zilnic | Legislație RO |
| MySMIS 2021+ | Manual / RSS | La publicare | Apeluri, ghiduri |
| ONRC (Registrul Comerțului) | API (dacă disponibil) / manual | La cerere | Date firmă, CAEN |
| ANAF | API SPV (viitor) | La cerere | Bilanțuri, datorii |
| SEAP | RSS + scraping | Zilnic | Referință achiziții |
| Fonduri-structurale.ro | Scraping | Zilnic | Apeluri active |
| BNR | API public | Zilnic | Curs valutar EUR/RON |

### 4.2 Output Integrations
| Sistem | Scop |
|--------|------|
| MySMIS 2021+ | Export format compatibil (XML/PDF) |
| E-licitație | Referință pentru achiziții proiect |
| DocuSign / Validated ID | Semnătură electronică |
| Email (SendGrid) | Notificări, rapoarte |

---

## 5. Database Schema (Overview)

### Core Tables
```sql
-- Users & Organizations
users, organizations, org_members, roles

-- Projects
projects, project_sections, project_versions, project_comments

-- Grants & Programs  
funding_programs, calls_for_proposals, eligibility_criteria

-- Legislation
legislation_documents, legislation_chunks, legislation_updates

-- AI
ai_conversations, ai_messages, compliance_reports

-- Documents
documents, document_extractions

-- Notifications
notifications, notification_preferences
```

*(Detalii complete în DATA_MODEL.md)*

---

## 6. Security Architecture

### 6.1 Authentication & Authorization
```
┌──────────┐    ┌───────────┐    ┌──────────────┐
│  Client   │───▶│  Auth0 /  │───▶│  JWT Token   │
│  (Browser)│    │  Keycloak │    │  (RS256)     │
└──────────┘    └───────────┘    └──────┬───────┘
                                        │
                                 ┌──────▼───────┐
                                 │  API Gateway  │
                                 │  validates    │
                                 │  JWT + RBAC   │
                                 └──────────────┘
```

- **SSO:** OAuth 2.0 / OIDC via Keycloak (self-hosted)
- **MFA:** TOTP obligatoriu pentru consultanți și admin
- **Roles:** `admin`, `org_admin`, `project_manager`, `viewer`
- **Row-Level Security:** PostgreSQL RLS per organizație

### 6.2 GDPR Compliance

| Cerință | Implementare |
|---------|-------------|
| Consimțământ | Cookie banner + consent management (CMP) |
| Drept la acces | Export date personale (JSON/PDF) |
| Drept la ștergere | Soft delete + hard purge după 30 zile |
| Portabilitate | Export complet cont în format standard |
| DPO | Desemnat, contact pe platformă |
| Registru prelucrări | Documentat, actualizat automat |
| Breach notification | Proces automat < 72h |
| Date residency | Toate datele în EU (Hetzner Frankfurt) |
| Encryption at rest | AES-256 (PostgreSQL TDE + MinIO) |
| Encryption in transit | TLS 1.3 everywhere |
| Audit log | Toate acțiunile logate cu timestamp + user |

### 6.3 Data Encryption
```
Client ←→ CDN: TLS 1.3
CDN ←→ API: TLS 1.3 (mTLS în producție)
API ←→ DB: TLS 1.3 + password rotation
DB at rest: AES-256 (LUKS + PG TDE)
Documents: AES-256-GCM per-file encryption
Secrets: Vault transit engine
```

### 6.4 Input Validation & Security
- Zod validation pe fiecare endpoint
- SQL injection: parametrized queries (Drizzle ORM)
- XSS: CSP headers strict + DOMPurify
- CSRF: SameSite cookies + CSRF tokens
- Rate limiting: 100 req/min per IP, 1000 req/min per user
- File upload: type validation, size limit (50MB), virus scan (ClamAV)

---

## 7. Deployment Architecture

### Production
```
┌─────────────────────────────────────────┐
│           Hetzner Cloud (Frankfurt)      │
│                                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│  │ Node 1  │  │ Node 2  │  │ Node 3  │ │
│  │ k3s     │  │ k3s     │  │ k3s     │ │
│  │ worker  │  │ worker  │  │ worker  │ │
│  └─────────┘  └─────────┘  └─────────┘ │
│                                          │
│  ┌──────────────────────────────────┐   │
│  │ Managed PostgreSQL (Hetzner)     │   │
│  │ Primary + 1 Read Replica         │   │
│  └──────────────────────────────────┘   │
│                                          │
│  ┌──────────┐  ┌──────────┐             │
│  │ Qdrant   │  │ Redis    │             │
│  │ (3-node) │  │ Sentinel │             │
│  └──────────┘  └──────────┘             │
└─────────────────────────────────────────┘
```

### Cost Estimate (Lunar)
| Component | Cost |
|-----------|------|
| 3x CX41 (k3s workers) | €90 |
| Managed PostgreSQL | €50 |
| 3x CX21 (Qdrant) | €30 |
| 1x CX21 (Redis) | €10 |
| Object Storage (1TB) | €12 |
| Cloudflare Pro | €20 |
| LLM API costs | €200-500 |
| **Total** | **~€400-600/lună** |
