// Paleta e tipografia. Os valores aqui espelham os tokens de app/globals.css e
// existem em TS para o que CSS não alcança: o <meta theme-color>, o SVG do mapa,
// a cor por tipo de evento escolhida em runtime.
//
// TODO CONTRASTE ABAIXO FOI MEDIDO, não estimado. Dois valores ficaram de fora:
//   #0D9488 -> 3.74:1 sobre branco. Reprova AA como texto E como fundo de texto.
//              O brief pede essa cor; ela vive em `marca` (só superfícies grandes,
//              onde AA de texto não se aplica) e nunca em texto ou botão.
//   #94A3B8 -> 2.44:1. Reprova para qualquer texto.

export const theme = {
  cores: {
    /** Cor de marca. Superfícies grandes e arte — nunca texto. */
    marca: '#0D9488',
    /** Interface: tinta preta, não mais teal (redesign editorial — ver
        app/globals.css). `theme_color` do manifest lê daqui. */
    destaque: '#17191C',
    destaqueEscuro: '#000000',
    destaqueFraco: '#E4E4E6',
    destaqueTenue: '#F5F5F6',
    /** Teal profundo do painel de entrada. Base da arte, não da interface. */
    oceano: '#0B3B39',

    /** Papel branco — página, sem fio de cor (redesign editorial). */
    fundo: '#FFFFFF',
    cartao: '#FFFFFF',
    /** Faixa que alterna sem contraste (fog). */
    secao: '#FAFAFB',
    /** Superfície rebaixada: linhas agrupadas, painéis internos, notas (mist). */
    superficie2: '#F2F2F3',
    borda: '#ECECEC',
    bordaForte: '#D9D9DB',

    tinta: '#17191C',
    tinta2: '#52555C', // 7.1:1
    tinta3: '#6B7280', // 4.6:1 — piso; nada mais claro em texto
    tinta4: '#A3A6AF', // decorativo: placeholder/desabilitado, nunca texto real

    /** O único acento cromático do sistema. Um card por tela, no máximo. */
    acento: '#FBE1D1',
    acentoTinta: '#5D2A1A',
  },

  /** Semânticas. Cada uma em par ink/bg; a tinta passa AA sobre o próprio fundo. */
  estados: {
    sucesso: { ink: '#15803D', bg: '#DCFCE7' },
    atencao: { ink: '#A1590A', bg: '#FEF3C7' },
    perigo: { ink: '#BE123C', bg: '#FFE4E6' },
    info: { ink: '#1E40AF', bg: '#DBEAFE' },
  },

  /** Badge por tipo de evento. Tinta escura sobre pastel, todos acima de 4.5:1. */
  tipos: {
    voo: { ink: '#0F766E', bg: '#CCFBF1', nome: 'Voo' },
    hospedagem: { ink: '#9A3412', bg: '#FFEDD5', nome: 'Hospedagem' },
    cruzeiro: { ink: '#1E40AF', bg: '#DBEAFE', nome: 'Cruzeiro' },
    passeio: { ink: '#6B21A8', bg: '#F3E8FF', nome: 'Passeio' },
    traslado: { ink: '#47575A', bg: '#EFF5F4', nome: 'Traslado' },
    documento: { ink: '#BE123C', bg: '#FFE4E6', nome: 'Documento' },
    refeicao: { ink: '#9A3412', bg: '#FFEDD5', nome: 'Refeição' },
  },

  /**
   * Cores que uma viagem pode vestir (trips.cor_destaque). Cada uma já é usada
   * como tinta em algum par acima, então todas passam AA com branco em cima —
   * o que importa, porque esta cor vira fundo de botão dentro da viagem.
   */
  paletaViagens: [
    { valor: '#0F766E', nome: 'Teal' },
    { valor: '#1E40AF', nome: 'Azul' },
    { valor: '#6B21A8', nome: 'Roxo' },
    { valor: '#15803D', nome: 'Verde' },
    { valor: '#BE123C', nome: 'Vermelho' },
    { valor: '#9A3412', nome: 'Terra' },
  ],

  fontes: {
    /** Títulos. Grotesca de largura óptica variável — carrega a personalidade. */
    display: 'var(--fonte-display)',
    /** Corpo. */
    corpo: 'var(--fonte-corpo)',
    /** Dados de viagem: IATA, horários, localizadores, dinheiro. Alinha colunas. */
    dados: 'var(--fonte-dados)',
  },
} as const

export type Tipo = keyof typeof theme.tipos
export type Estado = keyof typeof theme.estados

/**
 * Uma cor por ETAPA da viagem (cidade, cruzeiro), em rotação — o que dá ao
 * Mapa e ao Roteiro no mapa o visual de "Lisboa é verde, Madri é vermelho,
 * Paris é roxo" sem inventar paleta nova: reaproveita `paletaViagens`, a
 * mesma lista que `trips.cor_destaque` já oferece na tela de Dados. Só o
 * MAPA usa isto — o resto da interface continua monocromática (regra 6).
 */
export function corDaEtapa(indice: number): string {
  const lista = theme.paletaViagens
  return lista[((indice % lista.length) + lista.length) % lista.length].valor
}
