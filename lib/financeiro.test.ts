// Testes do motor financeiro. `npm run test`, runner nativo do Node, sem framework.
//
// Os casos sao os cenarios obrigatorios do modulo, na ordem em que foram pedidos:
// divisao igual, um pagando tudo, divisao por peso (casal), valor personalizado,
// parcelamento, atraso, pagamento parcial, quitacao, viajante sem obrigacao,
// viajante com varios credores, saldos cruzados e simplificacao de dividas.
//
// A invariante que quase todo teste confere de um jeito ou de outro: NENHUM
// CENTAVO APARECE OU SOME. A soma das partes e sempre igual ao total.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  repartir,
  resolverDivisao,
  gerarParcelas,
  statusParcela,
  diasDeAtraso,
  parcelasDe,
  totaisViagem,
  saldos,
  simplificar,
  obrigacoesDe,
  resumoPessoal,
  porCategoria,
  porParticipante,
  porMes,
  parcelasDaViagem,
  origemDaDivida,
  paraDia,
  percentual,
  type Despesa,
  type LinhaDivisao,
  type Parcela,
  type Pagamento,
} from './financeiro.ts'

const HOJE = new Date(2026, 10, 15) // 15/11/2026, local

const PESSOAS = [
  { id: 'leo', nome: 'Leonardo' },
  { id: 'alana', nome: 'Alana' },
  { id: 'joao', nome: 'João' },
  { id: 'maria', nome: 'Maria' },
  { id: 'pedro', nome: 'Pedro' },
]

const TODOS = PESSOAS.map((p) => ({ traveler_id: p.id }))

/** Monta o conjunto financeiro completo a partir de despesas ja divididas. */
function dados(partes: {
  despesas?: Despesa[]
  divisoes?: LinhaDivisao[]
  parcelas?: Parcela[]
  pagamentos?: Pagamento[]
}) {
  return {
    categorias: [{ id: 'transporte', nome: 'Transporte' }],
    despesas: partes.despesas ?? [],
    divisoes: partes.divisoes ?? [],
    parcelas: partes.parcelas ?? [],
    pagamentos: partes.pagamentos ?? [],
    participantes: PESSOAS,
  }
}

const somar = (ns: number[]) => ns.reduce((a, b) => a + b, 0)

// ---------------------------------------------------------------- repartir

test('repartir divide igualmente sem sobrar centavo', () => {
  const p = repartir(500000, [1, 1, 1, 1, 1])
  assert.deepEqual(p, [100000, 100000, 100000, 100000, 100000])
  assert.equal(somar(p), 500000)
})

test('repartir fecha a soma exata quando o valor nao e divisivel', () => {
  // 1000,00 em 9 partes: 111,11 cada sobraria 1 centavo fora da conta.
  const p = repartir(100000, [2, 2, 2, 2, 1])
  assert.equal(somar(p), 100000, 'a soma TEM que ser o total')
  assert.equal(p[4], 11111, 'a parte de peso 1 e metade das outras')
  assert.equal(Math.max(...p) - Math.min(...p.slice(0, 4)), 1, 'o centavo extra e um so')
})

test('repartir distribui o centavo pelo maior resto, deterministicamente', () => {
  const a = repartir(10, [1, 1, 1])
  const b = repartir(10, [1, 1, 1])
  assert.deepEqual(a, b, 'mesma entrada, mesma saida')
  assert.equal(somar(a), 10)
  assert.deepEqual(a, [4, 3, 3])
})

test('repartir com todos os pesos zerados cai na divisao igual', () => {
  assert.deepEqual(repartir(300, [0, 0, 0]), [100, 100, 100])
})

test('repartir aguenta entrada suja sem devolver NaN', () => {
  assert.deepEqual(repartir(NaN as unknown as number, [1, 1]), [0, 0])
  assert.deepEqual(repartir(-500, [1, 1]), [0, 0])
  assert.deepEqual(repartir(100, []), [])
})

// ---------------------------------------------------------------- cenario 1 e 2

