'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

interface SearchResult {
  celex: string;
  title: string;
  type: string;
  date: string;
  url: string;
}

export default function LegislatiePage() {
  const t = useTranslations('legislation');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/integrations/eurlex/search?q=${encodeURIComponent(query)}&limit=20`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResults(data.results ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const typeLabels: Record<string, string> = {
    regulation: 'Regulament',
    directive: 'Directivă',
    decision: 'Decizie',
    recommendation: 'Recomandare',
    other: 'Altul',
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Legislație UE</h1>
      <p className="text-gray-600 mb-4">
        Căutați regulamente, directive și decizii din EUR-Lex relevante pentru fonduri europene.
      </p>

      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Ex: fonduri structurale, GDPR, ajutor de stat..."
          className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Se caută...' : 'Caută'}
        </button>
      </div>

      {error && (
        <div className="p-4 mb-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">{results.length} rezultate găsite</p>
          {results.map((r) => (
            <div key={r.celex} className="p-4 border rounded-lg hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <span className="inline-block px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded mb-1">
                    {typeLabels[r.type] ?? r.type}
                  </span>
                  <h3 className="font-medium text-gray-900">{r.title}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    CELEX: {r.celex} {r.date && `• ${r.date}`}
                  </p>
                </div>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline whitespace-nowrap"
                >
                  Deschide →
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {results.length === 0 && !loading && query && (
        <p className="text-gray-500 text-center py-8">Niciun rezultat găsit pentru „{query}"</p>
      )}
    </div>
  );
}
