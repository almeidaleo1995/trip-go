// O motor do cofre de documentos: agrupar por destino, buscar, filtrar e decidir
// o semáforo de cada arquivo.
//
// Tudo aqui é função pura sobre o snapshot. O que toca rede está em
// `components/tabs/Cofre.tsx`, o que toca IndexedDB está em `lib/offline.ts`, e o
// que decide QUEM VÊ o quê está no servidor (`documentosDaViagem` em lib/db.ts).
// Esta separação é o que permite testar a busca e o agrupamento sem navegador.
import { normalizarTitulo } from './checklist.ts'
import { diasAte, parseData } from './derive.ts'
import { papelAlcanca, type Papel } from '../config/navigation.ts'
import type { CATEGORIAS_DOCUMENTO } from './schema.ts'

export type Categoria = (typeof CATEGORIAS_DOCUMENTO)[number]

/**
 * Rótulo e tom de cada categoria.
 *
 * O tom é uma chave de `TONS` (components/ui.tsx), não um hex: cor nova nenhuma
 * entra por aqui, e o contraste medido do design system continua valendo.
 *
 * Quatorze categorias não pedem quatorze paletas — pedem que trem, ônibus e
 * transfer leiam como "deslocamento". Mesmo raciocínio de `ALIAS_TOM`. O que
 * separa duas categorias de mesmo tom é o ícone, e ícone é o que a `Badge` já
 * aceita justamente porque cor sozinha não é informação.
 *
 * O ÍCONE não mora aqui: é um componente React, e este arquivo roda no
 * `node --test` sem DOM. A tela casa esta tabela com o ícone.
 */
export const CATEGORIAS: Record<Categoria, { rotulo: string; tom: string }> = {
  pessoal: { rotulo: 'Documento pessoal', tom: 'neutro' },
  passaporte: { rotulo: 'Passaporte', tom: 'documento' },
  seguro: { rotulo: 'Seguro', tom: 'destaque' },
  voo: { rotulo: 'Voo', tom: 'voo' },
  trem: { rotulo: 'Trem', tom: 'traslado' },
  onibus: { rotulo: 'Ônibus', tom: 'traslado' },
  hospedagem: { rotulo: 'Hospedagem', tom: 'hospedagem' },
  reserva: { rotulo: 'Reserva', tom: 'hospedagem' },
  ingresso: { rotulo: 'Ingresso', tom: 'passeio' },
  transfer: { rotulo: 'Transfer', tom: 'traslado' },
  financeiro: { rotulo: 'Financeiro', tom: 'info' },
  saude: { rotulo: 'Saúde', tom: 'sucesso' },
  emergencia: { rotulo: 'Emergência', tom: 'perigo' },
  outro: { rotulo: 'Outro', tom: 'neutro' },
}

/**
 * A ficha da categoria de um documento — a única forma segura de ler `CATEGORIAS`.
 *
 * Nunca indexe `CATEGORIAS` direto com o valor que veio do banco.
 * `documents.categoria` é uma coluna de TEXTO: linhas gravadas antes da
 * constraint, um import antigo ou uma escrita por outro caminho trazem valores
 * fora da lista. Indexar direto devolve `undefined`, e ler `.tom` de `undefined`
 * derruba a aba inteira — a tela toda some por causa de uma palavra numa linha.
 *
 * Categoria desconhecida vira o próprio texto como rótulo, em tom neutro: o dado
 * continua visível (é o que a pessoa escreveu), só não ganha cor nem ícone
 * próprio. Perder a informação seria pior do que exibi-la sem enfeite.
 */
export function fichaCategoria(categoria: string | null | undefined): {
  rotulo: string
  tom: string
} {
  if (!categoria) return CATEGORIAS.outro
  return CATEGORIAS[categoria as Categoria] ?? { rotulo: categoria, tom: 'neutro' }
}

