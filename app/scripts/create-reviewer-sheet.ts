#!/usr/bin/env npx tsx
import fs from 'fs';
import path from 'path';

const RESULTS_PATH = path.resolve(__dirname, 'classification-output/classification-results.json');
const REVIEW_SHEET_PATH = path.resolve(__dirname, 'classification-output/manual-reviewer-sheet.txt');

async function createReviewerSheet() {
  const results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
  const unknowns = results.filter((r: any) => r.programCode === 'UNKNOWN');
  
  if (unknowns.length === 0) {
    console.log('No UNKNOWN files left for manual review.');
    return;
  }

  console.log(`Creating manual reviewer sheet for ${unknowns.length} files...`);

  let sheet = `================================================================================
MANUAL REVIEWER SHEET - Romanian EU Funding Documents
================================================================================
Instructions:
1. Open each file in the "unclasified" folder on your desktop.
2. In the "NEW_PROGRAM" column, replace "UNKNOWN" with one of:
   PNRR, POCIDIF, POTJ, PEO, PDD, PS, POAT, PR-NE, PR-SE, PR-S, PR-SV, PR-NV, PR-W, PR-C, PR-BI, AFM, FNGCIMM.
3. If it is a common Annex, name it by the Ghid it belongs to (e.g., PNRR).
4. Save this file as "manual-reviewer-sheet-UPDATED.txt".
================================================================================

[ID] | [FILENAME] | [NEW_PROGRAM]
--------------------------------------------------------------------------------
`;

  unknowns.forEach((u: any, idx: number) => {
    sheet += `${idx + 1}. | ${u.fileName} | UNKNOWN\n`;
  });

  fs.writeFileSync(REVIEW_SHEET_PATH, sheet);
  console.log(`Reviewer sheet saved to: ${REVIEW_SHEET_PATH}`);
}

createReviewerSheet();
