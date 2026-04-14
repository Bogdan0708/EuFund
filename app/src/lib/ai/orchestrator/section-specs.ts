// ─── Section Specs — Default EU Proposal Sections ───────────────────────────

import type { CallBlueprint, SectionSpec, SectionResult } from './types'

export const DEFAULT_SECTIONS: SectionSpec[] = [
  {
    id: 'context',
    title: 'Context și justificare',
    description:
      'Descrierea contextului socio-economic, a problemei identificate și a justificării proiectului.',
    order: 1,
    generationOrder: 1,
    importance: 'critical',
    expectedLength: 'long',
    dependsOn: [],
    modelHint: 'heavy',
    mandatory: true,
    confidence: 1,
  },
  {
    id: 'obiective',
    title: 'Obiective',
    description:
      'Obiectivul general și obiectivele specifice ale proiectului, formulate SMART.',
    order: 2,
    generationOrder: 2,
    importance: 'critical',
    expectedLength: 'medium',
    dependsOn: ['context'],
    modelHint: 'heavy',
    mandatory: true,
    confidence: 1,
  },
  {
    id: 'grup_tinta',
    title: 'Grup țintă',
    description:
      'Definirea și caracterizarea grupului țintă — beneficiarii direcți și indirecți ai proiectului.',
    order: 3,
    generationOrder: 3,
    importance: 'standard',
    expectedLength: 'medium',
    dependsOn: ['context', 'obiective'],
    modelHint: 'light',
    mandatory: true,
    confidence: 1,
  },
  {
    id: 'metodologie',
    title: 'Metodologie și activități',
    description:
      'Descrierea detaliată a activităților, sub-activităților, abordării metodologice și planului de implementare.',
    order: 4,
    generationOrder: 4,
    importance: 'critical',
    expectedLength: 'long',
    dependsOn: ['obiective', 'grup_tinta'],
    modelHint: 'heavy',
    mandatory: true,
    confidence: 1,
  },
  {
    id: 'echipa',
    title: 'Echipa de implementare',
    description:
      'Structura echipei, rolurile, responsabilitățile și expertiza necesară pentru implementarea proiectului.',
    order: 5,
    generationOrder: 5,
    importance: 'standard',
    expectedLength: 'medium',
    dependsOn: ['metodologie'],
    modelHint: 'light',
    mandatory: true,
    confidence: 1,
  },
  {
    id: 'capacitate',
    title: 'Capacitatea aplicantului',
    description:
      'Experiența anterioară, capacitatea administrativă și financiară a aplicantului de a implementa proiectul.',
    order: 6,
    generationOrder: 6,
    importance: 'standard',
    expectedLength: 'medium',
    dependsOn: ['echipa'],
    modelHint: 'light',
    mandatory: true,
    confidence: 1,
  },
  {
    id: 'buget',
    title: 'Buget și plan financiar',
    description:
      'Estimarea detaliată a costurilor, justificarea cheltuielilor eligibile și planul de finanțare.',
    order: 7,
    generationOrder: 7,
    importance: 'critical',
    expectedLength: 'long',
    dependsOn: ['metodologie', 'echipa'],
    modelHint: 'heavy',
    mandatory: true,
    confidence: 1,
  },
  {
    id: 'sustenabilitate',
    title: 'Sustenabilitate',
    description:
      'Planul de asigurare a sustenabilității rezultatelor după finalizarea finanțării.',
    order: 8,
    generationOrder: 8,
    importance: 'standard',
    expectedLength: 'medium',
    dependsOn: ['obiective', 'buget'],
    modelHint: 'light',
    mandatory: true,
    confidence: 1,
  },
  {
    id: 'riscuri',
    title: 'Riscuri și măsuri de atenuare',
    description:
      'Identificarea riscurilor principale și a măsurilor de prevenție și atenuare.',
    order: 9,
    generationOrder: 9,
    importance: 'standard',
    expectedLength: 'short',
    dependsOn: ['metodologie'],
    modelHint: 'light',
    mandatory: false,
    confidence: 1,
  },
  {
    id: 'impact',
    title: 'Impact și indicatori',
    description:
      'Rezultatele așteptate, indicatorii de performanță și metodologia de monitorizare și evaluare.',
    order: 10,
    generationOrder: 10,
    importance: 'standard',
    expectedLength: 'medium',
    dependsOn: ['obiective', 'metodologie'],
    modelHint: 'light',
    mandatory: true,
    confidence: 1,
  },
  {
    id: 'rezumat',
    title: 'Rezumat executiv',
    description:
      'Rezumatul proiectului: context, obiective, activități principale, buget și impact așteptat.',
    order: 0,
    generationOrder: 11,
    importance: 'critical',
    expectedLength: 'medium',
    dependsOn: [
      'context',
      'obiective',
      'metodologie',
      'buget',
      'impact',
    ],
    modelHint: 'heavy',
    mandatory: true,
    confidence: 1,
  },
]

/**
 * Build the list of SectionSpecs for this proposal.
 * If the blueprint specifies required sections, use those (sorted by generationOrder).
 * Otherwise fall back to DEFAULT_SECTIONS.
 */
export function buildSectionSpecs(blueprint: CallBlueprint): SectionSpec[] {
  const fromBlueprint = blueprint.normalized?.requiredSections ?? []

  const specs: SectionSpec[] =
    fromBlueprint.length > 0 ? fromBlueprint : DEFAULT_SECTIONS

  return [...specs].sort((a, b) => a.generationOrder - b.generationOrder)
}

/**
 * Produce a compact context string for the section currently being generated.
 *
 * Inclusion strategy (to avoid blowing the context window):
 * - Full text: sections listed in currentSpec.dependsOn
 * - Full text: last 2 generated sections (by their position in the already-generated list)
 * - Summary (title + first 2 sentences): all other already-generated sections
 */
export function compactPreviousSections(
  allSections: SectionResult[],
  currentSpec: SectionSpec,
): string {
  if (allSections.length === 0) return ''

  const dependsOnSet = new Set(currentSpec.dependsOn)

  // The last 2 generated sections (by array order)
  const lastTwo = new Set(
    allSections
      .slice(-2)
      .map((s) => s.id),
  )

  const parts: string[] = []

  for (const section of allSections) {
    const isDepended = dependsOnSet.has(section.id)
    const isLastTwo = lastTwo.has(section.id)

    if (isDepended || isLastTwo) {
      // Include full text
      parts.push(`## ${section.title}\n\n${section.content}`)
    } else {
      // Include compressed summary: title + first 2 sentences
      const sentences = section.content
        .split(/(?<=[.!?])\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .join(' ')
      parts.push(`## ${section.title} [rezumat]\n\n${sentences}`)
    }
  }

  return parts.join('\n\n---\n\n')
}
