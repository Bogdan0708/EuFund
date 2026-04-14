// ─── RAG Pipeline ────────────────────────────────────────────────
// Retrieval-Augmented Generation for EU legislation and funding docs

import { getVectorStore, type SearchResult } from '@/lib/vectors/store';
import { aiGenerate } from '@/lib/ai/client';
import { normalizeDiacritics } from '@/lib/utils/romanian';
import { isLikelyNonTextPayload, normalizePromptInput } from '@/lib/ai/sanitize';
import { logger } from '@/lib/logger';

export interface RAGQuery {
  query: string;
  locale?: 'ro' | 'en';
  topK?: number;
  filter?: Record<string, unknown>;
  includeContext?: boolean;
}

export interface RAGResult {
  answer: string;
  sources: SearchResult[];
  tokensUsed: number;
}

// Romanian legal stop words to filter out for better keyword matching
const RO_LEGAL_STOP_WORDS = new Set([
  'de', 'la', 'în', 'și', 'sau', 'cu', 'din', 'pentru', 'pe', 'un', 'o',
  'ale', 'cel', 'cea', 'cei', 'cele', 'care', 'este', 'sunt', 'fost',
  'prin', 'al', 'nr', 'art', 'alin', 'lit', 'pct',
]);

const RAG_MAX_TOKENS_PER_SOURCE = 500;
const RAG_MAX_CONTEXT_TOKENS = 1600;
const RAG_SEMANTIC_SEARCH_MULTIPLIER = 2;

const RAG_POISONING_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /disregard\s+(all\s+)?(rules|instructions|system\s+prompt)/i,
  /(override|bypass|disable)\s+(safety|security|guardrails?|policy)/i,
  /(reveal|show|print)\s+(system\s+prompt|developer\s+message|hidden\s+instructions?)/i,
  /you\s+are\s+now\s+(?:a|an)\s+/i,
];

export function estimateContextTokens(text: string): number {
  const codePoints = Array.from(text).length;
  const nonAsciiCount = Array.from(text).filter((char) => char.charCodeAt(0) > 127).length;
  const nonAsciiRatio = codePoints === 0 ? 0 : nonAsciiCount / codePoints;
  const charsPerToken = nonAsciiRatio > 0 ? 3.2 : 4;

  return Math.max(1, Math.ceil(codePoints / charsPerToken));
}

function normalizeChunkContent(text: string): string {
  return normalizePromptInput(text).replace(/\s+/g, ' ').trim();
}

function toSourceId(result: SearchResult): string {
  const sourceId = result.metadata?.sourceId;
  if (typeof sourceId === 'string' && sourceId.trim().length > 0) {
    return sourceId;
  }
  return `unknown:${result.id}`;
}

function validateRetrievedChunk(result: SearchResult): { valid: boolean; sanitized: string; reason?: string } {
  const sanitized = normalizeChunkContent(result.content);

  if (!sanitized) {
    return { valid: false, sanitized, reason: 'empty' };
  }

  if (isLikelyNonTextPayload(result.content)) {
    return { valid: false, sanitized, reason: 'binary_like' };
  }

  if (RAG_POISONING_PATTERNS.some((pattern) => pattern.test(sanitized))) {
    return { valid: false, sanitized, reason: 'instruction_override_pattern' };
  }

  return { valid: true, sanitized };
}

function capTokensPerSource(results: SearchResult[], topK: number): SearchResult[] {
  const selected: SearchResult[] = [];
  const sourceTokenUsage = new Map<string, number>();
  let totalTokens = 0;

  for (const result of results) {
    if (selected.length >= topK || totalTokens >= RAG_MAX_CONTEXT_TOKENS) {
      break;
    }

    const sourceId = toSourceId(result);
    const usedBySource = sourceTokenUsage.get(sourceId) || 0;
    const sourceBudget = Math.max(0, RAG_MAX_TOKENS_PER_SOURCE - usedBySource);
    const totalBudget = Math.max(0, RAG_MAX_CONTEXT_TOKENS - totalTokens);
    const availableTokens = Math.min(sourceBudget, totalBudget);

    if (availableTokens <= 0) {
      continue;
    }

    const maxChars = availableTokens * 4;
    const cappedContent = result.content.length > maxChars
      ? `${result.content.slice(0, Math.max(0, maxChars - 26)).trim()}\n...[chunk truncated for safety]`
      : result.content;

    const tokens = estimateContextTokens(cappedContent);
    if (tokens <= 0) {
      continue;
    }

    selected.push({
      ...result,
      content: cappedContent,
      metadata: {
        ...result.metadata,
        sourceId,
        sourceDocumentId: sourceId,
      },
    });

    sourceTokenUsage.set(sourceId, usedBySource + tokens);
    totalTokens += tokens;
  }

  return selected;
}

/**
 * Preprocess Romanian text for better search
 */
export function preprocessRomanianText(text: string): string {
  let processed = normalizeDiacritics(normalizePromptInput(text));
  // Normalize whitespace
  processed = processed.replace(/\s+/g, ' ').trim();
  // Expand common legal abbreviations
  processed = processed
    .replace(/\bOUG\b/g, 'Ordonanță de urgență a Guvernului')
    .replace(/\bHG\b/g, 'Hotărâre de Guvern')
    .replace(/\bUE\b/g, 'Uniunea Europeană')
    .replace(/\bPOC\b/g, 'Programul Operațional Competitivitate')
    .replace(/\bPOIM\b/g, 'Programul Operațional Infrastructură Mare')
    .replace(/\bPNRR\b/g, 'Planul Național de Redresare și Reziliență');

  return processed;
}

