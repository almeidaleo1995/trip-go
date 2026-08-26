import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validarImportacao,
  resumirImportacao,
  validarCampos,
  MutationSchema,
  SCHEMA_VERSION,
  ChecklistSugestaoSchema,
  ChecklistSugestoesBatchSchema,
} from './schema.ts'

/** Importacao minima valida: so viagem, nenhuma lista. */
const MINIMA = {
  schemaVersion: SCHEMA_VERSION,
  viagem: { nome: 'Europa 2027', data_partida: '2026-12-30', data_retorno: '2027-01-15' },
}

// ---------------------------------------------------------------- importacao

test('aceita importacao so com a viagem, sem nenhuma lista', () => {
  const r = validarImportacao(MINIMA)
  assert.equal(r.sucesso, true)
  if (r.sucesso) {
    assert.equal(r.dados.viagem.moeda, 'BRL')
    assert.deepEqual(r.dados.voos, [])
  }
})

test('aplica os padroes de moeda e cor de destaque', () => {
  const r = validarImportacao(MINIMA)
  assert.equal(r.sucesso && r.dados.viagem.cor_destaque, '#0F766E')
})

test('recusa arquivo de versao mais nova que o app', () => {
  const r = validarImportacao({ ...MINIMA, schemaVersion: SCHEMA_VERSION + 1 })
  assert.equal(r.sucesso, false)
  assert.match(r.sucesso === false ? r.erro : '', /versao mais nova/)
})

test('recusa viagem sem nome', () => {
  const r = validarImportacao({ ...MINIMA, viagem: { ...MINIMA.viagem, nome: '  ' } })
  assert.equal(r.sucesso, false)
  assert.match(r.sucesso === false ? r.erro : '', /viagem\.nome/)
})

// ---------------------------------------------------------------- mensagem de erro aponta o campo

test('o erro aponta o indice e o campo exato dentro da lista', () => {
  const r = validarImportacao({
    ...MINIMA,
    voos: [
      { companhia: 'LATAM', parte_em: '2026-12-30T10:30' },
      { companhia: 'Iberia', parte_em: '2027-01-01T12:10' },
      { companhia: 'easyJet', parte_em: 'quinze horas' },
    ],
  })
  assert.equal(r.sucesso, false)
  assert.match(r.sucesso === false ? r.erro : '', /voos\[2\]\.parte_em/)
})

test('o erro aponta campo aninhado dentro de escala', () => {
  const r = validarImportacao({
    ...MINIMA,
    voos: [{ companhia: 'LATAM', escalas: [{ espera_min: -5 }] }],
  })
  assert.match(r.sucesso === false ? r.erro : '', /voos\[0\]\.escalas\[0\]\.espera_min/)
})

test('o erro aponta porto dentro de cruzeiro', () => {
  const r = validarImportacao({
    ...MINIMA,
    cruzeiros: [{ navio: 'MSC Preziosa', portos: [{ chega_em: '2027-01-05' }] }],
  })
  assert.match(r.sucesso === false ? r.erro : '', /cruzeiros\[0\]\.portos\[0\]\.chega_em/)
})

test('lista no maximo 5 erros e diz quantos sobraram', () => {
  const r = validarImportacao({
    ...MINIMA,
    lugares: Array.from({ length: 8 }, () => ({ cidade: '' })),
  })
  assert.match(r.sucesso === false ? r.erro : '', /e mais 3/)
})

// ---------------------------------------------------------------- datas

test('recusa data com rollover silencioso de mes', () => {
  const r = validarImportacao({
    ...MINIMA,
    viagem: { ...MINIMA.viagem, data_partida: '2026-13-05' },
  })
  assert.equal(r.sucesso, false)
})

test('recusa 30 de fevereiro', () => {
  const r = validarImportacao({
    ...MINIMA,
    viagem: { ...MINIMA.viagem, data_partida: '2027-02-30' },
  })
  assert.equal(r.sucesso, false)
})

test('recusa data-hora com fuso, porque horario e sempre local do destino', () => {
  const r = validarImportacao({
    ...MINIMA,
    roteiro: [{ ocorre_em: '2026-12-30T10:30:00Z', titulo: 'Decolagem' }],
  })
  assert.equal(r.sucesso, false)
})

test('aceita data-hora local sem fuso', () => {
  const r = validarImportacao({
    ...MINIMA,
    roteiro: [{ ocorre_em: '2026-12-30T10:30', titulo: 'LA719 decola', tipo: 'voo', ancora: true }],
  })
  assert.equal(r.sucesso, true)
})

// ---------------------------------------------------------------- dinheiro e PIN

