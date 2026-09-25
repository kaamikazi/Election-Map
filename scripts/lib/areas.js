/**
 * Source areas, measured before any simplification.
 *
 * The ratio check in verify.js needs to know what each unit looked like on the
 * way in. Taking it here, from the features the build is about to shape, keeps
 * the baseline honest: it is the same geometry, measured once.
 */

import * as d3 from 'd3-geo';

/** @param {Array} features already carrying their final `properties.id` */
export function baselineAreas(features) {
  const out = {};
  for (const f of features) {
    const id = f.properties && f.properties.id;
    if (!id || !f.geometry) continue;
    out[id] = d3.geoArea(f);
  }
  return out;
}
