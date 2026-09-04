// O MAPA DA VIAGEM INTEIRA: o que existe no mundo, em que ordem, e o que ainda
// não dá para desenhar.
//
// Complementa `lib/trechos.ts`, que responde "como vou daqui até ali HOJE".
// Aqui a pergunta é outra: "onde esta viagem acontece" — as cidades na ordem
// real, os hotéis, os aeroportos, as estações, os portos e as pernas entre
// cidades. É a leitura do snapshot que já existe, não uma tabela nova.
//
// A REGRA QUE MANDA NESTE ARQUIVO: NADA É INVENTADO. Um lugar sem coordenada
// não vira um ponto no centro da cidade fingindo ser o endereço; ou ele herda a
// coordenada da cidade e sai marcado `aproximado` — e a tela escreve
// "Localização aproximada" —, ou ele fica fora do mapa e a auditoria o cobra.
// Uma perna entre cidades sem duração gravada sai `verificado: false`, e a tela
// escreve "Rota não verificada". Uma linha bonita sobre dados que ninguém
// conferiu é pior do que nenhuma linha: ela é obedecida.
//
// Zero I/O, zero React — entra o snapshot, sai o que a tela desenha.
import { chaveDia, parseData } from './derive.ts'
import { NOME_MODO, type Modo } from './hoje.ts'

/** As categorias que o mapa distingue. Cada uma é uma camada ligável na tela. */
export type Categoria =
  'cidade' | 'hotel' | 'atividade' | 'restaurante' | 'aeroporto' | 'estacao' | 'porto'

export const NOME_CATEGORIA: Record<Categoria, string> = {
  cidade: 'Cidades',
  hotel: 'Hotéis',
  atividade: 'Atividades',
  restaurante: 'Restaurantes',
  aeroporto: 'Aeroportos',
  estacao: 'Estações',
  porto: 'Portos',
}

/**
 * De que categoria é um item do roteiro.
 *
 * `tipo` é coluna com lista fechada (db/schema.sql), então isto é tradução, não
 * adivinhação. O que não casa é `atividade` — a categoria genérica —, nunca uma
 * suposição: um item `dica` não vira restaurante porque o título fala em jantar.
 */
const CATEGORIA_POR_TIPO: Record<string, Categoria> = {
  voo: 'aeroporto',
  trem: 'estacao',
  onibus: 'estacao',
  cruzeiro: 'porto',
  hospedagem: 'hotel',
  restaurante: 'restaurante',
  refeicao: 'restaurante',
}

export function categoriaDoItem(tipo: unknown): Categoria {
  return CATEGORIA_POR_TIPO[String(tipo ?? '')] ?? 'atividade'
}

/** Categoria de uma linha de `reservations` — mesma ideia, outra lista fechada. */
const CATEGORIA_POR_RESERVA: Record<string, Categoria> = {
  hospedagem: 'hotel',
  restaurante: 'restaurante',
}

/**
 * Só é coordenada quando são dois números finitos dentro do planeta.
 *
 * A guarda de ausência vem ANTES do `Number`, e não é detalhe: `Number(null)` e
 * `Number('')` são 0, então uma linha sem `lat` viraria a coordenada 0,0 — o
 * golfo da Guiné. Um hotel de Paris fincado no Atlântico é exatamente o tipo de
 * dado inventado que este módulo existe para não produzir, e ele nem parece um
 * erro: é um pino, num mapa, com nome certo.
 *
 * A coluna é `numeric`, que o driver devolve como STRING — daí aceitar texto.
 */
export function coordenada(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
  if (lat == null || lon == null || lat === '' || lon === '') return null
  const a = Number(lat)
  const b = Number(lon)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  if (a < -90 || a > 90 || b < -180 || b > 180) return null
  return { lat: a, lon: b }
}

