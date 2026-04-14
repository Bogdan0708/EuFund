import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a currency amount using Romanian locale.
 * @param amount - numeric value
 * @param currency - ISO 4217 code (default 'EUR')
 * @param fractionDigits - max fraction digits (default 0)
 */
export function formatCurrency(
  amount: number,
  currency: string = 'EUR',
  fractionDigits: number = 0,
): string {
  return new Intl.NumberFormat('ro-RO', {
    style: 'currency',
    currency,
    maximumFractionDigits: fractionDigits,
  }).format(amount);
}

/**
 * Human-friendly relative time string.
 * Uses Romanian-style short labels: "acum", "5m", "2h", "3z", "1l".
 */
export function relativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'acum';
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMs / 3_600_000);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffMs / 86_400_000);
  if (diffD < 30) return `${diffD}z`;
  return `${Math.floor(diffD / 30)}l`;
}

export function getBaseUrl() {
  if (typeof window !== 'undefined') return ''; // browser should use relative url
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT || 3000}`;
}
