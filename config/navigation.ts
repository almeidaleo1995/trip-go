// Menu do app. Ordem, rótulo, ícone e rota em um lugar só.
//
// `sempre: false` some quando a viagem não tem o dado (cruzeiro sem navio não
// vira aba vazia). `minimo` é o papel mínimo para ver o item — a barreira real
// está no servidor; isto é conveniência de interface.
import {
  Home,
  Map,
  Luggage,
  BedDouble,
  Plane,
  Ship,
  Globe,
  Wallet,
  FileText,
  ClipboardCheck,
  MessageSquare,
  Settings,
  type LucideIcon,
} from 'lucide-react'

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

export const navegacao: ItemMenu[] = [
  { href: '/dashboard', nome: 'Início', icone: Home, sempre: true, celular: true },
  { href: '/roteiros', nome: 'Roteiros', icone: Map, sempre: true, celular: true },
  { href: '/viagens', nome: 'Viagens', icone: Luggage, sempre: true, celular: true },
  { href: '/reservas', nome: 'Reservas', icone: BedDouble, sempre: true },
  { href: '/voos', nome: 'Voos', icone: Plane, sempre: true, celular: true },
  { href: '/cruzeiros', nome: 'Cruzeiros', icone: Ship, sempre: false },
  { href: '/cidades', nome: 'Cidades', icone: Globe, sempre: true },
  { href: '/despesas', nome: 'Despesas', icone: Wallet, sempre: true, minimo: 'editor' },
  { href: '/documentos', nome: 'Documentos', icone: FileText, sempre: true },
  { href: '/checklists', nome: 'Checklists', icone: ClipboardCheck, sempre: true },
  { href: '/mensagens', nome: 'Mensagens', icone: MessageSquare, sempre: true },
  { href: '/configuracoes', nome: 'Configurações', icone: Settings, sempre: true },
]

/** Rotas que exigem sessão. Lidas pelo proxy.ts e pelo guarda do servidor. */
export const rotasPrivadas = [
  '/dashboard',
  '/roteiros',
  '/viagens',
  '/reservas',
  '/voos',
  '/cruzeiros',
  '/cidades',
  '/despesas',
  '/documentos',
  '/checklists',
  '/mensagens',
  '/configuracoes',
]

/** Rotas de autenticação: quem já entrou é mandado para o dashboard. */
export const rotasPublicas = ['/login', '/register', '/esqueci-senha']

const ORDEM: Record<Papel, number> = { visualizador: 0, editor: 1, proprietario: 2 }

/** true quando `papel` alcança `minimo`. Usada na interface e no servidor. */
export function papelAlcanca(papel: Papel | null | undefined, minimo: Papel): boolean {
  if (!papel) return false
  return ORDEM[papel] >= ORDEM[minimo]
}
