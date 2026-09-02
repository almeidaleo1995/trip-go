// Identidade do produto. Trocar o que está aqui transforma o TripGo em outro
// produto sem tocar em componente nenhum — é o requisito de "sistema editável".
//
// Regra: nenhuma string de marca, cor de marca ou link institucional vive fora
// deste arquivo e de theme.ts. Se você encontrar "TripGo" escrito em um
// componente, é bug.

export const siteConfig = {
  nome: 'TripGo',
  descricao: 'Planeje, organize e viva suas viagens.',

  /** Frase da tela de entrada. Uma linha por quebra visual. */
  manifesto: ['Planeje. Organize.', 'Viva experiências inesquecíveis.'],
  submanifesto: 'Sua próxima aventura começa aqui.',

  /** Saudação do Início. `{nome}` recebe o primeiro nome de quem entrou. */
  saudacao: 'Olá, {nome}!',
  subsaudacao: 'Que bom ter você por aqui. Vamos planejar a próxima aventura?',

  /**
   * "Dica do TripGo". Uma por dia, escolhida pela data — todo mundo vê a mesma
   * dica no mesmo dia, e ninguém precisa de servidor para isso.
   *
   * `aba` liga a dica à seção onde ela se resolve; sem `aba` a dica só informa.
   */
  dicas: [
    {
      texto: 'Baixe a viagem com internet antes de embarcar. Depois disso ela abre em modo avião.',
      acao: 'Ver documentos',
      aba: 'documentos',
    },
    {
      texto: 'Guarde o número do passaporte nos documentos: consulado e check-in pedem sempre.',
      acao: 'Ver documentos',
      aba: 'documentos',
    },
    {
      texto: 'Marque no checklist o que já resolveu. Cada pessoa tem a sua lista.',
      acao: 'Abrir checklist',
      aba: 'checklist',
    },
    {
      texto: 'Contatos de emergência funcionam sem sinal — preencha antes de viajar.',
      acao: 'Ver emergência',
      aba: 'emergencia',
    },
    {
      texto: 'Anote o localizador de cada voo. É o que a companhia pede quando algo muda.',
      acao: 'Ver voos',
      aba: 'voos',
    },
  ],

  contato: {
    email: 'ola@tripgo.app',
    suporte: '/configuracoes',
  },

  rodape: [
    { nome: 'Privacidade', href: '/privacidade' },
    { nome: 'Termos', href: '/termos' },
    { nome: 'Suporte', href: '/configuracoes' },
  ],

  /** Conta que o seed cria. Some da tela de login quando `mostrar` é false. */
  demo: {
    mostrar: false,
    email: 'demo@tripgo.com',
    senha: '123456',
    titulo: 'Comece com um exemplo',
    texto: 'Já deixamos um usuário de demonstração pronto para você explorar o app.',
  },

  /** Provedores sociais do login. `ativo: false` mostra o botão desabilitado com o
   *  motivo — melhor que um botão que não faz nada (§27 do brief). */
  social: [
    { id: 'google', nome: 'Google', ativo: false },
    { id: 'apple', nome: 'Apple', ativo: false },
  ],
} as const

export type SiteConfig = typeof siteConfig
