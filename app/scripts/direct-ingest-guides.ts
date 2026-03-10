#!/usr/bin/env npx tsx
// ═══════════════════════════════════════════════════════════════════════
// ⚠️  EMERGENCY-ONLY: Direct Guide Ingestion (bypasses API)
// ═══════════════════════════════════════════════════════════════════════
//
// This script writes DIRECTLY to the production database, bypassing:
//   - API auth layer
//   - Audit logging (logAudit)
//   - Review queue
//   - Rate limiting
//
// USE ONLY when the /api/admin/ingest-call endpoint is broken (e.g.,
// Cloud Run pdf-parse DOMMatrix crash). Prefer the API route for all
// normal ingestion.
//
// Usage:
//   cd app
//   # Dry run first (no DB writes):
//   DATABASE_URL="postgresql://..." npx tsx --env-file=.env.local scripts/direct-ingest-guides.ts --dry-run
//
//   # Actual ingestion (requires explicit --confirm flag):
//   DATABASE_URL="postgresql://..." npx tsx --env-file=.env.local scripts/direct-ingest-guides.ts --confirm
//
// Resume: re-run — skips already-ingested files by callCode.
// Audit: writes an audit artifact to classification-output/ingestion-audit-log.json

import * as fs from 'fs';
import * as path from 'path';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import * as xlsx from 'xlsx';
import OpenAI from 'openai';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/lib/db/schema';

// ─── Config ───────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');
const CONFIRM = process.argv.includes('--confirm');
const CONCURRENCY = 2;
const MAX_TEXT_FOR_EXTRACTION = 15000;
const RESULTS_PATH = path.resolve(__dirname, 'classification-output/classification-results.json');
const PROGRESS_PATH = path.resolve(__dirname, 'classification-output/ingestion-progress.json');
const AUDIT_LOG_PATH = path.resolve(__dirname, 'classification-output/ingestion-audit-log.json');

const PROGRAM_CODE_MAP: Record<string, string> = {
  'PNRR': 'PNRR', 'PEO': 'PEO', 'POTJ': 'POTJ', 'PDD': 'PDD', 'PS': 'PS',
  'AFM': 'AFM', 'FNGCIMM': 'FNGCIMM', 'INTERREG': 'INTERREG',
  'PoAT': 'POAT', 'POAT': 'POAT', 'PAT': 'POAT',
  'PoIDS': 'PoIDS',
  'PoCIDIF': 'POCIDIF', 'POCIDIF': 'POCIDIF', 'POCID': 'POCIDIF',
  'PODD': 'PDD',
  'POCU': 'POCU', 'POC': 'POC', 'POIM': 'POIM', 'POCA': 'POCA',
  'PR-NE': 'PR-NE', 'PR-NV': 'PR-NV', 'PR-VEST': 'PR-VEST',
  'PR-CENTRU': 'PR-CENTRU', 'PR-SE': 'PR-SE', 'PR-SM': 'PR-SM',
  'PR-SV': 'PR-SV', 'PR-BI': 'PR-BI',
};

// ─── Types ────────────────────────────────────────────────────────────

interface ClassifiedFile {
  filePath: string;
  fileName: string;
  parentDir: string;
  extension: string;
  fileSizeMB: number;
  contentHash: string;
  isDuplicate: boolean;
  programCode: string | null;
  suggestedTrack: string | null;
  oversized: boolean;
  error: string | null;
}

interface ExtractedCall {
  callCode: string;
  titleRo: string;
  titleEn?: string;
  descriptionRo: string;
  eligibleTypes: string[];
  eligibleRegions?: string[];
  eligibleCaen?: string[];
  budgetMin?: number;
  budgetMax?: number;
  cofinancingRate?: number;
  durationMin?: number;
  durationMax?: number;
  submissionStart?: string;
  submissionEnd?: string;
  isCompetitive?: boolean;
}

interface IngestionResult {
  filePath: string;
  contentHash: string;
  status: 'success' | 'error';
  callCode?: string;
  error?: string;
  timestamp: string;
}

// ─── Semaphore ────────────────────────────────────────────────────────

