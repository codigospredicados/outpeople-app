const COLLECTIONS = new Set(['distritos', 'municipios', 'freguesias']);
const SOURCE = 'https://ogcapi.dgterritorio.gov.pt/collections';
const MAX_TILE_BYTES = 2 * 1024 * 1024;
const CACHE_BYTES = 16 * 1024 * 1024;
const TTL = 60 * 60 * 1000;

export class BoundaryTileError extends Error {
  constructor(message, status = 502, code = 'BOUNDARY_UPSTREAM_ERROR') { super(message); this.status = status; this.code = code; }
}
const abortError = () => new DOMException('Pedido cancelado.', 'AbortError');

export function validTile(collection, z, x, y) {
  if (!COLLECTIONS.has(collection) || ![z, x, y].every(value => /^\d+$/.test(String(value)))) return false;
  return Number(z) <= 14 && Number(x) < 2 ** Number(z) && Number(y) < 2 ** Number(z);
}

export function createBoundaryTiles({ request = fetch, now = Date.now, timeoutMs = 25000 } = {}) {
  const cache = new Map();
  const pending = new Map();
  const waiting = [];
  let active = 0;
  let bytes = 0;
  async function acquire(signal) {
    if (signal.aborted) throw abortError();
    if (active < 4) { active++; return; }
    if (waiting.length >= 64) throw new BoundaryTileError('Serviço de limites ocupado. Tente novamente.', 503, 'BOUNDARY_BUSY');
    await new Promise((resolve, reject) => {
      const waiter = { grant: () => { signal.removeEventListener('abort', cancel); resolve(); } };
      function cancel() {
        const index = waiting.indexOf(waiter);
        if (index !== -1) waiting.splice(index, 1);
        signal.removeEventListener('abort', cancel);
        reject(abortError());
      }
      waiting.push(waiter);
      signal.addEventListener('abort', cancel, { once: true });
    });
  }
  function release() {
    const next = waiting.shift();
    if (next) next.grant(); else active--;
  }
  function remove(key) { bytes -= cache.get(key).body.length; cache.delete(key); }
  function consume(job, signal) {
    job.consumers++;
    return new Promise((resolve, reject) => {
      let settled = false;
      function finish(callback, value) {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', cancel);
        job.consumers--;
        if (!job.consumers && !job.done) job.controller.abort();
        callback(value);
      }
      const cancel = () => finish(reject, abortError());
      job.promise.then(body => finish(resolve, body), error => finish(reject, error));
      if (signal?.aborted) cancel();
      else signal?.addEventListener('abort', cancel, { once: true });
    });
  }
  return {
    async get(collection, z, x, y, { signal } = {}) {
      if (!validTile(collection, z, x, y)) throw new BoundaryTileError('Mosaico administrativo inválido.', 400, 'BOUNDARY_INVALID_TILE');
      if (signal?.aborted) throw abortError();
      const key = `${collection}/${Number(z)}/${Number(x)}/${Number(y)}`;
      const cached = cache.get(key);
      if (cached?.expires > now()) return cached.body;
      if (cached) remove(key);
      const existing = pending.get(key);
      if (existing && !existing.controller.signal.aborted) return consume(existing, signal);
      const job = { controller: new AbortController(), consumers: 0, done: false, promise: null };
      job.promise = Promise.resolve().then(async () => {
        await acquire(job.controller.signal);
        try {
          if (job.controller.signal.aborted) throw abortError();
          const url = `${SOURCE}/${collection}/tiles/WebMercatorQuad/${Number(z)}/${Number(y)}/${Number(x)}?f=mvt`;
          const response = await request(url, {
            signal: AbortSignal.any([job.controller.signal, AbortSignal.timeout(timeoutMs)]),
            headers: { Accept: 'application/vnd.mapbox-vector-tile', 'User-Agent': 'OurPeople/0.1 administrative-map' }
          });
          if (!response.ok) throw new BoundaryTileError('Não foi possível carregar os limites administrativos.', 502, `BOUNDARY_UPSTREAM_HTTP_${response.status}`);
          const type = response.headers.get('content-type') || '';
          if (response.status !== 204 && !/protobuf|mapbox-vector-tile|octet-stream/i.test(type)) throw new BoundaryTileError('Resposta inválida do serviço de limites.', 502, 'BOUNDARY_INVALID_RESPONSE');
          const chunks = [];
          let size = 0;
          if (response.body) for await (const chunk of response.body) {
            size += chunk.length;
            if (size > MAX_TILE_BYTES) throw new BoundaryTileError('O mosaico excede o tamanho permitido.', 502, 'BOUNDARY_TILE_TOO_LARGE');
            chunks.push(chunk);
          }
          const body = Buffer.concat(chunks);
          while (cache.size >= 128 || bytes + body.length > CACHE_BYTES) remove(cache.keys().next().value);
          cache.set(key, { body, expires: now() + TTL }); bytes += body.length;
          return body;
        } catch (error) {
          if (job.controller.signal.aborted) throw abortError();
          if (error instanceof BoundaryTileError) throw error;
          throw new BoundaryTileError('O serviço de limites está temporariamente indisponível.', 502, error.name === 'TimeoutError' ? 'BOUNDARY_UPSTREAM_TIMEOUT' : 'BOUNDARY_UPSTREAM_NETWORK');
        } finally { release(); }
      }).finally(() => {
        job.done = true;
        if (pending.get(key) === job) pending.delete(key);
      });
      pending.set(key, job);
      return consume(job, signal);
    }
  };
}
