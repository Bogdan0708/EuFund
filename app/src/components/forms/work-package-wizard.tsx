'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { CreateWorkPackageInput, Milestone, Deliverable } from '@/types/work-packages';

interface WorkPackageWizardProps {
  existingWorkPackages?: { id: string; name: string }[];
  partners?: { id: string; name: string }[];
  onSubmit: (data: CreateWorkPackageInput) => void;
  onCancel: () => void;
}

type Step = 'basic' | 'timeline' | 'budget' | 'dependencies' | 'review';
const STEPS: { key: Step; label: string }[] = [
  { key: 'basic', label: 'Informații de bază' },
  { key: 'timeline', label: 'Calendar & Jaloane' },
  { key: 'budget', label: 'Buget' },
  { key: 'dependencies', label: 'Dependențe' },
  { key: 'review', label: 'Verificare' },
];

export function WorkPackageWizard({
  existingWorkPackages = [], partners = [], onSubmit, onCancel,
}: WorkPackageWizardProps) {
  const [step, setStep] = useState<Step>('basic');
  const [data, setData] = useState<CreateWorkPackageInput>({
    name: '', description: '', startDate: '', endDate: '',
    budgetAllocated: 0, status: 'planned', leadPartnerId: '',
    dependencies: [], milestones: [], deliverables: [],
  });
  const [newMilestone, setNewMilestone] = useState({ name: '', dueDate: '' });
  const [newDeliverable, setNewDeliverable] = useState({ name: '', type: 'raport', dueDate: '' });

  const stepIndex = STEPS.findIndex(s => s.key === step);
  const canNext = () => {
    if (step === 'basic') return !!data.name.trim();
    return true;
  };

  const addMilestone = () => {
    if (!newMilestone.name) return;
    setData(d => ({
      ...d,
      milestones: [...(d.milestones || []), {
        id: crypto.randomUUID(), name: newMilestone.name,
        dueDate: newMilestone.dueDate, completed: false,
      }],
    }));
    setNewMilestone({ name: '', dueDate: '' });
  };

  const addDeliverable = () => {
    if (!newDeliverable.name) return;
    setData(d => ({
      ...d,
      deliverables: [...(d.deliverables || []), {
        id: crypto.randomUUID(), name: newDeliverable.name,
        type: newDeliverable.type, dueDate: newDeliverable.dueDate, completed: false,
      }],
    }));
    setNewDeliverable({ name: '', type: 'raport', dueDate: '' });
  };

  const toggleDependency = (wpId: string) => {
    setData(d => ({
      ...d,
      dependencies: d.dependencies?.includes(wpId)
        ? d.dependencies.filter(id => id !== wpId)
        : [...(d.dependencies || []), wpId],
    }));
  };

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-lg">Creare Pachet de Lucru</CardTitle>
        {/* Step indicator */}
        <div className="flex gap-1 mt-3">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex-1">
              <div className={`h-1 rounded-full ${i <= stepIndex ? 'bg-primary' : 'bg-muted'}`} />
              <p className={`text-[10px] mt-1 ${s.key === step ? 'font-medium' : 'text-muted-foreground'}`}>
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Step 1: Basic */}
        {step === 'basic' && (
          <div className="space-y-4">
            <div>
              <Label>Denumire *</Label>
              <Input value={data.name} onChange={e => setData(d => ({ ...d, name: e.target.value }))}
                placeholder="ex: WP1 - Management de proiect" />
            </div>
            <div>
              <Label>Descriere</Label>
              <Textarea value={data.description || ''} rows={4}
                onChange={e => setData(d => ({ ...d, description: e.target.value }))}
                placeholder="Descrierea activităților incluse..." />
            </div>
            {partners.length > 0 && (
              <div>
                <Label>Partener responsabil</Label>
                <select className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={data.leadPartnerId || ''}
                  onChange={e => setData(d => ({ ...d, leadPartnerId: e.target.value }))}>
                  <option value="">Selectați...</option>
                  {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Timeline */}
        {step === 'timeline' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Data început</Label>
                <Input type="date" value={data.startDate || ''}
                  onChange={e => setData(d => ({ ...d, startDate: e.target.value }))} />
              </div>
              <div>
                <Label>Data sfârșit</Label>
                <Input type="date" value={data.endDate || ''}
                  onChange={e => setData(d => ({ ...d, endDate: e.target.value }))} />
              </div>
            </div>

            <div>
              <Label className="mb-2 block">Jaloane (Milestones)</Label>
              {data.milestones?.map((m, i) => (
                <div key={m.id} className="flex items-center gap-2 mb-1 text-sm">
                  <span className="w-4 text-center">{i + 1}.</span>
                  <span className="flex-1">{m.name}</span>
                  <span className="text-muted-foreground">{m.dueDate}</span>
                  <Button variant="ghost" size="sm" className="text-xs"
                    onClick={() => setData(d => ({ ...d, milestones: d.milestones?.filter(x => x.id !== m.id) }))}>
                    ✕
                  </Button>
                </div>
              ))}
              <div className="flex gap-2 mt-2">
                <Input placeholder="Nume jalon" value={newMilestone.name}
                  onChange={e => setNewMilestone(m => ({ ...m, name: e.target.value }))} className="flex-1" />
                <Input type="date" value={newMilestone.dueDate}
                  onChange={e => setNewMilestone(m => ({ ...m, dueDate: e.target.value }))} className="w-40" />
                <Button variant="outline" size="sm" onClick={addMilestone}>+</Button>
              </div>
            </div>

            <div>
              <Label className="mb-2 block">Livrabile (Deliverables)</Label>
              {data.deliverables?.map((d2, i) => (
                <div key={d2.id} className="flex items-center gap-2 mb-1 text-sm">
                  <span className="w-4 text-center">{i + 1}.</span>
                  <span className="flex-1">{d2.name}</span>
                  <span className="text-muted-foreground text-xs">{d2.type}</span>
                  <span className="text-muted-foreground">{d2.dueDate}</span>
                  <Button variant="ghost" size="sm" className="text-xs"
                    onClick={() => setData(d => ({ ...d, deliverables: d.deliverables?.filter(x => x.id !== d2.id) }))}>
                    ✕
                  </Button>
                </div>
              ))}
              <div className="flex gap-2 mt-2">
                <Input placeholder="Nume livrabil" value={newDeliverable.name}
                  onChange={e => setNewDeliverable(d => ({ ...d, name: e.target.value }))} className="flex-1" />
                <select className="h-10 rounded-md border bg-background px-2 text-sm w-28"
                  value={newDeliverable.type}
                  onChange={e => setNewDeliverable(d => ({ ...d, type: e.target.value }))}>
                  <option value="raport">Raport</option>
                  <option value="software">Software</option>
                  <option value="prototip">Prototip</option>
                  <option value="studiu">Studiu</option>
                  <option value="altul">Altul</option>
                </select>
                <Input type="date" value={newDeliverable.dueDate}
                  onChange={e => setNewDeliverable(d => ({ ...d, dueDate: e.target.value }))} className="w-40" />
                <Button variant="outline" size="sm" onClick={addDeliverable}>+</Button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Budget */}
        {step === 'budget' && (
          <div className="space-y-4">
            <div>
              <Label>Buget alocat (EUR)</Label>
              <Input type="number" step="100" value={data.budgetAllocated || ''}
                onChange={e => setData(d => ({ ...d, budgetAllocated: Number(e.target.value) }))}
                placeholder="0.00" />
            </div>
            <p className="text-xs text-muted-foreground">
              Bugetul va fi verificat automat conform regulilor de eligibilitate UE.
            </p>
          </div>
        )}

        {/* Step 4: Dependencies */}
        {step === 'dependencies' && (
          <div className="space-y-4">
            <Label>Pachete de lucru dependente</Label>
            {existingWorkPackages.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nu există alte pachete de lucru.</p>
            ) : (
              <div className="space-y-2">
                {existingWorkPackages.map(wp => (
                  <label key={wp.id} className="flex items-center gap-3 p-2 rounded border cursor-pointer hover:bg-muted/50">
                    <input type="checkbox" checked={data.dependencies?.includes(wp.id) || false}
                      onChange={() => toggleDependency(wp.id)}
                      className="rounded" />
                    <span className="text-sm">{wp.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 5: Review */}
        {step === 'review' && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-muted-foreground">Denumire:</span></div>
              <div className="font-medium">{data.name}</div>
              <div><span className="text-muted-foreground">Perioada:</span></div>
              <div>{data.startDate || '-'} → {data.endDate || '-'}</div>
              <div><span className="text-muted-foreground">Buget:</span></div>
              <div>{data.budgetAllocated ? `€${data.budgetAllocated.toLocaleString()}` : '-'}</div>
              <div><span className="text-muted-foreground">Jaloane:</span></div>
              <div>{data.milestones?.length || 0}</div>
              <div><span className="text-muted-foreground">Livrabile:</span></div>
              <div>{data.deliverables?.length || 0}</div>
              <div><span className="text-muted-foreground">Dependențe:</span></div>
              <div>{data.dependencies?.length || 0}</div>
            </div>
            {data.description && (
              <div>
                <p className="text-muted-foreground">Descriere:</p>
                <p className="mt-1">{data.description}</p>
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between pt-4 border-t">
          <Button variant="outline" onClick={stepIndex === 0 ? onCancel : () => setStep(STEPS[stepIndex - 1].key)}>
            {stepIndex === 0 ? 'Anulează' : '← Înapoi'}
          </Button>
          {step === 'review' ? (
            <Button onClick={() => onSubmit(data)} disabled={!data.name.trim()}>
              ✅ Creează Pachet de Lucru
            </Button>
          ) : (
            <Button onClick={() => setStep(STEPS[stepIndex + 1].key)} disabled={!canNext()}>
              Următorul →
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
