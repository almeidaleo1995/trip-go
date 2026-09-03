import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aplicaA,
  checklistDaDocumentacao,
  entregue,
  estadoDe,
  faltando,
  filtrarCelulas,
  montarMatriz,
  ordenarCelulas,
  ordenarRequisitos,
  pendenciasDe,
  pendenciasPorRequisito,
  requisitosDoDia,
  requisitosDoPais,
  resumir,
  statusPrazo,
  temValidade,
  validadeDe,
  type Participante,
  type PerfilResumo,
  type Requisito,
  type Submissao,
  textoFalta,
} from './documentacao.ts'

const HOJE = '2026-08-26'

const req = (p: Partial<Requisito> & { id: string; nome: string }): Requisito => ({
  obrigatorio: true,
  aplica_todos: true,
  exige_numero: false,
  exige_validade: false,
  exige_arquivo: false,
  ...p,
})

const sub = (p: Partial<Submissao> & { requirement_id: string; traveler_id: string }): Submissao => ({
  id: `${p.requirement_id}-${p.traveler_id}`,
  status: 'enviado',
  ...p,
})

const PESSOAS: Participante[] = [
  { id: 'leo', nome: 'Leonardo' },
  { id: 'joao', nome: 'João' },
  { id: 'ana', nome: 'Ana' },
]

// ---------------------------------------------------------------- alcance

test('aplica a todos cobre quem entrar na viagem depois', () => {
  const r = req({ id: 'p', nome: 'Passaporte' })
  assert.equal(aplicaA(r, 'quem-chegou-agora'), true)
})

test('requisito de pessoas especificas nao alcanca quem nao foi marcado', () => {
  const r = req({ id: 'cnh', nome: 'CNH', aplica_todos: false, assigned_to: ['leo'] })
  assert.equal(aplicaA(r, 'leo'), true)
  assert.equal(aplicaA(r, 'ana'), false)
})

// ---------------------------------------------------------------- o que falta

test('falta o numero quando nem o perfil nem a entrega o tem', () => {
  const r = req({ id: 'cpf', nome: 'CPF', exige_numero: true, campo_perfil: 'cpf' })
  assert.deepEqual(faltando(r, undefined, undefined), ['numero'])
})

test('o perfil satisfaz o requisito sem a pessoa redigitar na viagem', () => {
  const r = req({ id: 'cpf', nome: 'CPF', exige_numero: true, campo_perfil: 'cpf' })
  const perfil: PerfilResumo = { traveler_id: 'leo', campos: { cpf: true } }
  assert.deepEqual(faltando(r, undefined, perfil), [])
})

test('sem conta, o numero da entrega vale no lugar do perfil', () => {
  const r = req({ id: 'cpf', nome: 'CPF', exige_numero: true, campo_perfil: 'cpf' })
  const s = sub({ requirement_id: 'cpf', traveler_id: 'crianca', numero: '111' })
  assert.deepEqual(faltando(r, s, undefined), [])
})

test('a validade do passaporte vem do perfil, nao da entrega', () => {
  const r = req({ id: 'pas', nome: 'Passaporte', exige_validade: true, campo_perfil: 'passaporte' })
  const perfil: PerfilResumo = {
    traveler_id: 'leo',
    campos: { passaporte: true },
    passaporte_validade: '2031-04-12',
  }
  assert.equal(validadeDe(r, undefined, perfil), '2031-04-12')
})

test('requisito que nao exige nada e cumprido pela propria entrega', () => {
  const r = req({ id: 'vac', nome: 'Vacinação' })
  assert.deepEqual(faltando(r, undefined, undefined), ['numero'])
  assert.deepEqual(faltando(r, sub({ requirement_id: 'vac', traveler_id: 'leo' }), undefined), [])
})

test('arquivo exigido nao e satisfeito por numero', () => {
  const r = req({ id: 'seg', nome: 'Seguro', exige_arquivo: true })
  const s = sub({ requirement_id: 'seg', traveler_id: 'leo', numero: 'AP-1' })
  assert.deepEqual(faltando(r, s, undefined), ['arquivo'])
})

// ---------------------------------------------------------------- prazo

test('prazo no futuro conta os dias que faltam', () => {
  assert.deepEqual(statusPrazo('2026-09-05', HOJE), { dias: 10, vencido: false })
})

test('prazo passado vem como vencido, nao como zero dias', () => {
  assert.deepEqual(statusPrazo('2026-08-20', HOJE), { dias: 6, vencido: true })
})

