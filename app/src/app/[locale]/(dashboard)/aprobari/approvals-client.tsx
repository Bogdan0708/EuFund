'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';

type PendingProject = {
  id: string;
  title: string;
  acronym: string | null;
  updatedAt: string | null;
  createdByName: string | null;
};

function formatDate(date: string | null): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('ro-RO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

export function ApprovalsClient({
  orgId,
  initialProjects,
}: {
  orgId: string;
  initialProjects: PendingProject[];
}) {
  const [projects, setProjects] = useState<PendingProject[]>(initialProjects);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasProjects = useMemo(() => projects.length > 0, [projects]);

  async function submitDecision(projectId: string, decision: 'approve' | 'reject') {
    try {
      setBusyId(projectId);
      setError(null);

      const feedback = decision === 'reject'
        ? window.prompt('Feedback pentru retrimitere (opțional):') || undefined
        : undefined;

      const response = await fetch('/api/v1/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          projectId,
          decision,
          ...(feedback ? { feedback } : {}),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? 'Acțiunea a eșuat');
      }

      setProjects((current) => current.filter((project) => project.id !== projectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Acțiunea a eșuat');
    } finally {
      setBusyId(null);
    }
  }

  if (!hasProjects) {
    return (
      <p className="text-sm text-muted-foreground">
        Niciun proiect nu necesită aprobare în acest moment.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
      {projects.map((project) => {
        const isBusy = busyId === project.id;

        return (
          <div
            key={project.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div>
              <p className="font-medium">{project.title}</p>
              <p className="text-xs text-muted-foreground">
                {project.acronym ?? project.id.slice(0, 8)} • {project.createdByName ?? 'Necunoscut'} • {formatDate(project.updatedAt)}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <StatusBadge kind="project" value="verificare" />
              <Button
                size="sm"
                onClick={() => submitDecision(project.id, 'approve')}
                disabled={isBusy}
              >
                Aprobă
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => submitDecision(project.id, 'reject')}
                disabled={isBusy}
              >
                Respinge
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
