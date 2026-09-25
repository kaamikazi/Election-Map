/**
 * The layout at every size a person will actually hold it.
 *
 *   phone     360 and 390 wide — the map first, controls in a bottom sheet
 *   tablet    768 — an icon rail, one group flying out over the map
 *   laptop    1024 and desktop 1440 — rail | map | legend
 *   landscape 844 × 390 — a phone on its side, which gets the tablet layout
 *
 * Every viewport writes a screenshot to tests/shots/viewports/ to be looked at;
 * the assertions are the parts a picture cannot be trusted to show — hit sizes,
 * overflow, which controls exist where, and whether a finger can paint.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'shots', 'viewports');

const VIEWS = [
  { name: 'phone-360', width: 360, height: 740, touch: true, layout: 'phone' },
  { name: 'phone-390', width: 390, height: 844, touch: true, layout: 'phone' },
  { name: 'tablet-768', width: 768, height: 1024, touch: true, layout: 'tablet' },
  { name: 'laptop-1024', width: 1024, height: 768, touch: false, layout: 'desktop' },
  { name: 'desktop-1440', width: 1440, height: 900, touch: false, layout: 'desktop' },
  { name: 'landscape-844', width: 844, height: 390, touch: true, layout: 'tablet' }
];

async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('#countryList .crow').length > 10);
  // Attached, not visible: on a phone and a tablet the layer list sits in a
  // group that is closed until someone opens it, and that is the design.
  await page.waitForSelector('#layerPanel #layerCountry', { state: 'attached' });
}

/** Every visible interactive element smaller than `min` on either side. */
const SMALL_TARGETS = `(min) => {
  const sel = 'button, [role=button], a[href], input:not([type=hidden]), select, .tog';
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (el.closest('dialog:not([open])')) continue;
    // Checkboxes and colour inputs are hit through their label, which is measured instead.
    if (el.matches('input[type=checkbox], input[type=color]')) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    if (r.width < min - 0.5 || r.height < min - 0.5) {
      out.push((el.id || el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
  }
  return out;
}`;

for (const v of VIEWS) {
  test.describe(v.name, () => {
    test.use({
      viewport: { width: v.width, height: v.height },
      hasTouch: v.touch,
      isMobile: v.touch && v.layout === 'phone'
    });

    test(`${v.name}: lays out without overflow and with the map on screen`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await open(page);
      await page.evaluate(async () => {
        const { state, emit } = await import('/src/state.js');
        state.assign = { France: { party: 1 }, Brazil: { party: 2 }, India: { party: 1 } };
        emit('parties');
      });
      await page.waitForTimeout(300);
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, `${v.name}.png`) });

      const m = await page.evaluate(() => {
        const map = document.querySelector('#map').getBoundingClientRect();
        return {
          overflowX: document.documentElement.scrollWidth - innerWidth,
          overflowY: document.documentElement.scrollHeight - innerHeight,
          map: { w: map.width, h: map.height, top: map.top },
          bar: document.querySelector('#bar').getBoundingClientRect().height,
          railIcons: getComputedStyle(document.querySelector('#railIcons')).display,
          sheetPos: getComputedStyle(document.querySelector('#sheet')).position,
          rail: document.querySelector('#rail').getBoundingClientRect().width,
          side: document.querySelector('#side').getBoundingClientRect().width
        };
      });

      expect(m.overflowX, 'horizontal page scroll').toBeLessThanOrEqual(0);
      expect(m.overflowY, 'the page itself should not scroll').toBeLessThanOrEqual(0);
      // The map is always there, and is the widest thing on screen. At 1024 the
      // two side columns take 528px between them, so "the widest column" is
      // the honest test there rather than "half the screen".
      expect(m.map.w).toBeGreaterThan(v.layout === 'desktop' ? Math.max(m.rail, m.side) + 150 : v.width * 0.5);
      if (v.layout !== 'phone') expect(m.map.w).toBeGreaterThan(440);
      expect(m.map.h).toBeGreaterThan(v.layout === 'phone' ? v.height * 0.5 : 180);
      // The results bar has room — it is the colour hero of the screen.
      expect(m.bar).toBeGreaterThanOrEqual(v.height < 500 ? 16 : 20);

      if (v.layout === 'phone') {
        expect(m.sheetPos).toBe('fixed');
        expect(m.railIcons).toBe('none');
      } else if (v.layout === 'tablet') {
        expect(m.railIcons).toBe('flex');
        expect(m.sheetPos).toBe('absolute');
      } else {
        expect(m.railIcons).toBe('none');
        expect(m.rail).toBeGreaterThan(250);
      }
      expect(errors).toEqual([]);
    });

    if (v.touch) {
      test(`${v.name}: every touch target is at least 44px`, async ({ page }) => {
        await open(page);
        const phoneOrTablet = v.layout === 'phone' ? '#grab' : '#railIcons [data-g="paint"]';
        await page.click(phoneOrTablet);
        if (v.layout === 'phone') await page.click('#grab');       // half → full
        await page.waitForTimeout(350);
        const small = await page.evaluate(`(${SMALL_TARGETS})(44)`);
        expect(small, small.join('\n')).toEqual([]);
      });
    }
  });
}

