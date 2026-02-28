export interface CrawlerSourceConfig {
  slug: string;
  name: string;
  baseUrl: string;
  listingUrl: string;
  itemSelector: string;
  titleSelector: string;
  linkSelector: string;
  dateSelector?: string;
  programmeDetectionKeywords: Record<string, string[]>;
  depth?: number; // 0 = just listing, 1 = follow detail link
}

export const ROMANIAN_SOURCES: CrawlerSourceConfig[] = [
  {
    slug: 'oportunitati-gov',
    name: 'Oportunități UE Gov',
    baseUrl: 'https://oportunitati-ue.gov.ro',
    listingUrl: 'https://oportunitati-ue.gov.ro/en/apeluri/', // They have an EN/RO toggle
    itemSelector: 'article',
    titleSelector: 'h2',
    linkSelector: 'a.button',
    programmeDetectionKeywords: {
      'PNRR': ['PNRR', 'Redresare'],
      'POCIDIF': ['POCIDIF', 'Digitalizare'],
      'TRANSPORT': ['Transport'],
      'PIDS': ['PIDS', 'Incluziune']
    }
  },
  {
    slug: 'fonduri-structurale',
    name: 'Fonduri Structurale',
    baseUrl: 'https://www.fonduri-structurale.ro',
    listingUrl: 'https://www.fonduri-structurale.ro/stiri',
    itemSelector: '.news-item, article',
    titleSelector: 'h2, h3',
    linkSelector: 'a',
    programmeDetectionKeywords: {
      'SME': ['IMM', 'Micro', 'Start-up'],
      'GREEN': ['Verde', 'Energie', 'Solar'],
      'REGIONAL': ['Regional', 'ADR']
    }
  }
];
