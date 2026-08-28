import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarMatriz, type Requisito, type Submissao } from './documentacao.ts'
import type { Documento } from './cofre.ts'
import {
  categorias,
  deslocar,
  dias,
  embarqueDe,
  faseDePreparacao,
  gerarTarefas,
  momentoDe,
  montarPreparacao,
  ordenarTarefas,
  paraDia,
  progresso,
  REGRAS,
  type Contexto,
  type Tarefa,
  type Voo,
} from './preparacao.ts'

const HOJE = new Date(2026, 7, 27) // 27/08/2026
const PARTIDA = '2026-12-30'
const RETORNO = '2027-01-15'

const requisito = (p: Partial<Requisito> & { id: string; nome: string }): Requisito => ({
  obrigatorio: true,
  aplica_todos: true,
  exige_arquivo: true,
  ...p,
})

const vazio = (over: Partial<Contexto> = {}): Contexto => ({
  hoje: HOJE,
  partida: PARTIDA,
  retorno: RETORNO,
  matriz: montarMatriz([], [], [], [], HOJE),
  eu: 'p1',
  admin: false,
  perfilFaltando: [],
  documentos: [],
  checklist: [],
  feitos: {},
  voos: [],
  reservas: [],
  obrigacoes: [],
  ...over,
})

/** Uma viagem com um requisito nao entregue, um voo sem localizador e uma parcela. */
const comDados = (over: Partial<Contexto> = {}): Contexto =>
  vazio({
    matriz: montarMatriz(
      [requisito({ id: 'r1', nome: 'Passaporte', prazo: '2026-10-01' })],
      [],
      [{ id: 'p1', nome: 'Leonardo' }],
      [],
      HOJE,
    ),
    voos: [{ id: 'v1', companhia: 'LATAM', numero: 'LA719', parte_em: `${PARTIDA}T10:30:00` }],
    reservas: [
      { id: 'h1', tipo: 'hospedagem', nome: 'Hotel Madri', inicio_em: '2027-01-03T14:00:00' },
    ],
    obrigacoes: [
      { id: 'o1', descricao: 'Parcela 3/10', valor_centavos: 85000, pago_centavos: 0, vence_em: '2026-08-30' },
    ],
    ...over,
  })

// ---------------------------------------------------------------- datas

test('dias tem sinal: passado e negativo, futuro e positivo', () => {
  assert.equal(dias('2026-08-27', '2026-08-30'), 3)
  assert.equal(dias('2026-08-30', '2026-08-27'), -3)
  assert.equal(dias('2026-08-27', '2026-08-27'), 0)
})

test('deslocar atravessa a virada de mes e de ano', () => {
  assert.equal(deslocar('2026-12-30', -30), '2026-11-30')
  assert.equal(deslocar('2027-01-05', -7), '2026-12-29')
  assert.equal(deslocar(null, -7), null)
})

test('paraDia usa o fuso local, nao UTC', () => {
  assert.equal(paraDia(new Date(2026, 0, 1)), '2026-01-01')
})

// ---------------------------------------------------------------- momentos

test('cada prazo cai no degrau certo da escada', () => {
  const t = (prazo: string | null): Tarefa => ({
    id: 'x',
    titulo: 'x',
    fonte: 'checklist',
    prioridade: 'atencao',
    acao: 'resolver',
    prazo,
    regra: 'teste',
  })

  assert.equal(momentoDe(t('2026-08-28'), PARTIDA, HOJE), 'agora')
  assert.equal(momentoDe(t('2026-08-20'), PARTIDA, HOJE), 'agora', 'prazo vencido e agora')
  assert.equal(momentoDe(t('2026-10-15'), PARTIDA, HOJE), 'mes')
  assert.equal(momentoDe(t('2026-12-10'), PARTIDA, HOJE), 'trinta')
  assert.equal(momentoDe(t('2026-12-27'), PARTIDA, HOJE), 'sete')
  assert.equal(momentoDe(t(PARTIDA), PARTIDA, HOJE), 'dia')
})

