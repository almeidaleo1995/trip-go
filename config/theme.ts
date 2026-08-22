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
    /** Teal interativo: botão, link, estado ativo. 5.47:1 como texto e com branco em cima. */
    destaque: '#0F766E',
    destaqueEscuro: '#115E59',
    destaqueFraco: '#CCFBF1',
    destaqueTenue: '#EDFBF8',
    /** Teal profundo do painel de entrada. Base da arte, não da interface. */
    oceano: '#0B3B39',

    fundo: '#F6FAF9',
    cartao: '#FFFFFF',
    /** Superfície rebaixada: linhas agrupadas, painéis internos, notas. */
    superficie2: '#EFF5F4',
    borda: '#E3EAE9',
    bordaForte: '#CBD8D6',

    tinta: '#0F172A',
    tinta2: '#47575A', // 7.4:1
    tinta3: '#64757A', // 4.6:1 — piso; nada mais claro em texto
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
