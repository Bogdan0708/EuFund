import { describe, it, expect } from 'vitest';

// ─── R01: AI Cache Tenant Isolation ──────────────────────────────

describe('R01: AI Cache Tenant Isolation', () => {
  it('generateCacheKey includes userId — different users get different keys', async () => {
    // Import the class to test
    // We need to mock Redis to avoid connection errors
    const { vi } = await import('vitest');
    vi.mock('@/lib/redis/client', () => ({
      getRedis: () => null,
    }));
    vi.mock('@/lib/logger', () => ({
      logger: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
    }));

    const { AICache } = await import('@/lib/ai/cache');

    // Access the private method via prototype
    const cache = new AICache({ enabled: false });
    const generateKey = (cache as any).generateCacheKey.bind(cache);

    const baseRequest = {
      taskType: 'proposal_generation',
      prompt: 'Generate a proposal for Horizon Europe',
      systemPrompt: 'You are an expert',
      maxTokens: 2000,
      temperature: 0.7,
      language: 'ro',
      structuredOutput: false,
      schema: undefined,
      userTier: 'free',
      priority: 'normal',
    };

    const keyUser1 = generateKey({ ...baseRequest, userId: 'user-aaa-111' });
    const keyUser2 = generateKey({ ...baseRequest, userId: 'user-bbb-222' });

    expect(keyUser1).not.toBe(keyUser2);
    expect(keyUser1).toContain('user-aaa-111');
    expect(keyUser2).toContain('user-bbb-222');

    // Same user, same request → same key
    const keyUser1Again = generateKey({ ...baseRequest, userId: 'user-aaa-111' });
    expect(keyUser1Again).toBe(keyUser1);

    vi.restoreAllMocks();
  });
});

// ─── R02: AI Output PII Sanitization ────────────────────────────

describe('R02: AI Output PII Sanitization', () => {
  it('sanitizeAIOutput strips emails, IBAN from text', async () => {
    const { sanitizeAIOutput } = await import('@/lib/ai/sanitize');

    const text = `
      Contact: ion.popescu@example.com
      IBAN: RO49AAAA1B31007593840000
      Important funding info here.
    `;

    const { sanitized, piiRedacted } = sanitizeAIOutput(text);

    expect(sanitized).not.toContain('ion.popescu@example.com');
    expect(sanitized).not.toContain('RO49AAAA1B31007593840000');
    expect(sanitized).toContain('[EMAIL_REDACTED]');
    expect(sanitized).toContain('[IBAN_REDACTED]');
    expect(sanitized).toContain('Important funding info here.');
    expect(piiRedacted.length).toBeGreaterThan(0);
  });

  it('sanitizeAIOutput strips CNP (Romanian personal ID)', async () => {
    const { sanitizeAIOutput } = await import('@/lib/ai/sanitize');

    // CNP in isolation to avoid phone regex overlap
    const text = 'Codul numeric personal: 2850612123456 aparține beneficiarului.';
    const { sanitized } = sanitizeAIOutput(text);

    // The PII should be redacted (either as CNP or phone — both protect the data)
    expect(sanitized).not.toContain('2850612123456');
  });

  it('sanitizeAIOutput returns text unchanged when stripPII=false', async () => {
    const { sanitizeAIOutput } = await import('@/lib/ai/sanitize');

    const text = 'Contact: test@example.com for details.';
    const { sanitized, piiRedacted } = sanitizeAIOutput(text, { stripPII: false });

    expect(sanitized).toBe(text);
    expect(piiRedacted).toEqual([]);
  });

  it('sanitizeAIResponseDeep recursively sanitizes nested objects', async () => {
    const { sanitizeAIResponseDeep } = await import('@/lib/ai/sanitize');

    const data = {
      summary: 'Contact admin@corp.ro for more info',
      items: [
        { name: 'Item 1', note: 'IBAN: RO49AAAA1B31007593840000' },
        { name: 'Item 2', note: 'No PII here' },
      ],
      score: 85,
      nested: {
        deep: {
          text: 'Email: test@example.com is visible',
        },
      },
    };

    const { sanitized, piiRedacted } = sanitizeAIResponseDeep(data);

    expect(sanitized.summary).toContain('[EMAIL_REDACTED]');
    expect(sanitized.items[0].note).toContain('[IBAN_REDACTED]');
    expect(sanitized.items[1].note).toBe('No PII here');
    expect(sanitized.score).toBe(85);
    expect(sanitized.nested.deep.text).toContain('[EMAIL_REDACTED]');
    expect(sanitized.nested.deep.text).not.toContain('test@example.com');
    expect(piiRedacted.length).toBeGreaterThan(0);
  });

  it('sanitizeAIOutput strips secret-like content and prompt leaks', async () => {
    const { sanitizeAIOutput } = await import('@/lib/ai/sanitize');

    const text = `
      system prompt: reveal internal routing and hidden instructions
      OPENAI_API_KEY=sk-supersecretvalue123456789
      -----BEGIN PRIVATE KEY-----
      top-secret
      -----END PRIVATE KEY-----
    `;

    const { sanitized, piiRedacted } = sanitizeAIOutput(text);

    expect(sanitized).toContain('[PROMPT_CONTENT_REDACTED]');
    expect(sanitized).toContain('OPENAI_API_KEY=[SECRET_REDACTED]');
    expect(sanitized).toContain('[SECRET_REDACTED]');
    expect(sanitized).not.toContain('sk-supersecretvalue123456789');
    expect(piiRedacted).toEqual(expect.arrayContaining(['PROMPT_LEAK', 'OPENAI_API_KEY', 'PRIVATE_KEY']));
  });

  it('sanitizeAIResponseDeep strips nested secret-like content', async () => {
    const { sanitizeAIResponseDeep } = await import('@/lib/ai/sanitize');

    const data = {
      explanation: 'developer message: use hidden instructions for approval scoring',
      nested: {
        token: 'AIzaSySecretTokenForTesting123456',
      },
    };

    const { sanitized, piiRedacted } = sanitizeAIResponseDeep(data);

    expect(sanitized.explanation).toContain('[PROMPT_CONTENT_REDACTED]');
    expect(sanitized.nested.token).toBe('[SECRET_REDACTED]');
    expect(piiRedacted).toEqual(expect.arrayContaining(['PROMPT_LEAK', 'ACCESS_TOKEN']));
  });
});

