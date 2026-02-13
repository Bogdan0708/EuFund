# IMPLEMENTATION.md – Plan de Implementare FondEU

## 1. Faze de Dezvoltare

### Faza 1 – MVP (Săptămânile 1-8)
**Obiectiv:** Platformă funcțională cu flow de bază: creare proiect → compliance check → export.

| Săpt. | Deliverable |
|-------|-------------|
| 1-2 | Setup infra (Docker, DB, CI/CD), auth (Keycloak), landing page |
| 3-4 | CRUD organizații + proiecte, project builder (4 secțiuni) |
| 5-6 | RAG pipeline v1 (10 ghiduri ingerate), compliance check basic |
| 7 | Grant matching v1 (catalog manual, matching simplu) |
| 8 | Export Word, testing, deploy staging |

**Output MVP:** Utilizatorul poate crea un proiect, primi verificare de conformitate pe baza ghidului solicitantului, și exporta propunerea în Word.

### Faza 2 – AI Core (Săptămânile 9-14)
| Săpt. | Deliverable |
|-------|-------------|
| 9-10 | Generare propunere AI (narrativ, obiective, metodologie) |
| 11 | Document upload + OCR + extracție date |
| 12 | Ingestion legislație RO (automatizat) |
| 13 | Notificări (deadline, apeluri noi) |
| 14 | Beta testing cu 10 organizații pilot |

### Faza 3 – Scale (Săptămânile 15-20)
| Săpt. | Deliverable |
|-------|-------------|
| 15-16 | Dashboard multi-proiect (consultanți), colaborare |
| 17 | Integrare ONRC (auto-fill date firmă) |
| 18 | Buget generator AI, timeline Gantt |
| 19 | Billing (Stripe), plan tiers |
| 20 | Production launch |

### Faza 4 – Growth (Săptămânile 21-30)
- Mobile responsive optimization
- API publică pentru consultanți
- Integrare MySMIS export
- Marketplace template-uri proiecte
- Analytics și rapoarte avansate
- AI chat assistant (conversational)

---

## 2. API Endpoints

### 2.1 Authentication
```
POST   /api/v1/auth/register          # Înregistrare
POST   /api/v1/auth/login             # Autentificare
POST   /api/v1/auth/refresh           # Refresh token
POST   /api/v1/auth/forgot-password   # Resetare parolă
POST   /api/v1/auth/verify-email      # Verificare email
DELETE /api/v1/auth/session            # Logout
```

### 2.2 Organizations
```
POST   /api/v1/organizations                    # Creare organizație
GET    /api/v1/organizations                    # Lista organizațiile mele
GET    /api/v1/organizations/:id                # Detalii organizație
PUT    /api/v1/organizations/:id                # Actualizare
DELETE /api/v1/organizations/:id                # Ștergere (soft)
POST   /api/v1/organizations/:id/members        # Invită membru
GET    /api/v1/organizations/:id/members        # Lista membri
PUT    /api/v1/organizations/:id/members/:uid   # Schimbă rol
DELETE /api/v1/organizations/:id/members/:uid   # Elimină membru
GET    /api/v1/organizations/lookup?cui=123456  # Lookup ONRC
```

### 2.3 Projects
```
POST   /api/v1/projects                         # Creare proiect
GET    /api/v1/projects                         # Lista proiecte (cu filtre)
GET    /api/v1/projects/:id                     # Detalii proiect
PUT    /api/v1/projects/:id                     # Actualizare
DELETE /api/v1/projects/:id                     # Ștergere (soft)
PUT    /api/v1/projects/:id/sections/:section   # Update secțiune
GET    /api/v1/projects/:id/versions            # Istoric versiuni
GET    /api/v1/projects/:id/versions/:v         # Versiune specifică
POST   /api/v1/projects/:id/versions            # Salvează versiune
POST   /api/v1/projects/:id/export              # Export Word/PDF
GET    /api/v1/projects/:id/comments            # Comentarii
POST   /api/v1/projects/:id/comments            # Adaugă comentariu
```