test('recusa valor monetario negativo', () => {
  const r = validarImportacao({
    ...MINIMA,
    custos: [{ descricao: 'ETA', valor_centavos: -100, pessoas: 5 }],
  })
  assert.match(r.sucesso === false ? r.erro : '', /custos\[0\]\.valor_centavos/)
})

test('recusa valor monetario fracionado, porque o campo e centavos inteiros', () => {
  const r = validarImportacao({
    ...MINIMA,
    custos: [{ descricao: 'ETA', valor_centavos: 110.5, pessoas: 5 }],
  })
  assert.equal(r.sucesso, false)
})

test('recusa custo com zero pessoas', () => {
  const r = validarImportacao({
    ...MINIMA,
    custos: [{ descricao: 'x', valor_centavos: 100, pessoas: 0 }],
  })
  assert.match(r.sucesso === false ? r.erro : '', /pessoas/)
})

test('recusa papel fora da escala de tres', () => {
  const r = validarImportacao({ ...MINIMA, participantes: [{ nome: 'Leo', papel: 'admin' }] })
  assert.equal(r.sucesso, false)
  assert.match(r.sucesso === false ? r.erro : '', /participantes\[0\]\.papel/)
})

test('recusa coordenada fora do intervalo valido', () => {
  const r = validarImportacao({ ...MINIMA, lugares: [{ cidade: 'X', lat: 120, lon: 0 }] })
  assert.match(r.sucesso === false ? r.erro : '', /lugares\[0\]\.lat/)
})

// ---------------------------------------------------------------- resumo

test('resumirImportacao conta por secao, incluindo portos aninhados', () => {
  const r = validarImportacao({
    ...MINIMA,
    participantes: [{ nome: 'Leo' }, { nome: 'Alana' }],
    cruzeiros: [
      {
        navio: 'MSC Preziosa',
        portos: [{ porto: 'Zeebrugge' }, { porto: 'Roterdã' }, { dia_no_mar: true }],
      },
    ],
  })
  assert.equal(r.sucesso, true)
  if (!r.sucesso) return
  const resumo = resumirImportacao(r.dados)
  assert.equal(resumo.participantes, 2)
  assert.equal(resumo.cruzeiros, 1)
  assert.equal(resumo.portos, 3)
  assert.equal(resumo.voos, 0)
})

// A documentacao exigida e o caso classico do "backup que perde um campo em
// silencio": ela passa por schema.ts, /api/export, importar.ts e este resumo, e
// esquecer QUALQUER um dos quatro nao da erro nenhum — so entrega menos.
test('a documentacao exigida entra no resumo da importacao', () => {
  const r = validarImportacao({
    ...MINIMA,
    participantes: [{ nome: 'Leo' }],
    requisitos: [
      { nome: 'Passaporte', exige_numero: true, exige_validade: true, exige_arquivo: true },
      { nome: 'Seguro viagem' },
    ],
    entregas: [
      { requirement_id: 'x', traveler_id: 'y', requisito_nome: 'Passaporte', dono_nome: 'Leo' },
    ],
  })
  assert.equal(r.sucesso, true)
  if (!r.sucesso) return
  const resumo = resumirImportacao(r.dados)
  assert.equal(resumo.requisitos, 2)
  assert.equal(resumo.entregas, 1)
})

test('requisito sem nada exigido e valido: existe requisito que so pede o de-acordo', () => {
  const r = validarImportacao({ ...MINIMA, requisitos: [{ nome: 'Comprovante de vacinacao' }] })
  assert.equal(r.sucesso, true)
  if (!r.sucesso) return
  assert.equal(r.dados.requisitos[0].obrigatorio, true)
  assert.equal(r.dados.requisitos[0].aplica_todos, true)
  assert.equal(r.dados.requisitos[0].exige_arquivo, false)
})

test('entrega recusa status fora da lista de revisao', () => {
  const r = validarImportacao({
    ...MINIMA,
    entregas: [{ requirement_id: 'x', traveler_id: 'y', status: 'quase' }],
  })
  assert.equal(r.sucesso, false)
})

// ---------------------------------------------------------------- mutacoes

test('recusa mutacao em entidade desconhecida', () => {
  const r = MutationSchema.safeParse({
    op: 'editar',
    entidade: 'tabela_secreta',
    campos: {},
    client_ts: new Date().toISOString(),
  })
  assert.equal(r.success, false)
})

test('aceita mutacao nas entidades conhecidas', () => {
  const r = MutationSchema.safeParse({
    op: 'editar',
    entidade: 'custo',
    id: 'abc',
    campos: { valor_centavos: 500 },
    client_ts: new Date().toISOString(),
  })
  assert.equal(r.success, true)
})

