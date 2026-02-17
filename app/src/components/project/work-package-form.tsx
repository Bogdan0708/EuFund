'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type {
  CreateWorkPackageInput,
  Deliverable,
  Milestone,
  WorkPackage,
  WorkPackageStatus,
} from '@/types/work-packages';

type WorkPackageFormValues = {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  budgetAllocated: string;
  status: WorkPackageStatus;
  milestones: Milestone[];
  deliverables: Deliverable[];
};

interface WorkPackageFormProps {
  title: string;
  submitLabel: string;
  initialData?: Partial<WorkPackage>;
  onSubmit: (payload: CreateWorkPackageInput) => Promise<void>;
  onDelete?: () => Promise<void>;
  isSubmitting?: boolean;
  isDeleting?: boolean;
  error?: string;
  showMilestoneCompletion?: boolean;
  backHref?: string;
}

const STATUS_OPTIONS: Array<{ value: WorkPackageStatus; label: string }> = [
  { value: 'planned', label: 'Planificat' },
  { value: 'active', label: 'Activ' },
  { value: 'completed', label: 'Finalizat' },
  { value: 'delayed', label: 'Întârziat' },
  { value: 'cancelled', label: 'Anulat' },
];

const DELIVERABLE_TYPES = ['raport', 'software', 'prototip', 'studiu', 'altul'];

function sanitizeDate(value?: string): string {
  if (!value) return '';
  return value.includes('T') ? value.split('T')[0] : value;
}

