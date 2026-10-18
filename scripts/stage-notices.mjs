// Add legal notices to the publication without touching bundles or sources.json.
import { cpSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));
export function stageNotices(output, root = repository) {
  if (!statSync(output).isDirectory()) throw new Error('Build output must already exist');
  for (const entry of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses']) {
    cpSync(join(root, entry), join(output, entry), { recursive: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length > 3) throw new Error('Expected at most one output directory');
  stageNotices(resolve(process.argv[2] ?? 'dist'));
}
