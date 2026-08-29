import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  agoraNoFuso,
  deslocamentoAte,
  diaDeHoje,
  enderecoDe,
  formatarHoraLocal,
  formatarRestante,
  fusoDivergente,
  horaDeSair,
  hospedagemDoDia,
  itemAtual,
  itensDoDia,
  margemDe,
  montarHoje,
  proximoItem,
  rituaisDoDia,
  tempoRestante,
  type ItemRoteiro,
  type Reserva,
} from './hoje.ts'

const PARTIDA = '2026-12-25'
const RETORNO = '2027-01-11' // 18 dias
const DIA = '2026-12-30' // dia 6

/** 30/12/2026 às 10:24, hora local — o instante da tela de referência. */
const AGORA = new Date(2026, 11, 30, 10, 24)

const item = (p: Partial<ItemRoteiro> & { id: string; ocorre_em: string }): ItemRoteiro => ({
  titulo: 'Item',
  tipo: 'passeio',
  ...p,
})

const MUSEU = item({
  id: 'e1',
  titulo: 'Museu do Prado',
  descricao: 'Visita ao museu',
  ocorre_em: `${DIA}T09:00`,
  fim_em: `${DIA}T11:30`,
  cidade: 'Madri',
  endereco: 'Calle de Ruiz de Alarcón, 23, 28014 Madrid',
})

const ALMOCO = item({
  id: 'e2',
  titulo: 'Almoço no Casa Lucio',
  tipo: 'restaurante',
  ocorre_em: `${DIA}T11:30`,
  cidade: 'Madri',
  distancia_m: 950,
  duracao_min: 14,
  transporte: 'a_pe',
})

const TARDE = item({ id: 'e3', titulo: 'Museu Reina Sofia', ocorre_em: `${DIA}T14:00` })
const JANTAR = item({ id: 'e4', titulo: 'Jantar', ocorre_em: `${DIA}T19:30` })

const DIA_CHEIO = [MUSEU, ALMOCO, TARDE, JANTAR]

// ---------------------------------------------------------------- fuso (§31)

test('agoraNoFuso sem fuso devolve o relógio do aparelho', () => {
  assert.equal(agoraNoFuso(AGORA, null).getTime(), AGORA.getTime())
  assert.equal(agoraNoFuso(AGORA, '').getTime(), AGORA.getTime())
})

test('agoraNoFuso converte o instante para o relógio de parede do destino', () => {
  // 30/12/2026 12:00 UTC = 13:00 em Madri e 09:00 em São Paulo.
  const instante = new Date(Date.UTC(2026, 11, 30, 12, 0))
  assert.equal(formatarHoraLocal(agoraNoFuso(instante, 'Europe/Madrid')), '13:00')
  assert.equal(formatarHoraLocal(agoraNoFuso(instante, 'America/Sao_Paulo')), '09:00')
})

test('agoraNoFuso tolera fuso inválido em vez de derrubar a tela', () => {
  assert.equal(agoraNoFuso(AGORA, 'Nao/Existe').getTime(), AGORA.getTime())
})

test('fusoDivergente só acusa quando o aparelho está mesmo noutro fuso', () => {
  const instante = new Date(Date.UTC(2026, 11, 30, 12, 0))
  assert.equal(fusoDivergente(instante, 'Europe/Madrid'), true)
  assert.equal(fusoDivergente(instante, null), false)
})

// ---------------------------------------------------------------- o dia (§3)

test('diaDeHoje numera o dia a partir das datas da viagem', () => {
  const d = diaDeHoje({ data_partida: PARTIDA, data_retorno: RETORNO }, AGORA)
  assert.equal(d.chave, DIA)
  assert.equal(d.numero, 6)
  assert.equal(d.total, 18)
  assert.equal(d.fase, 'durante')
})

test('itensDoDia pega só o dia pedido, na ordem do relógio', () => {
  const outroDia = item({ id: 'x', ocorre_em: '2026-12-31T09:00' })
  const lista = itensDoDia([JANTAR, outroDia, MUSEU, ALMOCO], DIA)
  assert.deepEqual(
    lista.map((e) => e.id),
    ['e1', 'e2', 'e4'],
  )
})