test('recusa mutacao sem carimbo de tempo, que e a base do LWW', () => {
  const r = MutationSchema.safeParse({ op: 'editar', entidade: 'custo', campos: {} })
  assert.equal(r.success, false)
})

test('validarCampos rejeita valor negativo na edicao de custo', () => {
  const r = validarCampos('custo', { valor_centavos: -1 })
  assert.equal(r.sucesso, false)
  assert.match(r.sucesso === false ? r.erro : '', /valor_centavos/)
})

test('validarCampos aceita edicao parcial, so o campo que mudou', () => {
  const r = validarCampos('voo', { localizador: 'WSZIAK' })
  assert.equal(r.sucesso, true)
})

test('validarCampos rejeita papel invalido em participante', () => {
  assert.equal(validarCampos('participante', { papel: 'dono' }).sucesso, false)
})

// ---------------------------------------------------------------- checklist

test('checklist_item aceita edicao parcial sem prioridade nem assigned_to', () => {
  const r = validarCampos('checklist_item', { titulo: 'Passaporte' })
  assert.equal(r.sucesso, true)
})

test('checklist_item aplica prioridade padrao importante quando criado sem o campo', () => {
  const r = validarImportacao({
    ...MINIMA,
    checklist: [{ titulo: 'Passaporte' }],
  })
  assert.equal(r.sucesso, true)
  assert.equal(r.sucesso && r.dados.checklist[0].prioridade, 'importante')
})

test('checklist_item rejeita prioridade fora do enum', () => {
  const r = validarCampos('checklist_item', { prioridade: 'urgente' })
  assert.equal(r.sucesso, false)
  assert.match(r.sucesso === false ? r.erro : '', /prioridade/)
})

test('checklist_item aceita default de assigned_to vazio (todos)', () => {
  const r = validarImportacao({ ...MINIMA, checklist: [{ titulo: 'Seguro viagem' }] })
  assert.equal(r.sucesso, true)
  assert.deepEqual(r.sucesso && r.dados.checklist[0].assigned_to, [])
})

test('checklist_item rejeita fonte_tipo fora do enum', () => {
  const r = validarCampos('checklist_item', { fonte_tipo: 'chute' })
  assert.equal(r.sucesso, false)
  assert.match(r.sucesso === false ? r.erro : '', /fonte_tipo/)
})

const SUGESTAO_DOCUMENTO = {
  titulo: 'Conferir validade do passaporte',
  fonte_tipo: 'documento' as const,
}

test('ChecklistSugestaoSchema aceita sugestao com fonte documento sem detalhe', () => {
  const r = ChecklistSugestaoSchema.safeParse(SUGESTAO_DOCUMENTO)
  assert.equal(r.success, true)
})

test('ChecklistSugestaoSchema rejeita fonte pesquisa sem fonte_detalhe e sem data', () => {
  const r = ChecklistSugestaoSchema.safeParse({ ...SUGESTAO_DOCUMENTO, fonte_tipo: 'pesquisa' })
  assert.equal(r.success, false)
  assert.match(r.success ? '' : r.error.issues[0].path.join('.'), /fonte_detalhe/)
})

test('ChecklistSugestaoSchema aceita fonte pesquisa com detalhe e data', () => {
  const r = ChecklistSugestaoSchema.safeParse({
    ...SUGESTAO_DOCUMENTO,
    fonte_tipo: 'pesquisa',
    fonte_detalhe: 'site oficial do consulado',
    fonte_consultado_em: '2026-08-20',
  })
  assert.equal(r.success, true)
})

test('ChecklistSugestoesBatchSchema aceita lote com uma sugestao valida', () => {
  const r = ChecklistSugestoesBatchSchema.safeParse({
    viagem: 'Europa 2027',
    gerado_em: '2026-08-20',
    sugestoes: [SUGESTAO_DOCUMENTO],
  })
  assert.equal(r.success, true)
  assert.equal(r.success && r.data.sugestoes.length, 1)
})

test('checklist_item aceita assigned_to_nomes vindo de um arquivo exportado', () => {
  const r = validarImportacao({
    ...MINIMA,
    checklist: [
      { titulo: 'Remédio', escopo: 'pessoal', assigned_to_nomes: ['Leonardo'], prioridade: 'obrigatorio' },
    ],
  })
  assert.equal(r.sucesso, true)
  assert.deepEqual(r.sucesso && r.dados.checklist[0].assigned_to_nomes, ['Leonardo'])
})

test('ChecklistSugestoesBatchSchema aceita lote vazio', () => {
  const r = ChecklistSugestoesBatchSchema.safeParse({ viagem: 'Europa 2027', gerado_em: '2026-08-20' })
  assert.equal(r.success, true)
  assert.deepEqual(r.success && r.data.sugestoes, [])
})
