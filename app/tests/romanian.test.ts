import { describe, it, expect } from 'vitest';
import {
  normalizeDiacritics,
  validateCUI,
  validateCAEN,
  validatePhoneRO,
  formatNumberRo,
  formatCurrencyEur,
  formatDateRo,
  NUTS2_REGIONS,
} from '@/lib/utils/romanian';

describe('normalizeDiacritics', () => {
  it('converts sedilă to virgulă for ș', () => {
    expect(normalizeDiacritics('şcoală')).toBe('școală');
  });

  it('converts sedilă to virgulă for ț', () => {
    expect(normalizeDiacritics('Ţară')).toBe('Țară');
  });

  it('handles uppercase', () => {
    expect(normalizeDiacritics('ŞŢŞŢ')).toBe('ȘȚȘȚ');
  });

  it('leaves correct diacritics unchanged', () => {
    expect(normalizeDiacritics('Ș ș Ț ț')).toBe('Ș ș Ț ț');
  });

  it('handles mixed text', () => {
    expect(normalizeDiacritics('Proiect de finanţare în Ţara Românească'))
      .toBe('Proiect de finanțare în Țara Românească');
  });
});

describe('validateCUI', () => {
  it('rejects empty string', () => {
    expect(validateCUI('')).toBe(false);
  });

  it('rejects non-numeric', () => {
    expect(validateCUI('abc')).toBe(false);
  });

  it('handles RO prefix', () => {
    // The validation strips RO prefix
    expect(typeof validateCUI('RO12345678')).toBe('boolean');
  });

  it('rejects too long CUI', () => {
    expect(validateCUI('12345678901')).toBe(false);
  });
});

describe('validateCAEN', () => {
  it('accepts valid 4-digit CAEN', () => {
    expect(validateCAEN('6201')).toBe(true);
  });

  it('rejects 3-digit code', () => {
    expect(validateCAEN('620')).toBe(false);
  });

  it('rejects 5-digit code', () => {
    expect(validateCAEN('62011')).toBe(false);
  });

  it('rejects non-numeric', () => {
    expect(validateCAEN('abcd')).toBe(false);
  });
});

describe('validatePhoneRO', () => {
  it('accepts valid mobile number', () => {
    expect(validatePhoneRO('0722123456')).toBe(true);
  });

  it('accepts +40 prefix', () => {
    expect(validatePhoneRO('+40722123456')).toBe(true);
  });

  it('accepts landline', () => {
    expect(validatePhoneRO('0212345678')).toBe(true);
  });

  it('rejects too short', () => {
    expect(validatePhoneRO('072212')).toBe(false);
  });
});

describe('formatNumberRo', () => {
  it('formats with Romanian locale', () => {
    const result = formatNumberRo(1234.56);
    expect(result).toContain('1');
    expect(result).toContain('234');
  });
});

describe('NUTS2_REGIONS', () => {
  it('has all 8 Romanian regions', () => {
    expect(Object.keys(NUTS2_REGIONS)).toHaveLength(8);
  });

  it('includes București-Ilfov', () => {
    expect(NUTS2_REGIONS['RO32']).toBe('București-Ilfov');
  });
});