// ---------------------------------------------------------------- agora (§4, §22)

test('caso 1: evento acontecendo agora vira o AGORA', () => {
  const m = itemAtual(DIA_CHEIO, AGORA)
  assert.equal(m?.item.id, 'e1')
  assert.equal(m?.presumido, false)
  assert.equal(tempoRestante(m!, AGORA).restanteMin, 66) // 10:24 -> 11:30
})

test('caso 2: evento que ainda não começou não é o AGORA', () => {
  const antes = new Date(2026, 11, 30, 8, 0)
  assert.equal(itemAtual(DIA_CHEIO, antes), null)
  assert.equal(proximoItem(DIA_CHEIO, antes)?.id, 'e1')
})

test('caso 3: evento encerrado não é o AGORA', () => {
  const depois = new Date(2026, 11, 30, 11, 45)
  const m = itemAtual([MUSEU], depois)
  assert.equal(m, null)
})

test('caso 4: nenhum evento em curso deixa o AGORA vazio e o próximo em pé', () => {
  const vao = new Date(2026, 11, 30, 13, 0) // depois do almoço, antes das 14h
  assert.equal(itemAtual(DIA_CHEIO, vao), null)
  assert.equal(proximoItem(DIA_CHEIO, vao)?.id, 'e3')
})

test('item sem fim_em vale até o próximo começar', () => {
  const m = itemAtual(DIA_CHEIO, new Date(2026, 11, 30, 12, 0))
  assert.equal(m?.item.id, 'e2')
  assert.equal(m?.presumido, true)
  assert.equal(formatarHoraLocal(m!.termina), '13:00') // 11:30 + 90 min, antes das 14h
})

test('item sem fim_em e sem vizinho para no teto de 90 minutos', () => {
  const solto = item({ id: 's', ocorre_em: `${DIA}T20:00` })
  const m = itemAtual([solto], new Date(2026, 11, 30, 20, 30))
  assert.equal(formatarHoraLocal(m!.termina), '21:30')
  assert.equal(itemAtual([solto], new Date(2026, 11, 30, 21, 31)), null)
})

test('tempoRestante marca encerrado quando o fim já passou', () => {
  const m = itemAtual(DIA_CHEIO, AGORA)!
  const fim = tempoRestante(m, new Date(2026, 11, 30, 11, 31))
  assert.equal(fim.encerrado, true)
  assert.equal(formatarRestante(fim.restanteMin), 'Encerrado')
})

test('caso 6: sem eventos depois, o próximo é nulo', () => {
  const tarde = new Date(2026, 11, 30, 23, 0)
  assert.equal(proximoItem(DIA_CHEIO, tarde), null)
  assert.equal(itemAtual(DIA_CHEIO, tarde), null)
})

// ---------------------------------------------------------------- hora de sair (§9)

test('horaDeSair desconta deslocamento e margem do horário do compromisso', () => {
  // 11:30 − 14 min de caminhada − 5 min de margem padrão = 11:11
  assert.equal(formatarHoraLocal(horaDeSair(ALMOCO, AGORA)), '11:11')
})

test('horaDeSair usa margem maior para voo', () => {
  const voo = item({ id: 'v', tipo: 'voo', ocorre_em: `${DIA}T10:30`, duracao_min: 120 })
  // 10:30 − 2h − 30 min = 08:00
  assert.equal(formatarHoraLocal(horaDeSair(voo, AGORA)), '08:00')
})

test('a margem é configurável', () => {
  assert.equal(margemDe('voo'), 30)
  assert.equal(margemDe('passeio'), 5)
  assert.equal(margemDe('voo', { voo: 180 }), 180)
  assert.equal(formatarHoraLocal(horaDeSair(ALMOCO, AGORA, { restaurante: 0 })), '11:16')
})

test('sem duracao_min não existe hora de sair — e a tela não inventa uma', () => {
  assert.equal(horaDeSair(TARDE, AGORA), null)
  const d = deslocamentoAte(TARDE, AGORA)
  assert.equal(d.sairAs, null)
  assert.equal(d.duracaoMin, null)
  assert.equal(d.margemMin, 0)
})

