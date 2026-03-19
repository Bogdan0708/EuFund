'use client';

import { useLocale } from 'next-intl';

interface QuickStartItem {
  id: string;
  labelRo: string;
  labelEn: string;
  descriptionRo: string;
  descriptionEn: string;
  hint: string;
  icon: string;
}

const QUICK_STARTS: QuickStartItem[] = [
  {
    id: 'eligibility',
    labelRo: 'Verifica eligibilitatea',
    labelEn: 'Check eligibility',
    descriptionRo: 'Afla daca organizatia ta este eligibila pentru fonduri UE',
    descriptionEn: 'Find out if your organization is eligible for EU funds',
    hint: 'I want to check if my organization is eligible for EU funds.',
    icon: '\u2714',
  },
  {
    id: 'find-calls',
    labelRo: 'Gaseste apeluri deschise',
    labelEn: 'Find open calls',
    descriptionRo: 'Cauta apeluri de finantare potrivite pentru ideea ta',
    descriptionEn: 'Search for funding calls matching your idea',
    hint: 'I want to find open funding calls that match my project idea.',
    icon: '\uD83D\uDD0D',
  },
  {
    id: 'improve-draft',
    labelRo: 'Imbunatateste o cerere',
    labelEn: 'Improve a draft',
    descriptionRo: 'Optimizeaza o cerere de finantare pe care ai scris-o deja',
    descriptionEn: 'Optimize a funding application you already wrote',
    hint: 'I have a draft application that I want to improve.',
    icon: '\uD83D\uDCDD',
  },
  {
    id: 'new-project',
    labelRo: 'Incepe un proiect nou',
    labelEn: 'Start a new project',
    descriptionRo: 'Creeaza o cerere de finantare de la zero cu ghidaj AI',
    descriptionEn: 'Create a funding application from scratch with AI guidance',
    hint: 'I want to start a new EU funding application from scratch.',
    icon: '\uD83D\uDE80',
  },
];

interface QuickStartsProps {
  onSelect: (hint: string) => void;
}

export function QuickStarts({ onSelect }: QuickStartsProps) {
  const locale = useLocale();

  return (
    <div className="flex flex-col items-center justify-center px-4 py-12">
      <h2
        className="mb-2 text-center font-semibold"
        style={{ fontSize: 'var(--font-size-2xl)', color: 'var(--color-text)' }}
      >
        {locale === 'ro' ? 'Cum te putem ajuta?' : 'How can we help?'}
      </h2>
      <p
        className="mb-8 text-center"
        style={{ fontSize: 'var(--font-size-base)', color: 'var(--color-text-secondary)' }}
      >
        {locale === 'ro'
          ? 'Alege o optiune pentru a incepe sau scrie direct mesajul tau.'
          : 'Choose an option to get started or type your message below.'}
      </p>

      <div className="grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        {QUICK_STARTS.map((item) => (
          <button
            key={item.id}
            onClick={() => onSelect(item.hint)}
            className="group flex flex-col items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)]
              bg-white p-5 text-left transition-all duration-200
              hover:border-[var(--color-accent)] hover:shadow-[var(--shadow-md)]
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            style={{ boxShadow: 'var(--shadow-sm)' }}
          >
            <span className="text-2xl">{item.icon}</span>
            <span
              className="font-medium group-hover:text-[var(--color-accent)]"
              style={{ fontSize: 'var(--font-size-base)', color: 'var(--color-text)' }}
            >
              {locale === 'ro' ? item.labelRo : item.labelEn}
            </span>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              {locale === 'ro' ? item.descriptionRo : item.descriptionEn}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
