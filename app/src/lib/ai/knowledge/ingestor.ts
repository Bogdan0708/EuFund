import { getVectorStore } from '@/lib/vectors/store';
import { logger } from '@/lib/logger';
import { createHash } from 'crypto';

const log = logger.child({ component: 'knowledge-ingestor' });

interface IngestionInput {
  text: string;
  filename: string;
  sourceUrl?: string;
  callId?: string;
  programId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Chunks text and pushes to Vector Store (Qdrant)
 */
export async function ingestToKnowledgeBase(input: IngestionInput) {
  const { text, filename, callId, programId } = input;
  
  log.info({ filename, callId }, 'Ingesting content to vector store');

  // 1. Simple Chunking (1000 chars with 200 char overlap)
  const chunks = chunkText(text, 1000, 200);
  const vectorStore = getVectorStore();

  const docs = chunks.map((chunk, index) => ({
    id: createHash('md5').update(`${filename}-${index}`).digest('hex'),
    content: chunk,
    metadata: {
      source: filename,
      callId,
      programId,
      chunkIndex: index,
      totalChunks: chunks.length,
      ingestedAt: new Date().toISOString(),
      ...input.metadata
    }
  }));

  // 2. Upsert to Vector Store
  await vectorStore.upsert(docs);

  log.info({ chunks: chunks.length }, 'Vector ingestion complete');
  return { chunks: chunks.length };
}

function chunkText(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  let index = 0;
  
  while (index < text.length) {
    chunks.push(text.slice(index, index + size));
    index += (size - overlap);
  }
  
  return chunks;
}