class Semaphore {
  private queue: (() => void)[] = [];
  private running = 0;
  constructor(private max: number) {}
  async acquire(): Promise<void> {
    if (this.running < this.max) { this.running++; return; }
    return new Promise<void>(resolve => { this.queue.push(resolve); });
  }
  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) { this.running++; next(); }
  }
}

// ─── Text Extraction ──────────────────────────────────────────────────

async function extractText(filePath: string, ext: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);

  if (ext === 'pdf') {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    await parser.destroy();
    return result.text.substring(0, MAX_TEXT_FOR_EXTRACTION);
  }
  if (ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.substring(0, MAX_TEXT_FOR_EXTRACTION);
  }
  if (ext === 'xlsx' || ext === 'xls') {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    let fullText = '';
    for (const sheetName of workbook.SheetNames) {
      fullText += `\n--- Sheet: ${sheetName} ---\n`;
      fullText += xlsx.utils.sheet_to_txt(workbook.Sheets[sheetName]);
      if (fullText.length > MAX_TEXT_FOR_EXTRACTION) break;
    }
    return fullText.substring(0, MAX_TEXT_FOR_EXTRACTION);
  }
  if (ext === 'txt') {
    return buffer.toString('utf8').substring(0, MAX_TEXT_FOR_EXTRACTION);
  }
  throw new Error(`Cannot extract text from .${ext}`);
}

// ─── AI Extraction ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Ești un expert în fonduri europene (PNRR, Programe Operaționale).
Sarcina ta este să citești textul dintr-un "Ghid al Solicitantului" și să extragi datele esențiale pentru configurarea unui sistem de matching.

EXTRAGE URMĂTOARELE:
1. callCode: Codul apelului (ex: PNRR/2024/C9/I1). Dacă nu e explicit, construiește unul din program+prioritate.
2. titleRo: Titlul oficial al apelului în română.
3. titleEn: Titlul în engleză (dacă există, altfel null).
4. descriptionRo: Descriere scurtă (2-3 propoziții) a obiectivului apelului.
5. eligibleTypes: Tipuri de entități eligibile. Mapează la: 'srl', 'sa', 'ong', 'pfa', 'uat', 'institutie_publica'.
6. eligibleRegions: Regiuni eligibile (coduri NUTS: RO11, RO12, RO21, RO22, RO31, RO32, RO41, RO42, sau "national").
7. eligibleCaen: Coduri CAEN eligibile (listă de string-uri de 4 cifre). Gol dacă nu sunt specificate.
8. budgetMin: Valoare minimă grant (EUR). null dacă nu e specificat.
9. budgetMax: Valoare maximă grant (EUR). null dacă nu e specificat.
10. cofinancingRate: Rata de cofinanțare minimă (procent, ex: 15). null dacă nu e specificat.
11. durationMin: Durata minimă proiect (luni). null dacă nu e specificat.
12. durationMax: Durata maximă proiect (luni). null dacă nu e specificat.
13. submissionStart: Data deschidere depunere (format YYYY-MM-DD). null dacă nu e specificat.
14. submissionEnd: Data limită depunere (format YYYY-MM-DD). null dacă nu e specificat.
15. isCompetitive: true dacă evaluarea e competitivă, false dacă e pe principiul "primul venit".

Dacă o informație nu este clară, lasă null.
Răspunde DOAR cu JSON valid.`;

async function extractCallData(openai: OpenAI, text: string, fileName: string): Promise<ExtractedCall> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Analizează următorul fragment din Ghidul Solicitantului (fișier: ${fileName}):\n\n--- BEGIN ---\n${text}\n--- END ---` },
    ],
    max_tokens: 1500,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty AI response');

  const parsed = JSON.parse(content);

  // Ensure required fields have defaults
  return {
    callCode: parsed.callCode || `UNKNOWN-${Date.now()}`,
    titleRo: parsed.titleRo || fileName,
    titleEn: parsed.titleEn || undefined,
    descriptionRo: parsed.descriptionRo || 'Ghid al solicitantului — extracție automată.',
    eligibleTypes: Array.isArray(parsed.eligibleTypes) ? parsed.eligibleTypes : [],
    eligibleRegions: Array.isArray(parsed.eligibleRegions) ? parsed.eligibleRegions : undefined,
    eligibleCaen: Array.isArray(parsed.eligibleCaen) ? parsed.eligibleCaen : undefined,
    budgetMin: typeof parsed.budgetMin === 'number' ? parsed.budgetMin : undefined,
    budgetMax: typeof parsed.budgetMax === 'number' ? parsed.budgetMax : undefined,
    cofinancingRate: typeof parsed.cofinancingRate === 'number' ? parsed.cofinancingRate : undefined,
    durationMin: typeof parsed.durationMin === 'number' ? parsed.durationMin : undefined,
    durationMax: typeof parsed.durationMax === 'number' ? parsed.durationMax : undefined,
    submissionStart: parsed.submissionStart || undefined,
    submissionEnd: parsed.submissionEnd || undefined,
    isCompetitive: typeof parsed.isCompetitive === 'boolean' ? parsed.isCompetitive : true,
  };
}