test('deslocamentoAte devolve distância, duração e modo', () => {
  const d = deslocamentoAte(ALMOCO, AGORA)
  assert.equal(d.distanciaM, 950)
  assert.equal(d.duracaoMin, 14)
  assert.equal(d.modo, 'a_pe')
  assert.equal(d.atrasado, false)
})

test('deslocamentoAte acusa atraso depois da hora de sair', () => {
  assert.equal(deslocamentoAte(ALMOCO, new Date(2026, 11, 30, 11, 20)).atrasado, true)
})

test('transporte desconhecido não vira modo inventado', () => {
  const estranho = item({ id: 'z', ocorre_em: `${DIA}T15:00`, transporte: 'teleporte' })
  assert.equal(deslocamentoAte(estranho, AGORA).modo, null)
})

// ---------------------------------------------------------------- hospedagem (§13)

const HOTEL: Reserva = {
  id: 'r1',
  tipo: 'hospedagem',
  nome: 'Hotel Catalonia Plaza Mayor',
  inicio_em: '2026-12-28T15:00',
  fim_em: '2027-01-02T12:00',
  endereco: 'Calle Atocha, 36',
  cidade: 'Madri',
  telefone: '+34 91 369 71 71',
}

test('caso 11: a hospedagem que cobre esta noite é a de hoje', () => {
  assert.equal(hospedagemDoDia([HOTEL], DIA)?.id, 'r1')
})

test('no dia do check-out o hotel continua na tela', () => {
  assert.equal(hospedagemDoDia([HOTEL], '2027-01-02')?.id, 'r1')
})

test('caso 12: sem hospedagem cadastrada devolve nulo', () => {
  assert.equal(hospedagemDoDia([], DIA), null)
  assert.equal(hospedagemDoDia([HOTEL], '2027-02-01'), null)
  const jantar: Reserva = { id: 'r2', tipo: 'restaurante', inicio_em: `${DIA}T20:00` }
  assert.equal(hospedagemDoDia([jantar], DIA), null)
})

// ---------------------------------------------------------------- endereço (§7, §33)

test('caso 9: endereço vira linhas e um texto completo para copiar', () => {
  const e = enderecoDe(MUSEU)!
  assert.equal(e.titulo, 'Museu do Prado')
  // O número fica colado na rua: "Calle ... Alarcón" / "23" seria impossível de ditar.
  assert.deepEqual(e.linhas, ['Calle de Ruiz de Alarcón, 23', '28014 Madrid'])
  assert.equal(e.completo, 'Calle de Ruiz de Alarcón, 23, 28014 Madrid')
})

test('cidade já contida no endereço não é repetida embaixo dele', () => {
  // "Madri" está em "28014 Madrid" — a linha extra seria ruído.
  assert.equal(enderecoDe(MUSEU)!.cidade, null)
})

test('cidade ausente do endereço continua aparecendo', () => {
  const e = enderecoDe({ ...MUSEU, endereco: 'Calle Mayor, 10', cidade: 'Toledo' })!
  assert.equal(e.cidade, 'Toledo')
  assert.equal(e.completo, 'Calle Mayor, 10, Toledo')
  assert.deepEqual(e.linhas, ['Calle Mayor, 10'])
})

test('caso 10: sem endereço não há ficha — e portanto não há botão', () => {
  assert.equal(enderecoDe(TARDE), null)
  assert.equal(enderecoDe(null), null)
})

test('o endereço da reserva carrega o telefone junto', () => {
  const e = enderecoDe(HOTEL)!
  assert.equal(e.titulo, 'Hotel Catalonia Plaza Mayor')
  assert.equal(e.telefone, '+34 91 369 71 71')
})

// ---------------------------------------------------------------- rituais (§17, §18)

