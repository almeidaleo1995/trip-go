// Motor financeiro da viagem. Zero I/O, zero React, zero SQL: entra linha do
// banco, sai numero. O servidor usa este arquivo para recortar o que cada papel
// pode ver; a tela usa para desenhar. Nenhuma conta de dinheiro mora em componente.
//
// A regra que rege tudo aqui:
//
//   quem PAGOU o fornecedor, quem DEVE arcar com a despesa e quem RECEBE o
//   reembolso sao tres pessoas diferentes.
//
// Uma despesa guarda o valor TOTAL (nao o valor por pessoa) e o pagador. As
// linhas de `divisoes` dizem quanto cada participante assume. As de `parcelas`
// dizem quando o dinheiro sai. Os `pagamentos` sao reembolsos entre pessoas.
// Saldo, acerto e "quem deve para quem" caem dos quatro conjuntos, nunca sao
// digitados.
//
// Dinheiro e SEMPRE centavos inteiros, do inicio ao fim. Toda reparticao passa
// por `repartir`, que devolve partes somando EXATAMENTE o valor de entrada -
// nenhuma divisao pode perder ou inventar um centavo.
import { parseData, diasAte } from './derive.ts'

// ---------------------------------------------------------------- tipos
//
// Os campos vem do driver do Neon e atravessam JSON, entao numero pode chegar
// como string e data como Date ou ISO. Os tipos aceitam as duas formas e os
// normalizadores abaixo resolvem antes de qualquer conta.

export type Despesa = {
  id: string
  categoria_id?: string | null
  descricao?: string
  /** Valor TOTAL da despesa, nao por pessoa. */
  valor_centavos: number | string
  /** Participante que pagou o fornecedor. Quem reembolsa, reembolsa esta pessoa. */
  traveler_id?: string | null
  divisao?: string | null
  ocorre_em?: string | Date | null
  estimado?: boolean
  nota?: string | null
  ordem?: number
}

export type LinhaDivisao = {
  expense_id: string
  traveler_id: string
  /** Quantas partes esta pessoa assume. Um casal sao duas partes. */
  peso: number | string
  /** Quanto cabe a ela, ja resolvido em centavos. */
  valor_centavos: number | string
}

export type Parcela = {
  id: string
  expense_id: string
  numero: number | string
  vence_em?: string | Date | null
  valor_centavos: number | string
  /** Quanto ja foi pago ao fornecedor desta parcela. */
  pago_centavos?: number | string
  pago_em?: string | Date | null
}

export type Pagamento = {
  id: string
  /** Quem reembolsou. */
  de_id?: string | null
  /** Quem recebeu. */
  para_id?: string | null
  valor_centavos: number | string
  ocorre_em?: string | Date | null
  /** Parcela a que o reembolso se refere. Nulo = acerto avulso. */
  parcela_id?: string | null
  referencia?: string | null
  nota?: string | null
}

export type Participante = { id: string; nome?: string; papel?: string }

export type Categoria = { id: string; nome?: string }

/** Tudo que uma viagem tem de financeiro. E o que o snapshot carrega para admin. */
export type DadosFinanceiros = {
  categorias: Categoria[]
  despesas: Despesa[]
  divisoes: LinhaDivisao[]
  parcelas: Parcela[]
  pagamentos: Pagamento[]
}

// ---------------------------------------------------------------- normalizacao

