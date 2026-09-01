// As barreiras que nao pertencem a nenhuma tela: cabecalhos HTTP, esquema de
// link que pode virar href, assinatura de arquivo e conferencia de origem.
//
// Existe como modulo puro de proposito. Cada uma destas regras vale em mais de
// um lugar — o cabecalho vale para o app inteiro e para a resposta de
// /api/documento, o esquema de link vale para o roteiro e para o cofre, a
// assinatura vale para o upload e para o teste — e regra copiada e regra que
// diverge. Nada aqui importa `next/*` nem toca no banco: assim o runner do
// `node --test` exercita tudo sem servidor e sem Postgres.

// ---------------------------------------------------------------- cabecalhos

/**
 * Os cabecalhos de seguranca do app inteiro. Montados aqui e aplicados em
 * `next.config.ts`, que so os repassa.
 *
 * O que cada um resolve, porque cabecalho sem motivo escrito e cabecalho que a
 * proxima pessoa remove por parecer enfeite:
 *
 * - **HSTS**: a Vercel ja serve so HTTPS e redireciona o resto, mas o
 *   redirecionamento acontece DEPOIS de a primeira requisicao sair em claro. O
 *   cabecalho e o que faz o navegador nunca mais tentar http:// neste dominio —
 *   e o cookie de sessao viaja em toda requisicao. `preload` fica de fora: e uma
 *   decisao de dominio, com caminho de saida lento, e nao cabe a um commit.
 * - **nosniff**: sem ele o navegador adivinha o tipo pelo conteudo. Como o cofre
 *   serve arquivo que outra pessoa subiu, adivinhar e exatamente o que nao pode
 *   acontecer.
 * - **frame-ancestors / X-Frame-Options**: nada aqui e para ser embutido em
 *   pagina de terceiro. Impede clickjacking em cima das acoes da viagem.
 * - **Referrer-Policy**: a URL da viagem carrega o id dela. Sem isto, clicar num
 *   "link util" do roteiro entrega esse id ao site de destino.
 * - **Permissions-Policy**: o app nao usa camera, microfone nem geolocalizacao
 *   por API do navegador. Declarar o que nao se usa fecha a porta de antemao.
 */
export const CABECALHOS_SEGURANCA: { key: string; value: string }[] = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Content-Security-Policy', value: politica() },
]

/**
 * A CSP do app.
 *
 * ponytail: `script-src` carrega `'unsafe-inline'`, entao esta politica NAO e
 * uma segunda barreira contra XSS — e o React escapando toda interpolacao que
 * cumpre esse papel, mais `hrefSeguro` nos dois lugares onde um valor guardado
 * vira link. O motivo e que o App Router injeta script inline de bootstrap em
 * toda pagina; tirar o `'unsafe-inline'` exige nonce por requisicao, gerado no
 * `proxy.ts` e repassado ao Next, e isso desliga a otimizacao estatica de todas
 * as paginas. O caminho de subida esta documentado no README.
 *
 * O que ela FECHA de verdade, e nao e pouco:
 *
 * - `connect-src 'self'`: script injetado nao consegue mandar o snapshot da
 *   viagem — passaporte incluso — para servidor de fora. E a linha que mais
 *   importa num app que guarda documento.
 * - `base-uri 'none'` e `form-action 'self'`: fecham o desvio de URL relativa e
 *   o envio de formulario para dominio de terceiro.
 * - `frame-ancestors 'none'`: clickjacking, junto com o X-Frame-Options acima.
 * - `object-src`/`img-src` com `blob:`: o preview do cofre monta um `blob:` do
 *   arquivo baixado (`<object data=...>` para PDF, `<img>` para foto). Sem
 *   `blob:` o cofre nao abre nada; com `blob:` e SO ele, nao `data:` para script.
 */
