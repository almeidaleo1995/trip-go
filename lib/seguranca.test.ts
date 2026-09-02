// Testes das defesas globais.
//
// Elas têm uma propriedade ruim em comum: falham em SILÊNCIO. Um CSP com uma
// diretiva errada não quebra teste nenhum — só deixa de proteger, e ninguém
// descobre até alguém tentar. Por isso o que se trava aqui não é "a função roda",
// é o CONTEÚDO de cada política.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CAMPO_ARMADILHA,
  cabecalhosEstaticos,
  mesmaOrigem,
  mudaEstado,
  pareceRobo,
  politicaCsp,
  precisaHttps,
  hrefSeguro,
  turnstileConfigurado,
  verificarTurnstile,
} from './seguranca.ts'

// ---------------------------------------------------------------- CSP

test('csp: o nonce entra em script-src e em nenhum outro lugar', () => {
  const csp = politicaCsp('abc123')
  assert.match(csp, /script-src [^;]*'nonce-abc123'/)
  // Nonce em style-src seria mentira: atributo `style` não obedece a nonce, e
  // declarar um daria a impressão de que os 170 style={{…}} do app estão cobertos.
  assert.doesNotMatch(csp, /style-src [^;]*nonce/)
})

test('csp: script-src tem strict-dynamic e nao tem unsafe-inline', () => {
  const csp = politicaCsp('n')
  const script = csp.split('; ').find((d) => d.startsWith('script-src'))!
  assert.ok(script.includes("'strict-dynamic'"))
  // `unsafe-inline` em script-src anula o nonce inteiro — o navegador passa a
  // aceitar qualquer <script> injetado. É a regressão que este teste existe para
  // pegar, porque ela não quebra nada visível.
  assert.ok(!script.includes("'unsafe-inline'"))
})

test('csp: unsafe-eval so em desenvolvimento', () => {
  assert.ok(politicaCsp('n', true).includes("'unsafe-eval'"))
  assert.ok(!politicaCsp('n', false).includes("'unsafe-eval'"))
})

test('csp: upgrade-insecure-requests fica fora do desenvolvimento', () => {
  // Em localhost é http de propósito; a diretiva transformaria o app em erro de
  // certificado na primeira requisição.
  assert.ok(!politicaCsp('n', true).includes('upgrade-insecure-requests'))
  assert.ok(politicaCsp('n', false).includes('upgrade-insecure-requests'))
})

test('csp: as fontes que o app realmente usa continuam permitidas', () => {
  const csp = politicaCsp('n')
  // Os ladrilhos do mapa e a foto de perfil, que aceitam qualquer link.
  assert.match(csp, /img-src [^;]*https:/)
  // O clima ao vivo (lib/clima.ts) é a única chamada a terceiro saindo do cliente.
  assert.match(csp, /connect-src [^;]*https:\/\/api\.open-meteo\.com/)
  // A pré-visualização do PDF no cofre, que é <object data={blob:…}>.
  assert.match(csp, /object-src [^;]*blob:/)
  // O service worker, que é o que faz o app abrir em modo avião.
  assert.match(csp, /worker-src 'self'/)
})

test('csp: a Anthropic nao esta em connect-src', () => {
  // Se um dia estiver, é porque a chave foi parar no navegador.
  assert.ok(!politicaCsp('n').includes('anthropic'))
})

test('csp: clickjacking barrado pelos dois caminhos', () => {
  assert.match(politicaCsp('n'), /frame-ancestors 'none'/)
  const chaves = cabecalhosEstaticos(true).map((c) => c.key)
  assert.ok(chaves.includes('X-Frame-Options'))
})

// ---------------------------------------------------------------- cabeçalhos

test('hsts so em producao', () => {
  const prod = cabecalhosEstaticos(true).map((c) => c.key)
  const dev = cabecalhosEstaticos(false).map((c) => c.key)
  assert.ok(prod.includes('Strict-Transport-Security'))
  // Em localhost o HSTS ensinaria o navegador a recusar http://localhost:3000
  // por um ano, e desfazer isso exige chrome://net-internals.
  assert.ok(!dev.includes('Strict-Transport-Security'))
})

test('nosniff sempre, inclusive em desenvolvimento', () => {
  for (const producao of [true, false]) {
    const h = cabecalhosEstaticos(producao)
    assert.equal(h.find((c) => c.key === 'X-Content-Type-Options')?.value, 'nosniff')
  }
})

// ---------------------------------------------------------------- HTTPS

test('https: redireciona so quando a borda diz http, e so em producao', () => {
  assert.equal(precisaHttps('http', true, 'tripgo.app'), true)
  assert.equal(precisaHttps('https', true, 'tripgo.app'), false)
  assert.equal(precisaHttps('http', false, 'tripgo.app'), false)
})

test('https: host local nunca e redirecionado, nem em producao', () => {
  // Conferir um build com NODE_ENV=production na propria maquina dava 308 para
  // https://localhost, que nao tem certificado nem servidor: o app parecia
  // quebrado exatamente na hora de verificar se estava certo.
  for (const h of ['localhost', 'localhost:3000', '127.0.0.1:3111', '[::1]']) {
    assert.equal(precisaHttps('http', true, h), false, h)
  }
})

test('https: cabecalho ausente e tratado como seguro', () => {
  // Um proxy que não anuncia o protocolo não pode virar laço de redirecionamento
  // infinito — app fora do ar é pior do que a requisição que o HSTS resolve na
  // segunda visita.
  assert.equal(precisaHttps(null, true, 'tripgo.app'), false)
})

