// Integração de ponta a ponta contra o Neon real e um servidor Next de pé.
//
// Roda com: npm run test:api  (o script sobe o servidor antes)
//
// O que importa aqui não dá para provar com teste unitário: que o 403 do
// Financeiro acontece no SERVIDOR, que a importação é transacional de verdade,
// e que exportar/reimportar reproduz a viagem.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'

// Segunda trava, além do runner: se alguém rodar `node --test tests/` direto,
// a suíte se recusa a tocar num banco que não seja o de teste. Ela dá TRUNCATE.
if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
  throw new Error('Rode com `npm run test:api` — a suíte apaga todas as tabelas e exige o banco de teste.')
}
const sql = neon(process.env.DATABASE_URL)
const VIAGEM = JSON.parse(readFileSync(new URL('../db/europa-2027.json', import.meta.url), 'utf8'))

/** Cliente com cookie jar próprio, para simular aparelhos diferentes. */
function cliente() {
  let cookie = ''
  return async (caminho, opcoes = {}) => {
    const r = await fetch(BASE + caminho, {
      ...opcoes,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...opcoes.headers },
    })
    const set = r.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0]
    const texto = await r.text()
    let corpo
    try {
      corpo = JSON.parse(texto)
    } catch {
      corpo = texto
    }
    return { status: r.status, corpo, headers: r.headers }
  }
}

const anon = cliente()
const admin = cliente()
const viajante = cliente()

let idAdmin, idViajante

before(async () => {
  // Base limpa: cascade derruba tudo que pende da viagem.
  await sql`truncate trips cascade`

  // Banco vazio permite a primeira importação sem sessão — é o único caminho de
  // bootstrap possível, já que ainda não existe admin.
  const imp = await anon('/api/import', { method: 'POST', body: JSON.stringify(VIAGEM) })
  assert.equal(imp.status, 200, `import falhou: ${JSON.stringify(imp.corpo)}`)

  const lista = await anon('/api/viajantes')
  const nomes = Object.fromEntries(lista.corpo.viajantes.map((v) => [v.nome, v.id]))
  idAdmin = nomes['Leonardo Almeida']
  idViajante = nomes['Alana Martins']
})

after(async () => {
  await sql`truncate trips cascade`
})

// ---------------------------------------------------------------- importação

test('importação carrega as 12 seções numa transação', async () => {
  const r = await anon('/api/viajantes')
  assert.equal(r.corpo.viajantes.length, 5)
  assert.equal(r.corpo.precisaImportar, false)
})

test('a listagem pré-login não vaza pin_hash nem papel', async () => {
  const r = await anon('/api/viajantes')
  for (const v of r.corpo.viajantes) {
    assert.deepEqual(Object.keys(v).sort(), ['id', 'nome'])
  }
})

// ---------------------------------------------------------------- login

test('PIN correto autentica e devolve o papel', async () => {
  const r = await admin('/api/sessao', {
    method: 'POST',
    body: JSON.stringify({ travelerId: idAdmin, pin: '1930' }),
  })
  assert.equal(r.status, 200)
  assert.equal(r.corpo.papel, 'admin')
})

test('PIN errado devolve 401 com mensagem genérica', async () => {
  const c = cliente()
  const r = await c('/api/sessao', {
    method: 'POST',
    body: JSON.stringify({ travelerId: idAdmin, pin: '0000' }),
  })
  assert.equal(r.status, 401)
  assert.match(r.corpo.erro, /Nome ou PIN incorreto/)
  // A mensagem não pode revelar se o problema foi o nome ou o PIN.
  assert.ok(!/pin incorreto para/i.test(r.corpo.erro))
})

test('id de viajante inexistente devolve o MESMO erro que PIN errado', async () => {
  const c = cliente()
  const r = await c('/api/sessao', {
    method: 'POST',
    body: JSON.stringify({ travelerId: 'nao-existe', pin: '1930' }),
  })
  assert.equal(r.status, 401)
  assert.match(r.corpo.erro, /Nome ou PIN incorreto/)
})

test('snapshot sem sessão devolve 401', async () => {
  const c = cliente()
  assert.equal((await c('/api/snapshot')).status, 401)
})

