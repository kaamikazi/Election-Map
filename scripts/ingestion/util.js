import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const ordered = (v) => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordered(v[k])])) : v;
export const json = (value) => JSON.stringify(ordered(value), null, 2) + '\n';
export const fingerprint = (value) => hash(json(value));
export const readJson = async (file, fallback) => {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return fallback; throw e; }
};
/**
 * Write-once evidence. The bytes go to a temporary file first and are linked
 * into place, so the target only ever exists complete: a failed write (e.g. a
 * full disk) cannot leave a truncated file behind. An existing zero-byte file
 * is the trace of such an interrupted write under the old scheme and is
 * repaired; any other mismatch is refused as a collision.
 */
export async function immutable(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const existing = await fs.readFile(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (existing && existing.length === 0 && Buffer.byteLength(bytes) > 0) {
    await atomic(file, bytes); return;
  }
  if (existing) {
    if (hash(existing) !== hash(bytes)) throw new Error(`Immutable evidence collision or corruption: ${file}`);
    return;
  }
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, bytes, { flag: 'wx' });
  try { await fs.link(tmp, file); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    if (hash(await fs.readFile(file)) !== hash(bytes)) throw new Error(`Immutable evidence collision or corruption: ${file}`);
  }
  finally { await fs.unlink(tmp).catch(() => {}); }
}
export async function atomic(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(tmp, bytes, { flag: 'wx' }); await fs.rename(tmp, file); }
  finally { await fs.unlink(tmp).catch((e) => { if (e.code !== 'ENOENT') throw e; }); }
}
export function safeName(value) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(value || '')) throw new Error(`Unsafe source/resource identifier: ${value}`);
  return value;
}
export function inside(root, relative) {
  const target = path.resolve(root, relative), rel = path.relative(path.resolve(root), target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Path must stay inside ${root}: ${relative}`);
  return target;
}
