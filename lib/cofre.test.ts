import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  agruparPorDestino,
  chaveDestino,
  documentosDoDia,
  extensao,
  fichaCategoria,
  filtrarDocumentos,
  formatarTamanho,
  ordenarDocumentos,
  pessoasComDocumentos,
  normalizarCategoria,
  podeApagar,
  podeEscrever,
  tagsComCategoria,
  resumoCofre,
  statusOffline,
  statusValidade,
  type Documento,
  type Lugar,
} from './cofre.ts'

const doc = (p: Partial<Documento> & { id: string; titulo: string }): Documento => ({
  tipo: 'arquivo',
  ...p,
})

// ---------------------------------------------------------------- semaforo

test('status offline: baixado neste aparelho ganha de tudo', () => {
  const d = doc({ id: 'a', titulo: 'Passaporte', offline: true })
  assert.equal(statusOffline(d, new Set(['a']), new Set(['a'])), 'disponivel')
})

test('status offline: marcado e ainda nao baixado fica aguardando', () => {
  const d = doc({ id: 'a', titulo: 'Passaporte', offline: true })
  assert.equal(statusOffline(d, new Set()), 'aguardando')
})

test('status offline: falha de download vira erro, nao aguardando', () => {
  const d = doc({ id: 'a', titulo: 'Passaporte', offline: true })
  assert.equal(statusOffline(d, new Set(), new Set(['a'])), 'erro')
})

test('status offline: sem pedido de offline e so online', () => {
  assert.equal(statusOffline(doc({ id: 'a', titulo: 'Voucher' }), new Set()), 'online')
})

test('resumo do cofre ignora documento que nao tem arquivo', () => {
  const docs = [
    doc({ id: 'a', titulo: 'Passaporte', offline: true }),
    doc({ id: 'b', titulo: 'Apolice', tipo: 'texto', offline: true }),
    doc({ id: 'c', titulo: 'Voucher', offline: true }),
  ]
  const r = resumoCofre(docs, new Set(['a']), new Set(['c']))
  // 'b' e um numero de apolice: ja viaja dentro do snapshot, nao entra na conta.
  assert.deepEqual(r, { disponiveis: 1, aguardando: 0, problemas: 1 })
})

// ---------------------------------------------------------------- validade

test('validade vencida devolve dias negativos', () => {
  const v = statusValidade('2026-01-01', '2026-08-25')
  assert.equal(v?.nivel, 'vencido')
  assert.ok(v!.dias < 0, `esperava negativo, veio ${v?.dias}`)
})

test('validade dentro da janela de 90 dias avisa', () => {
  assert.equal(statusValidade('2026-10-01', '2026-08-25')?.nivel, 'proximo')
})

test('validade distante nao avisa', () => {
  assert.equal(statusValidade('2031-04-12', '2026-08-25')?.nivel, 'ok')
})

test('validade que vence hoje conta como proxima, nao vencida', () => {
  const v = statusValidade('2026-08-25', '2026-08-25')
  assert.equal(v?.nivel, 'proximo')
  assert.equal(v?.dias, 0)
})

test('sem validade nao ha alerta nenhum', () => {
  assert.equal(statusValidade(null), null)
})

// A regressao que motivou o guarda: `String(Date).slice(0,10)` em lib/db.ts
// entregava "Wed Jan 05" como validade do passaporte. `diasAte` devolve 0 nos
// dois sentidos para qualquer lixo, entao TODO passaporte cadastrado aparecia
// vencendo hoje, com a data em branco na tela. Data ilegivel = sem vencimento.
test('validade ilegivel nao vira "vence hoje"', () => {
  assert.equal(statusValidade('Wed Jan 05', '2026-08-25'), null)
  assert.equal(statusValidade('05/01/2033', '2026-08-25'), null)
})

// ---------------------------------------------------------------- busca

test('busca acha sem acento e sem caixa', () => {
  const docs = [
    doc({ id: 'a', titulo: 'Reserva Hotel Lisboa', cidade: 'Lisboa' }),
    doc({ id: 'b', titulo: 'Passagem LATAM' }),
  ]
  assert.deepEqual(
    filtrarDocumentos(docs, { busca: 'HOTEL' }).map((d) => d.id),
    ['a'],
  )
})

