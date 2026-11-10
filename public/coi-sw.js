// Static hosts such as GitHub Pages cannot set response headers. This worker adds the two headers
// that make the page cross-origin isolated, which SharedArrayBuffer (WASM threads) requires.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  const { request } = event
  // Cross-origin requests (the model downloads) already pass with CORS and need no rewriting.
  if (new URL(request.url).origin !== self.location.origin) return
  event.respondWith(
    fetch(request).then((response) => {
      const headers = new Headers(response.headers)
      headers.set('Cross-Origin-Opener-Policy', 'same-origin')
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }),
  )
})
