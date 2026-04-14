#!/usr/bin/env npx tsx
// ─── Generate Obsidian Knowledge Vault + NotebookLM Upload Guides ────
// Reads classification-results.json and creates:
//   1. Obsidian notes per funding call (YAML frontmatter + backlinks)
//   2. Program index notes (MOCs) with Dataview queries
//   3. Master MOC at Indexes/EU-Funds-Knowledge.md
//   4. NotebookLM upload guides (top 50 files per major program)
//
// ⚠️  WORKSTATION-LOCAL TOOLING — not part of the product surface.
// Generated notes contain absolute file paths from the local machine.
// Do not commit generated output to the repository.
//
// Usage:
//   cd app
//   npx tsx scripts/generate-knowledge-vault.ts
//   # Override vault location:
//   VAULT_ROOT="/mnt/c/Users/.../EUFundsVault" npx tsx scripts/generate-knowledge-vault.ts
//
// Idempotent: re-run overwrites existing notes.

import * as fs from 'fs';
import * as path from 'path';

// ─── Config ───────────────────────────────────────────────────────────

const RESULTS_PATH = path.resolve(__dirname, 'classification-output/classification-results.json');
const VAULT_ROOT = process.env.VAULT_ROOT || path.resolve(process.env.HOME || '~', 'Obsidian');
const KNOWLEDGE_DIR = '01-Projects/EU-Funds/Knowledge';
const INDEXES_DIR = '08-Indexes';
const NOTEBOOKLM_DIR = '05-NotebookLM/Upload-Guides';

// Normalize program codes (same map as ingestion scripts)
const PROGRAM_CODE_MAP: Record<string, string> = {
  'PNRR': 'PNRR', 'PEO': 'PEO', 'POTJ': 'POTJ', 'PDD': 'PDD', 'PS': 'PS',
  'AFM': 'AFM', 'FNGCIMM': 'FNGCIMM', 'INTERREG': 'INTERREG',
  'PoAT': 'POAT', 'POAT': 'POAT', 'PAT': 'POAT',
  'PoIDS': 'PoIDS',
  'PoCIDIF': 'POCIDIF', 'POCIDIF': 'POCIDIF', 'POCID': 'POCIDIF',
  'PODD': 'PDD',
  'POCU': 'POCU', 'POC': 'POC', 'POIM': 'POIM', 'POCA': 'POCA',
  'PR-NE': 'PR-NE', 'PR-NV': 'PR-NV', 'PR-VEST': 'PR-VEST',
  'PR-CENTRU': 'PR-CENTRU', 'PR-SE': 'PR-SE', 'PR-SM': 'PR-SM',
  'PR-SV': 'PR-SV', 'PR-BI': 'PR-BI',
};

const PROGRAM_NAMES: Record<string, string> = {
  'PNRR': 'Planul Național de Redresare și Reziliență',
  'PEO': 'Programul Educație și Ocupare',
  'POTJ': 'Programul Operațional Tranziție Justă',
  'PDD': 'Programul Dezvoltare Durabilă',
  'PS': 'Programul Sănătate',
  'POAT': 'Programul Operațional Asistență Tehnică',
  'POCIDIF': 'Programul Operațional Creștere Inteligentă, Digitalizare și Instrumente Financiare',
  'POIM': 'Programul Operațional Infrastructură Mare',
  'POCU': 'Programul Operațional Capital Uman',
  'PoIDS': 'Programul Incluziune și Demnitate Socială',
  'POCA': 'Programul Operațional Capacitate Administrativă',
  'PR-NE': 'Programul Regional Nord-Est',
  'PR-NV': 'Programul Regional Nord-Vest',
  'PR-VEST': 'Programul Regional Vest',
  'PR-CENTRU': 'Programul Regional Centru',
  'PR-SE': 'Programul Regional Sud-Est',
  'PR-SM': 'Programul Regional Sud-Muntenia',
  'PR-SV': 'Programul Regional Sud-Vest',
  'PR-BI': 'Programul Regional București-Ilfov',
  'AFM': 'Administrația Fondului pentru Mediu',
  'FNGCIMM': 'Fondul Național de Garantare a Creditelor pentru IMM',
  'INTERREG': 'INTERREG',
};

