// Os testes do assistente são, em quase toda linha, testes de PRIVACIDADE.
//
// O motor é puro para caber aqui: sem navegador, sem rede, sem chave. O que se
// trava aqui é o que nenhuma revisão de código pega de forma confiável — que um
// campo novo com nome de dado pessoal não vaze para o modelo, e que um papel não
// ganhe ferramenta que ele não poderia usar.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ferramentas,
  entidadesDoPapel,
  digest,
  limpar,
  propostasDe,
  temRemocao,
  sistema,
  MODOS,
} from './assistente.ts'
import { somar, custoDe, agrupar, aproveitamentoCache } from './consumo.ts'

// ---------------------------------------------------------------- ferramentas

test('visualizador não recebe ferramenta de escrita da viagem', () => {
  const nomes = ferramentas('visualizador').map((f) => f.name)
  for (const proibida of ['propor_roteiro', 'propor_voo', 'propor_custo', 'propor_lugar']) {
    assert.ok(!nomes.includes(proibida), `visualizador não pode ${proibida}`)
  }
})

test('visualizador ainda marca o próprio checklist e entrega documentação', () => {
  const nomes = ferramentas('visualizador').map((f) => f.name)
  assert.ok(nomes.includes('propor_checklist_state'))
  assert.ok(nomes.includes('propor_entrega'))
})

test('editor recebe as ferramentas de conteúdo da viagem', () => {
  const nomes = ferramentas('editor').map((f) => f.name)
  for (const esperada of ['propor_roteiro', 'propor_lugar', 'propor_custo', 'propor_checklist_item']) {
    assert.ok(nomes.includes(esperada), `editor precisa de ${esperada}`)
  }
})

test('ninguém propõe participante nem viagem', () => {
  for (const papel of ['visualizador', 'editor', 'proprietario'] as const) {
    const nomes = ferramentas(papel).map((f) => f.name)
    assert.ok(!nomes.includes('propor_participante'), `${papel} não cria pessoa`)
    assert.ok(!nomes.includes('propor_viagem'), `${papel} não altera a viagem pelo chat`)
  }
})

test('toda ferramenta é strict e fechada a campo extra', () => {
  for (const f of ferramentas('proprietario')) {
    assert.equal(f.strict, true, `${f.name} precisa ser strict`)
    const esquema = f.input_schema as Record<string, unknown>
    assert.equal(esquema.additionalProperties, false, `${f.name} aceita campo extra`)
    assert.ok(Array.isArray(esquema.required) && (esquema.required as string[]).includes('op'))
  }
})

test('a ferramenta carrega os campos reais do schema, não um objeto livre', () => {
  const roteiro = ferramentas('editor').find((f) => f.name === 'propor_roteiro')!
  const campos = (roteiro.input_schema as never as { properties: { campos: { properties: object } } })
    .properties.campos.properties
  // `titulo` e `ocorre_em` são o mínimo de um item de roteiro; se sumirem daqui,
  // o schema deixou de ser a fonte das ferramentas.
  assert.ok('titulo' in campos)
  assert.ok('ocorre_em' in campos)
})

test('papel maior nunca tem menos ferramentas que papel menor', () => {
  const v = entidadesDoPapel('visualizador').length
  const e = entidadesDoPapel('editor').length
  const p = entidadesDoPapel('proprietario').length
  assert.ok(e >= v && p >= e)
})

// ---------------------------------------------------------------- privacidade

test('limpar derruba todo campo de dado pessoal', () => {
  const saida = limpar({
    nome: 'Ana',
    passaporte: 'FX123456',
    telefone: '+5511999999999',
    email: 'ana@exemplo.com',
    cpf: '000.000.000-00',
    valor: 'LOC4TOR',
    numero: 'AP-99',
    titulo: 'Passaporte',
  })
  assert.deepEqual(Object.keys(saida).sort(), ['nome', 'titulo'])
})

test('o digest não contém passaporte, telefone, e-mail nem valor de documento', () => {
  const texto = digest({
    viagem: { nome: 'Europa 2027', destino: 'Lisboa', moeda: 'EUR' },
    participantes: [
      { nome: 'Ana', papel: 'proprietario', passaporte: 'FX123456', telefone: '+5511999999999' },
    ],
    documentos: [
      { titulo: 'Seguro viagem', tipo: 'texto', valor: 'APOLICE-987654', validade: '2027-01-01' },
    ],
    reservas: [{ id: 'r1', nome: 'Hotel', cidade: 'Lisboa', valor: 'LOCALIZADOR-XYZ' }],
  })
  for (const segredo of ['FX123456', '+5511999999999', 'APOLICE-987654', 'LOCALIZADOR-XYZ']) {
    assert.ok(!texto.includes(segredo), `vazou: ${segredo}`)
  }
  // e ainda assim é útil: a existência e a validade continuam lá
  assert.ok(texto.includes('Seguro viagem'))
  assert.ok(texto.includes('2027-01-01'))
})

