// As barreiras de `lib/seguranca.ts` sao puras de proposito — sao exatamente o
// tipo de regra que passa a valer para menos casos do que se pensa quando alguem
// mexe nela, e nenhuma tela quebra quando isso acontece.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CABECALHOS_SEGURANCA,
  hrefSeguro,
  assinaturaConfere,
  mesmaOrigem,
  turnstileConfigurado,
  verificarTurnstile,
  BYTES_ASSINATURA,
} from './seguranca.ts'
import { MIMES_ARQUIVO } from './arquivo.ts'

const cabecalho = (nome: string) =>
  CABECALHOS_SEGURANCA.find((c) => c.key.toLowerCase() === nome.toLowerCase())?.value

// ---------------------------------------------------------------- cabecalhos

test('os cabecalhos que o app inteiro precisa estao todos na lista', () => {
  for (const nome of [
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Referrer-Policy',
    'Permissions-Policy',
    'Content-Security-Policy',
  ]) {
    assert.ok(cabecalho(nome), `faltou ${nome}`)
  }
})

test('o HSTS dura mais de um ano e cobre subdominios', () => {
  const v = cabecalho('Strict-Transport-Security')!
  const idade = Number(/max-age=(\d+)/.exec(v)?.[1] ?? 0)
  assert.ok(idade >= 31_536_000, `max-age curto demais: ${idade}`)
  assert.match(v, /includeSubDomains/)
})

test('a CSP fecha exfiltracao, moldura e desvio de base', () => {
  const csp = cabecalho('Content-Security-Policy')!
  // `connect-src 'self'` e a linha que impede mandar o snapshot da viagem —
  // passaporte incluso — para um servidor de fora.
  assert.match(csp, /connect-src 'self'/)
  assert.match(csp, /frame-ancestors 'none'/)
  assert.match(csp, /base-uri 'none'/)
  assert.match(csp, /form-action 'self'/)
})

test('a CSP deixa passar os dois servicos que o cliente consulta', () => {
  const csp = cabecalho('Content-Security-Policy')!
  // O clima (`lib/clima.ts`) e a busca de coordenada (`lib/localizar.ts`) rodam
  // NO NAVEGADOR de proposito — nao sao dado do servidor. Um `connect-src 'self'`
  // sozinho derruba os dois, e a falha e calada: o painel de clima simplesmente
  // fica vazio, que e indistinguivel de "sem rede". Servico novo consultado do
  // cliente entra aqui junto com a linha da politica.
  assert.match(csp, /connect-src [^;]*https:\/\/api\.open-meteo\.com/)
  assert.match(csp, /connect-src [^;]*https:\/\/nominatim\.openstreetmap\.org/)
})

test('a CSP nao abre connect-src para qualquer https', () => {
  const csp = cabecalho('Content-Security-Policy')!
  const connect = /connect-src ([^;]*)/.exec(csp)?.[1] ?? ''
  // `connect-src https:` devolveria a exfiltracao que esta diretiva existe para
  // fechar: e o unico lugar da politica onde o curinga custa caro.
  assert.ok(!/\bhttps:(\s|$)/.test(connect), `connect-src virou curinga: ${connect}`)
})

test('a CSP deixa o cofre abrir o preview', () => {
  const csp = cabecalho('Content-Security-Policy')!
  // O preview monta `blob:` do arquivo baixado: `<img>` para foto, `<object>`
  // para PDF. Sem `blob:` nos dois, o cofre nao abre nada — e isso e uma falha
  // que so aparece com um documento de verdade na tela.
  assert.match(csp, /img-src [^;]*blob:/)
  assert.match(csp, /object-src [^;]*blob:/)
})

test('a CSP nao libera eval em producao', () => {
  // `politica()` le NODE_ENV na montagem do modulo; aqui o teste roda fora de
  // producao, entao a asercao possivel e a inversa: o `unsafe-eval` do refresh
  // rapido tem que estar isolado atras da condicao, nunca solto na string base.
  const fonte = CABECALHOS_SEGURANCA.map((c) => c.value).join(' ')
  const quantos = fonte.split("'unsafe-eval'").length - 1
  assert.ok(quantos <= 1, 'unsafe-eval aparece mais de uma vez na politica')
})

// ---------------------------------------------------------------- hrefSeguro

test('hrefSeguro descarta esquema que executa script', () => {
  for (const veneno of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    '  javascript:alert(1)',
    'jAvAsCrIpT:alert(document.cookie)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ]) {
    assert.equal(hrefSeguro(veneno), null, `deixou passar: ${veneno}`)
  }
})

