'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle2, ArrowLeft, ArrowRight, Save, Sparkles } from 'lucide-react';
import { csrfFetch } from '@/lib/csrf/client';

type Step = 'IDEA' | 'ENHANCE' | 'MATCH' | 'GENERATE' | 'REVIEW' | 'SAVED';
const STEP_ORDER: Step[] = ['IDEA', 'ENHANCE', 'MATCH', 'GENERATE', 'REVIEW', 'SAVED'];
const STEP_LABELS: Record<Step, string> = {
  IDEA: 'Idee',
  ENHANCE: 'Rafinare',
  MATCH: 'Potrivire',
  GENERATE: 'Generare',
  REVIEW: 'Revizuire',
  SAVED: 'Finalizat',
};

type UserOrg = {
  id: string;
  name: string;
  type: string;
  sector?: string | null;
};

type MatchResult = {
  call: {
    id: string;
    callCode: string;
    titleRo: string;
    programName: string;
    submissionEnd?: string;
  };
  eligibilityScore: number;
  relevanceScore: number;
  overallScore: number;
  recommendations: string[];
};

type ProposalPayload = {
  title: string;
  acronym: string;
  summary: string;
  context: string;
  objectives: {
    general: string;
    specific: string[];
  };
  methodology: {
    approach: string;
    workPackages: Array<{
      name: string;
      description: string;
      duration: string;
      deliverables: string[];
    }>;
  };
  budget: {
    summary: string;
    categories: Array<{
      name: string;
      amount: number;
      justification: string;
    }>;
  };
  indicators: Array<Record<string, unknown>>;
  sustainability: string;
  risks: Array<Record<string, unknown>>;
};

type WizardState = {
  projectIdea: string;
  enhancedIdea: string;
  selectedCallId: string | null;
  selectedOrgId: string;
  sector: string;
  budget: number;
  matches: MatchResult[];
  proposal: ProposalPayload | null;
  createdProjectId: string | null;
};