test('https: le o primeiro valor de uma lista de proxies', () => {
  assert.equal(precisaHttps('http, https', true, 'tripgo.app'), true)
  assert.equal(precisaHttps('https, http', true, 'tripgo.app'), false)
})

// ---------------------------------------------------------------- origem

test('origem: sec-fetch-site decide sozinho quando existe', () => {
  assert.equal(mesmaOrigem({ secFetchSite: 'same-origin' }), true)
  assert.equal(mesmaOrigem({ secFetchSite: 'none' }), true)
  assert.equal(mesmaOrigem({ secFetchSite: 'cross-site' }), false)
  assert.equal(mesmaOrigem({ secFetchSite: 'same-site' }), false)
})

test('origem: sec-fetch-site vence o Origin, que a pagina consegue influenciar', () => {
  // Sec-Fetch-Site é escrito pelo navegador e nenhum script de página altera.
  assert.equal(
    mesmaOrigem({
      secFetchSite: 'cross-site',
      origin: 'https://tripgo.app',
      host: 'tripgo.app',
    }),
    false,
  )
})

test('origem: sem sec-fetch-site, compara Origin com o host', () => {
  assert.equal(mesmaOrigem({ origin: 'https://tripgo.app', host: 'tripgo.app' }), true)
  assert.equal(mesmaOrigem({ origin: 'https://mal.com', host: 'tripgo.app' }), false)
})

test('origem: x-forwarded-host vence o host interno', () => {
  // Atrás da borda, `host` é o nome interno; quem casa com o Origin do navegador
  // é o x-forwarded-host.
  assert.equal(
    mesmaOrigem({
      origin: 'https://tripgo.app',
      host: 'interno.vercel.internal',
      forwardedHost: 'tripgo.app',
    }),
    true,
  )
})

test('origem: sem Origin e sem Sec-Fetch-Site, recusa', () => {
  // Não é navegador de ninguém: todo navegador em uso manda Origin em POST.
  assert.equal(mesmaOrigem({}), false)
  assert.equal(mesmaOrigem({ host: 'tripgo.app' }), false)
})

test('origem: Origin literal "null" e Origin quebrado recusam', () => {
  assert.equal(mesmaOrigem({ origin: 'null', host: 'tripgo.app' }), false)
  assert.equal(mesmaOrigem({ origin: 'nao é uma url', host: 'tripgo.app' }), false)
})

test('origem: a comparacao de host ignora caixa', () => {
  assert.equal(mesmaOrigem({ origin: 'https://TripGo.app', host: 'tripgo.app' }), true)
})

test('metodos: so os que gravam sao conferidos', () => {
  for (const m of ['POST', 'put', 'PATCH', 'delete']) assert.equal(mudaEstado(m), true)
  for (const m of ['GET', 'head', 'OPTIONS']) assert.equal(mudaEstado(m), false)
})

// ---------------------------------------------------------------- armadilha

test('armadilha: vazio e ausente sao gente; preenchido e robo', () => {
  assert.equal(pareceRobo(undefined), false)
  assert.equal(pareceRobo(''), false)
  assert.equal(pareceRobo('   '), false)
  assert.equal(pareceRobo('https://spam.example'), true)
})

test('armadilha: o nome do campo e plausivel', () => {
  // Um campo chamado `honeypot` é um campo que o robô aprende a pular.
  assert.ok(!/honeypot|armadilha|trap/i.test(CAMPO_ARMADILHA))
})

// ---------------------------------------------------------------- links

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
  for (const nada of ['', '   ', null, undefined]) {
    assert.equal(hrefSeguro(nada), null)
  }
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
    // Recusa antes do fetch: token ausente nao precisa de confirmacao externa, e
    // ir a rede aqui daria ao atacante um jeito barato de nos fazer chamar a
    // Cloudflare a cada requisicao.
    for (const nada of [null, undefined, '']) {
      assert.equal(await verificarTurnstile(nada), false)
    }
  } finally {
    process.env = antes
  }
})

test('csp: o Turnstile so entra na politica quando o captcha esta ligado', () => {
  // Condicional AQUI e seguro porque `politicaCsp` roda no proxy, a cada
  // requisicao. A mesma condicional no next.config.ts seria uma armadilha: o Next
  // serializa `headers()` em routes-manifest.json durante o BUILD, entao ligar o
  // captcha no painel e redeployar com cache deixaria o servidor exigindo um
  // token que o navegador esta bloqueado de produzir.
  const antes = { ...process.env }
  try {
    delete process.env.TURNSTILE_SECRET_KEY
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
    const desligado = politicaCsp('abc')
    assert.ok(!desligado.includes('challenges.cloudflare.com'), 'abriu o Cloudflare a toa')
    assert.match(desligado, /frame-src 'none'/)

    process.env.TURNSTILE_SECRET_KEY = 'segredo'
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site'
    const ligado = politicaCsp('abc')
    // As duas diretivas que o `'strict-dynamic'` NAO cobre: ele faz o script do
    // widget ser confiado por heranca, mas nao libera nem a conexao nem o iframe.
    assert.match(ligado, /connect-src [^;]*challenges\.cloudflare\.com/)
    assert.match(ligado, /frame-src [^;]*challenges\.cloudflare\.com/)
  } finally {
    process.env = antes
  }
})

test('csp: o Nominatim continua em connect-src', () => {
  // A busca de coordenada (lib/localizar.ts) roda NO NAVEGADOR, como o clima.
  // Faltando aqui, ela falha muda: a busca por nome simplesmente nao devolve
  // nada, o que e indistinguivel de "nao achei esse lugar".
  assert.match(politicaCsp('abc'), /connect-src [^;]*https:\/\/nominatim\.openstreetmap\.org/)
})
