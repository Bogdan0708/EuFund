'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { GlassCard } from '@/components/glass/GlassCard';
import { GlassInput } from '@/components/glass/GlassInput';
import { GlassButton } from '@/components/glass/GlassButton';

export default function ResetPasswordPage() {
  const params = useParams();
  const locale = (params.locale as string) || 'ro';
  const isRo = locale !== 'en';

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const t = {
    title: isRo ? 'Resetare parolă' : 'Reset password',
    subtitle: isRo
      ? 'Introduceți email-ul și vă vom trimite instrucțiunile de resetare.'
      : 'Enter your email and we will send you reset instructions.',
    emailPlaceholder: isRo ? 'adresa@exemplu.ro' : 'you@example.com',
    submit: isRo ? 'Trimite instrucțiuni' : 'Send instructions',
    loading: isRo ? 'Se trimite…' : 'Sending…',
    backToLogin: isRo ? 'Înapoi la autentificare' : 'Back to sign in',
    successMsg: isRo
      ? 'Dacă există un cont cu acest email, veți primi instrucțiunile de resetare.'
      : 'If an account exists with this email, you will receive reset instructions.',
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError(isRo ? 'Introduceți adresa de email.' : 'Enter your email address.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      // Always show success to avoid email enumeration
      setSent(true);
    } catch {
      setError(isRo ? 'Eroare de rețea. Încercați din nou.' : 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-base)]">
      <GlassCard
        hover={false}
        className="w-full max-w-[400px] p-10 flex flex-col gap-4"
      >
        {/* Title */}
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)] tracking-tight">
            {t.title}
          </h1>
          <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
            {t.subtitle}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-3 rounded-[var(--input-radius)] bg-[rgba(239,68,68,0.12)] border border-[rgba(239,68,68,0.25)] text-[var(--danger)] text-sm">
            {error}
          </div>
        )}

        {/* Success */}
        {sent ? (
          <div className="px-4 py-3 rounded-[var(--input-radius)] bg-[rgba(34,197,94,0.1)] border border-[rgba(34,197,94,0.25)] text-[var(--success)] text-sm text-center">
            {t.successMsg}
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
            <GlassInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.emailPlaceholder}
              autoComplete="email"
              required
            />
            <GlassButton
              type="submit"
              variant="accent"
              size="md"
              disabled={loading}
              className="w-full"
            >
              {loading ? t.loading : t.submit}
            </GlassButton>
          </form>
        )}

        {/* Back to login */}
        <p className="text-center text-sm text-[var(--text-secondary)]">
          <Link
            href={`/${locale}/autentificare`}
            className="text-[var(--accent)] hover:brightness-110 transition-all"
          >
            {t.backToLogin}
          </Link>
        </p>
      </GlassCard>
    </main>
  );
}
