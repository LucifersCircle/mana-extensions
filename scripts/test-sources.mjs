import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Shared by the runner and reporter: a newly added source cannot silently disappear.
export function discoverSources(root = 'src/sources') {
  const names = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'index.ts')))
    .map((entry) => entry.name).sort();
  if (!names.length) throw new Error(`No source entry points found in ${root}`);
  return names;
}
