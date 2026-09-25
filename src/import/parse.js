/**
 * Turning pasted or fetched text into rows of strings, and strings into
 * numbers. No matching and no map knowledge lives here.
 */

/* ---------------------------------------------------------------- numbers */

/**
 * Values a source uses to mean "there is no number here". These are answers,
 * not failures: a party that did not stand last time has no change figure, and
 * saying so is different from failing to read one.
 */
const NON_VALUES = new Set([
  '', '-', '–', '—', '‒', '―', '−', 'n/a', 'na', 'n.a.', 'nan', 'null', 'nil',
  'new', 'none', '.', '..', '...', '?', '*', 'x'
]);

/** Every space a spreadsheet or a rendered web table might use as a grouper. */
const SPACES = /[\s      ]/g;

/**
 * Parse one cell into a number.
 *
 * The separators are the whole problem. `45,2` is forty-five point two in most
 * of Europe and `1,234` is one thousand two hundred and thirty-four almost
 * everywhere else — reading the first as the second turns a vote share of 45%
 * into 452%, which will not look wrong enough to catch by eye.
 *
 * @returns {{value: number|null, note: string|null}}
 *   value null with note null  — the source said there is no number
 *   value null with a note     — there was something here and it did not parse
 */
export function parseNumber(input) {
  const original = String(input == null ? '' : input).trim();
  const lowered = original.toLowerCase();
  if (NON_VALUES.has(lowered)) return { value: null, note: null };

  // Drop percent signs, grouping spaces, footnote markers and bracketed notes.
  let s = original
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[%‰]/g, '')
    .replace(SPACES, '')
    .replace(/^\+/, '');

  if (NON_VALUES.has(s.toLowerCase())) return { value: null, note: null };
  if (!s) return { value: null, note: null };

  const negative = /^[-−–]/.test(s);
  if (negative) s = s.slice(1);

  if (!/^[\d.,]+$/.test(s)) {
    return { value: null, note: `could not read a number from "${original}"` };
  }

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let cleaned;

  if (lastComma >= 0 && lastDot >= 0) {
    // Both present: whichever comes last is the decimal point, the other groups.
    const decimal = lastComma > lastDot ? ',' : '.';
    const grouper = decimal === ',' ? '.' : ',';
    cleaned = s.split(grouper).join('').replace(decimal, '.');
  } else if (lastComma >= 0) {
    cleaned = /^\d{1,3}(,\d{3})+$/.test(s)
      ? s.split(',').join('')   // 1,234 — grouped thousands
      : s.replace(/,/g, '.');   // 45,2  — a decimal comma
  } else if (lastDot >= 0) {
    // A single dot group stays a decimal: 1.234 is far more often a share than
    // it is European thousands. Only repeated groups are unambiguous.
    cleaned = /^\d{1,3}(\.\d{3}){2,}$/.test(s) ? s.split('.').join('') : s;
  } else {
    cleaned = s;
  }

  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    return { value: null, note: `could not read a number from "${original}"` };
  }
  return { value: negative ? -n : n, note: null };
}

/* ---------------------------------------------------------------- tables */

/**
 * Split delimited text into rows of cells.
 *
 * TSV first: a spreadsheet selection arrives tab-separated, and so does a table
 * copied out of a rendered web page. CSV is handled too, with quoted fields,
 * because that is what a downloaded file looks like.
 */
export function parseTable(text) {
  const clean = String(text || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!clean.trim()) return { delimiter: null, rows: [] };

  const delimiter = detectDelimiter(clean);
  const rows = delimiter === '\t'
    ? clean.split('\n').map((line) => line.split('\t').map(tidy))
    : parseDelimited(clean, delimiter);

  return { delimiter, rows: rows.filter((r) => r.some((c) => c !== '')) };
}

