import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// vi.hoisted ensures the mock variable is available when the vi.mock factory runs
// (vi.mock factories are hoisted before variable assignments in the file)
const { verifyIdTokenMock } = vi.hoisted(() => ({ verifyIdTokenMock: vi.fn() }));

vi.mock('google-auth-library', () => {
  class OAuth2Client {
    verifyIdToken(...args: unknown[]) {
      return verifyIdTokenMock(...args);
    }
  }
  return { OAuth2Client };
});

import { verifySchedulerOIDC, isSchedulerBearerRequest } from '@/lib/auth/scheduler';

const SA = 'fondeu-scheduler@eufunding.iam.gserviceaccount.com';
const AUDIENCE = 'https://example.run.app/api/v1/admin/discovery/run';

const makeReq = (authHeader?: string): NextRequest =>
  ({
    headers: new Headers(authHeader ? { authorization: authHeader } : {}),
  }) as unknown as NextRequest;

beforeEach(() => verifyIdTokenMock.mockReset());

describe('verifySchedulerOIDC', () => {
  it('returns null when no Authorization header is present', async () => {
    const result = await verifySchedulerOIDC(makeReq(), AUDIENCE, SA);
    expect(result).toBeNull();
    expect(verifyIdTokenMock).not.toHaveBeenCalled();
  });

  it('returns null when the header is not a Bearer token', async () => {
    const result = await verifySchedulerOIDC(makeReq('Basic abc'), AUDIENCE, SA);
    expect(result).toBeNull();
  });

  it('returns scheduler source for a valid token', async () => {
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({ email: SA, email_verified: true }),
    });
    const result = await verifySchedulerOIDC(makeReq('Bearer abc.def.ghi'), AUDIENCE, SA);
    expect(result).toEqual({ source: 'scheduler' });
    expect(verifyIdTokenMock).toHaveBeenCalledWith({
      idToken: 'abc.def.ghi',
      audience: AUDIENCE,
    });
  });

  it('throws UNAUTHORIZED when verifyIdToken rejects', async () => {
    // Note: mockRejectedValueOnce is used (not mockRejectedValue) due to a Vitest 4
    // quirk where persistent mockImplementation(() => Promise.reject(...)) causes
    // Vitest to flag the rejection as unhandled even when it is caught.
    verifyIdTokenMock.mockRejectedValueOnce(new Error('invalid signature'));
    await expect(verifySchedulerOIDC(makeReq('Bearer xxx'), AUDIENCE, SA)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('throws UNAUTHORIZED when email does not match expected service account', async () => {
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({ email: 'attacker@x.iam.gserviceaccount.com', email_verified: true }),
    });
    await expect(verifySchedulerOIDC(makeReq('Bearer xxx'), AUDIENCE, SA)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('throws UNAUTHORIZED when email is not verified', async () => {
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({ email: SA, email_verified: false }),
    });
    await expect(verifySchedulerOIDC(makeReq('Bearer xxx'), AUDIENCE, SA)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('throws UNAUTHORIZED when payload is null', async () => {
    verifyIdTokenMock.mockResolvedValue({ getPayload: () => null });
    await expect(verifySchedulerOIDC(makeReq('Bearer xxx'), AUDIENCE, SA)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

describe('isSchedulerBearerRequest', () => {
  it('returns true for POST + matching path + Bearer', () => {
    expect(
      isSchedulerBearerRequest('/api/v1/admin/discovery/run', 'POST', 'Bearer abc'),
    ).toBe(true);
  });

  it('returns false for non-matching path', () => {
    expect(isSchedulerBearerRequest('/api/v1/projects', 'POST', 'Bearer abc')).toBe(false);
  });

  it('returns false for non-POST method', () => {
    expect(
      isSchedulerBearerRequest('/api/v1/admin/discovery/run', 'GET', 'Bearer abc'),
    ).toBe(false);
  });

  it('returns false for missing Bearer', () => {
    expect(
      isSchedulerBearerRequest('/api/v1/admin/discovery/run', 'POST', null),
    ).toBe(false);
    expect(
      isSchedulerBearerRequest('/api/v1/admin/discovery/run', 'POST', 'Basic abc'),
    ).toBe(false);
  });
});
