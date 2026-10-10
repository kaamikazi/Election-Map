/** Content-addressed bytes and append-only capture receipts; pointers are not evidence. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { hash, json, immutable, atomic, readJson, safeName, inside } from './util.js';

const META = ['content-type', 'content-length', 'content-encoding', 'content-disposition', 'etag', 'last-modified', 'date'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getBytes(url, { fetchImpl, timeoutMs, maxBytes }) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const res = await fetchImpl(url, { signal: controller.signal, headers: {
          accept: '*/*', 'accept-encoding': 'identity', 'user-agent': 'ElectionMapStudio/2.0 (registered-source ingestion)'
        } });
        if (!res.ok) { await res.body?.cancel(); const e = new Error(`HTTP ${res.status} for ${url}`); e.status = res.status; throw e; }
        if (res.status === 206) { await res.body?.cancel(); throw new Error(`Partial HTTP response (206) for ${url}`); }
        const chunks = []; let size = 0;
        for await (const part of res.body || []) {
          size += part.length;
          if (size > maxBytes) { controller.abort(); throw new Error(`Source exceeds ${maxBytes} bytes`); }
          chunks.push(Buffer.from(part));
        }
        const bytes = Buffer.concat(chunks);
        if (!bytes.length) throw new Error(`Empty download for ${url}`);
        const declared = res.headers.get('content-length');
        const encoding = res.headers.get('content-encoding');
        if (declared && (!encoding || encoding === 'identity') && Number(declared) !== bytes.length) {
          throw new Error(`Interrupted/truncated download: expected ${declared} bytes, received ${bytes.length}`);
        }
        return { bytes, http: { status: res.status, finalUrl: res.url || url,
          headers: Object.fromEntries(META.map((k) => [k, res.headers.get(k)]).filter(([, v]) => v !== null)),
          decodedContent: !!encoding && encoding !== 'identity' } };
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error(`Timeout after ${timeoutMs} ms for ${url}`)); }, timeoutMs); })
    ]);
  } finally { clearTimeout(timer); }
}

export async function replayReference(cache, ref) {
  safeName(ref.sourceId); safeName(ref.key);
  if (!/^[a-f0-9]{64}$/.test(ref.sha256) || !/^[a-f0-9]{64}$/.test(ref.receiptId)) throw new Error('Invalid evidence hash');
  const receipt = await readJson(path.join(cache, 'receipts', `${ref.receiptId}.json`));
  if (hash(json(receipt)) !== ref.receiptId || receipt.sha256 !== ref.sha256 ||
      receipt.sourceId !== ref.sourceId || receipt.key !== ref.key) throw new Error('Receipt integrity check failed');
  const bytes = await fs.readFile(path.join(cache, 'blobs', ref.sha256));
  if (hash(bytes) !== ref.sha256 || bytes.length !== receipt.bytes) throw new Error(`Cached raw evidence is corrupt: ${ref.sha256}`);
  return { key: ref.key, bytes, receipt, reference: ref };
}

export async function acquireResource(source, resource, options = {}) {
  const { root, cache, offline = false, preferLocal = false, fetchImpl = fetch,
    timeoutMs = 30000, retries = 2, maxBytes = 25 * 1024 * 1024,
    now = () => new Date().toISOString(), retryDelayMs = 200 } = options;
  safeName(source.id); safeName(resource.key);
  const pointer = path.join(cache, 'latest', source.id, `${resource.key}.json`);
  const previous = await readJson(pointer, null);
  if (offline && previous) {
    const replayed = await replayReference(cache, previous);
    if (replayed.receipt.url !== resource.url || (resource.expectedMd5 && hash(replayed.bytes, 'md5') !== resource.expectedMd5) ||
        (resource.expectedSha256 && hash(replayed.bytes) !== resource.expectedSha256)) {
      throw new Error('Offline evidence belongs to a different registered resource/release');
    }
    return replayed;
  }
  let captured;
  const local = resource.localPath ? inside(root, resource.localPath) : null;
  if (local && (offline || preferLocal)) {
    const bytes = await fs.readFile(local);
    if (!bytes.length || bytes.length > maxBytes) throw new Error('Empty or oversized local evidence');
    captured = { bytes, http: null, localSeed: resource.localPath };
  } else {
    if (offline) throw new Error(`No offline evidence for ${source.id}/${resource.key}; run elections:download first`);
    let last;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try { captured = await getBytes(resource.url, { fetchImpl, timeoutMs, maxBytes }); break; }
      catch (e) {
        last = e;
        const failure = { sourceId: source.id, key: resource.key, url: resource.url, attemptedAt: now(), attempt: attempt + 1, error: e.message, status: e.status || null };
        await immutable(path.join(cache, 'failures', `${hash(json(failure))}.json`), json(failure));
        if (e.status && e.status < 500 && ![408, 429].includes(e.status)) break;
        if (attempt < retries) await sleep(retryDelayMs * (attempt + 1));
      }
    }
    if (!captured) throw last;
  }
  if ((resource.expectedMd5 && hash(captured.bytes, 'md5') !== resource.expectedMd5) ||
      (resource.expectedSha256 && hash(captured.bytes) !== resource.expectedSha256)) {
    throw new Error(`Pinned release checksum changed for ${source.id}/${resource.key}; review the release before ingestion`);
  }
  const sha256 = hash(captured.bytes);
  const receipt = { version: 1, sourceId: source.id, key: resource.key, url: resource.url,
    retrievedAt: now(), sha256, bytes: captured.bytes.length, http: captured.http,
    localSeed: captured.localSeed || null };
  const receiptId = hash(json(receipt));
  await immutable(path.join(cache, 'blobs', sha256), captured.bytes);
  await immutable(path.join(cache, 'receipts', `${receiptId}.json`), json(receipt));
  // Same bytes keep their first citation; every subsequent capture is still
  // recorded above. A new transport date is not a change to the election.
  const reference = previous?.sha256 === sha256 ? previous : { sourceId: source.id, key: resource.key, sha256, receiptId };
  await atomic(pointer, json(reference));
  const replayed = await replayReference(cache, reference);
  return { ...replayed, capture: receipt, captureId: receiptId };
}
