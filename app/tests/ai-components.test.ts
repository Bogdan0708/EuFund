import { describe, it, expect } from 'vitest';
import { detectPII, type PIIDetection } from '@/lib/ai/document-analyzer';
import {
  preprocessRomanianText,
  extractKeywords,
  chunkText,
} from '@/lib/rag/pipeline';
import { cosineSimilarity } from '@/lib/vectors/store';

// ─── PII Detection Tests ────────────────────────────────────────

describe('detectPII', () => {
  it('should detect CNP numbers', () => {
    const text = 'Persoana cu CNP 1901215123456 a semnat contractul.';
    const results = detectPII(text);
    const cnp = results.find((r) => r.type === 'CNP');
    expect(cnp).toBeDefined();
    expect(cnp!.count).toBe(1);
    expect(cnp!.severity).toBe('high');
  });

  it('should detect email addresses', () => {
    const text = 'Contactați-ne la ion.popescu@company.ro sau maria@test.com';
    const results = detectPII(text);
    const email = results.find((r) => r.type === 'email');
    expect(email).toBeDefined();
    expect(email!.count).toBe(2);
  });

  it('should detect Romanian phone numbers', () => {
    const text = 'Telefon: +40721123456 sau 0721123456';
    const results = detectPII(text);
    const phone = results.find((r) => r.type === 'phone_ro');
    expect(phone).toBeDefined();
    expect(phone!.count).toBeGreaterThanOrEqual(1);
  });

  it('should detect IBAN numbers', () => {
    const text = 'IBAN: RO49AAAA1B31007593840000';
    const results = detectPII(text);
    const iban = results.find((r) => r.type === 'iban');
    expect(iban).toBeDefined();
    expect(iban!.severity).toBe('high');
  });

  it('should return empty for clean text', () => {
    const text = 'Proiectul vizează dezvoltarea infrastructurii digitale.';
    const results = detectPII(text);
    expect(results).toHaveLength(0);
  });

  it('should detect multiple PII types simultaneously', () => {
    const text = 'CNP: 1901215123456, Email: test@test.ro, Tel: 0721123456';
    const results = detectPII(text);
    expect(results.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── Romanian Text Processing Tests ──────────────────────────────

describe('preprocessRomanianText', () => {
  it('should normalize diacritics', () => {
    const text = 'Organizaţia a depus cererea de finanţare.';
    const result = preprocessRomanianText(text);
    expect(result).toContain('Organizația');
    expect(result).toContain('finanțare');
  });

  it('should expand legal abbreviations', () => {
    const text = 'Conform OUG nr. 12/2024 și HG nr. 456/2023';
    const result = preprocessRomanianText(text);
    expect(result).toContain('Ordonanță de urgență a Guvernului');
    expect(result).toContain('Hotărâre de Guvern');
  });

  it('should expand EU abbreviations', () => {
    const text = 'Finanțare din PNRR și POC conform regulilor UE';
    const result = preprocessRomanianText(text);
    expect(result).toContain('Planul Național de Redresare și Reziliență');
    expect(result).toContain('Programul Operațional Competitivitate');
    expect(result).toContain('Uniunea Europeană');
  });

  it('should normalize whitespace', () => {
    const text = 'Text   cu   spații    multiple\n\tși tab-uri';
    const result = preprocessRomanianText(text);
    expect(result).toBe('Text cu spații multiple și tab-uri');
  });
});

describe('extractKeywords', () => {
  it('should remove Romanian stop words', () => {
    const text = 'Proiectul de finanțare pentru dezvoltarea infrastructurii';
    const keywords = extractKeywords(text);
    expect(keywords).not.toContain('de');
    expect(keywords).not.toContain('pentru');
    expect(keywords).toContain('proiectul');
    expect(keywords).toContain('finanțare');
  });

  it('should filter short words', () => {
    const text = 'Un act de la minister';
    const keywords = extractKeywords(text);
    expect(keywords).not.toContain('un');
    expect(keywords).not.toContain('de');
    expect(keywords).not.toContain('la');
    expect(keywords).toContain('minister');
  });
});

// ─── Text Chunking Tests ─────────────────────────────────────────

describe('chunkText', () => {
  it('should split text into chunks', () => {
    const text = 'Prima propoziție. A doua propoziție. A treia propoziție. A patra propoziție. A cincea propoziție.';
    const chunks = chunkText(text, 50, 10);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('should handle short text', () => {
    const text = 'Text scurt.';
    const chunks = chunkText(text, 1000, 100);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('Text scurt.');
  });

  it('should not create empty chunks', () => {
    const text = 'A. B. C. D. E.';
    const chunks = chunkText(text, 5, 2);
    chunks.forEach((chunk) => {
      expect(chunk.trim()).not.toBe('');
    });
  });
});

// ─── Vector Similarity Tests ─────────────────────────────────────

describe('cosineSimilarity', () => {
  it('should return 1 for identical vectors', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it('should return 0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('should return -1 for opposite vectors', () => {
    const a = [1, 0];
    const b = [-1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  it('should handle zero vectors', () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});