/** A linha de `documents` como ela chega no snapshot. */
export type Documento = {
  id: string
  titulo: string
  valor?: string | null
  tipo: string
  /** TEXTO, não `Categoria`: a coluna é livre no banco e linhas antigas trazem
      valores fora da lista. Leia sempre por `fichaCategoria`, nunca indexando
      `CATEGORIAS` direto — foi assim que a aba inteira caiu uma vez. */
  categoria?: string | null
  arquivo_nome?: string | null
  arquivo_mime?: string | null
  arquivo_bytes?: number | null
  arquivo_url?: string | null
  obs?: string | null
  ordem?: number
  escopo?: string
  traveler_id?: string | null
  assigned_to?: string[] | null
  tags?: string[] | null
  importante?: boolean
  offline?: boolean
  validade?: string | null
  pais?: string | null
  cidade?: string | null
  dia?: string | null
  itinerary_event_id?: string | null
  flight_id?: string | null
  reservation_id?: string | null
  criado_por?: string | null
  criado_em?: string | null
}

export type Lugar = {
  id: string
  cidade: string
  pais?: string | null
  chega_em?: string | null
  sai_em?: string | null
  ordem?: number
}

// ---------------------------------------------------------------- semáforo

/**
 * Os quatro estados que a tela pinta, e o que cada um significa de verdade:
 *
 *   disponivel  🟢 os bytes estão NESTE aparelho. Abre em modo avião.
 *   aguardando  🟡 alguém marcou "disponível offline" e o download ainda não veio.
 *   erro        🔴 a última tentativa de baixar falhou. Tem botão de tentar de novo.
 *   online      ☁️ ninguém pediu offline. Abre com rede, e só.
 *
 * `salvos` e `erros` vêm do IndexedDB deste aparelho, não do servidor: o mesmo
 * documento pode estar 🟢 no celular e 🟡 no notebook, e é o celular que embarca.
 */
export type StatusOffline = 'disponivel' | 'aguardando' | 'erro' | 'online'

export function statusOffline(
  doc: Documento,
  salvos: Set<string>,
  erros: Set<string> = new Set(),
): StatusOffline {
  if (salvos.has(doc.id)) return 'disponivel'
  if (erros.has(doc.id)) return 'erro'
  return doc.offline ? 'aguardando' : 'online'
}

/** Só arquivo tem o que baixar: um número de apólice já viaja dentro do snapshot. */
export function temArquivo(doc: Documento): boolean {
  return doc.tipo === 'arquivo'
}

/**
 * A categoria numa forma que o BANCO aceita gravar.
 *
 * `documents.categoria` foi texto livre por muito tempo, e uma viagem em uso tem
 * linhas com "Companhias aéreas" e "Voos" escritas à mão. A constraint que fechou
 * a lista é `not valid`: ela tolera o que já está gravado e passa a exigir a lista
 * em todo INSERT — o que quebra exatamente os dois caminhos que RE-INSEREM linhas
 * antigas, duplicar uma viagem e exportar-para-reimportar. Os dois falhavam com
 * 500 numa viagem real e passavam limpo numa viagem nova.
 *
 * Fora da lista vira `outro`, e a palavra original **não se perde**: ela vai para
 * `tags`, onde `textoBuscavel` continua a encontrando. Descartá-la seria apagar o
 * que a pessoa escreveu para caber num enum.
 *
 * Ler continua tolerante — `fichaCategoria` mostra o valor legado como rótulo. Só
 * a ESCRITA precisa normalizar.
 */
export function normalizarCategoria(v: string | null | undefined): Categoria | null {
  const t = (v ?? '').trim()
  if (!t) return null
  return t in CATEGORIAS ? (t as Categoria) : 'outro'
}

/** As tags que sobrevivem a uma normalização de categoria, sem repetir a palavra. */
export function tagsComCategoria(
  tags: string[] | null | undefined,
  categoria: string | null | undefined,
): string[] {
  const atuais = tags ?? []
  const t = (categoria ?? '').trim()
  if (!t || t in CATEGORIAS || atuais.includes(t)) return atuais
  return [...atuais, t]
}