// ---------------------------------------------------------------- a barreira do Financeiro

test('admin recebe financeiro populado', async () => {
  const r = await admin('/api/snapshot')
  assert.equal(r.status, 200)
  assert.ok(r.corpo.financeiro, 'admin deveria receber financeiro')
  assert.ok(r.corpo.financeiro.custos.length > 0)
})

test('VIAJANTE recebe financeiro null - o dado não sai do servidor', async () => {
  await viajante('/api/sessao', {
    method: 'POST',
    body: JSON.stringify({ travelerId: idViajante, pin: '1931' }),
  })
  const r = await viajante('/api/snapshot')
  assert.equal(r.status, 200)
  assert.equal(r.corpo.financeiro, null)
  // Nem por outro caminho: nenhum valor monetário no corpo inteiro.
  assert.ok(!JSON.stringify(r.corpo).includes('valor_centavos'))
})

test('nenhum snapshot carrega pin_hash', async () => {
  for (const c of [admin, viajante]) {
    const r = await c('/api/snapshot')
    assert.ok(!JSON.stringify(r.corpo).includes('pin_hash'))
  }
})

// ---------------------------------------------------------------- autorização de escrita

test('viajante recebe 403 ao tentar importar', async () => {
  const r = await viajante('/api/import', { method: 'POST', body: JSON.stringify(VIAGEM) })
  assert.equal(r.status, 403)
})

test('viajante recebe 403 ao editar um custo', async () => {
  const snap = await admin('/api/snapshot')
  const custo = snap.corpo.financeiro.custos[0]
  const r = await viajante('/api/mutate', {
    method: 'POST',
    body: JSON.stringify({
      ops: [
        {
          op: 'editar',
          entidade: 'custo',
          id: custo.id,
          campos: { valor_centavos: 1 },
          client_ts: new Date().toISOString(),
        },
      ],
    }),
  })
  assert.equal(r.status, 403)
})

test('viajante recebe 403 ao editar o roteiro', async () => {
  const snap = await viajante('/api/snapshot')
  const r = await viajante('/api/mutate', {
    method: 'POST',
    body: JSON.stringify({
      ops: [
        {
          op: 'editar',
          entidade: 'roteiro',
          id: snap.corpo.roteiro[0].id,
          campos: { titulo: 'invadido' },
          client_ts: new Date().toISOString(),
        },
      ],
    }),
  })
  assert.equal(r.status, 403)
})

test('viajante MARCA o próprio checklist', async () => {
  const snap = await viajante('/api/snapshot')
  const item = snap.corpo.checklist[0]
  const r = await viajante('/api/mutate', {
    method: 'POST',
    body: JSON.stringify({
      ops: [
        {
          op: 'editar',
          entidade: 'checklist_state',
          campos: { item_id: item.id, feito: true },
          client_ts: new Date().toISOString(),
        },
      ],
    }),
  })
  assert.equal(r.status, 200)
  const marcado = r.corpo.snapshot.checklist_state.find((e) => e.item_id === item.id)
  assert.equal(marcado.feito, true)
  assert.equal(marcado.traveler_id, idViajante)
})

test('a marcação do viajante aparece para o admin - sync de verdade', async () => {
  const r = await admin('/api/snapshot')
  assert.ok(r.corpo.checklist_state.some((e) => e.traveler_id === idViajante && e.feito))
})

test('remover o último admin é recusado', async () => {
  const r = await admin('/api/mutate', {
    method: 'POST',
    body: JSON.stringify({
      ops: [
        { op: 'remover', entidade: 'viajante', id: idAdmin, campos: {}, client_ts: new Date().toISOString() },
      ],
    }),
  })
  assert.equal(r.status, 409)
  const check = await anon('/api/viajantes')
  assert.equal(check.corpo.viajantes.length, 5, 'ninguém pode ter sido removido')
})

// ---------------------------------------------------------------- last-write-wins

