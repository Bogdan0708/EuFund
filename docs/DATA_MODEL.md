# DATA_MODEL.md – Structuri de Date FondEU

## 1. PostgreSQL Schema

### 1.1 Users & Organizations

```sql
-- Enums
CREATE TYPE user_role AS ENUM ('admin', 'org_admin', 'project_manager', 'viewer');
CREATE TYPE org_type AS ENUM ('srl', 'sa', 'pfa', 'ong', 'uat', 'instituție_publică', 'altul');
CREATE TYPE org_size AS ENUM ('micro', 'mică', 'medie', 'mare');

-- Users
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255),          -- null for SSO-only users
    full_name       VARCHAR(255) NOT NULL,
    phone           VARCHAR(20),
    preferred_lang  VARCHAR(5) DEFAULT 'ro',
    avatar_url      VARCHAR(500),
    email_verified  BOOLEAN DEFAULT FALSE,
    mfa_enabled     BOOLEAN DEFAULT FALSE,
    mfa_secret      VARCHAR(255),
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ             -- soft delete
);

-- Organizations
CREATE TABLE organizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(500) NOT NULL,
    cui             VARCHAR(20) UNIQUE,     -- Cod Unic de Înregistrare
    reg_com         VARCHAR(30),            -- Nr. Registrul Comerțului (J12/345/2020)
    org_type        org_type NOT NULL,
    org_size        org_size,
    caen_primary    VARCHAR(10),            -- Cod CAEN principal
    caen_secondary  VARCHAR(10)[],          -- Coduri CAEN secundare
    address         JSONB,                  -- {street, city, county(județ), postal_code}
    nuts_region     VARCHAR(10),            -- NUTS2 region code (RO11, RO12, etc.)
    legal_rep_name  VARCHAR(255),
    legal_rep_role  VARCHAR(100),           -- ex: "Administrator", "Director General"
    contact_email   VARCHAR(255),
    contact_phone   VARCHAR(20),
    website         VARCHAR(500),
    founded_date    DATE,
    employee_count  INTEGER,
    annual_revenue  DECIMAL(15,2),          -- în RON
    is_vat_payer    BOOLEAN DEFAULT TRUE,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_org_cui ON organizations(cui);
CREATE INDEX idx_org_type ON organizations(org_type);
CREATE INDEX idx_org_region ON organizations(nuts_region);

-- Organization Members
CREATE TABLE org_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    user_id         UUID NOT NULL REFERENCES users(id),
    role            user_role NOT NULL DEFAULT 'viewer',
    invited_by      UUID REFERENCES users(id),
    joined_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, user_id)
);
```

### 1.2 Funding Programs & Calls

```sql
CREATE TYPE program_status AS ENUM ('activ', 'inactiv', 'arhivat');
CREATE TYPE call_status AS ENUM ('previzionat', 'deschis', 'în_evaluare', 'închis', 'anulat');

-- Funding Programs (POCIDIF, POEO, PNRR, etc.)
CREATE TABLE funding_programs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(50) UNIQUE NOT NULL,  -- 'POCIDIF', 'POEO', 'PNRR'
    name_ro         VARCHAR(500) NOT NULL,
    name_en         VARCHAR(500),
    description_ro  TEXT,
    description_en  TEXT,
    managing_auth   VARCHAR(255),          -- Autoritatea de Management
    fund_source     VARCHAR(50),           -- 'ERDF', 'ESF+', 'CF', 'RRF'
    total_budget    DECIMAL(15,2),         -- EUR
    period_start    DATE,
    period_end      DATE,
    website_url     VARCHAR(500),
    status          program_status DEFAULT 'activ',
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Calls for Proposals (Apeluri de Proiecte)
CREATE TABLE calls_for_proposals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id      UUID NOT NULL REFERENCES funding_programs(id),
    call_code       VARCHAR(100) NOT NULL,      -- ex: 'POCIDIF/2.1/1/2025'
    title_ro        VARCHAR(1000) NOT NULL,
    title_en        VARCHAR(1000),
    description_ro  TEXT,
    objective       TEXT,                        -- Obiectivul specific
    eligible_types  org_type[] NOT NULL,         -- Tipuri organizații eligibile
    eligible_regions VARCHAR(10)[],              -- NUTS2 codes, null = toate
    eligible_caen   VARCHAR(10)[],               -- Coduri CAEN eligibile
    budget_total    DECIMAL(15,2),               -- EUR buget alocat apelului
    budget_min      DECIMAL(15,2),               -- EUR min per proiect
    budget_max      DECIMAL(15,2),               -- EUR max per proiect
    cofinancing_rate DECIMAL(5,2),               -- % cofinanțare beneficiar
    duration_min    INTEGER,                     -- luni
    duration_max    INTEGER,                     -- luni
    submission_start TIMESTAMPTZ,
    submission_end   TIMESTAMPTZ,
    guide_url       VARCHAR(500),                -- Link ghid solicitant
    guide_doc_id    UUID REFERENCES documents(id),
    status          call_status DEFAULT 'previzionat',
    is_competitive  BOOLEAN DEFAULT TRUE,        -- competitiv vs. non-competitiv
    evaluation_criteria JSONB,                   -- [{name, weight, description}]
    eligible_expenses JSONB,                     -- categorii cheltuieli eligibile
    state_aid_scheme VARCHAR(255),               -- schema ajutor de stat
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_calls_program ON calls_for_proposals(program_id);
CREATE INDEX idx_calls_status ON calls_for_proposals(status);
CREATE INDEX idx_calls_deadline ON calls_for_proposals(submission_end);
CREATE INDEX idx_calls_regions ON calls_for_proposals USING GIN(eligible_regions);
```

