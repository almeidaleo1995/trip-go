// Os limites da skill `roteiro-trip-go`, travados por LEITURA do codigo dela.
//
// A skill monta a viagem fora do app (de PDF, de voucher, de conversa) e grava
// direto no banco, para a viagem aparecer na tela na hora. Isso e util e e
// perigoso pelo mesmo motivo: ela roda com a DATABASE_URL, dentro do repositorio,
// com permissao de escrever arquivo. Duas regras a mantem no lugar, e nenhuma das
// duas se defende sozinha — por isso estao aqui, e nao so escritas no SKILL.md:
//
//   1. ELA SO MEXE EM DADO, NUNCA EM CODIGO. Os scripts que falam com o banco nao
//      escrevem arquivo nem rodam comando. Um `writeFileSync` acrescentado a
//      `subir.mjs` faria este teste falhar antes de qualquer revisao humana.
//   2. ELA NAO TEM PODER PROPRIO. Toda escrita passa por `autorizar` + `aplicar`
//      de lib/escrita.ts, com o `Acesso` de uma conta real. Um `insert into` cru
//      contornaria o 403 que separa o visualizador do editor, e o que separa a
//      documentacao pessoal de uma pessoa de todas as outras.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

/**
 * O codigo sem os comentarios.
 *
 * Os proprios scripts explicam no cabecalho o que NAO fazem ("ele nao tem
 * `writeFileSync`"), e uma busca ingenua acusaria justamente a frase que promete
 * o contrario. O que interessa aqui e a chamada, nao a mencao.
 */
const semComentarios = (codigo: string) =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const SKILL = '.claude/skills/roteiro-trip-go/scripts'

/** Os scripts que alcancam o banco. `extrair.mjs` fica de fora: ele SO escreve arquivo. */
const NO_BANCO = [`${SKILL}/subir.mjs`, `${SKILL}/desfazer.mjs`]

test('os scripts de banco da skill nao escrevem arquivo nenhum', () => {
  // Ler e permitido (o JSON da viagem entra por `readFileSync`). Escrever nao:
  // o pedido e "atualize meus DADOS", e um script que grava arquivo enquanto
  // grava no banco pode mexer no proprio projeto sem ninguem perceber.
  const ESCRITA = [
    'writeFileSync',
    'appendFileSync',
    'createWriteStream',
    'mkdirSync',
    'rmSync',
    'unlinkSync',
    'renameSync',
    'cpSync',
    'copyFileSync',
    'writeFile(',
  ]
  for (const arquivo of NO_BANCO) {
    const codigo = semComentarios(ler(arquivo))
    for (const chamada of ESCRITA) {
      assert.ok(
        !codigo.includes(chamada),
        `${arquivo} usa ${chamada}. Os scripts de banco da skill so mexem em DADO: ` +
          'quem escreve arquivo e o passo de gerar o .json/.pdf, que nao fala com o banco.',
      )
    }
  }
})

test('os scripts de banco da skill nao rodam comando do sistema', () => {
  // `exec`/`spawn` seriam a porta de servico para tudo o que o teste acima fecha:
  // um `exec("sed -i ...")` altera codigo sem um unico `writeFileSync`.
  for (const arquivo of NO_BANCO) {
    const codigo = semComentarios(ler(arquivo))
    for (const chamada of ['child_process', 'execSync', 'spawnSync', 'spawn(', 'exec(']) {
      assert.ok(
        !codigo.includes(chamada),
        `${arquivo} roda comando do sistema (${chamada}). Isso contorna a regra de ` +
          '"so dado, nunca codigo" sem precisar escrever arquivo.',
      )
    }
  }
})

