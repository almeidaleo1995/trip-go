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