test('hrefSeguro mantem o que vira link de verdade', () => {
  assert.equal(hrefSeguro('https://elbphilharmonie.de'), 'https://elbphilharmonie.de')
  assert.equal(hrefSeguro('http://exemplo.com'), 'http://exemplo.com')
  assert.equal(hrefSeguro('mailto:alguem@exemplo.com'), 'mailto:alguem@exemplo.com')
  assert.equal(hrefSeguro('tel:+493040000'), 'tel:+493040000')
})

test('hrefSeguro assume https em quem digitou so o dominio', () => {
  assert.equal(hrefSeguro('maps.google.com'), 'https://maps.google.com')
  assert.equal(hrefSeguro('  booking.com/x  '), 'https://booking.com/x')
})

test('hrefSeguro devolve null para vazio, e nao string vazia', () => {
  // A tela decide entre `<a>` e texto pelo retorno; string vazia viraria um link
  // que nao vai a lugar nenhum.
  assert.equal(hrefSeguro(''), null)
  assert.equal(hrefSeguro('   '), null)
  assert.equal(hrefSeguro(null), null)
  assert.equal(hrefSeguro(undefined), null)
})

// ---------------------------------------------------------------- assinatura

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)])

const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37)
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0)
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
])
// `<!DOCTYPE html>` — o arquivo hostil que passava anunciado como PDF.
const HTML = new Uint8Array([...'<!DOCTYPE html>'].map((c) => c.charCodeAt(0)))

test('assinaturaConfere aceita cada formato do cofre', () => {
  assert.ok(assinaturaConfere(PDF, 'application/pdf'))
  assert.ok(assinaturaConfere(JPEG, 'image/jpeg'))
  assert.ok(assinaturaConfere(PNG, 'image/png'))
  assert.ok(assinaturaConfere(WEBP, 'image/webp'))
})

test('assinaturaConfere recusa HTML anunciado como qualquer formato aceito', () => {
  // O caso que a checagem existe para pegar: `arquivo.type` e o que o CLIENTE
  // declarou, e um HTML servido como `application/pdf` do proprio dominio e um
  // arquivo hostil entregue aos outros viajantes.
  for (const mime of MIMES_ARQUIVO) {
    assert.ok(!assinaturaConfere(HTML, mime), `HTML passou como ${mime}`)
  }
})

test('assinaturaConfere recusa formato trocado entre si', () => {
  assert.ok(!assinaturaConfere(PNG, 'application/pdf'))
  assert.ok(!assinaturaConfere(PDF, 'image/png'))
  // WEBP e RIFF nos 4 primeiros bytes, como WAV e AVI: sem conferir o byte 8
  // qualquer container RIFF passaria por imagem.
  assert.ok(!assinaturaConfere(bytes(0x52, 0x49, 0x46, 0x46), 'image/webp'))
})

test('assinaturaConfere recusa MIME fora da lista, mesmo com bytes validos', () => {
  assert.ok(!assinaturaConfere(PDF, 'text/html'))
  assert.ok(!assinaturaConfere(PDF, 'application/octet-stream'))
})

test('toda entrada de MIMES_ARQUIVO tem assinatura conhecida', () => {
  // Sem isto, acrescentar um formato em `MIMES_ARQUIVO` sem acrescentar a
  // assinatura passaria a aceitar o formato NOVO sem conferencia nenhuma —
  // silenciosamente, porque `assinaturaConfere` devolveria false e a rota
  // recusaria tudo, ou pior, alguem "consertaria" liberando o desconhecido.
  const amostras: Record<string, Uint8Array> = {
    'application/pdf': PDF,
    'image/jpeg': JPEG,
    'image/png': PNG,
    'image/webp': WEBP,
  }
  for (const mime of MIMES_ARQUIVO) {
    assert.ok(amostras[mime], `MIMES_ARQUIVO tem ${mime} sem assinatura em lib/seguranca.ts`)
    assert.ok(assinaturaConfere(amostras[mime], mime), `${mime} nao reconhece o proprio formato`)
  }
})

test('BYTES_ASSINATURA cobre a maior assinatura da tabela', () => {
  // WEBP e a maior: 4 bytes de RIFF + 4 de tamanho + 4 de WEBP = 12.
  assert.ok(BYTES_ASSINATURA >= 12)
  assert.ok(assinaturaConfere(WEBP.slice(0, BYTES_ASSINATURA), 'image/webp'))
})

// ---------------------------------------------------------------- origem

const pedido = (metodo: string, cabecalhos: Record<string, string>) =>
  new Request('https://viagem.exemplo/api/mutate', { method: metodo, headers: cabecalhos })