### 2.4 Grants & Funding
```
GET    /api/v1/programs                          # Lista programe
GET    /api/v1/programs/:id                      # Detalii program
GET    /api/v1/calls                             # Lista apeluri (filtre: status, program, regiune)
GET    /api/v1/calls/:id                         # Detalii apel
GET    /api/v1/calls/:id/eligibility             # Criterii eligibilitate
GET    /api/v1/grants/match                      # Matching (query: org_id, caen, region, budget)
```

### 2.5 AI Services
```
POST   /api/v1/ai/compliance-check              # Verificare conformitate
  Body: { project_id, sections?: string[] }
  Response: ComplianceCheckResponse

POST   /api/v1/ai/generate                       # Generare text secțiune
  Body: { project_id, section, instructions_ro?: string }
  Response: { generated_text, sources[], model_used }

POST   /api/v1/ai/improve                        # Îmbunătățire text existent
  Body: { text, context, instructions_ro }
  Response: { improved_text, changes_summary }

POST   /api/v1/ai/chat                           # Chat conversational
  Body: { conversation_id?, project_id?, message }
  Response: { conversation_id, response, sources[] }

POST   /api/v1/ai/analyze-document               # Analiză document uploadat
  Body: { document_id }
  Response: { summary, extracted_data, suggestions[] }
```

### 2.6 Documents
```
POST   /api/v1/documents/upload                  # Upload document
  Body: multipart/form-data (file, org_id, project_id?, doc_type)
GET    /api/v1/documents                         # Lista documente
GET    /api/v1/documents/:id                     # Detalii + download URL
DELETE /api/v1/documents/:id                     # Ștergere
```

### 2.7 Legislation (Read-only)
```
GET    /api/v1/legislation                       # Căutare legislație
  Query: q, type, program, tags, active_only
GET    /api/v1/legislation/:id                   # Detalii document legislativ
GET    /api/v1/legislation/updates               # Modificări recente
```

### 2.8 Notifications
```
GET    /api/v1/notifications                     # Notificările mele
PUT    /api/v1/notifications/:id/read            # Marchează citită
PUT    /api/v1/notifications/read-all            # Marchează toate citite
GET    /api/v1/notifications/preferences         # Preferințe notificări
PUT    /api/v1/notifications/preferences         # Actualizare preferințe
```

---

## 3. Frontend Component Structure

