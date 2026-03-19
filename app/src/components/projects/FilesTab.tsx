'use client';

import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';

interface FilesTabProps {
  projectId: string;
}

interface PlaceholderFile {
  name: string;
  size: string;
  type: string;
}

const uploadedPlaceholders: PlaceholderFile[] = [
  { name: 'statut-organizatie.pdf', size: '2.4 MB', type: 'PDF' },
  { name: 'plan-afaceri.docx', size: '1.1 MB', type: 'DOCX' },
];

const generatedPlaceholders: PlaceholderFile[] = [
  { name: 'cerere-finantare-draft.pdf', size: '3.2 MB', type: 'PDF' },
  { name: 'buget-detaliat.xlsx', size: '845 KB', type: 'XLSX' },
];

function FileRow({ file, locale }: { file: PlaceholderFile; locale: string }) {
  return (
    <div className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--color-border)]
      bg-[var(--color-bg)] px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <span className="shrink-0 flex items-center justify-center w-9 h-9 rounded-[var(--radius-sm)]
          bg-[var(--color-bg-secondary)] text-[var(--font-size-xs)] font-semibold text-[var(--color-text-secondary)]">
          {file.type}
        </span>
        <div className="min-w-0">
          <p className="text-[var(--font-size-sm)] font-medium text-[var(--color-text)] truncate">
            {file.name}
          </p>
          <p className="text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
            {file.size}
          </p>
        </div>
      </div>
      <Button variant="ghost" size="sm" className="shrink-0 text-[var(--color-accent)]">
        {locale === 'ro' ? 'Descarca' : 'Download'}
      </Button>
    </div>
  );
}

export function FilesTab({ projectId: _projectId }: FilesTabProps) {
  const locale = useLocale();

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Uploaded files */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-[var(--font-size-sm)] font-semibold text-[var(--color-text)]">
            {locale === 'ro' ? 'Fisiere incarcate' : 'Uploaded files'}
          </h4>
          <Button variant="outline" size="sm">
            {locale === 'ro' ? 'Incarca' : 'Upload'}
          </Button>
        </div>
        <div className="space-y-2">
          {uploadedPlaceholders.map((file) => (
            <FileRow key={file.name} file={file} locale={locale} />
          ))}
        </div>
      </div>

      {/* Generated files */}
      <div className="space-y-3">
        <h4 className="text-[var(--font-size-sm)] font-semibold text-[var(--color-text)]">
          {locale === 'ro' ? 'Fisiere generate' : 'Generated files'}
        </h4>
        <div className="space-y-2">
          {generatedPlaceholders.map((file) => (
            <FileRow key={file.name} file={file} locale={locale} />
          ))}
        </div>
      </div>
    </div>
  );
}