const CHECK = [
  { id: 'c1', titulo: 'Conferir mochila', prazo_ideal: DIA, assigned_to: [] },
  { id: 'c2', titulo: 'Tomar medicação', prazo_maximo: DIA, assigned_to: ['p1'], escopo: 'pessoal' },
  { id: 'c3', titulo: 'Ingresso do Prado', itinerary_event_id: 'e1', assigned_to: [] },
  { id: 'c4', titulo: 'Comprar chip', cidade: 'Madri', assigned_to: [] },
  { id: 'c5', titulo: 'Coisa de outro', assigned_to: ['p9'], escopo: 'pessoal', prazo_ideal: DIA },
  { id: 'c6', titulo: 'Item de fevereiro', prazo_ideal: '2027-02-01', assigned_to: [] },
  { id: 'c7', titulo: 'Sugestão não revisada', pendente: true, prazo_ideal: DIA, assigned_to: [] },
]

const opcoes = { participanteId: 'p1', chave: DIA, cidade: 'Madri', eventos: ['e1', 'e2'] }

test('caso 17: checklist sem nada relevante hoje devolve lista vazia', () => {
  const r = rituaisDoDia([], [], opcoes)
  assert.deepEqual(r, { itens: [], feitos: 0, total: 0 })
})

test('caso 18: o contador conta o que é meu e vence hoje', () => {
  const r = rituaisDoDia(CHECK, [{ traveler_id: 'p1', item_id: 'c1', feito: true }], opcoes)
  assert.deepEqual(
    r.itens.map((i) => i.id).sort(),
    ['c1', 'c2', 'c3', 'c4'],
  )
  assert.equal(r.total, 4)
  assert.equal(r.feitos, 1)
})

test('item de outra pessoa, de outra data e sugestão pendente ficam de fora', () => {
  const ids = rituaisDoDia(CHECK, [], opcoes).itens.map((i) => i.id)
  assert.equal(ids.includes('c5'), false)
  assert.equal(ids.includes('c6'), false)
  assert.equal(ids.includes('c7'), false)
})

test('caso 19: checklist completo tem feitos iguais ao total', () => {
  const estado = ['c1', 'c2', 'c3', 'c4'].map((id) => ({
    traveler_id: 'p1',
    item_id: id,
    feito: true,
  }))
  const r = rituaisDoDia(CHECK, estado, opcoes)
  assert.equal(r.feitos, r.total)
  assert.equal(r.total, 4)
})

test('prazo máximo vencido marca atrasado, e o pendente vem primeiro na lista', () => {
  const r = rituaisDoDia(CHECK, [], { ...opcoes, chave: '2026-12-31' })
  assert.equal(r.itens.find((i) => i.id === 'c2')?.atrasado, true)
  assert.equal(r.itens[0].feito, false)
})

test('marcação de outra pessoa não conta como minha', () => {
  const r = rituaisDoDia(CHECK, [{ traveler_id: 'p9', item_id: 'c1', feito: true }], opcoes)
  assert.equal(r.feitos, 0)
})

// ---------------------------------------------------------------- montarHoje

const VIAGEM = { nome: 'Europa', data_partida: PARTIDA, data_retorno: RETORNO, moeda: 'EUR' }

const base = (extra: Record<string, unknown> = {}) => ({
  viagem: VIAGEM,
  roteiro: DIA_CHEIO,
  reservas: [HOTEL],
  lugares: [{ cidade: 'Madri', lat: 40.41, lon: -3.7 }],
  checklist: CHECK,
  checklist_state: [],
  financeiro: { admin: false, obrigacoes: [] },
  eu: { participanteId: 'p1' },
  ...extra,
})

test('montarHoje reúne a tela inteira num instante só', () => {
  const h = montarHoje(base(), AGORA)!
  assert.equal(h.dia.numero, 6)
  assert.equal(h.cidade, 'Madri')
  assert.equal(h.atual?.item.id, 'e1')
  assert.equal(h.proximo?.item.id, 'e2')
  assert.equal(formatarHoraLocal(h.proximo!.deslocamento.sairAs), '11:11')
  assert.equal(h.hospedagem?.id, 'r1')
  assert.deepEqual(h.coordenada, { lat: 40.41, lon: -3.7 })
})

test('caso 5: "depois disso" conta o que sobra além do próximo', () => {
  const h = montarHoje(base(), AGORA)!
  assert.deepEqual(
    h.depois.map((e) => e.id),
    ['e3', 'e4'],
  )
})

