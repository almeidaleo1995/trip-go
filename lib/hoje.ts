// A tela HOJE: o roteiro reduzido ao que serve a quem está de pé na rua.
//
// Este arquivo não tem dado próprio, pelo mesmo motivo de lib/preparacao.ts: um
// "compromisso atual" GRAVADO em tabela envelhece sozinho — ninguém volta para
// marcar que o museu acabou. Derivado do relógio, ele nunca diverge.
//
// Zero I/O, zero React, zero rede: entra snapshot e relógio, sai o que a tela
// desenha. É o que permite testar as 20 situações do dia sem montar um navegador.
//
// Convenção de tempo (db/schema.sql §1, lib/derive.ts): `ocorre_em` é hora LOCAL
// DO DESTINO, sem fuso. Este módulo NÃO converte horário de evento — converte o
// AGORA, que é a única ponta que muda quando o aparelho está noutro fuso.
import {
  chaveDia,
  diasAte,
  faseDaViagem,
  ordenarItens,
  parseData,
  type Fase,
} from './derive.ts'

// ---------------------------------------------------------------- vocabulário

/** Modo de deslocamento. Espelha `itinerary_options.modo` e `events.transporte`. */
export type Modo = 'a_pe' | 'metro' | 'onibus' | 'trem' | 'taxi' | 'carro' | 'barco' | 'aviao'

export const NOME_MODO: Record<Modo, string> = {
  a_pe: 'Caminhada',
  metro: 'Metrô',
  onibus: 'Ônibus',
  trem: 'Trem',
  taxi: 'Táxi',
  carro: 'Carro',
  barco: 'Barco',
  aviao: 'Avião',
}

/** O que a tela precisa de um item do roteiro. Não é o registro inteiro. */
export type ItemRoteiro = {
  id?: string
  titulo?: string
  descricao?: string | null
  tipo?: string
  /** Obrigatório como CHAVE (pode ser null): é o que casa com `Evento` de derive.ts. */
  ocorre_em: string | null
  fim_em?: string | null
  cidade?: string | null
  local?: string | null
  endereco?: string | null
  lat?: number | string | null
  lon?: number | string | null
  distancia_m?: number | null
  duracao_min?: number | null
  transporte?: string | null
  reserva_id?: string | null
  ordem?: number
}

export type Reserva = {
  id?: string
  tipo?: string
  nome?: string
  cidade?: string | null
  inicio_em?: string | null
  fim_em?: string | null
  endereco?: string | null
  telefone?: string | null
  link?: string | null
  localizador?: string | null
}

/**
 * Um endereço pronto para virar o celular para o motorista. `linhas` já vem
 * quebrada porque quem exibe não deve decidir onde parte um endereço.
 */
export type Endereco = {
  titulo: string
  linhas: string[]
  /** Texto de uma linha só — é isto que vai para a área de transferência. */
  completo: string
  cidade: string | null
  telefone: string | null
  lat: number | null
  lon: number | null
}

/**
 * Registro cru vindo do snapshot. `unknown` em vez de `any` de propósito: cada
 * leitura passa por `texto`/`numero` abaixo, e é isso que impede um campo ausente
 * de virar "undefined" impresso na tela.
 */
type Campos = Record<string, unknown>

/**
 * As duas formas que `financeiro` assume no snapshot — e elas são DIFERENTES por
 * segurança, não por conveniência: o servidor manda `{admin: true, parcelas}` a
 * quem administra e `{admin: false, obrigacoes}` (só as da própria pessoa) a um
 * visualizador. Ler as duas aqui é ler o que já chegou; nada nesta tela filtra
 * permissão, porque nada nela teria como.
 */
type FinanceiroLido =
  | { admin: true; parcelas?: Campos[] }
  | { admin: false; obrigacoes?: Campos[] }
  | null
  | undefined

const texto = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim()
  return s === '' ? null : s
}

