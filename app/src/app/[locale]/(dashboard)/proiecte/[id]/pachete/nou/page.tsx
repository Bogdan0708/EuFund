'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { WorkPackageForm } from '@/components/project/work-package-form';
import type { CreateWorkPackageInput } from '@/types/work-packages';

export default function CreateWorkPackagePage() {
  const params = useParams<{ locale: string; id: string }>();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const projectHref = `/${params.locale}/proiecte/${params.id}?tab=pachete`;

  const handleSubmit = async (payload: CreateWorkPackageInput) => {
    setIsSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/v1/projects/${params.id}/work-packages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const responseData = await response.json().catch(() => null);
        const message = responseData?.error?.message || 'Nu am putut crea pachetul de lucru.';
        throw new Error(message);
      }

      router.push(projectHref);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Eroare necunoscută.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <WorkPackageForm
      title="Adaugă pachet de lucru"
      submitLabel="Creează pachet"
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
      error={error}
      backHref={projectHref}
    />
  );
}
