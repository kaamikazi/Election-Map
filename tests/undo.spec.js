/**
 * Undo is scoped to the operation that is being undone.
 *
 * It used to snapshot the whole document, so Ctrl+Z after painting a country
 * also wiped a headline typed since, reset the zoom and reverted a colour
 * change. Each test here pairs an operation with an unrelated change made after
 * it, and checks that undo takes back the one and leaves the other.
 */

import { test, expect } from '@playwright/test';

async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
}

const snap = (page) => page.evaluate(() => {
  const s = window.__studio.state;
  return {
    assign: Object.keys(s.assign).sort(),
    title: s.title, sub: s.sub, handle: s.handle,
    titleInput: document.querySelector('#fTitle').value,
    zoom: s.zoom, pan: s.pan, theme: s.theme, dots: s.dots,
    colours: s.parties.map((p) => p.color),
    layer: s.layer, provenance: s.provenance ? s.provenance.source : null
  };
});

test('undoing a paint undoes only the paint', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => { (await import('/src/state.js')).toggleCountry('France'); });

  // Everything a person might do after painting, none of it recorded by the paint.
  await page.fill('#fTitle', 'My headline');
  await page.fill('#fSub', 'A subtitle');
  await page.fill('#fHandle', '@me');
  await page.click('#zIn');
  await page.evaluate(() => { window.__studio.state.pan = [0.1, -0.05]; });
  await page.check('#tTheme');

  await page.click('#btnUndo');
  const r = await snap(page);
  expect(r.assign).toEqual([]);                  // the paint is gone …
  expect(r.title).toBe('My headline');           // … and nothing else is
  expect(r.titleInput).toBe('My headline');
  expect(r.sub).toBe('A subtitle');
  expect(r.handle).toBe('@me');
  expect(r.zoom).toBeCloseTo(1.3);
  expect(r.pan).toEqual([0.1, -0.05]);
  expect(r.theme).toBe('light');
});

test('undoing a typed value undoes only that value', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { state, toggleCountry, setValue, undo } = await import('/src/state.js');
    toggleCountry('France');
    setValue('France', 'vote', 41.2);
    state.title = 'Typed after';
    undo();
    return { assigned: !!state.assign.France, vote: state.assign.France.vote, title: state.title };
  });
  expect(r).toEqual({ assigned: true, vote: null, title: 'Typed after' });
});

/* ------------------------------------------------------------------ imports */

test('undoing an import restores the previous data and provenance', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { state, toggleCountry, undo } = await import('/src/state.js');
    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, applyProposal } = await import('/src/import/proposal.js');

    toggleCountry('Brazil');
    const before = {
      assign: Object.keys(state.assign), parties: state.parties.map((p) => p.name),
      provenance: state.provenance, title: state.title, fit: state.fit
    };

    const draft = await adapterById('archive').propose({ year: '1977', scope: 'Europe', grouping: 'family' });
    applyProposal(buildProposal(draft), { mode: 'replace' });
    const during = { assigned: Object.keys(state.assign).length, source: state.provenance.source, title: state.title };

    undo();
    return {
      before, during,
      after: {
        assign: Object.keys(state.assign), parties: state.parties.map((p) => p.name),
        provenance: state.provenance, title: state.title, fit: state.fit
      }
    };
  });
  expect(r.during.assigned).toBeGreaterThan(10);
  expect(r.during.source).toMatch(/ParlGov/);
  expect(r.during.title).toBe('Who governed, 1977');
  // Data, parties and provenance come back exactly …
  expect(r.after.assign).toEqual(r.before.assign);
  expect(r.after.parties).toEqual(r.before.parties);
  expect(r.after.provenance).toEqual(r.before.provenance);
  // … and so do the title and frame the import set, because nobody touched them.
  expect(r.after.title).toBe(r.before.title);
  expect(r.after.fit).toEqual(r.before.fit);
});

test('undoing an import keeps a headline typed after it', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
    const draft = await adapterById('archive').propose({ year: '1977', scope: 'Europe', grouping: 'family' });
    applyProposal(buildProposal(draft), { mode: 'replace' });
  });
  // The import titled the map; the person then rewrote it and zoomed in.
  await page.fill('#fTitle', 'Europe in 1977, rewritten');
  await page.click('#zIn');
  await page.click('#btnUndo');

  const r = await snap(page);
  expect(r.assign).toEqual([]);
  expect(r.provenance).toBe(null);
  expect(r.title).toBe('Europe in 1977, rewritten');
  expect(r.titleInput).toBe('Europe in 1977, rewritten');
  expect(r.zoom).toBeCloseTo(1.3);
});

/* ------------------------------------------------------------------ colour */

