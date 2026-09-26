#!/usr/bin/env node
/**
 * Normalise the ParlGov release into the archive the app reads.
 *
 *   node scripts/build-parlgov.js [--check]
 *
 * Input  data/raw/parlgov/{view_election,view_party,view_cabinet}.tab
 *        (vendored — see scripts/fetch-parlgov.js. Never fetched at runtime:
 *        this is a static academic release, not an API.)
 *
 * Output public/data/elections/<ISO3>.json   every election that country has
 *        public/data/elections/index.json    country, date, type, party count
 *        public/data/governing.json          who governed, as date intervals
 *
 * governing.json is the point of the whole stage. It answers "which party was
 * governing country X on date Y" for every year ParlGov covers, which is what
 * a who-governed-Europe map needs.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw', 'parlgov');
const OUT = path.join(ROOT, 'public', 'data');
const ELECTIONS = path.join(OUT, 'elections');
const WORLD = path.join(OUT, 'world-50m.topo.json');
const COVERAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'parlgov-coverage.json'), 'utf8'));

/**
 * ParlGov 2024 is released CC0 1.0, so attribution is not a licence condition —
 * but it is a scholarly one, and a posted map should say where the numbers came
 * from. Every archived election carries this.
 */
const SOURCE = {
  id: 'parlgov',
  label: 'ParlGov 2024',
  citation: 'Döring, Holger, and Philip Manow. 2024. Parliaments and Governments Database (ParlGov): Release 2024. Harvard Dataverse, V1.',
  doi: '10.7910/DVN/2VZ5ZC',
  url: 'https://www.parlgov.org/',
  license: 'CC0 1.0',
  coverage: 'EU and most OECD democracies, 1900–2023'
};

/* ---------------------------------------------------------------- tsv */

/**
 * The Dataverse .tab files quote string fields and double any internal quote.
 * Small enough to parse whole; strict enough to notice if that ever changes.
 */
function readTable(file) {
  const text = fs.readFileSync(path.join(RAW, file), 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n').filter((l) => l.length);
  const head = lines[0].split('\t').map(unquote);
  return lines.slice(1).map((line, i) => {
    const cells = line.split('\t');
    if (cells.length !== head.length) {
      throw new Error(`${file}: row ${i + 2} has ${cells.length} fields, expected ${head.length}`);
    }
    const row = {};
    head.forEach((h, j) => { row[h] = unquote(cells[j]); });
    return row;
  });
}

function unquote(s) {
  const v = s.trim();
  if (v.length > 1 && v[0] === '"' && v[v.length - 1] === '"') {
    return v.slice(1, -1).replace(/""/g, '"');
  }
  return v;
}

const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const flag = (v) => v === '1';

/* ------------------------------------------------------ country matching */

/**
 * ParlGov country names against the names in the world topology. Anything not
 * matched here is reported and left out rather than guessed at — a map that
 * silently attaches Czech results to nothing is worse than one that says so.
 */
const NAME_OVERRIDES = {
  'Czech Republic': 'Czechia'
};

const normalise = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '');

function worldNames() {
  if (!fs.existsSync(WORLD)) return null;
  const topo = JSON.parse(fs.readFileSync(WORLD, 'utf8'));
  const names = topo.objects.countries.geometries
    .map((g) => g.properties && g.properties.name)
    .filter(Boolean);
  return new Map(names.map((n) => [normalise(n), n]));
}

/* ---------------------------------------------------------------- build */

function partyIndex(rows) {
  const byId = new Map();
  for (const r of rows) {
    byId.set(r.party_id, {
      party_id: r.party_id,
      short: r.party_name_short,
      name: r.party_name_english || r.party_name,
      name_local: r.party_name,
      // 'none' and 'code' are not families. They stay null so the app can show
      // them as uncoloured rather than inventing a colour for them.
      family: r.family_name_short === 'none' || r.family_name_short === 'code'
        ? null : r.family_name_short,
      family_label: r.family_name,
      left_right: num(r.left_right),
      liberty_authority: num(r.liberty_authority),
      state_market: num(r.state_market)
    });
  }
  return byId;
}