// Minimum docs for a program to get a NotebookLM notebook
const NOTEBOOKLM_MIN_DOCS = 10;
const NOTEBOOKLM_MAX_SOURCES = 50;

// ─── Types ────────────────────────────────────────────────────────────

interface ClassifiedFile {
  filePath: string;
  fileName: string;
  parentDir: string;
  extension: string;
  fileSizeMB: number;
  contentHash: string;
  isDuplicate: boolean;
  duplicateOf: string | null;
  programCode: string | null;
  documentType: string | null;
  callCode: string | null;
  titleRo: string | null;
  confidence: string | null;
  suggestedTrack: string | null;
  oversized: boolean;
  error: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);
}

function normalizeDocType(raw: string | null): string {
  if (!raw) return 'unknown';
  const normalized = raw.toLowerCase().replace(/s$/, ''); // "annexes" → "annex"
  return normalized;
}

function confidenceScore(conf: string | null): number {
  if (conf === 'high') return 3;
  if (conf === 'medium') return 2;
  return 1;
}

// ─── Note Generators ─────────────────────────────────────────────────

function generateCallNote(file: ClassifiedFile, programCode: string, relatedFiles: ClassifiedFile[]): string {
  const title = file.titleRo || file.fileName;
  const docType = normalizeDocType(file.documentType);
  const callCode = file.callCode && file.callCode !== 'null' ? file.callCode : null;

  // YAML frontmatter
  const frontmatter = [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    `program: ${programCode}`,
    `documentType: ${docType}`,
    callCode ? `callCode: "${callCode}"` : `callCode: null`,
    `confidence: ${file.confidence || 'low'}`,
    `extension: ${file.extension}`,
    `fileSizeMB: ${file.fileSizeMB}`,
    `contentHash: "${file.contentHash}"`,
    `track: ${file.suggestedTrack || 'unknown'}`,
    `created: ${new Date().toISOString().split('T')[0]}`,
    `tags: [eu-funds, ${programCode.toLowerCase()}, ${docType}]`,
    '---',
  ].join('\n');

  // Body
  const lines: string[] = [
    frontmatter,
    '',
    `# ${title}`,
    '',
    `**Program**: [[${programCode}]]  `,
    `**Tip document**: ${docType}  `,
    callCode ? `**Cod apel**: ${callCode}  ` : '',
    `**Încredere clasificare**: ${file.confidence || 'low'}  `,
    `**Fișier**: \`${file.fileName}\`  `,
    `**Mărime**: ${file.fileSizeMB} MB  `,
    '',
  ].filter(Boolean);

  // Source file path
  lines.push(`## Fișier sursă`);
  lines.push('');
  lines.push(`\`${file.filePath}\``);
  lines.push('');

  // Related documents (backlinks)
  if (relatedFiles.length > 0) {
    lines.push('## Documente conexe');
    lines.push('');
    for (const rf of relatedFiles) {
      const rfTitle = rf.titleRo || rf.fileName;
      const rfType = normalizeDocType(rf.documentType);
      const rfNoteName = sanitizeFilename(rfTitle);
      lines.push(`- [[${rfNoteName}]] (${rfType})`);
    }
    lines.push('');
  }

  // Notes section for manual annotations
  lines.push('## Note');
  lines.push('');
  lines.push('');

  return lines.join('\n');
}

