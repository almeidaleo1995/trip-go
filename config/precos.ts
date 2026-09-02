// Preço por milhão de tokens, em dólar. Fonte: tabela de preços da Anthropic.
//
// Fica aqui, e não no banco, pelo mesmo motivo que `theme.ts` não fica: é
// configuração do produto, não dado da viagem. E fica separado de `ai_usage`
// porque token é FATO e preço é TABELA — gravar o preço junto do token
// congelaria um valor que muda, e o relatório do mês passado passaria a mentir
// assim que a Anthropic reajustasse. O custo é calculado na leitura.
//
// Atualizar quando a tabela oficial mudar: platform.claude.com/docs → Pricing.

export type Preco = {
  /** Entrada não-cacheada. */
  entrada: number
  saida: number
  /** Leitura de cache: ~0,1x a entrada. */
  cacheLeitura: number
  /** Gravação de cache: ~1,25x a entrada. */
  cacheEscrita: number
}

export const PRECOS: Record<string, Preco> = {
  'claude-opus-5': { entrada: 5, saida: 25, cacheLeitura: 0.5, cacheEscrita: 6.25 },
  'claude-sonnet-5': { entrada: 2, saida: 10, cacheLeitura: 0.2, cacheEscrita: 2.5 },
  'claude-haiku-4-5': { entrada: 1, saida: 5, cacheLeitura: 0.1, cacheEscrita: 1.25 },
}

/** Modelo do assistente. Trocar aqui troca em toda a feature. */
export const MODELO = 'claude-opus-5'

/**
 * Preço por busca na web. `null` de propósito: a busca é cobrada à parte e o
 * valor não está espelhado aqui.
 *
 * Um número inventado num relatório de custo é pior que um número ausente — a
 * tela mostra a contagem de buscas e diz que elas não entram na estimativa,
 * em vez de somar um chute ao total. Preencher quando o valor for confirmado
 * na tabela oficial.
 */
export const PRECO_BUSCA_WEB: number | null = null

/** Dólar em real, para a tela. Estimativa declarada como tal — não é câmbio ao vivo. */
export const DOLAR = 5.4
