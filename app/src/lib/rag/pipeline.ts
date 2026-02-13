// ─── RAG Pipeline ────────────────────────────────────────────────
// Retrieval-Augmented Generation for EU legislation and funding docs

import { getVectorStore, type SearchResult } from '@/lib/vectors/store';
import { aiGenerate } from '@/lib/ai/client';
import { normalizeDiacritics } from '@/lib/utils/romanian';

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

/**
 * Preprocess Romanian text for better search
 */
export function preprocessRomanianText(text: string): string {
  let processed = normalizeDiacritics(text);
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

  // Semantic search
  const semanticResults = await store.search(processedQuery, (opts.topK ?? 5) * 2, opts.filter);

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
  return boosted.slice(0, opts.topK ?? 5);
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
    .map((s, i) => `[Sursa ${i + 1}] ${s.content}`)
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
  const chunks = chunkText(preprocessRomanianText(doc.fullText), 1000, 200);

  const vectorDocs = chunks.map((chunk, i) => ({
    id: `${doc.id}-chunk-${i}`,
    content: chunk,
    metadata: {
      sourceId: doc.id,
      title: doc.title,
      type: doc.type,
      chunkIndex: i,
      ...doc.metadata,
    },
  }));

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