function generateProgramIndex(
  programCode: string,
  files: ClassifiedFile[],
): string {
  const programName = PROGRAM_NAMES[programCode] || programCode;
  const guides = files.filter(f => f.suggestedTrack === 'call-extraction');
  const ragDocs = files.filter(f => f.suggestedTrack === 'rag-knowledge');

  // Group by doc type
  const byType = new Map<string, ClassifiedFile[]>();
  for (const f of files) {
    const type = normalizeDocType(f.documentType);
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(f);
  }

  const frontmatter = [
    '---',
    `title: "${programName}"`,
    `program: ${programCode}`,
    `totalDocs: ${files.length}`,
    `guides: ${guides.length}`,
    `ragDocs: ${ragDocs.length}`,
    `created: ${new Date().toISOString().split('T')[0]}`,
    `tags: [eu-funds, program-index, ${programCode.toLowerCase()}]`,
    '---',
  ].join('\n');

  const lines: string[] = [
    frontmatter,
    '',
    `# ${programCode} — ${programName}`,
    '',
    `| Metric | Count |`,
    `|---|---|`,
    `| Total documente | ${files.length} |`,
    `| Ghiduri solicitant | ${guides.length} |`,
    `| Documente RAG | ${ragDocs.length} |`,
    '',
  ];

  // Document type breakdown
  lines.push('## Documente după tip');
  lines.push('');
  for (const [type, typeDocs] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`### ${type.charAt(0).toUpperCase() + type.slice(1)} (${typeDocs.length})`);
    lines.push('');
    for (const doc of typeDocs.sort((a, b) => confidenceScore(b.confidence) - confidenceScore(a.confidence))) {
      const title = doc.titleRo || doc.fileName;
      const noteName = sanitizeFilename(title);
      const badge = doc.confidence === 'high' ? ' ✅' : doc.confidence === 'medium' ? '' : ' ⚠️';
      lines.push(`- [[${noteName}]]${badge}`);
    }
    lines.push('');
  }

  // Dataview query for dynamic listing
  lines.push('## Dataview — Toate documentele');
  lines.push('');
  lines.push('```dataview');
  lines.push('TABLE documentType AS "Tip", callCode AS "Cod Apel", confidence AS "Încredere", fileSizeMB AS "MB"');
  lines.push(`FROM "${KNOWLEDGE_DIR}/${programCode}"`);
  lines.push('SORT confidence DESC');
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

