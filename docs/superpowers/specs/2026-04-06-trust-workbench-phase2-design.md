# Phase 2 — Trust Workbench: Call Freshness + Submission Dossier

## Overview

Two features that complete the trust layer built in Phase 1:

1. **Call freshness verification** — during Step 2 (match), verify that matched funding calls are still open and current via a web check before the user commits to one.

2. **Submission dossier** — after Step 5 (build), generate all required forms/declarations for the matched call, save the full project as organized files (proposal sections + forms + user uploads), and present a unified checklist on the project page so the user knows exactly what to complete, obtain, and submit.

## Non-Goals

- No automated legal analysis of proposal section content
- No per-section compliance scoring
- No AI-powered GDPR/ANI/state-aid detection in the text
- No document versioning for forms (user prints the latest)

## Design Principles

1. **Template-first legal forms** — legal declarations and standard forms use curated Romanian templates with variable interpolation, not freeform AI generation. AI is used only to classify which forms apply, extract annex requirements from the ghid, and prefill known fields. This eliminates hallucination risk for legally binding text.

2. **Provenance** — every trust-layer output carries traceability metadata: which provider checked freshness, when, based on which URL, what evidence. Generated documents record whether they came from a template or were AI-classified. This makes support/debugging possible when a user disputes a result.

3. **Idempotent generation** — document IDs are deterministic (`doc-{scope}-{slugified-title}`), generation is safe to retry, and there is one canonical source of truth per data type. Re-running generation for the same project produces the same file set with updated content, never duplicates.

4. **Separated availability vs completion** — document availability (`generated`, `needs_fill`, `external_required`) is system-managed. User completion state (`not_started`, `completed`) is user-managed. These are independent axes so neither blocks or overwrites the other.

---

## 1. Call Freshness Check

### Where

Inside `matchAgent` (`app/src/lib/ai/orchestrator/agents/match.ts`), after the Gemini scoring pass produces `matchedCalls[]`, before returning the checkpoint.

### How

For the top 3 matched calls that have a `sourceUrl`, make a single Perplexity `sonar` call asking whether each call is still open, if the deadline has changed, and if there are amendments. Parse the response into per-call freshness results.

**Fallback**: If Perplexity is unavailable, use Gemini Flash (latest version) with the same prompt. Same gateway call pattern — not a tool call, just another `gateway.generate()` inside the match agent.

**Skip condition**: If the calls came from a Perplexity web search in the same step (the no-RAG-results path), skip the freshness check — the data is already live.

**Failure mode**: If both providers fail, set `status: 'unknown'` with a warning. Never block the workflow for a freshness check.

### Type Change

Add an optional `freshness` field to the `MatchedCall` interface in `types.ts`:

```ts
export interface MatchedCall {
  // ... existing fields ...
  freshness?: {
    status: 'verified' | 'stale' | 'unknown'
    checkedAt: string
    currentDeadline?: string
    warnings: string[]
    provenance: {
      provider: string        // 'perplexity' | 'gemini' | 'skipped'
      model: string           // 'sonar' | 'gemini-2.5-flash' etc.
      sourceUrl: string       // the URL that was checked
      evidence: string        // summary of what the provider found
    }
  }
}
```

Optional so existing sessions without freshness data don't break.

### UI

The checkpoint card in `asistent-ai/page.tsx` `CallsTabContent` shows a small badge per call:
- `verified` → green dot + "Verificat"
- `stale` → orange warning + warning text (e.g., "Termen prelungit la 01.09.2026")
- `unknown` → gray "?" + "Nu s-a putut verifica"

Conditional `<span>` inside the existing card. No new components.

---

## 2. Submission Dossier

### Data Model

New type in `types.ts`:

