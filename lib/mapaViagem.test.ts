import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  agrupar,
  auditarMapa,
  categoriaDoItem,
  coordenada,
  etapasDaViagem,
  marcadoresDaViagem,
  marcadoresDoDia,
  mesmaCidade,
  pernasDaViagem,
} from './mapaViagem.ts'

// Uma viagem mínima que exercita os quatro módulos que alimentam o mapa.
const LUGARES = [
  { id: 'l1', cidade: 'Lisboa', pais: 'Portugal', lat: 38.72, lon: -9.14, ordem: 0 },
  { id: 'l2', cidade: 'Madri', pais: 'Espanha', lat: 40.42, lon: -3.7, ordem: 1 },
  { id: 'l3', cidade: 'Paris', pais: 'França', lat: 48.86, lon: 2.35, ordem: 2 },
]

const base = {
  lugares: LUGARES,
  roteiro: [
    {
      id: 'e1',
      titulo: 'Museu do Louvre',
      tipo: 'passeio',
      cidade: 'Paris',
      lat: 48.8606,
      lon: 2.3376,
      ocorre_em: '2027-01-06T15:00:00',
      endereco: 'Rue de Rivoli',
    },
    // Sem coordenada, mas com cidade conhecida -> aproximado.
    {
      id: 'e2',
      titulo: 'Almoço',
      tipo: 'restaurante',
      cidade: 'Paris',
      ocorre_em: '2027-01-06T12:30:00',
    },
    // Nem coordenada nem cidade em `lugares` -> fora do mapa.
    {
      id: 'e3',
      titulo: 'Passeio em Sintra',
      tipo: 'passeio',
      cidade: 'Sintra',
      ocorre_em: '2027-01-02T10:00:00',
    },
  ],
  reservas: [
    {
      id: 'r1',
      tipo: 'hospedagem',
      nome: 'Hotel Paris',
      cidade: 'Paris',
      lat: 48.87,
      lon: 2.33,
      inicio_em: '2027-01-04T15:00:00',
      fim_em: '2027-01-07T11:00:00',
    },
    // Um aluguel de carro não é um ponto no mapa.
    {
      id: 'r2',
      tipo: 'carro',
      nome: 'Locadora',
      cidade: 'Paris',
      inicio_em: '2027-01-04T09:00:00',
    },
  ],
  voos: [
    {
      id: 'v1',
      origem_cidade: 'Lisboa',
      destino_cidade: 'Madri',
      parte_em: '2027-01-01T08:00:00',
      duracao_min: 85,
    },
  ],
  cruzeiros: [
    {
      id: 'c1',
      navio: 'Costa Diadema',
      embarque_em: '2027-01-10T17:00:00',
      desembarque_em: '2027-01-15T08:00:00',
      portos: [
        {
          id: 'p1',
          porto: 'Civitavecchia',
          cidade: 'Roma',
          lat: 42.09,
          lon: 11.79,
          chega_em: '2027-01-11T08:00:00',
        },
        {
          id: 'p2',
          porto: 'Palermo',
          cidade: 'Palermo',
          lat: 38.12,
          lon: 13.36,
          chega_em: '2027-01-12T08:00:00',
        },
        { id: 'p3', dia_no_mar: true, chega_em: '2027-01-13T00:00:00' },
      ],
    },
  ],
}

test('coordenada recusa o que não é um par de números no planeta', () => {
  assert.deepEqual(coordenada(48.86, 2.35), { lat: 48.86, lon: 2.35 })
  assert.equal(coordenada(null, 2.35), null)
  assert.equal(coordenada('', ''), null)
  // 0,0 é uma coordenada legítima (golfo da Guiné) — não pode virar "sem local".
  assert.deepEqual(coordenada(0, 0), { lat: 0, lon: 0 })
  assert.equal(coordenada(91, 0), null)
  assert.equal(coordenada(0, 181), null)
})

test('mesmaCidade ignora caixa e acento', () => {
  assert.equal(mesmaCidade('Madri', 'MADRI'), true)
  assert.equal(mesmaCidade('Genève', 'geneve'), true)
  assert.equal(mesmaCidade('', ''), false)
  assert.equal(mesmaCidade('Paris', 'Madri'), false)
})