test('caso 23: dia terminado mantém hospedagem e rituais de pé', () => {
  const h = montarHoje(base(), new Date(2026, 11, 30, 23, 30))!
  assert.equal(h.atual, null)
  assert.equal(h.proximo, null)
  assert.deepEqual(h.depois, [])
  assert.equal(h.hospedagem?.id, 'r1')
  assert.equal(h.rituais.total > 0, true)
})

test('caso 21: antes da viagem a fase é `antes` e o dia não tem número', () => {
  const h = montarHoje(base(), new Date(2026, 10, 1, 10, 0))!
  assert.equal(h.dia.fase, 'antes')
  assert.equal(h.dia.numero, 0)
  assert.equal(h.dia.faltam > 0, true)
})

test('antes da viagem, o próximo é o da VIAGEM inteira, não o de hoje', () => {
  // 01/11 não tem item nenhum; recortar por dia deixaria o bloco sempre vazio.
  const h = montarHoje(base(), new Date(2026, 10, 1, 10, 0))!
  assert.equal(h.atual, null)
  assert.equal(h.proximo?.item.id, 'e1')
  assert.deepEqual(h.depois, [])
  // Ninguém dorme em lugar nenhum "hoje" antes de a viagem começar.
  assert.equal(h.hospedagem, null)
})

test('caso 22: depois da viagem nada está em curso e o hotel não existe mais', () => {
  const h = montarHoje(base(), new Date(2027, 1, 1, 10, 0))!
  assert.equal(h.dia.fase, 'depois')
  assert.equal(h.atual, null)
  assert.equal(h.proximo, null)
  assert.deepEqual(h.depois, [])
  assert.equal(h.hospedagem, null)
})

test('sem viagem no snapshot não há tela', () => {
  assert.equal(montarHoje(null, AGORA), null)
  assert.equal(montarHoje({ viagem: null }, AGORA), null)
})

test('roteiro vazio não quebra a montagem', () => {
  const h = montarHoje(base({ roteiro: [], lugares: [] }), AGORA)!
  assert.equal(h.atual, null)
  assert.equal(h.proximo, null)
  assert.equal(h.cidade, null)
  assert.equal(h.coordenada, null)
})

test('caso 20: viagem noutro fuso usa o relógio do destino e avisa', () => {
  // 22:00 em São Paulo do dia 30 = 02:00 em Madri do dia 31.
  const noBrasil = new Date(Date.UTC(2026, 11, 31, 1, 0))
  const h = montarHoje(base({ viagem: { ...VIAGEM, fuso: 'Europe/Madrid' } }), noBrasil)!
  assert.equal(h.dia.chave, '2026-12-31')
  assert.equal(h.outroFuso, true)
})

test('pagamento do dia aparece só quando vence hoje e ainda falta pagar', () => {
  const obrigacoes = [
    { vence_em: DIA, valor_centavos: 25000, pago_centavos: 0, descricao: 'Hotel Madri' },
    { vence_em: DIA, valor_centavos: 5000, pago_centavos: 5000, descricao: 'Já paga' },
    { vence_em: '2027-01-05', valor_centavos: 9000, pago_centavos: 0, descricao: 'Outra' },
  ]
  const h = montarHoje(base({ financeiro: { admin: false, obrigacoes } }), AGORA)!
  assert.deepEqual(h.pagamentoHoje, { valorCentavos: 25000, descricao: 'Hotel Madri' })
})

test('sem parcela vencendo hoje o bloco de pagamento some', () => {
  assert.equal(montarHoje(base(), AGORA)!.pagamentoHoje, null)
})

// ---------------------------------------------------------------- formatação

test('formatarRestante fala como gente', () => {
  assert.equal(formatarRestante(66), '1h06')
  assert.equal(formatarRestante(45), '45 min')
  assert.equal(formatarRestante(120), '2h')
  assert.equal(formatarRestante(0), 'Encerrado')
  assert.equal(formatarRestante(-5), 'Encerrado')
})

test('formatarHoraLocal preenche com zero e não converte fuso', () => {
  assert.equal(formatarHoraLocal(new Date(2026, 11, 30, 9, 5)), '09:05')
  assert.equal(formatarHoraLocal(null), '')
})