// ---------------------------------------------------------------- quem escreve

/**
 * Quem pode ALTERAR este documento — o espelho exato de `autorizar` em
 * /api/mutate e da checagem de POST /api/documento.
 *
 * Três regras, e a terceira é a que costuma faltar:
 *
 *   proprietário  tudo, porque é dele a viagem
 *   editor        tudo, MENOS documento pessoal de outra pessoa — planejar o
 *                 roteiro não é permissão para abrir um passaporte
 *   visualizador  só o próprio documento pessoal, e nada além
 *
 * A barreira real é o servidor; isto existe para a tela não oferecer um botão
 * que vira 403 no clique. Espelho que diverge é pior do que espelho nenhum, por
 * isso as duas regras moram uma ao lado da outra nos testes.
 */
export function podeEscrever(
  doc: Pick<Documento, 'escopo' | 'traveler_id'>,
  papel: Papel | null | undefined,
  participanteId: string,
): boolean {
  // Sem papel a pessoa não participa da viagem, e "documento pessoal dela" não
  // quer dizer nada — `participanteId` vem vazio nesse caso, e um documento com
  // `traveler_id` nulo casaria com ele por acidente.
  if (!papelAlcanca(papel, 'visualizador')) return false
  if (papelAlcanca(papel, 'proprietario')) return true
  const meuPessoal = doc.escopo === 'pessoal' && doc.traveler_id === participanteId
  if (papelAlcanca(papel, 'editor')) return doc.escopo !== 'pessoal' || meuPessoal
  return meuPessoal
}

/**
 * Quem pode APAGAR. Mais estrito do que editar de propósito: apagar o voucher do
 * grupo às vésperas do embarque não tem desfazer, e quem organiza a viagem é
 * quem responde por isso. O próprio documento pessoal continua sendo do dono.
 */
export function podeApagar(
  doc: Pick<Documento, 'escopo' | 'traveler_id'>,
  papel: Papel | null | undefined,
  participanteId: string,
): boolean {
  if (!papelAlcanca(papel, 'visualizador')) return false
  if (papelAlcanca(papel, 'proprietario')) return true
  return doc.escopo === 'pessoal' && doc.traveler_id === participanteId
}

/** O contador do painel "COFRE OFFLINE" (§14). */
export function resumoCofre(documentos: Documento[], salvos: Set<string>, erros: Set<string>) {
  let disponiveis = 0
  let aguardando = 0
  let problemas = 0
  for (const doc of documentos) {
    if (!temArquivo(doc)) continue
    const s = statusOffline(doc, salvos, erros)
    if (s === 'disponivel') disponiveis++
    else if (s === 'aguardando') aguardando++
    else if (s === 'erro') problemas++
  }
  return { disponiveis, aguardando, problemas }
}

// ---------------------------------------------------------------- validade

export type Validade = { dias: number; nivel: 'vencido' | 'proximo' | 'ok' }

/**
 * Quanto falta para o documento vencer. 90 dias é o corte de "próximo" porque é a
 * regra que a maioria dos países aplica ao passaporte: precisa valer três meses
 * além da data de saída. Avisar só na véspera não daria tempo de renovar nada.
 */
export const JANELA_VALIDADE = 90

export function statusValidade(
  validade: string | null | undefined,
  hoje: string | Date = new Date(),
): Validade | null {
  // `parseData` e nao `!validade`: uma data que nao da para ler nao e "vence
  // hoje", e sem vencimento conhecido. `diasAte` devolve 0 nos dois sentidos
  // para qualquer lixo, e isso pintaria de ambar todo documento cuja data veio
  // torta do banco — que foi exatamente o que aconteceu com `passaporte_validade`.
  const dia = parseData(validade)
  if (!dia) return null
  // `diasAte` faz clamp em 0 — ele responde "quantos dias faltam", nunca um
  // negativo. Perguntar nos dois sentidos é o que separa "vence hoje" de
  // "venceu no ano passado"; com uma chamada só, todo documento vencido
  // apareceria como se vencesse hoje.
  const passaram = diasAte(dia, hoje)
  if (passaram > 0) return { dias: -passaram, nivel: 'vencido' }
  const restam = diasAte(hoje, dia)
  return { dias: restam, nivel: restam <= JANELA_VALIDADE ? 'proximo' : 'ok' }
}