### 1.3 Projects

```sql
CREATE TYPE project_status AS ENUM (
    'ciornă', 'în_lucru', 'verificare', 'finalizat', 'depus', 'aprobat', 'respins', 'arhivat'
);

CREATE TABLE projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    call_id         UUID REFERENCES calls_for_proposals(id),
    created_by      UUID NOT NULL REFERENCES users(id),

    -- Project Info
    title           VARCHAR(1000) NOT NULL,
    acronym         VARCHAR(50),
    status          project_status DEFAULT 'ciornă',
    current_version INTEGER DEFAULT 1,

    -- Dates
    start_date      DATE,
    end_date        DATE,
    duration_months INTEGER,

    -- Budget
    total_budget    DECIMAL(15,2),          -- EUR
    eu_contribution DECIMAL(15,2),
    national_contrib DECIMAL(15,2),
    own_contrib     DECIMAL(15,2),          -- cofinanțare proprie

    -- Content sections (JSONB for flexibility)
    section_summary         TEXT,            -- Rezumat
    section_context         TEXT,            -- Context și justificare
    section_objectives      JSONB,           -- [{type, description, indicators}]
    section_methodology     JSONB,           -- [{activity, sub_activities, responsible, timeline}]
    section_budget          JSONB,           -- [{category, subcategory, unit, quantity, unit_price, total}]
    section_indicators      JSONB,           -- [{code, name, baseline, target, source}]
    section_sustainability  TEXT,            -- Plan de sustenabilitate
    section_partnership     JSONB,           -- [{org_name, role, contribution}]
    section_risks           JSONB,           -- [{risk, probability, impact, mitigation}]
    section_custom          JSONB DEFAULT '{}', -- câmpuri specifice per program

    -- Compliance
    compliance_score        DECIMAL(5,2),    -- 0-100
    last_compliance_check   TIMESTAMPTZ,
    compliance_report_id    UUID,

    -- Matching
    match_score             DECIMAL(5,2),    -- 0-100 potrivire cu apelul

    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_projects_org ON projects(org_id);
CREATE INDEX idx_projects_call ON projects(call_id);
CREATE INDEX idx_projects_status ON projects(status);

-- Project Versions (history)
CREATE TABLE project_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id),
    version_number  INTEGER NOT NULL,
    snapshot        JSONB NOT NULL,          -- full project state
    changed_by      UUID NOT NULL REFERENCES users(id),
    change_summary  TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, version_number)
);

-- Project Comments / Collaboration
CREATE TABLE project_comments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id),
    user_id         UUID NOT NULL REFERENCES users(id),
    section         VARCHAR(100),            -- secțiunea comentată
    content         TEXT NOT NULL,
    resolved        BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 1.4 Legislation

```sql
CREATE TYPE legislation_type AS ENUM (
    'regulament_eu', 'directivă_eu', 'oug', 'hg', 'lege', 'ordin', 'ghid', 'instrucțiune'
);