test('cenario 1 e 2: uma pessoa paga 5.000 e cinco dividem igualmente', () => {
  const linhas = resolverDivisao(500000, 'igual', TODOS)
  assert.equal(somar(linhas.map((l) => l.valor_centavos)), 500000)
  for (const l of linhas) assert.equal(l.valor_centavos, 100000)

  const despesa: Despesa = {
    id: 'd1',
    descricao: 'Passagem',
    valor_centavos: 500000,
    traveler_id: 'leo',
  }
  const divisoes = linhas.map((l) => ({ ...l, expense_id: 'd1' }))
  const s = saldos(PESSOAS, [despesa], divisoes, [])

  const leo = s.find((x) => x.traveler_id === 'leo')!
  assert.equal(leo.pagou, 500000)
  assert.equal(leo.deve, 100000)
  assert.equal(leo.saldo, 400000, 'quem adiantou fica com 4.000 a receber')

  for (const id of ['alana', 'joao', 'maria', 'pedro']) {
    assert.equal(s.find((x) => x.traveler_id === id)!.saldo, -100000, `${id} deve 1.000`)
  }
  assert.equal(somar(s.map((x) => x.saldo)), 0, 'a soma dos saldos e sempre zero')
})

// ---------------------------------------------------------------- cenario 3

test('cenario 3: divisao por peso 2/2/2/2/1 fecha em 1.000,00', () => {
  const linhas = resolverDivisao(
    100000,
    'peso',
    PESSOAS.map((p) => ({ traveler_id: p.id, peso: p.id === 'pedro' ? 1 : 2 })),
  )
  assert.equal(somar(linhas.map((l) => l.valor_centavos)), 100000)
  assert.equal(linhas.find((l) => l.traveler_id === 'pedro')!.valor_centavos, 11111)
  // Os quatro casais ficam com 222,22 ou 222,23 — a diferenca e o centavo de sobra.
  for (const l of linhas.filter((x) => x.traveler_id !== 'pedro')) {
    assert.ok(l.valor_centavos === 22222 || l.valor_centavos === 22223)
  }
})

// ---------------------------------------------------------------- cenario 4

test('cenario 4: valor personalizado e usado como digitado', () => {
  const linhas = resolverDivisao(500000, 'personalizado', [
    { traveler_id: 'leo', valor_centavos: 150000 },
    { traveler_id: 'alana', valor_centavos: 150000 },
    { traveler_id: 'joao', valor_centavos: 80000 },
    { traveler_id: 'maria', valor_centavos: 80000 },
    { traveler_id: 'pedro', valor_centavos: 40000 },
  ])
  assert.deepEqual(
    linhas.map((l) => l.valor_centavos),
    [150000, 150000, 80000, 80000, 40000],
  )
  assert.equal(somar(linhas.map((l) => l.valor_centavos)), 500000)
})

test('divisao personalizada que nao fecha NAO e corrigida em silencio', () => {
  // Corrigir aqui esconderia o erro; quem barra e o formulario, com a mensagem
  // dizendo o valor certo.
  const linhas = resolverDivisao(500000, 'personalizado', [
    { traveler_id: 'leo', valor_centavos: 100000 },
    { traveler_id: 'alana', valor_centavos: 100000 },
  ])
  assert.equal(somar(linhas.map((l) => l.valor_centavos)), 200000)
})

// ---------------------------------------------------------------- cenario 5

test('cenario 5: 4.800 em 8 parcelas mensais a partir de 10/09/2026', () => {
  const p = gerarParcelas(480000, 8, '2026-09-10', 'mensal')
  assert.equal(p.length, 8)
  assert.equal(somar(p.map((x) => x.valor_centavos)), 480000, 'a soma das parcelas e o total')
  for (const x of p) assert.equal(x.valor_centavos, 60000)
  assert.equal(p[0].vence_em, '2026-09-10')
  assert.equal(p[1].vence_em, '2026-10-10')
  assert.equal(p[7].vence_em, '2027-04-10')
})

test('parcelamento indivisivel ainda soma o total exato', () => {
  const p = gerarParcelas(100000, 3, '2026-09-01')
  assert.equal(somar(p.map((x) => x.valor_centavos)), 100000)
  assert.deepEqual(
    p.map((x) => x.valor_centavos),
    [33334, 33333, 33333],
  )
})

