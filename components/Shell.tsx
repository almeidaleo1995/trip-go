'use client'

// Casca de navegação: barra lateral no desktop, tab bar embaixo no celular.
//
// A lista de abas é montada a partir dos DADOS, não fixa no código:
//   - Financeiro só existe para admin
//   - Cruzeiro só existe se a viagem tiver navio
// Aba que não existe não é escondida com CSS — o componente não monta.
//
// No celular a barra tem cinco lugares e onze abas. Em vez de rolar a barra na
// horizontal (que esconde metade do app atrás de um gesto que ninguém descobre),
// quatro abas ficam fixas pelo que se procura com pressa — onde estou, o que vem
// agora, meu voo, socorro — e o resto abre num painel "Mais".
import { useEffect, useState, type ReactNode } from 'react'
import {
  Home,
  CalendarClock,
  Map as IconeMapa,
  Plane,
  Ship,
  Building2,
  Globe,
  ClipboardCheck,
  Compass,
  FileText,
  LifeBuoy,
  Wallet,
  Database,
  LogOut,
  WifiOff,
  RefreshCw,
  MapPinned,
  MoreHorizontal,
  ArrowLeft,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useTrip } from './TripProvider.tsx'
import { AppModal, Avatar } from './ui.tsx'
import { faseDaViagem, formatarHora } from '@/lib/derive.ts'
import { registrarRecente } from '@/lib/recentes.ts'

export type AbaId =
  | 'inicio'
  | 'hoje'
  | 'roteiro'
  | 'voos'
  | 'cruzeiro'
  | 'hospedagem'
  | 'lugares'
  | 'preparacao'
  | 'checklist'
  | 'documentos'
  | 'documentacao'
  | 'emergencia'
  | 'financeiro'
  | 'dados'

type Aba = { id: AbaId; nome: string; icone: LucideIcon; grupo: string }

// A ordem aqui é a ordem na tela. Os grupos respondem "por que esta aba existe":
// viver a viagem, preparar-se para ela, administrá-la.
const ABAS: Aba[] = [
  { id: 'inicio', nome: 'Início', icone: Home, grupo: 'Viagem' },
  { id: 'hoje', nome: 'Hoje', icone: CalendarClock, grupo: 'Viagem' },
  { id: 'roteiro', nome: 'Roteiro', icone: IconeMapa, grupo: 'Viagem' },
  { id: 'voos', nome: 'Voos', icone: Plane, grupo: 'Viagem' },
  { id: 'cruzeiro', nome: 'Cruzeiro', icone: Ship, grupo: 'Viagem' },
  { id: 'hospedagem', nome: 'Hospedagem', icone: Building2, grupo: 'Viagem' },
  { id: 'lugares', nome: 'Cidades', icone: Globe, grupo: 'Explorar' },
  { id: 'preparacao', nome: 'Preparação', icone: Compass, grupo: 'Preparação' },
  { id: 'checklist', nome: 'Checklist', icone: ClipboardCheck, grupo: 'Preparação' },
  { id: 'documentos', nome: 'Documentos', icone: FileText, grupo: 'Preparação' },
  { id: 'emergencia', nome: 'Emergência', icone: LifeBuoy, grupo: 'Preparação' },
  { id: 'financeiro', nome: 'Financeiro', icone: Wallet, grupo: 'Gestão' },
  { id: 'dados', nome: 'Participantes e dados', icone: Database, grupo: 'Gestão' },
]

/**
 * Ids que NÃO são abas próprias: abrem uma aba existente já numa sub-visão.
 *
 * `documentacao` foi uma aba vizinha de `documentos` até virar a chave "Exigidos"
 * lá dentro. O id sobreviveu porque meia dúzia de botões espalhados pelo app
 * ("Resolver", "Abrir minha documentação") apontam para ele, e porque ele pode
 * estar salvo em `?aba=` de um link ou na sessão de quem já usava o app.
 */
const ALIAS: Partial<Record<AbaId, AbaId>> = { documentacao: 'documentos' }