function buildElections(rows, parties) {
  const byCountry = new Map();
  for (const r of rows) {
    const iso3 = r.country_name_short;
    if (!byCountry.has(iso3)) byCountry.set(iso3, { name: r.country_name, elections: new Map() });
    const c = byCountry.get(iso3);
    const key = r.election_id;
    if (!c.elections.has(key)) {
      c.elections.set(key, {
        id: key,
        date: r.election_date,
        type: r.election_type,          // 'parliament' or 'ep'
        seats_total: num(r.seats_total),
        source: SOURCE.id,
        results: []
      });
    }
    const p = parties.get(r.party_id);
    c.elections.get(key).results.push({
      party_id: r.party_id,
      short: r.party_name_short,
      name: r.party_name_english || r.party_name,
      family: p ? p.family : null,
      left_right: num(r.left_right),
      vote_share: num(r.vote_share),
      seats: num(r.seats)
    });
  }
  return byCountry;
}

/**
 * Turn the cabinet table into date intervals. A cabinet runs until the next one
 * in that country starts; the final cabinet has `to: null`, meaning "still in
 * office as far as this release knows" — not "forever".
 */
function buildGoverning(rows, parties) {
  const byCountry = new Map();

  for (const r of rows) {
    const iso3 = r.country_name_short;
    if (!byCountry.has(iso3)) byCountry.set(iso3, { name: r.country_name, cabinets: new Map() });
    const c = byCountry.get(iso3);
    if (!c.cabinets.has(r.cabinet_id)) {
      c.cabinets.set(r.cabinet_id, {
        id: r.cabinet_id,
        name: r.cabinet_name,
        from: r.start_date,
        election_date: r.election_date || null,
        caretaker: flag(r.caretaker),
        parties: []
      });
    }
    if (!flag(r.cabinet_party)) continue;   // in parliament, not in cabinet
    const p = parties.get(r.party_id);
    c.cabinets.get(r.cabinet_id).parties.push({
      party_id: r.party_id,
      short: r.party_name_short,
      name: r.party_name_english || r.party_name,
      family: p ? p.family : null,
      seats: num(r.seats),
      pm: flag(r.prime_minister)
    });
  }

  const out = new Map();
  for (const [iso3, c] of byCountry) {
    const intervals = [...c.cabinets.values()]
      .filter((cab) => cab.from)
      .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

    intervals.forEach((cab, i) => {
      const next = intervals[i + 1];
      cab.to = next ? next.from : null;
      cab.endBasis = next ? 'next recorded cabinet; continuity not independently audited' : 'open at release cutoff';
      const correction = COVERAGE.intervals.find((x) => x.iso3 === iso3 && x.id === cab.id);
      if (correction) {
        if (cab.from !== correction.from || cab.to !== correction.nextRecorded ||
            correction.coverageTo < cab.from || correction.coverageTo > cab.to || !correction.evidence.length) {
          throw new Error(`Coverage evidence no longer matches ${iso3} cabinet ${cab.id}; review data/parlgov-coverage.json`);
        }
        cab.recordedTo = cab.to;
        cab.to = correction.coverageTo;
        cab.coverage = correction;
        cab.endBasis = correction.basis;
      }
      // The PM's party is the headline answer to "who governs".
      const pm = cab.parties.find((p) => p.pm) || null;
      cab.pm_party_id = pm ? pm.party_id : null;
      cab.parties.sort((a, b) => (b.seats || 0) - (a.seats || 0));
    });

    out.set(iso3, { name: c.name, intervals });
  }
  return out;
}

/* ---------------------------------------------------------------- main */

