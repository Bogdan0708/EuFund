import { describe, expect, it } from 'vitest';
import { generateComplianceTasksFromGhid } from '@/lib/compliance/ghid-task-generator';

describe('Ghid Task Generator', () => {
  it('extracts actionable compliance tasks from guide text', () => {
    const text = `
    Solicitantul trebuie să depună declarația privind eligibilitatea cheltuielilor.
    Este obligatoriu ca bugetul să includă cofinanțarea minimă de 10%.
    Beneficiarul se va asigura că raportul tehnic trimestrial este transmis în termen.
    Documentația va include anexa privind DNSH și indicatorii de rezultat.
    `;

    const result = generateComplianceTasksFromGhid(
      '123e4567-e89b-42d3-a456-426614174000',
      text.repeat(5),
    );

    expect(result.summary.total).toBeGreaterThan(0);
    expect(result.summary.highRisk).toBeGreaterThan(0);
    expect(result.tasks[0].id).toMatch(/^ghid-/);
    expect(result.tasks[0].section).toBeTruthy();
    expect(result.tasks[0].sourceRef.clauseId).toMatch(/^GHID-/);
    expect(result.readiness.overallScore).toBeLessThanOrEqual(100);
    expect(result.readiness.sections.financial).toBeLessThanOrEqual(100);
  });
});