test('sem prazo nao ha prazo', () => {
  assert.equal(statusPrazo(null, HOJE), null)
})

// ---------------------------------------------------------------- semaforo

test('nada entregue e sem prazo fica pendente', () => {
  const r = req({ id: 'p', nome: 'Passaporte', exige_numero: true })
  assert.equal(estadoDe(r, undefined, undefined, HOJE).estado, 'pendente')
})

test('nada entregue com prazo estourado vira atrasado', () => {
  const r = req({ id: 'p', nome: 'Passaporte', exige_numero: true, prazo: '2026-08-01' })
  assert.equal(estadoDe(r, undefined, undefined, HOJE).estado, 'atrasado')
})

test('entregue e sem revisao fica aguardando revisao', () => {
  const r = req({ id: 'p', nome: 'Passaporte', exige_numero: true })
  const s = sub({ requirement_id: 'p', traveler_id: 'leo', numero: 'XX1' })
  assert.equal(estadoDe(r, s, undefined, HOJE).estado, 'enviado')
})

test('aprovado pelo admin fica aprovado', () => {
  const r = req({ id: 'p', nome: 'Passaporte', exige_numero: true })
  const s = sub({ requirement_id: 'p', traveler_id: 'leo', numero: 'XX1', status: 'aprovado' })
  assert.equal(estadoDe(r, s, undefined, HOJE).estado, 'aprovado')
})

test('correcao pedida ganha da revisao pendente e carrega o comentario', () => {
  const r = req({ id: 'p', nome: 'Passaporte', exige_numero: true })
  const s = sub({
    requirement_id: 'p',
    traveler_id: 'leo',
    numero: 'XX1',
    status: 'correcao',
    comentario: 'Foto ilegível.',
  })
  const c = estadoDe(r, s, undefined, HOJE)
  assert.equal(c.estado, 'correcao')
  assert.equal(c.comentario, 'Foto ilegível.')
})

test('vencido ganha de aprovado: renovar leva semanas, aprovar leva um clique', () => {
  const r = req({ id: 'p', nome: 'Passaporte', exige_validade: true })
  const s = sub({
    requirement_id: 'p',
    traveler_id: 'leo',
    validade: '2026-01-01',
    status: 'aprovado',
  })
  const c = estadoDe(r, s, undefined, HOJE)
  assert.equal(c.estado, 'vencido')
  // a revisao crua continua acessivel para o painel do admin
  assert.equal(c.revisao, 'aprovado')
})

test('perto do vencimento avisa mesmo estando aprovado', () => {
  const r = req({ id: 'p', nome: 'Passaporte', exige_validade: true })
  const s = sub({
    requirement_id: 'p',
    traveler_id: 'leo',
    validade: '2026-10-01',
    status: 'aprovado',
  })
  assert.equal(estadoDe(r, s, undefined, HOJE).estado, 'proximo')
})

test('validade folgada nao dispara aviso nenhum', () => {
  const r = req({ id: 'p', nome: 'Passaporte', exige_validade: true })
  const s = sub({
    requirement_id: 'p',
    traveler_id: 'leo',
    validade: '2031-04-12',
    status: 'aprovado',
  })
  assert.equal(estadoDe(r, s, undefined, HOJE).estado, 'aprovado')
})

test('falta dado: nem vencimento nem revisao mascaram a pendencia', () => {
  const r = req({ id: 'p', nome: 'Passaporte', exige_numero: true, exige_arquivo: true })
  const s = sub({
    requirement_id: 'p',
    traveler_id: 'leo',
    numero: 'XX1',
    status: 'aprovado',
  })
  const c = estadoDe(r, s, undefined, HOJE)
  assert.equal(c.estado, 'pendente')
  assert.deepEqual(c.falta, ['arquivo'])
})

// ---------------------------------------------------------------- matriz

test('a matriz so cria celula para quem o requisito alcanca', () => {
  const reqs = [
    req({ id: 'p', nome: 'Passaporte', exige_numero: true }),
    req({ id: 'cnh', nome: 'CNH', exige_numero: true, aplica_todos: false, assigned_to: ['leo'] }),
  ]
  const m = montarMatriz(reqs, [], PESSOAS, [], HOJE)
  assert.equal(m.celulas.length, 4) // 3 passaportes + 1 CNH
  assert.equal(m.porRequisito.get('cnh')?.length, 1)
  assert.equal(m.porParticipante.get('ana')?.length, 1)
})

