#!/usr/bin/env npx tsx
// ─── Bulk RAG Knowledge Ingestion ────────────────────────────────────
// Parses ~771 classified documents (annexes, regulations, templates, etc.),
// chunks them, generates embeddings via OpenAI, and upserts to Qdrant.
//
// This script bypasses the app entirely — direct file parsing, direct
// OpenAI API calls, direct Qdrant HTTP API. No app imports needed.
//
// Usage:
//   cd app
//   DATABASE_URL="postgresql://..." QDRANT_URL="http://<IP>:6333" \
//     npx tsx --env-file=.env.local scripts/bulk-ingest-rag-knowledge.ts
//
// Resume: re-run — skips already-ingested files by contentHash.

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import * as xlsx from 'xlsx';
import OpenAI from 'openai';
import { QdrantClient } from './lib/qdrant-client';

// ─── Config ───────────────────────────────────────────────────────────

const CONCURRENCY = 3;
const EMBEDDING_BATCH_SIZE = 20;
const QDRANT_UPSERT_BATCH_SIZE = 100;
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const MAX_TEXT_LENGTH = 100_000; // Full document text for chunking (not just extraction)
const COLLECTION_NAME = process.env.VECTOR_COLLECTION || 'eu_legislation';
const EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL || 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

const RESULTS_PATH = path.resolve(__dirname, 'classification-output/classification-results.json');
const PROGRESS_PATH = path.resolve(__dirname, 'classification-output/rag-ingestion-progress.json');

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
  'GENERAL': 'GENERAL',
};

// ─── Poisoning / Validation Patterns (from pipeline.ts) ─────────────

const RAG_POISONING_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /disregard\s+(all\s+)?(rules|instructions|system\s+prompt)/i,
  /(override|bypass|disable)\s+(safety|security|guardrails?|policy)/i,
  /(reveal|show|print)\s+(system\s+prompt|developer\s+message|hidden\s+instructions?)/i,
  /you\s+are\s+now\s+(?:a|an)\s+/i,
];

const NON_TEXT_PAYLOAD_THRESHOLD = 0.02;
const REPLACEMENT_CHAR_PENALTY = 5;

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
  documentType: string | null;
  callCode: string | null;
  titleRo: string | null;
  suggestedTrack: string | null;
  oversized: boolean;
  error: string | null;
}

interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

interface IngestionResult {
  contentHash: string;
  fileName: string;
  status: 'success' | 'error';
  chunksCreated?: number;
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
      fullText += `\n--- Sheet: ${sheetName} ---\n`;
      fullText += xlsx.utils.sheet_to_txt(workbook.Sheets[sheetName]);
      if (fullText.length > MAX_TEXT_LENGTH) break;
    }
    return fullText.substring(0, MAX_TEXT_LENGTH);
  }
  if (ext === 'txt') {
    return buffer.toString('utf8').substring(0, MAX_TEXT_LENGTH);
  }
  throw new Error(`Cannot extract text from .${ext}`);
}

// ─── Chunking (sentence-based, from pipeline.ts:307-326) ─────────────