export type Marcador = {
  id: string
  categoria: Categoria
  nome: string
  lat: number
  lon: number
  /**
   * A coordenada é o CENTRO DA CIDADE, não a deste lugar.
   *
   * Existe para a tela poder escrever "Localização aproximada" ao lado do pino.
   * Sem esta marca, um hotel sem endereço apareceria a 3 km do lugar onde a
   * pessoa vai dormir, e nada na tela diria isso — que é exatamente o erro que
   * um mapa de viagem não pode cometer.
   */
  aproximado: boolean
  cidade: string | null
  endereco: string | null
  /** 'YYYY-MM-DD' do dia a que o marcador pertence, quando ele tem data. */
  chaveDia: string | null
  /** A hora crua, para a tela formatar como sempre formata. */
  quando: string | null
  /** De qual módulo esta linha veio — a tela leva até lá em vez de duplicar o dado. */
  origem: { entidade: 'roteiro' | 'reserva' | 'lugar' | 'porto'; id: string }
}

/** Uma cidade do mapa, com o que se sabe dela — o índice do painel esquerdo. */
export type Etapa = {
  id: string
  cidade: string
  pais: string | null
  lat: number | null
  lon: number | null
  chegaEm: string | null
  saiEm: string | null
  atividades: number
  hoteis: number
  /** Escalas, quando a etapa é um cruzeiro. */
  destinos: number
  cruzeiro: boolean
}

/** Uma perna da rota macro: de uma cidade para a seguinte, na ordem real. */
export type Perna = {
  id: string
  de: { nome: string; lat: number; lon: number }
  para: { nome: string; lat: number; lon: number }
  modo: Modo | null
  /** O nome do modo em pt-BR, ou null quando ninguém gravou como se atravessa. */
  nomeModo: string | null
  quando: string | null
  distanciaM: number | null
  duracaoMin: number | null
  /**
   * Existe um registro que PROVA este trajeto — um voo, um trem, uma escala de
   * cruzeiro. Falso quer dizer "as duas cidades são consecutivas no roteiro e
   * mais nada": a tela desenha tracejado e escreve "Rota não verificada".
   */
  verificado: boolean
  /** Id do registro que prova a perna, para o botão "Ver viagem". */
  refId: string | null
  refEntidade: 'voo' | 'roteiro' | 'cruzeiro' | null
}

type Linha = Record<string, unknown>

function texto(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s || null
}

/** Os acentos, já separados da letra pelo `NFD` de `semAcento`. */
const ACENTOS = /[̀-ͯ]/g

/** Nome comparável: sem caixa, sem acento, sem espaço nas pontas. É o que faz
    "Madri" casar com "MADRI" e "Hamburgo" com "hamburgo". */
export function semAcento(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(ACENTOS, '')
}

/** Compara nomes de cidade ignorando caixa e acento — "Madri" casa com "MADRI". */
export function mesmaCidade(a: unknown, b: unknown): boolean {
  const x = semAcento(a)
  return Boolean(x) && x === semAcento(b)
}

/** Índice cidade -> coordenada, montado uma vez de `places`. É o que permite
    dar localização aproximada a um hotel sem endereço, e nada além disso. */
function centrosDeCidade(lugares: Linha[]): Map<string, { lat: number; lon: number }> {
  const mapa = new Map<string, { lat: number; lon: number }>()
  for (const l of lugares ?? []) {
    const c = coordenada(l.lat, l.lon)
    const nome = texto(l.cidade)
    if (c && nome) mapa.set(nome.toLowerCase(), c)
  }
  return mapa
}

function centroDe(
  centros: Map<string, { lat: number; lon: number }>,
  cidade: unknown,
): { lat: number; lon: number } | null {
  const nome = texto(cidade)
  if (!nome) return null
  for (const [chave, c] of centros) if (mesmaCidade(chave, nome)) return c
  return null
}

export type Snapshotish = {
  roteiro?: Linha[]
  reservas?: Linha[]
  lugares?: Linha[]
  cruzeiros?: Linha[]
  voos?: Linha[]
} | null

