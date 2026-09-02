// As defesas que não cabem em nenhuma rota específica porque valem para TODAS:
// os cabeçalhos que o navegador obedece, a política de conteúdo, a exigência de
// HTTPS, o que pode virar um `href`, e as perguntas que separam uma requisição
// vinda da nossa tela de uma vinda de qualquer outro site.
//
// Módulo PURO de propósito: nada aqui importa `next/server`, banco ou
// `next/headers`. É o que permite testar a política de conteúdo e a checagem de
// origem sob `node --test`, sem servidor — as duas coisas cuja falha é silenciosa
// (um CSP errado não quebra teste nenhum, só deixa de proteger).

/**
 * Fontes de imagem: `https:` inteiro, e não uma lista.
 *
 * Não é preguiça. `users.avatar_url` e `trips.capa_url` aceitam QUALQUER link, e
 * o mapa carrega ladrilhos do tile.openstreetmap.org. Uma lista fechada aqui
 * quebraria a foto de perfil de quem usou outro host, e imagem não executa
 * código: o risco que `img-src` reduz é vazamento de referer, não XSS.
 */
const IMAGENS = "'self' data: blob: https:"

/**
 * Conexões de rede do navegador. `'self'` cobre todo o /api/*, mais os DOIS
 * serviços que o CLIENTE consulta direto, de propósito, porque não são dado do
 * servidor e não entram no snapshot nem no cache offline:
 *
 *   - `api.open-meteo.com`  — o clima (lib/clima.ts)
 *   - `nominatim.openstreetmap.org` — a busca de coordenada (lib/localizar.ts)
 *
 * O segundo é fácil de esquecer e a falha dele é MUDA: sem esta entrada, a busca
 * de lugar por nome simplesmente não devolve nada, o que é indistinguível de
 * "não achei". Serviço novo consultado do navegador entra aqui, ou some sem aviso.
 *
 * A Anthropic NÃO entra nesta lista, e é bom que não entre: se um dia uma chamada
 * ao modelo aparecer aqui, é porque a chave foi para o navegador.
 */
const CONEXOES = "'self' https://api.open-meteo.com https://nominatim.openstreetmap.org"

/** O host do desafio, quando o captcha está ligado. Ver `turnstileConfigurado`. */
const HOST_CAPTCHA = 'https://challenges.cloudflare.com'

/**
 * A política de conteúdo, com nonce por requisição.
 *
 * `script-src` é a linha que importa: `'strict-dynamic'` faz o navegador confiar
 * apenas nos scripts que o script com nonce carregar, o que derruba a lista de
 * hosts como vetor. Um `<script>` injetado no HTML por qualquer caminho não tem
 * o nonce — e o nonce muda a cada requisição, então não dá para adivinhar. É por
 * isso que o Turnstile NÃO precisa aparecer em `script-src`: ele é carregado por
 * `document.createElement` a partir de um script que já tem nonce, e o
 * `'strict-dynamic'` herda a confiança. Em `connect-src` e `frame-src` ele
 * precisa, porque essas duas diretivas não seguem a cadeia.
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
 *
 * ESTA FUNÇÃO RODA A CADA REQUISIÇÃO, no proxy.ts, e é isso que torna as partes
 * condicionais seguras. A tentação de montar o CSP no `next.config.ts` custou uma
 * armadilha inteira: o Next SERIALIZA o resultado de `headers()` em
 * `routes-manifest.json` durante o BUILD, então lá uma condicional passa a
 * depender do ambiente do build, não do request — ligar o captcha no painel e
 * redeployar com cache trancaria todo mundo para fora. Aqui não: o env é lido
 * agora, na requisição.
 */
export function politicaCsp(nonce: string, dev = false): string {
  const script = dev
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`

  const captcha = turnstileConfigurado() ? ` ${HOST_CAPTCHA}` : ''

  return [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${IMAGENS}`,
    "font-src 'self' data:",
    `connect-src ${CONEXOES}${captcha}`,
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
    // Nós não embutimos ninguém — exceto o desafio do captcha, que desenha num
    // iframe próprio. Sem esta entrada com o Turnstile ligado, o widget carrega o
    // script e não mostra nada, e a pessoa fica sem conseguir entrar.
    `frame-src ${captcha ? HOST_CAPTCHA : "'none'"}`,
    // Em desenvolvimento é http://localhost e a diretiva quebraria tudo.
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ')
}

