import { createHash } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('One-time token storage', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('stores password reset tokens hashed at rest', async () => {
    const insertValues = vi.fn();
    const tx = {
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    };

    vi.doMock('@/lib/db', () => ({
      db: { transaction: vi.fn(async (fn: Function) => fn(tx)) },
      schema: {
        passwordResetTokens: {
          userId: 'userId',
          token: 'token',
        },
      },
    }));

    const { generatePasswordResetToken } = await import('@/lib/email/password-reset');
    const token = await generatePasswordResetToken('user-1');

    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      token: sha256(token),
    }));
    expect(insertValues).not.toHaveBeenCalledWith(expect.objectContaining({ token }));
  });

  it('stores email verification tokens hashed at rest', async () => {
    const insertValues = vi.fn();
    const tx = {
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    };

    vi.doMock('@/lib/db', () => ({
      db: { transaction: vi.fn(async (fn: Function) => fn(tx)) },
      schema: {
        emailVerificationTokens: {
          userId: 'userId',
          token: 'token',
        },
      },
    }));

    const { generateVerificationToken } = await import('@/lib/email/verification');
    const token = await generateVerificationToken('user-1');

    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      token: sha256(token),
    }));
    expect(insertValues).not.toHaveBeenCalledWith(expect.objectContaining({ token }));
  });

  it('rejects plaintext password reset tokens (only hashed accepted)', async () => {
    const findFirst = vi.fn().mockResolvedValue(null); // Hash of plaintext won't match a stored plaintext

    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          passwordResetTokens: { findFirst },
        },
      },
      schema: {
        passwordResetTokens: {
          token: 'token',
          id: 'id',
        },
      },
    }));

    const { verifyPasswordResetToken } = await import('@/lib/email/password-reset');
    const userId = await verifyPasswordResetToken('legacy-plaintext-token');

    expect(userId).toBeNull();
    expect(findFirst).toHaveBeenCalled();
  });
});
