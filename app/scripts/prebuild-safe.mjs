import { rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const targets = ['.next', 'tsconfig.tsbuildinfo'];

for (const target of targets) {
  if (existsSync(target)) {
    await rm(target, { recursive: true, force: true });
    console.log(`Removed stale build artifact: ${target}`);
  }
}

try {
  await stat('src');
  await stat('package.json');
} catch (error) {
  console.error('Prebuild sanity check failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log('Prebuild sanity checks passed.');
