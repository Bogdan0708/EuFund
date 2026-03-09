import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendEmail = vi.fn();
const findFirst = vi.fn();
const insertValues = vi.fn();
const insert = vi.fn(() => ({ values: insertValues }));
const selectLimit = vi.fn();
const selectWhere = vi.fn(() => ({ limit: selectLimit }));
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const select = vi.fn(() => ({ from: selectFrom }));

vi.mock('@/lib/db', () => ({
  db: {
    select,
    insert,
    query: {
      notifications: {
        findFirst,
      },
    },
  },
}));

vi.mock('@/lib/email/transporter', () => ({
  sendEmail,
}));

describe('trial lifecycle notifications', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'https://fondeu.example';
  });

  it('sends reminders for users who hit the 7-day and 1-day trial windows', async () => {
    const now = new Date('2026-03-09T10:00:00.000Z');

    selectFrom.mockReturnValueOnce({
      where: vi.fn().mockResolvedValue([
        {
          id: 'u-7',
          email: 'seven@example.com',
          fullName: 'Seven Days',
          preferredLang: 'en',
          createdAt: new Date('2026-02-14T00:00:00.000Z'),
        },
        {
          id: 'u-1',
          email: 'one@example.com',
          fullName: 'One Day',
          preferredLang: 'ro',
          createdAt: new Date('2026-02-08T00:00:00.000Z'),
        },
      ]),
    });
    findFirst.mockResolvedValue(null);
    sendEmail.mockResolvedValue(true);

    const { runTrialLifecycleNotifications } = await import('@/lib/billing/trial-notifications');
    const result = await runTrialLifecycleNotifications({ now, dryRun: false });

    expect(result.matched).toBe(2);
    expect(result.emailed).toBe(2);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it('skips duplicate notifications already created the same day', async () => {
    const now = new Date('2026-03-09T10:00:00.000Z');

    selectFrom.mockReturnValueOnce({
      where: vi.fn().mockResolvedValue([
        {
          id: 'u-7',
          email: 'seven@example.com',
          fullName: 'Seven Days',
          preferredLang: 'en',
          createdAt: new Date('2026-02-14T00:00:00.000Z'),
        },
      ]),
    });
    findFirst.mockResolvedValue({ id: 'existing' });

    const { runTrialLifecycleNotifications } = await import('@/lib/billing/trial-notifications');
    const result = await runTrialLifecycleNotifications({ now, dryRun: false });

    expect(result.matched).toBe(1);
    expect(result.skippedExisting).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});