test('busca alcanca cidade, tag e nome do arquivo', () => {
  const docs = [
    doc({ id: 'a', titulo: 'Voucher', cidade: 'São Paulo' }),
    doc({ id: 'b', titulo: 'Bilhete', tags: ['embarque'] }),
    doc({ id: 'c', titulo: 'Comprovante', arquivo_nome: 'Reserva_Hotel_Madrid.pdf' }),
  ]
  assert.deepEqual(
    filtrarDocumentos(docs, { busca: 'sao paulo' }).map((d) => d.id),
    ['a'],
  )
  assert.deepEqual(
    filtrarDocumentos(docs, { busca: 'embarque' }).map((d) => d.id),
    ['b'],
  )
  assert.deepEqual(
    filtrarDocumentos(docs, { busca: 'madrid' }).map((d) => d.id),
    ['c'],
  )
})

test('busca alcanca o nome do participante, que nao esta na linha', () => {
  const docs = [doc({ id: 'a', titulo: 'Passaporte', traveler_id: 'p-leo' })]
  const nomes = new Map([['p-leo', 'Leonardo']])
  assert.deepEqual(
    filtrarDocumentos(docs, { busca: 'leonardo' }, nomes).map((d) => d.id),
    ['a'],
  )
})

test('filtro por participante nao esconde documento do grupo', () => {
  const docs = [
    doc({ id: 'grupo', titulo: 'Reserva do hotel' }),
    doc({ id: 'leo', titulo: 'Passaporte', escopo: 'pessoal', traveler_id: 'p-leo' }),
    doc({ id: 'ana', titulo: 'Passaporte', escopo: 'pessoal', traveler_id: 'p-ana' }),
  ]
  assert.deepEqual(
    filtrarDocumentos(docs, { participantes: ['p-leo'] }).map((d) => d.id),
    ['grupo', 'leo'],
  )
})

test('filtro de offline pega a intencao, nao o que ja baixou', () => {
  const docs = [
    doc({ id: 'a', titulo: 'Passaporte', offline: true }),
    doc({ id: 'b', titulo: 'Mapa' }),
  ]
  assert.deepEqual(
    filtrarDocumentos(docs, { offline: true }).map((d) => d.id),
    ['a'],
  )
})

test('filtros se acumulam em vez de competir', () => {
  const docs = [
    doc({ id: 'a', titulo: 'Reserva Hotel', categoria: 'hospedagem', cidade: 'Madri' }),
    doc({ id: 'b', titulo: 'Reserva Hotel', categoria: 'hospedagem', cidade: 'Lisboa' }),
    doc({ id: 'c', titulo: 'Passagem', categoria: 'voo', cidade: 'Madri' }),
  ]
  assert.deepEqual(
    filtrarDocumentos(docs, {
      categorias: ['hospedagem'],
      destinos: [chaveDestino(doc({ id: 'x', titulo: 'x', cidade: 'Madri' }))],
    }).map((d) => d.id),
    ['a'],
  )
})

test('extensao sai do nome do arquivo, e jpeg vira jpg', () => {
  assert.equal(extensao(doc({ id: 'a', titulo: 'x', arquivo_nome: 'Voucher.PDF' })), 'pdf')
  assert.equal(extensao(doc({ id: 'b', titulo: 'x', arquivo_mime: 'image/jpeg' })), 'jpg')
})

// ---------------------------------------------------------------- destinos

const LUGARES: Lugar[] = [
  { id: 'l3', cidade: 'Paris', pais: 'França', chega_em: '2027-01-03', sai_em: '2027-01-06' },
  { id: 'l1', cidade: 'Lisboa', pais: 'Portugal', chega_em: '2026-12-30', sai_em: '2027-01-01' },
  { id: 'l2', cidade: 'Madri', pais: 'Espanha', chega_em: '2027-01-01', sai_em: '2027-01-03' },
]

test('agrupa na ordem da viagem, nao em ordem alfabetica', () => {
  const docs = [
    doc({ id: 'p', titulo: 'Passagem Paris', cidade: 'Paris' }),
    doc({ id: 'm', titulo: 'Reserva Madri', cidade: 'Madri' }),
    doc({ id: 'l', titulo: 'Hotel Lisboa', cidade: 'Lisboa' }),
  ]
  assert.deepEqual(
    agruparPorDestino(docs, LUGARES).map((g) => g.cidade),
    ['Lisboa', 'Madri', 'Paris'],
  )
})

