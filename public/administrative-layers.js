import L from './leaflet.js';

const SOURCE = 'DGT — CAOP 2025';
const ATTRIBUTION = '<a href="https://www.dgterritorio.gov.pt/atividades/cartografia/cartografia-tematica/caop" target="_blank" rel="noopener">DGT — CAOP 2025</a>';
const COVERAGE = L.latLngBounds([36.9, -9.56], [42.2, -6.1]);
const definitions = [
  { id: 'distritos', label: 'Distritos', field: 'distrito', code: 'dt', minZoom: 5, color: '#77559e', weight: 3, pane: 330 },
  { id: 'municipios', label: 'Concelhos', field: 'municipio', code: 'dtmn', minZoom: 8, color: '#a36512', weight: 2, pane: 340 },
  { id: 'freguesias', label: 'Freguesias', field: 'freguesia', code: 'dtmnfr', minZoom: 11, color: '#207d80', weight: 1.5, pane: 350 }
];
let plugin;
function loadPlugin() {
  plugin ||= import('/app/vendor/vectorgrid/Leaflet.VectorGrid.bundled.min.js');
  return plugin;
}

export function createAdministrativeLayers(map) {
  const status = document.getElementById('boundaries-status');
  const retry = document.getElementById('retry-boundaries');
  let visible = true;
  const states = definitions.map(definition => ({ ...definition, input: document.getElementById(`layer-${definition.id}`), layer: null, error: false, loading: false, version: 0 }));
  function updateStatus() {
    const selected = states.filter(state => state.input.checked);
    const errors = selected.filter(state => state.error);
    retry.hidden = !errors.length || !navigator.onLine;
    if (!selected.length) { status.textContent = ''; return; }
    if (!navigator.onLine) { status.textContent = 'Sem ligação. Os limites administrativos precisam de acesso à internet.'; return; }
    if (!map.getBounds().intersects(COVERAGE)) { status.textContent = 'Estas camadas estão disponíveis para Portugal continental.'; return; }
    const messages = [];
    if (errors.length) messages.push(`Não foi possível carregar: ${errors.map(state => state.label).join(', ')}.`);
    const waiting = selected.filter(state => map.getZoom() < state.minZoom);
    if (waiting.length) messages.push(`Aproxime o mapa para ver ${waiting.map(state => `${state.label.toLowerCase()} (zoom ${state.minZoom})`).join(' e ')}.`);
    if (selected.some(state => state.loading && !state.error)) messages.push('A carregar limites administrativos…');
    status.textContent = messages.join(' ');
  }
  function popupContent(state, properties) {
    const content = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = `${state.label}: ${properties[state.field] || 'Sem nome'}`;
    content.append(title);
    for (const [label, value] of [['Concelho', state.id === 'freguesias' ? properties.municipio : null], ['Distrito', state.id !== 'distritos' ? properties.distrito_ilha : null], ['Código', properties[state.code]], ['Fonte', SOURCE]]) {
      if (!value) continue;
      const line = document.createElement('div'); line.textContent = `${label}: ${value}`; content.append(line);
    }
    return content;
  }
  async function sync(state) {
    const version = ++state.version;
    const eligible = visible && state.input.checked && navigator.onLine && map.getZoom() >= state.minZoom && map.getBounds().intersects(COVERAGE);
    if (!eligible) {
      if (state.layer && map.hasLayer(state.layer)) map.removeLayer(state.layer);
      state.loading = false; updateStatus(); return;
    }
    if (state.layer && map.hasLayer(state.layer)) { updateStatus(); return; }
    state.loading = true; state.error = false; updateStatus();
    try {
      await loadPlugin();
      if (version !== state.version || !state.input.checked || !visible) return;
      if (!state.layer) {
        const pane = `boundaries-${state.id}`;
        map.createPane(pane).style.zIndex = state.pane;
        const layer = L.vectorGrid.protobuf(`/map-data/${state.id}/{z}/{x}/{y}.pbf`, {
          pane, interactive: true, rendererFactory: L.svg.tile,
          minZoom: state.minZoom, maxZoom: 19, maxNativeZoom: 14,
          bounds: COVERAGE, noWrap: true, keepBuffer: 0, updateWhenIdle: true,
          attribution: ATTRIBUTION,
          vectorTileLayerStyles: { [`cont_${state.id}`]: { color: state.color, weight: state.weight, fill: true, fillColor: state.color, fillOpacity: .025, dashArray: state.id === 'freguesias' ? '4,3' : null } }
        });
        // VectorGrid returns an array for failed HTTP responses and an object
        // for valid MVTs (including empty ocean tiles). Surface errors safely.
        const originalLoad = layer._getVectorTilePromise.bind(layer);
        layer._getVectorTilePromise = coords => originalLoad(coords).then(tile => {
          if (Array.isArray(tile.layers)) { state.error = true; updateStatus(); }
          return tile;
        }).catch(() => { state.error = true; updateStatus(); return { layers: {} }; });
        layer.on('loading', () => { state.loading = true; updateStatus(); });
        layer.on('load', () => { state.loading = false; updateStatus(); });
        layer.on('click', event => { if (state.input.checked) L.popup().setLatLng(event.latlng).setContent(popupContent(state, event.layer.properties)).openOn(map); });
        state.layer = layer;
      }
      state.layer.addTo(map);
    } catch {
      state.error = true; state.loading = false; updateStatus();
    }
  }
  function syncAll() { for (const state of states) sync(state); }
  for (const state of states) state.input.addEventListener('change', () => { map.closePopup(); sync(state); });
  map.on('moveend', syncAll);
  window.addEventListener('offline', syncAll);
  window.addEventListener('online', syncAll);
  retry.addEventListener('click', () => {
    for (const state of states.filter(state => state.input.checked && state.error)) {
      state.error = false;
      if (state.layer && map.hasLayer(state.layer)) state.layer.redraw(); else sync(state);
    }
    updateStatus();
  });
  return { setVisible(value) { visible = value; syncAll(); } };
}
