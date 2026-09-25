/**
 * ParlGov party families and the colour each one arrives with.
 *
 * A fetched election should land on the map already readable, so every family
 * gets a default slot. Two ParlGov codes are deliberately absent: 'none' (no
 * family) and 'code' (not yet classified). Those are not families, and giving
 * them a colour would state something the data does not. They arrive with a
 * null family, render in the unassigned tone, and are listed so the person can
 * colour them by hand.
 *
 * Colours sit near the studio's own palette rather than the conventional
 * European party colours, because two families on one map matter more than
 * either matching its national convention.
 */

/*
 * Nine families have to be told apart at thumbnail size, so they are spread
 * around the hue wheel rather than placed by national convention. Conservative
 * keeps the blue it is usually given; Christian democracy takes orange rather
 * than a second blue, because two blues side by side on a map of Europe are
 * one colour.
 */
export const FAMILIES = [
  { id: 'com',   label: 'Communist / Socialist', color: '#8E2B2B' },
  { id: 'soc',   label: 'Social democracy',      color: '#D8453E' },
  { id: 'chr',   label: 'Christian democracy',   color: '#E0872E' },
  { id: 'lib',   label: 'Liberal',               color: '#EFD24A' },
  { id: 'agr',   label: 'Agrarian',              color: '#9BB03A' },
  { id: 'eco',   label: 'Green / Ecologist',     color: '#3E9E6E' },
  { id: 'spec',  label: 'Special issue',         color: '#2AA3A3' },
  { id: 'con',   label: 'Conservative',          color: '#3B7DD8' },
  { id: 'right', label: 'Right-wing',            color: '#8659C4' }
];

const BY_ID = new Map(FAMILIES.map((f) => [f.id, f]));

export const familyLabel = (id) => (BY_ID.get(id) ? BY_ID.get(id).label : 'No party family');

/** The default colour for a family, or null when the family is unknown. */
export const familyColor = (id) => (BY_ID.get(id) ? BY_ID.get(id).color : null);

/** Colour for a party that has no family — never a guess, always this tone. */
export const UNFAMILIED = '#5E6B78';