function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length > chunkSize && current.length > 0) {
      chunks.push(current.trim());
      // Keep overlap
      const words = current.split(' ');
      const overlapWords = Math.ceil(overlap / 5); // ~5 chars per word
      current = words.slice(-overlapWords).join(' ') + ' ' + sentence;
    } else {
      current += (current ? ' ' : '') + sentence;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ─── Chunk Validation (from pipeline.ts:64-80) ───────────────────────

function isLikelyNonTextPayload(text: string): boolean {
  const codePoints = Array.from(text);
  const replacements = codePoints.filter(cp => cp === '\uFFFD').length * REPLACEMENT_CHAR_PENALTY;
  const nonPrintable = codePoints.filter(cp => {
    const code = cp.codePointAt(0)!;
    return code < 32 && code !== 9 && code !== 10 && code !== 13;
  }).length;
  const ratio = (replacements + nonPrintable) / Math.max(codePoints.length, 1);
  return ratio > NON_TEXT_PAYLOAD_THRESHOLD;
}

function normalizeChunkContent(text: string): string {
  return text
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateChunk(content: string): { valid: boolean; sanitized: string; reason?: string } {
  const sanitized = normalizeChunkContent(content);

  if (!sanitized || sanitized.length < 20) {
    return { valid: false, sanitized, reason: 'empty_or_too_short' };
  }

  if (isLikelyNonTextPayload(content)) {
    return { valid: false, sanitized, reason: 'binary_like' };
  }

  if (RAG_POISONING_PATTERNS.some(pattern => pattern.test(sanitized))) {
    return { valid: false, sanitized, reason: 'instruction_override_pattern' };
  }

  return { valid: true, sanitized };
}

// ─── Embeddings ──────────────────────────────────────────────────────

async function embedBatch(openai: OpenAI, texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  // Sort by index to ensure order matches input
  const sorted = response.data.sort((a, b) => a.index - b.index);
  return sorted.map(d => d.embedding);
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

// ─── Process One File ────────────────────────────────────────────────

async function processFile(
  file: ClassifiedFile,
  openai: OpenAI,
  qdrant: QdrantClient,
): Promise<{ chunksCreated: number }> {
  // 1. Parse text
  const rawText = await extractText(file.filePath, file.extension);
  if (rawText.trim().length < 50) {
    throw new Error('Insufficient text extracted (< 50 chars)');
  }

  // 2. Chunk
  const rawChunks = chunkText(rawText, CHUNK_SIZE, CHUNK_OVERLAP);

  // 3. Validate chunks
  const validChunks: { index: number; content: string }[] = [];
  let droppedCount = 0;
  for (let i = 0; i < rawChunks.length; i++) {
    const result = validateChunk(rawChunks[i]);
    if (result.valid) {
      validChunks.push({ index: i, content: result.sanitized });
    } else {
      droppedCount++;
    }
  }

  if (droppedCount > 0) {
    console.log(`    Dropped ${droppedCount}/${rawChunks.length} invalid chunks`);
  }

  if (validChunks.length === 0) {
    throw new Error('All chunks failed validation');
  }

  // 4. Generate embeddings in batches
  const allPoints: QdrantPoint[] = [];
  const programCode = PROGRAM_CODE_MAP[file.programCode!] || file.programCode || 'UNKNOWN';

  for (let batchStart = 0; batchStart < validChunks.length; batchStart += EMBEDDING_BATCH_SIZE) {
    const batch = validChunks.slice(batchStart, batchStart + EMBEDDING_BATCH_SIZE);
    const texts = batch.map(c => c.content);
    const embeddings = await embedBatch(openai, texts);

    for (let j = 0; j < batch.length; j++) {
      const chunk = batch[j];
      const chunkId = createHash('md5')
        .update(`${file.contentHash}-${chunk.index}`)
        .digest('hex');

      allPoints.push({
        id: chunkId,
        vector: embeddings[j],
        payload: {
          content: chunk.content,
          sourceId: file.contentHash,
          sourceDocumentId: file.contentHash,
          source: file.fileName,
          programCode,
          documentType: file.documentType || 'unknown',
          callCode: file.callCode && file.callCode !== 'null' ? file.callCode : null,
          titleRo: file.titleRo || null,
          chunkIndex: chunk.index,
          totalChunks: rawChunks.length,
          source_url: (file as unknown as Record<string, unknown>).sourceUrl as string
            || (file as unknown as Record<string, unknown>).guideUrl as string
            || '',
          last_verified: new Date().toISOString(),
          content_hash: createHash('sha256').update(chunk.content).digest('hex'),
          ingested_at: new Date().toISOString(),
        },
      });
    }
  }

  // 5. Upsert to Qdrant in batches
  for (let batchStart = 0; batchStart < allPoints.length; batchStart += QDRANT_UPSERT_BATCH_SIZE) {
    const batch = allPoints.slice(batchStart, batchStart + QDRANT_UPSERT_BATCH_SIZE);
    await qdrant.upsertPoints(batch);
  }

  return { chunksCreated: allPoints.length };
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const qdrantUrl = process.env.QDRANT_URL;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!qdrantUrl) {
    console.error('QDRANT_URL not set.');
    process.exit(1);
  }
  if (!openaiKey) {
    console.error('OPENAI_API_KEY not set.');
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey: openaiKey });
  const qdrant = new QdrantClient(qdrantUrl, COLLECTION_NAME, process.env.QDRANT_API_KEY);

  // Ensure collection exists
  await qdrant.ensureCollection(EMBEDDING_DIMENSIONS);

  // Load classification results
  const allFiles: ClassifiedFile[] = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));

  // Filter for rag-knowledge files (non-duplicate, no errors)
  const ragFiles = allFiles.filter(f =>
    f.suggestedTrack === 'rag-knowledge' &&
    !f.isDuplicate &&
    !f.error &&
    !f.oversized
  );

  console.log(`\n  RAG knowledge files: ${ragFiles.length}`);

  // Load progress for resume support
  const previousProgress = loadProgress();
  const toIngest = ragFiles.filter(f => !previousProgress.has(f.contentHash));
  console.log(`  Already ingested (resume): ${ragFiles.length - toIngest.length}`);
  console.log(`  Remaining: ${toIngest.length}\n`);

  if (toIngest.length === 0) {
    const count = await qdrant.getCount();
    console.log(`Nothing to do. Qdrant has ${count} points.`);
    return;
  }

  // Ingest with concurrency
  const sem = new Semaphore(CONCURRENCY);
  const allResults: IngestionResult[] = [...previousProgress.values()];
  let completed = 0;
  let successCount = 0;
  let errorCount = 0;
  let totalChunks = 0;
  const startTime = Date.now();

  const ingestOne = async (file: ClassifiedFile): Promise<void> => {
    await sem.acquire();
    const timestamp = new Date().toISOString();
    try {
      const result = await processFile(file, openai, qdrant);
      totalChunks += result.chunksCreated;
      allResults.push({
        contentHash: file.contentHash, fileName: file.fileName,
        status: 'success', chunksCreated: result.chunksCreated, timestamp,
      });
      successCount++;
      console.log(`  [${++completed}/${toIngest.length}] OK  ${file.fileName} (${result.chunksCreated} chunks)`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      allResults.push({
        contentHash: file.contentHash, fileName: file.fileName,
        status: 'error', error: errMsg, timestamp,
      });
      errorCount++;
      console.log(`  [${++completed}/${toIngest.length}] ERR ${file.fileName} — ${errMsg.substring(0, 120)}`);
    } finally {
      if (completed % 10 === 0) saveProgress(allResults);
      sem.release();
    }
  };

  console.log(`═══ Starting RAG Ingestion (concurrency: ${CONCURRENCY}) ═══\n`);
  await Promise.all(toIngest.map(f => ingestOne(f)));

  // Final save
  saveProgress(allResults);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const qdrantCount = await qdrant.getCount();

  console.log(`\n═══ Summary ═══`);
  console.log(`  Processed: ${completed}`);
  console.log(`  Success: ${successCount}`);
  console.log(`  Errors: ${errorCount}`);
  console.log(`  Chunks created: ${totalChunks}`);
  console.log(`  Qdrant total points: ${qdrantCount}`);
  console.log(`  Time: ${elapsed}s`);
  console.log(`  Progress: ${PROGRESS_PATH}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('\nFatal error:', err);
    process.exit(1);
  });
}
