import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('GET /api/billing/checkout', () => {
  it('redirects to Stripe checkout for valid tier links', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.com' }),
    }));
    vi.doMock('@/lib/integrations/stripe/billing', () => ({
      createCheckoutSession: vi.fn().mockResolvedValue({
        sessionId: 'cs_test_123',
        url: 'https://checkout.stripe.com/c/pay/cs_test_123',
      }),
    }));

    const { GET } = await import('@/app/api/billing/checkout/route');
    const response = await GET(new NextRequest('http://localhost:3000/api/billing/checkout?tier=pro&interval=monthly'));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://checkout.stripe.com/c/pay/cs_test_123');
  });
});