```ts
export interface SubmissionDocument {
  id: string                                      // Deterministic: "doc-{scope}-{slugified-title}"
  title: string                                    // "Declarație de minimis"
  content: string                                  // Form text with variables interpolated
  category: 'declaration' | 'certificate' | 'annex' | 'form'
  scope: 'general' | 'call_specific'
  order: number

  // Availability — system-managed, describes what the system produced
  availability: 'generated' | 'needs_fill' | 'external_required'
  instructions: string                             // "Semnați și ștampilați" / "Obțineți de la ONRC"
  sourceAnnex: string                              // Which blueprint annex this maps to

  // Completion — user-managed, describes what the user has done
  userStatus: 'not_started' | 'completed'
  userStatusAt: string | null                      // When the user last changed status

  // Provenance — how this document was identified and produced
  provenance: {
    requirementSource: 'curated_list' | 'ai_classified'  // How we knew this was needed
    contentSource: 'template' | 'none'                    // Where the form content came from
    templateId?: string                                    // Which template (if contentSource = 'template')
    templateVersion?: string                               // e.g. "2024-Q1" — tracks template updates over time
    classifiedFrom?: string                                // Which annex text triggered this (if ai_classified)
    confidence?: number                                    // 0-1, only set when requirementSource = 'ai_classified'
    reviewRequired: boolean                                // true when AI-classified without a matched template
    generatedAt: string
  }
}
```

**Availability** (system-managed):
- `generated` — fully produced from a template with all variables interpolated. User can print/download.
- `needs_fill` — produced from a template but has `[___]` placeholders the user must fill in (signature, stamp, specific data). `instructions` says exactly what.
- `external_required` — can't be generated. Must be obtained from an institution (e.g., "Certificat constatator ONRC — obțineți de la registrul.onrc.ro"). No file generated.

**User status** (user-managed, independent axis):
- `not_started` — user hasn't marked this done yet
- `completed` — user has checked this off

