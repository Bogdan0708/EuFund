// ─── Romanian Text Utilities ─────────────────────────────────────
// Handles diacritics normalization (virgulă, not sedilă), formatting

/**
 * Normalize Romanian diacritics: replace sedilă (ş, ţ) with virgulă (ș, ț)
 * This is the correct form per Romanian Academy standards.
 */
export function normalizeDiacritics(text: string): string {
  return text
    .replace(/ş/g, 'ș')
    .replace(/Ş/g, 'Ș')
    .replace(/ţ/g, 'ț')
    .replace(/Ţ/g, 'Ț');
}

/**
 * Strip Romanian diacritics entirely.
 * Useful for legacy government systems (like some MySMIS modules) 
 * that don't support UTF-8 correctly.
 */
export function stripDiacritics(text: string): string {
  return text
    .replace(/[ăâ]/g, 'a')
    .replace(/[ĂÂ]/g, 'A')
    .replace(/[î]/g, 'i')
    .replace(/[Î]/g, 'I')
    .replace(/[șş]/g, 's')
    .replace(/[ȘŞ]/g, 'S')
    .replace(/[țţ]/g, 't')
    .replace(/[ȚŢ]/g, 'T');
}

/**
 * Format number in Romanian style: 1.234,56
 */
export function formatNumberRo(value: number, decimals = 2): string {
  return new Intl.NumberFormat('ro-RO', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Format currency (EUR) in Romanian style: 1.234,56 EUR
 */
export function formatCurrencyEur(value: number): string {
  return new Intl.NumberFormat('ro-RO', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(value);
}

/**
 * Format date in Romanian: 13 februarie 2026
 */
export function formatDateRo(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('ro-RO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

/**
 * Romanian county (județ) list
 */
export const COUNTIES = [
  'Alba', 'Arad', 'Argeș', 'Bacău', 'Bihor', 'Bistrița-Năsăud',
  'Botoșani', 'Brașov', 'Brăila', 'București', 'Buzău', 'Caraș-Severin',
  'Călărași', 'Cluj', 'Constanța', 'Covasna', 'Dâmbovița', 'Dolj',
  'Galați', 'Giurgiu', 'Gorj', 'Harghita', 'Hunedoara', 'Ialomița',
  'Iași', 'Ilfov', 'Maramureș', 'Mehedinți', 'Mureș', 'Neamț',
  'Olt', 'Prahova', 'Satu Mare', 'Sălaj', 'Sibiu', 'Suceava',
  'Teleorman', 'Timiș', 'Tulcea', 'Vaslui', 'Vâlcea', 'Vrancea',
] as const;

/**
 * NUTS2 Regions mapping
 */
export const NUTS2_REGIONS: Record<string, string> = {
  RO11: 'Nord-Vest',
  RO12: 'Centru',
  RO21: 'Nord-Est',
  RO22: 'Sud-Est',
  RO31: 'Sud-Muntenia',
  RO32: 'București-Ilfov',
  RO41: 'Sud-Vest Oltenia',
  RO42: 'Vest',
};

/**
 * Validate Romanian CUI (Cod Unic de Înregistrare)
 * Uses the official check digit algorithm
 */
export function validateCUI(cui: string): boolean {
  let cleaned = cui.toUpperCase().replace(/^RO/, '').trim();
  if (!/^\d{2,10}$/.test(cleaned)) return false;

  const weights = [7, 5, 3, 2, 1, 7, 5, 3, 2];
  cleaned = cleaned.padStart(10, '0');

  const digits = cleaned.split('').map(Number);
  const checkDigit = digits[9];

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += digits[i] * weights[i];
  }

  const remainder = (sum * 10) % 11;
  const expected = remainder === 10 ? 0 : remainder;

  return checkDigit === expected;
}

/**
 * Validate CAEN code (4-digit Romanian economic activity code)
 */
export function validateCAEN(code: string): boolean {
  return /^\d{4}$/.test(code.trim());
}

/**
 * Validate Romanian phone number
 */
export function validatePhoneRO(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');
  return /^(\+40|0040|0)[2-9]\d{8}$/.test(cleaned);
}