/** A aba que de fato acende na navegação para um id — o alias, se houver. */
const abaDe = (a: AbaId): AbaId => ALIAS[a] ?? a

const conhecida = (a: string | null | undefined): a is AbaId =>
  Boolean(a) && (a! in ALIAS || ABAS.some((x) => x.id === a))

/**
 * As quatro que ficam na barra do celular. O resto vive em "Mais".
 *
 * `hoje` entra no lugar de `roteiro` DURANTE a viagem: andando por aí, o que se
 * procura com pressa é o compromisso de agora, não o planejamento do mês. Fora da
 * viagem ela continua alcançável pelo painel "Mais" — a tela sabe se explicar nas
 * fases `antes` e `depois`, só não merece um dos quatro lugares.
 */
const NO_CELULAR: AbaId[] = ['inicio', 'roteiro', 'voos', 'emergencia']
const NO_CELULAR_EM_VIAGEM: AbaId[] = ['inicio', 'hoje', 'voos', 'emergencia']

const CHAVE_ABA = 'viagem:aba'

export function Shell({
  aba,
  setAba,
  children,
}: {
  aba: AbaId
  setAba: (a: AbaId) => void
  children: ReactNode
}) {
  const { snapshot, papel, online, offlineOk, pendentes, ultimaSync, erro, sair } = useTrip()
  const [montado, setMontado] = useState(false)
  const [maisAberto, setMaisAberto] = useState(false)

  // A aba que ACENDE. Nem sempre é a que está no estado: `documentacao` acende
  // `documentos`, que é onde ela passou a morar.
  const ativa = abaDe(aba)

  const temCruzeiro = (snapshot?.cruzeiros?.length ?? 0) > 0
  // O Financeiro existe para todo mundo, mas com CONTEÚDO diferente: quem
  // administra vê a viagem inteira; um viajante comum vê só o que deve. Quem
  // decide isso é o servidor — o rótulo aqui só conta a verdade ao dono da tela.
  const financeiroCompleto = snapshot?.financeiro?.admin === true
  const visiveis = ABAS.filter((a) => {
    // "Dados" gerencia participantes e configurações — só o dono da viagem.
    if (a.id === 'dados') return papel === 'proprietario'
    if (a.id === 'cruzeiro') return temCruzeiro
    return true
  }).map((a) => {
    if (a.id === 'financeiro' && !financeiroCompleto) return { ...a, nome: 'Meus pagamentos' }
    return a
  })

  // A viagem está ACONTECENDO? Decide duas coisas: em que aba o app abre, e quais
  // quatro ficam na barra do celular (ver NO_CELULAR).
  const emViagem =
    faseDaViagem(
      new Date(),
      snapshot?.viagem?.data_partida ?? null,
      snapshot?.viagem?.data_retorno ?? null,
    ).fase === 'durante'

  // Restaura a aba escolhida (UI-06). Só depois de montar, para não divergir do
  // HTML renderizado no servidor.
  //
  // `?aba=` na URL ganha da aba salva: quem clicou em "Checklist de documentos"
  // no Início pediu aquela aba, não a que ele abriu por último. Lido de
  // window.location e não de useSearchParams para não exigir <Suspense> aqui.
  //
  // Sem nenhuma das duas E com a viagem acontecendo, o app abre em HOJE — a troca
  // de personalidade do app: antes da viagem a casa é o Início (o que falta
  // preparar); durante, é o compromisso de agora. Uma escolha explícita nunca é
  // sobrescrita. Cabe neste efeito porque o Shell só monta depois que a viagem
  // chegou (ver `App` em viagens/[id]/page.tsx), então a fase já é conhecida.
  useEffect(() => {
    setMontado(true)
    try {
      const pedida = new URLSearchParams(window.location.search).get('aba') as AbaId | null
      const salva = sessionStorage.getItem(CHAVE_ABA) as AbaId | null
      const alvo = [pedida, salva].find(conhecida)
      if (alvo) return setAba(alvo as AbaId)
    } catch {
      /* sessionStorage bloqueado: cai na regra da fase abaixo, sem drama */
    }
    if (emViagem) setAba('hoje')
    // `emViagem` é lido uma vez, na montagem: trocar de aba sozinho enquanto
    // alguém navega seria pior que abrir na aba errada uma vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setAba])

  useEffect(() => {
    if (!montado) return
    try {
      sessionStorage.setItem(CHAVE_ABA, aba)
    } catch {
      /* idem */
    }
  }, [aba, montado])

  // Aba que deixou de existir (virou viajante, ou a viagem perdeu o cruzeiro).
  useEffect(() => {
    if (montado && !visiveis.some((a) => a.id === ativa)) setAba('inicio')
  }, [ativa, visiveis, montado, setAba])

  const destaque = snapshot?.viagem?.cor_destaque ?? '#0F766E'
  const eu = snapshot?.eu?.usuario
  const atual = visiveis.find((a) => a.id === ativa)

  // Anota onde a pessoa esteve, para o Início oferecer o caminho de volta.
  const viagemId = String(snapshot?.viagem?.id ?? '')
  const viagemNome = String(snapshot?.viagem?.nome ?? '')
  const abaNome = atual?.nome ?? ''
  useEffect(() => {
    if (!montado || !viagemId || !abaNome) return
    registrarRecente({ viagemId, viagem: viagemNome, aba, nome: abaNome })
  }, [montado, viagemId, viagemNome, aba, abaNome])

  const fixas = emViagem ? NO_CELULAR_EM_VIAGEM : NO_CELULAR
  const naBarra = visiveis.filter((a) => fixas.includes(a.id))
  const emMais = visiveis.filter((a) => !fixas.includes(a.id))
  const abaOcultaAtiva = emMais.some((a) => a.id === ativa)

  // Agrupa preservando a ordem de ABAS.
  const grupos = new Map<string, Aba[]>()
  for (const a of visiveis) {
    if (!grupos.has(a.grupo)) grupos.set(a.grupo, [])
    grupos.get(a.grupo)!.push(a)
  }

  function ir(id: AbaId) {
    setAba(id)
    setMaisAberto(false)
  }

  return (
    <div style={{ ['--destaque' as string]: destaque }} className="min-h-dvh">
      {/* barra lateral — desktop */}
      <aside className="sem-impressao fixed top-0 left-0 hidden h-dvh w-64 flex-col border-r border-(--color-borda) bg-(--color-cartao) md:flex">
        <div className="flex items-center gap-2 border-b border-(--color-borda) px-5 py-4">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white"
            style={{ background: 'var(--destaque)' }}
          >
            <MapPinned size={17} strokeWidth={2} />
          </span>
          <span className="text-lg font-bold tracking-tight">TripGo</span>
        </div>

        {/* Onde estou: a viagem aberta, e a saída para trocar de viagem. */}
        <div className="border-b border-(--color-borda) px-5 py-3">
          <Link
            href="/viagens"
            className="-ml-1 mb-1.5 inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-[13px] text-(--color-tinta-3) transition-colors hover:text-(--destaque)"
          >
            <ArrowLeft size={14} /> Minhas viagens
          </Link>
          <p className="t-legenda">Viagem</p>
          <p className="mt-0.5 truncate leading-tight font-semibold">
            {snapshot?.viagem?.nome ?? '—'}
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Seções da viagem">
          {[...grupos.entries()].map(([grupo, abas]) => (
            <div key={grupo} className="mb-3">
              <p className="t-legenda px-3 pb-1.5">{grupo}</p>
              <div className="space-y-0.5">
                {abas.map((a) => (
                  <ItemLateral key={a.id} aba={a} ativo={a.id === ativa} onClick={() => ir(a.id)} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-(--color-borda) p-3">
          <Link
            href="/perfil"
            className="toque flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-(--color-superficie-2)"
          >
            <Avatar nome={String(eu?.nome ?? '?')} url={eu?.avatar_url} tamanho={30} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">
                {String(eu?.nome ?? 'Meu perfil')}
              </span>
              <span className="block text-[11px] text-(--color-tinta-3)">Ver perfil</span>
            </span>
          </Link>
          <button
            onClick={sair}
            className="toque mt-1 flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-sm text-(--color-tinta-2) transition-colors hover:bg-(--color-superficie-2)"
          >
            <LogOut size={18} strokeWidth={1.75} /> Sair
          </button>
        </div>
      </aside>

      <div className="md:pl-64">
        <Avisos
          online={online}
          offlineOk={offlineOk}
          pendentes={pendentes}
          ultimaSync={ultimaSync}
          erro={erro}
        />

        {/* cabeçalho do celular: diz a viagem e a seção, que a barra lateral diz no desktop */}
        <div className="sem-impressao sticky top-0 z-30 flex items-center gap-3 border-b border-(--color-borda) bg-(--color-cartao)/90 px-4 py-2.5 backdrop-blur md:hidden">
          <Link
            href="/viagens"
            aria-label="Voltar para minhas viagens"
            className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-(--color-tinta-2) hover:bg-(--color-superficie-2)"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] leading-tight font-semibold">
              {snapshot?.viagem?.nome ?? '—'}
            </p>
            <p className="truncate text-[11px] text-(--color-tinta-3)">{atual?.nome ?? ''}</p>
          </div>
          <Link
            href="/perfil"
            aria-label="Meu perfil"
            className="flex h-9 w-9 shrink-0 items-center justify-center"
          >
            <Avatar nome={String(eu?.nome ?? '?')} url={eu?.avatar_url} tamanho={30} />
          </Link>
        </div>

        {/* O painel financeiro é a única tela com duas colunas de conteúdo, e
            5xl aperta o painel lateral contra a tabela. As demais abas leem
            melhor na medida mais estreita. */}
        <main
          className={`mx-auto px-4 py-5 md:px-8 md:py-8 ${
            aba === 'financeiro' && financeiroCompleto ? 'max-w-7xl' : 'max-w-5xl'
          }`}
        >
          {children}
        </main>
      </div>

      {/* tab bar — celular. Quatro fixas + "Mais". */}
      <nav
        aria-label="Navegação principal"
        className="sem-impressao fixed inset-x-0 bottom-0 z-30 border-t border-(--color-borda) bg-(--color-cartao)/95 backdrop-blur md:hidden"
      >
        <div className="flex" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {naBarra.map((a) => (
            <BotaoBarra
              key={a.id}
              icone={a.icone}
              nome={a.nome}
              ativo={a.id === ativa}
              onClick={() => ir(a.id)}
            />
          ))}
          {emMais.length > 0 && (
            <BotaoBarra
              icone={MoreHorizontal}
              nome="Mais"
              ativo={abaOcultaAtiva}
              onClick={() => setMaisAberto(true)}
            />
          )}
        </div>
      </nav>

      {maisAberto && (
        <AppModal titulo="Ir para" tamanho="medio" aoFechar={() => setMaisAberto(false)}>
          <div className="grid grid-cols-3 gap-2 pb-2">
            {emMais.map((a) => {
              const Icone = a.icone
              const ativo = a.id === ativa
              return (
                <button
                  key={a.id}
                  onClick={() => ir(a.id)}
                  aria-current={ativo ? 'page' : undefined}
                  className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-(--color-borda) px-2 py-4 text-center transition-colors hover:bg-(--color-superficie-2)"
                  style={
                    ativo
                      ? {
                          background: 'var(--color-destaque-tenue)',
                          borderColor: 'var(--color-destaque-fraco)',
                        }
                      : undefined
                  }
                >
                  <Icone
                    size={20}
                    strokeWidth={1.75}
                    style={{ color: ativo ? 'var(--destaque)' : 'var(--color-tinta-2)' }}
                  />
                  <span className="text-[12px] leading-tight font-medium">{a.nome}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-2 border-t border-(--color-borda) pt-2">
            <Link
              href="/perfil"
              className="toque flex items-center gap-3 rounded-xl px-2 text-sm transition-colors hover:bg-(--color-superficie-2)"
            >
              <UserRound size={18} className="text-(--color-tinta-2)" /> Meu perfil
            </Link>
            <button
              onClick={sair}
              className="toque flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 text-sm text-(--color-tinta-2) transition-colors hover:bg-(--color-superficie-2)"
            >
              <LogOut size={18} /> Sair
            </button>
          </div>
        </AppModal>
      )}
    </div>
  )
}

function BotaoBarra({
  icone: Icone,
  nome,
  ativo,
  onClick,
}: {
  icone: LucideIcon
  nome: string
  ativo: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-current={ativo ? 'page' : undefined}
      className="toque relative flex flex-1 cursor-pointer flex-col items-center gap-1 px-1 py-2"
      style={{ color: ativo ? 'var(--destaque)' : 'var(--color-tinta-3)' }}
    >
      {ativo && (
        <span
          className="absolute top-0 h-0.5 w-8 rounded-full"
          style={{ background: 'var(--destaque)' }}
        />
      )}
      <Icone size={20} strokeWidth={ativo ? 2.25 : 1.75} />
      <span className={`text-[10px] leading-none ${ativo ? 'font-semibold' : ''}`}>{nome}</span>
    </button>
  )
}

function ItemLateral({ aba, ativo, onClick }: { aba: Aba; ativo: boolean; onClick: () => void }) {
  const Icone = aba.icone
  return (
    <button
      onClick={onClick}
      aria-current={ativo ? 'page' : undefined}
      className={`toque flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors ${
        ativo ? '' : 'hover:bg-(--color-superficie-2)'
      }`}
      style={
        ativo
          ? {
              background: 'var(--destaque)',
              color: '#fff',
              fontWeight: 600,
              boxShadow: 'var(--sombra-1)',
            }
          : { color: 'var(--color-tinta-2)' }
      }
    >
      <Icone size={18} strokeWidth={ativo ? 2.25 : 1.75} className="shrink-0" />
      <span className="truncate">{aba.nome}</span>
    </button>
  )
}

function Avisos({
  online,
  offlineOk,
  pendentes,
  ultimaSync,
  erro,
}: {
  online: boolean
  offlineOk: boolean
  pendentes: number
  ultimaSync: string | null
  erro: string | null
}) {
  const faixas: { texto: string; icone: ReactNode; tom: 'neutro' | 'alerta' }[] = []

  if (!online) {
    faixas.push({
      texto: ultimaSync ? `Offline · dados de ${formatarHora(ultimaSync.slice(0, 16))}` : 'Offline',
      icone: <WifiOff size={14} />,
      tom: 'neutro',
    })
  }
  if (pendentes > 0) {
    faixas.push({
      texto: `${pendentes} ${pendentes === 1 ? 'alteração pendente' : 'alterações pendentes'}`,
      icone: <RefreshCw size={14} />,
      tom: 'neutro',
    })
  }
  if (!offlineOk) {
    faixas.push({
      texto: 'Modo offline indisponível neste navegador',
      icone: <WifiOff size={14} />,
      tom: 'alerta',
    })
  }
  if (erro) faixas.push({ texto: erro, icone: <WifiOff size={14} />, tom: 'alerta' })

  if (faixas.length === 0) return null

  return (
    <div className="sem-impressao space-y-px">
      {faixas.map((f, i) => (
        <div
          key={i}
          className="flex items-center justify-center gap-2 px-4 py-1.5 text-[12px] font-medium"
          style={{
            background: f.tom === 'alerta' ? 'var(--color-perigo-bg)' : 'var(--color-superficie-2)',
            color: f.tom === 'alerta' ? 'var(--color-perigo-ink)' : 'var(--color-tinta-2)',
          }}
        >
          {f.icone}
          {f.texto}
        </div>
      ))}
    </div>
  )
}