test('tarefa sem prazo vai pela urgencia', () => {
  const base = { id: 'x', titulo: 'x', fonte: 'perfil', acao: 'resolver', prazo: null, regra: 't' }
  assert.equal(momentoDe({ ...base, prioridade: 'urgente' } as Tarefa, PARTIDA, HOJE), 'agora')
  assert.equal(momentoDe({ ...base, prioridade: 'atencao' } as Tarefa, PARTIDA, HOJE), 'mes')
})

test('viagem proxima esvazia os degraus do meio em vez de mentir', () => {
  const perto = '2026-09-02' // faltam 6 dias
  const t: Tarefa = {
    id: 'x',
    titulo: 'x',
    fonte: 'voo',
    prioridade: 'atencao',
    acao: 'resolver',
    prazo: '2026-08-29',
    regra: 't',
  }
  assert.equal(momentoDe(t, perto, HOJE), 'agora')
})

// ---------------------------------------------------------------- regras

test('viagem sem nada nao gera tarefa nenhuma', () => {
  assert.deepEqual(gerarTarefas(vazio()), [])
})

test('cada regra tem id unico e prosa explicando o que procura', () => {
  const ids = REGRAS.map((r) => r.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const r of REGRAS) assert.ok(r.condicao.length > 10, `${r.id} sem condicao legivel`)
})

test('requisito nao entregue vira tarefa com o prazo do requisito', () => {
  const t = gerarTarefas(comDados()).find((x) => x.regra === 'documento-exigido')
  assert.ok(t, 'nenhuma tarefa de documento')
  assert.match(t!.titulo, /Passaporte/)
  assert.equal(t!.prazo, '2026-10-01')
  assert.equal(t!.acao, 'resolver')
})

test('viajante ve so a propria linha; quem organiza ve a viagem toda', () => {
  const matriz = montarMatriz(
    [requisito({ id: 'r1', nome: 'Passaporte' })],
    [],
    [
      { id: 'p1', nome: 'Leonardo' },
      { id: 'p2', nome: 'Alana' },
    ],
    [],
    HOJE,
  )
  const meu = gerarTarefas(vazio({ matriz })).filter((t) => t.fonte === 'documento')
  const todos = gerarTarefas(vazio({ matriz, admin: true })).filter((t) => t.fonte === 'documento')
  assert.equal(meu.length, 1)
  assert.equal(todos.length, 2)
})

test('documento ja entregue some da lista', () => {
  const entrega: Submissao = {
    id: 's1',
    requirement_id: 'r1',
    traveler_id: 'p1',
    tem_arquivo: true,
    status: 'aprovado',
  }
  const matriz = montarMatriz(
    [requisito({ id: 'r1', nome: 'Passaporte' })],
    [entrega],
    [{ id: 'p1', nome: 'Leonardo' }],
    [],
    HOJE,
  )
  assert.equal(gerarTarefas(vazio({ matriz })).filter((t) => t.fonte === 'documento').length, 0)
})

test('check-in e lembrete, nao tarefa: o app nao tem como conferir', () => {
  const t = gerarTarefas(comDados()).find((x) => x.regra === 'voo-checkin')
  assert.ok(t)
  assert.equal(t!.acao, 'lembrete')
  assert.equal(t!.prazo, '2026-12-29', 'vespera da partida')
})

test('voo que ja partiu nao pede check-in', () => {
  const passado: Voo = { id: 'v0', companhia: 'LATAM', parte_em: '2026-01-02T10:00:00' }
  assert.equal(
    gerarTarefas(vazio({ voos: [passado] })).filter((t) => t.regra === 'voo-checkin').length,
    0,
  )
})