test('a skill grava pelo caminho autorizado do app, nunca por insert proprio', () => {
  const subir = semComentarios(ler(`${SKILL}/subir.mjs`))
  assert.ok(
    /await autorizar\(/.test(subir) && /await aplicar\(/.test(subir),
    'subir.mjs deixou de passar por autorizar/aplicar. Sem eles a skill escreve ' +
      'onde a pessoa nao poderia: um visualizador ganharia a viagem inteira, e a ' +
      'documentacao pessoal alheia deixaria de ter dono.',
  )
  assert.ok(
    /exigirViagem\(/.test(subir),
    'subir.mjs precisa montar o Acesso por exigirViagem: e ele que confere o PAPEL ' +
      'contra a tabela travelers, em vez de confiar no que foi digitado na linha de comando.',
  )
  assert.ok(
    !/insert\s+into\s+(itinerary_events|flights|expenses|documents|travelers|trips)/i.test(subir),
    'subir.mjs voltou a inserir direto numa tabela do app, contornando a autorizacao.',
  )
  assert.ok(
    /validarImportacao\(/.test(subir),
    'subir.mjs parou de validar contra o contrato do app antes de gravar. Meia ' +
      'viagem gravada e pior do que nenhuma: ela ja esta na tela de outras pessoas.',
  )
})

test('o desfazer da skill autoriza linha a linha e filtra a coluna', () => {
  const desfazer = semComentarios(ler(`${SKILL}/desfazer.mjs`))
  // O `lote` viaja no snapshot para todo participante. Reverter sem `autorizar`
  // por linha e escalada de privilegio — foi assim que uma rota de desfazer
  // anterior deixou um editor reverter o documento pessoal de outra pessoa.
  assert.ok(
    /await autorizar\(/.test(desfazer),
    'desfazer.mjs reverte sem consultar autorizar: escalada de privilegio',
  )
  // `campo` vem do banco e entra num `set <campo> = $1`.
  assert.ok(
    /colunaValida\(/.test(desfazer),
    'desfazer.mjs interpola `campo` no SQL sem a lista branca de colunas',
  )
})

test('a skill le o contrato do app em vez de manter uma copia', () => {
  // O risco especifico e o zod DESCARTAR chave desconhecida em silencio: uma
  // secao renomeada nao da erro, importa vazia. A skill so percebe isso se
  // perguntar ao schema.
  const campos = ler(`${SKILL}/campos.mjs`)
  assert.ok(
    /SECOES_ARQUIVO/.test(campos) && /lib', 'schema.ts'/.test(campos),
    'campos.mjs parou de ler SECOES_ARQUIVO de lib/schema.ts. A skill volta a ' +
      'depender da propria documentacao, que envelhece sem avisar.',
  )
})

test('todo on conflict do caminho de escrita casa com um unique do banco', () => {
  // O Postgres casa o `on conflict` com um INDICE, nao com uma coluna. `dia:
  // ['dia']` nao casava com `unique (trip_id, dia)`, e criar um dia do roteiro
  // morria com "no unique or exclusion constraint matching the ON CONFLICT
  // specification" -- 500 em toda anotacao de dia novo, na tela e na fila
  // offline, e verde em todo teste unitario, porque nenhum deles toca o banco.
  const escrita = ler('lib/escrita.ts')
  const schema = ler('db/schema.sql')
  const bloco = /const CHAVE_UPSERT[^=]*=\s*\{([\s\S]*?)\}/.exec(escrita)?.[1] ?? ''
  assert.ok(bloco, 'nao achei CHAVE_UPSERT em lib/escrita.ts')

  const uniques = [...schema.matchAll(/unique \(([^)]+)\)/g)].map((m) =>
    m[1].split(',').map((c) => c.trim()).sort().join(','),
  )
  const chaves = [...bloco.matchAll(/(\w+):\s*\[([^\]]+)\]/g)]
  assert.ok(chaves.length > 0, 'CHAVE_UPSERT ficou vazio')

  for (const [, entidade, lista] of chaves) {
    const colunas = lista
      .split(',')
      .map((c) => c.trim().replace(/['"]/g, ''))
      .sort()
      .join(',')
    assert.ok(
      uniques.includes(colunas),
      `o upsert de "${entidade}" usa on conflict (${colunas}), e db/schema.sql nao ` +
        'tem um `unique` com exatamente essas colunas. Todo `criar` dessa entidade ' +
        'vira 500 no banco e passa limpo aqui.',
    )
  }
})
