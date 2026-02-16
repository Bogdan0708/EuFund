#!/usr/bin/env ts-node
// ─── Batch Protect AI Endpoints ───────────────────────────────────
// Automatically adds withAIAuth protection to unprotected AI endpoints

import * as fs from 'fs';
import * as path from 'path';

const AI_DIR = path.join(__dirname, '../app/src/app/api/ai');

// Endpoints that need protection
const ENDPOINTS_TO_PROTECT = [
  'validate-compliance',
  'generate-proposal',
  'project-analysis',
  'analyze-document',
  'deadline-risk-assessment',
  'optimize-timeline',
  'analyze-consortium',
  'optimize-budget',
  'generate-report',
  'project-health',
  'market-intelligence',
  'recommend-partners',
  'generate-insights',
  'advanced-analytics',
];

interface ProtectionResult {
  endpoint: string;
  status: 'protected' | 'already_protected' | 'failed' | 'not_found';
  error?: string;
}

function protectEndpoint(endpoint: string): ProtectionResult {
  const routeFile = path.join(AI_DIR, endpoint, 'route.ts');

  // Check if file exists
  if (!fs.existsSync(routeFile)) {
    return { endpoint, status: 'not_found' };
  }

  let content = fs.readFileSync(routeFile, 'utf-8');

  // Check if already protected
  if (content.includes('withAIAuth')) {
    return { endpoint, status: 'already_protected' };
  }

  try {
    // Step 1: Add import statement
    if (!content.includes("from '@/lib/middleware/auth'")) {
      const importRegex = /(import.*from.*['"]@\/lib\/.*['"];)/;
      const lastImport = content.match(importRegex);

      if (lastImport) {
        const importStatement = "\nimport { withAIAuth } from '@/lib/middleware/auth';";
        content = content.replace(lastImport[0], lastImport[0] + importStatement);
      } else {
        // Add after first import
        content = content.replace(
          /(import.*from.*['"].*['"];)/,
          "$1\nimport { withAIAuth } from '@/lib/middleware/auth';"
        );
      }
    }

    // Step 2: Wrap POST handler with withAIAuth
    const postRegex = /export\s+async\s+function\s+POST\s*\(\s*request:\s*NextRequest\s*\)\s*\{/;
    content = content.replace(
      postRegex,
      'export async function POST(request: NextRequest) {\n  return withAIAuth(request, async (user) => {'
    );

    // Step 3: Add closing brace before final }
    // Find the last closing brace of the POST function
    const lines = content.split('\n');
    let braceCount = 0;
    let postFunctionStarted = false;
    let insertIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes('export async function POST')) {
        postFunctionStarted = true;
      }

      if (postFunctionStarted) {
        braceCount += (line.match(/\{/g) || []).length;
        braceCount -= (line.match(/\}/g) || []).length;

        if (braceCount === 0 && i > 0) {
          insertIndex = i;
          break;
        }
      }
    }

    if (insertIndex !== -1) {
      lines.splice(insertIndex, 0, '  });');
      content = lines.join('\n');
    }

    // Step 4: Add user context to logAudit calls
    content = content.replace(
      /await\s+logAudit\(\{/g,
      'await logAudit({\n      userId: user.id,'
    );

    // Step 5: Add userTier to metadata if not present
    content = content.replace(
      /metadata:\s*\{([^}]*)\}/g,
      (match, metadataContent) => {
        if (!metadataContent.includes('userTier')) {
          return `metadata: {${metadataContent}, userTier: user.tier }`;
        }
        return match;
      }
    );

    // Write back to file
    fs.writeFileSync(routeFile, content, 'utf-8');

    return { endpoint, status: 'protected' };
  } catch (error) {
    return {
      endpoint,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Main execution
function main() {
  console.log('🛡️  Batch Protecting AI Endpoints\n');
  console.log('════════════════════════════════════════════════════════════\n');

  const results: ProtectionResult[] = [];

  for (const endpoint of ENDPOINTS_TO_PROTECT) {
    console.log(`Processing: ${endpoint}...`);
    const result = protectEndpoint(endpoint);
    results.push(result);

    switch (result.status) {
      case 'protected':
        console.log(`  ✅ Protected successfully\n`);
        break;
      case 'already_protected':
        console.log(`  ℹ️  Already protected\n`);
        break;
      case 'not_found':
        console.log(`  ⚠️  File not found\n`);
        break;
      case 'failed':
        console.log(`  ❌ Failed: ${result.error}\n`);
        break;
    }
  }

  console.log('════════════════════════════════════════════════════════════');
  console.log('\n📊 Summary:\n');

  const summary = {
    protected: results.filter(r => r.status === 'protected').length,
    alreadyProtected: results.filter(r => r.status === 'already_protected').length,
    notFound: results.filter(r => r.status === 'not_found').length,
    failed: results.filter(r => r.status === 'failed').length,
  };

  console.log(`  ✅ Protected: ${summary.protected}`);
  console.log(`  ℹ️  Already Protected: ${summary.alreadyProtected}`);
  console.log(`  ⚠️  Not Found: ${summary.notFound}`);
  console.log(`  ❌ Failed: ${summary.failed}`);
  console.log('');

  if (summary.failed > 0) {
    console.log('⚠️  Some endpoints failed to protect. Review manually:\n');
    results
      .filter(r => r.status === 'failed')
      .forEach(r => console.log(`  - ${r.endpoint}: ${r.error}`));
    process.exit(1);
  }

  console.log('✅ All endpoints processed successfully!');
  process.exit(0);
}

main();