// ---------------------------------------------------------------- busca

/**
 * Tudo que a busca enxerga de um documento (§15): nome, categoria, destino,
 * cidade, participante, tag e tipo de arquivo.
 *
 * O texto pesquisável é montado uma vez por documento e normalizado (sem acento,
 * minúsculo) — buscar "hospedagem" tem que achar "Hospedagem", e buscar "sao" tem
 * que achar "São Paulo", senão a busca só serve para quem digita com acento.
 */
export function textoBuscavel(
  doc: Documento,
  nomePorParticipante: Map<string, string> = new Map(),
) {
  const pessoas = [doc.traveler_id, ...(doc.assigned_to ?? [])]
    .filter((id): id is string => Boolean(id))
    .map((id) => nomePorParticipante.get(id) ?? '')
  return normalizarTitulo(
    [
      doc.titulo,
      doc.valor,
      doc.obs,
      doc.categoria ? fichaCategoria(doc.categoria).rotulo : '',
      doc.pais,
      doc.cidade,
      doc.arquivo_nome,
      extensao(doc),
      ...(doc.tags ?? []),
      ...pessoas,
    ]
      .filter(Boolean)
      .join(' '),
  )
}

/** "pdf", "jpg"... o que a pessoa digita quando quer filtrar por tipo de arquivo. */
export function extensao(doc: Documento): string {
  const doNome = doc.arquivo_nome?.split('.').pop()?.toLowerCase()
  if (doNome && doNome.length <= 4) return doNome
  const m = doc.arquivo_mime?.split('/')[1]
  return m === 'jpeg' ? 'jpg' : (m ?? '')
}

export type Filtros = {
  busca?: string
  categorias?: Categoria[]
  /** Chaves de destino, como devolvidas por `chaveDestino`. */
  destinos?: string[]
  participantes?: string[]
  tipos?: string[]
  /** true = só os marcados como offline. */
  offline?: boolean
  importantes?: boolean
}

export function filtrarDocumentos(
  documentos: Documento[],
  filtros: Filtros,
  nomePorParticipante: Map<string, string> = new Map(),
): Documento[] {
  const termo = filtros.busca ? normalizarTitulo(filtros.busca) : ''
  const cats = new Set(filtros.categorias ?? [])
  const dests = new Set(filtros.destinos ?? [])
  const pessoas = new Set(filtros.participantes ?? [])
  const tipos = new Set(filtros.tipos ?? [])

  return documentos.filter((doc) => {
    if (termo && !textoBuscavel(doc, nomePorParticipante).includes(termo)) return false
    // Categoria fora da lista simplesmente não casa com nenhum filtro — que é
    // o comportamento certo, e não um erro.
    if (cats.size && !(doc.categoria && cats.has(doc.categoria as Categoria))) return false
    if (dests.size && !dests.has(chaveDestino(doc))) return false
    if (tipos.size && !tipos.has(extensao(doc))) return false
    if (filtros.offline && !doc.offline) return false
    if (filtros.importantes && !doc.importante) return false
    if (pessoas.size) {
      const meus = [doc.traveler_id, ...(doc.assigned_to ?? [])].filter(Boolean) as string[]
      // Documento do grupo vale para todo mundo: filtrar por participante não pode
      // esconder a reserva do hotel que é de todos.
      const doGrupo = doc.escopo !== 'pessoal' && meus.length === 0
      if (!doGrupo && !meus.some((id) => pessoas.has(id))) return false
    }
    return true
  })
}