test('parcela vencida e urgente; a que ainda vai vencer nao', () => {
  const um = gerarTarefas(
    vazio({
      obrigacoes: [{ id: 'o1', valor_centavos: 100, pago_centavos: 0, vence_em: '2026-08-01' }],
    }),
  )
  assert.equal(um[0].prioridade, 'urgente')

  const dois = gerarTarefas(
    vazio({
      obrigacoes: [{ id: 'o2', valor_centavos: 100, pago_centavos: 0, vence_em: '2026-10-01' }],
    }),
  )
  assert.equal(dois[0].prioridade, 'atencao')
})

test('parcela quitada nao aparece', () => {
  const c = vazio({
    obrigacoes: [{ id: 'o1', valor_centavos: 100, pago_centavos: 100, vence_em: '2026-08-01' }],
  })
  assert.deepEqual(gerarTarefas(c), [])
})

test('documento importante sem offline vira tarefa; o comum nao', () => {
  const doc = (p: Partial<Documento>): Documento => ({
    id: 'd1',
    titulo: 'Seguro',
    tipo: 'arquivo',
    ...p,
  })
  const importante = vazio({ documentos: [doc({ importante: true, offline: false })] })
  const comum = vazio({ documentos: [doc({ importante: false, offline: false })] })
  const jaOffline = vazio({ documentos: [doc({ importante: true, offline: true })] })

  assert.equal(gerarTarefas(importante).filter((t) => t.regra === 'documento-sem-offline').length, 1)
  assert.equal(gerarTarefas(comum).length, 0)
  assert.equal(gerarTarefas(jaOffline).length, 0)
})

test('item de checklist com prazo maximo estourado e urgente', () => {
  const c = vazio({
    checklist: [
      { id: 'c1', titulo: 'Comprar adaptador', prazo_maximo: '2026-08-01' },
      { id: 'c2', titulo: 'Trocar euros', prazo_maximo: '2026-11-01' },
    ],
  })
  const t = gerarTarefas(c)
  assert.equal(t.find((x) => x.id === 'checklist:c1')!.prioridade, 'urgente')
  assert.equal(t.find((x) => x.id === 'checklist:c2')!.prioridade, 'atencao')
})

test('item de checklist ja marcado nao aparece', () => {
  const c = vazio({ checklist: [{ id: 'c1', titulo: 'Trocar euros' }], feitos: { c1: true } })
  assert.deepEqual(gerarTarefas(c), [])
})

// ---------------------------------------------------------------- ordem

test('urgente primeiro, depois o prazo mais proximo, sem prazo por ultimo', () => {
  const t = (p: Partial<Tarefa>): Tarefa => ({
    id: String(p.titulo),
    titulo: 'x',
    fonte: 'checklist',
    prioridade: 'atencao',
    acao: 'resolver',
    prazo: null,
    regra: 't',
    ...p,
  })
  const ordenadas = ordenarTarefas([
    t({ titulo: 'sem prazo' }),
    t({ titulo: 'longe', prazo: '2026-12-01' }),
    t({ titulo: 'urgente', prioridade: 'urgente' }),
    t({ titulo: 'perto', prazo: '2026-09-01' }),
  ])
  assert.deepEqual(
    ordenadas.map((x) => x.titulo),
    ['urgente', 'perto', 'longe', 'sem prazo'],
  )
})

// ---------------------------------------------------------------- progresso

test('modulo que a viagem nao usa fica de fora da conta, nao entra como zero', () => {
  const linhas = categorias(vazio())
  assert.ok(
    linhas.every((l) => l.pct === null),
    'viagem vazia nao tem o que medir',
  )
  assert.equal(progresso(linhas), null)
})

test('a porcentagem geral respeita os pesos', () => {
  // Documentos (peso 3) em 0%, passagens (peso 2) em 100%: 200/5 = 40.
  const c = vazio({
    matriz: montarMatriz(
      [requisito({ id: 'r1', nome: 'Passaporte' })],
      [],
      [{ id: 'p1', nome: 'Leonardo' }],
      [],
      HOJE,
    ),
    voos: [{ id: 'v1', localizador: 'WSZIAK', parte_em: `${PARTIDA}T10:30:00` }],
  })
  assert.equal(progresso(categorias(c)), 40)
})