/* ------------------------------------------------------ phone: paint by peek */

test.describe('phone: painting from the peek sheet', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('three countries painted using only the peek chips and the map', async ({ page }) => {
    await open(page);
    // The sheet stays at peek throughout. Nothing here opens it.
    expect(await page.getAttribute('#sheet', 'data-snap')).toBe('peek');

    // Pick the second party from the peek row …
    const chip = page.locator('#peek .pchip').nth(1);
    await expect(chip).toBeVisible();
    await chip.tap();
    const active = await page.evaluate(() => window.__studio.state.active);
    const second = await page.evaluate(() => window.__studio.state.parties[1].id);
    expect(active).toBe(second);
    await expect(chip).toHaveAttribute('aria-pressed', 'true');

    // … and tap three countries on the map, the way a finger would.
    const box = await page.locator('#map').boundingBox();
    for (const name of ['Brazil', 'Russia', 'Australia']) {
      const pt = await page.evaluate((n) => window.__studio.screenPointOf(n), name);
      expect(pt, `${name} is not on screen`).toBeTruthy();
      await page.touchscreen.tap(box.x + pt[0], box.y + pt[1]);
      await page.waitForTimeout(120);
    }

    const r = await page.evaluate(() => {
      const s = window.__studio.state;
      return {
        painted: Object.entries(s.assign).map(([k, v]) => [k, v.party]),
        snap: document.querySelector('#sheet').dataset.snap,
        tally: document.querySelector('#peek .pchip:nth-child(2) u').textContent.trim(),
        tip: getComputedStyle(document.querySelector('#tip')).opacity
      };
    });
    expect(r.painted.sort()).toEqual([['Australia', second], ['Brazil', second], ['Russia', second]]);
    expect(r.snap).toBe('peek');
    // The chip counts what it painted …
    expect(r.tally).toBe('3');
    // … and a tap showed the tooltip, because a finger has no hover.
    expect(Number(r.tip)).toBeGreaterThan(0);
    await page.screenshot({ path: path.join(OUT, 'phone-390-painted.png') });
  });

  test('the sheet snaps through peek, half and full', async ({ page }) => {
    await open(page);
    const tops = {};
    for (const snap of ['peek', 'half', 'full']) {
      if (snap !== 'peek') await page.click('#grab');
      await page.waitForTimeout(350);
      tops[snap] = await page.evaluate(() => ({
        top: document.querySelector('#sheet').getBoundingClientRect().top,
        snap: document.querySelector('#sheet').dataset.snap,
        partiesShown: getComputedStyle(document.querySelector('#partyList').closest('.sec')).display,
        styleShown: getComputedStyle(document.querySelector('#tTheme').closest('.sec')).display
      }));
      expect(tops[snap].snap).toBe(snap);
    }
    // Each snap shows more of the sheet than the last.
    expect(tops.half.top).toBeLessThan(tops.peek.top);
    expect(tops.full.top).toBeLessThan(tops.half.top);
    // Half is parties, search, layer; full is everything.
    expect(tops.half.partiesShown).toBe('block');
    expect(tops.half.styleShown).toBe('none');
    expect(tops.full.styleShown).toBe('block');
    // The peek clears the home indicator: its padding is taken from the safe area.
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
    expect(css).toMatch(/--peek-h:calc\(96px \+ env\(safe-area-inset-bottom/);
    expect(css).toMatch(/viewport-fit|safe-area-inset-bottom/);
  });

  test('export goes full-screen, with the preview fitting the width', async ({ page }) => {
    await open(page);
    await page.click('#openExport');
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const d = document.querySelector('#exportDlg').getBoundingClientRect();
      const p = document.querySelector('#preview').getBoundingClientRect();
      return { dw: d.width, dh: d.height, pw: p.width, vw: innerWidth, vh: innerHeight };
    });
    expect(r.dw).toBe(r.vw);
    expect(r.dh).toBe(r.vh);
    // Fitting the width, less the dialog's padding and the preview's frame.
    expect(r.pw).toBeGreaterThan(r.vw - 48);
    expect(r.pw).toBeLessThanOrEqual(r.vw);
    await page.screenshot({ path: path.join(OUT, 'phone-390-export.png') });
  });

  test('a 650-row review becomes cards, with the counts pinned', async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { setTransport, clearCache } = await import('/src/import/wikipedia.js');
      clearCache();
      const parse = await (await fetch('/fixtures/wikipedia/parse-uk-2024-mps.json')).json();
      setTransport(async (url) => (url.includes('list=search')
        ? { query: { search: [{ title: '2024 United Kingdom general election MPs', snippet: 'x' }] } }
        : parse));
      const { loadLayer } = await import('/src/geo.js');
      const { switchLayer } = await import('/src/state.js');
      await loadLayer('cons:GBR:CONSTITUENCY');
      switchLayer('cons:GBR:CONSTITUENCY');
    });
    // Import lives in the sheet on a phone, so open it to get there.
    await page.click('#grab'); await page.click('#grab');
    await page.waitForTimeout(350);
    await page.locator('.chip[data-act="import"]').click();
    await page.locator('#adapterSeg button', { hasText: 'Wikipedia' }).click();
    await page.fill('#in_query', '2024 United Kingdom general election MPs');
    await page.click('#btnPropose');
    await page.locator('#reviewBody .option', { hasText: 'United Kingdom' }).first().click();
    await page.locator('#reviewBody .option', { hasText: 'List of MPs elected' }).first().click();
    await page.waitForSelector('#reviewBody .rrow');

    const before = await page.evaluate(() => {
      const row = document.querySelector('#reviewBody .rrow').getBoundingClientRect();
      const cols = getComputedStyle(document.querySelector('#reviewBody .rrow')).gridTemplateColumns;
      return { rowW: row.width, cols, vw: innerWidth };
    });
    // A card: one column, the full width of the screen.
    expect(before.cols.split(' ').length).toBe(1);
    expect(before.rowW).toBeGreaterThan(before.vw - 60);

    // Scroll deep into 650 rows. The counts start below the article and table
    // chips; once scrolled they are pinned to the top of the scroll area, on
    // screen, however far down the rows go.
    await page.evaluate(() => { document.querySelector('#importDlg .dlg-b').scrollTop = 6000; });
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => {
      const body = document.querySelector('#importDlg .dlg-b');
      return {
        scrolled: body.scrollTop,
        bodyTop: body.getBoundingClientRect().top,
        countsTop: document.querySelector('#reviewBody .counts').getBoundingClientRect().top,
        countsText: document.querySelector('#reviewBody .counts').textContent.replace(/\s+/g, ' ').trim()
      };
    });
    expect(after.scrolled).toBeGreaterThan(3000);
    expect(Math.abs(after.countsTop - after.bodyTop)).toBeLessThan(20);
    expect(after.countsText).toMatch(/650 matched/);
    await page.screenshot({ path: path.join(OUT, 'phone-390-review.png') });
  });
});

