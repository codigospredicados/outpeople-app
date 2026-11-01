import L from './leaflet.js';

const STREET_ZOOM = 16;
const $ = id => document.getElementById(id);

export function createMapSelection(map) {
  let marker, point, controller, timer, version = 0, visible = true;
  const usable = () => visible && document.visibilityState === 'visible';
  function cancel() {
    version++;
    clearTimeout(timer);
    controller?.abort(); controller = null;
  }
  function clear() {
    cancel(); point = null;
    if (marker) map.removeLayer(marker);
    marker = null;
    $('map-selection-status').textContent = '';
    $('retry-selection').hidden = $('clear-selection').hidden = true;
  }
  function content(title, description, street) {
    const node = document.createElement('div'); node.className = 'selected-street-popup';
    const heading = document.createElement('strong'); heading.textContent = title;
    const text = document.createElement('p'); text.textContent = description;
    node.append(heading, text);
    if (street) {
      const link = document.createElement('a'); link.href = `#rua/${street.id}`; link.textContent = 'Consultar e contribuir nesta rua ↗';
      node.append(link);
    }
    return node;
  }
  function show(title, description, street) {
    $('map-selection-status').textContent = `${title} ${description}`;
    marker?.setPopupContent(content(title, description, street)).openPopup();
  }
  async function lookup(selected, token) {
    const requestController = new AbortController(); controller = requestController;
    const timeout = setTimeout(() => requestController.abort(new DOMException('Timeout', 'TimeoutError')), 15000);
    try {
      const response = await fetch('/api/location/street', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // This is a point chosen on the map, not a measured GPS position.
        body: JSON.stringify({ latitude: selected.lat, longitude: selected.lng, accuracy: 0 }),
        signal: requestController.signal
      });
      const data = await response.json();
      if (token !== version || !usable()) return;
      if (!response.ok) throw new Error(data.error || 'Não foi possível identificar a rua. Tente novamente.');
      if (data.status === 'found' && data.street && /^[1-9]\d{0,15}$/.test(data.street.id) && typeof data.street.name === 'string') {
        const description = data.street.potentialPerson
          ? 'Possível nome de pessoa. A associação está por confirmar.'
          : 'Sem indícios suficientes de nome de pessoa. A classificação está por confirmar.';
        show(data.street.name, description, data.street);
      } else {
        const ambiguous = data.status === 'ambiguous';
        show(ambiguous ? 'Mais de uma rua próxima.' : 'Rua não identificada.', ambiguous
          ? 'Toque mais perto do centro da rua, afastado do cruzamento.'
          : 'Não foi encontrado um arruamento com nome neste ponto. Experimente tocar mais perto da rua.');
      }
    } catch (error) {
      if (token !== version || !usable() || error.name === 'AbortError') return;
      show('Não foi possível identificar a rua.', !navigator.onLine ? 'Sem ligação. Ligue-se à internet e tente novamente.' : error.name === 'TimeoutError' ? 'A consulta demorou demasiado. Tente novamente.' : error.message);
      $('retry-selection').hidden = false;
    } finally { clearTimeout(timeout); if (token === version) controller = null; }
  }
  function select(selected) {
    if (!usable()) return;
    clear();
    if (map.getZoom() < STREET_ZOOM) {
      map.setView(selected, 17);
      $('map-selection-status').textContent = 'Mapa aproximado. Toque agora sobre a rua que pretende identificar.';
      return;
    }
    point = selected;
    marker = L.marker(selected, {
      title: 'Ponto selecionado no mapa', alt: 'Ponto selecionado no mapa',
      icon: L.divIcon({ className: 'selected-street-marker', html: '<span aria-hidden="true"></span>', iconSize: [24, 24], iconAnchor: [12, 12] })
    }).addTo(map).bindPopup(content('Ponto selecionado.', 'A identificar a rua…'), { maxWidth: 260 });
    marker.openPopup();
    $('map-selection-status').textContent = 'A identificar a rua no ponto selecionado…';
    $('clear-selection').hidden = false;
    const token = version;
    // Coalesce rapid clicks/double taps before consulting the street service.
    timer = setTimeout(() => lookup(selected, token), 350);
  }
  map.on('click', event => {
    if (event.layer || (event.sourceTarget && event.sourceTarget !== map)) return;
    select(event.latlng);
  });
  // Administrative overlays intercept clicks; at street zoom they forward the
  // chosen point here, while wider views keep their administrative popups.
  map.on('streetselect', event => select(event.latlng));
  $('clear-selection').addEventListener('click', clear);
  $('retry-selection').addEventListener('click', () => { if (point) select(point); });
  $('reset-map').addEventListener('click', clear);
  document.addEventListener('visibilitychange', () => { if (!usable()) clear(); });
  return { setVisible(value) { visible = value; if (!value) clear(); } };
}
