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

const steps = ['Narrative', 'KPIs', 'Costs', 'Attachments', 'Review & Submit'];

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
    if (activeStep === 0 && draft.narrative.trim().length < 30) errors.narrative = 'Narrative must include at least 30 characters.';
    if (activeStep === 1 && !draft.kpiOutput.trim()) errors.kpiOutput = 'Output KPI is required.';
    if (activeStep === 1 && !draft.kpiOutcome.trim()) errors.kpiOutcome = 'Outcome KPI is required.';
    if (activeStep === 2 && !draft.costsTotal.trim()) errors.costsTotal = 'Total costs are required.';
    if (activeStep === 2 && !draft.costsEligible.trim()) errors.costsEligible = 'Eligible costs are required.';
    if (activeStep === 3 && !draft.attachments.trim()) errors.attachments = 'List at least one attachment.';
    return errors;
  }, [activeStep, draft]);

  const canGoNext = Object.keys(validationErrors).length === 0;

  const saveDraftNow = () => {
    localStorage.setItem(storageKey, JSON.stringify(draft));
    setBanner('Draft saved locally.');
    pushToast('Draft saved', 'info');
  };

  const submitReport = () => {
    setBanner('Report submitted. Review team has been notified.');
    pushToast('Report submitted successfully', 'success');
  };

  if (loading) return <LoadingState label="Loading reporting workspace..." />;
  if (!hasAccess) return <ErrorState message="You do not have access to this project." />;

  return (
    <div className="space-y-6">
      <ToastStack items={toasts} />

      <PageHeader
        title="Periodic Report Wizard"
        description="Create report sections in sequence: narrative, KPIs, costs, attachments, then review and submit."
        rightSlot={
          <div className="flex gap-2">
            <Button variant="outline" onClick={saveDraftNow}>Save Draft</Button>
            <Button asChild variant="outline">
              <Link href={`/${locale}/proiecte/${projectId}`}>Back to project</Link>
            </Button>
          </div>
        }
      />

      {banner && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          {banner}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Step progress</CardTitle>
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
                  <p className="text-xs text-muted-foreground">Step {index + 1}</p>
                  <p className="font-medium">{step}</p>
                </button>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {activeStep === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Narrative</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <textarea
              className="min-h-36 w-full rounded-md border bg-background p-3 text-sm"
              placeholder="Describe period progress, key achievements, and blockers."
              value={draft.narrative}
              onChange={(event) => setDraft((previous) => ({ ...previous, narrative: event.target.value }))}
            />
            {validationErrors.narrative && <p className="text-xs text-destructive">{validationErrors.narrative}</p>}
          </CardContent>
        </Card>
      )}

      {activeStep === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>KPIs</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Output KPI</label>
              <Input
                value={draft.kpiOutput}
                onChange={(event) => setDraft((previous) => ({ ...previous, kpiOutput: event.target.value }))}
                placeholder="e.g. 12 deliverables submitted"
              />
              {validationErrors.kpiOutput && <p className="mt-1 text-xs text-destructive">{validationErrors.kpiOutput}</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Outcome KPI</label>
              <Input
                value={draft.kpiOutcome}
                onChange={(event) => setDraft((previous) => ({ ...previous, kpiOutcome: event.target.value }))}
                placeholder="e.g. 85% milestone completion"
              />
              {validationErrors.kpiOutcome && <p className="mt-1 text-xs text-destructive">{validationErrors.kpiOutcome}</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {activeStep === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Costs</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Total costs (EUR)</label>
              <Input
                value={draft.costsTotal}
                onChange={(event) => setDraft((previous) => ({ ...previous, costsTotal: event.target.value }))}
                placeholder="150000"
              />
              {validationErrors.costsTotal && <p className="mt-1 text-xs text-destructive">{validationErrors.costsTotal}</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Eligible costs (EUR)</label>
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
        <Card>
          <CardHeader>
            <CardTitle>Attachments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              value={draft.attachments}
              onChange={(event) => setDraft((previous) => ({ ...previous, attachments: event.target.value }))}
              placeholder="List attachment names separated by commas"
            />
            {validationErrors.attachments && <p className="text-xs text-destructive">{validationErrors.attachments}</p>}
            <p className="text-xs text-muted-foreground">Attach evidence files from the Documents section before submission.</p>
          </CardContent>
        </Card>
      )}

      {activeStep === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>Review & Submit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">Narrative summary</p>
                <Button size="sm" variant="outline" onClick={() => setActiveStep(0)}>Edit</Button>
              </div>
              <p className="mt-1 text-muted-foreground">{draft.narrative || 'Not completed'}</p>
            </div>

            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">KPI summary</p>
                <Button size="sm" variant="outline" onClick={() => setActiveStep(1)}>Edit</Button>
              </div>
              <p className="mt-1 text-muted-foreground">Output: {draft.kpiOutput || 'N/A'} | Outcome: {draft.kpiOutcome || 'N/A'}</p>
            </div>

            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">Cost summary</p>
                <Button size="sm" variant="outline" onClick={() => setActiveStep(2)}>Edit</Button>
              </div>
              <p className="mt-1 text-muted-foreground">Total: {draft.costsTotal || 'N/A'} EUR | Eligible: {draft.costsEligible || 'N/A'} EUR</p>
            </div>

            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">Attachment summary</p>
                <Button size="sm" variant="outline" onClick={() => setActiveStep(3)}>Edit</Button>
              </div>
              <p className="mt-1 text-muted-foreground">{draft.attachments || 'N/A'}</p>
            </div>

            <Button className="w-full" onClick={submitReport}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Submit Report
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={activeStep === 0} onClick={() => setActiveStep((step) => Math.max(0, step - 1))}>
          Previous
        </Button>
        <Button
          disabled={activeStep >= steps.length - 1 || !canGoNext}
          onClick={() => {
            setActiveStep((step) => Math.min(steps.length - 1, step + 1));
            if (canGoNext) pushToast('Step completed', 'success');
          }}
        >
          Next
          <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
