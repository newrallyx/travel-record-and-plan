declare module 'leaflet' {
  const L: any
  export default L
  export type DivIcon = any
  export type LatLngExpression = any
}

declare module 'react-leaflet' {
  import type { ComponentType } from 'react'

  export const MapContainer: ComponentType<any>
  export const Marker: ComponentType<any>
  export const Popup: ComponentType<any>
  export const Polyline: ComponentType<any>
  export const TileLayer: ComponentType<any>
  export function useMap(): any
}
