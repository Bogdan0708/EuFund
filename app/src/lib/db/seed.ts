// ─── Database Seed Script ────────────────────────────────────────
// Run: npx tsx src/lib/db/seed.ts

import { db } from './index';
import { fundingPrograms, callsForProposals, legislationDocuments, sourceConnectors } from './schema';
import { logger } from '@/lib/logger';

async function seed() {
  console.log('🌱 Seeding database...');

  // ─── Source Connectors ───────────────────────────────────────
  const connectors = await db.insert(sourceConnectors).values([
    {
      slug: 'ec-portal',
      name: 'EU Funding & Tenders Portal',
      accessMethod: 'api',
      baseUrl: 'https://ec.europa.eu/info/funding-tenders/opportunities/portal',
    },
    {
      slug: 'oportunitati-gov',
      name: 'Oportunități UE (Gov.ro)',
      accessMethod: 'html',
      baseUrl: 'https://oportunitati-ue.gov.ro',
    },
    {
      slug: 'fonduri-structurale',
      name: 'Fonduri Structurale',
      accessMethod: 'html',
      baseUrl: 'https://www.fonduri-structurale.ro',
    },
    {
      slug: 'mipe-pnrr',
      name: 'MIPE / PNRR',
      accessMethod: 'html',
      baseUrl: 'https://mfe.gov.ro/pnrr',
    }
  ]).onConflictDoNothing().returning();

  console.log(`✅ Registered ${connectors.length} source connectors`);

  // ─── Funding Programs ───────────────────────────────────────
  const programs = await db.insert(fundingPrograms).values([
    {
      code: 'HORIZON-EUROPE',
      nameRo: 'Orizont Europa',
      nameEn: 'Horizon Europe',
      descriptionRo: 'Programul-cadru al UE pentru cercetare și inovare 2021-2027.',
      managingAuth: 'Comisia Europeană - DG RTD',
      fundSource: 'EU Budget',
      totalBudget: '95500000000',
      periodStart: '2021-01-01',
      periodEnd: '2027-12-31',
      websiteUrl: 'https://ec.europa.eu/horizon-europe',
      status: 'activ',
    },
    {
      code: 'LIFE-PLUS',
      nameRo: 'Programul LIFE',
      nameEn: 'LIFE Programme',
      descriptionRo: 'Instrument de finanțare al UE pentru mediu și acțiune climatică.',
      managingAuth: 'Comisia Europeană - DG ENV',
      fundSource: 'EU Budget',
      totalBudget: '5400000000',
      periodStart: '2021-01-01',
      periodEnd: '2027-12-31',
      websiteUrl: 'https://cinea.ec.europa.eu/programmes/life_en',
      status: 'activ',
    },
    {
      code: 'INTERREG-VI',
      nameRo: 'Interreg VI',
      nameEn: 'Interreg VI',
      descriptionRo: 'Cooperare teritorială europeană 2021-2027.',
      managingAuth: 'Comisia Europeană - DG REGIO',
      fundSource: 'ERDF',
      totalBudget: '8050000000',
      periodStart: '2021-01-01',
      periodEnd: '2027-12-31',
      websiteUrl: 'https://interreg.eu',
      status: 'activ',
    },
    {
      code: 'POCIDIF',
      nameRo: 'Programul Operațional Competitivitate, Digitalizare și Instrumente Financiare',
      nameEn: 'Competitiveness, Digitalization and Financial Instruments OP',
      descriptionRo: 'Program operațional românesc pentru competitivitate și digitalizare.',
      managingAuth: 'Ministerul Investițiilor și Proiectelor Europene',
      fundSource: 'ERDF',
      totalBudget: '3600000000',
      periodStart: '2021-01-01',
      periodEnd: '2029-12-31',
      websiteUrl: 'https://mfe.gov.ro',
      status: 'activ',
    },
    {
      code: 'PNRR',
      nameRo: 'Planul Național de Redresare și Reziliență',
      nameEn: 'National Recovery and Resilience Plan',
      descriptionRo: 'Planul României de redresare post-COVID, finanțat prin NextGenerationEU.',
      managingAuth: 'Ministerul Investițiilor și Proiectelor Europene',
      fundSource: 'NextGenerationEU',
      totalBudget: '29200000000',
      periodStart: '2021-01-01',
      periodEnd: '2026-12-31',
      websiteUrl: 'https://mfe.gov.ro/pnrr',
      status: 'activ',
    },
  ]).returning();

  console.log(`✅ Inserted ${programs.length} funding programs`);

  // ─── Calls for Proposals ──────────────────────────────────────
  const horizonId = programs.find((p) => p.code === 'HORIZON-EUROPE')!.id;
  const lifeId = programs.find((p) => p.code === 'LIFE-PLUS')!.id;
  const interregId = programs.find((p) => p.code === 'INTERREG-VI')!.id;
  const pocidifId = programs.find((p) => p.code === 'POCIDIF')!.id;

  const calls = await db.insert(callsForProposals).values([
    {
      programId: horizonId,
      callCode: 'HORIZON-CL4-2026-DIGITAL-01',
      titleRo: 'Tranziția digitală a IMM-urilor europene',
      titleEn: 'Digital Transition of European SMEs',
      descriptionRo: 'Sprijin pentru transformarea digitală a întreprinderilor mici și mijlocii.',
      eligibleTypes: ['srl', 'sa', 'ong'],
      budgetTotal: '50000000',
      budgetMin: '500000',
      budgetMax: '5000000',
      cofinancingRate: '0',
      durationMin: 24,
      durationMax: 48,
      submissionStart: new Date('2026-03-01'),
      submissionEnd: new Date('2026-09-15'),
      status: 'deschis',
      isCompetitive: true,
    },
    {
      programId: lifeId,
      callCode: 'LIFE-2026-SAP-ENV',
      titleRo: 'Proiecte standard de acțiune - Mediu',
      titleEn: 'Standard Action Projects - Environment',
      descriptionRo: 'Proiecte pentru protecția mediului și eficiența resurselor.',
      eligibleTypes: ['srl', 'sa', 'ong', 'uat', 'institutie_publica'],
      budgetTotal: '120000000',
      budgetMin: '1000000',
      budgetMax: '10000000',
      cofinancingRate: '40',
      durationMin: 36,
      durationMax: 60,
      submissionStart: new Date('2026-04-01'),
      submissionEnd: new Date('2026-10-01'),
      status: 'deschis',
      isCompetitive: true,
    },
    {
      programId: interregId,
      callCode: 'INTERREG-RO-HU-2026-01',
      titleRo: 'Cooperare transfrontalieră România-Ungaria',
      titleEn: 'Romania-Hungary Cross-border Cooperation',
      descriptionRo: 'Proiecte de cooperare în zona de frontieră România-Ungaria.',
      eligibleTypes: ['srl', 'ong', 'uat', 'institutie_publica'],
      eligibleRegions: ['RO11', 'RO42'],
      budgetTotal: '30000000',
      budgetMin: '100000',
      budgetMax: '2000000',
      cofinancingRate: '15',
      durationMin: 12,
      durationMax: 36,
      submissionStart: new Date('2026-02-01'),
      submissionEnd: new Date('2026-06-30'),
      status: 'deschis',
      isCompetitive: true,
    },
    {
      programId: pocidifId,
      callCode: 'POCIDIF-2026-OP1-DIGI',
      titleRo: 'Digitalizare și inovare pentru competitivitate',
      titleEn: 'Digitalization and Innovation for Competitiveness',
      descriptionRo: 'Sprijin pentru investiții în digitalizare, cercetare și inovare pentru IMM-uri din România.',
      eligibleTypes: ['srl', 'sa'],
      eligibleCaen: ['6201', '6202', '6311', '7112', '7211', '7219', '2611', '2612'],
      budgetTotal: '200000000',
      budgetMin: '200000',
      budgetMax: '3000000',
      cofinancingRate: '10',
      durationMin: 12,
      durationMax: 36,
      submissionStart: new Date('2026-01-15'),
      submissionEnd: new Date('2026-12-15'),
      status: 'deschis',
      isCompetitive: false,
    },
  ]).returning();

  console.log(`✅ Inserted ${calls.length} calls for proposals`);

  // ─── Legislation Documents ────────────────────────────────────
  const legislation = await db.insert(legislationDocuments).values([
    {
      extId: '32021R0241',
      type: 'regulament_eu',
      titleRo: 'Regulamentul (UE) 2021/241 de instituire a Mecanismului de redresare și reziliență',
      titleEn: 'Regulation (EU) 2021/241 establishing the Recovery and Resilience Facility',
      issuer: 'Parlamentul European și Consiliul',
      number: '2021/241',
      publishedDate: '2021-02-18',
      effectiveDate: '2021-02-19',
      sourceUrl: 'https://eur-lex.europa.eu/legal-content/RO/TXT/?uri=CELEX:32021R0241',
      relevanceTags: ['pnrr', 'redresare', 'reziliență', 'nextgenerationeu'],
      programs: ['PNRR'],
      isActive: true,
    },
    {
      extId: '32021R0695',
      type: 'regulament_eu',
      titleRo: 'Regulamentul (UE) 2021/695 de instituire a programului Orizont Europa',
      titleEn: 'Regulation (EU) 2021/695 establishing Horizon Europe',
      issuer: 'Parlamentul European și Consiliul',
      number: '2021/695',
      publishedDate: '2021-04-28',
      effectiveDate: '2021-05-12',
      sourceUrl: 'https://eur-lex.europa.eu/legal-content/RO/TXT/?uri=CELEX:32021R0695',
      relevanceTags: ['cercetare', 'inovare', 'horizon'],
      programs: ['HORIZON-EUROPE'],
      isActive: true,
    },
    {
      extId: 'RO-OUG-2024-36',
      type: 'oug',
      titleRo: 'OUG nr. 36/2024 privind modificarea cadrului de implementare a fondurilor europene',
      issuer: 'Guvernul României',
      number: '36/2024',
      publishedDate: '2024-03-15',
      effectiveDate: '2024-03-20',
      relevanceTags: ['fonduri_europene', 'implementare', 'modificare'],
      programs: ['POCIDIF', 'PNRR'],
      isActive: true,
    },
    {
      extId: 'RO-HG-2023-829',
      type: 'hg',
      titleRo: 'HG nr. 829/2023 privind organizarea și funcționarea Ministerului Investițiilor și Proiectelor Europene',
      issuer: 'Guvernul României',
      number: '829/2023',
      publishedDate: '2023-08-10',
      effectiveDate: '2023-08-15',
      relevanceTags: ['mipe', 'organizare', 'fonduri_europene'],
      programs: ['POCIDIF', 'PNRR'],
      isActive: true,
    },
  ]).returning();

  console.log(`✅ Inserted ${legislation.length} legislation documents`);

  console.log('\n🎉 Seed complete!');
  process.exit(0);
}

seed().catch((err) => {
  logger.error({ error: err }, '❌ Seed failed:');
  process.exit(1);
});
