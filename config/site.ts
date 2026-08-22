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

  /** Saudação do dashboard. `{nome}` recebe o primeiro nome de quem entrou. */
  saudacao: 'Bem-vindo de volta, {nome}',
  subsaudacao: 'Aqui está um resumo da sua próxima aventura.',

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
