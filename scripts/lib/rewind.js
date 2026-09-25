import * as d3 from 'd3-geo';

/**
 * Ring winding.
 *
 * d3-geo treats polygons as spherical, and in that world a ring's direction
 * decides which side of it is inside. Its convention is that an exterior ring
 * runs clockwise; a counter-clockwise one means "the whole sphere except this",
 * which renders as a planet-sized blob of one colour and looks nothing like a
 * bug in the data.
 *
 * GeoJSON's own spec (RFC 7946) says the opposite — exteriors counter-clockwise
 * — and sources differ on which they follow. Natural Earth ships clockwise;
 * geoBoundaries ships counter-clockwise. So every source is rewound on the way
 * in rather than trusted, and a source that is already correct is untouched.
 */

/**
 * Ask the renderer.
 *
 * A planar shoelace test over lon/lat is the obvious way to do this and it is
 * not good enough: it disagrees with d3 near the poles and across the
 * antimeridian, and on a ring whose planar area is near zero the sign is
 * meaningless, so a rewind based on it can flip a ring the wrong way. The ONS
 * constituency file contains one such unit, and a shoelace rewind left it
 * covering the entire sphere.
 *
 * d3.geoArea is the function that will later decide what this polygon means, so
 * it is the one that should decide which way round it goes. A polygon covering
 * more than half the sphere is inside-out, whatever its coordinates look like
 * on a flat page.
 */
const HALF_SPHERE = 2 * Math.PI;

function rewindPolygon(rings) {
  const area = d3.geoArea({ type: 'Polygon', coordinates: rings });
  if (area <= HALF_SPHERE) return rings;
  // Reversing every ring inverts the polygon as a whole and leaves each hole
  // opposite its exterior, which is the relation that matters.
  return rings.map((ring) => ring.slice().reverse());
}

export function rewindGeometry(geometry) {
  if (!geometry) return geometry;
  if (geometry.type === 'Polygon') {
    return { ...geometry, coordinates: rewindPolygon(geometry.coordinates) };
  }
  if (geometry.type === 'MultiPolygon') {
    return { ...geometry, coordinates: geometry.coordinates.map(rewindPolygon) };
  }
  return geometry;
}

export const rewindFeature = (f) => ({ ...f, geometry: rewindGeometry(f.geometry) });
