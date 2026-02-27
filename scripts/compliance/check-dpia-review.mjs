import { readFileSync } from 'node:fs';

const src = readFileSync('app/src/lib/legal/dpia.ts', 'utf8');
const recordStart = src.indexOf('export const FONDEU_DPIA');
if (recordStart === -1) {
  throw new Error('Could not locate FONDEU_DPIA record in app/src/lib/legal/dpia.ts');
}
const recordSrc = src.slice(recordStart);

function extract(pattern, fieldName) {
  const match = recordSrc.match(pattern);
  if (!match) {
    throw new Error(`Could not parse ${fieldName} from app/src/lib/legal/dpia.ts`);
  }
  return match[1];
}

const status = extract(/status:\s*'([^']+)'/, 'status');
const dpoApproval = extract(/dpoApproval:\s*(true|false)/, 'dpoApproval') === 'true';
const nextReviewDateRaw = extract(/nextReviewDate:\s*'([^']+)'/, 'nextReviewDate');

const nextReviewDate = new Date(`${nextReviewDateRaw}T00:00:00Z`);
if (Number.isNaN(nextReviewDate.getTime())) {
  throw new Error(`Invalid nextReviewDate: ${nextReviewDateRaw}`);
}

const now = new Date();
const msPerDay = 24 * 60 * 60 * 1000;
const daysUntilReview = Math.floor((nextReviewDate.getTime() - now.getTime()) / msPerDay);

console.log(`DPIA status: ${status}`);
console.log(`DPO approval: ${dpoApproval}`);
console.log(`Next review date: ${nextReviewDateRaw}`);
console.log(`Days until next review: ${daysUntilReview}`);

if (status !== 'approved') {
  console.error('DPIA status must be approved.');
  process.exit(1);
}

if (!dpoApproval) {
  console.error('DPO approval must be true.');
  process.exit(1);
}

if (daysUntilReview < 0) {
  console.error('DPIA review is overdue.');
  process.exit(1);
}

if (daysUntilReview <= 30) {
  console.warn('DPIA review due in <= 30 days.');
}
