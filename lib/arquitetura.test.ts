// Testes de ARQUITETURA: propriedades que valem por leitura de código, não por
// execução.
//
// Existem porque a feature do assistente foi desenhada em cima de duas
// afirmações que, se deixarem de ser verdade, não quebram nenhum teste comum e
// não aparecem em nenhuma tela — a próxima pessoa só descobre auditando. Um
// teste que lê o import é feio, e é a única coisa que trava isso.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('a rota de conversa do assistente não importa o caminho de escrita', () => {
  const rota = ler('app/api/assistente/route.ts')
  assert.ok(
    !/from\s+['"][^'"]*escrita\.ts['"]/.test(rota),
    'app/api/assistente/route.ts importou lib/escrita.ts. Essa rota CONVERSA; ' +
      'quem grava é /api/assistente/aplicar. Uma rota que às vezes escreve é onde ' +
      'alguém um dia esquece de checar a flag.',
  )
  assert.ok(
    !/\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bdelete\s+from\b/i.test(rota),
    'a rota de conversa tem SQL de escrita',
  )
})

test('a chave de administrador é lida em exatamente um arquivo', () => {
  const arquivos = [
    'app/api/assistente/route.ts',
    'app/api/assistente/aplicar/route.ts',
    'app/api/assistente/desfazer/route.ts',
    'lib/assistente.ts',
    'lib/consumo.ts',
    'lib/escrita.ts',
    'lib/db.ts',
  ]
  for (const a of arquivos) {
    assert.ok(
      !ler(a).includes('ANTHROPIC_ADMIN_KEY'),
      `${a} lê ANTHROPIC_ADMIN_KEY. Ela administra membros, workspaces e chaves ` +
        'da organização — só /api/assistente/consumo pode tocá-la.',
    )
  }
  assert.ok(ler('app/api/assistente/consumo/route.ts').includes('ANTHROPIC_ADMIN_KEY'))
})

test('nenhuma chave da Anthropic vira variável pública do cliente', () => {
  for (const a of ['app/api/assistente/route.ts', 'app/api/assistente/consumo/route.ts']) {
    assert.ok(!ler(a).includes('NEXT_PUBLIC_ANTHROPIC'), `${a} expôs a chave ao navegador`)
  }
})

test('o assistente monta contexto pelo snapshot, sem consulta própria', () => {
  const rota = ler('app/api/assistente/route.ts')
  assert.ok(rota.includes('getSnapshot'), 'a rota deveria usar getSnapshot')
  assert.ok(
    !/\bfrom\s+(travelers|expenses|documents|document_files)\b/i.test(rota),
    'a rota do assistente consultou tabela direto. O recorte por papel vive em ' +
      'financeiroDaViagem/documentosDaViagem — uma query própria o contorna.',
  )
})

test('as três rotas de escrita devolvem o mesmo envelope', () => {
  for (const a of [
    'app/api/mutate/route.ts',
    'app/api/assistente/aplicar/route.ts',
    'app/api/assistente/desfazer/route.ts',
  ]) {
    assert.ok(
      ler(a).includes('envelope(acesso)'),
      `${a} monta o envelope à mão. Os campos já divergiram uma vez entre mutate ` +
        'e snapshot e toda escrita quebrou a renderização seguinte.',
    )
  }
})

test('desfazer passa por autorizar em cada linha revertida', () => {
  const rota = ler('app/api/assistente/desfazer/route.ts')
  // O `change_log` inteiro vai no snapshot (`select l.*` em lib/db.ts), então o
  // `lote` é visível a todo participante. Sem `autorizar` por linha, um editor
  // reverteria com ele o documento pessoal de outro participante — que
  // lib/escrita.ts proíbe explicitamente de editar.
  assert.ok(
    /await autorizar\(/.test(rota),
    'desfazer voltou a reverter sem consultar autorizar: escalada de privilégio',
  )
  assert.ok(
    /colunaValida\(/.test(rota),
    'desfazer voltou a interpolar `campo` no SQL sem lista branca',
  )
})

// ---------------------------------------------------------------- vazamento

test('o snapshot nao manda passaporte de participante para quem nao administra', () => {
  const db = ler('lib/db.ts')
  const consulta = /from travelers p left join users u[\s\S]{0,200}/.exec(db)?.[0] ?? ''
  assert.ok(consulta, 'a consulta de participantes mudou de forma; confira o recorte a mao')
  assert.ok(
    !/p\.passaporte,/.test(db.slice(0, db.indexOf('from travelers p'))) ||
      /case when[^)]*then p\.passaporte end/.test(db),
    'a consulta de participantes voltou a mandar `passaporte` para todo mundo. ' +
      'Planejar o roteiro nao da direito de ler o passaporte de ninguem — mesma ' +
      'regra de documentosDaViagem, e o recorte tem que ser na QUERY.',
  )
  assert.ok(
    /case when[^)]*then p\.passaporte end/.test(db),
    'sumiu o recorte de papel do `passaporte` em getSnapshot',
  )
  assert.ok(
    /case when[^)]*then p\.telefone end/.test(db),
    'sumiu o recorte de papel do `telefone` em getSnapshot',
  )
})

