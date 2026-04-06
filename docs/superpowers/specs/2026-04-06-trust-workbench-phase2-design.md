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
  id: string                                      // e.g., "doc-declaratie-minimis"
  title: string                                    // "Declarație de minimis"
  content: string                                  // Full form text, pre-filled where possible
  category: 'declaration' | 'certificate' | 'annex' | 'form'
  scope: 'general' | 'call_specific'
  status: 'ready' | 'needs_input' | 'external'
  sourceAnnex: string                              // Which blueprint annex this maps to
  instructions: string                             // "Semnați și ștampilați"
  order: number
  completed: boolean                               // User checks this off
  completedAt: string | null
}
```

**Status meanings:**
- `ready` — fully generated, user can print/download as-is
- `needs_input` — generated with `[___]` placeholders the user fills in (signature, stamp, specific data). The `instructions` field says exactly what.
- `external` — can't be generated, must be obtained from an institution (e.g., "Certificat constatator ONRC — obțineți de la registrul.onrc.ro")

**Scope meanings:**
- `general` — standard EU requirements that apply to every project (GDPR, anti-fraud, publicity, beneficial ownership)
- `call_specific` — required by the specific call's ghid/mandatory annexes

### Storage on WorkflowContext

`submissionDocuments: SubmissionDocument[] | null` on `WorkflowContext`, persisted in `workflow_sessions.context` JSONB. Same pattern as `projectSections`.

Structured metadata (status, instructions, completed) also stored in `project_documents.metadata.submissionDocuments` for the project page to read without loading the full session.

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

### Document Generation

New file: `app/src/lib/ai/orchestrator/agents/documents.ts`

A function `generateSubmissionDocuments()` that:

1. Reads the general requirements list from `general-requirements.ts`
2. Reads `CallBlueprint.normalized.mandatoryAnnexes` for call-specific forms
3. Makes a single Gemini Flash gateway call with a prompt that generates all forms in Romanian with proper legal language, pre-filled with org/project data (name, CUI, project title, program, budget). Fields the user must complete are marked with `[___]`.
4. Parses the response into individual `SubmissionDocument` objects
5. Converts each to DOCX via the existing `generateDocx` infrastructure in `lib/export/docx.ts`
6. Saves each to storage as a `project_files` row

For `external` documents (can't be generated), the AI produces only the `title`, `instructions`, and sets `status: 'external'`. No file generated.

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

**Regeneration**: When the user edits sections post-completion or asks to regenerate a form, the old `project_files` row is updated in place (same `storagePath`, new content).

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
- Items grouped by status: De completat (`needs_input`) / De obținut (`external`) / Finalizate (`completed`)
- Each item shows: title, instructions, scope badge (General / Apel), download button (if file exists), checkbox
- Checking/unchecking a checkbox calls `PATCH /api/v1/projects/:id/documents/:docId/complete` which updates the metadata
- Scope badge distinguishes general EU requirements from call-specific ones

**Documente încărcate** — existing upload section, unchanged.

No new pages. No new routes beyond the completion toggle endpoint.

---

## 4. Files Changed

### New Files
- `app/src/lib/ai/orchestrator/agents/documents.ts` — `generateSubmissionDocuments()` function
- `app/src/lib/compliance/general-requirements.ts` — curated constant array of general EU requirements
- `app/tests/unit/agent-documents.test.ts` — tests for document generation
- `app/tests/unit/general-requirements.test.ts` — tests for requirements list

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
- `submissionDocuments` metadata lives in existing JSONB columns
