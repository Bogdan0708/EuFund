import { describe, it, expect } from 'vitest';
import { parseEligibilityCriteria, type ECFundingCall } from '@/lib/integrations/ec-portal/client';

describe('EC Funding Portal Integration', () => {
  describe('Eligibility criteria parsing', () => {
    it('detects SME eligibility', () => {
      const call: ECFundingCall = {
        identifier: 'TEST-001',
        title: 'Test Call',
        description: 'Open to SMEs and small and medium enterprises in EU member states',
        programme: 'HORIZON',
        status: 'open',
        openingDate: '2026-01-01',
        deadlineDate: '2026-06-01',
        budget: 5000000,
        currency: 'EUR',
        topics: [],
        url: 'https://example.com',
      };
      const criteria = parseEligibilityCriteria(call);
      expect(criteria.entityTypes).toContain('SME');
      expect(criteria.countries).toContain('EU-27');
      expect(criteria.maxBudget).toBe(5000000);
    });

    it('detects research institution eligibility', () => {
      const call: ECFundingCall = {
        identifier: 'TEST-002',
        title: 'Research Call',
        description: 'For universities and research institutions, including NGOs and civil society',
        programme: 'HORIZON',
        status: 'open',
        openingDate: '2026-01-01',
        deadlineDate: '2026-06-01',
        budget: null,
        currency: 'EUR',
        topics: [],
        url: 'https://example.com',
      };
      const criteria = parseEligibilityCriteria(call);
      expect(criteria.entityTypes).toContain('RESEARCH');
      expect(criteria.entityTypes).toContain('NGO');
    });

    it('handles calls with no clear eligibility text', () => {
      const call: ECFundingCall = {
        identifier: 'TEST-003',
        title: 'Generic Call',
        description: 'A funding opportunity',
        programme: 'LIFE',
        status: 'open',
        openingDate: '2026-01-01',
        deadlineDate: '2026-06-01',
        budget: null,
        currency: 'EUR',
        topics: [],
        url: 'https://example.com',
      };
      const criteria = parseEligibilityCriteria(call);
      expect(criteria.entityTypes).toHaveLength(0);
      expect(criteria.countries).toHaveLength(0);
    });
  });
});