test('parcela mensal preserva o dia do mes em vez de estourar para o mes seguinte', () => {
  // 31/01 + 1 mes tem que ser 28/02, nunca 03/03.
  const p = gerarParcelas(300, 3, '2026-01-31', 'mensal')
  assert.deepEqual(
    p.map((x) => x.vence_em),
    ['2026-01-31', '2026-02-28', '2026-03-31'],
  )
})

test('parcelamento aceita frequencia semanal e quinzenal', () => {
  assert.equal(gerarParcelas(200, 2, '2026-09-10', 'semanal')[1].vence_em, '2026-09-17')
  assert.equal(gerarParcelas(200, 2, '2026-09-10', 'quinzenal')[1].vence_em, '2026-09-25')
})

test('a vista e uma parcela unica, nao um caminho separado', () => {
  const p = gerarParcelas(75000, 1, '2026-08-20')
  assert.deepEqual(p, [{ numero: 1, vence_em: '2026-08-20', valor_centavos: 75000 }])
})

// ---------------------------------------------------------------- cenarios 6, 7, 8

test('cenario 6: parcela vencida em 10/11 esta atrasada ha 5 dias em 15/11', () => {
  const p = { vence_em: '2026-11-10', valor_centavos: 60000, pago_centavos: 0 }
  assert.equal(statusParcela(p, HOJE), 'atrasada')
  assert.equal(diasDeAtraso(p.vence_em, HOJE), 5)
})

test('cenario 7: pagamento parcial fica marcado como parcial, com o resto visivel', () => {
  const p = { vence_em: '2026-12-20', valor_centavos: 30000, pago_centavos: 15000 }
  assert.equal(statusParcela(p, HOJE), 'parcial')
  assert.equal(p.valor_centavos - p.pago_centavos, 15000)
})

test('parcela vencida e so parcialmente paga aparece como atrasada, nao como parcial', () => {
  const p = { vence_em: '2026-11-01', valor_centavos: 30000, pago_centavos: 15000 }
  assert.equal(statusParcela(p, HOJE), 'atrasada')
})

test('cenario 8: parcela quitada e paga, mesmo pagando a mais', () => {
  assert.equal(
    statusParcela({ vence_em: '2026-11-01', valor_centavos: 100, pago_centavos: 100 }, HOJE),
    'paga',
  )
  assert.equal(
    statusParcela({ vence_em: '2026-11-01', valor_centavos: 100, pago_centavos: 150 }, HOJE),
    'paga',
  )
})

test('vencimento de hoje e "hoje", e o de amanha e "futura"', () => {
  assert.equal(statusParcela({ vence_em: '2026-11-15', valor_centavos: 100 }, HOJE), 'hoje')
  assert.equal(statusParcela({ vence_em: '2026-11-16', valor_centavos: 100 }, HOJE), 'futura')
})

test('parcela sem data de vencimento fica pendente, nunca atrasada', () => {
  assert.equal(statusParcela({ vence_em: null, valor_centavos: 100 }, HOJE), 'pendente')
})

// ---------------------------------------------------------------- obrigacoes individuais

/** O exemplo do brief: 4.800 em 8x, cinco pessoas, Leonardo pagou. */
function passagemParcelada() {
  const despesa: Despesa = {
    id: 'd1',
    descricao: 'Passagem aérea',
    categoria_id: 'transporte',
    valor_centavos: 480000,
    traveler_id: 'leo',
  }
  const divisoes = resolverDivisao(480000, 'igual', TODOS).map((l) => ({ ...l, expense_id: 'd1' }))
  const parcelas: Parcela[] = gerarParcelas(480000, 8, '2026-09-10').map((p) => ({
    id: `p${p.numero}`,
    expense_id: 'd1',
    numero: p.numero,
    vence_em: p.vence_em,
    valor_centavos: p.valor_centavos,
    pago_centavos: 0,
  }))
  return { despesa, divisoes, parcelas }
}

test('a parte de cada pessoa numa parcela e 120, nunca os 600 da parcela cheia', () => {
  const { despesa, divisoes, parcelas } = passagemParcelada()
  const o = obrigacoesDe('alana', dados({ despesas: [despesa], divisoes, parcelas }), HOJE)

  assert.equal(o.length, 8)
  for (const x of o) {
    assert.equal(x.valor_centavos, 12000, 'a parte dela, nao o valor da parcela')
    assert.equal(x.para, 'Leonardo')
    assert.equal(x.total_parcelas, 8)
  }
  assert.equal(somar(o.map((x) => x.valor_centavos)), 96000, 'as 8 partes somam os 960 dela')
})