// ---------------------------------------------------------------- fuso

/**
 * O AGORA no relógio de parede do destino.
 *
 * Existe por uma assimetria: o horário do evento já está em hora do destino (é o
 * que está impresso no bilhete), mas `new Date()` é a hora do APARELHO. Viajando,
 * os dois coincidem — o celular troca de fuso sozinho ao pousar. Planejando de
 * casa, não: às 22h no Brasil já são 3h da manhã em Madri, e sem esta conversão a
 * tela chamaria de "agora" o compromisso do dia errado.
 *
 * Devolve um Date cujos componentes LOCAIS valem a hora do destino — a mesma
 * forma que `parseData` produz. Assim os dois lados da comparação falam a mesma
 * língua, sem nenhum `+03:00` circulando pelo código.
 *
 * Fuso inválido ou ambiente sem dados de fuso: devolve o relógio do aparelho, que
 * é a resposta certa no caso que mais importa (a pessoa está lá).
 */
export function agoraNoFuso(agora: Date, fuso?: string | null): Date {
  if (!fuso) return agora
  try {
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: fuso,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(agora)

    const p = (tipo: string) => Number(partes.find((x) => x.type === tipo)?.value)
    const d = new Date(
      p('year'),
      p('month') - 1,
      p('day'),
      // Algumas engines devolvem "24" para a meia-noite com hour12:false.
      p('hour') % 24,
      p('minute'),
      p('second'),
    )
    return Number.isNaN(d.getTime()) ? agora : d
  } catch {
    return agora
  }
}

/** O aparelho está noutro fuso que o da viagem? Só para avisar, nunca para calcular. */
export function fusoDivergente(agora: Date, fuso?: string | null): boolean {
  if (!fuso) return false
  return Math.abs(agoraNoFuso(agora, fuso).getTime() - agora.getTime()) >= 60_000
}

// ---------------------------------------------------------------- o dia

export type DiaDeHoje = {
  /** Chave YYYY-MM-DD no calendário do destino. */
  chave: string
  data: Date
  /** 1..total enquanto a viagem corre; 0 fora dela. */
  numero: number
  total: number
  fase: Fase
  /** Dias até a partida. Só faz sentido na fase `antes`. */
  faltam: number
}

/** Que dia da viagem é hoje (§3). O número vem da data, nunca de um contador. */
export function diaDeHoje(
  viagem: { data_partida?: string | null; data_retorno?: string | null } | null,
  agora: Date,
): DiaDeHoje {
  const f = faseDaViagem(agora, viagem?.data_partida ?? null, viagem?.data_retorno ?? null)
  return {
    chave: chaveDia(paraChave(agora)) ?? '',
    data: agora,
    numero: f.diaAtual,
    // `faseDaViagem.totalDias` é a DIFERENÇA entre as datas (25/12 -> 11/01 = 17),
    // enquanto `diaAtual` é contado a partir de 1 — o que renderizaria "Dia 18 de
    // 17" no último dia. Aqui o total é inclusivo, igual ao que a aba Roteiro já
    // mostra (`dias.length`), porque as duas telas contam o mesmo dia.
    total: f.totalDias > 0 ? f.totalDias + 1 : 0,
    fase: f.fase,
    faltam: f.diasRestantes,
  }
}

