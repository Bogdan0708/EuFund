'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterInput } from '@/lib/validators';

export default function RegisterPage() {
  const t = useTranslations('auth');
  const tv = useTranslations('validation');
  const [serverError, setServerError] = useState('');
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterInput) => {
    setServerError('');
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (res.ok) {
        setSuccess(true);
      } else {
        const body = await res.json();
        setServerError(body.error?.message || t('invalidCredentials'));
      }
    } catch {
      setServerError('Eroare de conexiune. Vă rugăm să încercați din nou.');
    }
  };

  if (success) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg text-center">
          <h1 className="mb-4 text-2xl font-bold text-success">✓ {t('accountCreated')}</h1>
          <a href="/ro/autentificare" className="text-brand-500 hover:underline">{t('login')}</a>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-8 shadow-lg">
        <h1 className="mb-6 text-2xl font-bold text-center text-brand-500">
          {t('register')}
        </h1>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('fullName')}</label>
            <input {...register('fullName')} className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-brand-500 focus:outline-none" />
            {errors.fullName && <p className="text-sm text-danger mt-1">{errors.fullName.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('email')}</label>
            <input type="email" {...register('email')} className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-brand-500 focus:outline-none" />
            {errors.email && <p className="text-sm text-danger mt-1">{errors.email.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('password')}</label>
            <input type="password" {...register('password')} className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-brand-500 focus:outline-none" />
            {errors.password && <p className="text-sm text-danger mt-1">{errors.password.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('confirmPassword')}</label>
            <input type="password" {...register('confirmPassword')} className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-brand-500 focus:outline-none" />
            {errors.confirmPassword && <p className="text-sm text-danger mt-1">{errors.confirmPassword.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Data nașterii</label>
            <input type="date" {...register('dateOfBirth')} className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-brand-500 focus:outline-none" />
            {errors.dateOfBirth && <p className="text-sm text-danger mt-1">{errors.dateOfBirth.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('phone')}</label>
            <input type="tel" {...register('phone')} className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-brand-500 focus:outline-none" />
            {errors.phone && <p className="text-sm text-danger mt-1">{errors.phone.message}</p>}
          </div>

          {/* Legal Consents - Required by GDPR + Law 190/2018 */}
          <div className="space-y-3 rounded-lg bg-gray-50 p-4">
            <h3 className="font-medium text-gray-700">Consimțăminte obligatorii</h3>

            <label className="flex items-start gap-2">
              <input type="checkbox" {...register('ageConfirmed')} className="mt-1" />
              <span className="text-sm">{t('ageConfirmation')}</span>
            </label>
            {errors.ageConfirmed && <p className="text-sm text-danger">{errors.ageConfirmed.message}</p>}

            <label className="flex items-start gap-2">
              <input type="checkbox" {...register('privacyConsent')} className="mt-1" />
              <span className="text-sm">{t('privacyConsent')}</span>
            </label>
            {errors.privacyConsent && <p className="text-sm text-danger">{errors.privacyConsent.message}</p>}

            <label className="flex items-start gap-2">
              <input type="checkbox" {...register('termsConsent')} className="mt-1" />
              <span className="text-sm">{t('termsConsent')}</span>
            </label>
            {errors.termsConsent && <p className="text-sm text-danger">{errors.termsConsent.message}</p>}

            <label className="flex items-start gap-2">
              <input type="checkbox" {...register('gdprConsent')} className="mt-1" />
              <span className="text-sm">{t('gdprConsent')}</span>
            </label>
            {errors.gdprConsent && <p className="text-sm text-danger">{errors.gdprConsent.message}</p>}
          </div>

          {serverError && <p className="text-sm text-danger">{serverError}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-brand-500 py-2 text-white font-medium hover:bg-brand-600 transition disabled:opacity-50"
          >
            {isSubmitting ? 'Se procesează...' : t('register')}
          </button>
        </form>
      </div>
    </main>
  );
}