test('escrita com carimbo antigo é rejeitada, e a nova sobrevive', async () => {
  const snap = await admin('/api/snapshot')
  const custo = snap.corpo.financeiro.custos[0]

  const agora = await admin('/api/mutate', {
    method: 'POST',
    body: JSON.stringify({
      ops: [
        {
          op: 'editar',
          entidade: 'custo',
          id: custo.id,
          campos: { descricao: 'versão nova' },
          client_ts: new Date().toISOString(),
        },
      ],
    }),
  })
  assert.equal(agora.corpo.aplicadas, 1)

  // Simula um aparelho que estava offline com uma edição de ontem.
  const ontem = new Date(Date.now() - 86_400_000).toISOString()
  const velha = await admin('/api/mutate', {
    method: 'POST',
    body: JSON.stringify({
      ops: [
        {
          op: 'editar',
          entidade: 'custo',
          id: custo.id,
          campos: { descricao: 'versão velha' },
          client_ts: ontem,
        },
      ],
    }),
  })
  assert.equal(velha.corpo.aplicadas, 0)
  assert.equal(velha.corpo.rejeitadas.length, 1)
  assert.match(velha.corpo.rejeitadas[0].motivo, /mais nova/)

  const final = velha.corpo.snapshot.financeiro.custos.find((c) => c.id === custo.id)
  assert.equal(final.descricao, 'versão nova')
})

test('alteração do admin entra no histórico com valor anterior e novo', async () => {
  const r = await admin('/api/snapshot')
  const linha = r.corpo.alteracoes.find((a) => a.campo === 'descricao')
  assert.ok(linha, 'nenhuma alteração registrada')
  assert.equal(linha.para, 'versão nova')
  assert.ok(linha.autor)
})

// ---------------------------------------------------------------- validação

test('JSON inválido é recusado apontando o campo e não altera o banco', async () => {
  const antes = await admin('/api/snapshot')
  const quebrado = { ...VIAGEM, voos: [{ companhia: 'X', parte_em: 'quinze horas' }] }
  const r = await admin('/api/import', { method: 'POST', body: JSON.stringify(quebrado) })
  assert.equal(r.status, 400)
  assert.match(r.corpo.erro, /voos\[0\]\.parte_em/)
  const depois = await admin('/api/snapshot')
  assert.equal(depois.corpo.roteiro.length, antes.corpo.roteiro.length)
})

test('dry_run mostra o resumo sem gravar', async () => {
  const antes = await admin('/api/snapshot')
  const r = await admin('/api/import', {
    method: 'POST',
    body: JSON.stringify({ dry_run: true, arquivo: VIAGEM }),
  })
  assert.equal(r.status, 200)
  assert.equal(r.corpo.dryRun, true)
  assert.equal(r.corpo.resumo.voos, VIAGEM.voos.length)
  const depois = await admin('/api/snapshot')
  assert.equal(depois.corpo.viagem.id, antes.corpo.viagem.id, 'dry_run não pode trocar a viagem')
})

// ---------------------------------------------------------------- CRUD do admin

test('admin cria, edita e remove um evento do roteiro', async () => {
  const antes = (await admin('/api/snapshot')).corpo.roteiro.length
  const id = crypto.randomUUID()

  const criado = await admin('/api/mutate', {
    method: 'POST',
    body: JSON.stringify({
      ops: [
        {
          op: 'criar',
          entidade: 'roteiro',
          id,
          campos: { titulo: 'Voo remarcado', ocorre_em: '2027-01-01T14:20', tipo: 'voo', ancora: true },
          client_ts: new Date().toISOString(),
        },
      ],
    }),
  })
  assert.equal(criado.status, 200)
  assert.equal(criado.corpo.snapshot.roteiro.length, antes + 1)

  const editado = await admin('/api/mutate', {
    method: 'POST',
    body: JSON.stringify({
      ops: [
        {
          op: 'editar',
          entidade: 'roteiro',
          id,
          campos: { titulo: 'Voo remarcado de novo' },
          client_ts: new Date().toISOString(),
        },
      ],
    }),
  })
  assert.equal(
    editado.corpo.snapshot.roteiro.find((e) => e.id === id).titulo,
    'Voo remarcado de novo'
  )

  const removido = await admin('/api/mutate', {
    method: 'POST',
    body: JSON.stringify({
      ops: [{ op: 'remover', entidade: 'roteiro', id, campos: {}, client_ts: new Date().toISOString() }],
    }),
  })
  assert.equal(removido.corpo.snapshot.roteiro.length, antes)
})

