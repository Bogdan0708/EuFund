import { timingSafeEqual } from 'crypto';

export function constantTimeEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;

  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');

  if (aBuf.length !== bBuf.length) {
    return false;
  }

  return timingSafeEqual(aBuf, bBuf);
}