/**
 * Todo marcador da viagem, de todos os módulos, já categorizado.
 *
 * Um lugar entra com coordenada própria quando tem uma; senão herda a da cidade
 * e sai `aproximado`. Sem nenhuma das duas ele NÃO entra — e é a auditoria que
 * o cobra, porque um pino no meio do oceano é pior do que um pino faltando.
 */
export function marcadoresDaViagem(snapshot: Snapshotish): Marcador[] {
  const s = snapshot ?? {}
  const centros = centrosDeCidade(s.lugares ?? [])
  const marcadores: Marcador[] = []

  const empurrar = (
    base: Omit<Marcador, 'lat' | 'lon' | 'aproximado'>,
    propria: { lat: number; lon: number } | null,
    cidade: unknown,
  ) => {
    const c = propria ?? centroDe(centros, cidade)
    if (!c) return
    marcadores.push({ ...base, lat: c.lat, lon: c.lon, aproximado: propria === null })
  }

  // As cidades: coordenada própria sempre, nunca aproximada — `places.lat/lon` É
  // a cidade, não uma aproximação dela.
  for (const l of s.lugares ?? []) {
    const c = coordenada(l.lat, l.lon)
    const nome = texto(l.cidade)
    if (!c || !nome) continue
    marcadores.push({
      id: `lugar:${String(l.id ?? nome)}`,
      categoria: 'cidade',
      nome,
      lat: c.lat,
      lon: c.lon,
      aproximado: false,
      cidade: nome,
      endereco: null,
      chaveDia: null,
      quando: null,
      origem: { entidade: 'lugar', id: String(l.id ?? '') },
    })
  }

  for (const e of s.roteiro ?? []) {
    const nome = texto(e.titulo) ?? texto(e.local)
    if (!nome) continue
    empurrar(
      {
        id: `roteiro:${String(e.id ?? nome)}`,
        categoria: categoriaDoItem(e.tipo),
        nome,
        cidade: texto(e.cidade),
        endereco: texto(e.endereco) ?? texto(e.local),
        chaveDia: chaveDia(e.ocorre_em),
        quando: texto(e.ocorre_em),
        origem: { entidade: 'roteiro', id: String(e.id ?? '') },
      },
      coordenada(e.lat, e.lon),
      e.cidade,
    )
  }

  // Reservas: hotel e restaurante têm lugar no mapa; um aluguel de carro não —
  // ele é um contrato, não um ponto que alguém procura na rua.
  for (const r of s.reservas ?? []) {
    const categoria = CATEGORIA_POR_RESERVA[String(r.tipo ?? '')]
    const nome = texto(r.nome)
    if (!categoria || !nome) continue
    empurrar(
      {
        id: `reserva:${String(r.id ?? nome)}`,
        categoria,
        nome,
        cidade: texto(r.cidade),
        endereco: texto(r.endereco),
        chaveDia: chaveDia(r.inicio_em),
        quando: texto(r.inicio_em),
        origem: { entidade: 'reserva', id: String(r.id ?? '') },
      },
      coordenada(r.lat, r.lon),
      r.cidade,
    )
  }

  // Escalas de cruzeiro. Um dia no mar não tem porto — e não tem pino.
  for (const c of s.cruzeiros ?? []) {
    for (const p of (c.portos ?? []) as Linha[]) {
      if (p.dia_no_mar) continue
      const nome = texto(p.porto) ?? texto(p.cidade)
      if (!nome) continue
      empurrar(
        {
          id: `porto:${String(p.id ?? nome)}`,
          categoria: 'porto',
          nome,
          cidade: texto(p.cidade),
          endereco: null,
          chaveDia: chaveDia(p.chega_em),
          quando: texto(p.chega_em),
          origem: { entidade: 'porto', id: String(p.id ?? '') },
        },
        coordenada(p.lat, p.lon),
        p.cidade,
      )
    }
  }

  return marcadores
}

