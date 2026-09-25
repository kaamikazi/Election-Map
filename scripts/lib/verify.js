/**
 * Geometry invariants for a boundary layer.
 *
 * Milestone 7 shipped a geoBoundaries layer whose rings were wound the wrong
 * way. d3-geo reads a counter-clockwise exterior as "the whole sphere except
 * this", so every division rendered as a planet-sized blob — and fourteen tests
 * stayed green, because every one of them asked about names, counts and
 * metadata and none of them asked how much of the Earth the map was claiming.
 *
 * These checks are hard failures in the build. A layer that violates one is not
 * written.
 *
 * The thresholds come from the data, not from taste. Measured across all 253
 * layers already built:
 *
 *   largest single unit     0.3014 sr   Antarctica    (ne:ATA:ADM1)
 *   next largest            0.0752 sr   Sakha         (ne:RUS:ADM1)
 *   largest layer total     0.4160 sr   Russia        (ne:RUS:ADM1)
 *   a reversed ring        ~12.5 sr     the sphere is 4π = 12.5664
 *
 * So a single unit over half a steradian is not an administrative unit, and a
 * layer totalling more than a hemisphere is not a country. Both sit far above
 * anything real and far below the failure they catch.
 */

import * as d3 from 'd3-geo';
import * as topojson from 'topojson-client';

/** Antarctica is the largest real admin unit at 0.3014; this leaves it room. */
export const MAX_UNIT_AREA = 0.5;

/** Half the sphere. Russia, the largest real layer, totals 0.416. */
export const MAX_LAYER_AREA = 2 * Math.PI;

/**
 * How much of its own area a unit may lose to simplification.
 *
 * The absolute limits above catch a unit that was *removed* or inverted. They
 * say nothing about one that was *degraded* — a real coastline simplified down
 * to a three-vertex triangle still has area, still counts, and passes every
 * other check. Measured across all 4,596 admin-1 units, 99% keep at least
 * 99.3% of their source area, so a floor of 0.90 sits far below anything
 * normal and still catches the quiet cases: Isles of Scilly at 0.735,
 * Lakshadweep at 0.791, the Paracel Islands at 0.154.
 *
 * The ratio is also scale-free, which is what makes it the right check for
 * constituencies: a Bangladeshi seat is around 0.00001 sr, and an absolute
 * limit tuned for provinces means nothing there.
 */
export const MIN_AREA_RATIO = 0.90;

/** A unit cannot gain half its area again. A reversed ring gains millions. */
export const MAX_AREA_RATIO = 1.5;

const round = (n) => Math.round(n * 10000) / 10000;

/**
 * @param {object} topo        the TopoJSON about to be written
 * @param {object} expect      { units } the count the source's metadata claimed
 * @returns {{ok: boolean, problems: string[], total: number, largest: object}}
 */
export function verifyLayer(topo, expect = {}) {
  const problems = [];

  const object = topo.objects && topo.objects.units;
  if (!object) {
    return { ok: false, problems: ['no `units` object in the topology'], total: 0, largest: null };
  }

  const features = topojson.feature(topo, object).features;
  if (!features.length) {
    return { ok: false, problems: ['the layer holds no units'], total: 0, largest: null };
  }

  let total = 0;
  let largest = { name: null, area: 0 };
  for (const f of features) {
    const area = d3.geoArea(f);
    total += area;
    if (area > largest.area) largest = { name: f.properties && f.properties.name, area };
  }

  if (!Number.isFinite(total)) problems.push('unit areas do not compute — degenerate geometry');

  if (total >= MAX_LAYER_AREA) {
    problems.push(
      `the layer covers ${round(total)} steradians, more than half the sphere ` +
      `(limit ${round(MAX_LAYER_AREA)}). Rings are almost certainly wound the wrong way.`);
  }

  /*
   * With a baseline, every unit is judged against its own source area, which
   * works at any scale. Without one, fall back to the absolute ceiling — it is
   * calibrated for admin units and says nothing useful about constituencies,
   * which is exactly why the ratio test exists.
   */
  const baseline = expect.areas || null;
  if (baseline) {
    const shrunk = [];
    const grown = [];
    for (const f of features) {
      const before = baseline[f.properties && f.properties.id];
      if (!before || before <= 0) continue;
      const ratio = d3.geoArea(f) / before;
      if (ratio < MIN_AREA_RATIO) shrunk.push(`${f.properties.name} ${round(ratio)}`);
      if (ratio > MAX_AREA_RATIO) grown.push(`${f.properties.name} ${round(ratio)}`);
    }
    if (shrunk.length) {
      problems.push(
        `${shrunk.length} unit(s) lost more than ${Math.round((1 - MIN_AREA_RATIO) * 100)}% ` +
        `of their area to simplification: ${shrunk.slice(0, 5).join(', ')}`);
    }
    if (grown.length) {
      problems.push(
        `${grown.length} unit(s) are larger than their source geometry: ` +
        `${grown.slice(0, 5).join(', ')}. Rings may be wound the wrong way.`);
    }
  } else if (largest.area > MAX_UNIT_AREA) {
    problems.push(
      `"${largest.name}" alone covers ${round(largest.area)} steradians ` +
      `(limit ${MAX_UNIT_AREA}). No real administrative unit is that large; ` +
      'Antarctica, the largest, is 0.3014.');
  }

  // A unit with no area at all is a ring that collapsed during simplification.
  const empty = features.filter((f) => d3.geoArea(f) <= 0).map((f) => f.properties.name);
  if (empty.length) {
    problems.push(`${empty.length} unit(s) have zero area: ${empty.slice(0, 5).join(', ')}`);
  }

  if (expect.units != null && features.length !== expect.units) {
    problems.push(
      `the source's metadata claims ${expect.units} units and the file holds ${features.length}`);
  }

  return { ok: problems.length === 0, problems, total, largest };
}

/** Throw on the first failure, so a bad layer never reaches disk. */
export function assertLayer(label, topo, expect) {
  const result = verifyLayer(topo, expect);
  if (!result.ok) {
    throw new Error(`${label} failed its geometry check:\n  - ` + result.problems.join('\n  - '));
  }
  return result;
}