test('quem pagou nao deve para si mesmo', () => {
  const { despesa, divisoes, parcelas } = passagemParcelada()
  assert.deepEqual(
    obrigacoesDe('leo', dados({ despesas: [despesa], divisoes, parcelas }), HOJE),
    [],
  )
})

test('cenario 9: viajante fora da despesa nao ve nada dela', () => {
  const despesa: Despesa = {
    id: 'h1',
    descricao: 'Hotel de João e Maria',
    valor_centavos: 200000,
    traveler_id: 'joao',
  }
  const divisoes: LinhaDivisao[] = [
    { expense_id: 'h1', traveler_id: 'joao', peso: 1, valor_centavos: 100000 },
    { expense_id: 'h1', traveler_id: 'maria', peso: 1, valor_centavos: 100000 },
  ]
  const r = resumoPessoal('leo', dados({ despesas: [despesa], divisoes }), HOJE)

  assert.deepEqual(r.obrigacoes, [], 'a despesa simplesmente nao existe para ele')
  assert.equal(r.devendo, 0)
  assert.equal(JSON.stringify(r).includes('Hotel'), false, 'nem o nome da despesa vaza')
  assert.equal(JSON.stringify(r).includes('200000'), false, 'nem o valor do grupo vaza')
})

test('cenario 10: tres despesas de credores diferentes viram tres obrigacoes', () => {
  const despesas: Despesa[] = [
    { id: 'a', descricao: 'Passagem', valor_centavos: 24000, traveler_id: 'leo' },
    { id: 'b', descricao: 'Hotel', valor_centavos: 36000, traveler_id: 'alana' },
    { id: 'c', descricao: 'Seguro', valor_centavos: 7000, traveler_id: 'leo' },
  ]
  const divisoes: LinhaDivisao[] = [
    { expense_id: 'a', traveler_id: 'leo', peso: 1, valor_centavos: 12000 },
    { expense_id: 'a', traveler_id: 'pedro', peso: 1, valor_centavos: 12000 },
    { expense_id: 'b', traveler_id: 'alana', peso: 1, valor_centavos: 18000 },
    { expense_id: 'b', traveler_id: 'pedro', peso: 1, valor_centavos: 18000 },
    { expense_id: 'c', traveler_id: 'leo', peso: 1, valor_centavos: 3500 },
    { expense_id: 'c', traveler_id: 'pedro', peso: 1, valor_centavos: 3500 },
  ]
  const parcelas: Parcela[] = [
    {
      id: 'pa',
      expense_id: 'a',
      numero: 1,
      vence_em: '2026-09-10',
      valor_centavos: 24000,
      pago_centavos: 0,
    },
    {
      id: 'pb',
      expense_id: 'b',
      numero: 1,
      vence_em: '2026-09-15',
      valor_centavos: 36000,
      pago_centavos: 0,
    },
    {
      id: 'pc',
      expense_id: 'c',
      numero: 1,
      vence_em: '2026-09-20',
      valor_centavos: 7000,
      pago_centavos: 0,
    },
  ]

  const r = resumoPessoal('pedro', dados({ despesas, divisoes, parcelas }), HOJE)
  assert.equal(r.obrigacoes.length, 3)
  assert.deepEqual(
    r.obrigacoes.map((o) => [o.descricao, o.valor_centavos, o.para]),
    [
      ['Passagem', 12000, 'Leonardo'],
      ['Hotel', 18000, 'Alana'],
      ['Seguro', 3500, 'Leonardo'],
    ],
    'em ordem de vencimento',
  )
  assert.equal(r.devendo, 33500)
})

