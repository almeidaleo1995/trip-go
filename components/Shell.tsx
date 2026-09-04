'use client'

// Casca de navegação: cabeçalho horizontal no desktop, tab bar embaixo no
// celular — o app deixou de parecer painel administrativo (barra lateral
// pesada) e passou a se ler como o topo de uma revista: logo, o nome da
// viagem como se fosse uma edição, e a navegação num fio só de ícones.
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
//
// No desktop o mesmo problema (13 abas, espaço finito) se resolve diferente:
// nove ficam no fio do cabeçalho — as que a viagem usa TODO DIA — e o resto
// (Checklist, Documentos, Emergência, Participantes) mora em "Mais", que abre
// o mesmo painel do celular.
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
  MoreHorizontal,
  ArrowLeft,
  ChevronDown,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useTrip } from './TripProvider.tsx'
import { AppModal, Avatar } from './ui.tsx'
import { faseDaViagem, formatarData, formatarHora } from '@/lib/derive.ts'
import { registrarRecente } from '@/lib/recentes.ts'
import { siteConfig } from '@/config/site.ts'

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

/**
 * As nove que ficam no fio do cabeçalho, no desktop — as que a viagem usa todo
 * dia. Diferente do celular, aqui Hoje e Roteiro ficam os dois sempre visíveis:
 * a tela é larga o bastante para não escolher entre "onde estou" e "o plano".
 */
const NO_TOPO: AbaId[] = [
  'inicio',
  'hoje',
  'roteiro',
  'voos',
  'cruzeiro',
  'hospedagem',
  'lugares',
  'preparacao',
  'financeiro',
]

const CHAVE_ABA = 'viagem:aba'

/** O breakpoint em que o cabeçalho de topo substitui a tab bar (xl, 1280px) —
    reativo a resize, para o painel "Mais" saber qual das duas listas mostrar
    sem depender de uma leitura de `window` congelada no render.

    Era `md` (768px), e abaixo de ~1280 as nove seções do fio não cabem ao lado
    do logo, do nome da viagem e do avatar: o `overflow-x-auto` do `<nav>` abria
    uma barra de rolagem horizontal DENTRO do cabeçalho, encostada no avatar.
    Navegação que exige rolar para ser vista não é navegação, e o fio não pode
    ficar centralizado enquanto rola. Entre 768 e 1280 a tab bar de baixo dá
    conta — cinco itens e o resto em "Mais", que é como ela foi desenhada.

    Mexer nesta constante é mexer nas quatro classes `xl:` do JSX abaixo: as duas
    metades TÊM que virar na mesma largura, senão existe uma faixa com as duas
    navegações ou com nenhuma. */