test('categoria vem do tipo, e o que não casa é atividade', () => {
  assert.equal(categoriaDoItem('voo'), 'aeroporto')
  assert.equal(categoriaDoItem('trem'), 'estacao')
  assert.equal(categoriaDoItem('cruzeiro'), 'porto')
  assert.equal(categoriaDoItem('hospedagem'), 'hotel')
  assert.equal(categoriaDoItem('refeicao'), 'restaurante')
  assert.equal(categoriaDoItem('dica'), 'atividade')
  assert.equal(categoriaDoItem(undefined), 'atividade')
})

test('marcadores: coordenada própria não é aproximada, herdada da cidade é', () => {
  const m = marcadoresDaViagem(base)
  const louvre = m.find((x) => x.nome === 'Museu do Louvre')!
  assert.equal(louvre.aproximado, false)
  assert.equal(louvre.categoria, 'atividade')

  const almoco = m.find((x) => x.nome === 'Almoço')!
  assert.equal(almoco.aproximado, true)
  assert.equal(almoco.categoria, 'restaurante')
  // Herdou o centro de Paris, não inventou coordenada.
  assert.equal(almoco.lat, 48.86)
})

test('marcadores: o que não tem coordenada nem cidade conhecida fica FORA do mapa', () => {
  const m = marcadoresDaViagem(base)
  assert.equal(
    m.some((x) => x.nome === 'Passeio em Sintra'),
    false,
  )
})

test('marcadores: reserva que não é lugar não vira pino; dia no mar não vira porto', () => {
  const m = marcadoresDaViagem(base)
  assert.equal(
    m.some((x) => x.nome === 'Locadora'),
    false,
  )
  assert.equal(m.filter((x) => x.categoria === 'porto').length, 2)
})

test('marcadores: cidades entram com a coordenada própria', () => {
  const m = marcadoresDaViagem(base).filter((x) => x.categoria === 'cidade')
  assert.equal(m.length, 3)
  assert.equal(
    m.every((x) => !x.aproximado),
    true,
  )
})

test('etapas seguem a ordem de Cidades e o cruzeiro é UMA etapa', () => {
  const e = etapasDaViagem(base)
  assert.deepEqual(
    e.map((x) => x.cidade),
    ['Lisboa', 'Madri', 'Paris', 'Costa Diadema'],
  )
  const paris = e.find((x) => x.cidade === 'Paris')!
  assert.equal(paris.atividades, 1)
  assert.equal(paris.hoteis, 1)
  const cruzeiro = e.find((x) => x.cruzeiro)!
  assert.equal(cruzeiro.destinos, 2)
})

test('pernas: com voo a rota é verificada, sem nada é apenas consecutiva', () => {
  const p = pernasDaViagem(base)
  const lisboaMadri = p.find((x) => x.de.nome === 'Lisboa')!
  assert.equal(lisboaMadri.verificado, true)
  assert.equal(lisboaMadri.modo, 'aviao')
  assert.equal(lisboaMadri.duracaoMin, 85)
  assert.equal(lisboaMadri.refEntidade, 'voo')

  const madriParis = p.find((x) => x.de.nome === 'Madri')!
  assert.equal(madriParis.verificado, false)
  assert.equal(madriParis.modo, null)
  assert.equal(madriParis.nomeModo, null)
})

test('pernas: as escalas do cruzeiro entram na ordem, sempre verificadas', () => {
  const p = pernasDaViagem(base).filter((x) => x.refEntidade === 'cruzeiro')
  assert.equal(p.length, 1)
  assert.equal(p[0].de.nome, 'Civitavecchia')
  assert.equal(p[0].para.nome, 'Palermo')
  assert.equal(p[0].modo, 'barco')
  assert.equal(p[0].verificado, true)
})

test('pernas: uma cidade sem coordenada não gera linha reta inventada', () => {
  const p = pernasDaViagem({
    ...base,
    lugares: [LUGARES[0], { id: 'lx', cidade: 'Andorra', ordem: 1 }, LUGARES[2]],
  })
  // Lisboa -> Paris, e nada passando por Andorra: cidade sem coordenada não vira ponto.
  assert.equal(p.length, 2) // 1 terrestre + 1 do cruzeiro
  assert.equal(p[0].de.nome, 'Lisboa')
  assert.equal(p[0].para.nome, 'Paris')
})