// ─── Progress ─────────────────────────────────────────────────────────

function loadProgress(): Map<string, IngestionResult> {
  const map = new Map<string, IngestionResult>();
  if (fs.existsSync(PROGRESS_PATH)) {
    try {
      const results: IngestionResult[] = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
      for (const r of results) {
        if (r.status === 'success') map.set(r.contentHash, r);
      }
    } catch { /* start fresh */ }
  }
  return map;
}

function saveProgress(results: IngestionResult[]): void {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(results, null, 2));
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!DRY_RUN && !CONFIRM) {
    console.error('⚠️  EMERGENCY-ONLY SCRIPT — bypasses API, auth, and audit logging.');
    console.error('');
    console.error('  --dry-run   Preview what would be ingested (no DB writes)');
    console.error('  --confirm   Actually write to the database');
    console.error('');
    console.error('Run with --dry-run first to verify.');
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('══ DRY RUN MODE — no database writes ══\n');
  } else {
    console.log('══ ⚠️  LIVE MODE — writing directly to production DB ══\n');
  }

  const dbUrl = process.env.DATABASE_URL;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!dbUrl) {
    console.error('DATABASE_URL not set.');
    process.exit(1);
  }
  if (!openaiKey) {
    console.error('OPENAI_API_KEY not set.');
    process.exit(1);
  }

  // Connect to DB
  const sql = postgres(dbUrl);
  const db = drizzle(sql, { schema });
  const openai = new OpenAI({ apiKey: openaiKey });

  console.log('Connected to database');

  // Load classification results
  const allFiles: ClassifiedFile[] = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));

  // Filter for call-extraction guides
  const guides = allFiles.filter(f =>
    f.suggestedTrack === 'call-extraction' &&
    !f.isDuplicate &&
    !f.error &&
    f.programCode &&
    f.programCode !== 'UNKNOWN'
  );

  console.log(`\n  Call-extraction guides: ${guides.length}`);

  // Normalize and resolve program IDs
  const programCache = new Map<string, string>(); // code → id
  const allPrograms = await db.query.fundingPrograms.findMany();
  for (const p of allPrograms) {
    programCache.set(p.code, p.id);
  }
  console.log(`  Programs in DB: ${allPrograms.length}`);

  // Load progress
  const previousProgress = loadProgress();
  const toIngest = guides.filter(g => !previousProgress.has(g.contentHash));
  console.log(`  Already ingested (resume): ${guides.length - toIngest.length}`);
  console.log(`  Remaining: ${toIngest.length}\n`);

  if (toIngest.length === 0) {
    console.log('Nothing to do.');
    await sql.end();
    return;
  }

  // Ingest
  const sem = new Semaphore(CONCURRENCY);
  const allResults: IngestionResult[] = [...previousProgress.values()];
  let completed = 0;
  let successCount = 0;
  let errorCount = 0;
  const startTime = Date.now();

  const ingestOne = async (file: ClassifiedFile): Promise<void> => {
    await sem.acquire();
    const timestamp = new Date().toISOString();
    try {
      const normalizedCode = PROGRAM_CODE_MAP[file.programCode!] || file.programCode!;
      const programId = programCache.get(normalizedCode);

      if (!programId) {
        throw new Error(`Program not found in DB: ${normalizedCode} (original: ${file.programCode})`);
      }

      // 1. Parse
      const text = await extractText(file.filePath, file.extension);
      if (text.trim().length < 100) {
        throw new Error('Insufficient text extracted (< 100 chars)');
      }

      // 2. AI Extract
      const extracted = await extractCallData(openai, text, file.fileName);

      // 3. Upsert to DB (or dry-run)
      if (DRY_RUN) {
        allResults.push({
          filePath: file.filePath, contentHash: file.contentHash,
          status: 'success', callCode: extracted.callCode, timestamp,
        });
        successCount++;
        console.log(`  [${++completed}/${toIngest.length}] DRY ${file.fileName} → ${extracted.callCode} (${normalizedCode})`);
      } else {
        const [savedCall] = await db.insert(schema.callsForProposals).values({
          programId,
          callCode: extracted.callCode,
          titleRo: extracted.titleRo,
          titleEn: extracted.titleEn,
          descriptionRo: extracted.descriptionRo,
          eligibleTypes: extracted.eligibleTypes,
          eligibleRegions: extracted.eligibleRegions,
          eligibleCaen: extracted.eligibleCaen,
          budgetMin: extracted.budgetMin?.toString(),
          budgetMax: extracted.budgetMax?.toString(),
          cofinancingRate: extracted.cofinancingRate?.toString(),
          durationMin: extracted.durationMin,
          durationMax: extracted.durationMax,
          submissionStart: extracted.submissionStart ? new Date(extracted.submissionStart) : undefined,
          submissionEnd: extracted.submissionEnd ? new Date(extracted.submissionEnd) : undefined,
          status: 'deschis',
          isCompetitive: extracted.isCompetitive ?? true,
        }).onConflictDoUpdate({
          target: [schema.callsForProposals.callCode],
          set: {
            titleRo: extracted.titleRo,
            descriptionRo: extracted.descriptionRo,
            eligibleTypes: extracted.eligibleTypes,
            eligibleRegions: extracted.eligibleRegions,
            eligibleCaen: extracted.eligibleCaen,
            budgetMax: extracted.budgetMax?.toString(),
            updatedAt: new Date(),
          },
        }).returning();

        allResults.push({
          filePath: file.filePath, contentHash: file.contentHash,
          status: 'success', callCode: savedCall.callCode, timestamp,
        });
        successCount++;
        console.log(`  [${++completed}/${toIngest.length}] OK  ${file.fileName} → ${savedCall.callCode} (${normalizedCode})`);
      }

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      allResults.push({
        filePath: file.filePath, contentHash: file.contentHash,
        status: 'error', error: errMsg, timestamp,
      });
      errorCount++;
      console.log(`  [${++completed}/${toIngest.length}] ERR ${file.fileName} — ${errMsg.substring(0, 120)}`);
    } finally {
      if (completed % 5 === 0) saveProgress(allResults);
      sem.release();
    }
  };

  console.log(`═══ Starting Ingestion (concurrency: ${CONCURRENCY}) ═══\n`);
  await Promise.all(toIngest.map(f => ingestOne(f)));

  // Final save
  saveProgress(allResults);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n═══ Summary ═══`);
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  Processed: ${completed}`);
  console.log(`  Success: ${successCount}`);
  console.log(`  Errors: ${errorCount}`);
  console.log(`  Time: ${elapsed}s`);
  console.log(`  Progress: ${PROGRESS_PATH}`);

  // Write audit artifact
  const auditEntry = {
    timestamp: new Date().toISOString(),
    mode: DRY_RUN ? 'dry-run' : 'live',
    databaseUrl: dbUrl.replace(/:[^:@]+@/, ':***@'), // Redact password
    processed: completed,
    success: successCount,
    errors: errorCount,
    elapsedSeconds: Number(elapsed),
    results: allResults.filter(r => r.timestamp === allResults[allResults.length - 1]?.timestamp?.substring(0, 10) || true),
  };

  const auditLog: unknown[] = [];
  if (fs.existsSync(AUDIT_LOG_PATH)) {
    try { auditLog.push(...JSON.parse(fs.readFileSync(AUDIT_LOG_PATH, 'utf8'))); } catch { /* fresh */ }
  }
  auditLog.push(auditEntry);
  fs.writeFileSync(AUDIT_LOG_PATH, JSON.stringify(auditLog, null, 2));
  console.log(`  Audit log: ${AUDIT_LOG_PATH}`);

  await sql.end();
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