test('pagamento parcial abate a obrigacao da pessoa e mantem o resto visivel', () => {
  const { despesa, divisoes, parcelas } = passagemParcelada()
  const pagamentos: Pagamento[] = [
    {
      id: 'g1',
      de_id: 'alana',
      para_id: 'leo',
      parcela_id: 'p1',
      valor_centavos: 5000,
      ocorre_em: '2026-09-10',
    },
  ]
  const r = resumoPessoal(
    'alana',
    dados({ despesas: [despesa], divisoes, parcelas, pagamentos }),
    HOJE,
  )

  const primeira = r.obrigacoes.find((o) => o.numero === 1)!
  assert.equal(primeira.pago_centavos, 5000)
  assert.equal(primeira.valor_centavos - primeira.pago_centavos, 7000)
  assert.equal(r.pago, 5000)
  assert.equal(r.devendo, 96000 - 5000)
})

test('reembolso de outra pessoa nao abate a obrigacao de quem esta olhando', () => {
  const { despesa, divisoes, parcelas } = passagemParcelada()
  const pagamentos: Pagamento[] = [
    {
      id: 'g1',
      de_id: 'joao',
      para_id: 'leo',
      parcela_id: 'p1',
      valor_centavos: 12000,
      ocorre_em: '2026-09-10',
    },
  ]
  const r = resumoPessoal(
    'alana',
    dados({ despesas: [despesa], divisoes, parcelas, pagamentos }),
    HOJE,
  )
  assert.equal(r.pago, 0, 'o pagamento do João não é dela')
  assert.equal(r.devendo, 96000)
})

test('o historico do viajante traz so os pagamentos dele', () => {
  const pagamentos: Pagamento[] = [
    { id: 'g1', de_id: 'alana', para_id: 'leo', valor_centavos: 12000, ocorre_em: '2026-08-10' },
    { id: 'g2', de_id: 'joao', para_id: 'leo', valor_centavos: 76000, ocorre_em: '2026-08-11' },
  ]
  const r = resumoPessoal('alana', dados({ pagamentos }), HOJE)
  assert.equal(r.historico.length, 1)
  assert.equal(r.historico[0].id, 'g1')
  assert.equal(JSON.stringify(r.historico).includes('76000'), false)
})

// ---------------------------------------------------------------- cenarios 11 e 12

test('cenario 11 e 12: dois credores, tres devedores, acerto minimizado', () => {
  const lista = [
    { traveler_id: 'leo', saldo: 124000 },
    { traveler_id: 'maria', saldo: 32000 },
    { traveler_id: 'alana', saldo: -48000 },
    { traveler_id: 'joao', saldo: -76000 },
    { traveler_id: 'pedro', saldo: -32000 },
  ]
  assert.equal(somar(lista.map((x) => x.saldo)), 0, 'fixture consistente')

  const acertos = simplificar(lista)
  assert.equal(
    somar(acertos.map((a) => a.valor_centavos)),
    156000,
    'move exatamente o credito total',
  )
  assert.ok(acertos.length <= lista.length - 1, 'no maximo n-1 transferencias')

  // Depois do acerto, todo mundo zera.
  const restante = new Map(lista.map((x) => [x.traveler_id, x.saldo]))
  for (const a of acertos) {
    restante.set(a.de, restante.get(a.de)! + a.valor_centavos)
    restante.set(a.para, restante.get(a.para)! - a.valor_centavos)
  }
  for (const [id, v] of restante) assert.equal(v, 0, `${id} deveria zerar`)
})

test('a divida em cadeia vira transferencia direta', () => {
  // A deve 500 a B, B deve 200 a C. O dinheiro nao precisa passar por B.
  const acertos = simplificar([
    { traveler_id: 'a', saldo: -50000 },
    { traveler_id: 'b', saldo: 30000 },
    { traveler_id: 'c', saldo: 20000 },
  ])
  assert.equal(acertos.length, 2)
  assert.deepEqual(acertos, [
    { de: 'a', para: 'b', valor_centavos: 30000 },
    { de: 'a', para: 'c', valor_centavos: 20000 },
  ])
})

test('grupo equilibrado nao gera nenhum acerto', () => {
  assert.deepEqual(
    simplificar([
      { traveler_id: 'a', saldo: 0 },
      { traveler_id: 'b', saldo: 0 },
    ]),
    [],
  )
})

// ---------------------------------------------------------------- saldos com reembolso