test('filtro por dia traz o dia, a cidade e o hotel em que se dorme', () => {
  const m = marcadoresDoDia(base, '2027-01-06')
  const nomes = m.map((x) => x.nome)
  assert.equal(nomes.includes('Museu do Louvre'), true)
  assert.equal(nomes.includes('Almoço'), true)
  // O check-in foi dia 4 e o dia 6 ainda dorme lá.
  assert.equal(nomes.includes('Hotel Paris'), true)
  assert.equal(nomes.includes('Paris'), true)
  // Nada de outro dia.
  assert.equal(nomes.includes('Civitavecchia'), false)
})

test('a noite do check-out já não conta como hotel do dia', () => {
  const nomes = marcadoresDoDia(base, '2027-01-07').map((x) => x.nome)
  assert.equal(nomes.includes('Hotel Paris'), false)
})

test('auditoria separa o aproximado do que sumiu do mapa', () => {
  const a = auditarMapa(base)
  assert.equal(a.localizados.cidade, 3)
  assert.equal(a.localizados.hotel, 1)
  assert.equal(a.localizados.porto, 2)
  // O almoço herdou o centro de Paris.
  assert.equal(a.aproximados, 1)
  // Sintra não está em Cidades.
  assert.equal(a.semLocal, 1)
  assert.equal(a.rotasNaoVerificadas, 1)
  assert.equal(a.lacunas[0].nivel, 'erro')
  assert.match(a.lacunas[0].texto, /Sintra/)
  assert.equal(
    a.lacunas.some((l) => l.categoria === 'rota' && /não verificada/.test(l.texto)),
    true,
  )
})

test('snapshot vazio não explode', () => {
  assert.deepEqual(marcadoresDaViagem(null), [])
  assert.deepEqual(etapasDaViagem(null), [])
  assert.deepEqual(pernasDaViagem(null), [])
  assert.equal(auditarMapa(null).semLocal, 0)
  assert.deepEqual(marcadoresDoDia(null, '2027-01-01'), [])
})

test('cidade sem datas próprias herda o primeiro e o último compromisso do roteiro', () => {
  // A viagem real tinha as onze cidades com chega_em/sai_em vazios.
  const semDatas = {
    ...base,
    lugares: LUGARES.map((l) => ({ ...l, chega_em: null, sai_em: null })),
  }
  const paris = etapasDaViagem(semDatas).find((e) => e.cidade === 'Paris')!
  assert.equal(paris.chegaEm, '2027-01-04T15:00:00') // o check-in do hotel
  assert.equal(paris.saiEm, '2027-01-06T15:00:00') // o Louvre
})

test('a data escrita em Cidades ganha da deduzida', () => {
  const comData = {
    ...base,
    lugares: LUGARES.map((l) =>
      l.cidade === 'Paris' ? { ...l, chega_em: '2027-01-03', sai_em: '2027-01-08' } : l,
    ),
  }
  const paris = etapasDaViagem(comData).find((e) => e.cidade === 'Paris')!
  assert.equal(paris.chegaEm, '2027-01-03')
  assert.equal(paris.saiEm, '2027-01-08')
})

test('agrupar junta o que cai no mesmo pixel e preserva o que está separado', () => {
  const g = agrupar(
    [
      { id: 'a', x: 100, y: 100 },
      { id: 'b', x: 104, y: 98 }, // colado em a
      { id: 'c', x: 400, y: 400 }, // longe
    ],
    34,
  )
  assert.equal(g.length, 2)
  const juntos = g.find((x) => x.itens.length === 2)!
  assert.deepEqual(
    juntos.itens.map((i) => i.id),
    ['a', 'b'],
  )
  // O grupo fica sobre um ponto REAL, não sobre a média.
  assert.equal(juntos.x, 100)
  assert.equal(juntos.y, 100)
})

test('agrupar com célula pequena não agrupa nada', () => {
  const g = agrupar(
    [
      { id: 'a', x: 100, y: 100 },
      { id: 'b', x: 104, y: 98 },
    ],
    1,
  )
  assert.equal(g.length, 2)
})
