'use client';

import { useState, useCallback } from 'react';
import { csrfFetch } from '@/lib/csrf/client';

interface AnalysisResult {
  analysis: {
    documentType: string;
    language: string;
    summary: string;
    keyFindings: string[];
    complianceGaps: Array<{
      area: string;
      description: string;
      severity: 'minor' | 'major' | 'critical';
      recommendation: string;
    }>;
    qualityScore: number;
    completenessScore: number;
    suggestions: Array<{
      section: string;
      suggestion: string;
      priority: 'low' | 'medium' | 'high';
    }>;
  };
  piiDetections: Array<{
    type: string;
    count: number;
    severity: 'low' | 'medium' | 'high';
  }>;
  gdprCompliant: boolean;
}

export default function DocumentUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback((f: File) => {
    const allowed = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
    if (!allowed.includes(f.type)) {
      setError('Tip de fișier nesuportat. Acceptăm PDF, DOCX, TXT.');
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setError('Fișierul depășește limita de 10MB.');
      return;
    }
    setFile(f);
    setError(null);
    setResult(null);
  }, []);

  const handleSubmit = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('locale', 'ro');

      const res = await csrfFetch('/api/ai/analyze-document', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Eroare la analiză');
      setResult(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Eroare necunoscută');
    } finally {
      setLoading(false);
    }
  };

  const severityColor = (s: string) => {
    switch (s) {
      case 'critical': case 'high': return 'bg-red-100 text-red-700';
      case 'major': case 'medium': return 'bg-yellow-100 text-yellow-700';
      default: return 'bg-green-100 text-green-700';
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Analiză document</h2>
      <p className="text-gray-600">Încărcați un document pentru analiza automată de conformitate și calitate.</p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700">{error}</div>
      )}

      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
          dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
        }}
        onClick={() => document.getElementById('file-input')?.click()}
      >
        <input
          id="file-input"
          type="file"
          accept=".pdf,.docx,.txt"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <div className="text-4xl mb-2">📄</div>
        {file ? (
          <div>
            <p className="font-semibold text-gray-700">{file.name}</p>
            <p className="text-sm text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
          </div>
        ) : (
          <div>
            <p className="text-gray-600">Trageți fișierul aici sau faceți clic</p>
            <p className="text-sm text-gray-400 mt-1">PDF, DOCX sau TXT (max 10MB)</p>
          </div>
        )}
      </div>

      {file && !result && (
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
              Se analizează...
            </span>
          ) : (
            '🔍 Analizează documentul'
          )}
        </button>
      )}

      {result && (
        <div className="space-y-6">
          {/* Scores */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <div className="text-3xl font-bold text-blue-600">{result.analysis.qualityScore}</div>
              <div className="text-sm text-gray-500">Scor calitate</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <div className="text-3xl font-bold text-blue-600">{result.analysis.completenessScore}</div>
              <div className="text-sm text-gray-500">Scor completitudine</div>
            </div>
          </div>

          {/* GDPR Warning */}
          {!result.gdprCompliant && (
            <div className="bg-red-50 border border-red-300 rounded-lg p-4">
              <h4 className="font-semibold text-red-800">⚠️ Atenție GDPR</h4>
              <p className="text-red-700 text-sm">Documentul conține date personale sensibile.</p>
              {result.piiDetections.map((pii, i) => (
                <span key={i} className={`inline-block mr-2 mt-1 px-2 py-0.5 rounded text-xs ${severityColor(pii.severity)}`}>
                  {pii.type}: {pii.count} detectări
                </span>
              ))}
            </div>
          )}

          {/* Summary */}
          <section className="bg-white rounded-lg shadow p-6">
            <h4 className="font-semibold text-gray-700 mb-2">Rezumat</h4>
            <p className="text-gray-600">{result.analysis.summary}</p>
            <div className="mt-3 flex gap-2">
              <span className="px-2 py-1 bg-gray-100 rounded text-xs">{result.analysis.documentType}</span>
              <span className="px-2 py-1 bg-gray-100 rounded text-xs">{result.analysis.language}</span>
            </div>
          </section>

          {/* Compliance Gaps */}
          {result.analysis.complianceGaps.length > 0 && (
            <section className="bg-white rounded-lg shadow p-6">
              <h4 className="font-semibold text-gray-700 mb-3">Lacune de conformitate</h4>
              {result.analysis.complianceGaps.map((gap, i) => (
                <div key={i} className="border-l-4 border-yellow-400 pl-4 mb-4">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${severityColor(gap.severity)}`}>
                      {gap.severity}
                    </span>
                    <span className="font-medium">{gap.area}</span>
                  </div>
                  <p className="text-gray-600 text-sm mt-1">{gap.description}</p>
                  <p className="text-blue-600 text-sm mt-1">💡 {gap.recommendation}</p>
                </div>
              ))}
            </section>
          )}

          {/* Suggestions */}
          {result.analysis.suggestions.length > 0 && (
            <section className="bg-white rounded-lg shadow p-6">
              <h4 className="font-semibold text-gray-700 mb-3">Sugestii de îmbunătățire</h4>
              {result.analysis.suggestions.map((s, i) => (
                <div key={i} className="flex items-start gap-3 mb-3">
                  <span className={`px-2 py-0.5 rounded text-xs mt-0.5 ${
                    s.priority === 'high' ? 'bg-red-100 text-red-700'
                    : s.priority === 'medium' ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-gray-100 text-gray-700'
                  }`}>{s.priority}</span>
                  <div>
                    <p className="font-medium text-sm">{s.section}</p>
                    <p className="text-gray-600 text-sm">{s.suggestion}</p>
                  </div>
                </div>
              ))}
            </section>
          )}

          <button
            onClick={() => { setFile(null); setResult(null); }}
            className="text-blue-600 hover:text-blue-800"
          >
            ← Analizează alt document
          </button>
        </div>
      )}
    </div>
  );
}
