// As defesas que não cabem em nenhuma rota específica porque valem para TODAS:
// os cabeçalhos que o navegador obedece, a política de conteúdo, a exigência de
// HTTPS e as duas perguntas que separam uma requisição vinda da nossa tela de
// uma vinda de qualquer outro site.
//
// Módulo PURO de propósito: nada aqui importa `next/server`, banco ou
// `next/headers`. É o que permite testar a política de conteúdo e a checagem de
// origem sob `node --test`, sem servidor — as duas coisas cuja falha é silenciosa
// (um CSP errado não quebra teste nenhum, só deixa de proteger).

/**
 * Fontes de imagem: `https:` inteiro, e não uma lista.
 *
 * Não é preguiça. `users.avatar_url` e `trips.capa_url` aceitam QUALQUER link —
 * é o que o README chama de "avatars are still URLs" — e o mapa carrega ladrilhos
 * do tile.openstreetmap.org. Uma lista fechada aqui quebraria a foto de perfil de
 * quem usou outro host, e imagem não executa código: o risco que `img-src` reduz
 * é vazamento de referer, não XSS.
 */
const IMAGENS = "'self' data: blob: https:"

/**
 * Conexões de rede do navegador. `'self'` cobre todo o /api/*; o Open-Meteo é a
 * única chamada a terceiro que sai do CLIENTE (lib/clima.ts, sem chave).
 *
 * A Anthropic NÃO entra nesta lista, e é bom que não entre: se um dia uma chamada
 * ao modelo aparecer aqui, é porque a chave foi para o navegador.
 */
const CONEXOES = "'self' https://api.open-meteo.com"

/**
 * A política de conteúdo, com nonce por requisição.
 *
 * `script-src` é a linha que importa: `'strict-dynamic'` faz o navegador confiar
 * apenas nos scripts que o script com nonce carregar, o que derruba a lista de
 * hosts como vetor. Um `<script>` injetado no HTML por qualquer caminho não tem
 * o nonce — e o nonce muda a cada requisição, então não dá para adivinhar.
 *
 * `style-src` fica com `'unsafe-inline'`, e isso é uma escolha, não um descuido:
 * o app tem ~170 atributos `style={{…}}` (posição de ladrilho do mapa, altura de
 * barra, cor derivada da viagem) e nonce NÃO vale para atributo `style` — só para
 * `<style>`. Tirar o `'unsafe-inline'` sem reescrever essas 170 posições em
 * classes não deixaria a página mais segura, deixaria o mapa sem ladrilho.
 *
 * `object-src` precisa de `blob:` porque a pré-visualização do cofre abre o PDF
 * em `<object data={blob}>` — o arquivo já veio pela nossa rota, autorizado.
 *
 * Em desenvolvimento entra `'unsafe-eval'`: o React usa `eval` para remontar a
 * pilha do servidor no navegador. Em produção nem React nem Next usam.
 */
export function politicaCsp(nonce: string, dev = false): string {
  const script = dev
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`

  return [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${IMAGENS}`,
    "font-src 'self' data:",
    `connect-src ${CONEXOES}`,
    // O cofre abre PDF em <object>; o resto de plugin continua barrado.
    "object-src 'self' blob:",
    "media-src 'self' blob:",
    "worker-src 'self'",
    "manifest-src 'self'",
    // Sem isto, um <base href="https://mal.com/"> injetado reescreveria todo
    // caminho relativo da página — inclusive o destino dos formulários.
    "base-uri 'self'",
    "form-action 'self'",
    // Clickjacking: ninguém embute esta aplicação. Vale mais que X-Frame-Options
    // (que não entende hierarquia de iframe), e os dois vão juntos por causa de
    // navegador antigo.
    "frame-ancestors 'none'",
    "frame-src 'none'",
    // Em desenvolvimento é http://localhost e a diretiva quebraria tudo.
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ')
}

/**
 * Os cabeçalhos que não dependem da requisição. Vão no next.config.ts, e por isso
 * alcançam TAMBÉM o /api/* — que o proxy não cobre.
 *
 * `Strict-Transport-Security` só em produção: em localhost ele ensinaria o
 * navegador a recusar http://localhost:3000 por dois anos, e limpar isso exige
 * mexer no chrome://net-internals. Um ano, com subdomínios e `preload`.
 */
