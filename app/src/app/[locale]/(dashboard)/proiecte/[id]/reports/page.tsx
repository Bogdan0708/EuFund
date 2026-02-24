'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { CheckCircle2, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingState } from '@/components/ui/page-states';
import { ToastItem, ToastStack } from '@/components/ui/toast-stack';

interface DraftReport {
  narrative: string;
  kpiOutput: string;
  kpiOutcome: string;
  costsTotal: string;
  costsEligible: string;
  attachments: string;
}

const steps = ['Narativ', 'KPI-uri', 'Costuri', 'Atașamente', 'Revizuire și depunere'];

const defaultDraft: DraftReport = {
  narrative: '',
  kpiOutput: '',
  kpiOutcome: '',
  costsTotal: '',
  costsEligible: '',
  attachments: '',
};

export default function ReportsPage() {
  const params = useParams<{ id?: string; locale?: string }>();
  const projectId = params.id || '';
  const locale = params.locale || 'ro';

  const [hasAccess, setHasAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftReport>(defaultDraft);
  const [activeStep, setActiveStep] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const storageKey = `eufund:report-draft:${projectId}`;

  useEffect(() => {
    if (!projectId) return;

    fetch(`/api/v1/projects/${projectId}`)
      .then((response) => setHasAccess(response.ok))
      .catch(() => setHasAccess(false))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as DraftReport;
      setDraft({ ...defaultDraft, ...parsed });
    } catch {
      // ignore invalid drafts
    }
  }, [storageKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(draft));
  }, [draft, storageKey]);

  const pushToast = (title: string, type: ToastItem['type']) => {
    const item = { id: crypto.randomUUID(), title, type };
    setToasts((previous) => [...previous, item]);
    window.setTimeout(() => setToasts((previous) => previous.filter((toast) => toast.id !== item.id)), 3000);
  };

  const validationErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    if (activeStep === 0 && draft.narrative.trim().length < 30) errors.narrative = 'Narațiunea trebuie să aibă cel puțin 30 de caractere.';
    if (activeStep === 1 && !draft.kpiOutput.trim()) errors.kpiOutput = 'KPI-ul de output este obligatoriu.';
    if (activeStep === 1 && !draft.kpiOutcome.trim()) errors.kpiOutcome = 'KPI-ul de rezultat este obligatoriu.';
    if (activeStep === 2 && !draft.costsTotal.trim()) errors.costsTotal = 'Costurile totale sunt obligatorii.';
    if (activeStep === 2 && !draft.costsEligible.trim()) errors.costsEligible = 'Costurile eligibile sunt obligatorii.';
    if (activeStep === 3 && !draft.attachments.trim()) errors.attachments = 'Listați cel puțin un atașament.';
    return errors;
  }, [activeStep, draft]);

  const canGoNext = Object.keys(validationErrors).length === 0;

  const saveDraftNow = () => {
    localStorage.setItem(storageKey, JSON.stringify(draft));
    setBanner('Ciorna a fost salvată local.');
    pushToast('Ciornă salvată', 'info');
  };

  const submitReport = () => {
    setBanner('Raportul a fost depus. Echipa de revizuire a fost notificată.');
    pushToast('Raport depus cu succes', 'success');
  };

  if (loading) return <LoadingState label="Se încarcă spațiul de raportare..." />;
  if (!hasAccess) return <ErrorState message="Nu ai acces la acest proiect." />;

  return (
    <div className="space-y-6">
      <ToastStack items={toasts} />

      <PageHeader
        title="Asistent raport periodic"
        description="Completează secțiunile raportului în ordine: narativ, KPI-uri, costuri, atașamente, apoi revizuire și depunere."
        rightSlot={
          <div className="flex gap-2">
            <Button variant="outline" onClick={saveDraftNow}>Salvează ciorna</Button>
            <Button asChild variant="outline">
              <Link href={`/${locale}/proiecte/${projectId}`}>Înapoi la proiect</Link>
            </Button>
          </div>
        }
      />

      {banner && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          {banner}
        </div>
      )}

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Progres pași</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2 sm:grid-cols-5">
            {steps.map((step, index) => (
              <li key={step}>
                <button
                  type="button"
                  onClick={() => setActiveStep(index)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                    index === activeStep ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
                  }`}
                >
                  <p className="text-xs text-muted-foreground">Pasul {index + 1}</p>
                  <p className="font-medium">{step}</p>
                </button>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {activeStep === 0 && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Narativ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <textarea
              className="min-h-36 w-full rounded-md border bg-background p-3 text-sm"
              placeholder="Descrie progresul perioadei, realizările cheie și blocajele."
              value={draft.narrative}
              onChange={(event) => setDraft((previous) => ({ ...previous, narrative: event.target.value }))}
            />
            {validationErrors.narrative && <p className="text-xs text-destructive">{validationErrors.narrative}</p>}
          </CardContent>
        </Card>
      )}

      {activeStep === 1 && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>KPI-uri</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">KPI ieșire</label>
              <Input
                value={draft.kpiOutput}
                onChange={(event) => setDraft((previous) => ({ ...previous, kpiOutput: event.target.value }))}
                placeholder="ex: 12 livrabile depuse"
              />
              {validationErrors.kpiOutput && <p className="mt-1 text-xs text-destructive">{validationErrors.kpiOutput}</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">KPI rezultat</label>
              <Input
                value={draft.kpiOutcome}
                onChange={(event) => setDraft((previous) => ({ ...previous, kpiOutcome: event.target.value }))}
                placeholder="ex: 85% finalizare jaloane"
              />
              {validationErrors.kpiOutcome && <p className="mt-1 text-xs text-destructive">{validationErrors.kpiOutcome}</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {activeStep === 2 && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Costuri</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Costuri totale (EUR)</label>
              <Input
                value={draft.costsTotal}
                onChange={(event) => setDraft((previous) => ({ ...previous, costsTotal: event.target.value }))}
                placeholder="150000"
              />
              {validationErrors.costsTotal && <p className="mt-1 text-xs text-destructive">{validationErrors.costsTotal}</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Costuri eligibile (EUR)</label>
              <Input
                value={draft.costsEligible}
                onChange={(event) => setDraft((previous) => ({ ...previous, costsEligible: event.target.value }))}
                placeholder="140000"
              />
              {validationErrors.costsEligible && <p className="mt-1 text-xs text-destructive">{validationErrors.costsEligible}</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {activeStep === 3 && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Atașamente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              value={draft.attachments}
              onChange={(event) => setDraft((previous) => ({ ...previous, attachments: event.target.value }))}
              placeholder="Listează numele atașamentelor separate prin virgulă"
            />
            {validationErrors.attachments && <p className="text-xs text-destructive">{validationErrors.attachments}</p>}
            <p className="text-xs text-muted-foreground">Atașează fișiere justificative din secțiunea Documente înainte de depunere.</p>
          </CardContent>
        </Card>
      )}

      {activeStep === 4 && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Revizuire și depunere</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">Rezumat narativ</p>
                <Button size="sm" variant="outline" onClick={() => setActiveStep(0)}>Modifică</Button>
              </div>
              <p className="mt-1 text-muted-foreground">{draft.narrative || 'Nefinalizat'}</p>
            </div>

            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">Rezumat KPI</p>
                <Button size="sm" variant="outline" onClick={() => setActiveStep(1)}>Modifică</Button>
              </div>
              <p className="mt-1 text-muted-foreground">Ieșire: {draft.kpiOutput || 'N/A'} | Rezultat: {draft.kpiOutcome || 'N/A'}</p>
            </div>

            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">Rezumat costuri</p>
                <Button size="sm" variant="outline" onClick={() => setActiveStep(2)}>Modifică</Button>
              </div>
              <p className="mt-1 text-muted-foreground">Total: {draft.costsTotal || 'N/A'} EUR | Eligibil: {draft.costsEligible || 'N/A'} EUR</p>
            </div>

            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">Rezumat atașamente</p>
                <Button size="sm" variant="outline" onClick={() => setActiveStep(3)}>Modifică</Button>
              </div>
              <p className="mt-1 text-muted-foreground">{draft.attachments || 'N/A'}</p>
            </div>

            <Button className="w-full" onClick={submitReport}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Depune raportul
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={activeStep === 0} onClick={() => setActiveStep((step) => Math.max(0, step - 1))}>
          Anterior
        </Button>
        <Button
          disabled={activeStep >= steps.length - 1 || !canGoNext}
          onClick={() => {
            setActiveStep((step) => Math.min(steps.length - 1, step + 1));
            if (canGoNext) pushToast('Pas finalizat', 'success');
          }}
        >
          Următor
          <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