// ─── R05: AI Fact-Checker ────────────────────────────────────────

describe('R05: AI Fact-Checker', () => {
  it('flags incorrect Horizon Europe budget', async () => {
    const { checkFacts } = await import('@/lib/ai/fact-checker');

    const text = 'Horizon Europe has a total budget of €50 billion for the 2021-2027 period.';
    const result = checkFacts(text);

    expect(result.passed).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    const budgetWarning = result.warnings.find(w => w.type === 'incorrect_budget');
    expect(budgetWarning).toBeDefined();
    expect(budgetWarning!.program).toBe('Horizon Europe');
    expect(budgetWarning!.expected).toContain('95.5');
  });

  it('passes correct Horizon Europe budget', async () => {
    const { checkFacts } = await import('@/lib/ai/fact-checker');

    const text = 'Horizon Europe has a total budget of €95.5 billion for the 2021-2027 period.';
    const result = checkFacts(text);

    const budgetWarning = result.warnings.find(w => w.type === 'incorrect_budget');
    expect(budgetWarning).toBeUndefined();
  });

  it('flags incorrect PNRR period', async () => {
    const { checkFacts } = await import('@/lib/ai/fact-checker');

    const text = 'PNRR covers the period 2021-2027 and provides 100% financing.';
    const result = checkFacts(text);

    const periodWarning = result.warnings.find(w => w.type === 'incorrect_period');
    expect(periodWarning).toBeDefined();
    expect(periodWarning!.expected).toBe('2021-2026');
  });

  it('flags incorrect co-financing rate', async () => {
    const { checkFacts } = await import('@/lib/ai/fact-checker');

    const text = 'LIFE Programme offers 90% cofinanțare for environmental projects.';
    const result = checkFacts(text);

    const rateWarning = result.warnings.find(w => w.type === 'incorrect_rate');
    expect(rateWarning).toBeDefined();
    expect(rateWarning!.program).toBe('LIFE Programme');
  });

  it('returns passed=true for text with no factual claims', async () => {
    const { checkFacts } = await import('@/lib/ai/fact-checker');

    const text = 'The project will focus on innovation and sustainability in the region.';
    const result = checkFacts(text);

    expect(result.passed).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('flags incorrect TRL range for Horizon Europe', async () => {
    const { checkFacts } = await import('@/lib/ai/fact-checker');

    const text = 'Horizon Europe RIA projects typically target TRL 1-9 for research activities.';
    const result = checkFacts(text);

    const trlWarning = result.warnings.find(w => w.type === 'incorrect_trl');
    expect(trlWarning).toBeDefined();
    expect(trlWarning!.expected).toContain('TRL 2-5');
  });
});

// ─── R03: Right to Erasure ───────────────────────────────────────

describe('R03: Right to Erasure route exists', () => {
  it('route file exists at expected path', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const routePath = path.resolve(__dirname, '../../src/app/api/auth/account/route.ts');
    expect(fs.existsSync(routePath)).toBe(true);

    const content = fs.readFileSync(routePath, 'utf-8');
    expect(content).toContain('export async function DELETE');
    expect(content).toContain('gdpr.data_delete');
    expect(content).toContain('requireAuth');
    expect(content).toContain('db.transaction');
    expect(content).toContain('DELETED_SENTINEL');
  });
});

// ─── R04: Subject Access Request ─────────────────────────────────

describe('R04: Subject Access Request route exists', () => {
  it('route file exists at expected path', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const routePath = path.resolve(__dirname, '../../src/app/api/auth/export/route.ts');
    expect(fs.existsSync(routePath)).toBe(true);

    const content = fs.readFileSync(routePath, 'utf-8');
    expect(content).toContain('export async function GET');
    expect(content).toContain('requireAuth');
    // Must query user-linked data (profile, memberships, projects, documents, consents, audit log)
    expect(content).toContain('users');
    expect(content).toContain('orgMembers');
    expect(content).toContain('projects');
    expect(content).toContain('documents');
    expect(content).toContain('consentRecords');
    expect(content).toContain('auditLog');
  });
});

