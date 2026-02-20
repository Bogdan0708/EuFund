'use client';

import { csrfFetch } from '@/lib/csrf/client';
import { useState } from 'react';

interface Signer {
  name: string;
  email: string;
  role: 'signer' | 'approver' | 'witness';
  order: number;
}

export default function DocumentSigningPage() {
  const [step, setStep] = useState<'upload' | 'signers' | 'review' | 'sent'>('upload');
  const [documentTitle, setDocumentTitle] = useState('');
  const [signers, setSigners] = useState<Signer[]>([
    { name: '', email: '', role: 'signer', order: 1 },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);

  const addSigner = () => {
    setSigners([...signers, { name: '', email: '', role: 'signer', order: signers.length + 1 }]);
  };

  const updateSigner = (idx: number, field: keyof Signer, value: string) => {
    const updated = [...signers];
    (updated[idx] as any)[field] = value;
    setSigners(updated);
  };

  const removeSigner = (idx: number) => {
    if (signers.length <= 1) return;
    setSigners(signers.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await csrfFetch('/api/integrations/qes/prepare-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: crypto.randomUUID(),
          documentTitle,
          documentContent: btoa('placeholder-pdf-content'),
          signers: signers.filter((s) => s.name && s.email),
          expiresInDays: 30,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setWorkflowId(data.workflow?.id);
      setStep('sent');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const roleLabels: Record<string, string> = {
    signer: 'Semnatar',
    approver: 'Aprobator',
    witness: 'Martor',
  };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">Semnare Electronică Calificată (QES)</h1>
      <p className="text-gray-600 mb-6">
        Semnare conformă eIDAS prin certSIGN — valabilă juridic în toată UE.
      </p>

      {error && (
        <div className="p-4 mb-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>
      )}

      {step === 'sent' ? (
        <div className="text-center py-12">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-xl font-semibold mb-2">Document trimis pentru semnare</h2>
          <p className="text-gray-600">
            Semnatarii vor primi un email cu link-ul de semnare.
          </p>
          {workflowId && (
            <p className="text-sm text-gray-400 mt-4">ID workflow: {workflowId}</p>
          )}
          <button
            onClick={() => { setStep('upload'); setWorkflowId(null); setDocumentTitle(''); }}
            className="mt-6 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Semnează alt document
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Step 1: Document */}
          <div className="p-5 border rounded-xl">
            <h2 className="font-semibold mb-3">1. Document</h2>
            <input
              type="text"
              value={documentTitle}
              onChange={(e) => setDocumentTitle(e.target.value)}
              placeholder="Titlul documentului (ex: Acord de parteneriat)"
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
            <div className="mt-3">
              <label className="block text-sm text-gray-600 mb-1">Încărcați PDF-ul</label>
              <input type="file" accept=".pdf" className="text-sm" />
            </div>
          </div>

          {/* Step 2: Signers */}
          <div className="p-5 border rounded-xl">
            <h2 className="font-semibold mb-3">2. Semnatari</h2>
            {signers.map((s, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={s.name}
                  onChange={(e) => updateSigner(i, 'name', e.target.value)}
                  placeholder="Nume complet"
                  className="flex-1 px-3 py-1.5 border rounded text-sm"
                />
                <input
                  type="email"
                  value={s.email}
                  onChange={(e) => updateSigner(i, 'email', e.target.value)}
                  placeholder="Email"
                  className="flex-1 px-3 py-1.5 border rounded text-sm"
                />
                <select
                  value={s.role}
                  onChange={(e) => updateSigner(i, 'role', e.target.value)}
                  className="px-2 py-1.5 border rounded text-sm"
                >
                  {Object.entries(roleLabels).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
                <button
                  onClick={() => removeSigner(i)}
                  className="px-2 text-red-500 hover:text-red-700"
                  disabled={signers.length <= 1}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={addSigner}
              className="text-sm text-blue-600 hover:underline mt-1"
            >
              + Adaugă semnatar
            </button>
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading || !documentTitle || signers.every((s) => !s.name || !s.email)}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Se procesează...' : 'Trimite pentru semnare'}
          </button>
        </div>
      )}
    </div>
  );
}
