import { and, eq, gte, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import { notifications, users } from '@/lib/db/schema';
import { FREE_TRIAL_DAYS } from '@/lib/billing/trial';
import { sendEmail } from '@/lib/email/transporter';
import { billingTrialLifecycleEmail } from '@/lib/email/templates';
import { logger } from '@/lib/logger';

type EmailLocale = 'ro' | 'en';
type TrialLifecycleStage = 'trial_7_days' | 'trial_1_day' | 'trial_expired';

interface TrialCandidate {
  id: string;
  email: string;
  fullName: string;
  preferredLang: string | null;
  createdAt: Date | null;
}

interface RunOptions {
  dryRun?: boolean;
  now?: Date;
  baseUrl?: string;
}

interface RunResult {
  dryRun: boolean;
  processed: number;
  matched: number;
  emailed: number;
  skippedExisting: number;
  failed: number;
}

const log = logger.child({ component: 'trial-notifications' });
const DAY_MS = 24 * 60 * 60 * 1000;

const STAGE_CONFIG: Record<TrialLifecycleStage, { dayOffset: number; titleRo: string; titleEn: string }> = {
  trial_7_days: {
    dayOffset: FREE_TRIAL_DAYS - 7,
    titleRo: 'Trial Pro FondEU: 7 zile ramase',
    titleEn: 'FondEU Pro trial: 7 days left',
  },
  trial_1_day: {
    dayOffset: FREE_TRIAL_DAYS - 1,
    titleRo: 'Trial Pro FondEU: 1 zi ramasa',
    titleEn: 'FondEU Pro trial: 1 day left',
  },
  trial_expired: {
    dayOffset: FREE_TRIAL_DAYS,
    titleRo: 'Trial Pro FondEU: trial expirat',
    titleEn: 'FondEU Pro trial expired',
  },
};

function normalizeLocale(value: string | null | undefined): EmailLocale {
  return value === 'en' ? 'en' : 'ro';
}

function dayBounds(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(start.getTime() + DAY_MS);
  return { start, end };
}

function buildBillingUrl(baseUrl: string, locale: EmailLocale): string {
  return `${baseUrl}/${locale}/billing`;
}

async function wasNotificationAlreadySentToday(userId: string, title: string, start: Date, end: Date): Promise<boolean> {
  const existing = await db.query.notifications.findFirst({
    where: and(
      eq(notifications.userId, userId),
      eq(notifications.titleRo, title),
      gte(notifications.createdAt, start),
      lt(notifications.createdAt, end),
    ),
  });

  return Boolean(existing);
}

async function enqueueLifecycleNotification(
  candidate: TrialCandidate,
  stage: TrialLifecycleStage,
  now: Date,
  baseUrl: string,
  dryRun: boolean,
): Promise<'emailed' | 'skipped_existing' | 'failed'> {
  const locale = normalizeLocale(candidate.preferredLang);
  const config = STAGE_CONFIG[stage];
  const { start, end } = dayBounds(now);
  const title = locale === 'en' ? config.titleEn : config.titleRo;

  if (await wasNotificationAlreadySentToday(candidate.id, title, start, end)) {
    return 'skipped_existing';
  }

  if (dryRun) {
    return 'emailed';
  }

  const billingUrl = buildBillingUrl(baseUrl, locale);
  const template = billingTrialLifecycleEmail(candidate.fullName, billingUrl, stage, locale);
  const sent = await sendEmail({
    to: candidate.email,
    subject: template.subject,
    html: template.html,
  });

  await db.insert(notifications).values({
    userId: candidate.id,
    type: 'system',
    titleRo: title,
    bodyRo: template.subject,
    link: `/${locale}/billing`,
    sentEmail: sent,
  });

  return sent ? 'emailed' : 'failed';
}

function stageForUser(createdAt: Date, now: Date): TrialLifecycleStage | null {
  const createdDay = Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth(), createdAt.getUTCDate());
  const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysSinceSignup = Math.floor((currentDay - createdDay) / DAY_MS);

  if (daysSinceSignup === STAGE_CONFIG.trial_7_days.dayOffset) return 'trial_7_days';
  if (daysSinceSignup === STAGE_CONFIG.trial_1_day.dayOffset) return 'trial_1_day';
  if (daysSinceSignup === STAGE_CONFIG.trial_expired.dayOffset) return 'trial_expired';
  return null;
}

export async function runTrialLifecycleNotifications(options: RunOptions = {}): Promise<RunResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? true;
  const baseUrl = options.baseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  const candidates = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      preferredLang: users.preferredLang,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(
      eq(users.tier, 'free'),
      eq(users.subscriptionStatus, 'none'),
      eq(users.emailVerified, true),
    ));

  const result: RunResult = {
    dryRun,
    processed: candidates.length,
    matched: 0,
    emailed: 0,
    skippedExisting: 0,
    failed: 0,
  };

  for (const candidate of candidates) {
    if (!(candidate.createdAt instanceof Date) || Number.isNaN(candidate.createdAt.getTime())) {
      continue;
    }

    const stage = stageForUser(candidate.createdAt, now);
    if (!stage) {
      continue;
    }

    result.matched += 1;
    const status = await enqueueLifecycleNotification(candidate, stage, now, baseUrl, dryRun);
    if (status === 'emailed') result.emailed += 1;
    if (status === 'skipped_existing') result.skippedExisting += 1;
    if (status === 'failed') result.failed += 1;
  }

  log.info({ result }, '[trial-notifications] completed');
  return result;
}
