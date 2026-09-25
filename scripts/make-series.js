#!/usr/bin/env node
/**
 * Generate a run of frames plus its manifest.
 *
 *   npm run series                              # 1945–2023, Europe, by family
 *   npm run series -- --from 1970 --to 1980
 *   npm run series -- --step 5 --out build/decades
 *
 * The frames are drawn by the app, in a real browser, through the same
 * composite() the export dialog calls. This script starts the dev server, opens
 * the page, asks src/series.js to plan the run, then pulls the frames out one
 * at a time and writes them. It deliberately owns none of the decisions: the
 * frame, the palette and the manifest all come from the module, so a run
 * generated here and a map exported by hand cannot drift apart.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { chromium } from '@playwright/test';

import { ROOT } from './lib/registry.js';

const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}`;

function args() {
  const a = process.argv.slice(2);
  const get = (name, fallback) => {
    const i = a.indexOf('--' + name);
    return i >= 0 && a[i + 1] != null ? a[i + 1] : fallback;
  };
  return {
    from: Number(get('from', 1945)),
    to: Number(get('to', 2023)),
    step: Number(get('step', 1)),
    scope: get('scope', 'Europe'),
    grouping: get('grouping', 'family'),
    /*
     * Square, not the 16:9 the export dialog defaults to.
     *
     * A 16:9 canvas minus a title and a footer leaves a map panel about 3:1,
     * and Europe fitted into that is small and marooned in ocean. The same run
     * at 1200x1200 puts the continent at roughly twice the size with the same
     * frame and the same footer. Both are still --width/--height if a run wants
     * something else.
     */
    width: Number(get('width', 1200)),
    height: Number(get('height', 1200)),
    handle: get('handle', '@electionmaps'),
    out: get('out', path.join('build', 'series'))
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  const child = spawn(process.execPath,
    [path.join(ROOT, 'scripts', 'dev-server.js'), '--port', String(PORT)],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });

  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE + '/index.html');
      if (res.ok) return child;
    } catch (err) { /* not up yet */ }
    await sleep(200);
  }
  child.kill();
  throw new Error('the dev server did not come up');
}

async function main() {
  const opt = args();
  const outDir = path.isAbsolute(opt.out) ? opt.out : path.join(ROOT, opt.out);
  await fsp.mkdir(outDir, { recursive: true });

  console.log(`series ${opt.from}–${opt.to} step ${opt.step} · ${opt.scope} · by ${opt.grouping}`);

  const server = await startServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + '/index.html');
    await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);

    console.log('planning…');
    const plan = await page.evaluate(async (o) => {
      const { planSeries } = await import('/src/series.js');
      const p = await planSeries(o);
      return { frames: p.frames.length, skipped: p.skipped, fit: p.fit, rows: p.legendRows };
    }, opt);

    console.log(`  ${plan.frames} frames · frame locked to ` +
      `${plan.fit ? plan.fit.map((c) => c.map((n) => n.toFixed(1)).join(',')).join(' → ') : 'default'}` +
      ` · ${plan.rows} legend row(s) reserved`);
    for (const s of plan.skipped) console.log(`  skipped ${s.year}: ${s.why}`);

    for (let i = 0; i < plan.frames; i++) {
      const { frame, dataUrl } = await page.evaluate(async ({ n, handle }) => {
        const { renderFrame } = await import('/src/series.js');
        return renderFrame(n, { handle });
      }, { n: i, handle: opt.handle });

      await fsp.writeFile(path.join(outDir, frame.file),
        Buffer.from(dataUrl.split(',')[1], 'base64'));
      process.stdout.write(`\r  ${i + 1}/${plan.frames}  ${frame.year} — ` +
        `${frame.coverage.covered} covered   `);
    }
    process.stdout.write('\n');

    const man = await page.evaluate(async () => {
      const { manifest } = await import('/src/series.js');
      return manifest();
    });
    await fsp.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(man, null, 2));

    if (errors.length) {
      console.log(`\npage errors (${errors.length}):`);
      for (const e of errors.slice(0, 5)) console.log('  ' + e);
    }

    console.log(`\nwrote ${man.frames} frames + manifest.json to ${path.relative(ROOT, outDir)}`);
    console.log(`licences in play: ${man.licences.join(' · ')}`);
    if (man.boundariesWithNoStatedVintage.length) {
      console.log(`${man.boundariesWithNoStatedVintage.length} frame(s) rest on boundaries ` +
        'that state no year — named in the manifest');
    }
    if (man.framesWithBorderCaveats.length) {
      console.log(`${man.framesWithBorderCaveats.length} frame(s) draw over a border change ` +
        'that had not happened yet — named in the manifest');
    }
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((err) => {
  console.error('\nseries failed:', err.message);
  process.exit(1);
});
