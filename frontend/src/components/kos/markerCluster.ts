import L from 'leaflet';

// leaflet.markercluster 1.5.3 reads a global `L` while it evaluates. A static import would hoist above any
// assignment here, so the plugin is loaded with a top-level dynamic import, after the global exists. Only
// LeafletMap (and so only the lazy Search chunk) imports this module.
(window as unknown as { L?: typeof L }).L ??= L;
await import('leaflet.markercluster');

export { L };
