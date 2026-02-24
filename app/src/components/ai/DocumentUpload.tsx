'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Link2, UploadCloud } from 'lucide-react';
import { csrfFetch } from '@/lib/csrf/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/page-states';
import { StatusBadge } from '@/components/ui/status-badge';
import { ToastItem, ToastStack } from '@/components/ui/toast-stack';

type EvidenceDocument = {
  id: string;
  filename: string;
  fileSize: number;
  createdAt: string;
  status: 'pending' | 'approved' | 'changes';
  tags: string[];
  linkedTo: string;
};

const missingEvidenceByArea = [
  'Declarație semnată pentru jalonul M2',
  'Pontaje pentru costurile de personal T2',
  'Dovadă achiziție pentru pachetul de echipamente',
];

export default function DocumentUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tagsInput, setTagsInput] = useState('dovadă, conformitate');
  const [linkedTo, setLinkedTo] = useState('Jalon M2');
  const [documents, setDocuments] = useState<EvidenceDocument[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const allowed = useMemo(() => [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'application/msword',
  ], []);

  const pushToast = (title: string, type: ToastItem['type']) => {
    const item = { id: crypto.randomUUID(), title, type };
    setToasts((prev) => [...prev, item]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((entry) => entry.id !== item.id));
    }, 3500);
  };

  const onSelectFile = (selected: File) => {
    if (!allowed.includes(selected.type)) {
      setError('Tip de fișier nesuportat. Încarcă PDF, DOC, DOCX sau TXT.');
      return;
    }

    if (selected.size > 50 * 1024 * 1024) {
      setError('Fișierul depășește limita de 50MB.');
      return;
    }

    setError(null);
    setFile(selected);
    setUploadProgress(0);
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setUploadProgress(10);
    setError(null);

    const progressTimer = window.setInterval(() => {
      setUploadProgress((current) => (current >= 90 ? current : current + 10));
    }, 180);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('docType', 'altul');

      const res = await csrfFetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
      });

      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload?.error?.message || 'Nu s-a putut încărca fișierul justificativ.');
      }

      const entry: EvidenceDocument = {
        id: payload.data.id,
        filename: payload.data.filename,
        fileSize: Number(payload.data.fileSize || file.size),
        createdAt: payload.data.createdAt || new Date().toISOString(),
        status: 'pending',
        tags: tagsInput.split(',').map((tag) => tag.trim()).filter(Boolean),
        linkedTo,
      };

      setDocuments((previous) => [entry, ...previous]);
      setFile(null);
      setUploadProgress(100);
      pushToast('Dovada a fost încărcată cu succes.', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Eroare neașteptată la încărcare.');
      pushToast('Încărcarea a eșuat. Încearcă din nou.', 'warning');
    } finally {
      window.clearInterval(progressTimer);
      setUploading(false);
      window.setTimeout(() => setUploadProgress(0), 500);
    }
  };

  return (
    <div className="space-y-6">
      <ToastStack items={toasts} />

      <Card className="border-amber-200 bg-amber-50/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Dovezi lipsă
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm text-amber-900">
            {missingEvidenceByArea.map((item) => (
              <li key={item}>• {item}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Încărcare documente și dovezi</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <button
            type="button"
            className={`w-full rounded-xl border-2 border-dashed p-8 text-center transition ${
              dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60'
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              const selected = event.dataTransfer.files[0];
              if (selected) onSelectFile(selected);
            }}
            onClick={() => document.getElementById('evidence-upload-input')?.click()}
            aria-label="Încarcă document justificativ"
          >
            <input
              id="evidence-upload-input"
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.txt"
              onChange={(event) => {
                const selected = event.target.files?.[0];
                if (selected) onSelectFile(selected);
              }}
            />
            <UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium">Trage fișierele aici sau apasă pentru selectare</p>
            <p className="text-xs text-muted-foreground">Acceptat: PDF, DOC, DOCX, TXT, max 50MB</p>
          </button>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Etichete (separate prin virgulă)</label>
              <Input
                value={tagsInput}
                onChange={(event) => setTagsInput(event.target.value)}
                placeholder="dovadă, factură, anexă"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Jalon/raport asociat</label>
              <Input
                value={linkedTo}
                onChange={(event) => setLinkedTo(event.target.value)}
                placeholder="Jalon M2 sau raport trimestrial"
              />
            </div>
          </div>

          {file && (
            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{Math.round(file.size / 1024)} KB</p>
                </div>
                <Button onClick={handleUpload} disabled={uploading}>
                  {uploading ? 'Se încarcă...' : 'Încarcă dovada'}
                </Button>
              </div>

              {uploading && (
                <div className="mt-3">
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-all" style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{uploadProgress}% finalizat</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Listă documente</CardTitle>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <EmptyState title="Nu există dovezi încărcate" description="Documentele încărcate apar aici cu status și legături." />
          ) : (
            <ul className="space-y-3">
              {documents.map((document) => (
                <li key={document.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{document.filename}</p>
                      <p className="text-xs text-muted-foreground">
                        {Math.round(document.fileSize / 1024)} KB • {new Date(document.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <StatusBadge kind="review" value={document.status} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {document.tags.map((tag) => (
                      <span key={tag} className="rounded-full bg-muted px-2 py-0.5">#{tag}</span>
                    ))}
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">
                      <Link2 className="h-3.5 w-3.5" />
                      {document.linkedTo}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Sursă de adevăr: registrul de documente
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
