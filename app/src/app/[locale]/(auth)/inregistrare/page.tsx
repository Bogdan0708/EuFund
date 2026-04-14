'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { GlassCard } from '@/components/glass/GlassCard';
import { GlassInput } from '@/components/glass/GlassInput';
import { GlassButton } from '@/components/glass/GlassButton';

export default function RegisterPage() {
  const params = useParams();
  const router = useRouter();
  const locale = (params.locale as string) || 'ro';
  const isRo = locale !== 'en';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const t = {
    title: isRo ? 'Creează cont' : 'Create account',
    subtitle: isRo ? 'Platformă pentru finanțări europene' : 'EU funding platform',
    namePlaceholder: isRo ? 'Nume complet' : 'Full name',
    emailPlaceholder: isRo ? 'adresa@exemplu.ro' : 'you@example.com',
    passwordPlaceholder: isRo ? 'Parolă (min. 8 caractere)' : 'Password (min. 8 chars)',
    submit: isRo ? 'Înregistrare' : 'Register',
    loading: isRo ? 'Se creează contul…' : 'Creating account…',
    loginLink: isRo ? 'Ai deja cont? Autentifică-te' : 'Already have an account? Sign in',
    successMsg: isRo
      ? 'Cont creat! Verificați email-ul pentru a activa contul.'
      : 'Account created! Check your email to activate your account.',
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password) {
      setError(isRo ? 'Completați toate câmpurile.' : 'Please fill in all fields.');
      return;
    }
    if (password.length < 8) {
      setError(isRo ? 'Parola trebuie să aibă cel puțin 8 caractere.' : 'Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(
          isRo
            ? (data.messageRo ?? data.message ?? 'Eroare la înregistrare.')
            : (data.messageEn ?? data.message ?? 'Registration error.'),
        );
      } else {
        setSuccess(true);
        setTimeout(() => {
          router.push(`/${locale}/autentificare`);
        }, 3000);
      }
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
        {success && (
          <div className="px-4 py-3 rounded-[var(--input-radius)] bg-[rgba(34,197,94,0.1)] border border-[rgba(34,197,94,0.25)] text-[var(--success)] text-sm text-center">
            {t.successMsg}
          </div>
        )}

        {/* Form */}
        {!success && (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
            <GlassInput
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.namePlaceholder}
              autoComplete="name"
              required
            />
            <GlassInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.emailPlaceholder}
              autoComplete="email"
              required
            />
            <GlassInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t.passwordPlaceholder}
              autoComplete="new-password"
              required
            />
            <GlassButton
              type="submit"
              variant="accent"
              size="md"
              disabled={loading}
              className="w-full mt-1"
            >
              {loading ? t.loading : t.submit}
            </GlassButton>
          </form>
        )}

        {/* Login link */}
        <p className="text-center text-sm text-[var(--text-secondary)]">
          <Link
            href={`/${locale}/autentificare`}
            className="text-[var(--accent)] hover:brightness-110 transition-all"
          >
            {t.loginLink}
          </Link>
        </p>
      </GlassCard>
    </main>
  );
}