export function cabecalhosEstaticos(producao: boolean): { key: string; value: string }[] {
  const base = [
    // O navegador para de adivinhar o tipo do conteúdo. Sem isto, um arquivo do
    // cofre servido como `text/plain` pode ser tratado como HTML e executar.
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    // A URL de uma viagem tem o id dela. Ela não acompanha o clique num link
    // externo — e o app está cheio de links para mapa e site de hotel.
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // Nada disto é usado. Câmera e microfone ficam explícitos porque o ditado do
    // guia usa a Web Speech API, que NÃO passa por esta permissão (é
    // reconhecimento do sistema, não `getUserMedia`) — declarar `microphone=()`
    // não quebra a voz e fecha a porta para qualquer script que tente gravar.
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()',
    },
    // Isola a janela: uma aba aberta por esta origem não consegue mexer no
    // `window` da outra, nem ler `window.opener`.
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    // Recurso desta origem não é embutido por outra sem CORS explícito.
    { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    // Não indexar: uma viagem não é conteúdo público, e o /login menos ainda.
    { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  ]

  if (!producao) return base
  return [
    ...base,
    {
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000; includeSubDomains; preload',
    },
  ]
}

/** Nomes que nunca têm certificado e por isso nunca são redirecionados. */
const LOCAIS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'])

/**
 * `tripgo.app:443` → `tripgo.app`, `[::1]:3000` → `[::1]`.
 *
 * O IPv6 entre colchetes é a razão de isto ser uma função e não um `split(':')`:
 * `[::1]` cortado no primeiro dois-pontos vira `[`, e o endereço local mais
 * comum em máquina moderna deixaria de ser reconhecido como local.
 */
function anfitriaoSemPorta(host: string | null | undefined): string {
  const bruto = (host ?? '').split(',')[0]?.trim().toLowerCase() ?? ''
  if (bruto.startsWith('[')) {
    const fim = bruto.indexOf(']')
    return fim === -1 ? bruto : bruto.slice(0, fim + 1)
  }
  return bruto.split(':')[0] ?? ''
}

/**
 * A requisição chegou em texto puro e precisa virar HTTPS?
 *
 * Na Vercel o TLS termina na borda e o handler sempre vê http na conexão, então
 * quem sabe a verdade é `x-forwarded-proto`. Só em produção: em desenvolvimento é
 * http de propósito.
 *
 * DUAS ARMADILHAS, e as duas custaram a forma desta função.
 *
 * 1. Cabeçalho AUSENTE é tratado como já seguro. É o caso do `next start` atrás
 *    de um proxy que não anuncia nada, e um laço de redirecionamento infinito
 *    seria o app fora do ar — pior do que a requisição que o HSTS resolve na
 *    segunda visita. (O próprio Next preenche este cabeçalho a partir da conexão
 *    quando ninguém o mandou, então na prática o caso raro é este; a guarda fica
 *    porque a função não deve depender desse detalhe.)
 *
 * 2. HOST LOCAL nunca redireciona, nem em produção. Quem sobe `NODE_ENV=production`
 *    na própria máquina para conferir um build recebia 308 para
 *    `https://localhost`, que não tem certificado nem servidor — o app parecia
 *    quebrado justamente na hora de verificar se estava certo.
 */
export function precisaHttps(
  proto: string | null,
  producao: boolean,
  host?: string | null,
): boolean {
  if (!producao || !proto) return false
  if (proto.split(',')[0]?.trim().toLowerCase() !== 'http') return false

  return !LOCAIS.has(anfitriaoSemPorta(host))
}

/**
 * A requisição saiu de uma página NOSSA?
 *
 * Esta é a defesa contra CSRF, e ela existe porque o cookie é `SameSite=Lax`:
 * Lax já barra o POST de outro site, mas depende inteiramente do navegador
 * respeitá-lo, e ele não cobre o GET com efeito. Conferir a origem no servidor é
 * a mesma regra aplicada de novo, do lado que a gente controla — o mesmo motivo
 * de `papelAlcanca` ser reconferido no servidor mesmo com `posso()` na tela.
 *
 * Duas fontes, nesta ordem:
 *
 * 1. `Sec-Fetch-Site`, que o navegador escreve e nenhum JavaScript de página
 *    consegue forjar. `same-origin` passa. `none` é a barra de endereços (ou o
 *    service worker reencaminhando) e também passa — não há site atacante nesse
 *    caso.
 * 2. `Origin`, comparado com o `Host` de quem recebeu. É o caminho do navegador
 *    velho que não manda Sec-Fetch-Site.
 *
 * Sem nenhum dos dois a requisição é RECUSADA quando muda estado. Não é o
 * navegador de ninguém: todo navegador em uso manda `Origin` em POST. É curl,
 * script e bot — o que o item "bot protection" pede, resolvido pelo que já
 * distingue nossa tela do resto, em vez de por um quebra-cabeça na tela de quem
 * está de boa-fé.
 */
export function mesmaOrigem(cabecalhos: {
  origin?: string | null
  host?: string | null
  secFetchSite?: string | null
  forwardedHost?: string | null
}): boolean {
  const sec = cabecalhos.secFetchSite?.trim().toLowerCase()
  if (sec) return sec === 'same-origin' || sec === 'none'

  const origem = cabecalhos.origin?.trim()
  if (!origem) return false

  // O host que o cliente enxerga é o do proxy, não o interno. `x-forwarded-host`
  // vem primeiro porque é ele que casa com o Origin que o navegador escreveu.
  const host = (cabecalhos.forwardedHost ?? cabecalhos.host ?? '').split(',')[0]?.trim()
  if (!host) return false

  try {
    return new URL(origem).host.toLowerCase() === host.toLowerCase()
  } catch {
    // Origin malformado ou a string literal "null" (sandbox de iframe): recusa.
    return false
  }
}

/** Métodos que mudam estado. GET e HEAD ficam de fora — eles não gravam nada. */
const METODOS_ESCRITA = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function mudaEstado(metodo: string): boolean {
  return METODOS_ESCRITA.has(metodo.toUpperCase())
}

/**
 * O campo-armadilha do cadastro.
 *
 * Um `<input>` escondido, com nome plausível, que pessoa nenhuma vê e que robô de
 * formulário preenche por preencher. Vazio (ou ausente) é gente; preenchido é
 * robô.
 *
 * Vale o que vale: derruba o robô genérico, não quem escreveu um script para
 * ESTE app. A defesa que segura o segundo é o limite por origem em
 * lib/session.ts, e as duas juntas custam uma linha de HTML.
 */
export const CAMPO_ARMADILHA = 'site_pessoal'

export function pareceRobo(valor: unknown): boolean {
  return typeof valor === 'string' && valor.trim() !== ''
}