/** Date -> "YYYY-MM-DDTHH:mm" local, o formato que `parseData` lê de volta. */
function paraChave(d: Date): string {
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(
    d.getMinutes(),
  )}`
}

/** Os itens do roteiro que caem no dia informado, já na ordem do relógio. */
export function itensDoDia(roteiro: ItemRoteiro[], chave: string): ItemRoteiro[] {
  return ordenarItens((roteiro ?? []).filter((e) => chaveDia(e?.ocorre_em) === chave))
}

// ---------------------------------------------------------------- agora / a seguir

/**
 * Até quando um item sem `fim_em` continua sendo "agora".
 *
 * A coluna é opcional e quase ninguém preenche. Sem um teto, o almoço das 13h
 * continuaria em curso às 23h; com um teto fixo curto, uma visita longa sumiria
 * da tela no meio. A regra é: vale até o próximo item começar, e no máximo isto.
 */
export const DURACAO_PRESUMIDA_MIN = 90

export type Momento = {
  item: ItemRoteiro
  comeca: Date
  /** Fim real (`fim_em`) ou o presumido pela regra acima. `presumido` diz qual. */
  termina: Date
  presumido: boolean
  /** Minutos até terminar. Negativo quando já passou. */
  restanteMin: number
  encerrado: boolean
}

/**
 * O compromisso EM CURSO (§4). `null` quando nada está acontecendo — e aí a tela
 * mostra "nenhum compromisso agora" e promove o próximo (§22).
 *
 * Um item que já terminou nunca é o atual: ficar exibindo "Encerrado" no lugar de
 * herói da tela é exatamente o que faz alguém perder o compromisso seguinte.
 */
export function itemAtual(itens: ItemRoteiro[], agora: Date): Momento | null {
  const lista = ordenarItens(itens ?? [])
  for (let i = 0; i < lista.length; i++) {
    const comeca = parseData(lista[i]?.ocorre_em)
    if (!comeca || comeca.getTime() > agora.getTime()) continue

    const m = tempoRestante(momentoDe(lista[i], comeca, lista[i + 1]), agora)
    if (!m.encerrado) return m
  }
  return null
}

function momentoDe(item: ItemRoteiro, comeca: Date, proximo?: ItemRoteiro): Momento {
  const fim = parseData(item?.fim_em ?? null)
  const presumido = !fim || fim.getTime() <= comeca.getTime()

  let termina: Date
  if (!presumido) {
    termina = fim as Date
  } else {
    const teto = new Date(comeca.getTime() + DURACAO_PRESUMIDA_MIN * 60_000)
    const inicioDoProximo = parseData(proximo?.ocorre_em ?? null)
    termina =
      inicioDoProximo && inicioDoProximo.getTime() < teto.getTime() ? inicioDoProximo : teto
  }
  return { item, comeca, termina, presumido, restanteMin: 0, encerrado: false }
}

/** Recalcula a contagem regressiva de um momento contra o relógio (§21). */
export function tempoRestante(m: Momento, agora: Date): Momento {
  const restanteMin = Math.round((m.termina.getTime() - agora.getTime()) / 60_000)
  return { ...m, restanteMin, encerrado: restanteMin <= 0 }
}

/** O próximo compromisso do dia depois de `agora` (§8). */
export function proximoItem(itens: ItemRoteiro[], agora: Date): ItemRoteiro | null {
  for (const e of ordenarItens(itens ?? [])) {
    const d = parseData(e?.ocorre_em)
    if (d && d.getTime() > agora.getTime()) return e
  }
  return null
}

// ---------------------------------------------------------------- hora de sair

/**
 * Margem de segurança por tipo de compromisso, em minutos (§9).
 *
 * Perder um passeio custa o passeio; perder um voo custa a viagem. Por isso o
 * que tem embarque ganha folga maior — e a folga é somada ao deslocamento, não
 * embutida nele, para continuar sendo visível e ajustável.
 */
export const MARGEM_POR_TIPO: Record<string, number> = {
  voo: 30,
  cruzeiro: 45,
  trem: 20,
  onibus: 15,
}

export const MARGEM_PADRAO = 5

export function margemDe(tipo: string | null | undefined, margens = MARGEM_POR_TIPO): number {
  return margens[String(tipo ?? '')] ?? MARGEM_PADRAO
}

export type Deslocamento = {
  distanciaM: number | null
  duracaoMin: number | null
  modo: Modo | null
  /** Quando sair. `null` quando o item não tem duração de deslocamento cadastrada. */
  sairAs: Date | null
  margemMin: number
  /** Já passou da hora de sair. */
  atrasado: boolean
}

/**
 * O deslocamento ATÉ um item — `distancia_m`/`duracao_min` moram no item de
 * DESTINO (db/schema.sql), que é como se lê um roteiro: "para chegar no Prado,
 * 850 m a pé".
 *
 * Sem `duracao_min` não existe hora de sair, e a tela não inventa uma: um horário
 * de saída chutado é pior que nenhum, porque as pessoas confiam nele.
 */
export function deslocamentoAte(
  item: ItemRoteiro | null,
  agora: Date,
  margens = MARGEM_POR_TIPO,
): Deslocamento {
  const vazio: Deslocamento = {
    distanciaM: null,
    duracaoMin: null,
    modo: null,
    sairAs: null,
    margemMin: 0,
    atrasado: false,
  }
  if (!item) return vazio

  const distanciaM = numeroOuNulo(item.distancia_m)
  const duracaoMin = numeroOuNulo(item.duracao_min)
  const modo = modoValido(item.transporte)
  const margemMin = margemDe(item.tipo, margens)
  const sairAs = horaDeSair(item, agora, margens)

  return {
    distanciaM,
    duracaoMin,
    modo,
    sairAs,
    margemMin: duracaoMin === null ? 0 : margemMin,
    atrasado: sairAs ? sairAs.getTime() < agora.getTime() : false,
  }
}

/**
 * Hora recomendada de sair (§9): começo do compromisso − deslocamento − margem.
 *
 * Nunca é chutada: sem `duracao_min` cadastrada devolve `null`, e a tela mostra
 * a distância sem prometer um horário.
 */
export function horaDeSair(
  item: ItemRoteiro | null,
  _agora: Date,
  margens = MARGEM_POR_TIPO,
): Date | null {
  const comeca = parseData(item?.ocorre_em ?? null)
  const duracaoMin = numeroOuNulo(item?.duracao_min ?? null)
  if (!comeca || duracaoMin === null) return null
  return new Date(comeca.getTime() - (duracaoMin + margemDe(item?.tipo, margens)) * 60_000)
}

function numeroOuNulo(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function modoValido(v: unknown): Modo | null {
  const s = String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
  return s in NOME_MODO ? (s as Modo) : null
}

// ---------------------------------------------------------------- hospedagem

/**
 * Onde eu durmo hoje (§13).
 *
 * Preferência para a reserva que cobre ESTA NOITE. Se nenhuma cobre, mas alguma
 * termina hoje, é ela — às 9h da manhã do dia do check-out o hotel útil ainda é
 * aquele, e some da tela seria pior que mostrá-lo com a hora da saída.
 */
export function hospedagemDoDia(reservas: Reserva[], chave: string): Reserva | null {
  const hospedagens = (reservas ?? []).filter((r) => String(r?.tipo) === 'hospedagem')

  const cobreHoje = hospedagens.find((r) => {
    const ini = chaveDia(r.inicio_em)
    const fim = chaveDia(r.fim_em)
    if (!ini) return false
    return ini <= chave && (!fim || chave < fim)
  })
  if (cobreHoje) return cobreHoje

  return hospedagens.find((r) => chaveDia(r.fim_em) === chave) ?? null
}

// ---------------------------------------------------------------- rituais

export type Ritual = {
  id: string
  titulo: string
  detalhe: string | null
  feito: boolean
  /** Passou do prazo máximo. Não é cor: a tela também escreve a palavra. */
  atrasado: boolean
}

export type Rituais = { itens: Ritual[]; feitos: number; total: number }

/**
 * O checklist filtrado pelo que importa HOJE (§17, §18) — nenhum sistema novo:
 * são os mesmos `checklist_items` e o mesmo `checklist_state` da aba Checklist,
 * então marcar aqui marca lá, e sincroniza entre os cinco aparelhos.
 *
 * Entra o que é MEU e vence agora: item preso a um compromisso de hoje, item com
 * prazo hoje ou vencido, item da cidade de hoje. Um item de daqui a três semanas
 * na tela de quem está andando por Madri é ruído.
 *
 * Sugestão ainda não revisada (`pendente`) nunca entra: ela não é uma tarefa até
 * alguém aprovar.
 */
export function rituaisDoDia(
  checklist: Campos[],
  estado: Campos[],
  opcoes: { participanteId: string; chave: string; cidade?: string | null; eventos?: string[] },
): Rituais {
  const meus = new Set(
    (estado ?? [])
      .filter((e) => String(e?.traveler_id) === opcoes.participanteId && Boolean(e?.feito))
      .map((e) => String(e?.item_id)),
  )
  const eventos = new Set(opcoes.eventos ?? [])
  const cidade = normalizar(opcoes.cidade)

  const itens = (checklist ?? [])
    .filter((i) => {
      if (i?.pendente) return false

      // Escopo: pessoal só de quem é dono; global com donos marcados idem.
      const donos = (Array.isArray(i?.assigned_to) ? i.assigned_to : []).map(String)
      if (donos.length > 0 && !donos.includes(opcoes.participanteId)) return false

      if (i?.itinerary_event_id && eventos.has(String(i.itinerary_event_id))) return true

      const prazo = chaveDia(texto(i?.prazo_maximo)) ?? chaveDia(texto(i?.prazo_ideal))
      if (prazo && prazo <= opcoes.chave) return true

      return Boolean(cidade) && normalizar(i?.cidade) === cidade
    })
    .map((i) => {
      const limite = chaveDia(texto(i?.prazo_maximo))
      return {
        id: String(i.id),
        titulo: String(i.titulo ?? ''),
        detalhe: i?.detalhe ? String(i.detalhe) : null,
        feito: meus.has(String(i.id)),
        atrasado: Boolean(limite && limite < opcoes.chave && !meus.has(String(i.id))),
      }
    })

  // Pendente primeiro: quem abre a lista quer o que falta, não o que já fez.
  itens.sort((a, b) => Number(a.feito) - Number(b.feito) || a.titulo.localeCompare(b.titulo, 'pt-BR'))

  return { itens, feitos: itens.filter((i) => i.feito).length, total: itens.length }
}

function normalizar(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

// ---------------------------------------------------------------- endereço

/**
 * Monta o endereço de um item ou de uma reserva para o painel de virar o celular.
 *
 * `null` quando não há endereço: a tela não renderiza um botão que abriria uma
 * ficha vazia (§33).
 */
export function enderecoDe(alvo: ItemRoteiro | Reserva | null): Endereco | null {
  if (!alvo) return null
  const c = alvo as Campos
  const bruto = texto(c.endereco)
  const cidade = texto(c.cidade)
  if (!bruto) return null

  // `local` (item do roteiro) ou `nome` (reserva): quem lê o painel quer o NOME
  // do lugar em cima do endereço, não o título do compromisso quando há os dois.
  const titulo = texto(c.local) ?? texto(c.nome) ?? texto(c.titulo)

  // Quebrado como um envelope, que é como o motorista lê. Mas o NÚMERO fica
  // colado na rua: "Calle de Ruiz de Alarcón" numa linha e "23" na seguinte é um
  // endereço que ninguém consegue ditar — e é exatamente o que uma quebra ingênua
  // por vírgula produz.
  const linhas = bruto
    .split(/\n|,(?=\s)/)
    .map((l) => l.trim().replace(/,$/, ''))
    .filter(Boolean)
    .reduce<string[]>((acc, parte) => {
      const soNumero = /^\d+[a-zA-Z]?$/.test(parte)
      if (soNumero && acc.length > 0) acc[acc.length - 1] += `, ${parte}`
      else acc.push(parte)
      return acc
    }, [])

  const lat = Number(c.lat)
  const lon = Number(c.lon)

  // Repetir a cidade embaixo de "28014 Madrid" é ruído numa tela cuja única
  // virtude é ser lida de longe.
  const cidadeRepetida = Boolean(cidade && normalizar(bruto).includes(normalizar(cidade)))

  return {
    titulo: titulo ?? cidade ?? 'Endereço',
    linhas: linhas.length > 0 ? linhas : [bruto],
    completo: cidadeRepetida ? bruto : [bruto, cidade].filter(Boolean).join(', '),
    cidade: cidadeRepetida ? null : cidade,
    telefone: texto(c.telefone),
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
  }
}

// ---------------------------------------------------------------- formatação

/** 66 -> "1h06". Só minutos abaixo de uma hora: "45 min". */
export function formatarRestante(minutos: number): string {
  if (minutos <= 0) return 'Encerrado'
  if (minutos < 60) return `${minutos} min`
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

/** Date -> "11:16". A tela inteira mostra hora do destino, então não há fuso aqui. */
export function formatarHoraLocal(d: Date | null): string {
  if (!d) return ''
  const z = (n: number) => String(n).padStart(2, '0')
  return `${z(d.getHours())}:${z(d.getMinutes())}`
}

// ---------------------------------------------------------------- a montagem

export type Hoje = {
  dia: DiaDeHoje
  agora: Date
  /** O aparelho está noutro fuso — a tela avisa em vez de mentir o "agora". */
  outroFuso: boolean
  cidade: string | null
  /** Coordenada da cidade de hoje, para o clima. `null` desliga o bloco. */
  coordenada: { lat: number; lon: number } | null
  atual: Momento | null
  proximo: { item: ItemRoteiro; deslocamento: Deslocamento } | null
  /** O que ainda vem depois do próximo, no mesmo dia. */
  depois: ItemRoteiro[]
  itensDoDia: ItemRoteiro[]
  hospedagem: Reserva | null
  rituais: Rituais
  /** Parcela minha que vence hoje (§36). Some para quem não tem nenhuma. */
  pagamentoHoje: { valorCentavos: number; descricao: string } | null
}

/**
 * Tudo que a tela HOJE desenha, numa passada só.
 *
 * Recebe `agora` de fora (nunca chama `new Date()` por dentro) para que os testes
 * possam parar o relógio, e para que a tela toda repinte com o MESMO instante —
 * dois `new Date()` no meio de um render fazem "agora" e "restante" discordarem.
 */
export function montarHoje(
  snapshot: {
    viagem?: Campos | null
    roteiro?: Campos[]
    reservas?: Campos[]
    lugares?: Campos[]
    checklist?: Campos[]
    checklist_state?: Campos[]
    financeiro?: FinanceiroLido
    eu?: { participanteId?: string }
  } | null,
  relogio: Date,
): Hoje | null {
  if (!snapshot?.viagem) return null

  const fuso = snapshot.viagem.fuso ? String(snapshot.viagem.fuso) : null
  const agora = agoraNoFuso(relogio, fuso)
  const dia = diaDeHoje(snapshot.viagem, agora)

  const roteiro = (snapshot.roteiro ?? []) as ItemRoteiro[]
  const doDia = itensDoDia(roteiro, dia.chave)
  const emViagem = dia.fase === 'durante'

  // Fora da viagem a tela NÃO finge que se está viajando (§24, §25): nada está
  // "agora", ninguém dorme em lugar nenhum hoje, e o resto do dia não é assunto.
  const atualCru = emViagem ? itemAtual(doDia, agora) : null
  const atual = atualCru ? tempoRestante(atualCru, agora) : null

  // Antes da partida, "o próximo" é o próximo da VIAGEM INTEIRA, não o do dia —
  // recortar por hoje deixaria o bloco eternamente vazio, que é o oposto do que
  // alguém abrindo a aba em novembro quer ver.
  const proximoCru =
    dia.fase === 'antes' ? proximoItem(roteiro, agora) : emViagem ? proximoItem(doDia, agora) : null

  const proximo = proximoCru
    ? { item: proximoCru, deslocamento: deslocamentoAte(proximoCru, agora) }
    : null

  const depois = !emViagem
    ? []
    : proximoCru
      ? doDia.slice(doDia.findIndex((e) => e === proximoCru) + 1)
      : doDia.filter((e) => {
          const d = parseData(e.ocorre_em)
          return d ? d.getTime() > agora.getTime() : false
        })

  // A cidade de hoje é a do compromisso em curso; sem ele, a do próximo; sem
  // nenhum, a do primeiro item do dia (§3).
  const cidade =
    atual?.item.cidade || proximoCru?.cidade || doDia.find((e) => e.cidade)?.cidade || null

  const participanteId = String(snapshot.eu?.participanteId ?? '')

  return {
    dia,
    agora,
    outroFuso: fusoDivergente(relogio, fuso),
    cidade: cidade ? String(cidade) : null,
    coordenada: coordenadaDaCidade(snapshot.lugares ?? [], cidade, doDia),
    atual,
    proximo,
    depois,
    itensDoDia: doDia,
    hospedagem: emViagem ? hospedagemDoDia((snapshot.reservas ?? []) as Reserva[], dia.chave) : null,
    rituais: rituaisDoDia(snapshot.checklist ?? [], snapshot.checklist_state ?? [], {
      participanteId,
      chave: dia.chave,
      cidade,
      eventos: doDia.map((e) => String(e.id)),
    }),
    pagamentoHoje: pagamentoDoDia(snapshot.financeiro, dia.chave),
  }
}

/** Coordenada para o clima: a da cidade cadastrada, senão a de algum item do dia. */
function coordenadaDaCidade(
  lugares: Campos[],
  cidade: unknown,
  itens: ItemRoteiro[],
): { lat: number; lon: number } | null {
  const alvo = normalizar(cidade)
  const candidatos: { lat?: unknown; lon?: unknown }[] = []

  if (alvo) {
    const lugar = (lugares ?? []).find((l) => normalizar(l?.cidade) === alvo)
    if (lugar) candidatos.push(lugar)
  }
  for (const e of itens) if (e.lat != null && e.lon != null) candidatos.push(e)

  for (const c of candidatos) {
    const lat = Number(c.lat)
    const lon = Number(c.lon)
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon }
  }
  return null
}

/**
 * Parcela que vence hoje (§36). Lê o que o servidor JÁ decidiu mostrar a esta
 * pessoa: um `visualizador` recebe só as obrigações dele, e o total da viagem
 * nunca chega ao navegador dele (lib/db.ts → `financeiroDaViagem`). Nada aqui
 * filtra permissão, porque nada aqui teria como.
 */
function pagamentoDoDia(
  financeiro: FinanceiroLido,
  chave: string,
): { valorCentavos: number; descricao: string } | null {
  const parcelas: Campos[] = financeiro?.admin
    ? (financeiro.parcelas ?? [])
    : (financeiro?.obrigacoes ?? [])

  const hoje = parcelas.filter(
    (p) => chaveDia(texto(p?.vence_em)) === chave && Number(p?.valor_centavos) > Number(p?.pago_centavos),
  )
  if (hoje.length === 0) return null

  const valorCentavos = hoje.reduce(
    (s, p) => s + (Number(p.valor_centavos) - Number(p.pago_centavos ?? 0)),
    0,
  )
  return {
    valorCentavos,
    descricao:
      hoje.length === 1 ? String(hoje[0].descricao ?? 'Pagamento') : `${hoje.length} pagamentos`,
  }
}

/** Quantos dias faltam para a viagem começar (§24). Reexporta para a tela não importar dois módulos. */
export { diasAte }