```
src/
├── app/
│   ├── [locale]/                    # ro | en
│   │   ├── layout.tsx               # Layout principal
│   │   ├── page.tsx                 # Landing page
│   │   ├── (auth)/
│   │   │   ├── autentificare/       # /ro/autentificare
│   │   │   └── înregistrare/        # /ro/înregistrare
│   │   ├── (dashboard)/
│   │   │   ├── panou/               # /ro/panou (Dashboard)
│   │   │   │   └── page.tsx
│   │   │   ├── proiecte/            # /ro/proiecte
│   │   │   │   ├── page.tsx         # Lista proiecte
│   │   │   │   ├── nou/page.tsx     # Proiect nou (wizard)
│   │   │   │   └── [id]/
│   │   │   │       ├── page.tsx     # Detalii proiect
│   │   │   │       ├── editare/     # Builder proiect
│   │   │   │       ├── conformitate/ # Raport conformitate
│   │   │   │       └── export/      # Export
│   │   │   ├── finanțări/           # /ro/finanțări
│   │   │   │   ├── page.tsx         # Catalog + matching
│   │   │   │   └── [id]/page.tsx    # Detalii apel
│   │   │   ├── documente/           # /ro/documente
│   │   │   ├── legislație/          # /ro/legislație
│   │   │   ├── organizație/         # /ro/organizație
│   │   │   └── setări/              # /ro/setări
│   │   └── (marketing)/
│   │       ├── despre/              # Despre noi
│   │       ├── prețuri/             # Pricing
│   │       └── contact/             # Contact
│   └── api/                         # API routes (BFF)
├── components/
│   ├── ui/                          # shadcn/ui components
│   ├── layout/
│   │   ├── sidebar.tsx              # Meniu lateral
│   │   ├── header.tsx               # Header cu notificări
│   │   └── footer.tsx
│   ├── proiect/                     # Project components
│   │   ├── project-wizard.tsx       # Wizard creare proiect
│   │   ├── project-builder.tsx      # Builder cu tabs pe secțiuni
│   │   ├── section-editor.tsx       # Editor per secțiune
│   │   ├── budget-table.tsx         # Tabel buget interactiv
│   │   ├── timeline-gantt.tsx       # Gantt chart activități
│   │   ├── indicator-form.tsx       # Formular indicatori
│   │   └── project-card.tsx         # Card proiect (lista)
│   ├── conformitate/
│   │   ├── compliance-report.tsx    # Raport complet
│   │   ├── compliance-badge.tsx     # Badge ✅⚠️❌
│   │   └── compliance-item.tsx      # Item individual
│   ├── finanțări/
│   │   ├── grant-card.tsx           # Card finanțare
│   │   ├── match-score.tsx          # Scor potrivire vizual
│   │   └── grant-filters.tsx        # Filtre (program, regiune, etc.)
│   ├── ai/
│   │   ├── ai-chat.tsx              # Chat panel
│   │   ├── ai-suggestion.tsx        # Sugestie inline
│   │   └── ai-generate-button.tsx   # Buton generare cu loading
│   ├── documente/
│   │   ├── document-upload.tsx      # Drag & drop upload
│   │   └── document-viewer.tsx      # Preview document
│   └── shared/
│       ├── data-table.tsx           # Tabel generic cu paginare
│       ├── search-input.tsx         # Căutare cu debounce
│       ├── date-picker-ro.tsx       # Calendar cu luni în română
│       ├── currency-input.tsx       # Input EUR cu format RO
│       └── empty-state.tsx          # Stare goală cu ilustrație
├── hooks/
│   ├── use-project.ts
│   ├── use-compliance.ts
│   ├── use-grants.ts
│   └── use-ai.ts
├── lib/
│   ├── api-client.ts                # Fetch wrapper cu auth
│   ├── i18n.ts                      # next-intl config
│   ├── validators.ts                # Zod schemas
│   └── utils/
│       ├── romanian.ts              # Diacritice, formatare
│       ├── currency.ts              # Format EUR/RON
│       └── dates.ts                 # Format date ro
└── messages/
    ├── ro.json
    └── en.json
```

---

## 4. AI Prompt Chains

### 4.1 Compliance Check Chain

```
┌─────────────────────────────────────────┐
│ Step 1: Collect Context                  │
│ - Load project sections                  │
│ - Identify call_id → load guide chunks   │
│ - Load relevant legislation chunks       │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│ Step 2: Per-Section Check                │
│ For each section:                        │
│   - Retrieve relevant guide chunks (RAG) │
│   - Retrieve relevant legislation (RAG)  │
│   - Prompt: "Verifică secțiunea X..."    │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│ Step 3: Cross-Section Validation         │
│ - Budget ↔ Activities consistency        │
│ - Indicators ↔ Objectives mapping        │
│ - Timeline feasibility                   │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│ Step 4: Compile Report                   │
│ - Aggregate issues, calculate score      │
│ - Format with references                 │
└─────────────────────────────────────────┘
```