test('mesmaOrigem aceita o proprio dominio', () => {
  assert.ok(
    mesmaOrigem(pedido('POST', { origin: 'https://viagem.exemplo', host: 'viagem.exemplo' })),
  )
})

test('mesmaOrigem recusa origem de terceiro', () => {
  assert.ok(
    !mesmaOrigem(pedido('POST', { origin: 'https://site-do-atacante', host: 'viagem.exemplo' })),
  )
})

test('mesmaOrigem respeita o host encaminhado pela borda', () => {
  // Na Vercel o `host` interno nao e o dominio publico; `x-forwarded-host` e.
  // Sem esta preferencia, TODA escrita em producao levaria 403.
  assert.ok(
    mesmaOrigem(
      pedido('POST', {
        origin: 'https://viagem.exemplo',
        host: 'runtime-interno.vercel',
        'x-forwarded-host': 'viagem.exemplo',
      }),
    ),
  )
})

test('mesmaOrigem deixa passar requisicao sem Origin', () => {
  // Navegador sempre manda `Origin` em POST, entao a ausencia e cliente que nao
  // e navegador — e esse nao carrega o cookie de vitima nenhuma. Recusar aqui
  // quebraria script de manutencao sem fechar ataque nenhum.
  assert.ok(mesmaOrigem(pedido('POST', { host: 'viagem.exemplo' })))
})

test('mesmaOrigem recusa Origin malformada', () => {
  assert.ok(!mesmaOrigem(pedido('POST', { origin: 'nao-e-uma-url', host: 'viagem.exemplo' })))
})

// ---------------------------------------------------------------- captcha

test('sem as duas chaves, o captcha esta desligado', () => {
  // Este ambiente de teste nao tem nenhuma das duas. O comportamento certo e o
  // app inteiro seguir de pe: a familia usa isto em viagem, e um captcha mal
  // configurado que recusa todo mundo no aeroporto e pior do que captcha nenhum.
  assert.equal(turnstileConfigurado(), false)
})

test('uma chave sozinha nao liga o captcha', () => {
  // Meia configuracao e o caso perigoso: com so a secreta, a tela nao desenha
  // widget nenhum e o servidor recusaria TODO login por falta de token.
  const antes = { ...process.env }
  try {
    process.env.TURNSTILE_SECRET_KEY = 'segredo'
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
    assert.equal(turnstileConfigurado(), false, 'so a secreta nao pode ligar')

    delete process.env.TURNSTILE_SECRET_KEY
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site'
    assert.equal(turnstileConfigurado(), false, 'so a de site nao pode ligar')

    process.env.TURNSTILE_SECRET_KEY = 'segredo'
    assert.equal(turnstileConfigurado(), true, 'as duas juntas ligam')
  } finally {
    process.env = antes
  }
})

test('desligado, verificarTurnstile deixa passar sem token', async () => {
  assert.equal(await verificarTurnstile(null), true)
  assert.equal(await verificarTurnstile(''), true)
})

test('ligado e SEM token, verificarTurnstile recusa sem ir a rede', async () => {
  const antes = { ...process.env }
  try {
    process.env.TURNSTILE_SECRET_KEY = 'segredo'
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site'
    // Recusa antes do fetch: token ausente nao precisa de confirmacao externa,
    // e ir a rede aqui daria ao atacante um jeito barato de nos fazer chamar a
    // Cloudflare a cada requisicao.
    assert.equal(await verificarTurnstile(null), false)
    assert.equal(await verificarTurnstile(undefined), false)
    assert.equal(await verificarTurnstile(''), false)
  } finally {
    process.env = antes
  }
})

test('a CSP libera o Turnstile SEMPRE, mesmo com o captcha desligado', () => {
  const csp = CABECALHOS_SEGURANCA.find((c) => c.key === 'Content-Security-Policy')!.value
  // Incondicional de proposito, e a razao esta no comentario de `CAPTCHA` em
  // seguranca.ts: o Next serializa `headers()` em routes-manifest.json durante o
  // BUILD. Uma politica condicional passa a depender da variavel existir no
  // build, e quem liga o Turnstile no painel e redeploya com cache fica trancado
  // para fora — servidor exige o token, navegador nao carrega o widget que o
  // produz. Este teste existe para que a "limpeza" de tornar isto condicional de
  // novo quebre aqui, e nao em producao.
  for (const diretiva of ['script-src', 'frame-src', 'connect-src']) {
    const valor = new RegExp(`${diretiva} ([^;]*)`).exec(csp)?.[1] ?? ''
    assert.ok(
      valor.includes('https://challenges.cloudflare.com'),
      `${diretiva} nao libera o Turnstile: ligar o captcha trancaria o login`,
    )
  }
})
