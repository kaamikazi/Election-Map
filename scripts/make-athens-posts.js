/** Reproduce paired samples through the browser's normal composite path. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const value = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const out = resolve(value('--out', 'build/athens'));
const port = Number(value('--port', '5188'));
const url = `http://localhost:${port}`;
const server = spawn(process.execPath, ['scripts/dev-server.js', '--port', String(port)], { stdio: 'pipe' });
let serverError = '';
server.stderr.on('data', chunk => serverError += chunk);
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`Preview server failed: ${serverError}`);
    try { if ((await fetch(url)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Preview server did not become ready.');
  browser = await chromium.launch(process.env.CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {});
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
  const document = await page.evaluate(async () => {
    const { athensDocument } = await import('/src/explainer.js');
    const { restoreDocument } = await import('/src/restore.js');
    const { toDocument } = await import('/src/state.js');
    await restoreDocument(await athensDocument());
    return toDocument();
  });
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'athens.json'), JSON.stringify(document, null, 2) + '\n');
  const manifest = { kind: 'historical-locator', period: document.explainer.period,
    document: 'athens.json', documentSha256: createHash('sha256').update(JSON.stringify(document)).digest('hex'),
    framing: document.fit, sources: document.explainer.sources, outputs: [] };
  for (const [layout, w, h] of [['wide', 1600, 900], ['square', 1200, 1200], ['portrait', 1200, 1500]]) {
    // Same 1.5x output scale used by the export dialog.
    const pair = await page.evaluate(async ({ w, h }) => {
      const { compositePair } = await import('/src/export.js');
      const { prepareExport } = await import('/src/flags.js');
      await prepareExport();
      const pair = compositePair(w * 1.5, h * 1.5);
      return Object.fromEntries(Object.entries(pair).map(([theme, { canvas, report }]) =>
        [theme, { png: canvas.toDataURL().split(',')[1], report, width: canvas.width, height: canvas.height }]));
    }, { w, h });
    for (const [theme, render] of Object.entries(pair)) {
      const filename = `athens-${layout}-${theme === 'light' ? 'paper' : 'lamplight'}.png`;
      const bytes = Buffer.from(render.png, 'base64');
      await writeFile(resolve(out, filename), bytes);
      manifest.outputs.push({ filename, theme, width: render.width, height: render.height,
        pngSha256: createHash('sha256').update(bytes).digest('hex'), ...render.report });
    }
  }
  await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Wrote six paired Athens exports, document and manifest to ${out}`);
} finally {
  if (browser) await browser.close();
  server.kill();
}