/**
 * Os cabeçalhos que não dependem da requisição. Vão no next.config.ts, e por isso
 * alcançam TAMBÉM o /api/* — que o proxy não cobre.
 *
 * `Strict-Transport-Security` só em produção: em localhost ele ensinaria o
 * navegador a recusar http://localhost:3000 por um ano, e limpar isso exige mexer
 * no chrome://net-internals.
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
    // `preload` fica de FORA de propósito: entrar na lista embutida dos
    // navegadores é uma decisão do domínio inteiro, com saída lenta e manual, e
    // não cabe a um commit tomá-la. O `max-age` sozinho já resolve a segunda
    // visita em diante, que é o que protege o cookie de sessão.
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
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
 *    segunda visita.
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
 * respeitá-lo, e o servidor não tem como saber se ele respeitou. Conferir a
 * origem no servidor é a mesma regra aplicada de novo, do lado que a gente
 * controla — o mesmo motivo de `papelAlcanca` ser reconferido no servidor mesmo
 * com `posso()` na tela.
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
 * script e bot — parte do que o item "bot protection" pede, resolvido pelo que já
 * distingue nossa tela do resto.
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

// ---------------------------------------------------------------- links

/** Esquemas que podem virar href. Qualquer outro é descartado, `javascript:` incluso. */
const ESQUEMA_OK = /^(https?:|mailto:|tel:)/i

/**
 * O valor guardado que vira `href`, ou null quando não pode virar.
 *
 * `javascript:` num href é execução de script com a sessão de quem clica. O dado
 * chega aqui vindo do banco, escrito por OUTRO participante da viagem: um editor
 * guarda o "link" e o proprietário clica. O cookie é httpOnly, então não há roubo
 * de sessão — mas o script roda dentro da página, e a página tem o snapshot
 * inteiro, passaporte incluso.
 *
 * Dois campos passam por aqui, e é por isso que a regra mora fora dos dois:
 * `documents.valor` de um documento tipo `link`, e cada linha de `links` de um
 * item do roteiro (`lerLinks` em lib/derive.ts).
 *
 * Sem esquema, assume https: quem digita "maps.google.com" quis um site.
 */
