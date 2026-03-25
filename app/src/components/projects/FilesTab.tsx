'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { csrfFetch } from '@/lib/csrf/client';

interface FileRecord {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  category: string;
  description: string | null;
  createdAt: string;
}

interface FilesTabProps {
  projectId: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileTypeLabel(mimeType: string): string {
  if (mimeType.includes('pdf')) return 'PDF';
  if (mimeType.includes('wordprocessing') || mimeType.includes('msword')) return 'DOCX';
  if (mimeType.includes('spreadsheet') || mimeType.includes('ms-excel')) return 'XLSX';
  if (mimeType.includes('presentation')) return 'PPTX';
  if (mimeType.includes('csv')) return 'CSV';
  if (mimeType.includes('text/plain')) return 'TXT';
  if (mimeType.includes('image/')) return 'IMG';
  return 'FILE';
}

export function FilesTab({ projectId }: FilesTabProps) {
  const locale = useLocale();
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/files`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploading(true);
      setError(null);

      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await csrfFetch(`/api/v1/projects/${projectId}/files`, {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Upload failed' }));
          throw new Error(data.error);
        }

        await fetchFiles();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [projectId, fetchFiles],
  );

  const handleDelete = useCallback(
    async (fileId: string) => {
      try {
        const res = await csrfFetch(`/api/v1/projects/${projectId}/files/${fileId}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          setFiles((prev) => prev.filter((f) => f.id !== fileId));
        }
      } catch {
        // silently fail
      }
    },
    [projectId],
  );

  const uploaded = files.filter((f) => f.category === 'uploaded');
  const generated = files.filter((f) => f.category === 'generated');

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Uploaded files */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-[var(--font-size-sm)] font-semibold text-[var(--color-text)]">
            {locale === 'ro' ? 'Fisiere incarcate' : 'Uploaded files'}
          </h4>
          <Button
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading
              ? (locale === 'ro' ? 'Se incarca...' : 'Uploading...')
              : (locale === 'ro' ? 'Incarca' : 'Upload')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.pptx,.txt,.csv,.png,.jpg,.jpeg,.webp"
            onChange={handleUpload}
          />
        </div>

        {error && (
          <p className="text-[var(--font-size-xs)] text-[var(--color-error)]">{error}</p>
        )}

        {loading && (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-[var(--radius-sm)] bg-[var(--color-bg-secondary)]" />
            ))}
          </div>
        )}

        {!loading && uploaded.length === 0 && (
          <p className="py-6 text-center text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
            {locale === 'ro' ? 'Niciun fisier incarcat' : 'No uploaded files'}
          </p>
        )}

        <div className="space-y-2">
          {uploaded.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              projectId={projectId}
              locale={locale}
              onDelete={handleDelete}
            />
          ))}
        </div>
      </div>

      {/* Generated files */}
      <div className="space-y-3">
        <h4 className="text-[var(--font-size-sm)] font-semibold text-[var(--color-text)]">
          {locale === 'ro' ? 'Fisiere generate' : 'Generated files'}
        </h4>

        {!loading && generated.length === 0 && (
          <p className="py-6 text-center text-[var(--font-size-sm)] text-[var(--color-text-secondary)]">
            {locale === 'ro' ? 'Niciun fisier generat' : 'No generated files'}
          </p>
        )}

        <div className="space-y-2">
          {generated.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              projectId={projectId}
              locale={locale}
              onDelete={handleDelete}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function FileRow({
  file,
  projectId,
  locale,
  onDelete,
}: {
  file: FileRecord;
  projectId: string;
  locale: string;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--color-border)]
        bg-[var(--color-bg)] px-4 py-3"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span
          className="shrink-0 flex items-center justify-center w-9 h-9 rounded-[var(--radius-sm)]
            bg-[var(--color-bg-secondary)] text-[var(--font-size-xs)] font-semibold text-[var(--color-text-secondary)]"
        >
          {fileTypeLabel(file.mimeType)}
        </span>
        <div className="min-w-0">
          <p className="text-[var(--font-size-sm)] font-medium text-[var(--color-text)] truncate">
            {file.filename}
          </p>
          <p className="text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
            {formatSize(file.sizeBytes)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <a
          href={`/api/v1/projects/${projectId}/files/${file.id}`}
          className="inline-flex items-center px-3 py-1.5 text-[var(--font-size-xs)] font-medium
            text-[var(--color-accent)] hover:underline"
          download
        >
          {locale === 'ro' ? 'Descarca' : 'Download'}
        </a>
        <button
          onClick={() => onDelete(file.id)}
          className="inline-flex items-center px-2 py-1.5 text-[var(--font-size-xs)]
            text-[var(--color-text-secondary)] hover:text-[var(--color-error)] transition-colors"
          title={locale === 'ro' ? 'Sterge' : 'Delete'}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2.5 4h9M5 4V2.5h4V4M3.5 4v7.5a1 1 0 001 1h5a1 1 0 001-1V4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