CREATE TABLE legislation_documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ext_id          VARCHAR(255) UNIQUE,     -- CELEX number or RO identifier
    type            legislation_type NOT NULL,
    title_ro        TEXT NOT NULL,
    title_en        TEXT,
    issuer          VARCHAR(255),            -- ex: 'Parlamentul European', 'Guvernul României'
    number          VARCHAR(50),             -- ex: 'OUG 66/2011'
    published_date  DATE,
    effective_date  DATE,
    expiry_date     DATE,
    source_url      VARCHAR(500),
    full_text       TEXT,                    -- text complet (dacă disponibil)
    relevance_tags  VARCHAR(100)[],          -- ['achiziții', 'ajutor_stat', 'eligibilitate']
    programs        VARCHAR(50)[],           -- programele afectate
    is_active       BOOLEAN DEFAULT TRUE,
    superseded_by   UUID REFERENCES legislation_documents(id),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_legislation_type ON legislation_documents(type);
CREATE INDEX idx_legislation_active ON legislation_documents(is_active);
CREATE INDEX idx_legislation_tags ON legislation_documents USING GIN(relevance_tags);

-- Legislation amendments tracking
CREATE TABLE legislation_amendments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_id     UUID NOT NULL REFERENCES legislation_documents(id),
    amendment_id    UUID NOT NULL REFERENCES legislation_documents(id),
    summary_ro      TEXT,
    affected_articles VARCHAR(50)[],
    effective_date  DATE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 1.5 Documents

```sql
CREATE TYPE doc_type AS ENUM (
    'ghid_solicitant', 'bilanț', 'certificat', 'aviz', 'studiu_fezabilitate',
    'plan_afaceri', 'deviz', 'acord_parteneriat', 'declarație', 'altul'
);

CREATE TABLE documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID REFERENCES organizations(id),
    project_id      UUID REFERENCES projects(id),
    uploaded_by     UUID NOT NULL REFERENCES users(id),
    doc_type        doc_type NOT NULL,
    filename        VARCHAR(500) NOT NULL,
    mime_type       VARCHAR(100),
    file_size       BIGINT,                 -- bytes
    storage_path    VARCHAR(500) NOT NULL,   -- MinIO/S3 path
    encryption_key_id VARCHAR(100),          -- reference to Vault key
    ocr_text        TEXT,                    -- extracted text
    ai_summary      TEXT,                    -- AI-generated summary
    extracted_data  JSONB,                   -- structured data extracted by AI
    checksum_sha256 VARCHAR(64),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_documents_org ON documents(org_id);
CREATE INDEX idx_documents_project ON documents(project_id);
```

### 1.6 AI Interactions

```sql
CREATE TABLE compliance_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id),
    generated_by    UUID NOT NULL REFERENCES users(id),
    overall_score   DECIMAL(5,2),            -- 0-100
    items           JSONB NOT NULL,          -- [{section, status, message, severity, law_ref}]
    -- status: 'conform', 'atenție', 'neconform'
    -- severity: 'info', 'warning', 'error'
    model_used      VARCHAR(100),
    tokens_used     INTEGER,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ai_conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    project_id      UUID REFERENCES projects(id),
    context_type    VARCHAR(50),             -- 'compliance', 'generation', 'matching', 'general'
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ai_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES ai_conversations(id),
    role            VARCHAR(20) NOT NULL,    -- 'user', 'assistant', 'system'
    content         TEXT NOT NULL,
    model_used      VARCHAR(100),
    tokens_input    INTEGER,
    tokens_output   INTEGER,
    sources         JSONB,                   -- [{doc_id, chunk_id, relevance_score}]
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 1.7 Notifications

```sql
CREATE TYPE notif_type AS ENUM (
    'deadline', 'apel_nou', 'legislație_update', 'compliance', 'system', 'colaborare'
);

CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    type            notif_type NOT NULL,
    title_ro        VARCHAR(500) NOT NULL,
    body_ro         TEXT,
    link            VARCHAR(500),
    is_read         BOOLEAN DEFAULT FALSE,
    sent_email      BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notif_user_unread ON notifications(user_id, is_read) WHERE NOT is_read;
```

### 1.8 Audit Log

```sql
CREATE TABLE audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id),
    action          VARCHAR(100) NOT NULL,   -- 'project.create', 'document.upload', etc.
    resource_type   VARCHAR(50),
    resource_id     UUID,
    old_value       JSONB,
    new_value       JSONB,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_created ON audit_log(created_at);