export function WorkPackageForm({
  title,
  submitLabel,
  initialData,
  onSubmit,
  onDelete,
  isSubmitting = false,
  isDeleting = false,
  error,
  showMilestoneCompletion = false,
  backHref,
}: WorkPackageFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<WorkPackageFormValues>({
    name: initialData?.name || '',
    description: initialData?.description || '',
    startDate: sanitizeDate(initialData?.startDate),
    endDate: sanitizeDate(initialData?.endDate),
    budgetAllocated: initialData?.budgetAllocated !== undefined && initialData?.budgetAllocated !== null
      ? String(initialData.budgetAllocated)
      : '',
    status: initialData?.status || 'planned',
    milestones: (initialData?.milestones || []).map((milestone) => ({
      ...milestone,
      dueDate: sanitizeDate(milestone.dueDate),
    })),
    deliverables: (initialData?.deliverables || []).map((deliverable) => ({
      ...deliverable,
      dueDate: sanitizeDate(deliverable.dueDate),
    })),
  });

  const [milestoneDraft, setMilestoneDraft] = useState({ name: '', dueDate: '' });
  const [deliverableDraft, setDeliverableDraft] = useState({ name: '', type: 'raport', dueDate: '' });

  const milestoneStats = useMemo(() => {
    const total = values.milestones.length;
    const completed = values.milestones.filter((item) => item.completed).length;
    return { total, completed };
  }, [values.milestones]);

  const addMilestone = () => {
    if (!milestoneDraft.name.trim()) return;
    const milestone: Milestone = {
      id: crypto.randomUUID(),
      name: milestoneDraft.name.trim(),
      dueDate: milestoneDraft.dueDate,
      completed: false,
    };
    setValues((prev) => ({ ...prev, milestones: [...prev.milestones, milestone] }));
    setMilestoneDraft({ name: '', dueDate: '' });
  };

  const addDeliverable = () => {
    if (!deliverableDraft.name.trim()) return;
    const deliverable: Deliverable = {
      id: crypto.randomUUID(),
      name: deliverableDraft.name.trim(),
      type: deliverableDraft.type,
      dueDate: deliverableDraft.dueDate,
      completed: false,
    };
    setValues((prev) => ({ ...prev, deliverables: [...prev.deliverables, deliverable] }));
    setDeliverableDraft({ name: '', type: 'raport', dueDate: '' });
  };

  const removeMilestone = (id: string) => {
    setValues((prev) => ({ ...prev, milestones: prev.milestones.filter((item) => item.id !== id) }));
  };

  const removeDeliverable = (id: string) => {
    setValues((prev) => ({ ...prev, deliverables: prev.deliverables.filter((item) => item.id !== id) }));
  };

  const toggleMilestoneCompleted = (id: string) => {
    setValues((prev) => ({
      ...prev,
      milestones: prev.milestones.map((item) =>
        item.id === id ? { ...item, completed: !item.completed } : item,
      ),
    }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!values.name.trim()) return;

    const payload: CreateWorkPackageInput = {
      name: values.name.trim(),
      description: values.description.trim() || undefined,
      startDate: values.startDate || undefined,
      endDate: values.endDate || undefined,
      budgetAllocated: values.budgetAllocated ? Number(values.budgetAllocated) : undefined,
      status: values.status,
      milestones: values.milestones,
      deliverables: values.deliverables,
    };

    await onSubmit(payload);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{title}</h1>
        {backHref && (
          <Button type="button" variant="outline" onClick={() => router.push(backHref)}>
            ← Înapoi la proiect
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detalii pachet de lucru</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="name">Denumire pachet *</Label>
              <Input
                id="name"
                value={values.name}
                onChange={(event) => setValues((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Ex: WP1 - Management proiect"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descriere</Label>
              <Textarea
                id="description"
                value={values.description}
                onChange={(event) => setValues((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Descriere activități, rezultate, responsabilități"
                rows={4}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="startDate">Data început</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={values.startDate}
                  onChange={(event) => setValues((prev) => ({ ...prev, startDate: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">Data sfârșit</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={values.endDate}
                  onChange={(event) => setValues((prev) => ({ ...prev, endDate: event.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="budgetAllocated">Buget alocat (EUR)</Label>
                <Input
                  id="budgetAllocated"
                  type="number"
                  min="0"
                  step="0.01"
                  value={values.budgetAllocated}
                  onChange={(event) => setValues((prev) => ({ ...prev, budgetAllocated: event.target.value }))}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <select
                  id="status"
                  value={values.status}
                  onChange={(event) => setValues((prev) => ({ ...prev, status: event.target.value as WorkPackageStatus }))}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-3">
              <Label>Jaloane</Label>
              {values.milestones.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nu există jaloane adăugate.</p>
              ) : (
                <div className="space-y-2">
                  {values.milestones.map((milestone) => (
                    <div key={milestone.id} className="flex items-center gap-2 rounded border p-2">
                      {showMilestoneCompletion && (
                        <input
                          type="checkbox"
                          checked={milestone.completed}
                          onChange={() => toggleMilestoneCompleted(milestone.id)}
                        />
                      )}
                      <span className="flex-1 text-sm">{milestone.name}</span>
                      <span className="text-xs text-muted-foreground">{milestone.dueDate || '-'}</span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeMilestone(milestone.id)}>
                        Șterge
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {showMilestoneCompletion && milestoneStats.total > 0 && (
                <p className="text-xs text-muted-foreground">
                  Progres jaloane: {milestoneStats.completed}/{milestoneStats.total}
                </p>
              )}

              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <Input
                  placeholder="Nume jalon"
                  value={milestoneDraft.name}
                  onChange={(event) => setMilestoneDraft((prev) => ({ ...prev, name: event.target.value }))}
                />
                <Input
                  type="date"
                  value={milestoneDraft.dueDate}
                  onChange={(event) => setMilestoneDraft((prev) => ({ ...prev, dueDate: event.target.value }))}
                />
                <Button type="button" variant="outline" onClick={addMilestone}>Adaugă jalon</Button>
              </div>
            </div>

            <div className="space-y-3">
              <Label>Livrabile</Label>
              {values.deliverables.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nu există livrabile adăugate.</p>
              ) : (
                <div className="space-y-2">
                  {values.deliverables.map((deliverable) => (
                    <div key={deliverable.id} className="flex items-center gap-2 rounded border p-2">
                      <span className="flex-1 text-sm">{deliverable.name}</span>
                      <span className="text-xs text-muted-foreground">{deliverable.type}</span>
                      <span className="text-xs text-muted-foreground">{deliverable.dueDate || '-'}</span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeDeliverable(deliverable.id)}>
                        Șterge
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                <Input
                  className="md:col-span-2"
                  placeholder="Nume livrabil"
                  value={deliverableDraft.name}
                  onChange={(event) => setDeliverableDraft((prev) => ({ ...prev, name: event.target.value }))}
                />
                <select
                  value={deliverableDraft.type}
                  onChange={(event) => setDeliverableDraft((prev) => ({ ...prev, type: event.target.value }))}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {DELIVERABLE_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
                <Input
                  type="date"
                  value={deliverableDraft.dueDate}
                  onChange={(event) => setDeliverableDraft((prev) => ({ ...prev, dueDate: event.target.value }))}
                />
              </div>
              <Button type="button" variant="outline" onClick={addDeliverable}>Adaugă livrabil</Button>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button type="submit" disabled={isSubmitting || !values.name.trim()}>
                {isSubmitting ? 'Se salvează...' : submitLabel}
              </Button>
              {onDelete && (
                <Button type="button" variant="destructive" onClick={onDelete} disabled={isDeleting}>
                  {isDeleting ? 'Se șterge...' : 'Șterge pachet'}
                </Button>
              )}
              {backHref && (
                <Button type="button" variant="outline" onClick={() => router.push(backHref)}>
                  Anulează
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