test('documento sem destino abre a lista como "Toda a viagem"', () => {
  const docs = [
    doc({ id: 'm', titulo: 'Reserva', cidade: 'Madri' }),
    doc({ id: 'passaporte', titulo: 'Passaporte' }),
  ]
  const grupos = agruparPorDestino(docs, LUGARES)
  assert.equal(grupos[0]?.cidade, 'Toda a viagem')
  assert.deepEqual(
    grupos[0]?.documentos.map((d) => d.id),
    ['passaporte'],
  )
})

test('destino sem documento nenhum nao vira grupo vazio', () => {
  const grupos = agruparPorDestino([doc({ id: 'l', titulo: 'x', cidade: 'Lisboa' })], LUGARES)
  assert.deepEqual(
    grupos.map((g) => g.cidade),
    ['Lisboa'],
  )
})

test('cidade que nao esta em lugares cai num grupo no fim, sem sumir da tela', () => {
  const docs = [
    doc({ id: 'l', titulo: 'Hotel', cidade: 'Lisboa' }),
    doc({ id: 'x', titulo: 'Ingresso', cidade: 'Hamburgo' }),
  ]
  const grupos = agruparPorDestino(docs, LUGARES)
  assert.deepEqual(
    grupos.map((g) => g.cidade),
    ['Lisboa', 'Hamburgo'],
  )
})

test('cidade com acento e caixa diferente cai no mesmo grupo', () => {
  const docs = [
    doc({ id: 'a', titulo: 'A', cidade: 'MADRI' }),
    doc({ id: 'b', titulo: 'B', cidade: 'madri' }),
  ]
  const grupos = agruparPorDestino(docs, LUGARES)
  assert.equal(grupos.length, 1)
  assert.equal(grupos[0]?.documentos.length, 2)
})

test('importante sobe dentro do destino', () => {
  const docs = [
    doc({ id: 'comum', titulo: 'A', ordem: 0 }),
    doc({ id: 'estrela', titulo: 'Z', ordem: 9, importante: true }),
  ]
  assert.deepEqual(
    ordenarDocumentos(docs).map((d) => d.id),
    ['estrela', 'comum'],
  )
})

// ---------------------------------------------------------------- vinculos

test('documentos do dia juntam data, vinculo e o que e importante o tempo todo', () => {
  const docs = [
    doc({ id: 'dia', titulo: 'Cartao de embarque', dia: '2027-01-03' }),
    doc({ id: 'voo', titulo: 'Passagem', flight_id: 'v1' }),
    doc({ id: 'passaporte', titulo: 'Passaporte', importante: true }),
    doc({ id: 'outro', titulo: 'Ingresso de museu', dia: '2027-01-05' }),
    doc({ id: 'hotel', titulo: 'Hotel Lisboa', cidade: 'Lisboa', importante: true }),
  ]
  const ids = documentosDoDia(docs, '2027-01-03', { voos: ['v1'] }).map((d) => d.id)
  assert.deepEqual(ids.sort(), ['dia', 'passaporte', 'voo'])
  // 'hotel' e importante mas tem destino proprio: ele pertence a Lisboa, nao a
  // todo dia da viagem. Sem esta guarda, o dia vira uma copia do cofre inteiro.
  assert.ok(!ids.includes('hotel'))
})

test('documentos do dia devolvem a referencia, nunca uma copia', () => {
  const original = doc({ id: 'dia', titulo: 'Cartao', dia: '2027-01-03' })
  const [achado] = documentosDoDia([original], '2027-01-03')
  assert.equal(achado, original)
})

// ---------------------------------------------------------------- formatacao

test('tamanho legivel em kB e MB', () => {
  assert.match(formatarTamanho(2048), /2/)
  assert.match(formatarTamanho(3 * 1024 * 1024), /3/)
  assert.equal(formatarTamanho(null), '')
})

// ---------------------------------------------------------------- categoria fora da lista
//
// `documents.categoria` e uma coluna de TEXTO. Linha gravada antes da constraint,
// import antigo ou escrita por outro caminho trazem valor fora das catorze — e
// indexar CATEGORIAS direto com ele devolvia undefined e derrubava a aba inteira.

