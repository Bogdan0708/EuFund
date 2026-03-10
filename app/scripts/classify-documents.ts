#!/usr/bin/env npx tsx
// ─── Document Classification, Dedup & Conversion Pipeline ─────────────
// Classifies ~1000+ EU funding documents by program, type, and call code.
// Usage: cd app && npx tsx --env-file=.env.local ../scripts/classify-documents.ts "/mnt/c/Users/godja/Desktop/funding calls/"

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import * as xlsx from 'xlsx';
import OpenAI from 'openai';

// ─── Types ────────────────────────────────────────────────────────────

interface FileEntry {
  filePath: string;
  fileName: string;
  parentDir: string;
  extension: string;
  fileSizeMB: number;
  contentHash: string;
  isDuplicate: boolean;
  duplicateOf: string | null;
  programCode: string | null;
  documentType: string | null;
  callCode: string | null;
  titleRo: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  suggestedTrack: 'call-extraction' | 'rag-knowledge' | null;
  oversized: boolean;
  error: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────

const SUPPORTED_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'xls', 'txt']);
const CONVERTIBLE_EXTENSIONS = new Set(['doc', 'pptx']);
const SKIP_EXTENSIONS = new Set(['csv', 'zip', 'rtf', 'rar', '7z', 'jpg', 'jpeg', 'png', 'gif', 'mp4', 'html', 'htm', 'xml', 'json']);
const SKIP_DIRS = new Set(['~BROMIUM', '$RECYCLE.BIN', 'System Volume Information']);
const MAX_TEXT_LENGTH = 5000;
const OVERSIZED_MB = 15;
const CONCURRENCY = 5;
const SAVE_INTERVAL = 50;

const OUTPUT_DIR = path.resolve(__dirname, 'classification-output');
const RESULTS_JSON = path.join(OUTPUT_DIR, 'classification-results.json');
const RESULTS_CSV = path.join(OUTPUT_DIR, 'classification-results.csv');

const PROGRAM_CODES = [
  'PNRR', 'PEO', 'PoIDS', 'POTJ', 'PDD', 'PoAT', 'PS', 'PoCIDIF',
  'PR-NE', 'PR-NV', 'PR-VEST', 'PR-CENTRU', 'PR-SE', 'PR-SM', 'PR-SV', 'PR-BI',
  'AFM', 'FNGCIMM', 'POAT', 'POCU', 'POC', 'POIM', 'POCA',
  'INTERREG', 'HORIZON', 'LIFE', 'ERASMUS',
];

// ─── Phase 1: Scan & Deduplicate ─────────────────────────────────────

function walkDir(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    console.warn(`  ⚠ Cannot read directory: ${dir}`);
    return results;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

function getExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  return ext;
}