test('a matriz casa a entrega com a pessoa certa', () => {
  const reqs = [req({ id: 'p', nome: 'Passaporte', exige_numero: true })]
  const subs = [sub({ requirement_id: 'p', traveler_id: 'leo', numero: 'XX1' })]
  const m = montarMatriz(reqs, subs, PESSOAS, [], HOJE)
  const porPessoa = new Map(m.celulas.map((c) => [c.traveler_id, c.estado]))
  assert.equal(porPessoa.get('leo'), 'enviado')
  assert.equal(porPessoa.get('ana'), 'pendente')
})

test('o perfil de uma pessoa nao vaza para o estado de outra', () => {
  const reqs = [req({ id: 'cpf', nome: 'CPF', exige_numero: true, campo_perfil: 'cpf' })]
  const perfis: PerfilResumo[] = [{ traveler_id: 'leo', campos: { cpf: true } }]
  const m = montarMatriz(reqs, [], PESSOAS, perfis, HOJE)
  const porPessoa = new Map(m.celulas.map((c) => [c.traveler_id, c.estado]))
  assert.equal(porPessoa.get('leo'), 'enviado')
  assert.equal(porPessoa.get('joao'), 'pendente')
})

// ---------------------------------------------------------------- contagens

test('a porcentagem conta so os obrigatorios', () => {
  const reqs = [
    req({ id: 'p', nome: 'Passaporte', exige_numero: true }),
    req({ id: 'guia', nome: 'Guia da cidade', obrigatorio: false, exige_arquivo: true }),
  ]
  const subs = [sub({ requirement_id: 'p', traveler_id: 'leo', numero: 'XX1' })]
  const m = montarMatriz(reqs, subs, [PESSOAS[0]], [], HOJE)
  const r = resumir(m.celulas)
  assert.equal(r.pct, 100)
  assert.equal(r.total, 2)
  assert.equal(r.pendentes, 1)
})

test('so recomendados: a porcentagem cai para o conjunto todo em vez de travar em zero', () => {
  const reqs = [req({ id: 'guia', nome: 'Guia', obrigatorio: false, exige_arquivo: true })]
  const m = montarMatriz(reqs, [], [PESSOAS[0]], [], HOJE)
  assert.equal(resumir(m.celulas).pct, 0)
})

test('nada exigido de ninguem e 100 por cento, nao divisao por zero', () => {
  assert.equal(resumir([]).pct, 100)
})

test('entregue cobre aprovado, em revisao e vencendo — nao os pendentes', () => {
  assert.equal(entregue('aprovado'), true)
  assert.equal(entregue('enviado'), true)
  assert.equal(entregue('proximo'), true)
  assert.equal(entregue('pendente'), false)
  assert.equal(entregue('vencido'), false)
})

// ---------------------------------------------------------------- relatorios

test('pendencias da pessoa saem da mais urgente para a menos', () => {
  const reqs = [
    req({ id: 'a', nome: 'Aaa', exige_numero: true }),
    req({ id: 'b', nome: 'Bbb', exige_validade: true }),
  ]
  const subs = [sub({ requirement_id: 'b', traveler_id: 'leo', validade: '2026-01-01' })]
  const m = montarMatriz(reqs, subs, [PESSOAS[0]], [], HOJE)
  const p = pendenciasDe(m, 'leo')
  assert.deepEqual(
    p.map((c) => c.estado),
    ['vencido', 'pendente'],
  )
})

test('o que ja esta resolvido nao entra na lista de pendencias', () => {
  const reqs = [req({ id: 'a', nome: 'Aaa', exige_numero: true })]
  const subs = [sub({ requirement_id: 'a', traveler_id: 'leo', numero: '1', status: 'aprovado' })]
  const m = montarMatriz(reqs, subs, [PESSOAS[0]], [], HOJE)
  assert.equal(pendenciasDe(m, 'leo').length, 0)
})

test('relatorio por requisito omite o que ninguem esta devendo', () => {
  const reqs = [
    req({ id: 'p', nome: 'Passaporte', exige_numero: true }),
    req({ id: 'cpf', nome: 'CPF', exige_numero: true }),
  ]
  const subs = PESSOAS.map((p) =>
    sub({ requirement_id: 'cpf', traveler_id: p.id, numero: '1', status: 'aprovado' }),
  )
  const m = montarMatriz(reqs, subs, PESSOAS, [], HOJE)
  const rel = pendenciasPorRequisito(m, reqs)
  assert.equal(rel.length, 1)
  assert.equal(rel[0].requisito.id, 'p')
  assert.equal(rel[0].celulas.length, 3)
})

