import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createFrontendApp } from '../server.js';

const component = 'app';
async function listen(server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
function close(server) {
  return new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
test('repository serves its own public assets and never exposes server or Git files', async t => {
  const server = http.createServer(createFrontendApp({ env: {} }));
  const origin = await listen(server); t.after(() => close(server));
  for (const asset of ["","app.js","styles.css","map.js","map-selection.js","map.css","street-alerts.js","street-page.js","street.css","leaflet.js","administrative-layers.js","sw.js","icon-192.png","manifest.webmanifest","vendor/leaflet/leaflet-src.esm.js","vendor/leaflet/leaflet.css","vendor/vectorgrid/Leaflet.VectorGrid.bundled.min.js"]) {
    const response = await fetch(`${origin}/${component}/${asset}`);
    assert.equal(response.status, 200, asset);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  }
  assert.equal((await fetch(`${origin}/health`)).status, 200);
  const root = await fetch(origin, { redirect: 'manual' });
  assert.equal(root.headers.get('location'), `/${component}/`);
  for (const file of ['.env', '.git/config', 'server.js', 'package.json', 'test/server.test.js']) {
    assert.equal((await fetch(`${origin}/${component}/${file}`)).status, 404, file);
  }
});
test('proxy preserves API body, query, cookies and redirects and replaces spoofed forwarded headers', async t => {
  const upstream = http.createServer(async (req, res) => {
    if (req.url === '/api/redirect') {
      res.writeHead(302, { Location: 'https://example.pt/app/' }); res.end(); return;
    }
    let body = ''; for await (const chunk of req) body += chunk;
    res.writeHead(201, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': ['session=one; HttpOnly; SameSite=Lax', 'oauth=two; HttpOnly; SameSite=Lax'] });
    res.end(JSON.stringify({ url: req.url, body, origin: req.headers.origin, cookie: req.headers.cookie, forwarded: req.headers['x-forwarded-for'] }));
  });
  const apiUrl = await listen(upstream); t.after(() => close(upstream));
  const server = http.createServer(createFrontendApp({ env: { API_URL: apiUrl } }));
  const origin = await listen(server); t.after(() => close(server));
  const response = await fetch(`${origin}/api/echo?value=1`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: 'session=test', 'X-Forwarded-For': 'spoofed' }, body: '{"name":"Teste"}'
  });
  assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.getSetCookie().length, 2);
  const data = await response.json();
  assert.equal(data.url, '/api/echo?value=1'); assert.equal(data.body, '{"name":"Teste"}');
  assert.equal(data.origin, origin); assert.equal(data.cookie, 'session=test');
  assert.equal(data.forwarded, '127.0.0.1');
  const redirect = await fetch(`${origin}/api/redirect`, { redirect: 'manual' });
  assert.equal(redirect.status, 302); assert.equal(redirect.headers.get('location'), 'https://example.pt/app/');
});
test('invalid configuration fails at startup and an unavailable API returns a safe error', async t => {
  assert.throws(() => createFrontendApp({ env: { API_URL: 'file:///tmp' } }), /API_URL/);
  assert.throws(() => createFrontendApp({ env: { API_URL: 'http://localhost/api' } }), /API_URL/);
  assert.throws(() => createFrontendApp({ env: { NODE_ENV: 'production' } }), /API_URL/);
  const server = http.createServer(createFrontendApp({ env: { API_URL: 'http://127.0.0.1:1' } }));
  const origin = await listen(server); t.after(() => close(server));
  const response = await fetch(`${origin}/api/health`);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'Não foi possível ligar à API. Tente novamente.' });
});