```

---

## 2. Vector Database Schema (Qdrant)

### 2.1 Collections

```json
// Collection: eu_regulations
{
  "name": "eu_regulations",
  "vectors": {
    "size": 768,
    "distance": "Cosine"
  },
  "payload_schema": {
    "doc_id": "uuid",
    "doc_title": "keyword",
    "chunk_index": "integer",
    "article_number": "keyword",
    "chapter": "keyword",
    "text_ro": "text",
    "text_en": "text",
    "regulation_number": "keyword",
    "effective_date": "datetime",
    "tags": "keyword[]",
    "programs": "keyword[]"
  }
}

// Collection: ro_legislation
{
  "name": "ro_legislation",
  "vectors": {
    "size": 768,
    "distance": "Cosine"
  },
  "payload_schema": {
    "doc_id": "uuid",
    "doc_type": "keyword",
    "doc_number": "keyword",
    "article_number": "keyword",
    "text_ro": "text",
    "issuer": "keyword",
    "effective_date": "datetime",
    "is_active": "bool",
    "tags": "keyword[]"
  }
}

// Collection: applicant_guides
{
  "name": "applicant_guides",
  "vectors": {
    "size": 768,
    "distance": "Cosine"
  },
  "payload_schema": {
    "doc_id": "uuid",
    "call_id": "uuid",
    "program": "keyword",
    "section": "keyword",
    "page_number": "integer",
    "text_ro": "text",
    "guide_version": "keyword",
    "published_date": "datetime"
  }
}
```

---

## 3. API Response Formats

### 3.1 Standard Envelope

```typescript
interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
  errors?: ApiError[];
}

interface ApiError {
  code: string;        // 'VALIDATION_ERROR', 'NOT_FOUND', etc.
  message_ro: string;  // "Câmpul 'titlu' este obligatoriu."
  message_en: string;  // "Field 'title' is required."
  field?: string;
  details?: any;
}
```

### 3.2 Key Response Examples

```typescript
// GET /api/v1/projects/:id
interface ProjectResponse {
  id: string;
  title: string;
  acronym: string;
  status: ProjectStatus;
  call: {
    id: string;
    code: string;
    title_ro: string;
    program: string;
    submission_end: string;
  } | null;
  organization: {
    id: string;
    name: string;
    cui: string;
  };
  budget: {
    total: number;
    eu_contribution: number;
    own_contribution: number;
    currency: 'EUR';
  };
  compliance: {
    score: number | null;
    last_check: string | null;
    issues_count: { conform: number; atenție: number; neconform: number };
  };
  progress: number;     // 0-100, completare secțiuni
  created_at: string;
  updated_at: string;
}

// POST /api/v1/ai/compliance-check
interface ComplianceCheckResponse {
  report_id: string;
  overall_score: number;
  items: ComplianceItem[];
  disclaimer: string;   // "Verificare automată. Consultați ghidul oficial."
}

interface ComplianceItem {
  section: string;       // 'obiective', 'buget', 'indicatori'
  status: 'conform' | 'atenție' | 'neconform';
  message_ro: string;
  suggestion_ro: string;
  law_references: {
    doc_title: string;
    article: string;
    url: string;
  }[];
}

// GET /api/v1/grants/match
interface GrantMatchResponse {
  matches: {
    call: CallSummary;
    score: number;           // 0-100
    match_reasons: string[]; // ["Domeniul CAEN corespunde", "Regiunea eligibilă"]
    warnings: string[];      // ["Bugetul depășește plafonul maxim"]
  }[];
}
```

---

## 4. Localization Structure

### 4.1 File Structure (next-intl)

```
src/
  messages/
    ro.json        # Traduceri complete română
    en.json        # Traduceri complete engleză
  lib/
    i18n.ts        # Config next-intl