export function hrefSeguro(bruto: string | null | undefined): string | null {
  const url = String(bruto ?? '').trim()
  if (!url) return null
  const completo = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`
  return ESQUEMA_OK.test(completo) ? completo : null
}

// ---------------------------------------------------------------- armadilha

/**
 * O campo-armadilha do cadastro.
 *
 * Um `<input>` escondido, com nome plausível, que pessoa nenhuma vê e que robô de
 * formulário preenche por preencher. Vazio (ou ausente) é gente; preenchido é
 * robô.
 *
 * Vale o que vale: derruba o robô genérico, não quem escreveu um script para
 * ESTE app. As outras duas metades da mesma defesa são a checagem de origem acima
 * (que já barra curl e script) e o Turnstile abaixo (que barra navegador
 * automatizado, o único que passa pelas duas primeiras). As três custam pouco e
 * pegam populações diferentes.
 */
export const CAMPO_ARMADILHA = 'site_pessoal'

export function pareceRobo(valor: unknown): boolean {
  return typeof valor === 'string' && valor.trim() !== ''
}

// ---------------------------------------------------------------- captcha

/**
 * O Turnstile da Cloudflare, e por que ele é opcional.
 *
 * As defesas acima cobrem duas populações: o limite por origem barra volume de um
 * lugar só, e a checagem de origem barra curl e script. Nenhuma das duas barra um
 * navegador automatizado distribuído — ele manda `Sec-Fetch-Site` correto e vem de
 * mil IPs, cinco tentativas cada, sem chegar perto de limite nenhum. É essa a
 * fatia que sobra, e é essa que o captcha pega.
 *
 * Escolhido o Turnstile por dois motivos concretos: não exige dependência nova
 * (um `<script>` e um `fetch`, dentro da regra do projeto) e não manda dado da
 * pessoa para um serviço de anúncio, ao contrário do reCAPTCHA.
 *
 * DESLIGADO até as duas variáveis existirem. Sem elas o app funciona exatamente
 * como antes — importante porque a família usa isto em viagem, e um captcha mal
 * configurado que recusa todo mundo no aeroporto é pior do que captcha nenhum.
 * A chave de site é pública por desenho (ela aparece no HTML); a secreta nunca
 * sai do servidor.
 */
export function turnstileConfigurado(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)
}

/** Resposta do `siteverify`. Só `success` importa; o resto é diagnóstico. */
type RespostaTurnstile = { success?: boolean; 'error-codes'?: string[] }

/**
 * Confere o token com a Cloudflare. Devolve true quando o captcha não está
 * ligado — o app inteiro tem que continuar de pé sem ele.
 *
 * Falha de REDE derruba a tentativa (`false`), ao contrário do rate limit, que
 * cai para o balde local. A diferença é de propósito: um limite que degrada ainda
 * limita alguma coisa, mas um captcha que "passa quando não consegue verificar"
 * não é um captcha — é o caminho que um atacante procura primeiro.
 */
export async function verificarTurnstile(token: string | null | undefined, ip?: string) {
  if (!turnstileConfigurado()) return true
  if (!token) return false

  const corpo = new URLSearchParams({
    secret: String(process.env.TURNSTILE_SECRET_KEY),
    response: String(token),
  })
  // O IP é opcional e ajuda a Cloudflare a pontuar; sem proxy confiável,
  // `chaveOrigem` devolve 'desconhecido', que não é endereço nenhum.
  if (ip && ip !== 'desconhecido') corpo.set('remoteip', ip)

  try {
    const r = await fetch(`${HOST_CAPTCHA}/turnstile/v0/siteverify`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: corpo,
      signal: AbortSignal.timeout(5000),
    })
    const d = (await r.json()) as RespostaTurnstile
    return d.success === true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- erro no log

/**
 * O que de um erro pode ir para o log.
 *
 * O driver do Neon (`NeonDbError`) carrega campos do protocolo do Postgres como
 * PROPRIEDADES do erro, e `console.error(e)` imprime todas: o `util.inspect` do
 * Node anexa as proprias enumeraveis depois do stack. Dois deles carregam VALOR,
 * nao so estrutura:
 *
 *   detail        "Key (email)=(ana@exemplo.com) already exists."
 *   internalQuery o SQL interno de uma funcao PL/pgSQL, com os literais dela
 *
 * Medido contra um Postgres real. As unicidades deste schema que passam por ali
 * sao `users.email` e `trips.codigo_convite` -- um endereco de e-mail e um codigo
 * de convite gravados em texto no log de producao, a cada cadastro repetido.
 * `where` traz o contexto PL/pgSQL, que no caso de `registrar_tentativa` inclui a
 * chave do rate limit (um IP ou um id de conta).
 *
 * Fica o que diagnostica e nao identifica ninguem: codigo do erro, tabela, coluna
 * e constraint dizem O QUE quebrou; o valor que quebrou nao acrescenta nada que o
 * `code` ja nao diga, e nao pode ser apagado depois de escrito.
 */
export function paraLog(e: unknown): Record<string, unknown> {
  if (!(e instanceof Error)) return { erro: typeof e }

  const bruto = e as Error & Record<string, unknown>
  const saida: Record<string, unknown> = { nome: e.name, mensagem: e.message, stack: e.stack }

  // Lista fechada, e nunca `...e`: campo novo do driver nasce fora do log, que e
  // o lado certo para errar. `detail`, `hint`, `where` e `internalQuery` ficam de
  // fora por carregarem valor.
  for (const c of ['code', 'table', 'column', 'constraint', 'routine', 'severity']) {
    if (bruto[c] !== undefined) saida[c] = bruto[c]
  }
  return saida
}

/**
 * A mensagem de um erro que pode ser MOSTRADA a quem fez o pedido.
 *
 * A regra e uma so: chega ao usuario o texto que uma pessoa escreveu PARA um
 * usuario. `ErroHttp` e `Error` puro sao nossos e ja vem em pt-BR; qualquer coisa
 * com nome proprio (`NeonDbError`, `TypeError`, `SyntaxError`) veio do driver ou
 * do runtime e vira texto generico.
 *
 * Existe porque `rota()` generaliza o erro de banco com todo cuidado e as duas
 * rotas de lote furavam isso por baixo: elas relatam cada operacao recusada em
 * `rejeitadas[].motivo`, e mandavam `e.message` cru. Medido: uma mensagem do
 * Postgres traz o nome da constraint e o valor ofensivo -- "invalid input syntax
 * for type integer" entrega o tipo da coluna a quem esta mapeando o schema.
 */
export function motivoSeguro(
  e: unknown,
  generico = 'não foi possível gravar; confira os dados',
): string {
  if (!(e instanceof Error)) return generico
  // `name` intacto e o que separa `new Error(...)` escrito aqui de tudo o mais.
  if (e.name !== 'Error') return generico
  if ('code' in e || 'severity' in e) return generico
  return e.message || generico
}
