/** Boot: load the world, wire the panels to the change bus, draw. */

import { $ } from './ui/dom.js';
import { toast } from './ui/toast.js';
import { onChange, state } from './state.js';
import { loadWorld, BY_KEY, screenPointOf } from './geo.js';
import { mountCanvas, render, schedule, setSelectedFeature } from './render.js';
import { syncParties, syncTallies, initParties } from './ui/parties.js';
import { syncResults } from './ui/results.js';
import { syncCountries, initCountries } from './ui/countries.js';
import { syncMetrics, initMetrics } from './ui/metric-panel.js';
import { syncSelection } from './ui/selection.js';
import { syncLegend } from './ui/legend.js';
import { initInteraction } from './ui/interaction.js';
import { initControls, syncUndo } from './ui/controls.js';
import { initExportDialog } from './ui/export-dialog.js';
import { initReview } from './ui/review.js';
import { initLayers, syncLayers } from './ui/layers.js';
import { initShell, syncMode, syncActive, syncFlagPanel } from './ui/shell.js';
import { prepareExport } from './flags.js';
import { loadAliases } from './import/match.js';
import { composite } from './export.js';

const WORLD_URL = 'data/world-50m.topo.json';

/*
 * One channel, five shapes of change:
 *   assign  a country changed hands or a value was typed — tallies, results,
 *           list, legend, selection, map
 *   parties a party was added, removed or loaded — everything
 *   style   a party was renamed or recoloured — everything but the party rows,
 *           which hold the input the user is typing in
 *   metric  a different metric is driving the colour — legend and map
 *   select  a different division is in the editor — editor and map
 *   view    projection, zoom or theme — map only
 */
onChange((kind) => {
  if (kind === 'active') {
    // Only the colour that follows the active party changes.
    syncActive();
    return;
  }
  if (kind === 'parties') { syncParties(); syncMode(); }
  if (kind === 'assign') syncTallies();
  if (kind === 'metric' || kind === 'parties') syncMetrics();
  if (kind === 'parties' || kind === 'assign') syncLayers();
  if (kind === 'assign' || kind === 'parties' || kind === 'style') {
    syncResults();
    syncCountries();
  }
  if (kind !== 'view') {
    syncLegend();
    syncSelection();
    syncFlagPanel();
    syncActive();
  }
  syncUndo();
  schedule();
});

async function boot() {
  mountCanvas($('#map'), $('#canvasWrap'));
  setSelectedFeature(() => (state.selected ? BY_KEY.get(state.selected) || null : null));

  initMetrics();
  initParties();
  initCountries();
  initControls();
  initExportDialog();
  initInteraction($('#map'));
  initShell();

  window.addEventListener('resize', schedule);

  try {
    await loadWorld(WORLD_URL);
  } catch (err) {
    toast('The map data could not be loaded');
    console.error(err);
    return;
  }

  syncParties();
  syncResults();
  syncCountries();
  syncLegend();
  syncSelection();
  syncUndo();
  render();

  // Adapters need the unit index, so the review screen boots after the world.
  loadAliases();
  initReview();
  initLayers();
}

boot();

// Exposed so the Playwright suite can drive state and grab an export without
// clicking through the dialog. Not used by the app itself.
window.__studio = { state, composite, render, schedule, prepareExport, screenPointOf };
