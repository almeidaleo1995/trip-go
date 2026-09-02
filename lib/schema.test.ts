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
  colunaValida,
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
      {
        titulo: 'Remédio',
        escopo: 'pessoal',
        assigned_to_nomes: ['Leonardo'],
        prioridade: 'obrigatorio',
      },
    ],
  })
  assert.equal(r.sucesso, true)
  assert.deepEqual(r.sucesso && r.dados.checklist[0].assigned_to_nomes, ['Leonardo'])
})

test('ChecklistSugestoesBatchSchema aceita lote vazio', () => {
  const r = ChecklistSugestoesBatchSchema.safeParse({
    viagem: 'Europa 2027',
    gerado_em: '2026-08-20',
  })
  assert.equal(r.success, true)
  assert.deepEqual(r.success && r.data.sugestoes, [])
})

// ---------------------------------------------------------------- valores do cliente
//
// Tres valores que o cliente manda e o servidor usava sem teto. Os testes sao
// comportamentais porque estes schemas sao zod puro: nada aqui precisa de banco.

const base = { op: 'editar' as const, entidade: 'voo' as const, id: 'x', campos: {} }

test('client_ts no futuro e puxado para agora', () => {
  const r = MutationSchema.parse({ ...base, client_ts: '9999-12-31T23:59:59.000Z' })
  const distancia = Date.parse(r.client_ts) - Date.now()
  assert.ok(
    distancia < 10 * 60 * 1000,
    'client_ts do ano 9999 sobreviveu. Ele e o comparador das tres checagens de ' +
      'LWW (`updated_at < client_ts`), entao sem teto essa escrita vence todo ' +
      'conflito para sempre e sobrescreve a edicao de qualquer outra pessoa.',
  )
})

test('client_ts no passado sobrevive intacto', () => {
  // O carimbo e a hora em que a EDICAO aconteceu: passado e o caso NORMAL de uma
  // escrita que ficou na fila offline. Tetar isso mataria o modo aviao.
  const ontem = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  assert.equal(MutationSchema.parse({ ...base, client_ts: ontem }).client_ts, ontem)
})

test('deriva normal de relogio nao e mexida', () => {
  const poucoAdiantado = new Date(Date.now() + 60 * 1000).toISOString()
  assert.equal(
    MutationSchema.parse({ ...base, client_ts: poucoAdiantado }).client_ts,
    poucoAdiantado,
    'um minuto adiantado e deriva de aparelho, nao ataque -- puxar isso seria ruido',
  )
})

test('dinheiro nao passa do que a coluna integer aguenta', () => {
  const ok = validarCampos('custo', {
    descricao: 'jantar',
    valor_centavos: 2_147_483_647,
    divisao: 'igual',
  })
  assert.equal(ok.sucesso, true, 'o teto exato tem que passar')

  const estoura = validarCampos('custo', {
    descricao: 'jantar',
    valor_centavos: 2_147_483_648,
    divisao: 'igual',
  })
  assert.equal(
    estoura.sucesso,
    false,
    'valor acima do `integer` do Postgres passou pelo zod. Quem recusa vira o ' +
      'banco, com `integer out of range`, e a casca de rota() transforma num 500 ' +
      'generico -- a pessoa perde a mensagem que diria o que houve.',
  )
})

test('o valor de uma parcela nao entra pela mutacao', () => {
  for (const campo of ['valor_centavos', 'vence_em', 'numero']) {
    assert.equal(
      colunaValida('parcela', campo),
      false,
      `\`${campo}\` voltou a ser gravavel numa parcela. Os tres sao PRODUZIDOS por ` +
        '`gerarParcelas` a partir do total, da quantidade e da frequencia; aceita-los ' +
        'aqui abre um segundo caminho para o valor do parcelamento que nao confere ' +
        'nada contra o total da despesa.',
    )
  }
  assert.equal(colunaValida('parcela', 'pago_centavos'), true, 'marcar como pago tem que continuar')
})
