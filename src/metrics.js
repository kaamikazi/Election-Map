/**
 * Metrics and the colour ramp.
 *
 * Three decisions are made here on purpose rather than by default:
 *
 * 1. Ramping happens in HCL, not sRGB. Interpolating two hex values in RGB
 *    drags the midtones through mud, and two parties' ramps end up meeting in
 *    the same murky grey. HCL keeps each party's hue while lightness moves.
 * 2. Every metric carries its own domain. A 55% vote share is a landslide; a
 *    55% turnout is unremarkable. One shared 0–100 scale would flatten both.
 * 3. Values are binned into five steps, not ramped continuously. A continuous
 *    gradient cannot be read off a phone screen and cannot be labelled in a
 *    legend.
 */

export const BINS = 5;

/** Turnout is nobody's colour, so it gets a hue no party uses. */
export const NEUTRAL = '#3E8E8A';

export const METRICS = [
  {
    id: 'flat',
    label: 'Flat party colour',
    unit: '',
    domain: null,
    note: ''
  },
  {
    id: 'vote',
    label: "Winner's vote share",
    unit: '%',
    domain: [30, 70],
    note: 'A plurality near 30% is common; above 60% is a landslide, so the domain starts at 30.'
  },
  {
    id: 'seats',
    label: 'Seat share',
    unit: '%',
    domain: [30, 85],
    note: 'Seat shares skew higher than vote shares under most systems.'
  },
  {
    id: 'turnout',
    label: 'Turnout',
    unit: '%',
    domain: [35, 90],
    neutral: true,
    note: 'Party-neutral: a single hue, so turnout is never confused with who won.'
  },
  {
    id: 'margin',
    label: 'Margin over runner-up',
    unit: 'pts',
    domain: [0, 35],
    note: 'Steepest ramp. Near-ties sit in the palest bin and read close to white.'
  }
];

/** The value fields a division carries, in the order the editor shows them. */
export const FIELDS = METRICS.filter((m) => m.domain).map((m) => ({
  key: m.id, label: m.id === 'margin' ? 'Margin' : m.label.replace("Winner's v", 'V'), unit: m.unit
}));

export const metricDef = (id) => METRICS.find((m) => m.id === id) || METRICS[0];

export const domainLabel = (m) =>
  m.domain ? m.domain[0] + '–' + m.domain[1] + m.unit : '—';

/**
 * A party colour lightened toward its own pale end.
 * @param {string} hex  the party's full-strength colour
 * @param {number} t    0..1 along the ramp
 */
export function ramp(hex, t) {
  const base = d3.hcl(hex);
  const pale = d3.hcl(base.h, base.c * 0.22, 94);
  // Never start at the very palest point — the lowest bin still needs to read
  // as a colour rather than as unassigned.
  return d3.interpolateHcl(pale, base)(0.12 + t * 0.88) + '';
}

export function binOf(v, def) {
  const [a, b] = def.domain;
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return Math.min(BINS - 1, Math.floor(t * BINS));
}

/** The colour of bin i, for the map, the legend and the export alike. */
export const binColor = (hex, i) => ramp(hex, (i + 0.5) / BINS);

/** Evenly spaced swatches for one legend strip. */
export const rampSwatches = (hex) =>
  Array.from({ length: BINS }, (_, i) => binColor(hex, i));

/**
 * The fill for one division.
 * @param {{party:number}} rec        the assignment record, or null
 * @param {string} partyColor         the winning party's colour
 * @param {string} metricId
 * @param {string} unvalued           colour for "assigned but this metric is blank"
 */
export function fillFor(rec, partyColor, metricId, unvalued) {
  if (!rec || !partyColor) return null;
  if (metricId === 'flat') return partyColor;

  const def = metricDef(metricId);
  const v = rec[metricId];
  if (v == null || !isFinite(v)) return unvalued;

  return binColor(def.neutral ? NEUTRAL : partyColor, binOf(v, def));
}

/** Ticks under a ramp legend: low, midpoint, high-and-above. */
export function ticksFor(def) {
  if (!def.domain) return [];
  const [a, b] = def.domain;
  return [a + def.unit, Math.round((a + b) / 2) + def.unit, b + '+' + def.unit];
}
