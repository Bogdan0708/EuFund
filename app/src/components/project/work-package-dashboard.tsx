'use client';

import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { WorkPackage, Milestone } from '@/types/work-packages';
import { formatCurrency } from '@/lib/utils';

interface WorkPackageDashboardProps {
  workPackages: WorkPackage[];
  projectBudget?: number;
  onEdit?: (wp: WorkPackage) => void;
  onComplete?: (wpId: string) => void;
  onDelay?: (wpId: string) => void;
}

const STATUS_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  planned: { label: 'Planificat', variant: 'outline' },
  active: { label: 'Activ', variant: 'default' },
  completed: { label: 'Finalizat', variant: 'secondary' },
  delayed: { label: 'Întârziat', variant: 'destructive' },
  cancelled: { label: 'Anulat', variant: 'outline' },
};

function BudgetBar({ allocated, spent }: { allocated: number; spent: number }) {
  const pct = allocated > 0 ? Math.min((spent / allocated) * 100, 100) : 0;
  const isOver = spent > allocated;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Cheltuit: {formatCurrency(spent)}</span>
        <span>Alocat: {formatCurrency(allocated)}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isOver ? 'bg-red-500' : pct > 80 ? 'bg-orange-500' : 'bg-green-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[10px] text-right text-muted-foreground">{pct.toFixed(0)}% utilizat</p>
    </div>
  );
}

function MilestoneList({ milestones }: { milestones: Milestone[] }) {
  if (!milestones?.length) return <p className="text-xs text-muted-foreground">Fără jaloane definite</p>;
  const completed = milestones.filter(m => m.completed).length;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Jaloane</span>
        <span className="font-medium">{completed}/{milestones.length}</span>
      </div>
      <div className="flex gap-1">
        {milestones.map((m, i) => (
          <div
            key={m.id || i}
            className={`h-1.5 flex-1 rounded-full ${m.completed ? 'bg-green-500' : 'bg-muted'}`}
            title={`${m.name} - ${m.completed ? 'Finalizat' : 'În așteptare'} (${m.dueDate})`}
          />
        ))}
      </div>
    </div>
  );
}

export function WorkPackageDashboard({
  workPackages,
  projectBudget,
  onEdit,
  onComplete,
  onDelay,
}: WorkPackageDashboardProps) {
  const totalAllocated = workPackages.reduce((s, wp) => s + (wp.budgetAllocated || 0), 0);
  const totalSpent = workPackages.reduce((s, wp) => s + wp.budgetSpent, 0);
  const activeCount = workPackages.filter(wp => wp.status === 'active').length;
  const delayedCount = workPackages.filter(wp => wp.status === 'delayed').length;
  const completedCount = workPackages.filter(wp => wp.status === 'completed').length;

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{workPackages.length}</p>
            <p className="text-xs text-muted-foreground">Total pachete</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{activeCount}</p>
            <p className="text-xs text-muted-foreground">Active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className={`text-2xl font-bold ${delayedCount > 0 ? 'text-red-600' : ''}`}>{delayedCount}</p>
            <p className="text-xs text-muted-foreground">Întârziate</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{completedCount}</p>
            <p className="text-xs text-muted-foreground">Finalizate</p>
          </CardContent>
        </Card>
      </div>

      {/* Budget overview */}
      {projectBudget && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Buget Proiect</CardTitle>
          </CardHeader>
          <CardContent>
            <BudgetBar allocated={projectBudget} spent={totalSpent} />
            <p className="text-xs text-muted-foreground mt-2">
              Alocat pe pachete: {formatCurrency(totalAllocated)} din {formatCurrency(projectBudget)}
              {totalAllocated < projectBudget && (
                <span className="text-orange-500 ml-1">
                  ({formatCurrency(projectBudget - totalAllocated)} nealocat)
                </span>
              )}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Work package cards */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {workPackages.map(wp => {
          const status = STATUS_MAP[wp.status] || STATUS_MAP.planned;
          const daysLeft = wp.endDate
            ? Math.ceil((new Date(wp.endDate).getTime() - Date.now()) / 86400000)
            : null;

          return (
            <Card key={wp.id} className={`transition-shadow hover:shadow-md ${wp.status === 'delayed' ? 'border-red-200' : ''}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-sm leading-tight">{wp.name}</CardTitle>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </div>
                {wp.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{wp.description}</p>
                )}
              </CardHeader>
              <CardContent className="space-y-3 pb-2">
                {/* Timeline */}
                {wp.startDate && wp.endDate && (
                  <div className="flex items-center justify-between text-xs">
                    <span>{new Date(wp.startDate).toLocaleDateString('ro-RO')}</span>
                    <span className="text-muted-foreground">→</span>
                    <span>{new Date(wp.endDate).toLocaleDateString('ro-RO')}</span>
                    {daysLeft !== null && daysLeft > 0 && wp.status !== 'completed' && (
                      <Badge variant="outline" className={`text-[10px] ${daysLeft < 14 ? 'border-orange-400 text-orange-600' : ''}`}>
                        {daysLeft}z rămase
                      </Badge>
                    )}
                  </div>
                )}

                {/* Budget */}
                {wp.budgetAllocated && (
                  <BudgetBar allocated={wp.budgetAllocated} spent={wp.budgetSpent} />
                )}

                {/* Milestones */}
                <MilestoneList milestones={wp.milestones} />

                {/* Dependencies */}
                {wp.dependencies?.length > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    🔗 {wp.dependencies.length} dependenț{wp.dependencies.length === 1 ? 'ă' : 'e'}
                  </p>
                )}

                {/* Deliverables */}
                {wp.deliverables?.length > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    📦 {wp.deliverables.filter(d => d.completed).length}/{wp.deliverables.length} livrabile
                  </p>
                )}
              </CardContent>
              <CardFooter className="pt-0 gap-2">
                {onEdit && (
                  <Button variant="outline" size="sm" className="text-xs flex-1" onClick={() => onEdit(wp)}>
                    ✏️ Editează
                  </Button>
                )}
                {onComplete && wp.status === 'active' && (
                  <Button variant="outline" size="sm" className="text-xs flex-1" onClick={() => onComplete(wp.id)}>
                    ✅ Finalizează
                  </Button>
                )}
                {onDelay && (wp.status === 'active' || wp.status === 'planned') && (
                  <Button variant="outline" size="sm" className="text-xs flex-1 text-orange-600" onClick={() => onDelay(wp.id)}>
                    ⚠️ Întârziere
                  </Button>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