async function main() {
  const check = process.argv.includes('--check');

  for (const f of ['view_election.tab', 'view_party.tab', 'view_cabinet.tab']) {
    if (!fs.existsSync(path.join(RAW, f))) {
      throw new Error(`missing ${path.join('data/raw/parlgov', f)} — run: node scripts/fetch-parlgov.js`);
    }
  }

  console.log('read    view_party.tab');
  const parties = partyIndex(readTable('view_party.tab'));
  console.log(`        ${parties.size} parties`);

  console.log('read    view_election.tab');
  const electionRows = readTable('view_election.tab');
  const elections = buildElections(electionRows, parties);
  console.log(`        ${electionRows.length} results across ${elections.size} countries`);

  console.log('read    view_cabinet.tab');
  const cabinetRows = readTable('view_cabinet.tab');
  const governing = buildGoverning(cabinetRows, parties);
  const nCabinets = [...governing.values()].reduce((n, c) => n + c.intervals.length, 0);
  console.log(`        ${nCabinets} cabinets across ${governing.size} countries\n`);

  // --- match countries to the map
  const world = worldNames();
  if (!world) throw new Error('public/data/world-50m.topo.json not found — cannot check country names');
  const mapName = new Map();
  const unmatched = [];
  for (const [iso3, c] of elections) {
    const wanted = NAME_OVERRIDES[c.name] || c.name;
    const hit = world.get(normalise(wanted));
    if (hit) mapName.set(iso3, hit);
    else unmatched.push(`${iso3} ${c.name}`);
  }
  if (unmatched.length) {
    console.log('WARNING these countries have no matching feature on the map:');
    unmatched.forEach((u) => console.log('  ' + u));
    console.log('  add an entry to NAME_OVERRIDES in this script\n');
  } else {
    console.log(`match   all ${mapName.size} countries resolve to a map feature\n`);
  }

  // --- families actually present, so an uncoloured one cannot pass unnoticed
  const familyCount = new Map();
  for (const p of parties.values()) {
    const key = p.family || '(unassigned)';
    familyCount.set(key, (familyCount.get(key) || 0) + 1);
  }

  if (check) {
    console.log('families:');
    [...familyCount].sort((a, b) => b[1] - a[1]).forEach(([f, n]) => console.log(`  ${String(n).padStart(4)}  ${f}`));
    return;
  }

  // --- write
  await fsp.mkdir(ELECTIONS, { recursive: true });

  const index = {
    version: 1,
    source: SOURCE,
    generated: new Date().toISOString(),
    families: Object.fromEntries(familyCount),
    countries: {}
  };

  for (const [iso3, c] of [...elections].sort()) {
    const list = [...c.elections.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    await fsp.writeFile(
      path.join(ELECTIONS, iso3 + '.json'),
      JSON.stringify({ iso3, name: c.name, map_name: mapName.get(iso3) || null, source: SOURCE, elections: list })
    );
    index.countries[iso3] = {
      name: c.name,
      map_name: mapName.get(iso3) || null,
      file: `data/elections/${iso3}.json`,
      elections: list.map((e) => ({ date: e.date, type: e.type, parties: e.results.length }))
    };
  }
  await fsp.writeFile(path.join(ELECTIONS, 'index.json'), JSON.stringify(index, null, 2));

  const gov = {
    version: 2,
    source: SOURCE,
    coverageReview: COVERAGE.release,
    // Conservative last dated observation, not a claimed cabinet end date.
    coverageThrough: [...governing.values()].flatMap((c) => c.intervals).map((c) => c.from).sort().at(-1),
    generated: new Date().toISOString(),
    countries: {}
  };
  for (const [iso3, c] of [...governing].sort()) {
    gov.countries[iso3] = {
      name: c.name,
      map_name: mapName.get(iso3) || null,
      intervals: c.intervals
    };
  }
  await fsp.writeFile(path.join(OUT, 'governing.json'), JSON.stringify(gov));

  const bytes = (f) => (fs.statSync(f).size / 1024).toFixed(0) + ' KB';
  console.log(`wrote   ${elections.size} country files -> public/data/elections/`);
  console.log(`index   public/data/elections/index.json  ${bytes(path.join(ELECTIONS, 'index.json'))}`);
  console.log(`gov     public/data/governing.json        ${bytes(path.join(OUT, 'governing.json'))}`);

  const unfamilied = familyCount.get('(unassigned)') || 0;
  if (unfamilied) console.log(`note    ${unfamilied} parties have no party family and stay uncoloured`);
}

main().catch((err) => {
  console.error('\nbuild failed:', err.message);
  process.exit(1);
});
