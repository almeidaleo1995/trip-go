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
  assert.ok(
    /'X-Content-Type-Options': 'nosniff'/.test(rota),
    'a resposta do cofre perdeu o `nosniff`. Ela serve arquivo que outra pessoa ' +
      'subiu; sem isto o navegador adivinha o tipo pelo conteudo.',
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
    /CABECALHOS_SEGURANCA/.test(config) && /async headers\(\)/.test(config),
    'next.config.ts parou de aplicar os cabecalhos de lib/seguranca.ts. Sem eles ' +
      'nao ha HSTS, nem nosniff, nem CSP em nenhuma rota.',
  )
})

// ---------------------------------------------------------------- CSRF

test('toda escrita passa pela conferencia de origem', () => {
  const api = ler('lib/api.ts')
  assert.ok(
    /mesmaOrigem\(req\)/.test(api),
    '`rota()` parou de conferir a origem. Ela e a casca de TODAS as rotas: uma ' +
      'linha aqui cobre as dez de uma vez, e sem ela a unica defesa contra CSRF ' +
      'volta a ser o SameSite=Lax do cookie, herdado do padrao do navegador.',
  )
})
