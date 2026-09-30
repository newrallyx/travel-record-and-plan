/// <reference types="vite/client" />

import type { RoadtripDesktopApi } from './types/desktop'

declare global {
  interface Window {
    roadtripDesktop?: RoadtripDesktopApi
  }

  declare const __APP_VERSION__: string
}

export {}