**System Prompt (Compliance):**
```
Ești un expert în fonduri europene și legislație românească. Verifici conformitatea
proiectelor cu ghidurile solicitantului și legislația aplicabilă.

REGULI:
1. Răspunde DOAR în limba română.
2. Pentru fiecare problemă identificată, citează articolul/secțiunea exactă din ghid sau lege.
3. Clasifică fiecare element: CONFORM, ATENȚIE, sau NECONFORM.
4. Pentru ATENȚIE și NECONFORM, oferă o sugestie concretă de remediere.
5. NU inventa cerințe. Dacă nu găsești o cerință specifică în context, spune explicit.
6. Verifică: eligibilitate solicitant, activități eligibile, cheltuieli eligibile,
   indicatori, grup țintă, buget (plafoane), durată, parteneriat.

CONTEXT GHID SOLICITANT:
{guide_chunks}

LEGISLAȚIE RELEVANTĂ:
{legislation_chunks}

SECȚIUNEA DE VERIFICAT:
{project_section}
```

### 4.2 Proposal Generation Chain

```
┌─────────────────────────────────────────┐
│ Step 1: Analyze Input                    │
│ - Project metadata (type, budget, etc.)  │
│ - Organization profile                   │
│ - Call requirements                      │
│ - User instructions (dacă există)        │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│ Step 2: Generate Section Draft           │
│ - Use call-specific template             │
│ - Include evaluation criteria awareness  │
│ - Romanian formal/institutional style    │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│ Step 3: Quality Check                    │
│ - Verify SMART objectives               │
│ - Check budget-activity alignment        │
│ - Verify indicator targets               │
│ - Check word/character limits            │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│ Step 4: Polish & Format                  │
│ - Normalize diacritics                   │
│ - Format numbers (1.234,56)              │
│ - Add section headers per template       │
└─────────────────────────────────────────┘
```

**System Prompt (Generation – Context & Justificare):**
```
Ești un consultant experimentat în fonduri europene. Scrii secțiunea "Context și Justificare"
a unei cereri de finanțare.

STIL:
- Limbaj formal, instituțional, în limba română
- Propoziții clare, paragrafe structurate
- Referințe la date statistice și strategii relevante
- Aliniere cu obiectivele programului de finanțare

STRUCTURĂ OBLIGATORIE:
1. Contextul general (sector, tendințe, provocări)
2. Problema identificată (cu date concrete)
3. Nevoile grupului țintă
4. Justificarea intervenției propuse
5. Alinierea cu strategii (naționale, regionale, EU)

INFORMAȚII PROIECT:
- Organizație: {org_name} ({org_type}), {org_region}
- Domeniu: {caen_description}
- Titlu proiect: {project_title}
- Program: {program_name}
- Obiectiv specific apel: {call_objective}

CERINȚE DIN GHID:
{guide_context_section_chunks}

Generează secțiunea. Maxim {max_words} cuvinte.
```

### 4.3 Grant Matching Chain

```
Step 1: Build org profile vector (type, CAEN, region, size, budget range)
Step 2: Filter calls (status='deschis', eligible_types includes org_type)
Step 3: Score each call:
  - CAEN match: 30 points
  - Region match: 20 points
  - Budget range fit: 20 points
  - Org size fit: 15 points
  - Semantic similarity (org description ↔ call objectives): 15 points
Step 4: Sort by score, return top matches with explanations
```

---

## 5. Testing Strategy

### 5.1 Unit Tests (Vitest)
- **Coverage target:** >80%
- **Focus:** Validators (CUI, CAEN, IBAN), business logic, utils
- **Romanian-specific:** Diacritics normalization, number formatting, date formatting

```typescript
// Exemple teste
describe('validateCUI', () => {
  it('acceptă CUI valid', () => expect(validateCUI('12345678')).toBe(true));
  it('respinge CUI invalid', () => expect(validateCUI('00000000')).toBe(false));
  it('acceptă CUI cu prefix RO', () => expect(validateCUI('RO12345678')).toBe(true));
});

describe('normalizeDiacritics', () => {
  it('convertește sedilă în virgulă', () => {
    expect(normalize('Ţară')).toBe('Țară');
    expect(normalize('şcoală')).toBe('școală');
  });
});
```

