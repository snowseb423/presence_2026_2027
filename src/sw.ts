/// <reference lib="webworker" />
// Service worker : complété à l'étape PWA.
declare const self: ServiceWorkerGlobalScope
self.addEventListener('install', () => void self.skipWaiting())
export {}
