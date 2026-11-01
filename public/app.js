import { createStreetPage } from './street-page.js';
const $ = id => document.getElementById(id);
const streetPage = createStreetPage({ onRequireAuth() {
  try { sessionStorage.setItem('street-return', location.hash); } catch {}
  location.hash = '#conta';
}, onSessionExpired() { showUser(null); } });
let mode = 'register';
let busy = false;
const providerNames = { email: 'Email e palavra-passe', google: 'Google', facebook: 'Facebook' };
let mapController;
let mapLoading;

function showView() {
  const account = location.hash === '#conta';
  const street = location.hash.match(/^#rua\/([1-9]\d{0,15})(\/recolher)?$/);
  $('account-view').hidden = !account;
  $('street-view').hidden = !street;
  $('explore-view').hidden = account || Boolean(street);
  mapController?.setVisible(!account && !street);
  if (street) streetPage.open(street[1]);
  else streetPage.close();
  for (const [id, current] of [['nav-account', account], ['nav-explore', !account]]) {
    if (current) $(id).setAttribute('aria-current', 'page');
    else $(id).removeAttribute('aria-current');
  }
  if (!account && !street) {
    mapLoading ??= import('./map.js').then(({ createMap }) => { mapController = createMap(); }).catch(() => {
      $('map-status').textContent = 'Não foi possível iniciar o mapa. Verifique a ligação e atualize a página.';
    });
    mapLoading.then(() => { mapController?.setVisible(!$('explore-view').hidden); mapController?.resize(); });
  }
}
window.addEventListener('hashchange', showView);

async function request(path, body) {
  const response = await fetch(`/api${path}`, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Não foi possível concluir o pedido.'), { fields: data.fields });
  return data;
}
function clearErrors() {
  $('form-status').textContent = '';
  for (const field of ['name', 'email', 'password']) {
    $(`${field}-error`).textContent = '';
    $(field).removeAttribute('aria-invalid');
    $(field).removeAttribute('aria-errormessage');
  }
  $('confirm').removeAttribute('aria-invalid');
}
function showUser(user) {
  streetPage.setUser(user);
  $('auth-panel').hidden = Boolean(user);
  $('account-panel').hidden = !user;
  $('nav-account').textContent = user ? 'A minha conta' : 'Criar conta';
  if (!user) return;
  try {
    const target = sessionStorage.getItem('street-return');
    if (target && /^#rua\/[1-9]\d{0,15}\/recolher$/.test(target) && (location.hash === '#conta' || !location.hash)) { sessionStorage.removeItem('street-return'); location.hash = target; }
  } catch {}
  $('welcome').textContent = `Olá, ${user.name}.`;
  $('account-email').textContent = user.email;
  $('account-provider').textContent = providerNames[user.provider];
  $('auth-form').reset();
}
$('switch-mode').addEventListener('click', () => {
  if (busy) return;
  mode = mode === 'register' ? 'login' : 'register';
  const register = mode === 'register';
  $('name-group').hidden = $('confirm-group').hidden = !register;
  $('name').disabled = $('confirm').disabled = !register;
  $('password').minLength = register ? 12 : 1;
  $('password').autocomplete = register ? 'new-password' : 'current-password';
  $('password-help').hidden = !register;
  $('form-title').textContent = register ? 'Faça parte da história.' : 'Bom tê-lo de volta.';
  $('form-intro').textContent = register ? 'Crie a sua conta OurPeople.' : 'Entre na sua conta OurPeople.';
  $('submit').textContent = register ? 'Criar conta ↗' : 'Iniciar sessão ↗';
  $('switch-text').textContent = register ? 'Já tem conta?' : 'Ainda não tem conta?';
  $('switch-mode').textContent = register ? 'Iniciar sessão' : 'Criar conta';
  clearErrors();
  (register ? $('name') : $('email')).focus();
});
$('toggle-password').addEventListener('click', () => {
  const show = $('password').type === 'password';
  $('password').type = show ? 'text' : 'password';
  $('toggle-password').textContent = show ? 'Ocultar' : 'Mostrar';
  $('toggle-password').setAttribute('aria-label', show ? 'Ocultar palavra-passe' : 'Mostrar palavra-passe');
  $('toggle-password').setAttribute('aria-pressed', String(show));
});
$('auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  clearErrors();
  if (mode === 'register' && $('password').value !== $('confirm').value) {
    $('form-status').textContent = 'As palavras-passe não coincidem.';
    $('confirm').setAttribute('aria-invalid', 'true');
    $('confirm').focus();
    return;
  }
  busy = true;
  $('submit').disabled = $('switch-mode').disabled = true;
  $('submit').textContent = mode === 'register' ? 'A criar conta…' : 'A iniciar sessão…';
  try {
    const { user } = await request(`/auth/${mode}`, { name: $('name').value, email: $('email').value, password: $('password').value });
    showUser(user);
    $('welcome').tabIndex = -1;
    $('welcome').focus();
  } catch (error) {
    $('form-status').textContent = error.message === 'Failed to fetch' ? 'Sem ligação ao servidor. Verifique a sua ligação e tente novamente.' : error.message;
    for (const [field, message] of Object.entries(error.fields || {})) {
      if (!$(`${field}-error`)) continue;
      $(`${field}-error`).textContent = message;
      $(field).setAttribute('aria-invalid', 'true');
      $(field).setAttribute('aria-errormessage', `${field}-error`);
    }
  } finally {
    busy = false;
    $('submit').disabled = $('switch-mode').disabled = false;
    $('submit').textContent = mode === 'register' ? 'Criar conta ↗' : 'Iniciar sessão ↗';
  }
});
$('logout').addEventListener('click', async () => {
  $('logout').disabled = true;
  $('account-status').textContent = '';
  try { await request('/auth/logout', {}); showUser(null); clearErrors(); }
  catch { $('account-status').textContent = 'Não foi possível terminar sessão. Tente novamente.'; }
  finally { $('logout').disabled = false; }
});
for (const id of ['google', 'facebook']) {
  $(id).addEventListener('click', event => { if ($(id).getAttribute('aria-disabled') === 'true') event.preventDefault(); });
}
const messages = {
  cancelled: 'O acesso foi cancelado. Pode tentar novamente ou usar email.',
  missing_email: 'Não foi disponibilizado um email válido. Use o registo por email ou reveja as permissões da sua conta.',
  existing_account: 'Já existe uma conta com este email. Inicie sessão com o método usado no registo.',
  unavailable: 'Este método de acesso ainda não está disponível.',
  failed: 'Não foi possível concluir o acesso. Tente novamente.'
};
const authResult = new URLSearchParams(location.search).get('auth');
if (authResult) { $('form-status').textContent = messages[authResult] || messages.failed; history.replaceState(null, '', '/app/#conta'); }
showView();
await Promise.allSettled([
  request('/auth/me').then(({ user }) => showUser(user)).catch(() => { showUser(null); $('form-status').textContent = 'Não foi possível ligar ao servidor. Tente novamente.'; }),
  request('/auth/providers').then(({ providers }) => {
    for (const { id, enabled } of providers) { $(id).setAttribute('aria-disabled', String(!enabled)); if (!enabled) $(id).setAttribute('title', 'Disponível após configuração do serviço.'); }
    $('providers-note').textContent = providers.some(p => !p.enabled) ? 'Alguns métodos de acesso ainda não estão disponíveis. Pode usar email.' : '';
  }).catch(() => { $('providers-note').textContent = 'Acesso social indisponível. Pode usar email.'; })
]);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/app/sw.js').catch(() => {});
