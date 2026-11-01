const LOOKUP_INTERVAL = 15000;
const MIN_MOVEMENT = 15;

function movedMeters(a, b) {
  const lat = (a.latitude + b.latitude) * Math.PI / 360;
  return Math.hypot((a.latitude - b.latitude) * 111195, (a.longitude - b.longitude) * Math.cos(lat) * 111195);
}

export function createStreetAlerts({ onPosition }) {
  const $ = id => document.getElementById(id);
  const locate = $('locate');
  const toggle = $('toggle-street-alerts');
  const locationStatus = $('location-status');
  const streetStatus = $('street-status');
  const alert = $('street-alert');
  let enabled = false;
  let visible = true;
  let watchId = null;
  let lookupTimer;
  let controller;
  let generation = 0;
  let positionGeneration = 0;
  let lastStarted = 0;
  let lastChecked;
  let lastPosition;
  let currentStreet = null;
  let dismissedStreet = null;
  let announcedStreet = null;

  const usable = () => visible && document.visibilityState === 'visible';
  function cancelLookup() {
    generation++;
    clearTimeout(lookupTimer);
    controller?.abort();
    controller = null;
    lastChecked = null;
  }
  function clearStreet() {
    alert.hidden = true;
    $('current-street').hidden = true;
    $('retry-street').hidden = true;
  }
  function showResult(data) {
    $('retry-street').hidden = true;
    if (data.status !== 'found' || !data.street) {
      clearStreet();
      currentStreet = dismissedStreet = null;
      announcedStreet = null;
      const messages = {
        imprecise: 'A localização é pouco precisa para identificar a rua. Tente novamente num local com melhor sinal.',
        ambiguous: 'Há mais de uma rua próxima da sua posição. Afaste-se do cruzamento para voltar a verificar.',
        not_found: 'Não foi identificado um arruamento junto à sua posição.'
      };
      streetStatus.textContent = messages[data.status] || messages.not_found;
      return;
    }
    const street = data.street;
    const key = street.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    if (key !== currentStreet) { dismissedStreet = null; announcedStreet = null; }
    currentStreet = key;
    $('current-street').hidden = false;
    $('current-street-name').textContent = street.name;
    $('open-street').href = /^[1-9]\d{0,15}$/.test(street.id) ? `#rua/${street.id}` : '#explorar';
    $('open-alert-street').href = $('open-street').href;
    const source = $('street-source');
    // Only allow links to the provider's numeric OSM way identifiers.
    source.href = /^\d+$/.test(street.id) ? `https://www.openstreetmap.org/way/${street.id}` : 'https://www.openstreetmap.org/copyright';
    streetStatus.textContent = street.potentialPerson ? '' : 'Não foram encontrados indícios suficientes de um nome de pessoa. A classificação continua por confirmar.';
    if (street.potentialPerson && dismissedStreet !== key) {
      alert.setAttribute('aria-live', announcedStreet === key ? 'off' : 'assertive');
      $('street-alert-name').textContent = street.name;
      alert.hidden = false;
      announcedStreet = key;
    } else alert.hidden = true;
  }
  function inspectPosition(coords) {
    lastPosition = coords;
    if (!usable()) return;
    if (coords.accuracy > 50) {
      cancelLookup();
      showResult({ status: 'imprecise' });
      return;
    }
    if (lastChecked && movedMeters(lastChecked, coords) < MIN_MOVEMENT) return;
    // Keep an existing lookup/timer when a GPS fix only jitters a few metres.
    if (controller && controller.position && movedMeters(controller.position, coords) < MIN_MOVEMENT) return;
    cancelLookup();
    clearStreet();
    streetStatus.textContent = 'A identificar a rua junto à sua posição…';
    const version = generation;
    const requestController = new AbortController();
    requestController.position = coords;
    controller = requestController;
    lookupTimer = setTimeout(async () => {
      lastStarted = Date.now();
      const timeout = setTimeout(() => requestController.abort(new DOMException('Timeout', 'TimeoutError')), 60000);
      const slow = setTimeout(() => {
        if (version === generation && usable()) streetStatus.textContent = 'A identificar a rua. A consulta está a demorar mais do que o habitual. Aguarde um pouco…';
      }, 8000);
      try {
        const response = await fetch('/api/location/street', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }),
          signal: requestController.signal
        });
        const data = await response.json();
        if (version !== generation || !usable()) return;
        if (!response.ok) throw new Error(data.error || 'Não foi possível identificar a rua.');
        lastChecked = coords;
        showResult(data);
      } catch (error) {
        if (version !== generation || !usable() || error.name === 'AbortError') return;
        clearStreet();
        streetStatus.textContent = !navigator.onLine ? 'Sem ligação. Ligue-se à internet para identificar a rua.' : error.name === 'TimeoutError' ? 'O serviço de arruamentos demorou demasiado a responder. Tente novamente.' : error.message === 'Failed to fetch' ? 'Não foi possível identificar a rua neste momento. Tente novamente.' : error.message;
        $('retry-street').hidden = false;
      } finally { clearTimeout(timeout); clearTimeout(slow); if (version === generation) controller = null; }
    }, Math.max(0, LOOKUP_INTERVAL - (Date.now() - lastStarted)));
  }
  function receivePosition(coords, center) {
    if (!usable()) return;
    onPosition(coords, center);
    locationStatus.textContent = `Localização encontrada. Precisão aproximada: ${Math.max(1, Math.round(coords.accuracy))} m.`;
    inspectPosition(coords);
  }
  function finishLocate() { locate.disabled = false; locate.removeAttribute('aria-busy'); }
  function stopWatch() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    positionGeneration++;
    finishLocate();
    cancelLookup();
    clearStreet();
  }
  function updateToggle() {
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.textContent = enabled ? 'Desativar alertas de ruas' : 'Ativar alertas de ruas';
  }
  function positionError(error) {
    cancelLookup();
    clearStreet();
    streetStatus.textContent = '';
    const messages = {
      1: 'O acesso à localização foi recusado. Pode autorizá-lo nas definições do navegador ou explorar o mapa manualmente.',
      2: 'Não foi possível determinar a sua localização. Tente novamente ou explore o mapa manualmente.',
      3: 'A localização demorou demasiado tempo. Tente novamente.'
    };
    locationStatus.textContent = messages[error.code] || messages[2];
    if (error.code === 1) { enabled = false; stopWatch(); updateToggle(); }
    finishLocate();
  }
  function canLocate() {
    if (navigator.geolocation && window.isSecureContext) return true;
    locationStatus.textContent = 'A localização não está disponível neste navegador. Pode continuar a explorar o mapa manualmente.';
    return false;
  }
  function startWatch() {
    if (!enabled || !usable() || watchId !== null) return;
    const version = positionGeneration;
    let firstFix = true;
    locationStatus.textContent = 'A acompanhar a sua localização…';
    watchId = navigator.geolocation.watchPosition(({ coords }) => {
      if (version !== positionGeneration || !enabled || !usable()) return;
      receivePosition(coords, firstFix);
      firstFix = false;
    }, error => { if (version === positionGeneration && usable()) positionError(error); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
  }
  locate.addEventListener('click', () => {
    if (!canLocate()) return;
    const version = ++positionGeneration;
    // Restart an active watch after this manual request so its callbacks stay current.
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    locate.disabled = true;
    locate.setAttribute('aria-busy', 'true');
    locationStatus.textContent = 'A obter a sua localização…';
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (version !== positionGeneration || !usable()) return;
      receivePosition(coords, true);
      finishLocate();
      startWatch();
    }, error => { if (version === positionGeneration && usable()) { positionError(error); startWatch(); } }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });
  toggle.addEventListener('click', () => {
    if (!enabled && !canLocate()) return;
    enabled = !enabled;
    if (enabled) startWatch();
    else { stopWatch(); streetStatus.textContent = 'Alertas automáticos desativados.'; }
    updateToggle();
  });
  $('dismiss-street-alert').addEventListener('click', () => { dismissedStreet = currentStreet; alert.hidden = true; });
  $('retry-street').addEventListener('click', () => { if (lastPosition) { lastChecked = null; inspectPosition(lastPosition); } });
  function syncVisibility() {
    if (!usable()) { stopWatch(); streetStatus.textContent = enabled ? 'Alertas em pausa enquanto o mapa não está visível.' : ''; }
    else startWatch();
  }
  document.addEventListener('visibilitychange', syncVisibility);
  window.addEventListener('pagehide', stopWatch);
  toggle.disabled = locate.disabled = false;
  return { setVisible(value) { visible = value; syncVisibility(); } };
}