These are independent: a `generated` document can be `not_started` (user hasn't printed it yet) or `completed`. An `external_required` document starts `not_started` and the user marks `completed` when they've obtained it.

**Provenance** (two independent axes):

`requirementSource` — how the system knew this document was needed:
- `curated_list` — from the hardcoded general requirements list. Always known, always required.
- `ai_classified` — AI analyzed the call's mandatory annexes and determined this form is needed. Carries a `confidence` score (0-1). When confidence is below 0.7 or no matching template exists, `reviewRequired` is set to `true` so the UI can flag it for the user.

`contentSource` — where the form content came from:
- `template` — content produced from a curated template with variable interpolation. `templateId` and `templateVersion` identify which template at which revision.
- `none` — no content generated (external documents the user must obtain).

These are independent: an `ai_classified` requirement can still have `contentSource: 'template'` if a matching template was found. An `ai_classified` requirement with no matching template gets `contentSource: 'none'`, `availability: 'external_required'`, and `reviewRequired: true`.

**Template versioning**: Each template in `form-templates.ts` carries a `version` string (e.g., `"2024-Q1"`). This is stamped into `provenance.templateVersion` at generation time. When templates are updated (regulation changes), regeneration produces new content but the `templateVersion` field makes it clear which version was used. This is lightweight internal metadata — not user-facing version history.

**Deterministic IDs**: `id = "doc-{scope}-{slugifiedTitle}"`. Running generation twice for the same project produces the same IDs. Upsert semantics — existing rows are updated, never duplicated.

**Scope meanings:**
- `general` — standard EU requirements that apply to every project (GDPR, anti-fraud, publicity, beneficial ownership)
- `call_specific` — required by the specific call's ghid/mandatory annexes

### Source of Truth

**Single canonical location**: `project_documents.metadata.submissionDocuments` is the source of truth for the structured `SubmissionDocument[]` array. This is where the project page reads from and where user completion state is updated.

The workflow session context (`workflow_sessions.context`) holds `submissionDocuments` only as a transient working copy during generation. Once the project is created and the array is written to `project_documents.metadata`, the session copy is not read again.

This avoids dual-write drift: the session owns the data during the workflow, `project_documents` owns it after completion. No sync needed between the two.

### Two Sources for Requirements

**General requirements** — a curated constant array in `app/src/lib/compliance/general-requirements.ts`. Stable list that changes with EU regulation updates (code change). Covers:
- Declarație GDPR / Legea 190 privind prelucrarea datelor
- Declarație anti-fraudă
- Obligații de publicitate (Regulamentul UE 2021/1060, Anexa IX)
- Declarație beneficiar real
- Other standard forms required by all Romanian EU-funded projects

**Call-specific requirements** — extracted from `CallBlueprint.normalized.mandatoryAnnexes` plus AI analysis of the ghid text. Varies per call. Examples:
- Declarație de minimis / GBER
- Grilă de eligibilitate
- Formular de buget detaliat
- Declarație ANI conflict de interese

### Document Generation — Template-First

New files:
- `app/src/lib/compliance/general-requirements.ts` — curated constant array of general EU form requirements
- `app/src/lib/compliance/form-templates.ts` — curated Romanian legal form templates with `{{variable}}` placeholders
- `app/src/lib/ai/orchestrator/agents/documents.ts` — orchestration function

**Templates**: Each template is a string constant with the full Romanian legal text and `{{variabile}}` interpolation points:

```ts
export interface FormTemplate {
  templateId: string                    // e.g. "tpl-declaratie-minimis"
  version: string                       // e.g. "2024-Q1" — bumped when template text changes
  title: string                         // "Declarație privind ajutoarele de minimis"
  category: SubmissionDocument['category']
  scope: 'general' | 'call_specific'
  availability: 'generated' | 'needs_fill'
  instructions: string
  bodyTemplate: string                  // Romanian legal text with {{orgName}}, {{cui}}, etc.
  variables: string[]                   // Required interpolation variables
  matchesAnnex?: RegExp                 // Pattern to match against mandatoryAnnexes entries
}
```

General forms (GDPR, anti-fraud, publicity, beneficial ownership) have hardcoded templates — these are standard across all Romanian EU programs. Call-specific forms that are common (de minimis, ANI, eligibility grid) also have templates, matched to blueprint annexes via `matchesAnnex` patterns.

**The `generateSubmissionDocuments()` function**:

1. **Collect general requirements** — iterate `general-requirements.ts`, produce one `SubmissionDocument` per entry using the curated template. Interpolate variables from org/project context (name, CUI, project title, program, budget).

2. **Match call-specific requirements** — iterate `CallBlueprint.normalized.mandatoryAnnexes`. For each annex:
   - If a template exists whose `matchesAnnex` pattern matches → use the template (provenance: `template`)
   - If no template matches → make a Gemini Flash call to classify the annex and determine: title, category, availability, and instructions. The form *content* is not AI-generated; the AI only decides *what* is needed and writes the `instructions` field. Availability is set to `external_required` or `needs_fill` depending on classification. (provenance: `ai_classified`)

3. **Assign deterministic IDs** — `id = "doc-{scope}-{slugifiedTitle}"`. If a document with this ID already exists in `project_documents.metadata`, update it (upsert). Never duplicate.

4. **Convert to DOCX** — for documents with `availability !== 'external_required'`, generate a DOCX using the existing `generateDocx` infrastructure. Save to storage as a `project_files` row.

5. **Persist** — write the full `SubmissionDocument[]` array to `project_documents.metadata.submissionDocuments`.

**What AI does NOT do**: Generate legal form text. All legally binding content comes from curated templates. AI only classifies which call-specific forms are needed and extracts instructions for forms without templates.

**What AI DOES**: Read the mandatory annexes list and decide which template to use, or if no template exists, produce a title + instructions for the user to source the document externally.

### When It Runs

After Step 5 completes, inside `engine.ts` at the completion block (lines 295-356). The flow:

1. Project + `project_documents` rows are created (existing)
2. Proposal section DOCX files are generated and saved to storage (NEW)
3. `generateSubmissionDocuments()` runs (NEW)
4. `done` SSE event fires with `projectId`

The sequence inside the completion block:

1. Create project + `project_documents` rows (existing code, unchanged)
2. Generate proposal section DOCX files and save to storage as `project_files`
3. Send `done` SSE event with `projectId` (user sees proposal immediately)
4. Run `generateSubmissionDocuments()` — streams `step_progress` events like "Se generează formularele de depunere..."
5. Save generated forms to storage as `project_files`
6. Send a final `section_updated`-style event so the client knows forms are ready

Steps 4-6 run after `done` so the user isn't blocked waiting for forms. The project page loads forms from `project_files` on each visit, so they appear as soon as they're saved.

### File Organization

All generated files are saved as `project_files` rows with `category: 'generated'` and organized `storagePath`:

```
projects/{projectId}/
├── propunere/
│   ├── 01-rezumat-executiv.docx
│   ├── 02-context-si-justificare.docx
│   ├── 03-obiective.docx
│   ├── 04-metodologie.docx
│   ├── 05-buget.docx
│   └── ...                              # One DOCX per proposal section
├── formulare/
│   ├── generale/
│   │   ├── declaratie-gdpr.docx
│   │   ├── declaratie-anti-frauda.docx
│   │   ├── obligatii-publicitate.docx
│   │   └── declaratie-beneficiar-real.docx
│   └── apel/
│       ├── declaratie-minimis.docx
│       ├── grila-eligibilitate.docx
│       └── ...
└── incarcate/
    └── ...                              # User uploads (existing)
```

Section files are named `{order}-{slugified-title}.docx`.
Form files are named by slugified form title.

**No new DB table**. Uses existing `project_files` table. The `storagePath` prefix encodes the folder. The `file_category` enum (`'uploaded' | 'generated'`) is sufficient.

**User uploads**: The existing upload API sets `storagePath` with the `projects/{id}/incarcate/` prefix for consistency.

**Regeneration / Idempotency**: Generation is safe to retry. Deterministic document IDs (`doc-{scope}-{slug}`) and deterministic storage paths mean re-running generation for the same project:
- Matches existing `project_files` rows by `storagePath` and updates content in place
- Matches existing `SubmissionDocument` entries by `id` and updates fields
- Preserves `userStatus` — re-generation does not reset a user's completion checkmarks
- Never creates duplicate files or documents

---

## 3. UI Changes

### Checkpoint Card (Step 2)

Freshness badge on each call card in `CallsTabContent`. Three states as described in Section 1. No new components.

### Proposal Completion (after `done`)

Progress messages stream while forms are being generated. Completion message includes a link to the project page.

### Project Detail Page (`/proiecte/[id]`)

The page gets reorganized from a flat file list into three sections:

**Propunere** — proposal sections as individual DOCX downloads, listed by order number. Each shows title, section status badge (draft/reviewed/approved), and download button.

**Dosar de depunere** — unified submission checklist:
- Progress bar at top: "5/10 documente finalizate"
- Items grouped by availability: De completat (`needs_fill`) / De obținut (`external_required`) / Gata de descărcat (`generated`)
- Completed items (any availability with `userStatus: 'completed'`) move to a "Finalizate" group at the bottom
- Each item shows: title, instructions, scope badge (General / Apel), provenance badge (Șablon / Clasificat AI), download button (if file exists), checkbox
- Checking/unchecking a checkbox calls `PATCH /api/v1/projects/:id/submission-documents/:docId` which updates `userStatus` in `project_documents.metadata` (single source of truth)
- Scope badge distinguishes general EU requirements from call-specific ones
- Provenance badge shows whether the form came from a curated template or was AI-classified from the annex list
- Items with `reviewRequired: true` show an orange "Verificați" badge — the user should confirm the AI correctly identified this requirement before acting on it

**Documente încărcate** — existing upload section, unchanged.

No new pages. No new routes beyond the completion toggle endpoint.

---

## 4. Files Changed

### New Files
- `app/src/lib/ai/orchestrator/agents/documents.ts` — `generateSubmissionDocuments()` orchestration function
- `app/src/lib/compliance/general-requirements.ts` — curated constant array of general EU requirements
- `app/src/lib/compliance/form-templates.ts` — curated Romanian legal form templates with `{{variable}}` interpolation
- `app/tests/unit/agent-documents.test.ts` — tests for document generation orchestration
- `app/tests/unit/form-templates.test.ts` — tests for template interpolation and matching
- `app/tests/unit/general-requirements.test.ts` — tests for requirements list completeness

### Modified Files
- `app/src/lib/ai/orchestrator/types.ts` — add `SubmissionDocument` interface, `freshness` field on `MatchedCall`, `submissionDocuments` on `WorkflowContext`
- `app/src/lib/ai/orchestrator/agents/match.ts` — add freshness check after scoring
- `app/src/lib/ai/orchestrator/engine.ts` — call document generation + file saving in completion block
- `app/src/lib/export/docx.ts` — add function to generate single-section DOCX and single-form DOCX
- `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx` — freshness badge on call cards
- `app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx` — reorganize into Propunere / Dosar / Încărcate sections
- `app/src/messages/ro.json` + `en.json` — i18n keys for new UI elements

### No Schema Migrations
- `project_files` table and `file_category` enum already exist and are sufficient
- `submissionDocuments` metadata lives in `project_documents.metadata` (single source of truth)
- No new tables, no enum changes
