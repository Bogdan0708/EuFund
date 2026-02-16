'use client';

import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createProjectSchema, type CreateProjectInput } from '@/lib/validators';
import { useState } from 'react';

export default function NewProjectPage() {
  const t = useTranslations('project');
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      orgId: '', // Will be set from user's org
    },
  });

  const onSubmit = async (data: CreateProjectInput) => {
    try {
      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) setSuccess(true);
    } catch (err) {
      console.error('Unhandled error:', err);
    }
  };

  if (success) {
    return (
      <div className="rounded-xl bg-white p-8 shadow text-center">
        <h1 className="text-2xl font-bold text-success mb-4">✓ Proiect creat cu succes!</h1>
        <a href="/ro/proiecte" className="text-brand-500 hover:underline">Înapoi la proiecte</a>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('new')}</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl space-y-6 rounded-xl bg-white p-8 shadow">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('title')} *</label>
          <input
            {...register('title')}
            placeholder="ex: Digitalizarea proceselor de producție în IMM"
            className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-brand-500 focus:outline-none"
          />
          {errors.title && <p className="text-sm text-danger mt-1">{errors.title.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('acronym')}</label>
          <input
            {...register('acronym')}
            placeholder="ex: DIGIPROD"
            className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-brand-500 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Data de început</label>
            <input type="date" {...register('startDate')} className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-brand-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Data de sfârșit</label>
            <input type="date" {...register('endDate')} className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-brand-500 focus:outline-none" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Durata (luni)</label>
          <input
            type="number"
            {...register('durationMonths', { valueAsNumber: true })}
            placeholder="ex: 24"
            className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-brand-500 focus:outline-none"
          />
        </div>

        <input type="hidden" {...register('orgId')} />

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-lg bg-brand-500 py-3 text-white font-medium hover:bg-brand-600 transition disabled:opacity-50"
        >
          {isSubmitting ? 'Se creează...' : t('create')}
        </button>
      </form>
    </div>
  );
}