// ---------------------------------------------------------------- filtros

test('filtro por estado e por pessoa se combinam', () => {
  const reqs = [
    req({ id: 'p', nome: 'Passaporte', exige_numero: true }),
    req({ id: 'cpf', nome: 'CPF', exige_numero: true }),
  ]
  const subs = [sub({ requirement_id: 'cpf', traveler_id: 'leo', numero: '1' })]
  const m = montarMatriz(reqs, subs, PESSOAS, [], HOJE)
  assert.equal(filtrarCelulas(m.celulas, { estados: ['pendente'] }).length, 5)
  assert.equal(
    filtrarCelulas(m.celulas, { estados: ['pendente'], participantes: ['leo'] }).length,
    1,
  )
})

test('a busca acha pelo nome da pessoa, sem acento e sem caixa', () => {
  const reqs = [req({ id: 'p', nome: 'Passaporte', exige_numero: true })]
  const m = montarMatriz(reqs, [], PESSOAS, [], HOJE)
  const nomes = new Map(PESSOAS.map((p) => [p.id, p.nome]))
  assert.equal(filtrarCelulas(m.celulas, { busca: 'joao' }, nomes).length, 1)
  assert.equal(filtrarCelulas(m.celulas, { busca: 'PASSAPORTE' }, nomes).length, 3)
})

test('filtro de obrigatorios descarta o que e so recomendado', () => {
  const reqs = [
    req({ id: 'p', nome: 'Passaporte', exige_numero: true }),
    req({ id: 'g', nome: 'Guia', obrigatorio: false, exige_arquivo: true }),
  ]
  const m = montarMatriz(reqs, [], [PESSOAS[0]], [], HOJE)
  assert.equal(filtrarCelulas(m.celulas, { obrigatorios: true }).length, 1)
})

// ---------------------------------------------------------------- ordenacao

test('requisito obrigatorio vem antes do recomendado', () => {
  const r = ordenarRequisitos([
    req({ id: 'g', nome: 'Aaa guia', obrigatorio: false }),
    req({ id: 'p', nome: 'Zzz passaporte' }),
  ])
  assert.deepEqual(
    r.map((x) => x.id),
    ['p', 'g'],
  )
})

test('celulas do mesmo estado desempatam pelo obrigatorio', () => {
  const reqs = [
    req({ id: 'g', nome: 'Aaa', obrigatorio: false, exige_numero: true }),
    req({ id: 'p', nome: 'Zzz', exige_numero: true }),
  ]
  const m = montarMatriz(reqs, [], [PESSOAS[0]], [], HOJE)
  assert.deepEqual(
    ordenarCelulas(m.celulas).map((c) => c.requisito.id),
    ['p', 'g'],
  )
})

// ---------------------------------------------------------------- integracoes

test('o checklist documental fica feito sozinho quando o documento entra', () => {
  const reqs = [req({ id: 'p', nome: 'Passaporte', exige_numero: true })]
  const subs = [sub({ requirement_id: 'p', traveler_id: 'leo', numero: 'XX1' })]
  const m = montarMatriz(reqs, subs, [PESSOAS[0]], [], HOJE)
  const itens = checklistDaDocumentacao(m, 'leo')
  assert.equal(itens.length, 1)
  assert.equal(itens[0].titulo, 'Cadastrar passaporte')
  assert.equal(itens[0].feito, true)
  // id derivado do requisito: nada e gravado em checklist_items
  assert.equal(itens[0].id, 'requisito:p')
})

test('o dia do roteiro puxa os obrigatorios e o que vence ate ali', () => {
  const reqs = [
    req({ id: 'p', nome: 'Passaporte' }),
    req({ id: 'g', nome: 'Guia', obrigatorio: false }),
    req({ id: 'v', nome: 'Visto', obrigatorio: false, prazo: '2026-12-01' }),
  ]
  const doDia = requisitosDoDia(reqs, '2026-12-30')
  assert.deepEqual(
    doDia.map((r) => r.id),
    ['p', 'v'],
  )
})

