'use client';

import { useLocale } from 'next-intl';
import { StatusBadge } from '@/components/ui/status-badge';

export interface Project {
  id: string;
  orgId: string;
  callId?: string | null;
  title: string;
  acronym?: string | null;
  status: string;
  totalBudget?: string | null;
  complianceScore?: number | null;
  matchScore?: number | null;
  createdAt: string;
  updatedAt: string;
  programName?: string | null;
}

interface ProjectCardProps {
  project: Project;
  onClick: (project: Project) => void;
}

function formatRelativeDate(dateString: string, locale: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return locale === 'ro' ? 'Astazi' : 'Today';
  if (diffDays === 1) return locale === 'ro' ? 'Ieri' : 'Yesterday';
  if (diffDays < 7) {
    return locale === 'ro' ? `acum ${diffDays} zile` : `${diffDays} days ago`;
  }
  return date.toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

export function ProjectCard({ project, onClick }: ProjectCardProps) {
  const locale = useLocale();

  return (
    <button
      type="button"
      onClick={() => onClick(project)}
      className="group w-full text-left rounded-[var(--radius-md)] border border-[var(--color-border)]
        bg-[var(--color-bg)] p-5 shadow-[var(--shadow-sm)]
        transition-all duration-[var(--transition)]
        hover:shadow-[var(--shadow-md)] hover:border-[var(--color-accent)]
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="text-[var(--font-size-base)] font-semibold text-[var(--color-text)] leading-snug line-clamp-2
          group-hover:text-[var(--color-accent)] transition-colors duration-[var(--transition)]">
          {project.title}
        </h3>
        <StatusBadge kind="project" value={project.status} />
      </div>

      {project.acronym && (
        <p className="text-[var(--font-size-sm)] text-[var(--color-text-secondary)] mb-2">
          {project.acronym}
        </p>
      )}

      {project.programName && (
        <span className="inline-block rounded-[var(--radius-full)] bg-[var(--color-bg-secondary)]
          px-2.5 py-0.5 text-[var(--font-size-xs)] font-medium text-[var(--color-text-secondary)] mb-3">
          {project.programName}
        </span>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-[var(--color-border)]">
        <span className="text-[var(--font-size-xs)] text-[var(--color-text-secondary)]">
          {locale === 'ro' ? 'Actualizat' : 'Updated'}: {formatRelativeDate(project.updatedAt, locale)}
        </span>
        {project.totalBudget && Number(project.totalBudget) > 0 && (
          <span className="text-[var(--font-size-xs)] font-medium text-[var(--color-text)]">
            {new Intl.NumberFormat(locale === 'ro' ? 'ro-RO' : 'en-GB', {
              style: 'currency',
              currency: 'EUR',
              maximumFractionDigits: 0,
            }).format(Number(project.totalBudget))}
          </span>
        )}
      </div>
    </button>
  );
}