export function ProjectWizard({
  userOrgs,
  initialCallId = null,
  initialIdea,
  locale = 'ro',
}: {
  userOrgs: UserOrg[];
  initialCallId?: string | null;
  initialIdea?: string;
  locale?: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [step, setStep] = useState<Step>('IDEA');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<WizardState>({
    projectIdea: initialIdea ?? '',
    enhancedIdea: '',
    selectedCallId: initialCallId,
    selectedOrgId: userOrgs[0]?.id ?? '',
    sector: userOrgs[0]?.sector ?? '',
    budget: 100000,
    matches: [],
    proposal: null,
    createdProjectId: null,
  });

  const selectedOrg = useMemo(
    () => userOrgs.find((org) => org.id === state.selectedOrgId),
    [state.selectedOrgId, userOrgs],
  );
  const stepIndex = STEP_ORDER.indexOf(step);

  async function handleEnhance() {
    setLoading(true);
    setError(null);
    try {
      const res = await csrfFetch('/api/ai/wizard/enhance-idea', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectIdea: state.projectIdea, locale }),
      });
      const payload = await res.json();
      if (!res.ok || !payload?.success) throw new Error(payload?.error?.message || 'Enhance failed');

      setState((prev) => ({ ...prev, enhancedIdea: payload.data.enhancedIdea }));
      setStep('ENHANCE');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enhance failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleMatch() {
    if (!selectedOrg) return;
    setLoading(true);
    setError(null);
    try {
      const res = await csrfFetch('/api/ai/wizard/match-calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectIdea: state.enhancedIdea || state.projectIdea,
          organization: {
            orgType: selectedOrg.type,
          },
          budget: state.budget,
          locale,
        }),
      });
      const payload = await res.json();
      if (!res.ok || !payload?.success) throw new Error(payload?.error?.message || 'Match failed');

      setState((prev) => ({ ...prev, matches: payload.data.matches ?? [] }));
      setStep('MATCH');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Match failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate(callId: string) {
    if (!selectedOrg) return;
    setLoading(true);
    setError(null);
    setStep('GENERATE');
    setState((prev) => ({ ...prev, selectedCallId: callId }));
    try {
      const res = await csrfFetch('/api/ai/wizard/generate-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectIdea: state.enhancedIdea || state.projectIdea,
          callId,
          organization: {
            orgName: selectedOrg.name,
            orgType: selectedOrg.type,
            sector: state.sector || undefined,
          },
          locale,
        }),
      });
      const payload = await res.json();
      if (!res.ok || !payload?.success) throw new Error(payload?.error?.message || 'Generate failed');

      setState((prev) => ({ ...prev, proposal: payload.data.proposal as ProposalPayload }));
      setStep('REVIEW');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generate failed');
      setStep('MATCH');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!state.selectedCallId || !state.selectedOrgId || !state.proposal) return;
    setLoading(true);
    setError(null);
    try {
      const res = await csrfFetch('/api/ai/wizard/save-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId: state.selectedCallId,
          orgId: state.selectedOrgId,
          proposal: state.proposal,
        }),
      });
      const payload = await res.json();
      if (!res.ok || !payload?.success) throw new Error(payload?.error?.message || 'Save failed');

      setState((prev) => ({ ...prev, createdProjectId: payload.data.id }));
      setStep('SAVED');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-8">
      <h1 className="text-3xl font-bold tracking-tight">{t('wizard.title')}</h1>
      <div className="flex flex-wrap gap-2">
        {STEP_ORDER.map((s, index) => (
          <Badge key={s} variant={index <= stepIndex ? 'default' : 'outline'}>
            {index + 1}. {STEP_LABELS[s]}
          </Badge>
        ))}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {step === 'IDEA' && (
        <Card>
          <CardHeader>
            <CardTitle>{t('wizard.idea.title')}</CardTitle>
            <CardDescription>{t('wizard.idea.placeholder')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="idea">{t('project.sections.summary')}</Label>
              <Textarea
                id="idea"
                rows={6}
                value={state.projectIdea}
                onChange={(e) => setState((prev) => ({ ...prev, projectIdea: e.target.value }))}
                placeholder={t('wizard.idea.placeholder')}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('wizard.idea.orgLabel')}</Label>
                <select
                  className="w-full rounded-md border px-3 py-2"
                  value={state.selectedOrgId}
                  onChange={(e) => setState((prev) => ({ ...prev, selectedOrgId: e.target.value }))}
                >
                  {userOrgs.map((org) => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="budget">{t('wizard.idea.budgetLabel')}</Label>
                <Input
                  id="budget"
                  type="number"
                  value={state.budget}
                  onChange={(e) => setState((prev) => ({ ...prev, budget: Number(e.target.value) || 0 }))}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="sector">{t('wizard.idea.sectorLabel')}</Label>
                <Input
                  id="sector"
                  value={state.sector}
                  onChange={(e) => setState((prev) => ({ ...prev, sector: e.target.value }))}
                />
              </div>
            </div>
          </CardContent>
          <CardFooter className="justify-end">
            <Button disabled={state.projectIdea.trim().length < 20 || loading} onClick={handleEnhance}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('common.next')}
            </Button>
          </CardFooter>
        </Card>
      )}

      {step === 'ENHANCE' && (
        <Card>
          <CardHeader>
            <CardTitle>{t('wizard.enhance.title')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('wizard.enhance.original')}</Label>
              <div className="min-h-[220px] rounded-md border bg-muted p-3 text-sm">{state.projectIdea}</div>
            </div>
            <div className="space-y-2">
              <Label>{t('wizard.enhance.enhanced')}</Label>
              <Textarea
                rows={10}
                value={state.enhancedIdea}
                onChange={(e) => setState((prev) => ({ ...prev, enhancedIdea: e.target.value }))}
              />
            </div>
          </CardContent>
          <CardFooter className="justify-between">
            <Button variant="outline" onClick={() => setStep('IDEA')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('common.back')}
            </Button>
            <Button disabled={loading} onClick={handleMatch}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('common.next')}
            </Button>
          </CardFooter>
        </Card>
      )}

      {step === 'MATCH' && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">{t('wizard.match.title')}</h2>
          {state.matches.length === 0 ? (
            <Card><CardContent className="py-6 text-sm text-muted-foreground">Nu s-au găsit apeluri potrivite.</CardContent></Card>
          ) : (
            state.matches.map((match) => (
              <Card key={match.call.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{match.call.titleRo}</CardTitle>
                      <CardDescription>{match.call.programName} • {match.call.callCode}</CardDescription>
                    </div>
                    <Badge>{match.overallScore}%</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>{match.call.submissionEnd ? `Termen: ${new Date(match.call.submissionEnd).toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-GB')}` : 'Termen nedefinit'}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-md border p-2">
                      <p className="text-xs">Eligibilitate</p>
                      <p className="font-semibold text-foreground">{match.eligibilityScore}%</p>
                    </div>
                    <div className="rounded-md border p-2">
                      <p className="text-xs">Relevanță</p>
                      <p className="font-semibold text-foreground">{match.relevanceScore}%</p>
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button className="w-full" onClick={() => handleGenerate(match.call.id)}>
                    {t('wizard.match.select')}
                  </Button>
                </CardFooter>
              </Card>
            ))
          )}
          <Button variant="outline" onClick={() => setStep('ENHANCE')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('common.back')}
          </Button>
        </div>
      )}

      {step === 'GENERATE' && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="font-medium">{t('wizard.generate.title')}</p>
            <p className="text-sm text-muted-foreground">{t('wizard.generate.loading')}</p>
            <p className="inline-flex items-center text-xs text-muted-foreground">
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              {t('wizard.generate.disclaimer')}
            </p>
          </CardContent>
        </Card>
      )}

      {step === 'REVIEW' && state.proposal && (
        <Card>
          <CardHeader>
            <CardTitle>{state.proposal.title}</CardTitle>
            <CardDescription>{state.proposal.acronym}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t('project.sections.summary')}</Label>
              <Textarea
                rows={4}
                value={state.proposal.summary}
                onChange={(e) => setState((prev) => ({
                  ...prev,
                  proposal: prev.proposal ? { ...prev.proposal, summary: e.target.value } : prev.proposal,
                }))}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('project.sections.context')}</Label>
              <Textarea
                rows={5}
                value={state.proposal.context}
                onChange={(e) => setState((prev) => ({
                  ...prev,
                  proposal: prev.proposal ? { ...prev.proposal, context: e.target.value } : prev.proposal,
                }))}
              />
            </div>
            <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              {t('wizard.review.disclaimer')}
            </div>
          </CardContent>
          <CardFooter className="justify-between">
            <Button variant="outline" onClick={() => setStep('MATCH')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('common.back')}
            </Button>
            <Button disabled={loading} onClick={handleSave}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {t('wizard.review.saveAction')}
            </Button>
          </CardFooter>
        </Card>
      )}

      {step === 'SAVED' && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <CheckCircle2 className="h-12 w-12 text-primary" />
            <h2 className="text-xl font-semibold">{t('wizard.saved.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('wizard.saved.message')}</p>
            <Button
              onClick={() => {
                if (state.createdProjectId) router.push(`/${locale}/proiecte/${state.createdProjectId}`);
              }}
            >
              {t('wizard.saved.goProject')}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