test('categoria desconhecida nao quebra: vira rotulo proprio em tom neutro', () => {
  const f = fichaCategoria('Hotel Boutique')
  assert.equal(f.rotulo, 'Hotel Boutique')
  assert.equal(f.tom, 'neutro')
})

test('categoria conhecida devolve o rotulo e o tom da tabela', () => {
  assert.equal(fichaCategoria('hospedagem').rotulo, 'Hospedagem')
  assert.equal(fichaCategoria('hospedagem').tom, 'hospedagem')
})

test('categoria ausente cai em "outro" em vez de undefined', () => {
  assert.equal(fichaCategoria(null).rotulo, 'Outro')
  assert.equal(fichaCategoria(undefined).tom, 'neutro')
  assert.equal(fichaCategoria('').rotulo, 'Outro')
})

test('busca e filtro sobrevivem a documento com categoria fora da lista', () => {
  const docs = [
    doc({ id: 'legado', titulo: 'Voucher antigo', categoria: 'Hotel Boutique' }),
    doc({ id: 'novo', titulo: 'Reserva', categoria: 'hospedagem' }),
  ]
  // A categoria de legado continua pesquisavel pelo proprio texto...
  assert.deepEqual(
    filtrarDocumentos(docs, { busca: 'boutique' }).map((d) => d.id),
    ['legado'],
  )
  // ...e nao casa com nenhum filtro de categoria, que e o certo.
  assert.deepEqual(
    filtrarDocumentos(docs, { categorias: ['hospedagem'] }).map((d) => d.id),
    ['novo'],
  )
})

test('agrupar e resumir nao explodem com categoria fora da lista', () => {
  const docs = [doc({ id: 'legado', titulo: 'X', categoria: 'Qualquer Coisa', offline: true })]
  assert.doesNotThrow(() => agruparPorDestino(docs, LUGARES))
  assert.doesNotThrow(() => resumoCofre(docs, new Set(), new Set()))
})

// ---------------------------------------------------------------- filtro por pessoa

const PARTICIPANTES = [{ id: 'p-leo' }, { id: 'p-ana' }, { id: 'p-rui' }]

test('filtro por pessoa oferece so quem tem documento visivel', () => {
  // O cofre de um visualizador ja chega sem os pessoais alheios. Oferecer a Ana
  // no filtro faria a tela vazia parecer "a Ana nao subiu nada".
  const meuCofre = [
    doc({ id: 'grupo', titulo: 'Reserva do hotel' }),
    doc({ id: 'meu', titulo: 'Passaporte', escopo: 'pessoal', traveler_id: 'p-leo' }),
  ]
  assert.deepEqual(pessoasComDocumentos(meuCofre, PARTICIPANTES), ['p-leo'])
})

test('quem compartilhou comigo entra no filtro', () => {
  const docs = [
    doc({
      id: 'x',
      titulo: 'Apolice',
      escopo: 'pessoal',
      traveler_id: 'p-ana',
      assigned_to: ['p-leo'],
    }),
  ]
  assert.deepEqual(pessoasComDocumentos(docs, PARTICIPANTES), ['p-leo', 'p-ana'])
})

test('participante sem documento nenhum nao vira opcao de filtro', () => {
  const docs = [doc({ id: 'a', titulo: 'X', escopo: 'pessoal', traveler_id: 'p-leo' })]
  assert.ok(!pessoasComDocumentos(docs, PARTICIPANTES).includes('p-rui'))
})

test('a ordem e a da viagem, nao a de aparicao', () => {
  const docs = [
    doc({ id: 'a', titulo: 'X', escopo: 'pessoal', traveler_id: 'p-rui' }),
    doc({ id: 'b', titulo: 'Y', escopo: 'pessoal', traveler_id: 'p-leo' }),
  ]
  assert.deepEqual(pessoasComDocumentos(docs, PARTICIPANTES), ['p-leo', 'p-rui'])
})

test('cofre sem documento pessoal nenhum nao oferece filtro por pessoa', () => {
  const docs = [doc({ id: 'grupo', titulo: 'Reserva' })]
  assert.deepEqual(pessoasComDocumentos(docs, PARTICIPANTES), [])
})

