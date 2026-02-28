'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { csrfFetch } from '@/lib/csrf/client';

interface MatchResult {
  id?: string;
  call: {
    id?: string;
    callCode: string;
    titleRo: string;
    programName: string;
    submissionEnd?: string;
    budgetMin?: number;
    budgetMax?: number;
  };
  eligibilityScore: number;
  relevanceScore: number;
  overallScore: number;
  matchReason: string;
  recommendations: string[];
}

const ORG_TYPES = [
  { value: 'srl', label: 'SRL' },
  { value: 'sa', label: 'SA' },
  { value: 'ong', label: 'ONG' },
  { value: 'uat', label: 'UAT' },
  { value: 'institutie_publica', label: 'Instituție publică' },
];

export default function GrantMatcher() {
  const params = useParams<{ locale?: string }>();
  const locale = params?.locale || 'ro';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchResult[] | null>(null);

  const [form, setForm] = useState({
    projectIdea: '',
    orgType: 'srl',
    nutsRegion: '',
    caenPrimary: '',
    budget: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await csrfFetch('/api/ai/wizard/match-calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectIdea: form.projectIdea,
          organization: {
            orgType: form.orgType,
          },
          budget: form.budget ? Number(form.budget) : undefined,
          locale: 'ro',
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Eroare');
      setMatches(data.data.matches);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Eroare necunoscută');
    } finally {
      setLoading(false);
    }
  };

  const scoreColor = (score: number) => {
    if (score >= 70) return 'text-green-600';
    if (score >= 40) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Potrivire finanțări</h2>
      <p className="text-gray-600">Descrieți ideea proiectului pentru a găsi cele mai potrivite apeluri de finanțare.</p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Ideea de proiect *</label>
          <textarea
            required
            minLength={20}
            rows={3}
            className="w-full border border-gray-300 rounded-lg p-3"
            placeholder="Descrieți pe scurt ideea proiectului..."
            value={form.projectIdea}
            onChange={(e) => setForm({ ...form, projectIdea: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tip organizație</label>
            <select
              className="w-full border border-gray-300 rounded-lg p-3"
              value={form.orgType}
              onChange={(e) => setForm({ ...form, orgType: e.target.value })}
            >
              {ORG_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Buget estimat (EUR)</label>
            <input
              type="number"
              className="w-full border border-gray-300 rounded-lg p-3"
              placeholder="500000"
              value={form.budget}
              onChange={(e) => setForm({ ...form, budget: e.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Regiune NUTS2</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-lg p-3"
              placeholder="Ex: RO32"
              value={form.nutsRegion}
              onChange={(e) => setForm({ ...form, nutsRegion: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cod CAEN principal</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-lg p-3"
              placeholder="Ex: 6201"
              value={form.caenPrimary}
              onChange={(e) => setForm({ ...form, caenPrimary: e.target.value })}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? '🔄 Se caută potriviri...' : '🎯 Găsește finanțări potrivite'}
        </button>
      </form>

      {matches && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">
            {matches.length} apeluri evaluate
          </h3>

          {matches.map((m, i) => (
            <div key={i} className="bg-white rounded-lg shadow p-6 border-l-4 border-blue-500">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold text-gray-900">{m.call.titleRo}</h4>
                  <p className="text-sm text-gray-500">{m.call.callCode} • {m.call.programName}</p>
                </div>
                <div className={`text-3xl font-bold ${scoreColor(m.overallScore)}`}>
                  {m.overallScore}%
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mt-4 text-sm">
                <div>
                  <span className="text-gray-500">Eligibilitate</span>
                  <div className={`font-semibold ${scoreColor(m.eligibilityScore)}`}>{m.eligibilityScore}%</div>
                </div>
                <div>
                  <span className="text-gray-500">Relevanță</span>
                  <div className={`font-semibold ${scoreColor(m.relevanceScore)}`}>{m.relevanceScore}%</div>
                </div>
                {m.call.submissionEnd && (
                  <div>
                    <span className="text-gray-500">Termen limită</span>
                    <div>{new Date(m.call.submissionEnd).toLocaleDateString('ro-RO')}</div>
                  </div>
                )}
              </div>

              {m.matchReason && (
                <p className="text-gray-600 mt-3 text-sm">{m.matchReason}</p>
              )}

              {m.recommendations.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium text-gray-700">Recomandări:</p>
                  <ul className="list-disc list-inside text-sm text-gray-600">
                    {m.recommendations.map((r, j) => <li key={j}>{r}</li>)}
                  </ul>
                </div>
              )}

              <div className="mt-6">
                <Link 
                  href={`/${locale}/proiecte/asistent-proiect?callId=${m.call.id ?? m.id ?? ''}`}
                  className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 w-full"
                >
                  🚀 Creează proiect cu acest apel
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
