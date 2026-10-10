import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function seriesPlanSha256(manifest) {
  const { generatedAt, review, implementationSha256, ...stable } = manifest;
  return sha256(JSON.stringify(stable));
}

const inputs = [
  'src/archive.js', 'src/export.js', 'src/render.js', 'src/series.js', 'src/state.js',
  'src/import/adapters.js', 'src/import/proposal.js', 'src/publication.js',
  'src/geo.js', 'src/families.js', 'src/vintage.js', 'src/provenance.js',
  'public/data/governing.json', 'public/data/world-50m.topo.json'
];

export async function seriesSourceSha256(root) {
  const h = createHash('sha256');
  for (const file of inputs) {
    h.update(file + '\0');
    h.update(await fs.readFile(path.join(root, file)));
  }
  return h.digest('hex');
}