// ---------------------------------------------------------------- quem escreve
//
// Espelho de `autorizar` em app/api/mutate/route.ts e da checagem de
// POST /api/documento. Se um dos dois mudar sem o outro, e aqui que aparece.

const doGrupo = { escopo: 'global', traveler_id: null }
const daAna = { escopo: 'pessoal', traveler_id: 'p-ana' }
const meu = { escopo: 'pessoal', traveler_id: 'p-leo' }

test('proprietario escreve qualquer documento, inclusive o pessoal alheio', () => {
  assert.ok(podeEscrever(doGrupo, 'proprietario', 'p-leo'))
  assert.ok(podeEscrever(daAna, 'proprietario', 'p-leo'))
})

test('editor escreve o do grupo mas nao o passaporte de outra pessoa', () => {
  assert.ok(podeEscrever(doGrupo, 'editor', 'p-leo'))
  assert.ok(podeEscrever(meu, 'editor', 'p-leo'))
  assert.ok(!podeEscrever(daAna, 'editor', 'p-leo'))
})

test('visualizador escreve o proprio documento pessoal, e so ele', () => {
  assert.ok(podeEscrever(meu, 'visualizador', 'p-leo'))
  assert.ok(!podeEscrever(doGrupo, 'visualizador', 'p-leo'))
  assert.ok(!podeEscrever(daAna, 'visualizador', 'p-leo'))
})

test('sem papel nenhum nao escreve nem apaga nada', () => {
  assert.ok(!podeEscrever(meu, null, 'p-leo'))
  assert.ok(!podeEscrever(doGrupo, undefined, 'p-leo'))
  assert.ok(!podeApagar(meu, null, 'p-leo'))
  // O caso que fez a primeira versao passar sem querer: participante vazio
  // casando com documento sem dono.
  assert.ok(!podeEscrever({ escopo: 'pessoal', traveler_id: null }, null, ''))
})

test('apagar e mais estrito que editar: editor nao apaga documento do grupo', () => {
  assert.ok(podeEscrever(doGrupo, 'editor', 'p-leo'))
  assert.ok(!podeApagar(doGrupo, 'editor', 'p-leo'))
  assert.ok(podeApagar(doGrupo, 'proprietario', 'p-leo'))
})

test('o dono apaga o proprio documento pessoal mesmo como visualizador', () => {
  assert.ok(podeApagar(meu, 'visualizador', 'p-leo'))
  assert.ok(!podeApagar(daAna, 'visualizador', 'p-leo'))
})

// ---------------------------------------------------------------- categoria legada
//
// `documents.categoria` foi texto livre, e a constraint que fechou a lista e
// `not valid`: linha antiga fica, INSERT novo tem que caber. Duplicar viagem e
// exportar-para-reimportar sao os dois caminhos que re-inserem linhas antigas —
// os dois davam 500 numa viagem real e passavam numa viagem nova.

test('categoria da lista passa intacta', () => {
  assert.equal(normalizarCategoria('passaporte'), 'passaporte')
  assert.equal(normalizarCategoria('voo'), 'voo')
})

test('categoria vazia continua nula, nao vira "outro"', () => {
  assert.equal(normalizarCategoria(null), null)
  assert.equal(normalizarCategoria(''), null)
  assert.equal(normalizarCategoria('   '), null)
})

test('categoria legada vira "outro" em vez de derrubar o insert', () => {
  assert.equal(normalizarCategoria('Companhias aéreas'), 'outro')
  assert.equal(normalizarCategoria('Voos'), 'outro')
})

test('a palavra original sobrevive como tag, para a busca continuar achando', () => {
  assert.deepEqual(tagsComCategoria([], 'Companhias aéreas'), ['Companhias aéreas'])
  assert.deepEqual(tagsComCategoria(['x'], 'Voos'), ['x', 'Voos'])
})

test('categoria valida nao vira tag: seria a palavra repetida na tela', () => {
  assert.deepEqual(tagsComCategoria(['x'], 'passaporte'), ['x'])
  assert.deepEqual(tagsComCategoria(['x'], null), ['x'])
})

test('normalizar duas vezes nao duplica a tag', () => {
  const uma = tagsComCategoria([], 'Voos')
  assert.deepEqual(tagsComCategoria(uma, 'Voos'), ['Voos'])
})