function computeHash(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function scanAndDedup(inputDir: string): { entries: FileEntry[]; skippedFormats: Record<string, number> } {
  console.log('\n═══ Phase 1: Scan & Deduplicate ═══');
  console.log(`Scanning: ${inputDir}`);

  const allFiles = walkDir(inputDir);
  console.log(`  Found ${allFiles.length} total files`);

  const entries: FileEntry[] = [];
  const hashMap = new Map<string, string>(); // hash → first filePath
  const skippedFormats: Record<string, number> = {};
  let noExtCount = 0;

  for (let i = 0; i < allFiles.length; i++) {
    const filePath = allFiles[i];
    const fileName = path.basename(filePath);
    const parentDir = path.basename(path.dirname(filePath));
    const ext = getExtension(filePath);

    if (!ext) {
      noExtCount++;
      continue;
    }

    const isSupported = SUPPORTED_EXTENSIONS.has(ext);
    const isConvertible = CONVERTIBLE_EXTENSIONS.has(ext);

    if (!isSupported && !isConvertible) {
      if (SKIP_EXTENSIONS.has(ext)) {
        skippedFormats[ext] = (skippedFormats[ext] || 0) + 1;
      } else {
        skippedFormats[ext] = (skippedFormats[ext] || 0) + 1;
      }
      continue;
    }

    const stats = fs.statSync(filePath);
    const fileSizeMB = Math.round((stats.size / (1024 * 1024)) * 100) / 100;

    if ((i + 1) % 100 === 0) {
      process.stdout.write(`  Hashing ${i + 1}/${allFiles.length}...\r`);
    }

    let contentHash: string;
    try {
      contentHash = computeHash(filePath);
    } catch (err) {
      entries.push({
        filePath, fileName, parentDir, extension: ext, fileSizeMB,
        contentHash: '', isDuplicate: false, duplicateOf: null,
        programCode: null, documentType: null, callCode: null, titleRo: null,
        confidence: null, suggestedTrack: null, oversized: fileSizeMB > OVERSIZED_MB,
        error: `Hash failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    const isDuplicate = hashMap.has(contentHash);
    const duplicateOf = isDuplicate ? hashMap.get(contentHash)! : null;
    if (!isDuplicate) {
      hashMap.set(contentHash, filePath);
    }

    entries.push({
      filePath, fileName, parentDir, extension: ext, fileSizeMB,
      contentHash, isDuplicate, duplicateOf,
      programCode: null, documentType: null, callCode: null, titleRo: null,
      confidence: null, suggestedTrack: null,
      oversized: fileSizeMB > OVERSIZED_MB,
      error: isConvertible ? `Skipped: .${ext} conversion not supported (no LibreOffice)` : null,
    });
  }

  console.log(`\n  Total processable files: ${entries.length}`);
  console.log(`  Unique files: ${entries.filter(e => !e.isDuplicate).length}`);
  console.log(`  Duplicates: ${entries.filter(e => e.isDuplicate).length}`);
  console.log(`  No extension: ${noExtCount}`);
  if (Object.keys(skippedFormats).length > 0) {
    console.log(`  Skipped formats: ${Object.entries(skippedFormats).map(([k, v]) => `${k}(${v})`).join(', ')}`);
  }

  return { entries, skippedFormats };
}

// ─── Phase 2: Text Extraction ─────────────────────────────────────────

async function extractText(filePath: string, ext: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);

  if (ext === 'pdf') {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    await parser.destroy();
    return result.text.substring(0, MAX_TEXT_LENGTH);
  }

  if (ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.substring(0, MAX_TEXT_LENGTH);
  }

  if (ext === 'xlsx' || ext === 'xls') {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    let fullText = '';
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      fullText += `\n--- Sheet: ${sheetName} ---\n`;
      fullText += xlsx.utils.sheet_to_txt(sheet);
      if (fullText.length > MAX_TEXT_LENGTH) break;
    }
    return fullText.substring(0, MAX_TEXT_LENGTH);
  }

  if (ext === 'txt') {
    return buffer.toString('utf8').substring(0, MAX_TEXT_LENGTH);
  }

  throw new Error(`Cannot extract text from .${ext}`);
}

// ─── Phase 3: AI Classification ───────────────────────────────────────

const SYSTEM_PROMPT = `Ești un expert în fonduri europene pentru România (PNRR, Programe Operaționale 2021-2027, Programe Regionale).
Sarcina ta este să clasifici documente din domeniul fondurilor europene.

Clasifică documentul în următoarele categorii:

programCode — unul din: ${PROGRAM_CODES.join(', ')}, UNKNOWN
documentType — unul din: guide (Ghid Solicitant), annex (anexă), regulation (regulament/ordin), order (ordin de ministru), strategy (strategie), template (model/formular), presentation (prezentare), faq (întrebări frecvente), corrigendum (corrigendum/erată), report (raport), other
callCode — codul apelului dacă este identificabil (ex: PNRR/2024/C9/I1, PEO/2024/1.1), null dacă nu este clar
titleRo — titlul documentului în română (extrage din conținut sau aproximează din context)
confidence — high (sigur pe clasificare), medium (destul de sigur), low (ghicit din context limitat)
suggestedTrack — "call-extraction" dacă este un Ghid al Solicitantului (document principal care descrie un apel de proiecte), "rag-knowledge" pentru orice altceva

IMPORTANT:
- Numele fișierului poate fi un hash MD5 fără sens — folosește conținutul textului.
- Numele directorului părinte poate conține indicii despre program/apel.
- Dacă textul este prea scurt sau neclar, setează confidence=low.
- Ghidurile Solicitantului conțin de obicei: criterii de eligibilitate, buget, calendar, activități eligibile.

Răspunde DOAR cu JSON valid, fără explicații.`;

interface ClassificationResult {
  programCode: string;
  documentType: string;
  callCode: string | null;
  titleRo: string;
  confidence: 'high' | 'medium' | 'low';
  suggestedTrack: 'call-extraction' | 'rag-knowledge';
}

async function classifyWithAI(
  openai: OpenAI,
  text: string,
  fileName: string,
  parentDir: string,
): Promise<ClassificationResult> {
  const userPrompt = `Clasifică următorul document:

Nume fișier: ${fileName}
Director părinte: ${parentDir}

--- CONȚINUT DOCUMENT (primele ${MAX_TEXT_LENGTH} caractere) ---
${text}
--- SFÂRȘIT DOCUMENT ---`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 500,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty AI response');
  return JSON.parse(content) as ClassificationResult;
}

// ─── Semaphore for concurrency control ────────────────────────────────

class Semaphore {
  private queue: (() => void)[] = [];
  private running = 0;
  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++;
      return;
    }
    return new Promise<void>(resolve => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }
}

// ─── Output ───────────────────────────────────────────────────────────

function saveResults(entries: FileEntry[]): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // JSON
  fs.writeFileSync(RESULTS_JSON, JSON.stringify(entries, null, 2));

  // CSV
  const headers = [
    'filePath', 'fileName', 'parentDir', 'extension', 'fileSizeMB', 'contentHash',
    'isDuplicate', 'duplicateOf', 'programCode', 'documentType', 'callCode',
    'titleRo', 'confidence', 'suggestedTrack', 'oversized', 'error',
  ];
  const csvRows = [headers.join(',')];
  for (const e of entries) {
    const row = headers.map(h => {
      const val = (e as unknown as Record<string, unknown>)[h];
      if (val === null || val === undefined) return '';
      const str = String(val);
      // Escape CSV fields that contain commas, quotes, or newlines
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    });
    csvRows.push(row.join(','));
  }
  fs.writeFileSync(RESULTS_CSV, csvRows.join('\n'));
}

function printSummary(entries: FileEntry[]): void {
  console.log('\n═══ Classification Summary ═══');

  const classified = entries.filter(e => e.programCode !== null);
  const errors = entries.filter(e => e.error !== null && !e.error.startsWith('Skipped:'));
  const duplicates = entries.filter(e => e.isDuplicate);
  const oversized = entries.filter(e => e.oversized);
  const convertSkipped = entries.filter(e => e.error?.startsWith('Skipped:'));

  console.log(`  Total files: ${entries.length}`);
  console.log(`  Classified: ${classified.length}`);
  console.log(`  Duplicates: ${duplicates.length}`);
  console.log(`  Oversized (>${OVERSIZED_MB}MB): ${oversized.length}`);
  console.log(`  Conversion skipped (doc/pptx): ${convertSkipped.length}`);
  console.log(`  Errors: ${errors.length}`);

  // By program
  const byProgram: Record<string, number> = {};
  for (const e of classified) {
    const p = e.programCode || 'UNKNOWN';
    byProgram[p] = (byProgram[p] || 0) + 1;
  }
  console.log('\n  By Program:');
  for (const [prog, count] of Object.entries(byProgram).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${prog}: ${count}`);
  }

  // By document type
  const byType: Record<string, number> = {};
  for (const e of classified) {
    const t = e.documentType || 'other';
    byType[t] = (byType[t] || 0) + 1;
  }
  console.log('\n  By Type:');
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }

  // By track
  const byTrack: Record<string, number> = {};
  for (const e of classified) {
    const t = e.suggestedTrack || 'unknown';
    byTrack[t] = (byTrack[t] || 0) + 1;
  }
  console.log('\n  By Track:');
  for (const [track, count] of Object.entries(byTrack).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${track}: ${count}`);
  }

  // By confidence
  const byConf: Record<string, number> = {};
  for (const e of classified) {
    const c = e.confidence || 'null';
    byConf[c] = (byConf[c] || 0) + 1;
  }
  console.log('\n  By Confidence:');
  for (const [conf, count] of Object.entries(byConf).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${conf}: ${count}`);
  }

  console.log(`\n  Results saved to:`);
  console.log(`    ${RESULTS_JSON}`);
  console.log(`    ${RESULTS_CSV}`);
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const inputDir = process.argv[2];
  if (!inputDir) {
    console.error('Usage: npx tsx --env-file=.env.local ../scripts/classify-documents.ts <input-directory>');
    process.exit(1);
  }

  if (!fs.existsSync(inputDir)) {
    console.error(`Directory not found: ${inputDir}`);
    process.exit(1);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY not set. Use --env-file=.env.local or export it.');
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey });

  // Phase 1: Scan & Dedup
  const { entries } = scanAndDedup(inputDir);

  // Load existing results for resume support
  let existingResults = new Map<string, FileEntry>();
  if (fs.existsSync(RESULTS_JSON)) {
    try {
      const existing: FileEntry[] = JSON.parse(fs.readFileSync(RESULTS_JSON, 'utf8'));
      for (const e of existing) {
        if (e.programCode !== null) {
          existingResults.set(e.contentHash, e);
        }
      }
      console.log(`\n  Loaded ${existingResults.size} previously classified results (resume mode)`);
    } catch {
      console.warn('  Could not load existing results, starting fresh');
    }
  }

  // Apply existing classifications
  for (const entry of entries) {
    if (entry.contentHash && existingResults.has(entry.contentHash)) {
      const prev = existingResults.get(entry.contentHash)!;
      entry.programCode = prev.programCode;
      entry.documentType = prev.documentType;
      entry.callCode = prev.callCode;
      entry.titleRo = prev.titleRo;
      entry.confidence = prev.confidence;
      entry.suggestedTrack = prev.suggestedTrack;
    }
  }

  // Phase 3: AI Classification
  const toClassify = entries.filter(e =>
    !e.isDuplicate &&
    !e.error &&
    e.programCode === null &&
    SUPPORTED_EXTENSIONS.has(e.extension)
  );

  console.log(`\n═══ Phase 3: AI Classification ═══`);
  console.log(`  Files to classify: ${toClassify.length}`);

  const sem = new Semaphore(CONCURRENCY);
  let completed = 0;
  let errorCount = 0;
  const startTime = Date.now();

  const classifyOne = async (entry: FileEntry): Promise<void> => {
    await sem.acquire();
    try {
      // Extract text
      let text: string;
      try {
        text = await extractText(entry.filePath, entry.extension);
      } catch (err) {
        entry.error = `Parse error: ${err instanceof Error ? err.message : String(err)}`;
        errorCount++;
        return;
      }

      if (text.trim().length < 50) {
        entry.error = 'Insufficient text extracted (< 50 chars)';
        entry.confidence = 'low';
        errorCount++;
        return;
      }

      // AI classify
      try {
        const result = await classifyWithAI(openai, text, entry.fileName, entry.parentDir);
        entry.programCode = result.programCode;
        entry.documentType = result.documentType;
        entry.callCode = result.callCode;
        entry.titleRo = result.titleRo;
        entry.confidence = result.confidence;
        entry.suggestedTrack = result.suggestedTrack;
      } catch (err) {
        entry.error = `AI error: ${err instanceof Error ? err.message : String(err)}`;
        errorCount++;
      }
    } finally {
      completed++;
      if (completed % 10 === 0 || completed === toClassify.length) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const rate = (completed / ((Date.now() - startTime) / 1000)).toFixed(1);
        process.stdout.write(
          `  Progress: ${completed}/${toClassify.length} (${rate}/s, ${elapsed}s elapsed, ${errorCount} errors)\r`
        );
      }

      // Incremental save
      if (completed % SAVE_INTERVAL === 0) {
        saveResults(entries);
      }

      sem.release();
    }
  };

  // Launch all concurrently (semaphore controls actual parallelism)
  await Promise.all(toClassify.map(entry => classifyOne(entry)));

  // Propagate classifications to duplicates
  const hashToClassification = new Map<string, FileEntry>();
  for (const entry of entries) {
    if (entry.programCode !== null && !entry.isDuplicate) {
      hashToClassification.set(entry.contentHash, entry);
    }
  }
  for (const entry of entries) {
    if (entry.isDuplicate && entry.contentHash) {
      const source = hashToClassification.get(entry.contentHash);
      if (source) {
        entry.programCode = source.programCode;
        entry.documentType = source.documentType;
        entry.callCode = source.callCode;
        entry.titleRo = source.titleRo;
        entry.confidence = source.confidence;
        entry.suggestedTrack = source.suggestedTrack;
      }
    }
  }

  console.log(''); // Clear progress line

  // Final save
  saveResults(entries);
  printSummary(entries);
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