test('categoria conta o que existe: voo sem localizador nao esta pronto', () => {
  const c = vazio({
    voos: [
      { id: 'v1', localizador: 'WSZIAK' },
      { id: 'v2', localizador: '  ' },
    ],
  })
  const passagens = categorias(c).find((l) => l.id === 'passagens')!
  assert.equal(passagens.pct, 50)
  assert.equal(passagens.nota, '1 voo sem localizador')
})

test('tudo resolvido chega a 100', () => {
  const c = vazio({
    voos: [{ id: 'v1', localizador: 'WSZIAK' }],
    checklist: [{ id: 'c1', titulo: 'Trocar euros' }],
    feitos: { c1: true },
  })
  assert.equal(progresso(categorias(c)), 100)
})

// ---------------------------------------------------------------- fases

test('a fase acompanha a distancia ate a partida', () => {
  const f = (partida: string, retorno = '2027-06-01') =>
    faseDePreparacao(partida, retorno, HOJE)
  assert.equal(f('2027-06-01'), 'planejamento')
  assert.equal(f('2026-11-01'), 'reservas')
  assert.equal(f('2026-09-20'), 'revisao')
  assert.equal(f('2026-08-30'), 'final')
  assert.equal(f('2026-08-20'), 'viagem')
  assert.equal(faseDePreparacao('2026-01-01', '2026-01-10', HOJE), 'concluida')
  assert.equal(faseDePreparacao(null, null, HOJE), 'sem-data')
})

// ---------------------------------------------------------------- montagem

test('a Central inteira: degraus na ordem, sem degrau vazio', () => {
  const p = montarPreparacao(comDados())
  assert.ok(p.tarefas.length > 0)
  assert.ok(
    p.degraus.every((d) => d.tarefas.length > 0),
    'degrau vazio nao deve ser desenhado',
  )
  const ordem = p.degraus.map((d) => d.momento)
  assert.deepEqual([...ordem].sort(), ordem.slice().sort(), 'degraus vem em ordem cronologica')
  assert.equal(p.degraus[0].momento, 'agora')
  assert.equal(p.degraus[0].data, '2026-08-27')
})

test('o degrau "30 dias antes" estampa o dia em que faltam 30, nao o fim da janela', () => {
  const p = montarPreparacao(
    comDados({ checklist: [{ id: 'c1', titulo: 'Revisar roteiro', prazo_ideal: '2026-12-10' }] }),
  )
  const trinta = p.degraus.find((d) => d.momento === 'trinta')
  assert.ok(trinta)
  assert.equal(trinta!.data, '2026-11-30')
})

test('pendencias por fonte trazem os urgentes na frente', () => {
  const p = montarPreparacao(
    comDados({
      obrigacoes: [
        { id: 'o1', descricao: 'Parcela 2/10', valor_centavos: 85000, pago_centavos: 0, vence_em: '2026-08-01' },
      ],
    }),
  )
  assert.equal(p.porFonte[0].fonte, 'pagamento', 'a fonte com urgente vem primeiro')
  assert.equal(p.porFonte[0].urgentes, 1)
  assert.ok(
    p.porFonte.slice(1).every((f) => f.urgentes === 0),
    'nenhuma outra fonte tinha urgente',
  )
})

test('embarque: o voo do dia da partida, com saida sugerida 3h antes', () => {
  const e = embarqueDe(
    [
      { id: 'v0', parte_em: '2026-12-29T22:00:00' },
      { id: 'v1', parte_em: `${PARTIDA}T10:30:00` },
    ],
    PARTIDA,
  )
  assert.equal(e?.voo.id, 'v1')
  assert.equal(e?.sairAs, '07:30')
})

test('viagem que nao comeca de aviao nao inventa cartao de embarque', () => {
  assert.equal(embarqueDe([], PARTIDA), null)
  assert.equal(embarqueDe([{ id: 'v1', parte_em: '2026-11-01T10:00:00' }], PARTIDA), null)
})
