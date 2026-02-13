import { describe, it, expect, vi } from 'vitest';
import { validateCUI, validateCAEN, validatePhoneRO, normalizeDiacritics, NUTS2_REGIONS, COUNTIES } from '@/lib/utils/romanian';
import { validateCompanyEligibility, type ONRCCompanyData } from '@/lib/integrations/romanian/onrc';
import { verifyTaxEligibility, type ANAFTaxData } from '@/lib/integrations/romanian/anaf';

describe('Romanian CUI Validation', () => {
  it('validates correct CUIs', () => {
    // Known valid test CUIs
    expect(validateCUI('14399840')).toBe(true); // Romania's ANAF test CUI
  });

  it('rejects invalid CUIs', () => {
    expect(validateCUI('12345678')).toBe(false); // random invalid
    expect(validateCUI('abc')).toBe(false);
    expect(validateCUI('')).toBe(false);
  });

  it('handles RO prefix', () => {
    expect(validateCUI('RO14399840')).toBe(true);
    expect(validateCUI('ro14399840')).toBe(true);
  });
});

describe('CAEN Validation', () => {
  it('validates correct CAEN codes', () => {
    expect(validateCAEN('6201')).toBe(true);
    expect(validateCAEN('4711')).toBe(true);
  });

  it('rejects invalid CAEN codes', () => {
    expect(validateCAEN('123')).toBe(false);
    expect(validateCAEN('12345')).toBe(false);
    expect(validateCAEN('abcd')).toBe(false);
  });
});

describe('Romanian Phone Validation', () => {
  it('validates correct numbers', () => {
    expect(validatePhoneRO('0721234567')).toBe(true);
    expect(validatePhoneRO('+40721234567')).toBe(true);
    expect(validatePhoneRO('0040721234567')).toBe(true);
  });

  it('rejects invalid numbers', () => {
    expect(validatePhoneRO('123')).toBe(false);
    expect(validatePhoneRO('+1234567890')).toBe(false);
  });
});

describe('Romanian Diacritics', () => {
  it('normalizes sedilă to virgulă', () => {
    expect(normalizeDiacritics('Ţara mea frumoasă')).toBe('Țara mea frumoasă');
    expect(normalizeDiacritics('şcoală')).toBe('școală');
  });
});

describe('NUTS2 Regions', () => {
  it('has all 8 Romanian NUTS2 regions', () => {
    expect(Object.keys(NUTS2_REGIONS)).toHaveLength(8);
    expect(NUTS2_REGIONS.RO32).toBe('București-Ilfov');
  });
});

describe('Counties', () => {
  it('has 42 Romanian counties', () => {
    expect(COUNTIES).toHaveLength(42);
    expect(COUNTIES).toContain('București');
    expect(COUNTIES).toContain('Cluj');
  });
});

describe('Company Eligibility Validation', () => {
  const mockCompany: ONRCCompanyData = {
    cui: '14399840',
    name: 'TEST SRL',
    registrationNumber: 'J40/1234/2020',
    legalForm: 'SRL',
    status: 'active',
    address: { street: 'Str. Test 1', city: 'București', county: 'București' },
    caenPrimary: '6201',
    caenSecondary: ['6202', '6209'],
    foundedDate: '2020-01-15',
    isActive: true,
    lastUpdated: new Date().toISOString(),
  };

  it('marks active company as eligible', () => {
    const result = validateCompanyEligibility(mockCompany, { mustBeActive: true });
    expect(result.eligible).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('rejects inactive company', () => {
    const inactive = { ...mockCompany, isActive: false };
    const result = validateCompanyEligibility(inactive, { mustBeActive: true });
    expect(result.eligible).toBe(false);
  });

  it('validates legal form', () => {
    const result = validateCompanyEligibility(mockCompany, { allowedLegalForms: ['SA'] });
    expect(result.eligible).toBe(false);
    expect(result.issues[0]).toContain('SRL');
  });

  it('validates CAEN codes', () => {
    const result = validateCompanyEligibility(mockCompany, { requiredCaen: ['6201'] });
    expect(result.eligible).toBe(true);
  });

  it('rejects non-matching CAEN', () => {
    const result = validateCompanyEligibility(mockCompany, { requiredCaen: ['0111'] });
    expect(result.eligible).toBe(false);
  });
});

describe('Tax Eligibility Verification', () => {
  const activeTax: ANAFTaxData = {
    cui: 14399840,
    name: 'TEST SRL',
    address: 'Str. Test 1, București',
    county: 'București',
    isVatPayer: true,
    isSplitVat: false,
    isInactive: false,
    isReactivated: false,
    registrationStatus: 'INREGISTRAT',
    statusDate: '2020-01-15',
  };

  it('approves active company', () => {
    const result = verifyTaxEligibility(activeTax);
    expect(result.eligible).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('flags inactive company', () => {
    const inactive = { ...activeTax, isInactive: true };
    const result = verifyTaxEligibility(inactive);
    expect(result.eligible).toBe(false);
    expect(result.issues).toContain('Compania este declarată inactivă fiscal de ANAF');
  });

  it('warns about split VAT', () => {
    const splitVat = { ...activeTax, isSplitVat: true };
    const result = verifyTaxEligibility(splitVat);
    expect(result.eligible).toBe(false);
    expect(result.issues.some((i) => i.includes('defalcată'))).toBe(true);
  });
});