function politica(): string {
  const desenvolvimento = process.env.NODE_ENV !== 'production'
  return [
    "default-src 'self'",
    // `unsafe-eval` so em desenvolvimento: o refresh rapido do Next precisa dele.
    `script-src 'self' 'unsafe-inline'${desenvolvimento ? " 'unsafe-eval'" : ''}`,
    // Tailwind v4 e os tokens de `config/theme.ts` entram como estilo inline.
    "style-src 'self' 'unsafe-inline'",
    // `data:` cobre o icone SVG embutido, `blob:` o preview do cofre, e `https:`
    // os ladrilhos do mapa (`tile.openstreetmap.org`) mais qualquer `capa_url`
    // ou `avatar_url` que a pessoa aponte para uma imagem na internet. Imagem e
    // o unico tipo onde o curinga e aceitavel: ela nao executa, e a alternativa
    // seria proibir a pessoa de usar a propria foto.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // O cofre embute PDF por `<object>`, e a fonte e sempre um blob local.
    "object-src 'self' blob:",
    "media-src 'self' blob:",
    // A saida de rede do cliente: /api/* deste dominio, mais os DOIS servicos
    // que o app consulta do navegador de proposito, porque nao sao dado do
    // servidor e nao entram no snapshot nem no cache offline — o clima
    // (`lib/clima.ts`) e a busca de coordenada (`lib/localizar.ts`). Nomeados um
    // a um, e nao um `https:` solto: e justamente esta linha que impede script
    // injetado de mandar o snapshot da viagem, passaporte incluso, para fora.
    // Um servico novo consultado do cliente entra aqui, ou falha calado.
    "connect-src 'self' https://api.open-meteo.com https://nominatim.openstreetmap.org",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ')
}

// ---------------------------------------------------------------- links

/** Esquemas que podem virar href. Qualquer outro e descartado, `javascript:` incluso. */
const ESQUEMA_OK = /^(https?:|mailto:|tel:)/i

/**
 * O valor guardado que vira `href`, ou null quando nao pode virar.
 *
 * `javascript:` num href e execucao de script com a sessao de quem clica. O dado
 * chega aqui vindo do banco, escrito por outro participante da viagem: um editor
 * guarda o "link" e o proprietario clica. O cookie e httpOnly, entao nao ha roubo
 * de sessao — mas o script roda dentro da pagina, e a pagina tem o snapshot
 * inteiro, passaporte incluso.
 *
 * Sem esquema, assume https: quem digita "maps.google.com" quis um site.
 */
export function hrefSeguro(bruto: string | null | undefined): string | null {
  const url = String(bruto ?? '').trim()
  if (!url) return null
  const completo = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`
  return ESQUEMA_OK.test(completo) ? completo : null
}

// ---------------------------------------------------------------- arquivos

/**
 * Os primeiros bytes de cada formato que o cofre aceita.
 *
 * `arquivo.type` do FormData e o que o NAVEGADOR declarou, e quem envia escolhe
 * o que declarar: um `.html` anunciado como `application/pdf` passava pela lista
 * de MIMEs e voltava do GET com `Content-Type: application/pdf`. Isso e um
 * arquivo hostil servido do proprio dominio para os outros viajantes.
 *
 * A defesa e conferir o conteudo, nao o rotulo. WEBP tem duas partes ("RIFF" no
 * inicio e "WEBP" no byte 8), entao a tabela guarda deslocamento junto.
 */
const ASSINATURAS: Record<string, { deslocamento: number; bytes: number[] }[]> = {
  // %PDF
  'application/pdf': [{ deslocamento: 0, bytes: [0x25, 0x50, 0x44, 0x46] }],
  // JFIF/EXIF: todo JPEG comeca com FF D8 FF.
  'image/jpeg': [{ deslocamento: 0, bytes: [0xff, 0xd8, 0xff] }],
  // \x89PNG\r\n\x1a\n
  'image/png': [{ deslocamento: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  // RIFF....WEBP
  'image/webp': [
    { deslocamento: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
    { deslocamento: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  ],
}

/**
 * O conteudo confere com o MIME declarado?
 *
 * Recebe so o comeco do arquivo — a maior assinatura tem 12 bytes, entao ler o
 * arquivo inteiro para isto seria desperdicio. MIME fora da tabela e `false`:
 * a lista branca de formatos e a mesma de `MIMES_ARQUIVO`, e um formato que
 * entrasse la sem entrar aqui passaria sem conferencia nenhuma.
 */
export function assinaturaConfere(inicio: Uint8Array, mime: string): boolean {
  const partes = ASSINATURAS[mime]
  if (!partes) return false
  return partes.every((p) => p.bytes.every((b, i) => inicio[p.deslocamento + i] === b))
}

/** Quantos bytes `assinaturaConfere` precisa ver. */
export const BYTES_ASSINATURA = 12

// ---------------------------------------------------------------- origem

/**
 * A requisicao que escreve veio desta mesma origem?
 *
 * O cookie e `SameSite=Lax`, o que ja barra POST vindo de outro site — esta
 * checagem e a segunda tranca, para o caso de um navegador antigo sem esse
 * padrao e para deixar a regra explicita em vez de herdada.
 *
 * Requisicao SEM `Origin` passa de proposito: navegador sempre manda o cabecalho
 * em POST, entao a ausencia dele significa cliente que nao e navegador (curl, um
 * script de manutencao) — e esses nao carregam cookie de vitima nenhuma. Recusar
 * a ausencia quebraria script sem fechar ataque nenhum.
 */
export function mesmaOrigem(req: Request): boolean {
  const origem = req.headers.get('origin')
  if (!origem) return true

  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!host) return false

  try {
    return new URL(origem).host === host
  } catch {
    return false
  }
}