async function dragColour(page, index, values) {
  await page.evaluate(({ index, values }) => {
    const input = document.querySelectorAll('#partyList input[type="color"]')[index];
    for (const v of values) {
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { index, values });
}

test('undoing a colour change affects only that colour, one undo per drag', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => { (await import('/src/state.js')).toggleCountry('Spain'); });
  const start = await snap(page);

  // A picker drag fires many input events; it is one change.
  await dragColour(page, 0, ['#111111', '#223344', '#8800aa']);
  await page.fill('#fTitle', 'After the colour');
  const recoloured = await snap(page);
  expect(recoloured.colours[0]).toBe('#8800aa');

  await page.click('#btnUndo');
  const r = await snap(page);
  expect(r.colours).toEqual(start.colours);        // the whole drag, in one undo
  expect(r.assign).toEqual(['Spain']);             // the earlier paint is untouched
  expect(r.title).toBe('After the colour');

  // The next undo is the paint, not a leftover drag step.
  await page.click('#btnUndo');
  expect((await snap(page)).assign).toEqual([]);
});

test('undoing a paint leaves a later colour change alone', async ({ page }) => {
  await open(page);
  await dragColour(page, 1, ['#00aa55']);
  await page.evaluate(async () => { (await import('/src/state.js')).toggleCountry('Italy'); });
  await page.click('#btnUndo');
  const r = await snap(page);
  expect(r.assign).toEqual([]);
  expect(r.colours[1]).toBe('#00aa55');
});

test('undoing an archive recolour restores the override too', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { state, setPartyColor, pushColourHistory, undo } = await import('/src/state.js');
    const { adapterById } = await import('/src/import/adapters.js');
    const { buildProposal, applyProposal } = await import('/src/import/proposal.js');
    const draft = await adapterById('archive').propose({ year: '1977', scope: 'Europe', grouping: 'family' });
    applyProposal(buildProposal(draft), { mode: 'replace' });
    const p = state.parties.find((q) => q.parlgov_id);
    const was = p.color;
    pushColourHistory(p);
    setPartyColor(p, '#123456');
    const set = state.overrides[p.parlgov_id];
    undo();
    return { was, now: p.color, set, override: Object.hasOwn(state.overrides, p.parlgov_id) };
  });
  expect(r.set).toBe('#123456');
  expect(r.now).toBe(r.was);
  expect(r.override).toBe(false);
});

/* ------------------------------------------------------------------ layers */

test('undoing a layer switch restores the previous layer, its geometry and its work', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const geo = await import('/src/geo.js');
    const { state, toggleCountry, switchLayer, undo } = await import('/src/state.js');
    toggleCountry('France');
    state.provenance = { source: 'Hand-made test map' };

    await geo.loadLayer('gb:BGD:ADM1');
    switchLayer('gb:BGD:ADM1');
    state.fit = geo.boundsOf(geo.FEATS.map((f) => f.key));
    const during = { layer: state.layer, geometry: geo.LAYER, units: geo.FEATS.length, assign: Object.keys(state.assign) };

    state.title = 'Typed on the division map';
    await undo();
    return {
      during,
      after: {
        layer: state.layer, geometry: geo.LAYER, units: geo.FEATS.length,
        assign: Object.keys(state.assign), provenance: state.provenance && state.provenance.source,
        parked: Object.keys(state.layerAssign), title: state.title
      }
    };
  });
  expect(r.during).toEqual({ layer: 'gb:BGD:ADM1', geometry: 'gb:BGD:ADM1', units: 8, assign: [] });
  // The world is back: the layer, the geometry drawn, the countries and their source.
  expect(r.after.layer).toBe('world');
  expect(r.after.geometry).toBe('world');
  expect(r.after.units).toBeGreaterThan(200);
  expect(r.after.assign).toEqual(['France']);
  expect(r.after.provenance).toBe('Hand-made test map');
  expect(r.after.parked).toEqual([]);
  // A headline is not layer data.
  expect(r.after.title).toBe('Typed on the division map');
});

/* ------------------------------------------------------------ the keyboard */

test('Ctrl+Z in a text field edits the text and does not undo the map', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => { (await import('/src/state.js')).toggleCountry('Germany'); });

  await page.click('#fTitle');
  await page.keyboard.type('Hello');
  await page.keyboard.press('Control+z');

  const r = await page.evaluate(() => ({
    assign: Object.keys(window.__studio.state.assign),
    canUndo: !document.querySelector('#btnUndo').disabled
  }));
  // The paint survives and is still the thing Undo would take back.
  expect(r.assign).toEqual(['Germany']);
  expect(r.canUndo).toBe(true);
  // The field's own undo ran instead: the typing is gone from the input.
  expect(await page.inputValue('#fTitle')).not.toBe('Hello');

  // Outside a text field, the same keys undo the map.
  await page.click('#stripEmpty', { force: true }).catch(() => {});
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => Object.keys(window.__studio.state.assign))).toEqual([]);
});

test('Ctrl+Z in the search box does not undo the map either', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => { (await import('/src/state.js')).toggleCountry('Chile'); });
  await page.click('#fSearch');
  await page.keyboard.type('Per');
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => Object.keys(window.__studio.state.assign))).toEqual(['Chile']);
});

/* ------------------------------------------------------------------ hygiene */

test('every recorded operation names its scope', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { pushHistory } = await import('/src/state.js');
    try { pushHistory(); return 'accepted'; } catch (e) { return e.message; }
  });
  // "Everything" is not a scope; it is the bug this replaced.
  expect(r).toMatch(/needs an operation scope/);
});
