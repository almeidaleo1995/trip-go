// Service worker da casca do app. Faz UMA coisa: garantir que o app ABRA em modo
// aviao. Os dados ja vivem no IndexedDB, entao aqui nao ha nada de conteudo.
//
// Escrito a mao em vez de next-pwa: sao ~40 linhas e next-pwa nao acompanha o
// App Router de forma confiavel.
const VERSAO = 'v1'
const CACHE = `viagem-casca-${VERSAO}`

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/'])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // /api/** NUNCA e cacheado: a copia offline dos dados e o IndexedDB, que sabe
  // o papel da sessao. Um snapshot de admin em cache HTTP vazaria o Financeiro
  // para o proximo que abrisse o app neste aparelho.
  if (url.pathname.startsWith('/api/')) return

  // Rede primeiro, cache como rede de seguranca.
  e.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp.ok) {
          const copia = resp.clone()
          caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {})
        }
        return resp
      })
      .catch(() => caches.match(req).then((c) => c || caches.match('/')))
  )
})