test('reembolso registrado zera o saldo de quem pagou', () => {
  const despesa: Despesa = {
    id: 'd1',
    descricao: 'Passagem',
    valor_centavos: 500000,
    traveler_id: 'leo',
  }
  const divisoes = resolverDivisao(500000, 'igual', TODOS).map((l) => ({ ...l, expense_id: 'd1' }))
  const pagamentos: Pagamento[] = [
    { id: 'g1', de_id: 'alana', para_id: 'leo', valor_centavos: 100000, ocorre_em: '2026-09-01' },
  ]
  const s = saldos(PESSOAS, [despesa], divisoes, pagamentos)
  assert.equal(s.find((x) => x.traveler_id === 'alana')!.saldo, 0, 'Alana quitou')
  assert.equal(
    s.find((x) => x.traveler_id === 'leo')!.saldo,
    300000,
    'Leonardo tem 3.000 a receber',
  )
  assert.equal(somar(s.map((x) => x.saldo)), 0)
})

test('despesa sem pagador nao entra no saldo de ninguem', () => {
  // É o estado normal de uma viagem em planejamento e de tudo que foi importado:
  // a despesa existe, mas ninguém adiantou o dinheiro ainda.
  const despesas: Despesa[] = [
    { id: 'd1', descricao: 'Passagens', valor_centavos: 500000, traveler_id: null },
    { id: 'd2', descricao: 'Hotel', valor_centavos: 200000 },
  ]
  const s = saldos(PESSOAS, despesas, [], [])
  for (const x of s) assert.equal(x.pagou, 0, `${x.traveler_id} não pagou nada`)
  assert.equal(somar(s.map((x) => x.saldo)), 0)
  // E continua contando no total da viagem.
  assert.equal(totaisViagem(despesas, []).total, 700000)
})

test('despesa sem pagador nao vira obrigacao de ninguem', () => {
  const despesas: Despesa[] = [{ id: 'd1', descricao: 'Passagens', valor_centavos: 500000 }]
  const divisoes = resolverDivisao(500000, 'igual', TODOS).map((l) => ({ ...l, expense_id: 'd1' }))
  assert.deepEqual(resumoPessoal('alana', dados({ despesas, divisoes }), HOJE).obrigacoes, [])
})

test('participante removido depois de aparecer numa despesa nao derruba o saldo', () => {
  const despesa: Despesa = {
    id: 'd1',
    descricao: 'x',
    valor_centavos: 1000,
    traveler_id: 'fantasma',
  }
  const s = saldos(PESSOAS, [despesa], [], [])
  assert.equal(s.find((x) => x.traveler_id === 'fantasma')!.pagou, 1000)
})

// ---------------------------------------------------------------- totais e relatorios

test('totais separam pago, aberto e parcelas ativas', () => {
  const { despesa, parcelas } = passagemParcelada()
  parcelas[0].pago_centavos = 60000
  parcelas[1].pago_centavos = 60000

  const t = totaisViagem([despesa], parcelas)
  assert.equal(t.total, 480000)
  assert.equal(t.pago, 120000)
  assert.equal(t.aberto, 360000)
  assert.equal(t.parcelasAbertas, 6)
  assert.equal(t.parcelasValor, 360000)
  assert.equal(t.pago + t.aberto, t.total, 'pago + aberto sempre fecha o total')
})

test('despesa a vista nao entra na contagem de parcelas ativas', () => {
  const d: Despesa = { id: 'x', descricao: 'Jantar', valor_centavos: 75000 }
  const p: Parcela[] = [
    {
      id: 'px',
      expense_id: 'x',
      numero: 1,
      vence_em: '2026-08-20',
      valor_centavos: 75000,
      pago_centavos: 0,
    },
  ]
  const t = totaisViagem([d], p)
  assert.equal(t.aberto, 75000)
  assert.equal(t.parcelasAbertas, 0)
})

test('despesa sem parcela cadastrada continua contando como uma parcela unica', () => {
  const d: Despesa = { id: 'y', descricao: 'Antiga', valor_centavos: 5000, ocorre_em: '2026-07-01' }
  const p = parcelasDe(d, [])
  assert.equal(p.length, 1)
  assert.equal(p[0].valor_centavos, 5000)
  assert.equal(p[0].vence_em, '2026-07-01')
  assert.equal(totaisViagem([d], []).total, 5000)
})

