// Quanto o assistente custou: token vira dólar vira real, e o total vira tela.
//
// Puro. Entra linha de `ai_usage`, sai número. O preço não é lido do banco — ele
// vem de `config/precos.ts` na hora da leitura, de propósito: gravar o preço
// junto do token congelaria um valor que muda, e o relatório do mês passado
// passaria a mentir no dia em que a tabela fosse reajustada.
import { PRECOS, PRECO_BUSCA_WEB, DOLAR } from '../config/precos.ts'

export type LinhaUso = {
  user_id: string
  modo: string
  modelo: string
  entrada: number | string
  saida: number | string
  cache_leitura: number | string
  cache_escrita: number | string
  busca_web?: number | string | null
  criado_em?: string | Date | null
}

const n = (v: number | string | null | undefined): number => {
  const x = typeof v === 'string' ? Number(v) : (v ?? 0)
  return Number.isFinite(x) ? x : 0
}

/**
 * Custo de UMA chamada, em dólar.
 *
 * Modelo desconhecido devolve 0 em vez de estourar: um relatório que quebra
 * porque alguém trocou o modelo é pior que um relatório que mostra uma linha
 * sem custo. `buscas` sai separado justamente para não somar um chute ao total.
 */
export function custoDe(l: LinhaUso): { dolar: number; buscas: number; estimado: boolean } {
  const p = PRECOS[l.modelo]
  const buscas = n(l.busca_web)
  if (!p) return { dolar: 0, buscas, estimado: false }

  const dolar =
    (n(l.entrada) * p.entrada +
      n(l.saida) * p.saida +
      n(l.cache_leitura) * p.cacheLeitura +
      n(l.cache_escrita) * p.cacheEscrita) /
      1_000_000 +
    (PRECO_BUSCA_WEB === null ? 0 : buscas * PRECO_BUSCA_WEB)

  return { dolar, buscas, estimado: true }
}

export type Resumo = {
  chamadas: number
  entrada: number
  saida: number
  cacheLeitura: number
  cacheEscrita: number
  buscas: number
  dolar: number
  real: number
  /** true quando alguma linha tem modelo sem preço na tabela. */
  incompleto: boolean
}

const vazio = (): Resumo => ({
  chamadas: 0,
  entrada: 0,
  saida: 0,
  cacheLeitura: 0,
  cacheEscrita: 0,
  buscas: 0,
  dolar: 0,
  real: 0,
  incompleto: false,
})

export function somar(linhas: readonly LinhaUso[]): Resumo {
  const r = vazio()
  for (const l of linhas) {
    const c = custoDe(l)
    r.chamadas += 1
    r.entrada += n(l.entrada)
    r.saida += n(l.saida)
    r.cacheLeitura += n(l.cache_leitura)
    r.cacheEscrita += n(l.cache_escrita)
    r.buscas += c.buscas
    r.dolar += c.dolar
    if (!c.estimado) r.incompleto = true
  }
  r.real = r.dolar * DOLAR
  return r
}

/** Agrupa por uma chave qualquer da linha. Usado por pessoa e por modo. */
export function agrupar<K extends keyof LinhaUso>(
  linhas: readonly LinhaUso[],
  chave: K,
): { valor: string; resumo: Resumo }[] {
  const mapa = new Map<string, LinhaUso[]>()
  for (const l of linhas) {
    const k = String(l[chave] ?? '—')
    const atual = mapa.get(k)
    if (atual) atual.push(l)
    else mapa.set(k, [l])
  }
  return [...mapa.entries()]
    .map(([valor, ls]) => ({ valor, resumo: somar(ls) }))
    .sort((a, b) => b.resumo.dolar - a.resumo.dolar)
}

/**
 * Aproveitamento do cache, em percentual da entrada.
 *
 * É o número que diz se o desenho do prompt está funcionando: zero em requisições
 * repetidas significa que algo volátil entrou no prefixo cacheável e está
 * invalidando tudo a cada mensagem.
 */
export function aproveitamentoCache(r: Resumo): number | null {
  const total = r.entrada + r.cacheLeitura
  return total === 0 ? null : Math.round((r.cacheLeitura / total) * 100)
}
