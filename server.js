import express from 'express';
import helmet from 'helmet';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createBoundaryTiles, BoundaryTileError } from './boundary-tiles.js';

const COMPONENT = 'app';
const DEFAULT_PORT = 3001;
const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
function cleanHeaders(headers) {
  const blocked = new Set([...hopHeaders, ...String(headers.connection || '').split(',').map(value => value.trim().toLowerCase())]);
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !blocked.has(name.toLowerCase())));
}

export function createFrontendApp({ env = process.env, boundaryTiles = createBoundaryTiles() } = {}) {
  const production = env.NODE_ENV === 'production';
  if (production && !env.API_URL) throw new Error('Configure API_URL com a origem do serviço API.');
  const api = new URL(env.API_URL || 'http://localhost:3000');
  if (!['http:', 'https:'].includes(api.protocol) || api.username || api.password || api.pathname !== '/' || api.search || api.hash) throw new Error('API_URL deve indicar uma origem HTTP(S), sem caminho nem credenciais.');
  const app = express();
  app.disable('x-powered-by');
  const hops = Number(env.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(hops) || hops < 0) throw new Error('TRUST_PROXY_HOPS inválido.');
  app.set('trust proxy', hops);
  app.use(helmet({
    strictTransportSecurity: production ? undefined : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    contentSecurityPolicy: { directives: {
      'upgrade-insecure-requests': production ? [] : null,
      'img-src': ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org']
    } }
  }));
  app.get('/health', (req, res) => res.json({ status: 'ok', service: `ourpeople-${COMPONENT}` }));
  app.get('/map-data/:collection/:z/:x/:y.pbf', async (req, res) => {
    const controller = new AbortController();
    const cancel = () => { if (!res.writableFinished) controller.abort(); };
    req.on('aborted', cancel);
    res.on('close', cancel);
    try {
      const { collection, z, x, y } = req.params;
      const body = await boundaryTiles.get(collection, z, x, y, { signal: controller.signal });
      res.set('Cache-Control', 'public, max-age=3600').type('application/vnd.mapbox-vector-tile').send(body);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!(error instanceof BoundaryTileError) || error.status >= 500) console.warn('Falha de limites administrativos:', { layer: req.params.collection, code: error.code || error.name });
      res.status(error instanceof BoundaryTileError ? error.status : 502).set('Cache-Control', 'no-store').json({ error: 'Não foi possível carregar os limites administrativos.' });
    } finally {
      req.removeListener('aborted', cancel);
      res.removeListener('close', cancel);
    }
  });
  // Fixed upstream only. Preserve cookies, Origin, status and redirects without
  // exposing API credentials or requiring cross-site cookies in the browser.
  app.use((req, res, next) => {
    if (req.path !== '/api' && !req.path.startsWith('/api/')) return next();
    const headers = cleanHeaders(req.headers);
    for (const name of Object.keys(headers)) {
      if (name === 'forwarded' || name.startsWith('x-forwarded-')) delete headers[name];
    }
    headers.host = api.host;
    headers['x-forwarded-for'] = req.ip;
    const transport = api.protocol === 'https:' ? https : http;
    const upstream = transport.request(api, { method: req.method, path: req.originalUrl, headers }, response => {
      res.writeHead(response.statusCode || 502, cleanHeaders(response.headers));
      response.on('error', () => res.destroy());
      response.pipe(res);
    });
    upstream.setTimeout(30000, () => upstream.destroy(new Error('timeout')));
    upstream.on('error', () => {
      if (!res.headersSent) res.status(502).set('Cache-Control', 'no-store').json({ error: 'Não foi possível ligar à API. Tente novamente.' });
      else res.destroy();
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
    req.pipe(upstream);
  });
  app.use('/app/vendor/leaflet', express.static(fileURLToPath(new URL('./node_modules/leaflet/dist', import.meta.url))));
  app.use('/app/vendor/vectorgrid', express.static(fileURLToPath(new URL('./node_modules/leaflet.vectorgrid/dist', import.meta.url))));
  app.get('/', (req, res) => res.redirect(`/${COMPONENT}/`));
  app.use(`/${COMPONENT}`, express.static(fileURLToPath(new URL('./public', import.meta.url)), {
    dotfiles: 'deny', setHeaders: res => res.set('Cache-Control', 'no-cache')
  }));
  app.use((req, res) => res.status(404).send('Recurso não encontrado.'));
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const server = createFrontendApp().listen(port, '0.0.0.0', () => console.log(`OurPeople ${COMPONENT}: http://localhost:${port}/${COMPONENT}/`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