/* ------------------------------------------------------------- everywhere */

test.describe('reduced motion', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });

  test('asks for none, gets none', async ({ page }) => {
    await open(page);
    const t = await page.evaluate(() => [
      getComputedStyle(document.querySelector('#sheet')).transitionDuration,
      getComputedStyle(document.querySelector('#toast')).transitionDuration,
      getComputedStyle(document.querySelector('#bar')).transitionDuration
    ]);
    for (const d of t) expect(d.split(',').every((x) => parseFloat(x) === 0)).toBe(true);
  });
});

test.describe('tablet: the rail flies out', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true });

  test('one group at a time, over the map, and back', async ({ page }) => {
    await open(page);
    await page.click('#railIcons [data-g="find"]');
    await page.waitForTimeout(300);
    const open1 = await page.evaluate(() => ({
      fly: document.querySelector('#main').dataset.fly,
      search: getComputedStyle(document.querySelector('#fSearch').closest('.sec')).display,
      parties: getComputedStyle(document.querySelector('#partyList').closest('.sec')).display,
      over: document.querySelector('#sheet').getBoundingClientRect().left
        < document.querySelector('#map').getBoundingClientRect().right
    }));
    expect(open1).toEqual({ fly: 'find', search: 'block', parties: 'none', over: true });
    await page.screenshot({ path: path.join(OUT, 'tablet-768-fly.png') });

    // Tapping the map closes it again.
    const box = await page.locator('#map').boundingBox();
    await page.touchscreen.tap(box.x + box.width - 40, box.y + 40);
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => document.querySelector('#main').dataset.fly)).toBeUndefined();
  });
});