test('a lista de faltas e escrita como se fala em portugues', () => {
  assert.equal(textoFalta(['numero']), 'número')
  assert.equal(textoFalta(['numero', 'validade']), 'número e validade')
  // O caso que o join(' e ') errava: tres partes viravam "a e b e c".
  assert.equal(textoFalta(['numero', 'validade', 'arquivo']), 'número, validade e arquivo')
  assert.equal(textoFalta([]), '')
})

// ---------------------------------------------------------------- pais

test('requisito sem pais vale em todo pais', () => {
  const reqs = [req({ id: 'p', nome: 'Passaporte' })]
  assert.deepEqual(
    requisitosDoPais(reqs, 'Espanha').map((r) => r.id),
    ['p'],
  )
  assert.deepEqual(
    requisitosDoPais(reqs, 'Alemanha').map((r) => r.id),
    ['p'],
  )
})

test('o pais casa sem acento e sem caixa', () => {
  const reqs = [req({ id: 'v', nome: 'Visto', pais: 'França' })]
  for (const escrito of ['França', 'franca', 'FRANCA', '  frança  ']) {
    assert.deepEqual(
      requisitosDoPais(reqs, escrito).map((r) => r.id),
      ['v'],
      `deveria casar com ${escrito}`,
    )
  }
})

test('requisito de outro pais fica de fora', () => {
  const reqs = [
    req({ id: 'p', nome: 'Passaporte' }),
    req({ id: 'v', nome: 'Visto', pais: 'Japão' }),
  ]
  assert.deepEqual(
    requisitosDoPais(reqs, 'Espanha').map((r) => r.id),
    ['p'],
  )
})

test('dia sem pais nao exige nada — nem os da viagem inteira', () => {
  // Responder "tudo" aqui encheria o cabecalho de um dia sem pais cadastrado com
  // exigencias de lugares onde ninguem vai pisar.
  const reqs = [req({ id: 'p', nome: 'Passaporte' })]
  assert.deepEqual(requisitosDoPais(reqs, null), [])
  assert.deepEqual(requisitosDoPais(reqs, ''), [])
  assert.deepEqual(requisitosDoPais(reqs, '   '), [])
})

test('a coluna nova nao mexe em requisito antigo', () => {
  // Nao-regressao: a coluna nasceu nula em toda linha ja gravada, e um requisito
  // sem pais tem que continuar com o MESMO estado de antes de ela existir.
  const r = req({ id: 'p', nome: 'Passaporte', exige_numero: true })
  const semEntrega = estadoDe(r, undefined, undefined, HOJE)
  assert.equal(semEntrega.estado, 'pendente')
  const comEntrega = estadoDe(r, sub({ requirement_id: 'p', traveler_id: 'leo', numero: 'X1' }), undefined, HOJE)
  assert.equal(comEntrega.estado, 'enviado')
})

// ---------------------------------------------------------------- redacao

test('validade redigida com tem_validade nao vira pendencia', () => {
  // O visualizador recebe `tem_validade` no lugar da data (documentacaoDaViagem).
  // Sem o booleano, "sem data" seria lido como "falta a validade" e marcaria como
  // pendente exatamente quem ja cumpriu — a redacao virando bug de status.
  const r = req({ id: 'p', nome: 'Passaporte', exige_validade: true })
  const redigida = sub({ requirement_id: 'p', traveler_id: 'ana', tem_validade: true })
  assert.equal(temValidade(r, redigida, undefined), true)
  assert.deepEqual(faltando(r, redigida, undefined), [])
  assert.equal(estadoDe(r, redigida, undefined, HOJE).estado, 'enviado')
})

test('sem data e sem booleano a validade continua faltando', () => {
  const r = req({ id: 'p', nome: 'Passaporte', exige_validade: true })
  const vazia = sub({ requirement_id: 'p', traveler_id: 'ana' })
  assert.equal(temValidade(r, vazia, undefined), false)
  assert.deepEqual(faltando(r, vazia, undefined), ['validade'])
})

test('validade do perfil conta pelo booleano quando a data nao sai', () => {
  const r = req({ id: 'p', nome: 'Passaporte', exige_validade: true, campo_perfil: 'passaporte' })
  const perfil: PerfilResumo = {
    traveler_id: 'ana',
    campos: { passaporte: true },
    passaporte_validade_preenchida: true,
  }
  assert.equal(temValidade(r, undefined, perfil), true)
  // E `validadeDe` continua respondendo a outra pergunta: QUE data e.
  assert.equal(validadeDe(r, undefined, perfil), null)
})