/** Centavos inteiros, nunca negativos. Entrada suja vira 0, nunca NaN. */
export function centavos(v: unknown): number {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Centavos inteiros COM sinal. Saldo e a unica coisa que pode ser negativa. */
function comSinal(v: unknown): number {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? n : 0
}

/**
 * "AAAA-MM-DD" a partir do que o driver devolver.
 *
 * Coluna `date` do Neon chega como Date; o mesmo valor depois de passar por JSON
 * chega como "2026-09-10T00:00:00.000Z". Fatiar os dez primeiros caracteres da
 * ISO preserva o dia gravado; ler pelos getters locais faz o mesmo com o Date.
 */
export function paraDia(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null
    const p = (n: number) => String(n).padStart(2, '0')
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`
  }
  const s = String(v)
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

function diaDeDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// ---------------------------------------------------------------- reparticao

/**
 * Reparte `total` centavos entre `pesos`, somando EXATAMENTE `total`.
 *
 * Metodo dos maiores restos: cada um leva a parte inteira, e os centavos que
 * sobram vao para quem ficou com a maior fracao. E o unico jeito de a soma
 * fechar sem escolher uma vitima fixa para o arredondamento.
 *
 * Os restos sao comparados em INTEIROS (`total * peso % soma`). Decidir quem
 * leva o centavo comparando fracao de ponto flutuante e exatamente como se
 * perde um centavo.
 */
export function repartir(total: number, pesos: (number | string)[]): number[] {
  const n = pesos.length
  if (n === 0) return []

  const t = centavos(total)
  const p = pesos.map((x) => centavos(x))
  const somaPesos = p.reduce((a, b) => a + b, 0)

  // Ninguem com peso: a divisao seria indefinida. Cai no igual, que e o que a
  // pessoa quis dizer ao marcar todo mundo sem mexer nos pesos.
  const usados = somaPesos > 0 ? p : new Array<number>(n).fill(1)
  const soma = somaPesos > 0 ? somaPesos : n

  const partes = usados.map((w) => Math.floor((t * w) / soma))
  const restos = usados.map((w) => (t * w) % soma)
  let sobra = t - partes.reduce((a, b) => a + b, 0)

  // Maior resto primeiro; empate resolve pela ordem de entrada, para a mesma
  // despesa produzir sempre exatamente a mesma divisao.
  const ordem = partes.map((_, i) => i).sort((a, b) => restos[b] - restos[a] || a - b)
  for (let k = 0; sobra > 0 && k < ordem.length; k++, sobra--) partes[ordem[k]] += 1

  return partes
}

/**
 * Resolve a divisao de uma despesa nos valores de cada participante.
 *
 * `igual`         -> todo mundo com peso 1
 * `peso`          -> o peso digitado (casal = 2 partes)
 * `personalizado` -> o valor digitado, usado como esta
 *
 * No personalizado a soma pode nao bater com o total; quem valida isso e o
 * formulario (a mensagem precisa dizer o valor certo). Aqui a entrada e
 * respeitada, porque corrigir em silencio esconderia o erro do usuario.
 */
export function resolverDivisao(
  total: number,
  modo: string | null | undefined,
  linhas: { traveler_id: string; peso?: number | string; valor_centavos?: number | string }[],
): { traveler_id: string; peso: number; valor_centavos: number }[] {
  if (linhas.length === 0) return []

  if (modo === 'personalizado') {
    return linhas.map((l) => ({
      traveler_id: l.traveler_id,
      peso: 1,
      valor_centavos: centavos(l.valor_centavos),
    }))
  }

  const pesos = linhas.map((l) => (modo === 'peso' ? centavos(l.peso ?? 1) : 1))
  const valores = repartir(total, pesos)
  return linhas.map((l, i) => ({
    traveler_id: l.traveler_id,
    peso: pesos[i],
    valor_centavos: valores[i],
  }))
}

// ---------------------------------------------------------------- parcelamento

export type Frequencia = 'mensal' | 'quinzenal' | 'semanal'

export type ParcelaNova = { numero: number; vence_em: string | null; valor_centavos: number }

/**
 * Gera as parcelas de uma despesa. A soma delas e EXATAMENTE o valor total -
 * nao assume que toda parcela e igual, porque quase nunca e.
 *
 * A vista e o mesmo caminho com uma parcela so: uma despesa sempre tem pelo
 * menos uma, e assim vencimento, atraso e quitacao tem um lugar unico para morar.
 */
export function gerarParcelas(
  total: number,
  quantidade: number,
  primeiraEm: string | null,
  frequencia: Frequencia = 'mensal',
): ParcelaNova[] {
  const n = Math.max(1, Math.trunc(Number(quantidade) || 1))
  const valores = repartir(total, new Array<number>(n).fill(1))
  const inicio = parseData(primeiraEm)

  return valores.map((valor, i) => ({
    numero: i + 1,
    vence_em: inicio ? diaDeDate(avancar(inicio, i, frequencia)) : null,
    valor_centavos: valor,
  }))
}

/**
 * Soma periodos preservando o dia do mes: 31/01 + 1 mes e 28/02, nao 03/03.
 * O construtor de Date faz rollover em silencio, e uma parcela que "vence" no
 * dia 3 do mes seguinte e uma parcela que a pessoa paga atrasada.
 */
function avancar(base: Date, passos: number, f: Frequencia): Date {
  if (f === 'mensal') {
    const alvo = new Date(base.getFullYear(), base.getMonth() + passos, 1)
    const ultimoDia = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate()
    return new Date(alvo.getFullYear(), alvo.getMonth(), Math.min(base.getDate(), ultimoDia))
  }
  const dias = f === 'quinzenal' ? 15 : 7
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + passos * dias)
}

// ---------------------------------------------------------------- status no tempo

export type StatusParcela = 'paga' | 'atrasada' | 'hoje' | 'parcial' | 'futura' | 'pendente'

export const NOME_STATUS: Record<StatusParcela, string> = {
  paga: 'Paga',
  atrasada: 'Atrasada',
  hoje: 'Vence hoje',
  parcial: 'Parcialmente paga',
  futura: 'Futura',
  pendente: 'Pendente',
}

/**
 * Situacao de uma parcela contra a data de hoje.
 *
 * Atrasada ganha de parcialmente paga de proposito: metade paga e vencida ha
 * cinco dias e um problema, e o rotulo tem que dizer o problema. O quanto foi
 * pago continua visivel ao lado, entao nada se perde.
 */
export function statusParcela(
  p: {
    vence_em?: string | Date | null
    valor_centavos: number | string
    pago_centavos?: number | string
  },
  hoje: Date = new Date(),
): StatusParcela {
  const valor = centavos(p.valor_centavos)
  const pago = centavos(p.pago_centavos)

  if (valor > 0 && pago >= valor) return 'paga'

  const vence = parseData(paraDia(p.vence_em))
  if (!vence) return pago > 0 ? 'parcial' : 'pendente'

  if (diasAte(vence, hoje) > 0) return 'atrasada'
  if (diasAte(hoje, vence) === 0) return 'hoje'
  return pago > 0 ? 'parcial' : 'futura'
}

/** Dias de atraso; 0 quando ainda nao venceu. */
export function diasDeAtraso(
  vence: string | Date | null | undefined,
  hoje: Date = new Date(),
): number {
  const d = parseData(paraDia(vence))
  return d ? diasAte(d, hoje) : 0
}

/** Dias que faltam para vencer; 0 quando ja venceu ou vence hoje. */
export function diasParaVencer(
  vence: string | Date | null | undefined,
  hoje: Date = new Date(),
): number {
  const d = parseData(paraDia(vence))
  return d ? diasAte(hoje, d) : 0
}

// ---------------------------------------------------------------- parcelas de uma despesa

/**
 * As parcelas de uma despesa, em ordem.
 *
 * Despesa sem parcela cadastrada (importada de um arquivo antigo, ou criada
 * antes deste modulo existir) ganha uma parcela unica sintetica, com o id
 * derivado do id da despesa. Sem isso ela sumiria de toda tela que conta
 * dinheiro pelo calendario - e dinheiro que some da tela e o pior defeito
 * possivel aqui.
 */
export function parcelasDe(d: Despesa, parcelas: Parcela[]): Parcela[] {
  const minhas = parcelas
    .filter((p) => p.expense_id === d.id)
    .sort((a, b) => Number(a.numero) - Number(b.numero))
  if (minhas.length > 0) return minhas

  return [
    {
      id: `${d.id}:1`,
      expense_id: d.id,
      numero: 1,
      vence_em: paraDia(d.ocorre_em),
      valor_centavos: centavos(d.valor_centavos),
      pago_centavos: 0,
    },
  ]
}

/** true quando a despesa foi realmente parcelada (mais de uma parcela). */
export function ehParcelada(d: Despesa, parcelas: Parcela[]): boolean {
  return parcelas.filter((p) => p.expense_id === d.id).length > 1
}

// ---------------------------------------------------------------- totais do admin

export type TotaisViagem = {
  /** Soma das despesas lancadas. */
  total: number
  /** Ja pago ao fornecedor, somando parcela a parcela. */
  pago: number
  /** O que falta pagar. */
  aberto: number
  /** Valor e contagem das parcelas em aberto de despesas parceladas. */
  parcelasAbertas: number
  parcelasValor: number
  despesas: number
}

export function totaisViagem(despesas: Despesa[], parcelas: Parcela[]): TotaisViagem {
  let total = 0
  let pago = 0
  let aberto = 0
  let parcelasAbertas = 0
  let parcelasValor = 0

  for (const d of despesas) {
    total += centavos(d.valor_centavos)
    const lista = parcelasDe(d, parcelas)
    const parcelada = lista.length > 1

    for (const p of lista) {
      const valor = centavos(p.valor_centavos)
      const pg = Math.min(centavos(p.pago_centavos), valor)
      pago += pg
      if (pg < valor) {
        aberto += valor - pg
        if (parcelada) {
          parcelasAbertas += 1
          parcelasValor += valor - pg
        }
      }
    }
  }

  return { total, pago, aberto, parcelasAbertas, parcelasValor, despesas: despesas.length }
}

/** Percentual inteiro de `parte` sobre `todo`. Base zero devolve 0, nao NaN. */
export function percentual(parte: number, todo: number): number {
  if (!todo) return 0
  return Math.round((parte / todo) * 100)
}

// ---------------------------------------------------------------- saldos

export type Saldo = {
  traveler_id: string
  nome: string
  /** Quanto essa pessoa desembolsou como pagadora de despesas. */
  pagou: number
  /** Quanto dela cabe nas despesas. */
  deve: number
  /** Reembolsos que ela fez a outras pessoas. */
  reembolsou: number
  /** Reembolsos que ela recebeu. */
  recebeu: number
  /** Positivo = tem a receber. Negativo = deve. Zero = equilibrado. */
  saldo: number
}

/**
 * Saldo de cada participante.
 *
 *   saldo = o que pagou - o que lhe cabe + o que reembolsou - o que recebeu
 *
 * Quem adiantou dinheiro pelo grupo fica com saldo positivo ate ser reembolsado;
 * quem participou sem pagar fica negativo ate reembolsar. A soma de todos os
 * saldos e sempre zero, e e isso que faz o acerto fechar.
 */
export function saldos(
  participantes: Participante[],
  despesas: Despesa[],
  divisoes: LinhaDivisao[],
  pagamentos: Pagamento[],
): Saldo[] {
  const base = new Map<string, Saldo>()
  for (const p of participantes) {
    base.set(p.id, {
      traveler_id: p.id,
      nome: String(p.nome ?? ''),
      pagou: 0,
      deve: 0,
      reembolsou: 0,
      recebeu: 0,
      saldo: 0,
    })
  }
  // Participante removido depois de aparecer numa despesa nao pode derrubar a
  // conta: entra na lista com o nome que der para descobrir.
  const garantir = (id: string | null | undefined): Saldo | null => {
    if (!id) return null
    if (!base.has(id)) {
      base.set(id, {
        traveler_id: id,
        nome: '',
        pagou: 0,
        deve: 0,
        reembolsou: 0,
        recebeu: 0,
        saldo: 0,
      })
    }
    return base.get(id)!
  }

  // Despesa sem pagador é o estado NORMAL de uma viagem que ainda está sendo
  // planejada (e de tudo que veio de uma importação): ninguém adiantou dinheiro
  // ainda. Ela entra no total da viagem e no saldo de ninguém.
  for (const d of despesas) {
    const pagador = garantir(d.traveler_id)
    if (pagador) pagador.pagou += centavos(d.valor_centavos)
  }
  for (const l of divisoes) {
    const s = garantir(l.traveler_id)
    if (s) s.deve += centavos(l.valor_centavos)
  }
  for (const g of pagamentos) {
    const de = garantir(g.de_id)
    const para = garantir(g.para_id)
    const v = centavos(g.valor_centavos)
    if (de) de.reembolsou += v
    if (para) para.recebeu += v
  }

  for (const s of base.values()) s.saldo = s.pagou - s.deve + s.reembolsou - s.recebeu
  return [...base.values()]
}

export type Acerto = { de: string; para: string; valor_centavos: number }

/**
 * Quem paga quanto para quem, minimizando o numero de transferencias.
 *
 * Trabalha sobre o saldo LIQUIDO, nao sobre despesa a despesa: se A deve 500 a
 * B e B deve 200 a C, o resultado sao duas transferencias (A->B 300, A->C 200)
 * em vez de duas viagens de dinheiro dando a volta pelo B.
 *
 * ponytail: guloso - sempre o maior devedor contra o maior credor. Da no
 * maximo n-1 transferencias, o que resolve qualquer grupo de viagem, mas nao e
 * o minimo provado (o minimo exato e NP-dificil). Com mais de umas dezenas de
 * participantes e saldos que casam em subgrupos, um solver de particao acharia
 * menos transferencias. Nao vale o custo para cinco pessoas.
 */
export function simplificar(lista: { traveler_id: string; saldo: number }[]): Acerto[] {
  const credores = lista
    .filter((s) => comSinal(s.saldo) > 0)
    .map((s) => ({ id: s.traveler_id, resta: comSinal(s.saldo) }))
    .sort((a, b) => b.resta - a.resta || a.id.localeCompare(b.id))

  const devedores = lista
    .filter((s) => comSinal(s.saldo) < 0)
    .map((s) => ({ id: s.traveler_id, resta: -comSinal(s.saldo) }))
    .sort((a, b) => b.resta - a.resta || a.id.localeCompare(b.id))

  const acertos: Acerto[] = []
  let i = 0
  let j = 0
  while (i < devedores.length && j < credores.length) {
    const valor = Math.min(devedores[i].resta, credores[j].resta)
    if (valor <= 0) break
    acertos.push({ de: devedores[i].id, para: credores[j].id, valor_centavos: valor })
    devedores[i].resta -= valor
    credores[j].resta -= valor
    if (devedores[i].resta === 0) i += 1
    if (credores[j].resta === 0) j += 1
  }
  return acertos
}

// ---------------------------------------------------------------- obrigacoes de uma pessoa

export type Obrigacao = {
  /** id da parcela — chave estavel para registrar o pagamento contra ela. */
  id: string
  despesa_id: string
  descricao: string
  categoria: string | null
  numero: number
  total_parcelas: number
  vence_em: string | null
  /** A parte DESTA pessoa nesta parcela. Nunca o valor cheio da parcela. */
  valor_centavos: number
  /** Quanto ela ja reembolsou desta parcela. */
  pago_centavos: number
  para_id: string
  para: string
  status: StatusParcela
  atraso_dias: number
}

/**
 * O que uma pessoa deve, para quem e quando.
 *
 * Esta funcao e o recorte de privacidade do modulo: o que ela devolve e tudo
 * que um viajante comum pode saber sobre o financeiro da viagem. Despesa em que
 * ele nao entra nao aparece, valor de outra pessoa nao aparece, e o valor da
 * parcela cheia (que revelaria o total do grupo) nunca sai daqui - so a parte
 * dele.
 *
 * A parte de cada parcela vem de repartir a divisao DELE entre as parcelas,
 * pesada pelo valor de cada uma. Repartir a parcela entre as pessoas daria
 * outro numero, e a soma das parcelas dele deixaria de fechar com o que ele
 * deve. Assim fecha sempre.
 */
export function obrigacoesDe(
  travelerId: string,
  dados: DadosFinanceiros & { participantes: Participante[] },
  hoje: Date = new Date(),
): Obrigacao[] {
  const nomes = new Map(dados.participantes.map((p) => [p.id, String(p.nome ?? '')]))
  const categorias = new Map(dados.categorias.map((c) => [c.id, String(c.nome ?? '')]))
  const saida: Obrigacao[] = []

  for (const d of dados.despesas) {
    const minha = dados.divisoes.find((l) => l.expense_id === d.id && l.traveler_id === travelerId)
    if (!minha) continue

    const pagador = d.traveler_id
    // Ninguem deve para si mesmo: quem pagou nao reembolsa a propria despesa.
    if (!pagador || pagador === travelerId) continue

    const lista = parcelasDe(d, dados.parcelas)
    const minhasPartes = repartir(
      centavos(minha.valor_centavos),
      lista.map((p) => centavos(p.valor_centavos)),
    )

    lista.forEach((p, i) => {
      const valor = minhasPartes[i]
      if (valor === 0) return
      const pago = dados.pagamentos
        .filter((g) => g.parcela_id === p.id && g.de_id === travelerId && g.para_id === pagador)
        .reduce((s, g) => s + centavos(g.valor_centavos), 0)

      const vence = paraDia(p.vence_em)
      saida.push({
        id: String(p.id),
        despesa_id: d.id,
        descricao: String(d.descricao ?? ''),
        categoria: d.categoria_id ? (categorias.get(d.categoria_id) ?? null) : null,
        numero: Number(p.numero),
        total_parcelas: lista.length,
        vence_em: vence,
        valor_centavos: valor,
        pago_centavos: Math.min(pago, valor),
        para_id: pagador,
        para: nomes.get(pagador) ?? '',
        status: statusParcela(
          { vence_em: vence, valor_centavos: valor, pago_centavos: pago },
          hoje,
        ),
        atraso_dias: diasDeAtraso(vence, hoje),
      })
    })
  }

  return ordenarPorVencimento(saida)
}

/** Vencimento crescente; sem data vai para o fim. */
export function ordenarPorVencimento<T extends { vence_em: string | null }>(lista: T[]): T[] {
  return [...lista].sort((a, b) => {
    if (!a.vence_em && !b.vence_em) return 0
    if (!a.vence_em) return 1
    if (!b.vence_em) return -1
    return a.vence_em.localeCompare(b.vence_em)
  })
}

export type ResumoPessoal = {
  obrigacoes: Obrigacao[]
  /** Reembolsos que esta pessoa ja registrou. */
  historico: Pagamento[]
  /** Soma do que ainda falta pagar. */
  devendo: number
  /** Soma do que ja pagou. */
  pago: number
  /** Quanto vence nos proximos 30 dias, incluindo o que ja venceu. */
  do_mes: number
  atrasadas: number
}

/**
 * O pacote completo do viajante comum. E exatamente isto que vai para a rede
 * quando o papel e `visualizador` - nenhuma outra linha financeira sai do banco.
 */
export function resumoPessoal(
  travelerId: string,
  dados: DadosFinanceiros & { participantes: Participante[] },
  hoje: Date = new Date(),
): ResumoPessoal {
  const obrigacoes = obrigacoesDe(travelerId, dados, hoje)
  const historico = dados.pagamentos
    .filter((g) => g.de_id === travelerId)
    .map((g) => ({
      id: String(g.id),
      de_id: g.de_id ?? null,
      para_id: g.para_id ?? null,
      valor_centavos: centavos(g.valor_centavos),
      ocorre_em: paraDia(g.ocorre_em),
      parcela_id: g.parcela_id ?? null,
      referencia: g.referencia ?? null,
      nota: g.nota ?? null,
    }))

  let devendo = 0
  let pago = 0
  let doMes = 0
  let atrasadas = 0
  for (const o of obrigacoes) {
    const falta = Math.max(0, o.valor_centavos - o.pago_centavos)
    devendo += falta
    pago += o.pago_centavos
    if (o.status === 'atrasada') atrasadas += 1
    if (falta > 0 && (!o.vence_em || diasParaVencer(o.vence_em, hoje) <= 30)) doMes += falta
  }

  return { obrigacoes, historico, devendo, pago, do_mes: doMes, atrasadas }
}

// ---------------------------------------------------------------- relatorios

export type FatiaCategoria = { id: string | null; nome: string; total: number; pct: number }

/** Gasto por categoria, maior primeiro. Sem categoria vira uma fatia propria. */
export function porCategoria(despesas: Despesa[], categorias: Categoria[]): FatiaCategoria[] {
  const nomes = new Map(categorias.map((c) => [c.id, String(c.nome ?? '')]))
  const soma = new Map<string, number>()
  let total = 0

  for (const d of despesas) {
    const chave = d.categoria_id ?? ''
    const v = centavos(d.valor_centavos)
    soma.set(chave, (soma.get(chave) ?? 0) + v)
    total += v
  }

  return [...soma.entries()]
    .map(([id, valor]) => ({
      id: id || null,
      nome: id ? (nomes.get(id) ?? 'Categoria removida') : 'Sem categoria',
      total: valor,
      pct: percentual(valor, total),
    }))
    .sort((a, b) => b.total - a.total)
}

export type FatiaParticipante = { traveler_id: string; nome: string; total: number; pct: number }

/** Quanto cabe a cada participante. So o admin ve isto. */
export function porParticipante(
  participantes: Participante[],
  divisoes: LinhaDivisao[],
): FatiaParticipante[] {
  const soma = new Map<string, number>()
  let total = 0
  for (const l of divisoes) {
    const v = centavos(l.valor_centavos)
    soma.set(l.traveler_id, (soma.get(l.traveler_id) ?? 0) + v)
    total += v
  }
  return participantes
    .map((p) => ({
      traveler_id: p.id,
      nome: String(p.nome ?? ''),
      total: soma.get(p.id) ?? 0,
      pct: percentual(soma.get(p.id) ?? 0, total),
    }))
    .sort((a, b) => b.total - a.total)
}

export type Mes = { mes: string; total: number; aberto: number }

/**
 * Programacao mes a mes, do vencimento das parcelas. E a projecao administrativa
 * (§ "Proximos meses") - nunca vai para o viajante comum.
 */
export function porMes(despesas: Despesa[], parcelas: Parcela[]): Mes[] {
  const soma = new Map<string, Mes>()
  for (const d of despesas) {
    for (const p of parcelasDe(d, parcelas)) {
      const dia = paraDia(p.vence_em)
      if (!dia) continue
      const mes = dia.slice(0, 7)
      const linha = soma.get(mes) ?? { mes, total: 0, aberto: 0 }
      const valor = centavos(p.valor_centavos)
      linha.total += valor
      linha.aberto += Math.max(0, valor - centavos(p.pago_centavos))
      soma.set(mes, linha)
    }
  }
  return [...soma.values()].sort((a, b) => a.mes.localeCompare(b.mes))
}

export type ParcelaNaTela = Parcela & {
  despesa_id: string
  descricao: string
  categoria_id: string | null
  pagador_id: string | null
  total_parcelas: number
  status: StatusParcela
  atraso_dias: number
  vence_em: string | null
}

/** Todas as parcelas da viagem em uma lista plana, prontas para filtrar. */
export function parcelasDaViagem(
  despesas: Despesa[],
  parcelas: Parcela[],
  hoje: Date = new Date(),
): ParcelaNaTela[] {
  const saida: ParcelaNaTela[] = []
  for (const d of despesas) {
    const lista = parcelasDe(d, parcelas)
    for (const p of lista) {
      const vence = paraDia(p.vence_em)
      saida.push({
        ...p,
        id: String(p.id),
        numero: Number(p.numero),
        valor_centavos: centavos(p.valor_centavos),
        pago_centavos: centavos(p.pago_centavos),
        vence_em: vence,
        despesa_id: d.id,
        descricao: String(d.descricao ?? ''),
        categoria_id: d.categoria_id ?? null,
        pagador_id: d.traveler_id ?? null,
        total_parcelas: lista.length,
        status: statusParcela({ ...p, vence_em: vence }, hoje),
        atraso_dias: diasDeAtraso(vence, hoje),
      })
    }
  }
  return ordenarPorVencimento(saida)
}

/**
 * De onde vem a divida de uma pessoa com outra: as despesas que a originaram.
 *
 * Existe para a tela "ver detalhes" do saldo (§55): um numero sem explicacao e
 * um numero que ninguem aceita pagar.
 */
export function origemDaDivida(
  devedorId: string,
  credorId: string,
  dados: DadosFinanceiros,
): { despesa_id: string; descricao: string; valor_centavos: number }[] {
  const saida: { despesa_id: string; descricao: string; valor_centavos: number }[] = []
  for (const d of dados.despesas) {
    if (d.traveler_id !== credorId) continue
    const linha = dados.divisoes.find((l) => l.expense_id === d.id && l.traveler_id === devedorId)
    if (!linha) continue
    const v = centavos(linha.valor_centavos)
    if (v > 0)
      saida.push({ despesa_id: d.id, descricao: String(d.descricao ?? ''), valor_centavos: v })
  }
  return saida.sort((a, b) => b.valor_centavos - a.valor_centavos)
}
