'use client';

import { useState } from 'react';
import { csrfFetch } from '@/lib/csrf/client';
import type { ProposalOutput } from '@/lib/ai/proposal-generator';

type Step = 'input' | 'generating' | 'result';

const PROGRAM_OPTIONS = [
  { value: 'horizon_europe', label: 'Horizon Europe' },
  { value: 'interreg', label: 'Interreg' },
  { value: 'life_plus', label: 'LIFE+' },
  { value: 'pocidif', label: 'POCIDIF' },
  { value: 'pnrr', label: 'PNRR' },
  { value: 'general', label: 'General' },
];

const ORG_TYPE_OPTIONS = [
  { value: 'srl', label: 'SRL' },
  { value: 'sa', label: 'SA' },
  { value: 'pfa', label: 'PFA' },
  { value: 'ong', label: 'ONG' },
  { value: 'uat', label: 'UAT' },
  { value: 'institutie_publica', label: 'Instituție publică' },
];

export default function ProposalWizard() {
  const [generatorMode, setGeneratorMode] = useState<'standard' | 'advanced'>('standard');
  const [step, setStep] = useState<Step>('input');
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ProposalOutput | null>(null);
  const [meta, setMeta] = useState<{ tokensUsed: number; ragSourcesUsed: number; mode?: string } | null>(null);

  const [form, setForm] = useState({
    projectIdea: '',
    programType: 'general',
    organizationName: '',
    organizationType: 'srl',
    sector: '',
    budget: '',
    duration: '',
  });

  type EnhancedProposalPayload = {
    title?: string;
    acronym?: string;
    executive_summary?: string;
    context?: string;
    objectives?: { general?: string; specific?: string[] };
    methodology?: {
      approach?: string;
      work_packages?: Array<{
        title?: string;
        objectives?: string[];
        startMonth?: number | string;
        endMonth?: number | string;
        deliverables?: Array<{ title?: string }>;
      }>;
    };
    budget?: {
      justification?: string;
      cost_breakdown?: Array<{ category?: string; amount?: number | string; justification?: string }>;
    };
    impact?: {
      kpis?: Array<{ indicator?: string; baseline?: string; target?: string; source?: string }>;
      sustainability?: string;
    };
    risks?: Array<{ description?: string; probability?: string; impact?: string; mitigation?: string }>;
  };

  const mapEnhancedProposal = (proposal: EnhancedProposalPayload): ProposalOutput => {
    const probabilityMap: Record<string, 'scăzut' | 'mediu' | 'ridicat'> = {
      low: 'scăzut',
      medium: 'mediu',
      high: 'ridicat',
    };

    return {
      title: proposal.title || 'Propunere avansată',
      acronym: proposal.acronym || 'AI',
      summary: proposal.executive_summary || '',
      context: proposal.context || '',
      objectives: {
        general: proposal.objectives?.general || '',
        specific: proposal.objectives?.specific || [],
      },
      methodology: {
        approach: proposal.methodology?.approach || '',
        workPackages: (proposal.methodology?.work_packages || []).map((wp) => ({
          name: wp.title,
          description: (wp.objectives || []).join(' | '),
          duration: `${wp.startMonth}-${wp.endMonth} luni`,
          deliverables: (wp.deliverables || []).map((d) => d.title || ''),
        })),
      },
      budget: {
        summary: proposal.budget?.justification || '',
        categories: (proposal.budget?.cost_breakdown || []).map((cat) => ({
          name: cat.category || '',
          amount: Number(cat.amount) || 0,
          justification: cat.justification || '',
        })),
      },
      indicators: (proposal.impact?.kpis || []).map((kpi) => ({
        name: kpi.indicator || '',
        baseline: kpi.baseline,
        target: kpi.target,
        source: kpi.source,
      })),
      sustainability: proposal.impact?.sustainability || '',
      risks: (proposal.risks || []).map((risk) => ({
        description: risk.description || '',
        probability: probabilityMap[risk.probability] || 'mediu',
        impact: probabilityMap[risk.impact] || 'mediu',
        mitigation: risk.mitigation || '',
      })),
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep('generating');
    setError(null);

    try {
      const endpoint = generatorMode === 'advanced'
        ? '/api/ai/generate-proposal-enhanced'
        : '/api/ai/generate-proposal';

      const res = await csrfFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          businessDescription: form.projectIdea,
          fundingProgram: form.programType,
          budget: form.budget ? Number(form.budget) : undefined,
          duration: form.duration ? Number(form.duration) : undefined,
          locale: 'ro',
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error?.message || 'Eroare la generare');
      }

      const isEnhanced = data.data?.metadata?.mode === 'enhanced';
      setProposal(isEnhanced ? mapEnhancedProposal(data.data.proposal) : data.data.proposal);
      setMeta(data.data.metadata);
      setStep('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Eroare necunoscută');
      setStep('input');
    }
  };

  if (step === 'generating') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        <p className="text-lg text-gray-600">Se generează propunerea de proiect...</p>
        <p className="text-sm text-gray-400">Acest proces poate dura câteva secunde.</p>
      </div>
    );
  }

  if (step === 'result' && proposal) {
    return (
      <div className="space-y-8">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-gray-900">Propunere generată</h2>
          <button
            onClick={() => { setStep('input'); setProposal(null); }}
            className="text-blue-600 hover:text-blue-800"
          >
            ← Generează alta
          </button>
        </div>

        {meta && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
            Mod: {meta.mode === 'enhanced' ? 'Avansat' : 'Standard'} | Tokens utilizați: {meta.tokensUsed} | Surse RAG: {meta.ragSourcesUsed}
          </div>
        )}

        <section className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="text-xl font-semibold">{proposal.title}</h3>
          <p className="text-gray-500 font-mono">{proposal.acronym}</p>
          <div>
            <h4 className="font-semibold text-gray-700">Rezumat</h4>
            <p className="text-gray-600 whitespace-pre-wrap">{proposal.summary}</p>
          </div>
          <div>
            <h4 className="font-semibold text-gray-700">Context</h4>
            <p className="text-gray-600 whitespace-pre-wrap">{proposal.context}</p>
          </div>
        </section>

        <section className="bg-white rounded-lg shadow p-6 space-y-4">
          <h4 className="text-lg font-semibold">Obiective</h4>
          <p className="text-gray-600"><strong>General:</strong> {proposal.objectives.general}</p>
          <ul className="list-disc list-inside space-y-1">
            {proposal.objectives.specific.map((obj, i) => (
              <li key={i} className="text-gray-600">{obj}</li>
            ))}
          </ul>
        </section>

        <section className="bg-white rounded-lg shadow p-6 space-y-4">
          <h4 className="text-lg font-semibold">Metodologie</h4>
          <p className="text-gray-600">{proposal.methodology.approach}</p>
          {proposal.methodology.workPackages.map((wp, i) => (
            <div key={i} className="border-l-4 border-blue-400 pl-4 mt-4">
              <h5 className="font-semibold">WP{i + 1}: {wp.name}</h5>
              <p className="text-gray-600 text-sm">{wp.description}</p>
              <p className="text-gray-500 text-sm">Durată: {wp.duration}</p>
              <ul className="list-disc list-inside text-sm text-gray-500">
                {wp.deliverables.map((d, j) => <li key={j}>{d}</li>)}
              </ul>
            </div>
          ))}
        </section>

        <section className="bg-white rounded-lg shadow p-6 space-y-4">
          <h4 className="text-lg font-semibold">Buget</h4>
          <p className="text-gray-600">{proposal.budget.summary}</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2">Categorie</th>
                <th className="text-right py-2">Sumă (EUR)</th>
                <th className="text-left py-2 pl-4">Justificare</th>
              </tr>
            </thead>
            <tbody>
              {proposal.budget.categories.map((cat, i) => (
                <tr key={i} className="border-b">
                  <td className="py-2">{cat.name}</td>
                  <td className="text-right py-2">{cat.amount.toLocaleString('ro-RO')}</td>
                  <td className="py-2 pl-4 text-gray-500">{cat.justification}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="bg-white rounded-lg shadow p-6 space-y-4">
          <h4 className="text-lg font-semibold">Riscuri</h4>
          {proposal.risks.map((risk, i) => (
            <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded">
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                risk.probability === 'ridicat' ? 'bg-red-100 text-red-700'
                : risk.probability === 'mediu' ? 'bg-yellow-100 text-yellow-700'
                : 'bg-green-100 text-green-700'
              }`}>
                {risk.probability}
              </span>
              <div>
                <p className="text-gray-700">{risk.description}</p>
                <p className="text-sm text-gray-500">Mitigare: {risk.mitigation}</p>
              </div>
            </div>
          ))}
        </section>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-900">Generare propunere de proiect</h2>
      <p className="text-gray-600">Completați detaliile proiectului pentru a genera automat o propunere de finanțare.</p>
      <div className="inline-flex rounded-lg border border-gray-300 p-1 bg-gray-50">
        <button
          type="button"
          onClick={() => setGeneratorMode('standard')}
          className={`px-3 py-1.5 text-sm rounded ${generatorMode === 'standard' ? 'bg-white shadow-sm font-medium' : 'text-gray-600'}`}
        >
          Standard
        </button>
        <button
          type="button"
          onClick={() => setGeneratorMode('advanced')}
          className={`px-3 py-1.5 text-sm rounded ${generatorMode === 'advanced' ? 'bg-white shadow-sm font-medium' : 'text-gray-600'}`}
        >
          Avansat AI
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700">{error}</div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Ideea de proiect *</label>
        <textarea
          required
          minLength={50}
          rows={4}
          className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="Descrieți ideea proiectului dumneavoastră în cel puțin 50 de caractere..."
          value={form.projectIdea}
          onChange={(e) => setForm({ ...form, projectIdea: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Program de finanțare</label>
          <select
            className="w-full border border-gray-300 rounded-lg p-3"
            value={form.programType}
            onChange={(e) => setForm({ ...form, programType: e.target.value })}
          >
            {PROGRAM_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tip organizație</label>
          <select
            className="w-full border border-gray-300 rounded-lg p-3"
            value={form.organizationType}
            onChange={(e) => setForm({ ...form, organizationType: e.target.value })}
          >
            {ORG_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Numele organizației *</label>
        <input
          required
          type="text"
          className="w-full border border-gray-300 rounded-lg p-3"
          placeholder="Ex: SC Inovație Tech SRL"
          value={form.organizationName}
          onChange={(e) => setForm({ ...form, organizationName: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Sector</label>
          <input
            type="text"
            className="w-full border border-gray-300 rounded-lg p-3"
            placeholder="Ex: IT, Mediu"
            value={form.sector}
            onChange={(e) => setForm({ ...form, sector: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Buget (EUR)</label>
          <input
            type="number"
            className="w-full border border-gray-300 rounded-lg p-3"
            placeholder="500000"
            value={form.budget}
            onChange={(e) => setForm({ ...form, budget: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Durată (luni)</label>
          <input
            type="number"
            className="w-full border border-gray-300 rounded-lg p-3"
            placeholder="24"
            value={form.duration}
            onChange={(e) => setForm({ ...form, duration: e.target.value })}
          />
        </div>
      </div>

      <button
        type="submit"
        className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
      >
        🤖 {generatorMode === 'advanced' ? 'Generează propunere avansată' : 'Generează propunerea'}
      </button>
    </form>
  );
}
