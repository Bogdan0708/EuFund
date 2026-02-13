import { describe, it, expect } from 'vitest';
import { resolveCelexUrl, KEY_FUNDING_LEGISLATION } from '@/lib/integrations/eurlex/client';

describe('EUR-Lex Integration', () => {
  describe('CELEX URL resolution', () => {
    it('generates correct Romanian URL', () => {
      const url = resolveCelexUrl('32016R0679', 'ro');
      expect(url).toBe('https://eur-lex.europa.eu/legal-content/RO/TXT/?uri=CELEX:32016R0679');
    });

    it('generates correct English URL', () => {
      const url = resolveCelexUrl('32016R0679', 'en');
      expect(url).toBe('https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679');
    });
  });

  describe('Key legislation references', () => {
    it('has all required funding legislation', () => {
      expect(KEY_FUNDING_LEGISLATION.CPR_2021).toBe('32021R1060');
      expect(KEY_FUNDING_LEGISLATION.GDPR).toBe('32016R0679');
      expect(KEY_FUNDING_LEGISLATION.HORIZON_EUROPE).toBe('32021R0695');
      expect(KEY_FUNDING_LEGISLATION.EIDAS).toBe('32014R0910');
    });

    it('has valid CELEX format', () => {
      Object.values(KEY_FUNDING_LEGISLATION).forEach((celex) => {
        expect(celex).toMatch(/^3\d{4}[A-Z]\d{4}$/);
      });
    });
  });
});