test('o digest de visualizador não anuncia totais da viagem', () => {
  const texto = digest({ financeiro: { admin: false } })
  assert.ok(texto.includes('apenas as próprias obrigações'))
  assert.ok(!texto.includes('acesso de administração'))
})

test('o sistema instrui a tratar conteúdo e web como dado, nunca instrução', () => {
  for (const modo of MODOS) {
    const s = sistema(modo)
    assert.ok(s.includes('DADO'), `${modo} sem a regra de injeção`)
    assert.ok(s.includes('nunca grava') || s.includes('PROPÕE'))
  }
})

// ---------------------------------------------------------------- propostas

const bloco = (name: string, input: unknown) => ({ type: 'tool_use', name, input })

test('traduz tool_use em proposta', () => {
  const [p] = propostasDe(
    [bloco('propor_roteiro', { op: 'criar', campos: { titulo: 'Louvre' }, resumo: 'Louvre no dia 3' })],
    'editor',
  )
  assert.equal(p.entidade, 'roteiro')
  assert.equal(p.op, 'criar')
  assert.equal(p.resumo, 'Louvre no dia 3')
  assert.ok(p.ref)
})

test('descarta entidade que o papel não alcança', () => {
  const saida = propostasDe(
    [bloco('propor_roteiro', { op: 'criar', campos: {}, resumo: 'x' })],
    'visualizador',
  )
  assert.equal(saida.length, 0)
})

test('descarta ferramenta desconhecida e bloco que não é tool_use', () => {
  assert.equal(propostasDe([bloco('propor_inventada', { op: 'criar' })], 'proprietario').length, 0)
  assert.equal(propostasDe([{ type: 'text', name: 'propor_roteiro' }], 'proprietario').length, 0)
})

test('editar e remover sem id são descartados', () => {
  const saida = propostasDe(
    [
      bloco('propor_roteiro', { op: 'editar', campos: {}, resumo: 'x' }),
      bloco('propor_roteiro', { op: 'remover', campos: {}, resumo: 'x' }),
      bloco('propor_roteiro', { op: 'remover', id: 'e1', campos: {}, resumo: 'apaga' }),
    ],
    'editor',
  )
  assert.equal(saida.length, 1)
  assert.equal(saida[0].op, 'remover')
})

test('temRemocao acha a remoção que a tela precisa destacar', () => {
  const ps = propostasDe(
    [
      bloco('propor_roteiro', { op: 'criar', campos: {}, resumo: 'a' }),
      bloco('propor_roteiro', { op: 'remover', id: 'e1', campos: {}, resumo: 'b' }),
    ],
    'editor',
  )
  assert.ok(temRemocao(ps))
})

test('refs são únicos dentro de um lote', () => {
  const ps = propostasDe(
    [
      bloco('propor_roteiro', { op: 'criar', campos: {}, resumo: 'a' }),
      bloco('propor_roteiro', { op: 'criar', campos: {}, resumo: 'b' }),
    ],
    'editor',
  )
  assert.equal(new Set(ps.map((p) => p.ref)).size, 2)
})

// ---------------------------------------------------------------- consumo

const uso = (over: Partial<Parameters<typeof custoDe>[0]> = {}) => ({
  user_id: 'u1',
  modo: 'duvida',
  modelo: 'claude-opus-5',
  entrada: 1_000_000,
  saida: 0,
  cache_leitura: 0,
  cache_escrita: 0,
  ...over,
})

test('um milhão de tokens de entrada custa o preço de tabela', () => {
  assert.equal(custoDe(uso()).dolar, 5)
})

test('modelo fora da tabela não quebra o relatório', () => {
  const c = custoDe(uso({ modelo: 'modelo-que-nao-existe' }))
  assert.equal(c.dolar, 0)
  assert.equal(c.estimado, false)
  assert.equal(somar([uso({ modelo: 'modelo-que-nao-existe' })]).incompleto, true)
})

test('busca na web é contada, não somada ao custo', () => {
  const c = custoDe(uso({ busca_web: 3 }))
  assert.equal(c.buscas, 3)
  assert.equal(c.dolar, 5, 'sem preço confirmado, a busca não entra na estimativa')
})

test('agrupar separa por pessoa e ordena pelo maior gasto', () => {
  const linhas = [uso({ user_id: 'a' }), uso({ user_id: 'b', entrada: 2_000_000 })]
  const grupos = agrupar(linhas, 'user_id')
  assert.equal(grupos[0].valor, 'b')
  assert.equal(grupos.length, 2)
})

test('aproveitamento de cache é nulo sem entrada e percentual com ela', () => {
  assert.equal(aproveitamentoCache(somar([])), null)
  const r = somar([uso({ entrada: 100, cache_leitura: 300 })])
  assert.equal(aproveitamentoCache(r), 75)
})