/**
 * Extract keywords from Romanian text (removing stop words)
 */
export function extractKeywords(text: string): string[] {
  const normalized = normalizeDiacritics(text.toLowerCase());
  const words = normalized.split(/\s+/);
  return words.filter(
    (w) => w.length > 2 && !RO_LEGAL_STOP_WORDS.has(w)
  );
}

/**
 * Hybrid search: combines semantic (vector) + keyword matching
 */
export async function hybridSearch(opts: RAGQuery): Promise<SearchResult[]> {
  const store = getVectorStore();
  const processedQuery = preprocessRomanianText(opts.query);
  const targetTopK = opts.topK ?? 5;

  // Semantic search
  const semanticResults = await store.search(processedQuery, targetTopK * RAG_SEMANTIC_SEARCH_MULTIPLIER, opts.filter);

  // Keyword boost: re-rank results that contain exact keywords
  const keywords = extractKeywords(processedQuery);

  const boosted = semanticResults.map((result) => {
    const contentLower = result.content.toLowerCase();
    const keywordMatches = keywords.filter((kw) => contentLower.includes(kw)).length;
    const keywordBoost = keywordMatches / Math.max(keywords.length, 1) * 0.2;

    return {
      ...result,
      score: result.score + keywordBoost,
    };
  });

  boosted.sort((a, b) => b.score - a.score);

  const validated = boosted.flatMap((result) => {
    const validatedChunk = validateRetrievedChunk(result);
    if (!validatedChunk.valid) {
      logger.warn(
        { chunkId: result.id, sourceId: toSourceId(result), reason: validatedChunk.reason },
        '[rag] Dropped suspicious retrieved chunk'
      );
      return [];
    }

    return [{
      ...result,
      content: validatedChunk.sanitized,
      metadata: {
        ...result.metadata,
        sourceId: toSourceId(result),
        sourceDocumentId: toSourceId(result),
      },
    }];
  });

  return capTokensPerSource(validated, targetTopK);
}

/**
 * Full RAG pipeline: search → contextualize → generate
 */
export async function ragQuery(opts: RAGQuery): Promise<RAGResult> {
  const sources = await hybridSearch(opts);

  if (sources.length === 0) {
    return {
      answer: opts.locale === 'en'
        ? 'No relevant documents found for your query.'
        : 'Nu au fost găsite documente relevante pentru căutarea dumneavoastră.',
      sources: [],
      tokensUsed: 0,
    };
  }

  // Build context from retrieved documents
  const context = sources
    .map((s, i) => {
      const sourceId = toSourceId(s);
      return `[Sursa ${i + 1} | document: ${sourceId}] ${s.content}`;
    })
    .join('\n\n');

  const systemPrompt = opts.locale === 'en'
    ? `You are an EU funding expert assistant. Answer based ONLY on the provided context documents. If the context doesn't contain enough information, say so. Always cite sources using [Sursa N] notation.`
    : `Ești un asistent expert în fonduri europene. Răspunde DOAR pe baza documentelor de context furnizate. Dacă contextul nu conține suficiente informații, menționează acest lucru. Citează întotdeauna sursele folosind notația [Sursa N].`;

  const prompt = opts.locale === 'en'
    ? `Context documents:\n${context}\n\nQuestion: ${opts.query}\n\nProvide a comprehensive answer based on the context above.`
    : `Documente de context:\n${context}\n\nÎntrebare: ${opts.query}\n\nOferă un răspuns cuprinzător pe baza contextului de mai sus.`;

  const { text, tokensUsed } = await aiGenerate({ system: systemPrompt, prompt });

  return { answer: text, sources, tokensUsed };
}

/**
 * Ingest EUR-Lex document into vector store
 */
export async function ingestLegislation(doc: {
  id: string;
  title: string;
  fullText: string;
  type: string;
  metadata?: Record<string, unknown>;
}): Promise<{ chunksCreated: number }> {
  const store = getVectorStore();
  const normalizedDocument = preprocessRomanianText(normalizeChunkContent(doc.fullText));
  const chunks = chunkText(normalizedDocument, 1000, 200);

  const vectorDocs = chunks
    .map((chunk, i) => ({
      chunk,
      index: i,
    }))
    .flatMap(({ chunk, index }) => {
      const validated = validateRetrievedChunk({
        id: `${doc.id}-chunk-${index}`,
        content: chunk,
        metadata: { sourceId: doc.id },
        score: 1,
      });

      if (!validated.valid) {
        logger.warn(
          { documentId: doc.id, chunkIndex: index, reason: validated.reason },
          '[rag] Dropped suspicious chunk during indexing'
        );
        return [];
      }

      return [{
        id: `${doc.id}-chunk-${index}`,
        content: validated.sanitized,
        metadata: {
          sourceId: doc.id,
          sourceDocumentId: doc.id,
          title: doc.title,
          type: doc.type,
          chunkIndex: index,
          ...doc.metadata,
        },
      }];
    });

  if (vectorDocs.length === 0) {
    return { chunksCreated: 0 };
  }

  await store.upsert(vectorDocs);
  return { chunksCreated: vectorDocs.length };
}

/**
 * Split text into overlapping chunks for embedding
 */
export function chunkText(text: string, chunkSize: number, overlap: number): string[] {
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