/**
 * As etapas da viagem para o painel esquerdo, na ordem em que acontecem.
 *
 * A ordem vem de `places.ordem` — a mesma que a aba Cidades mostra —, porque é
 * a ordem que alguém arrumou à mão. Reordenar por data aqui faria o painel
 * discordar da outra tela sem que ninguém tivesse pedido.
 */
export function etapasDaViagem(snapshot: Snapshotish): Etapa[] {
  const s = snapshot ?? {}
  const marcadores = marcadoresDaViagem(s)

  const etapas: Etapa[] = (s.lugares ?? []).flatMap((l) => {
    const cidade = texto(l.cidade)
    if (!cidade) return []
    const daCidade = marcadores.filter((m) => mesmaCidade(m.cidade, cidade))
    const c = coordenada(l.lat, l.lon)

    // As datas de `places` são opcionais e quase nunca preenchidas — a viagem
    // real tinha as onze cidades com "Sem datas" enquanto o roteiro sabia
    // exatamente quando cada uma acontece. O primeiro e o último compromisso na
    // cidade SÃO essa resposta, e são dado gravado, não estimativa. `places`
    // continua mandando quando alguém escreveu ali: é a intenção declarada, e
    // ela ganha do que se deduz.
    const datas = daCidade
      .map((m) => m.quando)
      .filter((q): q is string => Boolean(q))
      .sort()

    return [
      {
        id: `lugar:${String(l.id ?? cidade)}`,
        cidade,
        pais: texto(l.pais),
        lat: c?.lat ?? null,
        lon: c?.lon ?? null,
        chegaEm: texto(l.chega_em) ?? datas[0] ?? null,
        saiEm: texto(l.sai_em) ?? datas[datas.length - 1] ?? null,
        atividades: daCidade.filter((m) => m.categoria === 'atividade').length,
        hoteis: daCidade.filter((m) => m.categoria === 'hotel').length,
        destinos: 0,
        cruzeiro: false,
      },
    ]
  })

  // O cruzeiro é UMA etapa, não uma cidade por escala: no painel ele é o trecho
  // "10 jan — 15 jan, 5 destinos", que é como se lê um cruzeiro. As escalas
  // continuam sendo pinos de porto no mapa.
  for (const c of s.cruzeiros ?? []) {
    const portos = ((c.portos ?? []) as Linha[]).filter((p) => !p.dia_no_mar)
    const navio = texto(c.navio)
    if (!navio) continue
    etapas.push({
      id: `cruzeiro:${String(c.id ?? navio)}`,
      cidade: navio,
      pais: null,
      lat: null,
      lon: null,
      chegaEm: texto(c.embarque_em),
      saiEm: texto(c.desembarque_em),
      atividades: 0,
      hoteis: 0,
      destinos: portos.length,
      cruzeiro: true,
    })
  }

  return etapas
}

/** O voo que liga duas cidades, quando existe um. É o que transforma uma linha
    reta em rota verificada. */
function vooEntre(voos: Linha[], de: string, para: string): Linha | null {
  return (
    (voos ?? []).find(
      (v) => mesmaCidade(v.origem_cidade, de) && mesmaCidade(v.destino_cidade, para),
    ) ?? null
  )
}

/** Um item do roteiro que já É o deslocamento entre as duas cidades. */
const TIPO_PARA_MODO: Record<string, Modo> = {
  trem: 'trem',
  onibus: 'onibus',
  traslado: 'carro',
  caminhada: 'a_pe',
  cruzeiro: 'barco',
  voo: 'aviao',
}

/**
 * ponytail: casa a origem procurando o nome da cidade DENTRO do título do item
 * ("Trem Paris → Hamburgo"). É frágil de propósito e o teto está contido: isto
 * só CONFIRMA o modo de uma perna que a ordem de `lugares` já estabeleceu, e
 * nunca cria uma. Errar aqui rebaixa a perna para "não verificada" — a saída
 * segura —, jamais inventa um trajeto. A saída boa é `origem_cidade`/
 * `destino_cidade` no item, como `flights` já tem; isso é mudança de schema, e
 * schema não se muda de passagem.
 */