test('relatorio por categoria soma e ordena do maior para o menor', () => {
  const despesas: Despesa[] = [
    { id: '1', descricao: 'a', valor_centavos: 1000, categoria_id: 'transporte' },
    { id: '2', descricao: 'b', valor_centavos: 3000, categoria_id: 'transporte' },
    { id: '3', descricao: 'c', valor_centavos: 6000, categoria_id: null },
  ]
  const r = porCategoria(despesas, [{ id: 'transporte', nome: 'Transporte' }])
  assert.deepEqual(
    r.map((x) => [x.nome, x.total, x.pct]),
    [
      ['Sem categoria', 6000, 60],
      ['Transporte', 4000, 40],
    ],
  )
})

test('relatorio por participante usa a divisao, nao quem pagou', () => {
  const divisoes: LinhaDivisao[] = [
    { expense_id: 'd1', traveler_id: 'leo', peso: 1, valor_centavos: 10000 },
    { expense_id: 'd1', traveler_id: 'alana', peso: 1, valor_centavos: 30000 },
  ]
  const r = porParticipante(PESSOAS, divisoes)
  assert.equal(r[0].nome, 'Alana')
  assert.equal(r[0].total, 30000)
  assert.equal(r[0].pct, 75)
})

test('projecao mensal agrupa parcelas pelo mes de vencimento', () => {
  const { despesa, parcelas } = passagemParcelada()
  parcelas[0].pago_centavos = 60000
  const meses = porMes([despesa], parcelas)
  assert.equal(meses.length, 8)
  assert.equal(meses[0].mes, '2026-09')
  assert.equal(meses[0].total, 60000)
  assert.equal(meses[0].aberto, 0, 'a de setembro ja foi paga')
  assert.equal(meses[1].aberto, 60000)
})

test('as parcelas da viagem saem em ordem de vencimento, com status calculado', () => {
  const { despesa, parcelas } = passagemParcelada()
  const lista = parcelasDaViagem([despesa], parcelas, HOJE)
  assert.equal(lista.length, 8)
  assert.equal(lista[0].vence_em, '2026-09-10')
  assert.equal(lista[0].status, 'atrasada', 'setembro ja passou em 15/11')
  assert.equal(lista[7].status, 'futura')
  assert.equal(lista[0].descricao, 'Passagem aérea')
})

test('origem da divida explica de onde o numero veio', () => {
  const despesas: Despesa[] = [
    { id: 'a', descricao: 'Passagem', valor_centavos: 24000, traveler_id: 'leo' },
    { id: 'b', descricao: 'Hotel', valor_centavos: 60000, traveler_id: 'leo' },
    { id: 'c', descricao: 'Fora', valor_centavos: 90000, traveler_id: 'alana' },
  ]
  const divisoes: LinhaDivisao[] = [
    { expense_id: 'a', traveler_id: 'joao', peso: 1, valor_centavos: 12000 },
    { expense_id: 'b', traveler_id: 'joao', peso: 1, valor_centavos: 30000 },
    { expense_id: 'c', traveler_id: 'joao', peso: 1, valor_centavos: 45000 },
  ]
  const r = origemDaDivida('joao', 'leo', {
    categorias: [],
    despesas,
    divisoes,
    parcelas: [],
    pagamentos: [],
  })
  assert.deepEqual(
    r.map((x) => [x.descricao, x.valor_centavos]),
    [
      ['Hotel', 30000],
      ['Passagem', 12000],
    ],
    'so o que o Leonardo pagou',
  )
  assert.equal(somar(r.map((x) => x.valor_centavos)), 42000)
})

// ---------------------------------------------------------------- utilidades

test('paraDia le tanto Date quanto ISO sem deslocar o dia', () => {
  assert.equal(paraDia(new Date(2026, 8, 10)), '2026-09-10')
  assert.equal(paraDia('2026-09-10T00:00:00.000Z'), '2026-09-10')
  assert.equal(paraDia('2026-09-10'), '2026-09-10')
  assert.equal(paraDia(null), null)
  assert.equal(paraDia('ontem'), null)
})

test('percentual com base zero devolve 0, nao NaN', () => {
  assert.equal(percentual(10, 0), 0)
  assert.equal(percentual(1, 3), 33)
})