### 5.2 Integration Tests (Vitest + Testcontainers)
- DB operations cu PostgreSQL real (container)
- RAG pipeline end-to-end cu Qdrant container
- Auth flow complet
- File upload → OCR → extraction pipeline

### 5.3 E2E Tests (Playwright)
- **Flows testate:**
  1. Register → Create org → Create project → Fill sections → Compliance check → Export
  2. Grant matching → Start project from call → Generate proposal
  3. Document upload → AI analysis
- **Locales:** Teste rulate în ambele limbi (ro, en)

### 5.4 Legal Compliance Tests
```typescript
describe('Compliance Engine', () => {
  // Test cu proiecte știute ca eligibile
  it('aprobă proiect eligibil complet', async () => {
    const report = await checkCompliance(validProject, callPOCIDIF);
    expect(report.items.filter(i => i.status === 'neconform')).toHaveLength(0);
  });

  // Test cu proiecte știute ca neeligibile
  it('detectează organizație neeligibilă', async () => {
    const report = await checkCompliance(ineligibleOrgProject, callPOCIDIF);
    expect(report.items).toContainEqual(
      expect.objectContaining({ section: 'eligibilitate', status: 'neconform' })
    );
  });

  // Test buget peste plafon
  it('detectează buget peste plafonul maxim', async () => {
    const report = await checkCompliance(overBudgetProject, callPOCIDIF);
    expect(report.items).toContainEqual(
      expect.objectContaining({ section: 'buget', status: 'neconform' })
    );
  });

  // Golden set: 50 proiecte cu rezultat cunoscut
  it.each(goldenSet)('golden set: %s', async (name, project, call, expected) => {
    const report = await checkCompliance(project, call);
    expect(report.overall_score).toBeGreaterThanOrEqual(expected.min_score);
    expect(report.overall_score).toBeLessThanOrEqual(expected.max_score);
  });
});
```

### 5.5 Performance Tests (k6)
```javascript
// Targets
// - API response < 200ms (p95) for CRUD
// - AI compliance check < 15s (p95)
// - AI generation < 20s (p95)
// - 100 concurrent users without degradation
```

### 5.6 Security Tests
- OWASP ZAP scan (automated in CI)
- Dependency audit (`npm audit`, Snyk)
- Penetration test (manual, before launch)
- GDPR checklist review (quarterly)

---

## 6. DevOps & CI/CD

### GitHub Actions Pipeline
```yaml
# .github/workflows/ci.yml
on: [push, pull_request]

jobs:
  lint:        # ESLint + Prettier
  typecheck:   # tsc --noEmit
  unit-test:   # vitest run
  integration: # vitest + testcontainers
  e2e:         # playwright (ro + en)
  security:    # npm audit + ZAP baseline
  build:       # docker build
  deploy-staging:  # auto on main
  deploy-prod:     # manual approval
```

### Environment Strategy
| Env | Trigger | DB | AI Model |
|-----|---------|-----|----------|
| dev | local | Docker PG | Mock / local LLM |
| staging | push to main | Hetzner PG (separate) | Real models (low limits) |
| prod | manual release | Hetzner PG (production) | Real models (full limits) |

---

## 7. Monitoring & Observability

### Dashboards (Grafana)
1. **Platform Health:** Request rate, error rate, latency (p50/p95/p99)
2. **AI Performance:** Token usage, response times, error rates per model
3. **Business Metrics:** Users, projects, compliance checks, exports
4. **Cost Tracking:** LLM API spend, infrastructure costs

### Alerts
| Alert | Condition | Channel |
|-------|-----------|---------|
| High error rate | >5% 5xx in 5min | Slack + Email |
| AI service down | 3 consecutive failures | Slack + PagerDuty |
| DB connections | >80% pool used | Slack |
| Disk space | >85% | Email |
| Cost spike | LLM costs >150% daily average | Email |
| Certificate expiry | <14 days | Email |