function trajetoEntre(roteiro: Linha[], de: string, para: string): Linha | null {
  return (
    (roteiro ?? []).find(
      (e) =>
        TIPO_PARA_MODO[String(e.tipo ?? '')] &&
        mesmaCidade(e.cidade, para) &&
        // O título é a única pista de origem que um item de trecho guarda
        // ("Trem Paris → Hamburgo"). Casar por ele é frágil, então serve só
        // para CONFIRMAR o modo de uma perna que já existe pela ordem das
        // cidades — nunca para criar uma perna que a ordem não tem.
        semAcento(e.titulo).includes(semAcento(de)),
    ) ?? null
  )
}

/**
 * A rota macro: cidade após cidade, na ordem real da viagem.
 *
 * Só liga cidades CONSECUTIVAS e só quando as duas têm coordenada. O modo vem
 * de um voo, de um item de trecho do roteiro ou do cruzeiro; sem nenhum dos
 * três a perna sai `verificado: false` e a tela a desenha tracejada com "Rota
 * não verificada" — a linha continua útil (as duas cidades REALMENTE se
 * seguem), mas nunca se apresenta como um trajeto conferido.
 */
export function pernasDaViagem(snapshot: Snapshotish): Perna[] {
  const s = snapshot ?? {}
  const cidades = (s.lugares ?? []).flatMap((l) => {
    const c = coordenada(l.lat, l.lon)
    const nome = texto(l.cidade)
    return c && nome ? [{ nome, ...c }] : []
  })

  const pernas: Perna[] = []
  for (let i = 1; i < cidades.length; i++) {
    const de = cidades[i - 1]
    const para = cidades[i]

    const voo = vooEntre(s.voos ?? [], de.nome, para.nome)
    const trajeto = voo ? null : trajetoEntre(s.roteiro ?? [], de.nome, para.nome)
    const modo: Modo | null = voo
      ? 'aviao'
      : trajeto
        ? (TIPO_PARA_MODO[String(trajeto.tipo ?? '')] ?? null)
        : null

    pernas.push({
      id: `perna:${de.nome}:${para.nome}`,
      de,
      para,
      modo,
      nomeModo: modo ? NOME_MODO[modo] : null,
      quando: texto(voo?.parte_em) ?? texto(trajeto?.ocorre_em),
      distanciaM: Number(trajeto?.distancia_m) || null,
      duracaoMin: Number(voo?.duracao_min) || Number(trajeto?.duracao_min) || null,
      verificado: Boolean(voo || trajeto),
      refId: String(voo?.id ?? trajeto?.id ?? '') || null,
      refEntidade: voo ? 'voo' : trajeto ? 'roteiro' : null,
    })
  }

  // As escalas do cruzeiro, na ordem do embarque. É a única parte da rota que
  // já nasce verificada: uma escala É o navio passando por ali.
  for (const c of s.cruzeiros ?? []) {
    const escalas = ((c.portos ?? []) as Linha[])
      .filter((p) => !p.dia_no_mar)
      .flatMap((p) => {
        const co = coordenada(p.lat, p.lon)
        const nome = texto(p.porto) ?? texto(p.cidade)
        return co && nome ? [{ nome, ...co, quando: texto(p.chega_em) }] : []
      })
    for (let i = 1; i < escalas.length; i++) {
      pernas.push({
        id: `perna:cruzeiro:${String(c.id ?? '')}:${i}`,
        de: escalas[i - 1],
        para: escalas[i],
        modo: 'barco',
        nomeModo: NOME_MODO.barco,
        quando: escalas[i].quando,
        distanciaM: null,
        duracaoMin: null,
        verificado: true,
        refId: String(c.id ?? '') || null,
        refEntidade: 'cruzeiro',
      })
    }
  }

  return pernas
}

