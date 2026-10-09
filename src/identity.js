/** History Through Maps identity, adapted from History-C's version 2 tokens.
 * Presentation never remaps a party colour, a metric ramp or a hatch meaning.
 */
import { state, THEMES, FONT } from './state.js';

const COLORS = {
  "light": {
    "ground": "#efe3c4",
    "ground-raised": "#f6edd5",
    "ground-sunk": "#e3d2a8",
    "ink": "#3b2a1a",
    "ink-muted": "#6a5640",
    "hairline": "#b9a273",
    "madder": "#6e2118",
    "territory": "#c4553f",
    "gold": "#9a6f1c",
    "verdigris": "#356156",
    "map-water": "#e3d2a8",
    "map-land": "#f1e4c3",
    "map-hatch": "#b9a273",
    "map-border": "#3b2a1a"
  },
  "dark": {
    "ground": "#1d1610",
    "ground-raised": "#2a2017",
    "ground-sunk": "#140f0a",
    "ink": "#efe3c4",
    "ink-muted": "#c2b08d",
    "hairline": "#4a3a28",
    "madder": "#e08a74",
    "territory": "#d9654c",
    "gold": "#e3b654",
    "verdigris": "#7fb3a3",
    "map-water": "#140f0a",
    "map-land": "#2e2418",
    "map-hatch": "#4a3a28",
    "map-border": "#c2b08d"
  }
};
export const historyIdentity = () => state.identity === 'history';
export const bodyFont = () => historyIdentity() ? '"EB Garamond",Georgia,serif' : FONT;
export const capsFont = () => historyIdentity() ? '"Cormorant SC",Georgia,serif' : FONT;
export const displayFont = () => '"IM Fell English",Georgia,serif';

export function presentation() {
  if (!historyIdentity()) return THEMES[state.theme];
  const p = COLORS[state.theme];
  return {
    bg: p.ground, ocean: p['map-water'], land: p['map-land'],
    border: p['ink-muted'], edge: p['map-border'], grat: p.hairline,
    text: p.ink, muted: p['ink-muted'], hover: p.verdigris,
    track: p['ground-sunk'], ring: p.ground, unvalued: p['ground-raised'],
    hatchInk: p['ink-muted'], backdrop: p['ground-raised'],
    casing: p.ink, flagLand: p['map-land'],
    raised: p['ground-raised'], rule: p.hairline, gold: p.gold, accent: p.madder
  };
}

let loading = null, ready = false;
const marks = {};
/** Load local assets before measuring type, planning a series, or drawing PNGs. */
export async function prepareIdentity(identity = state.identity) {
  if (identity !== 'history' || ready) return;
  if (!loading) loading = (async () => {
    const faces = [
      new FontFace('IM Fell English', 'url(/brand/fonts/IMFeENit.ttf)', { style: 'italic' }),
      new FontFace('EB Garamond', 'url(/brand/fonts/EBGaramond.ttf)', { weight: '400 600' }),
      new FontFace('Cormorant SC', 'url(/brand/fonts/CormorantSC.ttf)', { weight: '600' })
    ];
    const images = ['light', 'dark'].map(async (theme) => {
      const img = new Image();
      img.src = theme === 'light' ? '/brand/mark.svg' : '/brand/mark-on-dark.svg';
      await img.decode();
      marks[theme] = img;
    });
    await Promise.all([...faces.map((face) => face.load()), ...images]);
    faces.forEach((face) => document.fonts.add(face));
    ready = true;
  })().catch((err) => {
    loading = null;
    throw new Error(`History identity assets could not load: ${err.message}`);
  });
  await loading;
}

export function assertIdentityReady() {
  if (historyIdentity() && !ready) throw new Error('History identity is still loading. Await prepareIdentity() before exporting.');
}

export function drawIdentityHeader(c, W, k, pad) {
  const T = presentation(), y = pad;
  c.drawImage(marks[state.theme], pad, y - 8 * k, 34 * k, 36 * k);
  c.font = `600 ${Math.round(19 * k)}px ${capsFont()}`;
  c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = T.accent;
  c.fillText('History Through Maps', pad + 46 * k, y + 10 * k);
  c.strokeStyle = T.rule; c.lineWidth = k;
  for (const offset of [33, 37]) {
    c.beginPath(); c.moveTo(pad, y + offset * k); c.lineTo(W - pad, y + offset * k); c.stroke();
  }
  return y + 55 * k;
}

export function drawIdentityFrame(c, W, H, k, mapTop, mapBot, pad) {
  const T = presentation();
  c.save(); c.strokeStyle = T.rule; c.lineWidth = k;
  for (const inset of [16, 20]) c.strokeRect(inset * k, inset * k, W - 2 * inset * k, H - 2 * inset * k);
  // A cartouche around the map, outside the geometry's clipping rectangle.
  for (const inset of [0, 4]) c.strokeRect(pad * 0.5 - inset * k, mapTop - inset * k,
    W - pad + 2 * inset * k, mapBot - mapTop + 2 * inset * k);
  c.fillStyle = T.gold;
  c.beginPath(); c.moveTo(W / 2, 12 * k); c.lineTo(W / 2 + 4 * k, 18 * k);
  c.lineTo(W / 2, 24 * k); c.lineTo(W / 2 - 4 * k, 18 * k); c.closePath(); c.fill();
  c.restore();
}
