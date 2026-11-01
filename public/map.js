import L from './leaflet.js';
import { createStreetAlerts } from './street-alerts.js';
import { createAdministrativeLayers } from './administrative-layers.js';
import { createMapSelection } from './map-selection.js';

const INITIAL_CENTER = [39.6, -8];
const INITIAL_ZOOM = 7;

export function createMap() {
  const status = document.getElementById('map-status');
  const locate = document.getElementById('locate');
  const reset = document.getElementById('reset-map');
  const retry = document.getElementById('retry-map');
  const map = L.map('map', { scrollWheelZoom: false }).setView(INITIAL_CENTER, INITIAL_ZOOM);
  const administrativeLayers = createAdministrativeLayers(map);
  const selection = createMapSelection(map);
  map.zoomControl.setPosition('topleft');
  const zoomIn = document.querySelector('.leaflet-control-zoom-in');
  const zoomOut = document.querySelector('.leaflet-control-zoom-out');
  zoomIn.title = 'Aproximar'; zoomIn.setAttribute('aria-label', 'Aproximar');
  zoomOut.title = 'Afastar'; zoomOut.setAttribute('aria-label', 'Afastar');
  let tileErrors = false;
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    minZoom: 2,
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    // Only fetch the visible view after panning finishes; use the browser HTTP cache.
    updateWhenIdle: true,
    keepBuffer: 1
  });
  function showOffline() {
    status.textContent = 'Sem ligação. Ligue-se à internet para carregar o mapa.';
    retry.hidden = true;
  }
  function reloadTiles() {
    if (!navigator.onLine) { showOffline(); return; }
    tileErrors = false;
    retry.hidden = true;
    status.textContent = 'A carregar o mapa…';
    tiles.redraw();
  }
  tiles.on('tileerror', () => {
    tileErrors = true;
    if (!navigator.onLine) { showOffline(); return; }
    status.textContent = 'Não foi possível carregar parte do mapa. Verifique a ligação e tente novamente.';
    retry.hidden = false;
  });
  tiles.on('load', () => {
    if (!navigator.onLine) showOffline();
    else if (!tileErrors) { status.textContent = ''; retry.hidden = true; }
  });
  tiles.addTo(map);
  if (!navigator.onLine) showOffline();
  window.addEventListener('offline', showOffline);
  window.addEventListener('online', reloadTiles);
  retry.addEventListener('click', reloadTiles);
  reset.disabled = locate.disabled = false;
  reset.addEventListener('click', () => map.setView(INITIAL_CENTER, INITIAL_ZOOM));

  let marker;
  let accuracyCircle;
  const alerts = createStreetAlerts({ onPosition(coords, center) {
      const point = [coords.latitude, coords.longitude];
      if (marker) marker.setLatLng(point);
      else {
        marker = L.circleMarker(point, { radius: 9, color: '#fff', weight: 3, fillColor: '#234d42', fillOpacity: 1, className: 'location-dot' }).addTo(map);
        marker.bindTooltip('A sua localização', { direction: 'top' });
      }
      if (accuracyCircle) accuracyCircle.setLatLng(point).setRadius(coords.accuracy);
      else accuracyCircle = L.circle(point, { radius: coords.accuracy, color: '#234d42', weight: 1, fillOpacity: .1, interactive: false }).addTo(map);
      if (center) map.fitBounds(accuracyCircle.getBounds(), { maxZoom: 17, padding: [35, 35] });
  } });
  return { resize: () => requestAnimationFrame(() => map.invalidateSize({ pan: false })), setVisible(value) { alerts.setVisible(value); administrativeLayers.setVisible(value); selection.setVisible(value); } };
}
