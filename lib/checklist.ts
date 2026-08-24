// Resolucao e deduplicacao de sugestoes de checklist vindas da skill
// viagem-para-json. Zero I/O, zero React, zero rede - so entra dado e sai dado,
// no mesmo espirito de lib/derive.ts.

const MARCAS_DIACRITICAS = /[̀-ͯ]/g

/**
 * Normaliza um titulo para comparacao: minusculo, sem acento, sem espaco nas
 * pontas, espacos internos colapsados. Base da deduplicacao (CHK-14) -
 * "Passaporte  válido" e "passaporte valido" tem que colidir.
 */
export function normalizarTitulo(titulo: string): string {
  return titulo
    .normalize('NFD')
    .replace(MARCAS_DIACRITICAS, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}
