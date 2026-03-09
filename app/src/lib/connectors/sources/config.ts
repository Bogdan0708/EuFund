export interface CrawlerSourceConfig {
  slug: string;
  name: string;
  baseUrl: string;
  listingUrl: string;
  itemSelector: string;
  titleSelector: string;
  linkSelector: string;
  dateSelector?: string;
  defaultInstrument?: 'grant' | 'state_aid' | 'guarantee' | 'loan';
  defaultChannel: 'mysmis' | 'pnrr_portal' | 'bank_network' | 'afm_portal' | 'minister_portal';
  programmeDetectionKeywords: Record<string, string[]>;
}

export const ROMANIAN_SOURCES: CrawlerSourceConfig[] = [
  // ─── National Authorities ────────────────────────────────────
  {
    slug: 'oportunitati-gov',
    name: 'Oportunități UE Gov',
    baseUrl: 'https://oportunitati-ue.gov.ro',
    listingUrl: 'https://oportunitati-ue.gov.ro/apeluri/',
    itemSelector: 'article',
    titleSelector: 'h2',
    linkSelector: 'a',
    defaultChannel: 'mysmis',
    programmeDetectionKeywords: {
      'PNRR': ['PNRR'],
      'POCIDIF': ['POCIDIF', 'Digitalizare'],
      'PTJ': ['Tranziție Justă', 'PTJ'],
    }
  },
  {
    slug: 'afm',
    name: 'AFM - Administrația Fondului pentru Mediu',
    baseUrl: 'https://www.afm.ro',
    listingUrl: 'https://www.afm.ro/programe_finantate.php',
    itemSelector: '.program-item',
    titleSelector: 'h4',
    linkSelector: 'a',
    defaultChannel: 'afm_portal',
    programmeDetectionKeywords: {
      'GREEN': ['Fotovoltaice', 'Rabla', 'Eficienta Energetica'],
    }
  },
  // ─── Guarantee Funds ─────────────────────────────────────────
  {
    slug: 'fngcimm',
    name: 'FNGCIMM Guarantees',
    baseUrl: 'https://www.fngcimm.ro',
    listingUrl: 'https://www.fngcimm.ro/programe',
    itemSelector: '.card',
    titleSelector: '.card-title',
    linkSelector: 'a',
    defaultInstrument: 'guarantee',
    defaultChannel: 'bank_network',
    programmeDetectionKeywords: {
      'IMM-PLUS': ['IMM PLUS', 'IMM INVEST'],
      'INVEST-EU': ['InvestEU'],
    }
  },
  // ─── Regional (All 8 ADRs) ───────────────────────────────────
  {
    slug: 'adr-nord-est',
    name: 'ADR Nord-Est (Regio)',
    baseUrl: 'https://www.adrnordest.ro',
    listingUrl: 'https://www.adrnordest.ro/category/regio-2021-2027/',
    itemSelector: 'article',
    titleSelector: 'h2',
    linkSelector: 'a',
    defaultChannel: 'mysmis',
    programmeDetectionKeywords: { 'PR-NE': ['Regio', 'Nord-Est'] }
  },
  {
    slug: 'adr-centru',
    name: 'ADR Centru',
    baseUrl: 'https://www.regiocentru.ro',
    listingUrl: 'https://www.regiocentru.ro/category/apeluri-deschise/',
    itemSelector: '.post',
    titleSelector: '.entry-title',
    linkSelector: 'a',
    defaultChannel: 'mysmis',
    programmeDetectionKeywords: { 'PR-CENTRU': ['Regiunea Centru'] }
  },
  {
    slug: 'adr-vest',
    name: 'ADR Vest',
    baseUrl: 'https://www.adrvest.ro',
    listingUrl: 'https://www.adrvest.ro/apeluri-lansate/',
    itemSelector: '.call-item',
    titleSelector: 'h3',
    linkSelector: 'a',
    defaultChannel: 'mysmis',
    programmeDetectionKeywords: { 'PR-VEST': ['Regio Vest'] }
  },
  {
    slug: 'adr-bi',
    name: 'ADR București-Ilfov',
    baseUrl: 'https://www.adrbi.ro',
    listingUrl: 'https://www.adrbi.ro/programe-regionale/por-bi-2021-2027/apeluri-de-proiecte/',
    itemSelector: '.call-row, tr',
    titleSelector: 'td:first-child, .title',
    linkSelector: 'a',
    defaultChannel: 'mysmis',
    programmeDetectionKeywords: { 'PR-BI': ['Bucuresti', 'Ilfov'] }
  },
  {
    slug: 'adr-nord-vest',
    name: 'ADR Nord-Vest',
    baseUrl: 'https://www.nord-vest.ro',
    listingUrl: 'https://www.nord-vest.ro/programe-regionale/programul-regional-nord-vest-2021-2027/apeluri-proiecte/',
    itemSelector: '.elementor-post',
    titleSelector: 'h3',
    linkSelector: 'a',
    defaultChannel: 'mysmis',
    programmeDetectionKeywords: { 'PR-NV': ['Nord-Vest'] }
  },
  {
    slug: 'adr-sud-vest',
    name: 'ADR Sud-Vest Oltenia',
    baseUrl: 'https://www.adcsvo.ro',
    listingUrl: 'https://www.adcsvo.ro/apeluri-lansate-pr-sv/',
    itemSelector: '.call-box, .post',
    titleSelector: 'h4, .title',
    linkSelector: 'a',
    defaultChannel: 'mysmis',
    programmeDetectionKeywords: { 'PR-SV': ['Sud-Vest', 'Oltenia'] }
  },
  {
    slug: 'adr-sud-muntenia',
    name: 'ADR Sud-Muntenia',
    baseUrl: 'https://2021-2027.adrmuntenia.ro',
    listingUrl: 'https://2021-2027.adrmuntenia.ro/apeluri-lansate',
    itemSelector: '.call-item',
    titleSelector: '.title',
    linkSelector: 'a',
    defaultChannel: 'mysmis',
    programmeDetectionKeywords: { 'PR-SM': ['Sud-Muntenia'] }
  },
  {
    slug: 'adr-sud-est',
    name: 'ADR Sud-Est',
    baseUrl: 'https://www.adru.ro',
    listingUrl: 'https://www.adru.ro/programul-regional-sud-est-2021-2027/apeluri-de-proiecte-lansate/',
    itemSelector: '.post',
    titleSelector: 'h2',
    linkSelector: 'a',
    defaultChannel: 'mysmis',
    programmeDetectionKeywords: { 'PR-SE': ['Sud-Est'] }
  }
];
