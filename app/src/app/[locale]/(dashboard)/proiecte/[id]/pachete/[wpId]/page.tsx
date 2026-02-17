'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { WorkPackageForm } from '@/components/project/work-package-form';
import { Button } from '@/components/ui/button';
import type { CreateWorkPackageInput, WorkPackage } from '@/types/work-packages';

function unwrapApiData<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

export default function WorkPackageDetailPage() {
  const params = useParams<{ locale: string; id: string; wpId: string }>();
  const router = useRouter();
  const [workPackage, setWorkPackage] = useState<WorkPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const projectHref = `/${params.locale}/proiecte/${params.id}?tab=pachete`;

  useEffect(() => {
    async function loadWorkPackage() {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/api/v1/projects/${params.id}/work-packages/${params.wpId}`);
        if (!response.ok) {
          const responseData = await response.json().catch(() => null);
          const message = responseData?.error?.message || 'Nu am putut încărca pachetul de lucru.';
          throw new Error(message);
        }
        const payload = await response.json();
        setWorkPackage(unwrapApiData<WorkPackage>(payload));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Eroare necunoscută.');
      } finally {
        setLoading(false);
      }
    }

    loadWorkPackage();
  }, [params.id, params.wpId]);

  const handleSubmit = async (payload: CreateWorkPackageInput) => {
    setIsSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/v1/projects/${params.id}/work-packages/${params.wpId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const responseData = await response.json().catch(() => null);
        const message = responseData?.error?.message || 'Nu am putut actualiza pachetul de lucru.';
        throw new Error(message);
      }

      const responsePayload = await response.json();
      setWorkPackage(unwrapApiData<WorkPackage>(responsePayload));
      router.push(projectHref);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Eroare necunoscută.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    const confirmed = window.confirm('Sigur doriți să ștergeți acest pachet de lucru?');
    if (!confirmed) return;

    setIsDeleting(true);
    setError('');
    try {
      const response = await fetch(`/api/v1/projects/${params.id}/work-packages/${params.wpId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const responseData = await response.json().catch(() => null);
        const message = responseData?.error?.message || 'Nu am putut șterge pachetul de lucru.';
        throw new Error(message);
      }

      router.push(projectHref);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Eroare necunoscută.');
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Se încarcă pachetul de lucru...</div>;
  }

  if (!workPackage) {
    return (
      <div className="space-y-4">
        <p className="text-destructive">{error || 'Pachetul de lucru nu a fost găsit.'}</p>
        <Button type="button" variant="outline" onClick={() => router.push(projectHref)}>
          Înapoi la proiect
        </Button>
      </div>
    );
  }

  return (
    <WorkPackageForm
      title={`Editează pachet: ${workPackage.name}`}
      submitLabel="Salvează modificările"
      initialData={workPackage}
      onSubmit={handleSubmit}
      onDelete={handleDelete}
      isSubmitting={isSubmitting}
      isDeleting={isDeleting}
      error={error}
      showMilestoneCompletion
      backHref={projectHref}
    />
  );
}