export type LacunaMapa = {
  nivel: 'erro' | 'aviso'
  categoria: Categoria | 'rota'
  texto: string
}

export type AuditoriaMapa = {
  localizados: Record<Categoria, number>
  aproximados: number
  semLocal: number
  rotasNaoVerificadas: number
  lacunas: LacunaMapa[]
}

/**
 * Auditoria geográfica (§25): o que o mapa NÃO consegue mostrar, e por quê.
 *
 * Relata só o que dá para provar com o que está gravado. Nada de "distância
 * suspeita" ou "deslocamento impossível" a partir de linha reta entre dois
 * pontos: sem a rota real isso acusaria como impossível um voo perfeitamente
 * normal, e um alerta chutado ensina a ignorar os verdadeiros. O conflito de
 * horário já tem dono — `auditarNavegacao` em lib/trechos.ts —, e duplicá-lo
 * aqui daria dois números para o mesmo problema.
 */
export function auditarMapa(snapshot: Snapshotish): AuditoriaMapa {
  const s = snapshot ?? {}
  const marcadores = marcadoresDaViagem(s)
  const pernas = pernasDaViagem(s)
  const centros = centrosDeCidade(s.lugares ?? [])

  const localizados = Object.fromEntries(
    (Object.keys(NOME_CATEGORIA) as Categoria[]).map((c) => [
      c,
      marcadores.filter((m) => m.categoria === c && !m.aproximado).length,
    ]),
  ) as Record<Categoria, number>

  const lacunas: LacunaMapa[] = []

  for (const m of marcadores) {
    if (m.aproximado) {
      lacunas.push({
        nivel: 'aviso',
        categoria: m.categoria,
        texto: `${m.nome}: localização aproximada — no centro de ${m.cidade ?? 'a cidade'}, sem endereço próprio`,
      })
    }
  }

  // O que ficou de FORA do mapa: nem coordenada própria, nem cidade conhecida.
  // É a lacuna que mais importa, porque nada na tela denuncia um pino ausente.
  let semLocal = 0
  const foraDoMapa = (nome: string | null, cidade: unknown, categoria: Categoria) => {
    if (!nome) return
    semLocal++
    lacunas.push({
      nivel: 'erro',
      categoria,
      texto: texto(cidade)
        ? `${nome}: sem coordenada, e a cidade "${texto(cidade)}" não está em Cidades`
        : `${nome}: sem coordenada e sem cidade`,
    })
  }

  for (const e of s.roteiro ?? []) {
    if (coordenada(e.lat, e.lon) || centroDe(centros, e.cidade)) continue
    foraDoMapa(texto(e.titulo) ?? texto(e.local), e.cidade, categoriaDoItem(e.tipo))
  }
  for (const r of s.reservas ?? []) {
    const categoria = CATEGORIA_POR_RESERVA[String(r.tipo ?? '')]
    if (!categoria) continue
    if (coordenada(r.lat, r.lon) || centroDe(centros, r.cidade)) continue
    foraDoMapa(texto(r.nome), r.cidade, categoria)
  }
  for (const c of s.cruzeiros ?? []) {
    for (const p of (c.portos ?? []) as Linha[]) {
      if (p.dia_no_mar) continue
      if (coordenada(p.lat, p.lon) || centroDe(centros, p.cidade)) continue
      foraDoMapa(texto(p.porto) ?? texto(p.cidade), p.cidade, 'porto')
    }
  }

  for (const p of pernas) {
    if (p.verificado) continue
    lacunas.push({
      nivel: 'aviso',
      categoria: 'rota',
      texto: `${p.de.nome} → ${p.para.nome}: rota não verificada — nenhum voo, trem ou traslado grava este trecho`,
    })
  }

  return {
    localizados,
    aproximados: marcadores.filter((m) => m.aproximado).length,
    semLocal,
    rotasNaoVerificadas: pernas.filter((p) => !p.verificado).length,
    // Erro antes de aviso: o que sumiu do mapa vem antes do que está impreciso.
    lacunas: lacunas.sort((a, b) => Number(b.nivel === 'erro') - Number(a.nivel === 'erro')),
  }
}

