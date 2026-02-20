'use client';

import { csrfFetch } from '@/lib/csrf/client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { GanttChart } from '@/components/project/gantt-chart';
import type { GanttData } from '@/types/timeline';

export default function GanttPage() {
  const params = useParams();
  const [data, setData] = useState<GanttData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/v1/projects/${params.id}/timeline`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [params.id]);

  const handleUpdate = async (taskId: string, updates: { startDate: string; endDate: string }) => {
    await csrfFetch(`/api/v1/projects/${params.id}/timeline/${taskId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const res = await fetch(`/api/v1/projects/${params.id}/timeline`);
    if (res.ok) setData(await res.json());
  };

  if (loading) return <div className="p-12 text-center text-muted-foreground">Se încarcă...</div>;
  if (!data) return <div className="p-12 text-center text-muted-foreground">Nu există date de timeline.</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">📊 Diagrama Gantt</h1>
      <GanttChart data={data} onTaskUpdate={handleUpdate} />
    </div>
  );
}
