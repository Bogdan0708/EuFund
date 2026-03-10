#!/usr/bin/env npx tsx
// ─── Seed Missing Funding Programs ────────────────────────────────────
// Adds all Romanian 2021-2027 programs that the classifier found documents for.
// Safe to re-run (uses onConflictDoNothing on unique code).
//
// Usage: cd app && npx tsx --env-file=.env.local scripts/seed-programs.ts

import { db } from '../src/lib/db';
import { fundingPrograms } from '../src/lib/db/schema';

const PROGRAMS = [
  // ─── National 2021-2027 ───────────────────────────────────────
  {
    code: 'PEO',
    nameRo: 'Programul Educație și Ocupare',
    nameEn: 'Education and Employment Programme',
    descriptionRo: 'Program operațional 2021-2027 pentru educație, formare profesională și ocuparea forței de muncă.',
    managingAuth: 'Ministerul Investițiilor și Proiectelor Europene',
    fundSource: 'ESF+',
    totalBudget: '4810000000',
    periodStart: '2021-01-01',
    periodEnd: '2029-12-31',
    status: 'activ' as const,
  },
  {
    code: 'PoIDS',
    nameRo: 'Programul Incluziune și Demnitate Socială',
    nameEn: 'Social Inclusion and Dignity Programme',
    descriptionRo: 'Program operațional 2021-2027 pentru incluziune socială, combaterea sărăciei și nediscriminare.',
    managingAuth: 'Ministerul Investițiilor și Proiectelor Europene',
    fundSource: 'ESF+',
    totalBudget: '3530000000',
    periodStart: '2021-01-01',
    periodEnd: '2029-12-31',
    status: 'activ' as const,
  },
  {
    code: 'POTJ',
    nameRo: 'Programul Tranziție Justă',
    nameEn: 'Just Transition Programme',
    descriptionRo: 'Program pentru tranziție justă în regiunile carbonifere (Hunedoara, Gorj, Dolj, Galați, Prahova, Mureș).',
    managingAuth: 'Ministerul Investițiilor și Proiectelor Europene',
    fundSource: 'JTF',
    totalBudget: '2140000000',
    periodStart: '2021-01-01',
    periodEnd: '2029-12-31',
    status: 'activ' as const,
  },
  {
    code: 'PDD',
    nameRo: 'Programul Dezvoltare Durabilă',
    nameEn: 'Sustainable Development Programme',
    descriptionRo: 'Program operațional 2021-2027 pentru infrastructură de mediu, apă, deșeuri și biodiversitate.',
    managingAuth: 'Ministerul Investițiilor și Proiectelor Europene',
    fundSource: 'CF/ERDF',
    totalBudget: '6070000000',
    periodStart: '2021-01-01',
    periodEnd: '2029-12-31',
    status: 'activ' as const,
  },
  {
    code: 'POAT',
    nameRo: 'Programul Asistență Tehnică',
    nameEn: 'Technical Assistance Programme',
    descriptionRo: 'Program operațional 2021-2027 pentru asistență tehnică în gestionarea fondurilor europene.',
    managingAuth: 'Ministerul Investițiilor și Proiectelor Europene',
    fundSource: 'ERDF',
    totalBudget: '600000000',
    periodStart: '2021-01-01',
    periodEnd: '2029-12-31',
    status: 'activ' as const,
  },
  {
    code: 'PS',
    nameRo: 'Programul Sănătate',
    nameEn: 'Health Programme',
    descriptionRo: 'Program operațional 2021-2027 pentru infrastructură de sănătate și servicii medicale.',
    managingAuth: 'Ministerul Investițiilor și Proiectelor Europene',
    fundSource: 'ERDF/ESF+',
    totalBudget: '3640000000',
    periodStart: '2021-01-01',
    periodEnd: '2029-12-31',
    status: 'activ' as const,
  },
  // PoCIDIF / POCIDIF already seeded in main seed.ts as 'POCIDIF'
  // ─── Regional 2021-2027 ───────────────────────────────────────
  {
    code: 'PR-NE',
    nameRo: 'Programul Regional Nord-Est',
    nameEn: 'North-East Regional Programme',
    descriptionRo: 'Programul regional 2021-2027 pentru dezvoltarea regiunii Nord-Est.',
    managingAuth: 'ADR Nord-Est',
    fundSource: 'ERDF',
    totalBudget: '2580000000',
    periodStart: '2021-01-01',
    periodEnd: '2029-12-31',
    status: 'activ' as const,
  },
  {
    code: 'PR-NV',
    nameRo: 'Programul Regional Nord-Vest',
    nameEn: 'North-West Regional Programme',
    descriptionRo: 'Programul regional 2021-2027 pentru dezvoltarea regiunii Nord-Vest.',
    managingAuth: 'ADR Nord-Vest',
    fundSource: 'ERDF',
    totalBudget: '1910000000',
    periodStart: '2021-01-01',
    periodEnd: '2029-12-31',
    status: 'activ' as const,
  },
  {
    code: 'PR-VEST',
    nameRo: 'Programul Regional Vest',
    nameEn: 'West Regional Programme',
    descriptionRo: 'Programul regional 2021-2027 pentru dezvoltarea regiunii Vest.',
    managingAuth: 'ADR Vest',
    fundSource: 'ERDF',
    totalBudget: '1130000000',
    periodStart: '2021-01-01',
    periodEnd: '2029-12-31',
    status: 'activ' as const,
  },
  {
    code: 'PR-CENTRU',
    nameRo: 'Programul Regional Centru',
    nameEn: 'Central Regional Programme',
    descriptionRo: 'Programul regional 2021-2027 pentru dezvoltarea regiunii Centru.',
    managingAuth: 'ADR Centru',
    fundSource: 'ERDF',
    totalBudget: '1680000000',
    periodStart: '2021-01-01',
    periodEnd: '2029-12-31',
    status: 'activ' as const,
  },
  {
    code: 'PR-SE',
    nameRo: 'Programul Regional Sud-Est',
    nameEn: 'South-East Regional Programme',
    descriptionRo: 'Programul regional 2021-2027 pentru dezvoltarea regiunii Sud-Est.',
    managingAuth: 'ADR Sud-Est',
    fundSource: 'ERDF',
    totalBudget: '2290000000',
    periodStart: '2021-01-01',
    periodEnd: '2029-12-31',
    status: 'activ' as const,
  },
  {
    code: 'PR-SM',
    nameRo: 'Programul Regional Sud-Muntenia',
    nameEn: 'South-Muntenia Regional Programme',
    descriptionRo: 'Programul regional 2021-2027 pentru dezvoltarea regiunii Sud-Muntenia.',
    managingAuth: 'ADR Sud-Muntenia',
    fundSource: 'ERDF',
    totalBudget: '2180000000',
    periodStart: '2021-01-01',
    periodEnd: '2029-12-31',
    status: 'activ' as const,
  },
  {
    code: 'PR-SV',
    nameRo: 'Programul Regional Sud-Vest Oltenia',
    nameEn: 'South-West Oltenia Regional Programme',
    descriptionRo: 'Programul regional 2021-2027 pentru dezvoltarea regiunii Sud-Vest Oltenia.',
    managingAuth: 'ADR Sud-Vest Oltenia',
    fundSource: 'ERDF',
    totalBudget: '2040000000',
    periodStart: '2021-01-01',
    periodEnd: '2029-12-31',
    status: 'activ' as const,
  },
  {
    code: 'PR-BI',
    nameRo: 'Programul Regional București-Ilfov',
    nameEn: 'Bucharest-Ilfov Regional Programme',
    descriptionRo: 'Programul regional 2021-2027 pentru dezvoltarea regiunii București-Ilfov.',
    managingAuth: 'ADR București-Ilfov',
    fundSource: 'ERDF',
    totalBudget: '530000000',
    periodStart: '2021-01-01',
    periodEnd: '2029-12-31',
    status: 'activ' as const,
  },
  // ─── Other / Legacy ───────────────────────────────────────────
  {
    code: 'AFM',
    nameRo: 'Administrația Fondului pentru Mediu',
    nameEn: 'Environmental Fund Administration',
    descriptionRo: 'Programe naționale de finanțare pentru mediu (Casa Verde, Rabla, etc.).',
    managingAuth: 'AFM',
    fundSource: 'National/EU',
    totalBudget: '2000000000',
    periodStart: '2020-01-01',
    periodEnd: '2030-12-31',
    status: 'activ' as const,
  },
  {
    code: 'FNGCIMM',
    nameRo: 'Fondul Național de Garantare a Creditelor pentru IMM',
    nameEn: 'National Credit Guarantee Fund for SMEs',
    descriptionRo: 'Instrumente financiare de garantare pentru IMM-uri (IMM Invest, etc.).',
    managingAuth: 'FNGCIMM',
    fundSource: 'National/EU',
    totalBudget: '5000000000',
    periodStart: '2020-01-01',
    periodEnd: '2030-12-31',
    status: 'activ' as const,
  },
  // Legacy programs (2014-2020, might appear in historical documents)
  {
    code: 'POCU',
    nameRo: 'Programul Operațional Capital Uman 2014-2020',
    nameEn: 'Human Capital Operational Programme 2014-2020',
    descriptionRo: 'Program operațional 2014-2020 pentru educație, ocupare și incluziune socială.',
    managingAuth: 'Ministerul Investițiilor și Proiectelor Europene',
    fundSource: 'ESF',
    periodStart: '2014-01-01',
    periodEnd: '2023-12-31',
    status: 'arhivat' as const,
  },
  {
    code: 'POIM',
    nameRo: 'Programul Operațional Infrastructură Mare 2014-2020',
    nameEn: 'Large Infrastructure Operational Programme 2014-2020',
    descriptionRo: 'Program operațional 2014-2020 pentru infrastructură de transport, mediu și energie.',
    managingAuth: 'Ministerul Investițiilor și Proiectelor Europene',
    fundSource: 'CF/ERDF',
    periodStart: '2014-01-01',
    periodEnd: '2023-12-31',
    status: 'arhivat' as const,
  },
  {
    code: 'POCA',
    nameRo: 'Programul Operațional Capacitate Administrativă 2014-2020',
    nameEn: 'Administrative Capacity Operational Programme 2014-2020',
    descriptionRo: 'Program operațional 2014-2020 pentru reformă administrativă și capacitate instituțională.',
    managingAuth: 'Ministerul Investițiilor și Proiectelor Europene',
    fundSource: 'ESF',
    periodStart: '2014-01-01',
    periodEnd: '2023-12-31',
    status: 'arhivat' as const,
  },
];

async function main() {
  console.log('Seeding funding programs...\n');

  const result = await db.insert(fundingPrograms)
    .values(PROGRAMS)
    .onConflictDoNothing({ target: fundingPrograms.code })
    .returning();

  console.log(`Inserted ${result.length} new programs:`);
  for (const p of result) {
    console.log(`  ${p.code} — ${p.nameRo}`);
  }

  if (result.length === 0) {
    console.log('  (all programs already exist)');
  }

  console.log('\nDone.');
  process.exit(0);
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