function detectDelimiter(text) {
  const line = text.split('\n')[0];
  const tabs = (line.match(/\t/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  const semis = (line.match(/;/g) || []).length;
  if (tabs >= commas && tabs >= semis && tabs > 0) return '\t';
  // A semicolon file is usually a European CSV, where comma is the decimal mark.
  if (semis > commas) return ';';
  return commas > 0 ? ',' : '\t';
}

/** A quote-aware split, so "Smith, John" stays one cell. */
function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [], cell = '', quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delimiter) { row.push(tidy(cell)); cell = ''; continue; }
    if (ch === '\n') { row.push(tidy(cell)); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  row.push(tidy(cell));
  rows.push(row);
  return rows;
}

const tidy = (s) => String(s).trim().replace(/^"|"$/g, '').trim();

/* ---------------------------------------------------------------- columns */

export const ROLES = [
  { id: 'unit', label: 'Region' },
  { id: 'party', label: 'Party' },
  { id: 'vote', label: 'Vote share' },
  { id: 'seats', label: 'Seat share' },
  { id: 'turnout', label: 'Turnout' },
  { id: 'margin', label: 'Margin' },
  { id: 'ignore', label: 'Ignore' }
];

const HEADER_HINTS = [
  ['unit', /^(region|country|state|province|constituency|district|division|area|name|seat)\b/i],
  ['party', /^(party|list|coalition|alliance|winner|bloc|group)\b/i],
  ['vote', /(vote|votes|share|%\s*votes|pct|percent)/i],
  ['seats', /(seat|seats|mandates|mps)/i],
  ['turnout', /turnout|participation/i],
  ['margin', /margin|lead|swing/i]
];

/**
 * Guess a role per column from the header — and only guess.
 *
 * The guess is shown as a dropdown the person corrects before anything is
 * matched. Silent guessing is how a "change since last election" column
 * quietly becomes turnout, and nothing downstream would ever notice.
 */
export function guessColumns(rows, { knownHeader = null } = {}) {
  if (!rows.length) return { columns: [], hasHeader: false };
  const head = rows[0];
  /*
   * A caller that read the table's markup knows whether the first row is a
   * header, and knowing beats guessing. The heuristic below asks whether the
   * first row lacks numbers and the rows under it have them, which is true of
   * most results tables and false of a list of MPs — that table holds no
   * numbers anywhere, so the heuristic called its header a data row and the
   * review screen then offered seven columns named "Column 1".
   */
  const hasHeader = knownHeader != null ? knownHeader : looksLikeHeader(rows);

  const columns = head.map((cell, index) => {
    let role = 'ignore';
    if (hasHeader) {
      for (const [id, re] of HEADER_HINTS) {
        if (re.test(cell)) { role = id; break; }
      }
    }
    return { index, role, header: hasHeader ? cell : '' };
  });

  /*
   * Ambiguity is refused, for every role.
   *
   * A results table routinely carries the same quantity more than once: the
   * previous election beside this one, a notional recalculation beside the real
   * result, a swing column beside the share it is a swing in. Every one of
   * those reads to a header rule exactly like the column you want.
   *
   * There is no honest tie-break. Taking the first is a coin toss dressed as a
   * rule, and the coin lands on the wrong column often enough to matter: the
   * 2024 list of MPs puts the 2019 notional affiliation three columns left of
   * the 2024 winner, and the 2019 list puts the incumbent's affiliation — a
   * pre-election fact — two columns left of the result. Picking either wrong
   * produces a map that is plausible, wrong, and wrong invisibly.
   *
   * So when two columns claim one role, neither gets it. The role goes unset,
   * the review screen shows both headers with a value out of each, and the
   * person decides. An unset role is a visible gap; a wrongly set one is not.
   */
  const claims = new Map();
  for (const col of columns) {
    if (col.role === 'ignore') continue;
    if (!claims.has(col.role)) claims.set(col.role, []);
    claims.get(col.role).push(col);
  }
  for (const [, cols] of claims) {
    if (cols.length < 2) continue;
    for (const col of cols) {
      col.role = 'ignore';
      // Kept so the review can say why this one is blank rather than leaving it
      // looking like the rule simply had nothing to say about it.
      col.contested = true;
    }
  }

  // With no header to read, fall back to position: the first text column names
  // the region, the second names the party, and numbers are left for the person.
  if (!hasHeader) {
    const body = rows[0];
    const textCols = body.map((c, i) => ({ i, num: parseNumber(c).value != null }))
      .filter((x) => !x.num).map((x) => x.i);
    if (textCols[0] != null) columns[textCols[0]].role = 'unit';
    if (textCols[1] != null) columns[textCols[1]].role = 'party';
  } else {
    // A header that named no role at all leaves the first column as the unit,
    // which is where a region name nearly always is. A *contested* column is
    // different: something did read it, and two things read it the same way, so
    // it is not available to fall back onto.
    if (!columns.some((c) => c.role === 'unit') && !columns.some((c) => c.contested)) {
      const first = columns.find((c) => c.role === 'ignore');
      if (first) first.role = 'unit';
    }
  }

  // A value out of each column, so the review shows what is in it and not only
  // what it is called. Two headers can read alike; their contents rarely do.
  const body = hasHeader ? rows.slice(1) : rows;
  for (const col of columns) {
    const hit = body.find((r) => r[col.index] && String(r[col.index]).trim());
    col.sample = hit ? String(hit[col.index]).trim().slice(0, 40) : '';
  }

  return { columns, hasHeader };
}

function looksLikeHeader(rows) {
  if (rows.length < 2) return false;
  const head = rows[0];

  // Whatever else a header is, it does not hold numbers.
  if (head.some((c) => parseNumber(c).value != null)) return false;

  // Usually the rows below it do, which settles it.
  if (rows[1].some((c) => parseNumber(c).value != null)) return true;

  // An all-text table has no numbers to compare against, so fall back to
  // reading the first row: two or more cells that name a known role is a
  // header, and one is not enough to act on.
  const named = head.filter((c) => HEADER_HINTS.some(([, re]) => re.test(c))).length;
  return named >= 2;
}