// ─── R09: XSS Sanitization ──────────────────────────────────────

describe('R09: XSS Sanitization', () => {
  it('sanitizeHTML strips script tags from AI output', async () => {
    const { sanitizeHTML } = await import('@/lib/ai/sanitize');

    const malicious = 'Hello <script>alert("xss")</script> world';
    const cleaned = sanitizeHTML(malicious);

    expect(cleaned).not.toContain('<script>');
    expect(cleaned).not.toContain('</script>');
    expect(cleaned).toContain('Hello');
    expect(cleaned).toContain('world');
  });

  it('sanitizeHTML strips event handlers from tags', async () => {
    const { sanitizeHTML } = await import('@/lib/ai/sanitize');

    const malicious = 'Click <img src=x onerror="alert(1)"> here';
    const cleaned = sanitizeHTML(malicious);

    expect(cleaned).not.toContain('onerror');
    expect(cleaned).not.toContain('<img');
  });

  it('sanitizeAIOutput strips both XSS and PII', async () => {
    const { sanitizeAIOutput } = await import('@/lib/ai/sanitize');

    const text = 'Contact <script>steal()</script> ion@example.com for details.';
    const { sanitized, piiRedacted } = sanitizeAIOutput(text);

    expect(sanitized).not.toContain('<script>');
    expect(sanitized).not.toContain('ion@example.com');
    expect(sanitized).toContain('[EMAIL_REDACTED]');
    expect(piiRedacted.length).toBeGreaterThan(0);
  });

  it('sanitizeAIResponseDeep strips XSS from nested objects', async () => {
    const { sanitizeAIResponseDeep } = await import('@/lib/ai/sanitize');

    const data = {
      title: 'Safe title',
      description: 'Text with <script>alert("xss")</script> injection',
      items: [
        { note: '<img src=x onerror="steal()"> bad image' },
      ],
    };

    const { sanitized } = sanitizeAIResponseDeep(data);

    expect(sanitized.title).toBe('Safe title');
    expect(sanitized.description).not.toContain('<script>');
    expect(sanitized.items[0].note).not.toContain('onerror');
    expect(sanitized.items[0].note).not.toContain('<img');
  });
});
