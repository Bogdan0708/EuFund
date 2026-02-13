'use client';

import { useState, useEffect } from 'react';
import { formatCurrencyEur, formatDateRo } from '@/lib/utils/romanian';

interface FundingCall {
  identifier: string;
  title: string;
  description: string;
  programme: string;
  status: 'open' | 'forthcoming' | 'closed';
  openingDate: string;
  deadlineDate: string;
  budget: number | null;
  url: string;
}

export default function FundingCallsLivePage() {
  const [calls, setCalls] = useState<FundingCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'open' | 'forthcoming' | 'all'>('open');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCalls();
  }, [filter]);

  const loadCalls = async () => {
    setLoading(true);
    setError(null);
    try {
      const status = filter === 'all' ? '' : `&status=${filter}`;
      const res = await fetch(`/api/integrations/funding-calls?limit=50${status}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCalls(data.calls ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const statusColors: Record<string, string> = {
    open: 'bg-green-100 text-green-800',
    forthcoming: 'bg-yellow-100 text-yellow-800',
    closed: 'bg-gray-100 text-gray-600',
  };

  const statusLabels: Record<string, string> = {
    open: 'Deschis',
    forthcoming: 'Viitor',
    closed: 'Închis',
  };

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Apeluri de Finanțare Active</h1>
          <p className="text-gray-600 mt-1">
            Date în timp real de la Portalul de Finanțare al Comisiei Europene
          </p>
        </div>
        <button
          onClick={loadCalls}
          disabled={loading}
          className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          🔄 Actualizează
        </button>
      </div>

      <div className="flex gap-2 mb-6">
        {(['open', 'forthcoming', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 text-sm rounded-full border ${
              filter === f ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-50'
            }`}
          >
            {f === 'open' ? 'Deschise' : f === 'forthcoming' ? 'Viitoare' : 'Toate'}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-4 mb-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Se încarcă apelurile...</div>
      ) : calls.length === 0 ? (
        <div className="text-center py-12 text-gray-500">Niciun apel găsit</div>
      ) : (
        <div className="space-y-4">
          {calls.map((call) => (
            <div key={call.identifier} className="p-5 border rounded-xl hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${statusColors[call.status]}`}>
                      {statusLabels[call.status]}
                    </span>
                    {call.programme && (
                      <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">
                        {call.programme}
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-1">{call.title}</h3>
                  <p className="text-sm text-gray-600 line-clamp-2">{call.description}</p>
                  <div className="flex gap-4 mt-2 text-sm text-gray-500">
                    {call.budget && <span>💰 {formatCurrencyEur(call.budget)}</span>}
                    {call.deadlineDate && (
                      <span>📅 Termen: {formatDateRo(call.deadlineDate)}</span>
                    )}
                    <span className="text-xs text-gray-400">{call.identifier}</span>
                  </div>
                </div>
                <a
                  href={call.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 whitespace-nowrap"
                >
                  Detalii →
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
