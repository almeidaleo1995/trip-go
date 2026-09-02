// Menu do app. Ordem, rótulo, ícone e rota em um lugar só.
//
// `sempre: false` some quando a viagem não tem o dado (cruzeiro sem navio não
// vira aba vazia). `minimo` é o papel mínimo para ver o item — a barreira real
// está no servidor; isto é conveniência de interface.
import { Home, Luggage, UserRound, type LucideIcon } from 'lucide-react'

export type Papel = 'proprietario' | 'editor' | 'visualizador'

export type ItemMenu = {
  href: string
  nome: string
  icone: LucideIcon
  /** false = só aparece quando a viagem tem esse tipo de dado. */
  sempre?: boolean
  minimo?: Papel
  /** Aparece na barra inferior do celular. Cabem cinco. */
  celular?: boolean
}

// O conteúdo de cada viagem (roteiro, voos, financeiro...) não tem rota própria
// aqui: vive dentro de /viagens/:id, como abas do Shell — este menu só cobre as
// duas telas que existem fora de uma viagem especifica.
export const navegacao: ItemMenu[] = [
  { href: '/dashboard', nome: 'Início', icone: Home, sempre: true, celular: true },
  { href: '/viagens', nome: 'Minhas viagens', icone: Luggage, sempre: true, celular: true },
  { href: '/perfil', nome: 'Perfil', icone: UserRound, sempre: true, celular: true },
]

/** Rotas que exigem sessão. Lidas pelo proxy.ts e pelo guarda do servidor. */
export const rotasPrivadas = ['/dashboard', '/viagens', '/perfil']

/**
 * Rotas de autenticação: quem já entrou é mandado para o dashboard.
 *
 * Só entra aqui caminho que EXISTE. Um nome sem página não abre um buraco, mas
 * ensina a ler esta lista como intenção em vez de como fato — e a próxima
 * entrada morta pode ser uma que devia estar em `rotasPrivadas`.
 */
export const rotasPublicas = ['/login', '/register']

const ORDEM: Record<Papel, number> = { visualizador: 0, editor: 1, proprietario: 2 }

/** true quando `papel` alcança `minimo`. Usada na interface e no servidor. */
export function papelAlcanca(papel: Papel | null | undefined, minimo: Papel): boolean {
  if (!papel) return false
  return ORDEM[papel] >= ORDEM[minimo]
}