/**
 * As pessoas que o filtro por participante deve oferecer.
 *
 * Não é a lista de participantes da viagem — é quem tem documento QUE VOCÊ VÊ.
 * A diferença importa porque o cofre já chega recortado pelo servidor: um
 * `visualizador` que recebesse os cinco nomes escolheria "Alana" e veria uma tela
 * vazia, lendo isso como "a Alana não subiu nada" quando o certo é "os
 * documentos pessoais dela não são meus para ver". Oferecer só quem aparece
 * torna o filtro honesto sem precisar saber o papel de ninguém aqui.
 *
 * De quebra, o proprietário para de ver no filtro os participantes que não têm
 * documento nenhum — que para ele também era só ruído.
 *
 * A ordem é a de `participantes` (a da viagem), não a de aparição.
 */
export function pessoasComDocumentos(
  documentos: Documento[],
  participantes: { id: string }[],
): string[] {
  const comDocumento = new Set<string>()
  for (const doc of documentos) {
    if (doc.traveler_id) comDocumento.add(doc.traveler_id)
    for (const id of doc.assigned_to ?? []) comDocumento.add(id)
  }
  return participantes.map((p) => String(p.id)).filter((id) => comDocumento.has(id))
}

// ---------------------------------------------------------------- destinos

/**
 * A chave de destino de um documento. Cidade ganha de país porque é assim que a
 * viagem é vivida ("Lisboa", não "Portugal"); sem nenhum dos dois o documento vale
 * para a viagem inteira e vai para o grupo de abertura.
 */
export const TODA_A_VIAGEM = ''

export function chaveDestino(doc: Documento): string {
  return normalizarTitulo(doc.cidade || doc.pais || TODA_A_VIAGEM)
}

export type GrupoDestino = {
  chave: string
  cidade: string
  pais: string | null
  chega_em: string | null
  sai_em: string | null
  documentos: Documento[]
}

/**
 * Agrupa o cofre por destino NA ORDEM DA VIAGEM (§3), não em ordem alfabética: a
 * tela é lida em trânsito, e quem está em Madri quer Madri perto do topo, não
 * Berlim porque começa com B.
 *
 * A ordem vem de `places` (a mesma lista que desenha o mapa e a aba Lugares), então
 * cofre e roteiro nunca discordam sobre qual destino vem primeiro.
 *
 * Três grupos que não são destino aparecem sempre nas pontas:
 *   - "Toda a viagem" primeiro: passaporte e seguro são o que se procura correndo.
 *   - um destino sem nenhum documento some (grupo vazio é ruído, não informação).
 *   - documento cuja cidade não está em `places` cai num grupo próprio no fim, em
 *     vez de sumir da tela — perder um documento por causa de um typo é pior do
 *     que mostrá-lo fora de ordem.
 */
export function agruparPorDestino(documentos: Documento[], lugares: Lugar[]): GrupoDestino[] {
  const ordenados = [...lugares].sort((a, b) => {
    const da = a.chega_em ?? ''
    const db = b.chega_em ?? ''
    if (da !== db) return da && db ? da.localeCompare(db) : da ? -1 : 1
    return (a.ordem ?? 0) - (b.ordem ?? 0)
  })

  const grupos = new Map<string, GrupoDestino>()
  grupos.set(TODA_A_VIAGEM, {
    chave: TODA_A_VIAGEM,
    cidade: 'Toda a viagem',
    pais: null,
    chega_em: null,
    sai_em: null,
    documentos: [],
  })
  for (const l of ordenados) {
    const chave = normalizarTitulo(l.cidade)
    if (grupos.has(chave)) continue
    grupos.set(chave, {
      chave,
      cidade: l.cidade,
      pais: l.pais ?? null,
      chega_em: l.chega_em ?? null,
      sai_em: l.sai_em ?? null,
      documentos: [],
    })
  }

  const soltos: GrupoDestino[] = []
  for (const doc of documentos) {
    const chave = chaveDestino(doc)
    const grupo = grupos.get(chave)
    if (grupo) {
      grupo.documentos.push(doc)
      continue
    }
    let avulso = soltos.find((g) => g.chave === chave)
    if (!avulso) {
      avulso = {
        chave,
        cidade: doc.cidade || doc.pais || 'Sem destino',
        pais: doc.cidade ? (doc.pais ?? null) : null,
        chega_em: null,
        sai_em: null,
        documentos: [],
      }
      soltos.push(avulso)
    }
    avulso.documentos.push(doc)
  }

  return [...grupos.values(), ...soltos]
    .filter((g) => g.documentos.length > 0)
    .map((g) => ({ ...g, documentos: ordenarDocumentos(g.documentos) }))
}