```

### 4.2 Translation Keys

```json
// ro.json (excerpt)
{
  "common": {
    "save": "Salvează",
    "cancel": "Anulează",
    "delete": "Șterge",
    "edit": "Editează",
    "loading": "Se încarcă...",
    "error": "A apărut o eroare",
    "confirm": "Confirmă",
    "back": "Înapoi",
    "next": "Următorul",
    "search": "Caută",
    "filter": "Filtrează",
    "export": "Exportă",
    "download": "Descarcă"
  },
  "auth": {
    "login": "Autentificare",
    "register": "Înregistrare",
    "forgotPassword": "Am uitat parola",
    "email": "Adresă de email",
    "password": "Parolă",
    "confirmPassword": "Confirmă parola"
  },
  "project": {
    "new": "Proiect Nou",
    "title": "Titlul Proiectului",
    "acronym": "Acronim",
    "status": {
      "ciornă": "Ciornă",
      "în_lucru": "În lucru",
      "verificare": "În verificare",
      "finalizat": "Finalizat",
      "depus": "Depus",
      "aprobat": "Aprobat",
      "respins": "Respins"
    },
    "sections": {
      "summary": "Rezumat",
      "context": "Context și Justificare",
      "objectives": "Obiective",
      "methodology": "Metodologie",
      "budget": "Buget",
      "indicators": "Indicatori",
      "sustainability": "Sustenabilitate",
      "partnership": "Parteneriat",
      "risks": "Riscuri",
      "annexes": "Anexe"
    }
  },
  "compliance": {
    "check": "Verifică Conformitatea",
    "score": "Scor de conformitate",
    "conform": "Conform",
    "warning": "Atenție",
    "nonConform": "Neconform",
    "disclaimer": "Verificare generată automat. Consultați ghidul oficial al solicitantului."
  },
  "grants": {
    "available": "Finanțări Disponibile",
    "matchScore": "Scor de potrivire",
    "deadline": "Termen limită",
    "budget": "Buget disponibil",
    "startProject": "Începe Proiect"
  },
  "validation": {
    "required": "Câmpul «{field}» este obligatoriu.",
    "minLength": "Câmpul «{field}» trebuie să aibă minimum {min} caractere.",
    "maxLength": "Câmpul «{field}» poate avea maximum {max} caractere.",
    "invalidCUI": "CUI-ul introdus nu este valid.",
    "invalidCAEN": "Codul CAEN nu este valid."
  }
}
```

### 4.3 Romanian Text Handling

```typescript
// Romanian-specific text utilities
const romanianConfig = {
  // Diacritice corecte (ș, ț cu virgulă, nu sedilă)
  normalizeDiacritics: (text: string) =>
    text
      .replace(/ş/g, 'ș').replace(/Ş/g, 'Ș')  // sedilă → virgulă
      .replace(/ţ/g, 'ț').replace(/Ţ/g, 'Ț'),

  // PostgreSQL collation
  collation: 'ro_RO.utf8',

  // Number formatting (1.234,56 in RO)
  numberFormat: { locale: 'ro-RO', currency: 'EUR' },

  // Date formatting (13 februarie 2026)
  dateFormat: { locale: 'ro-RO', options: { day: 'numeric', month: 'long', year: 'numeric' } },

  // County list (județe) for address forms
  counties: [
    'Alba', 'Arad', 'Argeș', 'Bacău', 'Bihor', 'Bistrița-Năsăud',
    'Botoșani', 'Brașov', 'Brăila', 'București', 'Buzău', 'Caraș-Severin',
    'Călărași', 'Cluj', 'Constanța', 'Covasna', 'Dâmbovița', 'Dolj',
    'Galați', 'Giurgiu', 'Gorj', 'Harghita', 'Hunedoara', 'Ialomița',
    'Iași', 'Ilfov', 'Maramureș', 'Mehedinți', 'Mureș', 'Neamț',
    'Olt', 'Prahova', 'Satu Mare', 'Sălaj', 'Sibiu', 'Suceava',
    'Teleorman', 'Timiș', 'Tulcea', 'Vaslui', 'Vâlcea', 'Vrancea'
  ],

  // NUTS2 Regions
  nuts2: {
    'RO11': 'Nord-Vest', 'RO12': 'Centru', 'RO21': 'Nord-Est',
    'RO22': 'Sud-Est', 'RO31': 'Sud-Muntenia', 'RO32': 'București-Ilfov',
    'RO41': 'Sud-Vest Oltenia', 'RO42': 'Vest'
  }
};
```

---

## 5. Row-Level Security (RLS)

```sql
-- Enable RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Users can only see projects from their organization
CREATE POLICY projects_org_isolation ON projects
    USING (org_id IN (
        SELECT om.org_id FROM org_members om WHERE om.user_id = current_setting('app.user_id')::uuid
    ));

-- Documents: same org isolation
CREATE POLICY documents_org_isolation ON documents
    USING (org_id IN (
        SELECT om.org_id FROM org_members om WHERE om.user_id = current_setting('app.user_id')::uuid
    ));
```

---

## 6. Migrations Strategy

- **Tool:** Drizzle ORM migrations (TypeScript-native)
- **Naming:** `YYYYMMDD_HHMMSS_description.ts`
- **Environments:** dev → staging → production
- **Rollback:** Every migration has `down()` function
- **Seed data:** Funding programs, NUTS regions, CAEN codes, legislation index