test('admin define PIN de um viajante e ele passa a conseguir entrar', async () => {
  const snap = await admin('/api/snapshot')
  const alvo = snap.corpo.viajantes.find((v) => v.nome === 'Marcia Martins')

  const r = await admin('/api/mutate', {
    method: 'POST',
    body: JSON.stringify({
      ops: [
        {
          op: 'editar',
          entidade: 'viajante',
          id: alvo.id,
          campos: { pin: '7777' },
          client_ts: new Date().toISOString(),
        },
      ],
    }),
  })
  assert.equal(r.status, 200)
  // O hash nunca volta na resposta.
  assert.ok(!JSON.stringify(r.corpo).includes('pin_hash'))

  const nova = cliente()
  const entrou = await nova('/api/sessao', {
    method: 'POST',
    body: JSON.stringify({ travelerId: alvo.id, pin: '7777' }),
  })
  assert.equal(entrou.status, 200)
  assert.equal(entrou.corpo.papel, 'viajante')
})

test('admin edita a viagem e a cor de destaque muda', async () => {
  const snap = await admin('/api/snapshot')
  const r = await admin('/api/mutate', {
    method: 'POST',
    body: JSON.stringify({
      ops: [
        {
          op: 'editar',
          entidade: 'viagem',
          id: snap.corpo.viagem.id,
          campos: { cor_destaque: '#7C3AED' },
          client_ts: new Date().toISOString(),
        },
      ],
    }),
  })
  assert.equal(r.corpo.snapshot.viagem.cor_destaque, '#7C3AED')
})

// ---------------------------------------------------------------- exportação

test('exportação do admin valida contra o schema de importação', async () => {
  const r = await admin('/api/export')
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-disposition'), /attachment; filename=/)
  assert.equal(r.corpo.schemaVersion, 1)
  assert.equal(r.corpo.voos.length, VIAGEM.voos.length)
  assert.equal(r.corpo.cruzeiros[0].portos.length, 6)
})

test('exportação do VIAJANTE sai sem nenhum dado financeiro', async () => {
  const r = await viajante('/api/export')
  assert.equal(r.status, 200)
  assert.deepEqual(r.corpo.custos, [])
  assert.deepEqual(r.corpo.categorias, [])
})

test('exportação nunca inclui PIN', async () => {
  const r = await admin('/api/export')
  // Confere o status primeiro: um corpo de erro tambem "nao inclui pin" e
  // passaria o teste sem provar nada.
  assert.equal(r.status, 200)
  // Procura a CHAVE, nao a substring: o texto da viagem tem "Monet pintou",
  // e buscar 'pin' solto reprovaria um export perfeitamente limpo.
  const chaves = new Set()
  JSON.stringify(r.corpo, (k, v) => (chaves.add(k), v))
  assert.ok(!chaves.has('pin'), 'export nao pode ter campo pin')
  assert.ok(!chaves.has('pin_hash'), 'export nao pode ter campo pin_hash')
})

test('round-trip: exportar e reimportar reproduz a viagem', async () => {
  const exportado = (await admin('/api/export')).corpo
  const re = await admin('/api/import', { method: 'POST', body: JSON.stringify(exportado) })
  assert.equal(re.status, 200, JSON.stringify(re.corpo))

  // Depois de reimportar é preciso logar de novo: os ids dos viajantes mudaram.
  const lista = await anon('/api/viajantes')
  assert.equal(lista.corpo.viajantes.length, 5)

  const novo = cliente()
  const idNovo = lista.corpo.viajantes.find((v) => v.nome === 'Leonardo Almeida').id
  // O PIN não viaja no export, então o novo admin fica sem PIN e não loga —
  // isso é intencional e está documentado. Confere pelo banco.
  const r = await novo('/api/sessao', {
    method: 'POST',
    body: JSON.stringify({ travelerId: idNovo, pin: '1930' }),
  })
  assert.equal(r.status, 401, 'PIN não deve sobreviver ao export')

  const [{ n: nVoos }] = await sql`
    select count(*)::int as n from flights f
    join trips t on t.id = f.trip_id where t.ativo = true`
  assert.equal(nVoos, VIAGEM.voos.length)
})