function useCabecalhoDeTopo(): boolean {
  const [desktop, setDesktop] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)')
    const aplicar = () => setDesktop(mq.matches)
    aplicar()
    mq.addEventListener('change', aplicar)
    return () => mq.removeEventListener('change', aplicar)
  }, [])
  return desktop
}

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
  const cabecalhoDeTopo = useCabecalhoDeTopo()

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
      const params = new URLSearchParams(window.location.search)
      const pedida = params.get('aba') as AbaId | null
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

  const noTopo = visiveis.filter((a) => NO_TOPO.includes(a.id))
  const foraDoTopo = visiveis.filter((a) => !NO_TOPO.includes(a.id))
  const abaForaDoTopoAtiva = foraDoTopo.some((a) => a.id === ativa)

  function ir(id: AbaId) {
    setAba(id)
    setMaisAberto(false)
  }

  const nomeViagem = String(snapshot?.viagem?.nome ?? '—')
  const datas =
    [snapshot?.viagem?.data_partida, snapshot?.viagem?.data_retorno]
      .filter(Boolean)
      .map((d) => formatarData(String(d), { day: '2-digit', month: 'short' }))
      .join(' — ') || null

  return (
    <div className="min-h-dvh bg-(--color-fundo)">
      {/* cabeçalho — desktop. Editorial, transparente de fio: logo, a edição
          (o nome e as datas da viagem) e a navegação num traço só. */}
      <header className="sem-impressao fixed inset-x-0 top-0 z-40 hidden border-b border-(--color-borda) bg-(--color-cartao)/95 backdrop-blur xl:block">
        {/* UM GRUPO SÓ, centrado — não três blocos empurrados para os cantos.
            O `<nav>` era `flex-1 justify-center`, então num monitor largo sobrava
            um vão de uns 200px de cada lado dele: o nome da viagem ficava à
            esquerda, o fio no meio e o avatar colado na borda direita, como se
            fossem três coisas sem relação. São a mesma coisa — onde estou, em que
            viagem, e eu —, e ficam juntas. `justify-center` no lugar do `flex-1`
            é o que faz o conjunto encolher em vez de esticar. */}
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-center gap-5 px-6">
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ background: 'var(--color-tinta)' }}
              aria-hidden
            >
              T
            </span>
            <span className="t-secao !text-[19px]">{siteConfig.nome}</span>
          </Link>

          <Link
            href="/viagens"
            className="group flex min-w-0 shrink-0 items-center gap-1 rounded-xl px-1 py-1 text-left"
            title="Trocar de viagem"
          >
            <span className="min-w-0">
              <span className="flex items-center gap-1">
                <span className="max-w-[16rem] truncate text-[14px] font-semibold">
                  {nomeViagem}
                </span>
                <ChevronDown
                  size={14}
                  className="shrink-0 text-(--color-tinta-3) transition-colors group-hover:text-(--color-tinta)"
                  aria-hidden
                />
              </span>
              {datas && (
                <span className="tab-num block text-[11px] text-(--color-tinta-3)">{datas}</span>
              )}
            </span>
          </Link>

          {/* SEM rolagem: o fio ou cabe inteiro, ou o cabeçalho não é a
              navegação daquela largura (abaixo de xl a tab bar assume).
              `overflow-x-auto` aqui abria uma barra de rolagem horizontal dentro
              do cabeçalho, encostada no avatar. E sem `flex-1`: era ele que
              abria os vãos: o fio esticava para ocupar tudo que sobrava e
              centrava os botões dentro de si mesmo, afastando o nome da viagem
              de "Início" e o avatar de "Mais". */}
          <nav aria-label="Seções da viagem" className="flex min-w-0 items-center gap-0.5">
            {noTopo.map((a) => (
              <ItemTopo key={a.id} aba={a} ativo={a.id === ativa} onClick={() => ir(a.id)} />
            ))}
            {foraDoTopo.length > 0 && (
              <button
                onClick={() => setMaisAberto(true)}
                aria-current={abaForaDoTopoAtiva ? 'page' : undefined}
                className="toque flex shrink-0 cursor-pointer flex-col items-center gap-1 rounded-xl px-2.5 py-1.5"
                style={{
                  color: abaForaDoTopoAtiva ? 'var(--color-tinta)' : 'var(--color-tinta-3)',
                }}
              >
                <MoreHorizontal size={19} strokeWidth={abaForaDoTopoAtiva ? 2.25 : 1.75} />
                <span className="text-[11px] leading-none font-medium">Mais</span>
              </button>
            )}
          </nav>

          <Link
            href="/perfil"
            className="toque flex shrink-0 items-center gap-2 rounded-full pl-1"
            aria-label="Meu perfil"
          >
            <Avatar nome={String(eu?.nome ?? '?')} url={eu?.avatar_url} tamanho={32} />
          </Link>
        </div>
      </header>

      <div className="xl:pt-16">
        <Avisos
          online={online}
          offlineOk={offlineOk}
          pendentes={pendentes}
          ultimaSync={ultimaSync}
          erro={erro}
        />

        {/* cabeçalho do celular: diz a viagem e a seção, que o topo diz no desktop */}
        <div className="sem-impressao sticky top-0 z-30 flex items-center gap-3 border-b border-(--color-borda) bg-(--color-cartao)/90 px-4 py-2.5 backdrop-blur xl:hidden">
          <Link
            href="/viagens"
            aria-label="Voltar para minhas viagens"
            className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-(--color-tinta-2) hover:bg-(--color-superficie-2)"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] leading-tight font-semibold">{nomeViagem}</p>
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

        {/* A largura é por ABA, e cada medida tem um motivo.

            `max-w-5xl` (1024px) é a medida de LEITURA: uma coluna de texto e
            cartões, que a partir daí só ficaria pior — linha longa demais para
            os olhos acompanharem.

            O Financeiro (`7xl`) e o Roteiro (`[1600px]`) não leem em uma coluna:
            os dois têm painel lateral, e num monitor de 2560 ou 3440 o `5xl`
            deixava o conteúdo numa tira central com meia tela de cinza morto de
            cada lado. O teto existe do mesmo jeito — nada cresce sem fim, e
            acima dele a página fica centralizada — só que largo o bastante para
            o mapa e a timeline caberem lado a lado sem se espremer. */}
        <main
          className={`mx-auto px-4 py-5 lg:px-8 lg:py-8 ${
            aba === 'roteiro'
              ? 'max-w-[1600px]'
              : aba === 'financeiro' && financeiroCompleto
                ? 'max-w-7xl'
                : 'max-w-5xl'
          }`}
        >
          {/* `key={aba}` reinicia a animação a cada troca — sem ela o wrapper
              não remonta, e o fade não toca de novo quando só o conteúdo
              embaixo dele muda. Só opacidade, ~140ms: uma pista de que a
              tela virou, não um atraso para quem troca de aba o dia todo. */}
          <div key={aba} className="anim-surgir">
            {children}
          </div>
        </main>
      </div>

      {/* tab bar — celular. Quatro fixas + "Mais". */}
      <nav
        aria-label="Navegação principal"
        className="sem-impressao fixed inset-x-0 bottom-0 z-30 border-t border-(--color-borda) bg-(--color-cartao)/95 backdrop-blur xl:hidden"
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
            {/* No desktop "Mais" mostra tudo que não está no fio do cabeçalho;
                no celular, tudo que não está na barra de baixo. */}
            {(cabecalhoDeTopo ? foraDoTopo : emMais).map((a) => {
              const Icone = a.icone
              const ativo = a.id === ativa
              return (
                <button
                  key={a.id}
                  onClick={() => ir(a.id)}
                  aria-current={ativo ? 'page' : undefined}
                  className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl px-2 py-4 text-center transition-colors hover:bg-(--color-superficie-2)"
                  style={ativo ? { background: 'var(--color-superficie-2)' } : undefined}
                >
                  <Icone
                    size={20}
                    strokeWidth={1.75}
                    style={{ color: ativo ? 'var(--color-tinta)' : 'var(--color-tinta-2)' }}
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

/** Um item do fio de navegação do cabeçalho — ícone fino em cima, rótulo
    embaixo, um traço de destaque quando ativo. Nenhuma caixa ao redor: a
    barra é silenciosa, não uma fileira de botões (regra 14 do redesign). */
function ItemTopo({ aba, ativo, onClick }: { aba: Aba; ativo: boolean; onClick: () => void }) {
  const Icone = aba.icone
  return (
    <button
      onClick={onClick}
      aria-current={ativo ? 'page' : undefined}
      className="toque relative flex shrink-0 cursor-pointer flex-col items-center gap-1 rounded-xl px-2.5 py-1.5 transition-colors"
      style={{ color: ativo ? 'var(--color-tinta)' : 'var(--color-tinta-3)' }}
    >
      <Icone size={19} strokeWidth={ativo ? 2.25 : 1.75} />
      <span
        className={`text-[11px] leading-none whitespace-nowrap ${ativo ? 'font-semibold' : 'font-medium'}`}
      >
        {aba.nome}
      </span>
      {ativo && (
        <span
          className="absolute -bottom-[1px] h-[2px] w-5 rounded-full"
          style={{ background: 'var(--destaque)' }}
          aria-hidden
        />
      )}
    </button>
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
      style={{ color: ativo ? 'var(--color-tinta)' : 'var(--color-tinta-3)' }}
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