/** Importante primeiro, depois a ordem manual, depois alfabética. */
export function ordenarDocumentos(documentos: Documento[]): Documento[] {
  return [...documentos].sort((a, b) => {
    if (Boolean(a.importante) !== Boolean(b.importante)) return a.importante ? -1 : 1
    if ((a.ordem ?? 0) !== (b.ordem ?? 0)) return (a.ordem ?? 0) - (b.ordem ?? 0)
    return a.titulo.localeCompare(b.titulo, 'pt-BR')
  })
}

// ---------------------------------------------------------------- vínculos

/**
 * Os documentos de um dia do roteiro (§18) — sem duplicar arquivo nenhum: isto
 * devolve uma REFERÊNCIA aos documentos que já existem no cofre.
 *
 * "Do dia" é mais largo do que `dia = X` de propósito: quem embarca dia 3 precisa
 * do passaporte, que não tem data nenhuma. Entram, nesta ordem: o que está preso
 * àquele dia, o que está preso a um evento/voo/reserva daquele dia, e o que está
 * marcado como importante e vale a viagem inteira.
 */
export function documentosDoDia(
  documentos: Documento[],
  dia: string,
  vinculos: { eventos?: string[]; voos?: string[]; reservas?: string[] } = {},
): Documento[] {
  const eventos = new Set(vinculos.eventos ?? [])
  const voos = new Set(vinculos.voos ?? [])
  const reservas = new Set(vinculos.reservas ?? [])
  return ordenarDocumentos(
    documentos.filter((doc) => {
      if (doc.dia === dia) return true
      if (doc.itinerary_event_id && eventos.has(doc.itinerary_event_id)) return true
      if (doc.flight_id && voos.has(doc.flight_id)) return true
      if (doc.reservation_id && reservas.has(doc.reservation_id)) return true
      return doc.importante && !doc.dia && !doc.cidade
    }),
  )
}

/** Os documentos presos a um voo, hospedagem/reserva ou item do roteiro (§19–21). */
export function documentosDe(
  documentos: Documento[],
  vinculo: { evento?: string; voo?: string; reserva?: string },
): Documento[] {
  return ordenarDocumentos(
    documentos.filter(
      (doc) =>
        (vinculo.evento && doc.itinerary_event_id === vinculo.evento) ||
        (vinculo.voo && doc.flight_id === vinculo.voo) ||
        (vinculo.reserva && doc.reservation_id === vinculo.reserva),
    ),
  )
}

/** Tamanho legível. `Intl` já faz isto — não entra biblioteca para formatar bytes. */
export function formatarTamanho(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return ''
  const unidade = bytes >= 1024 * 1024 ? 'megabyte' : 'kilobyte'
  const valor = bytes / (unidade === 'megabyte' ? 1024 * 1024 : 1024)
  return new Intl.NumberFormat('pt-BR', {
    style: 'unit',
    unit: unidade,
    unitDisplay: 'narrow',
    maximumFractionDigits: valor < 10 ? 1 : 0,
  }).format(valor)
}