function generateMasterMOC(
  programStats: Map<string, { total: number; guides: number; rag: number }>,
): string {
  const frontmatter = [
    '---',
    `title: "EU Funds Knowledge Base"`,
    `created: ${new Date().toISOString().split('T')[0]}`,
    `tags: [moc, eu-funds, knowledge-base]`,
    '---',
  ].join('\n');

  const lines: string[] = [
    frontmatter,
    '',
    '# EU Funds Knowledge Base',
    '',
    `> Auto-generated from ${[...programStats.values()].reduce((s, p) => s + p.total, 0)} classified documents.`,
    `> Last updated: ${new Date().toISOString().split('T')[0]}`,
    '',
    '## Programe',
    '',
    '| Program | Nume | Documente | Ghiduri | RAG |',
    '|---|---|---|---|---|',
  ];

  const sorted = [...programStats.entries()].sort((a, b) => b[1].total - a[1].total);
  for (const [code, stats] of sorted) {
    const name = PROGRAM_NAMES[code] || code;
    lines.push(`| [[${code}]] | ${name} | ${stats.total} | ${stats.guides} | ${stats.rag} |`);
  }

  lines.push('');
  lines.push('## Dataview — Deadline-uri');
  lines.push('');
  lines.push('```dataview');
  lines.push('TABLE program AS "Program", callCode AS "Cod Apel", confidence AS "Încredere"');
  lines.push(`FROM "${KNOWLEDGE_DIR}"`);
  lines.push('WHERE callCode != null');
  lines.push('SORT program ASC');
  lines.push('```');
  lines.push('');
  lines.push('## Dataview — După tip document');
  lines.push('');
  lines.push('```dataview');
  lines.push('TABLE length(rows) AS "Count"');
  lines.push(`FROM "${KNOWLEDGE_DIR}"`);
  lines.push('GROUP BY documentType');
  lines.push('SORT length(rows) DESC');
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

function generateNotebookLMGuide(
  programCode: string,
  files: ClassifiedFile[],
): string {
  const programName = PROGRAM_NAMES[programCode] || programCode;

  // Prioritize: guides first, then high confidence, then by size (smaller first)
  const ranked = [...files].sort((a, b) => {
    // Guides first
    const aGuide = a.suggestedTrack === 'call-extraction' ? 1 : 0;
    const bGuide = b.suggestedTrack === 'call-extraction' ? 1 : 0;
    if (aGuide !== bGuide) return bGuide - aGuide;
    // High confidence first
    const confDiff = confidenceScore(b.confidence) - confidenceScore(a.confidence);
    if (confDiff !== 0) return confDiff;
    // Smaller files first (more sources within 50 limit)
    return a.fileSizeMB - b.fileSizeMB;
  });

  const selected = ranked.slice(0, NOTEBOOKLM_MAX_SOURCES);
  const totalMB = selected.reduce((s, f) => s + f.fileSizeMB, 0).toFixed(1);

  const lines: string[] = [
    '---',
    `title: "NotebookLM Upload — ${programCode}"`,
    `program: ${programCode}`,
    `sources: ${selected.length}`,
    `totalMB: ${totalMB}`,
    `created: ${new Date().toISOString().split('T')[0]}`,
    `tags: [notebooklm, upload-guide, ${programCode.toLowerCase()}]`,
    '---',
    '',
    `# NotebookLM: ${programCode} — ${programName}`,
    '',
    `**Sources to upload**: ${selected.length} (of ${files.length} available)  `,
    `**Total size**: ${totalMB} MB  `,
    '',
    '## How to Create',
    '',
    '1. Go to [notebooklm.google.com](https://notebooklm.google.com/)',
    `2. Click **+ New** → Name it **"FondEU-${programCode}"**`,
    '3. Upload the files listed below (drag & drop)',
    '4. Click **Share** → **Anyone with the link** → Copy link',
    `5. Register with Claude: \`/research register-notebook FondEU-${programCode}\``,
    '',
    '## Suggested Questions',
    '',
    `- "Care sunt criteriile de eligibilitate pentru ${programCode}?"`,
    `- "Ce anexe sunt necesare pentru depunerea proiectului?"`,
    `- "Care sunt motivele principale de respingere în evaluarea tehnică?"`,
    `- "Generează un FAQ privind cheltuielile eligibile"`,
    `- "Ce condiții trebuie să îndeplinească un IMM pentru ${programCode}?"`,
    '',
    '## Files to Upload',
    '',
    '| # | File | Type | Confidence | MB |',
    '|---|---|---|---|---|',
  ];

  for (let i = 0; i < selected.length; i++) {
    const f = selected[i];
    const docType = normalizeDocType(f.documentType);
    const conf = f.confidence || 'low';
    lines.push(`| ${i + 1} | \`${f.fileName}\` | ${docType} | ${conf} | ${f.fileSizeMB} |`);
  }

  lines.push('');
  lines.push('## File Paths (for bulk copy)');
  lines.push('');
  lines.push('```bash');
  lines.push('# Copy all files to a staging folder:');
  lines.push(`mkdir -p /tmp/notebooklm-${programCode.toLowerCase()}`);
  for (const f of selected) {
    lines.push(`cp "${f.filePath}" /tmp/notebooklm-${programCode.toLowerCase()}/`);
  }
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

// ─── Knowledge Layer Export ──────────────────────────────────────────

async function exportSessionKnowledge(vaultRoot: string): Promise<void> {
  const { db } = await import('../src/lib/db')
  const { sessionKnowledge } = await import('../src/lib/db/schema')

  const rows = await db.select().from(sessionKnowledge)
  const dir = path.join(vaultRoot, 'wiki', 'projects')
  fs.mkdirSync(dir, { recursive: true })

  const bySession = new Map<string, typeof rows>()
  for (const row of rows) {
    const list = bySession.get(row.sessionId) ?? []
    list.push(row)
    bySession.set(row.sessionId, list)
  }

  for (const [sessionId, pages] of bySession) {
    const sessionDir = path.join(dir, sessionId.slice(0, 8))
    fs.mkdirSync(sessionDir, { recursive: true })
    for (const page of pages) {
      const fm = { ...(page.frontmatter as Record<string, unknown>), kind: page.kind, sessionId, exportedAt: new Date().toISOString() }
      const content = `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n\n# ${page.title}\n\n${page.contentMd}`
      fs.writeFileSync(path.join(sessionDir, `${page.slug}.md`), content)
    }
  }
  console.log(`  Exported ${rows.length} session knowledge pages`)
}

async function exportProposalPatterns(vaultRoot: string): Promise<void> {
  const { db } = await import('../src/lib/db')
  const { proposalPatterns } = await import('../src/lib/db/schema')

  const rows = await db.select().from(proposalPatterns)
  const dir = path.join(vaultRoot, 'wiki', 'patterns')
  fs.mkdirSync(dir, { recursive: true })

  for (const row of rows) {
    const rate = row.timesUsed > 0 ? Math.round((row.timesAccepted / row.timesUsed) * 100) : 0
    const fm = { program: row.program, sectionType: row.sectionType, timesUsed: row.timesUsed, acceptRate: `${rate}%`, exportedAt: new Date().toISOString() }
    const slug = `${row.program}-${row.sectionType}-${row.id.slice(0, 8)}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const content = `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n\n# ${row.title}\n\n${row.contentMd}`
    fs.writeFileSync(path.join(dir, `${slug}.md`), content)
  }
  console.log(`  Exported ${rows.length} proposal patterns`)
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Loading classification results...');
  const allFiles: ClassifiedFile[] = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));

  // Filter valid files and group by normalized program
  const byProgram = new Map<string, ClassifiedFile[]>();
  let validCount = 0;

  for (const file of allFiles) {
    if (file.isDuplicate || file.error) continue;
    validCount++;
    const rawCode = file.programCode || 'UNKNOWN';
    const code = PROGRAM_CODE_MAP[rawCode] || rawCode;
    if (!byProgram.has(code)) byProgram.set(code, []);
    byProgram.get(code)!.push(file);
  }

  console.log(`  Valid files: ${validCount}`);
  console.log(`  Programs: ${byProgram.size}`);

  // ─── 1. Create Obsidian Knowledge Vault ───────────────────────────

  console.log('\n═══ Generating Obsidian Knowledge Vault ═══\n');

  const programStats = new Map<string, { total: number; guides: number; rag: number }>();
  let notesCreated = 0;

  for (const [programCode, files] of byProgram) {
    const programDir = path.join(VAULT_ROOT, KNOWLEDGE_DIR, programCode);
    ensureDir(programDir);

    // Track stats
    programStats.set(programCode, {
      total: files.length,
      guides: files.filter(f => f.suggestedTrack === 'call-extraction').length,
      rag: files.filter(f => f.suggestedTrack === 'rag-knowledge').length,
    });

    // Build a lookup for finding related files (same callCode or program)
    const byCallCode = new Map<string, ClassifiedFile[]>();
    for (const f of files) {
      const cc = f.callCode && f.callCode !== 'null' ? f.callCode : null;
      if (cc) {
        if (!byCallCode.has(cc)) byCallCode.set(cc, []);
        byCallCode.get(cc)!.push(f);
      }
    }

    // Generate individual notes
    for (const file of files) {
      const title = file.titleRo || file.fileName;
      const noteName = sanitizeFilename(title);
      const noteFile = path.join(programDir, `${noteName}.md`);

      // Find related files (same callCode, excluding self)
      const callCode = file.callCode && file.callCode !== 'null' ? file.callCode : null;
      const related = callCode
        ? (byCallCode.get(callCode) || []).filter(f => f.contentHash !== file.contentHash)
        : [];

      const content = generateCallNote(file, programCode, related);
      fs.writeFileSync(noteFile, content);
      notesCreated++;
    }

    // Generate program index note
    const indexContent = generateProgramIndex(programCode, files);
    fs.writeFileSync(path.join(VAULT_ROOT, KNOWLEDGE_DIR, `${programCode}.md`), indexContent);

    console.log(`  ${programCode}: ${files.length} notes`);
  }

  // Generate master MOC
  const mocDir = path.join(VAULT_ROOT, INDEXES_DIR);
  ensureDir(mocDir);
  const mocContent = generateMasterMOC(programStats);
  fs.writeFileSync(path.join(mocDir, 'EU-Funds-Knowledge.md'), mocContent);

  console.log(`\n  Total notes created: ${notesCreated}`);
  console.log(`  Program indexes: ${byProgram.size}`);
  console.log(`  Master MOC: ${INDEXES_DIR}/EU-Funds-Knowledge.md`);

  // ─── 2. Generate NotebookLM Upload Guides ─────────────────────────

  console.log('\n═══ Generating NotebookLM Upload Guides ═══\n');

  const notebookDir = path.join(VAULT_ROOT, NOTEBOOKLM_DIR);
  ensureDir(notebookDir);

  let guidesCreated = 0;
  for (const [programCode, files] of byProgram) {
    if (files.length < NOTEBOOKLM_MIN_DOCS) continue;
    if (programCode === 'UNKNOWN') continue;

    const guideContent = generateNotebookLMGuide(programCode, files);
    fs.writeFileSync(
      path.join(notebookDir, `Upload-${programCode}.md`),
      guideContent,
    );
    guidesCreated++;
    const selected = Math.min(files.length, NOTEBOOKLM_MAX_SOURCES);
    console.log(`  ${programCode}: ${selected}/${files.length} files selected`);
  }

  console.log(`\n  Upload guides created: ${guidesCreated}`);
  console.log(`  Location: ${NOTEBOOKLM_DIR}/`);

  // ─── 3. Export Knowledge Layer (if DATABASE_URL is set) ────────────

  if (process.env.DATABASE_URL) {
    console.log('\n═══ Exporting Knowledge Layer ═══\n');
    try {
      await exportSessionKnowledge(VAULT_ROOT);
      await exportProposalPatterns(VAULT_ROOT);
    } catch (err) {
      console.error('  Knowledge layer export failed (skipping):', err instanceof Error ? err.message : String(err));
    }
  } else {
    console.log('\n  Skipping knowledge layer export (no DATABASE_URL)');
  }

  // ─── Summary ──────────────────────────────────────────────────────

  console.log('\n═══ Done ═══');
  console.log(`  Obsidian: ${VAULT_ROOT}/${KNOWLEDGE_DIR}/`);
  console.log(`  MOC: ${VAULT_ROOT}/${INDEXES_DIR}/EU-Funds-Knowledge.md`);
  console.log(`  NotebookLM: ${VAULT_ROOT}/${NOTEBOOKLM_DIR}/`);
  console.log(`\nNext steps:`);
  console.log(`  1. Open Obsidian → install Dataview plugin if not installed`);
  console.log(`  2. Check ${INDEXES_DIR}/EU-Funds-Knowledge.md for the dashboard`);
  console.log(`  3. For NotebookLM, follow the upload guides in ${NOTEBOOKLM_DIR}/`);
  console.log(`  4. After creating notebooks, register them: /research register-notebook FondEU-<PROGRAM>`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) });
