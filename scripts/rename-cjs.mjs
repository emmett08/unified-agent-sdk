import { readdir, mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';

const srcDir = new URL('../dist/cjs-tmp', import.meta.url);
const outDir = new URL('../dist/cjs', import.meta.url);

await mkdir(outDir, { recursive: true });

async function walk(dir, rel = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    const nextRel = join(rel, e.name);
    if (e.isDirectory()) {
      await walk(p, nextRel);
    } else if (e.isFile()) {
      const dest = join(outDir.pathname, nextRel);
      await mkdir(join(dest, '..'), { recursive: true });
      const newExt = dest.endsWith('.js') ? dest.replace(/\.js$/, '.cjs') : dest;
      await rename(p, newExt);
    }
  }
}

await walk(srcDir.pathname);
