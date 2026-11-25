import { createElementObject, createPathComponent, extendContext } from '@react-leaflet/core';
import type { LayerProps } from '@react-leaflet/core';
import type { ReactNode } from 'react';
import { L } from './markerCluster';
// Animations only. MarkerCluster.Default.css (the blue/green/orange circles) is deliberately not imported.
import 'leaflet.markercluster/dist/MarkerCluster.css';

interface ClusteredMarkersProps extends LayerProps {
  children?: ReactNode;
}

const clusterIcon = (cluster: L.MarkerCluster): L.DivIcon => {
  const count = cluster.getChildCount();
  const label = `${count} kos di area ini, perbesar peta`;
  return L.divIcon({
    className: 'kobo-price-marker-wrapper',
    html: `<div class="kobo-price-pin map-cluster" role="button" aria-label="${label}" title="${label}">${count} kos</div>`,
    iconSize: [76, 28],
    iconAnchor: [38, 14],
  });
};

/** A layer container: the react-leaflet `<Marker>` children are added to one L.MarkerClusterGroup. */
export const ClusteredMarkers = createPathComponent<L.MarkerClusterGroup, ClusteredMarkersProps>(
  function createClusteredMarkers({ children: _children, ...options }, context) {
    const group = L.markerClusterGroup({
      ...options,
      maxClusterRadius: 56,
      disableClusteringAtZoom: 15,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      zoomToBoundsOnClick: true,
      chunkedLoading: true,
      iconCreateFunction: clusterIcon,
    });
    return createElementObject(group, extendContext(context, { layerContainer: group }));
  },
);
