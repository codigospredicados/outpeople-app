const $ = id => document.getElementById(id);
const streetHash = id => `#rua/${id}`;
const route = () => location.hash.match(/^#rua\/([1-9]\d{0,15})(\/recolher)?$/);

export function createStreetPage({ onRequireAuth, onSessionExpired }) {
  let currentId, user, authReady = false, cursor = null, controller, version = 0, publishing = false, loadingMore = false, shown = false, streetReady = false;
  let files = [];
  function resetFiles() {
    files.forEach(file => URL.revokeObjectURL(file.preview)); files = []; renderFiles();
    $('camera-photo').value = $('device-photos').value = '';
  }
  function renderFiles() {
    $('selected-photos').replaceChildren();
    files.forEach((file, index) => {
      const figure = document.createElement('figure');
      const image = document.createElement('img'); image.src = file.preview; image.alt = `Fotografia selecionada ${index + 1}`;
      const caption = document.createElement('figcaption'); caption.textContent = file.file.name;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button'; remove.textContent = 'Remover fotografia'; remove.setAttribute('aria-label', `Remover fotografia ${index + 1}`); remove.disabled = publishing;
      remove.addEventListener('click', () => { if (publishing) return; URL.revokeObjectURL(file.preview); files.splice(index, 1); renderFiles(); });
      figure.append(image, caption, remove); $('selected-photos').append(figure);
    });
  }
  function updateAuth() {
    $('contribution-auth-status').hidden = authReady;
    $('contribution-login').hidden = !authReady || Boolean(user);
    $('contribution-form').hidden = !authReady || !user;
  }
  function renderContribution(item, prepend = false) {
    const article = document.createElement('article'); article.className = 'contribution';
    const byline = document.createElement('p'); byline.className = 'contribution-byline';
    const author = document.createElement('strong'); author.textContent = item.author.name;
    const time = document.createElement('time'); time.dateTime = item.createdAt; time.textContent = new Date(item.createdAt).toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' });
    byline.append(author, ' · ', time); article.append(byline);
    if (item.text) { const text = document.createElement('p'); text.className = 'contribution-text'; text.textContent = item.text; article.append(text); }
    if (item.photos.length) {
      const gallery = document.createElement('div'); gallery.className = 'photo-grid';
      item.photos.forEach((photo, index) => {
        // Build links from validated identifiers, never from user-supplied URLs.
        if (!/^[0-9a-f-]{36}$/.test(item.id) || !/^[0-9a-f-]{36}$/.test(photo.id)) return;
        const path = `/api/contributions/${item.id}/photos/${photo.id}`;
        const link = document.createElement('a'); link.href = path; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', `Abrir fotografia ${index + 1} de ${item.author.name}`);
        const image = document.createElement('img'); image.src = path; image.alt = `Fotografia ${index + 1} partilhada por ${item.author.name}`; image.loading = 'lazy'; image.width = photo.width; image.height = photo.height;
        link.append(image); gallery.append(link);
      }); article.append(gallery);
    }
    $('contributions-list')[prepend ? 'prepend' : 'append'](article);
  }
  async function load(append = false) {
    if (append && (!cursor || loadingMore)) return;
    if (append) loadingMore = true;
    const id = currentId;
    const token = ++version;
    controller?.abort(); controller = new AbortController();
    const requestController = controller;
    const timeout = setTimeout(() => requestController.abort(new DOMException('Tempo de consulta excedido. Tente novamente.', 'TimeoutError')), 15000);
    $('street-page-status').textContent = append ? 'A carregar mais conteúdos…' : 'A carregar os conteúdos desta rua…';
    $('reload-contributions').hidden = true; $('more-contributions').disabled = true;
    if (!append) { cursor = null; $('more-contributions').hidden = true; $('street-actions').hidden = true; }
    try {
      const response = await fetch(`/api/streets/${id}/contributions${append ? `?cursor=${cursor}` : ''}`, { cache: 'no-store', signal: controller.signal });
      const data = await response.json();
      if (token !== version || id !== currentId) return;
      if (!response.ok) throw new Error(data.error || 'Não foi possível consultar esta rua.');
      streetReady = true;
      $('street-title').textContent = data.street.name;
      $('street-classification').textContent = data.street.potentialPerson ? 'Este arruamento poderá ter o nome de uma pessoa. A associação está por confirmar.' : 'Partilhe o que sabe sobre este arruamento e a sua história.';
      const source = $('street-detail-source'); source.href = `https://www.openstreetmap.org/way/${id}`; source.hidden = false;
      $('street-actions').hidden = false; $('street-content').hidden = false;
      if (!append) $('contributions-list').replaceChildren();
      data.contributions.forEach(item => renderContribution(item));
      $('contributions-empty').hidden = Boolean($('contributions-list').children.length);
      cursor = data.nextCursor; $('more-contributions').hidden = !cursor;
      $('street-page-status').textContent = '';
    } catch (error) {
      if (token !== version || error.name === 'AbortError') return;
      if (!streetReady) $('street-title').textContent = 'Não foi possível carregar a rua';
      $('street-page-status').textContent = navigator.onLine ? error.message : 'Sem ligação. Ligue-se à internet para consultar esta rua.';
      $('reload-contributions').hidden = false;
    } finally { clearTimeout(timeout); if (token === version) { loadingMore = false; $('more-contributions').disabled = false; } }
  }
  function syncEditor() {
    const editing = Boolean(route()?.[2]);
    $('contribution-editor').hidden = !editing || !streetReady;
    $('street-actions').hidden = editing || $('street-content').hidden;
    updateAuth();
  }
  function open(id) {
    const changed = currentId !== id;
    if (changed) {
      currentId = id;
      streetReady = false;
      $('contribution-form').reset(); resetFiles();
      $('photo-status').textContent = $('contribution-status').textContent = '';
      $('street-title').textContent = 'A carregar a rua…';
      $('street-classification').textContent = '';
      $('street-detail-source').hidden = $('street-content').hidden = true;
      $('contributions-list').replaceChildren();
    }
    if (changed || !shown) load().then(() => { if (currentId === id && route()) syncEditor(); });
    shown = true;
    $('add-contribution').href = `${streetHash(id)}/recolher`;
    $('cancel-contribution').href = streetHash(id);
    syncEditor();
    (route()?.[2] ? $('contribution-title') : $('street-title')).focus();
  }
  for (const [button, input] of [['take-photo', 'camera-photo'], ['choose-photos', 'device-photos']]) {
    $(button).addEventListener('click', () => { if (!publishing) $(input).click(); });
    $(input).addEventListener('change', () => {
      if (publishing) return;
      const errors = [];
      for (const file of $(input).files) {
        if (files.length >= 4) { errors.push('Pode juntar até 4 fotografias.'); break; }
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { errors.push('Escolha fotografias JPEG, PNG ou WebP.'); continue; }
        if (file.size > 8 * 1024 * 1024) { errors.push('Cada fotografia pode ter até 8 MB.'); continue; }
        files.push({ file, preview: URL.createObjectURL(file) });
      }
      $(input).value = ''; $('photo-status').textContent = [...new Set(errors)].join(' '); renderFiles();
    });
  }
  $('contribution-signin').addEventListener('click', onRequireAuth);
  $('reload-contributions').addEventListener('click', () => load().then(syncEditor));
  $('more-contributions').addEventListener('click', () => load(true));
  $('contribution-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (publishing || !user) return;
    const text = $('contribution-text').value.trim();
    if (!text && !files.length) { $('contribution-status').textContent = 'Escreva um texto ou junte pelo menos uma fotografia.'; return; }
    const id = currentId;
    const body = new FormData(); body.append('text', text); files.forEach(({ file }) => body.append('photos', file));
    publishing = true; $('contribution-editor').setAttribute('aria-busy', 'true');
    for (const control of $('contribution-form').elements) control.disabled = true;
    $('contribution-status').textContent = 'A publicar. Aguarde até o envio terminar…';
    try {
      const response = await fetch(`/api/streets/${id}/contributions`, { method: 'POST', body, signal: AbortSignal.timeout(120000) });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) { onSessionExpired(); $('contribution-login-note').textContent = 'A sua sessão terminou. Inicie sessão para publicar. O texto e as fotografias selecionadas continuam neste formulário.'; }
        throw new Error(data.error || 'Não foi possível publicar.');
      }
      if (id !== currentId) return;
      // A listing started before publication must not erase the new contribution.
      controller?.abort(); version++; loadingMore = false; $('more-contributions').disabled = false;
      $('contribution-form').reset(); resetFiles(); $('photo-status').textContent = '';
      renderContribution(data.contribution, true); $('contributions-empty').hidden = true;
      $('contribution-status').textContent = '';
      location.hash = streetHash(id); $('street-page-status').textContent = 'Publicado. O seu contributo já está disponível para todos nesta rua.';
    } catch (error) {
      if (id === currentId) $('contribution-status').textContent = error.message === 'Failed to fetch' || error.name === 'TimeoutError' ? 'Não foi possível confirmar a publicação. A ligação foi interrompida ou demorou demasiado. Consulte os conteúdos da rua antes de voltar a enviar.' : error.message;
    } finally {
      publishing = false; $('contribution-editor').removeAttribute('aria-busy');
      for (const control of $('contribution-form').elements) control.disabled = false;
    }
  });
  return { open, setUser(value) { user = value; authReady = true; updateAuth(); }, close() { shown = false; controller?.abort(); version++; loadingMore = false; } };
}
