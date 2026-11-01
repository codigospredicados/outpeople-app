import * as Leaflet from '/app/vendor/leaflet/leaflet-src.esm.js';

// VectorGrid extends Leaflet's classic browser API. Keep one shared, mutable
// namespace, while retaining the same Leaflet classes used by ES modules.
const L = { ...Leaflet };
window.L = L;
export default L;
