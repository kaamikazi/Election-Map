/**
 * The boundary registry.
 *
 * A boundary set is not a constant. Natural Earth's admin-1 has seven
 * Bangladeshi divisions; there have been eight since Mymensingh split from
 * Dhaka in 2015. Both are "the provinces of Bangladesh" and they disagree, so
 * the app has to carry which set it drew, what year that set represents, who
 * made it and under what licence — per country and per level, because all four
 * vary.
 *
 *   BoundarySource {
 *     id            'ne' | 'gb'
 *     iso           ISO3
 *     level         'ADM1' | 'ADM2' | 'CONSTITUENCY' | ...
 *     units         count
 *     vintage       year the boundary represents, or null if the source does
 *                   not state one
 *     licence       per boundary, not per source
 *     attribution   the line the export footer prints
 *     sourceAgency  who produced it
 *     url
 *   }
 *
 * Layer ids are `<id>:<iso>:<level>` — 'gb:BGD:ADM1', 'ne:BGD:ADM1'.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
export const REGISTRY_FILE = path.join(ROOT, 'public', 'data', 'boundaries.json');

export const layerId = (id, iso, level) => `${id}:${iso}:${level}`;

export function readRegistry() {
  if (!fs.existsSync(REGISTRY_FILE)) {
    return { version: 1, generated: null, countries: {}, sources: {} };
  }
  try {
    const r = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    r.countries = r.countries || {};
    r.sources = r.sources || {};
    return r;
  } catch {
    return { version: 1, generated: null, countries: {}, sources: {} };
  }
}

/**
 * Merge entries in and write. Each build script owns its own `id` prefix and
 * leaves every other source alone, so rebuilding Natural Earth never drops a
 * geoBoundaries layer that took a network round trip to make.
 */
export async function writeRegistry(registry, entries, countries) {
  for (const entry of entries) {
    registry.sources[layerId(entry.id, entry.iso, entry.level)] = entry;
  }
  Object.assign(registry.countries, countries || {});
  registry.generated = new Date().toISOString();
  await fsp.mkdir(path.dirname(REGISTRY_FILE), { recursive: true });
  await fsp.writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2));
  return REGISTRY_FILE;
}