test('o snapshot nao manda o orcamento da viagem para visualizador', () => {
  const db = ler('lib/db.ts')
  assert.ok(
    !/sql`select \* from trips where id = /.test(db),
    'getSnapshot voltou a fazer `select *` em trips. A tabela carrega ' +
      '`orcamento_centavos`, que e o total da viagem — exatamente o que ' +
      'financeiroDaViagem recusa a mandar para quem nao administra. Esconder no ' +
      'React (`if (!fin.admin) return null`) nao e proteger.',
  )
  assert.ok(
    /case when[^)]*then orcamento_centavos end/.test(db),
    'sumiu o recorte de papel do `orcamento_centavos` em getSnapshot',
  )
})

// ---------------------------------------------------------------- upload

test('o upload do cofre confere a assinatura do arquivo, nao so o MIME declarado', () => {
  const rota = ler('app/api/documento/route.ts')
  assert.ok(
    /assinaturaConfere\(/.test(rota),
    '/api/documento voltou a aceitar `arquivo.type` sozinho. Quem envia escolhe o ' +
      'que declarar: um HTML anunciado como application/pdf era gravado e servido ' +
      'de volta do proprio dominio para os outros viajantes.',
  )
  // O `nosniff` saiu da rota para `cabecalhosEstaticos`, que o next.config.ts
  // aplica a `/:caminho*` — /api/* incluso, que o proxy nao alcanca. O que fica
  // na resposta e a CSP proria dela.
  assert.ok(
    /'Content-Security-Policy': "default-src 'none'"/.test(rota),
    'a resposta do cofre perdeu a CSP propria. Ela serve arquivo que outra ' +
      'pessoa subiu, e o proxy nao cobre /api/*.',
  )
  assert.ok(
    /X-Content-Type-Options/.test(ler('lib/seguranca.ts')),
    'o `nosniff` sumiu de cabecalhosEstaticos: sem ele o navegador adivinha o ' +
      'tipo do arquivo do cofre pelo conteudo.',
  )
})

// ---------------------------------------------------------------- href

test('nenhum valor guardado vira href sem passar por hrefSeguro', () => {
  // `doc.valor` e `links` sao os dois campos livres que a tela transforma em
  // link. Os dois foram escritos por outro participante da viagem, e um
  // `javascript:` guardado ali roda com a sessao de quem clicar — numa pagina
  // que carrega o snapshot inteiro.
  const cofre = ler('components/CofreDocumento.tsx')
  assert.ok(
    !/href=\{doc\.valor\}/.test(cofre),
    'CofreDocumento voltou a jogar `doc.valor` direto no href',
  )
  assert.ok(/hrefSeguro\(doc\.valor\)/.test(cofre), 'CofreDocumento nao usa mais hrefSeguro')
  assert.ok(
    /hrefSeguro\(/.test(ler('lib/derive.ts')),
    'lerLinks parou de conferir o esquema por hrefSeguro',
  )
})

// ---------------------------------------------------------------- cabecalhos

test('os cabecalhos de seguranca chegam a configuracao do Next', () => {
  const config = ler('next.config.ts')
  assert.ok(
    /cabecalhosEstaticos/.test(config) && /async headers\(\)/.test(config),
    'next.config.ts parou de aplicar os cabecalhos de lib/seguranca.ts. Sem eles ' +
      'nao ha HSTS nem nosniff em rota nenhuma.',
  )
  // O CSP mora no proxy, e nao aqui, porque carrega nonce por requisicao — e
  // porque `headers()` e serializado no BUILD, o que faria qualquer parte
  // condicional depender do ambiente do build em vez do request.
  assert.ok(
    /politicaCsp\(/.test(ler('proxy.ts')),
    'o CSP saiu do proxy. Sem ele nao ha nonce, e `strict-dynamic` sem nonce ' +
      'bloqueia todo script da pagina.',
  )
})

// ---------------------------------------------------------------- CSRF

test('toda escrita passa pela conferencia de origem', () => {
  const api = ler('lib/api.ts')
  assert.ok(
    /mesmaOrigem\(\{/.test(api) && /exigirMesmaOrigem\(req\)/.test(api),
    '`rota()` parou de conferir a origem. Ela e a casca de TODAS as rotas: uma ' +
      'linha aqui cobre as dez de uma vez, e sem ela a unica defesa contra CSRF ' +
      'volta a ser o SameSite=Lax do cookie, herdado do padrao do navegador.',
  )
})

test('o passaporte de participante corta em proprietario, nao em editor', () => {
  const db = ler('lib/db.ts')
  // O erro que este teste existe para impedir ja foi cometido uma vez: o recorte
  // reusou `administra` (editor), que e o corte do DINHEIRO em
  // `financeiroDaViagem`, para o corte do DOCUMENTO. Sao regras diferentes, e a
  // do documento e mais alta — `documentosDaViagem`, `documentacaoDaViagem` e o
  // `documentoVisivel` de /api/documento usam todas `proprietario`.
  assert.ok(
    /const veDadoPessoal = papelAlcanca\(papel, 'proprietario'\)/.test(db),
    'sumiu o limiar `proprietario` do dado pessoal em getSnapshot',
  )
  assert.ok(
    /then p\.passaporte end/.test(db) && !/\$\{administra\}::boolean or p\.id/.test(db),
    'o passaporte voltou a cortar por `administra` (editor). Um co-organizador ' +
      'passaria a ler o passaporte de todo mundo — o dado que documentosDaViagem ' +
      'se da ao trabalho de esconder exatamente desse papel.',
  )
})

test('a marca do assistente chega ao registro de uma EDICAO', () => {
  const escrita = ler('lib/escrita.ts')
  // Sem `marca.origem`/`marca.lote` aqui, uma edicao feita pelo assistente era
  // gravada como edicao humana sem lote, e `/api/assistente/desfazer` — que
  // filtra por origem e lote — nao a encontrava. Um lote so de edicoes respondia
  // "esse lote nao existe mais"; um lote misto revertia as criacoes e deixava as
  // edicoes de pe. O desfazer e o que torna seguro aceitar uma proposta.
  const trecho = escrita.slice(escrita.indexOf('for (const c of cols) {'))
  assert.ok(
    /marca\.origem/.test(trecho) && /marca\.lote/.test(trecho),
    'o registro de edicao voltou a perder a marca: o desfazer do assistente ' +
      'reverteria pela metade, em silencio',
  )
})

test('o rate limit conta no banco, sob trava', () => {
  const schema = ler('db/schema.sql')
  assert.ok(
    /create or replace function registrar_tentativa/.test(schema),
    'sumiu a funcao do rate limit persistente',
  )
  assert.ok(
    /for update/.test(schema),
    'a funcao do rate limit perdeu o `for update`. Sem a trava, duas instancias ' +
      'leem o mesmo contador, cada uma soma 1, e o limite vale o dobro — que e o ' +
      'mesmo furo do contador em memoria, so mais dificil de enxergar.',
  )
  const db = ler('lib/db.ts')
  assert.ok(
    /registrar_tentativa\(/.test(db),
    'lib/db.ts parou de usar a funcao; o limite voltou a ser por instancia',
  )
})

test('login e cadastro conferem o captcha antes de gastar scrypt', () => {
  for (const a of ['app/api/sessao/route.ts', 'app/api/usuarios/route.ts']) {
    const rota = ler(a)
    assert.ok(
      /verificarTurnstile\(/.test(rota),
      `${a} parou de conferir o captcha. O rate limit barra volume de UMA origem; ` +
        'mil IPs tentando cinco senhas cada passam por baixo dele.',
    )
  }
})
test('a dona da entrega vem do banco, não do corpo do pedido', () => {
  const escrita = ler('lib/escrita.ts')
  // Enquanto o dono saía de `campos.traveler_id`, a autorização dependia de o zod
  // EXIGIR esse campo — e o desfazer do assistente monta `campos` com um campo só,
  // então por ali `traveler_id` sumia, `meu` virava true por ausência, e um
  // visualizador revertia o número do passaporte de outro participante.
  assert.ok(
    /from document_submissions s[\s\S]{0,200}join document_requirements/.test(escrita),
    'autorizar deixou de carregar a entrega do banco: a dona volta a ser quem o ' +
      'cliente disser que é, e o desfazer contorna o 403 da documentação alheia',
  )
  assert.ok(
    /entregaAlvo\?\.traveler_id \?\? campos\.traveler_id/.test(escrita),
    'a linha gravada precisa vencer o que veio no corpo ao decidir a dona da entrega',
  )
})

test('o gasto consolidado da organização não é liberado por ser dono de viagem', () => {
  const rota = ler('app/api/assistente/consumo/route.ts')
  // `cost_report` é a fatura de quem HOSPEDA o app — todas as viagens de todas as
  // contas. Cadastro é aberto e criar uma viagem já faz de alguém proprietário
  // dela, então `exigirViagem(..., 'proprietario')` não é barreira nenhuma aqui.
  assert.ok(
    /ehOperador\(/.test(rota),
    'o consolidado voltou a sair só com a checagem de dono da viagem: qualquer ' +
      'pessoa que se cadastre lê a conta da Anthropic de quem hospeda',
  )
  assert.ok(
    /OPERADOR_EMAILS/.test(rota),
    'a lista de operadores precisa vir do ambiente — não há papel de administrador ' +
      'da instalação no banco',
  )
})