/**
 * Os marcadores de UM dia (§10) — e mais o contexto que aquele dia precisa.
 *
 * O hotel entra mesmo quando o check-in foi há três dias: é onde a pessoa
 * dorme hoje, e o mapa de um dia sem o hotel do dia é um mapa que não responde
 * "como volto". Mesmo motivo pelo qual `lib/hoje.ts` nunca deixa o cartão do
 * hotel desaparecer com o fim do itinerário.
 */
export function marcadoresDoDia(snapshot: Snapshotish, chave: string): Marcador[] {
  const todos = marcadoresDaViagem(snapshot)
  const doDia = todos.filter((m) => m.chaveDia === chave)
  const cidades = new Set(doDia.map((m) => String(m.cidade ?? '').toLowerCase()).filter(Boolean))

  const hoteisAtivos = (snapshot?.reservas ?? []).flatMap((r) => {
    if (String(r.tipo ?? '') !== 'hospedagem') return []
    const de = chaveDia(r.inicio_em)
    const ate = chaveDia(r.fim_em)
    // A noite de check-out não conta: quem sai de manhã já não dorme ali.
    if (!de || chave < de || (ate && chave >= ate)) return []
    return [`reserva:${String(r.id ?? r.nome ?? '')}`]
  })

  return todos.filter(
    (m) =>
      m.chaveDia === chave ||
      hoteisAtivos.includes(m.id) ||
      // A cidade do dia é o pano de fundo, não um compromisso — entra para o
      // mapa ter referência, e é o que evita um enquadramento de rua só.
      (m.categoria === 'cidade' && cidades.has(String(m.cidade ?? '').toLowerCase())),
  )
}

/** Quantos quilômetros o dia (ou a cidade) percorre, somando só o que está
    gravado. Nunca estimado por linha reta — ver a nota de `auditarMapa`. */
export function distanciaGravada(itens: Linha[]): number {
  return (itens ?? []).reduce((s, e) => s + (Number(e.distancia_m) || 0), 0)
}

/** O dia em que uma etapa começa, para o botão "Ver dia a dia" saber onde abrir. */
export function chaveDaEtapa(etapa: Etapa): string | null {
  return chaveDia(etapa.chegaEm) ?? (etapa.chegaEm ? chaveDia(parseData(etapa.chegaEm)) : null)
}

/**
 * Agrupa marcadores que caem quase no mesmo pixel (§29).
 *
 * Recebe posições JÁ PROJETADAS na tela, e não coordenadas: dois hotéis a 500 m
 * um do outro são pinos separados numa rua e o mesmo borrão no mapa do mundo —
 * o que decide é o zoom, e o zoom só existe na tela. Agrupar por distância
 * geográfica daria um mapa que continua ilegível afastado e artificialmente
 * agrupado aproximado.
 *
 * Grade fixa, não vizinho-mais-próximo: é O(n) numa passada, e a diferença
 * prática entre as duas some sob um pino de 26px. O grupo herda a posição do
 * PRIMEIRO membro em vez da média — a média cai num ponto onde não existe nada,
 * e clicar nela abriria um lugar que não está ali.
 */
export function agrupar<T extends { id: string; x: number; y: number }>(
  pontos: T[],
  celula = 34,
): { chave: string; x: number; y: number; itens: T[] }[] {
  const grupos = new Map<string, { chave: string; x: number; y: number; itens: T[] }>()
  for (const p of pontos ?? []) {
    const chave = `${Math.round(p.x / celula)}:${Math.round(p.y / celula)}`
    const g = grupos.get(chave)
    if (g) g.itens.push(p)
    else grupos.set(chave, { chave, x: p.x, y: p.y, itens: [p] })
  }
  return [...grupos.values()]
}
