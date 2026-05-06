import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

describe('Project start rate limits', () => {
  it('allows the agent entrypoint to continue when Redis is unavailable', () => {
    const source = readFileSync('src/app/api/ai/agent/route.ts', 'utf-8');

    expect(source).toContain("keyPrefix: 'agent-turn'");
    expect(source).toContain('failOpenOnError: true');
  });
});