/* --------------------------------------------- colour follows the active party */

test('switching party is visible everywhere at once', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const { state, emit } = await import('/src/state.js');
    state.assign = { France: { party: state.parties[0].id }, Spain: { party: state.parties[1].id } };
    emit('parties');
  });
  const look = () => page.evaluate(() => {
    const s = window.__studio.state;
    const row = document.querySelector('#partyList .party[data-active="1"]');
    const leg = document.querySelector('#legend .leg[data-active="1"]');
    return {
      active: s.active,
      rowColour: row && row.style.getPropertyValue('--pc'),
      legendParty: leg && +leg.dataset.party,
      cursor: document.querySelector('#map').style.cursor
    };
  });
  const a = await look();
  await page.locator('#partyList .party').nth(1).click();
  const b = await look();

  expect(b.active).not.toBe(a.active);
  expect(b.rowColour).not.toBe(a.rowColour);
  expect(b.legendParty).toBe(b.active);
  // The cursor is drawn in the party's colour, so it changes with it.
  const second = await page.evaluate(() => window.__studio.state.parties[1].color);
  expect(decodeURIComponent(b.cursor)).toContain(second);
  expect(b.cursor).not.toBe(a.cursor);

  // Controls keep the one neutral accent: the primary button is not party-coloured.
  const btn = await page.evaluate(() => getComputedStyle(document.querySelector('#openExport')).backgroundColor);
  expect(btn).toBe('rgb(232, 179, 58)');
});

/* ---------------------------------------------------- phone: flags by touch */

test.describe('phone: flags mode by touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('switch mode, tap three countries, and the peek lists their flags', async ({ page }) => {
    await open(page);
    await page.locator('#modeSeg button[data-mode="flags"]').tap();
    expect(await page.evaluate(() => document.body.dataset.mode)).toBe('flags');

    const box = await page.locator('#map').boundingBox();
    for (const name of ['Brazil', 'India', 'Kosovo']) {
      const pt = await page.evaluate((n) => window.__studio.screenPointOf(n), name);
      await page.touchscreen.tap(box.x + pt[0], box.y + pt[1]);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => ({
      flagged: Object.keys(window.__studio.state.flagged).sort(),
      assign: Object.keys(window.__studio.state.assign),
      peekFlags: [...document.querySelectorAll('#peek .pchip img.flag')].map((i) => i.getAttribute('src')),
      peekText: document.querySelector('#peek').textContent.replace(/\s+/g, ' ').trim()
    }));
    expect(r.flagged).toEqual(['Brazil', 'India', 'Kosovo']);
    // Flags mode never touches the results.
    expect(r.assign).toEqual([]);
    // Two flags; Kosovo is listed by name with none, because its data has no code.
    expect(r.peekFlags.sort()).toEqual(['flags/4x3/br.svg', 'flags/4x3/in.svg']);
    expect(r.peekText).toMatch(/Kosovo/);
    await page.screenshot({ path: path.join(OUT, 'phone-390-flags.png') });
  });
});
