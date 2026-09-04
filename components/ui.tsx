'use client'

// Design system do TripGo.
//
// Estes primitivos existem para que "modal", "estado vazio", "botão perigo" e
// "aviso de sucesso" sejam decididos UMA vez — não catorze vezes com catorze
// aparências levemente diferentes. Toda cor vem dos tokens de app/globals.css;
// nenhum hexadecimal é escrito aqui.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Inbox,
  Info,
  MapPinned,
  X,
  XCircle,
} from 'lucide-react'
import { siteConfig } from '@/config/site.ts'

// ================================================================ movimento

/** `true` quando a pessoa pediu menos movimento — a saída então acontece sem
    atraso artificial em vez de manter um elemento invisível "vivo" por nada. */
const prefereMenosMovimento = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/**
 * Anima a saída de um painel antes de desmontar.
 *
 * O pai continua no controle de quando o componente existe (o padrão do app é
 * `{aberto && <X aoFechar={...}/>}`) — este hook só atrasa a chamada real de
 * `aoFechar` pelo tempo da animação, então o elemento ainda está no DOM
 * enquanto ela toca. Usado por `AppModal` e por qualquer painel de tela cheia
 * que siga o mesmo formato (ver `PainelEndereco` em tabs/Hoje.tsx).
 */
export function useFechamentoAnimado(aoFechar: () => void, duracaoMs = 130) {
  const [fechando, setFechando] = useState(false)
  const disparado = useRef(false)
  const pedirFechar = useCallback(() => {
    if (disparado.current) return
    disparado.current = true
    setFechando(true)
    setTimeout(aoFechar, prefereMenosMovimento() ? 0 : duracaoMs)
  }, [aoFechar, duracaoMs])
  return { fechando, pedirFechar }
}

// ================================================================ carregamento

/** Tela de carregamento. Um avião percorrendo a rota — não um spinner genérico. */
export function Carregando({ texto = 'Preparando sua viagem…' }: { texto?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-(--color-fundo) p-6">
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
          style={{ background: 'var(--destaque)' }}
        >
          <MapPinned size={19} strokeWidth={2} />
        </span>
        <span className="text-xl font-bold tracking-tight">{siteConfig.nome}</span>
      </div>

      <svg viewBox="0 0 240 60" className="h-14 w-60" role="img" aria-label={texto}>
        <path
          id="rota-carregando"
          d="M16 46 Q 80 4 120 30 T 224 14"
          fill="none"
          stroke="var(--color-borda-forte)"
          strokeWidth="2"
          strokeDasharray="5 4"
          strokeLinecap="round"
        />
        <circle cx="16" cy="46" r="4" fill="var(--destaque)" />
        <circle cx="224" cy="14" r="4" fill="var(--destaque)" opacity="0.35" />
        <g>
          <circle r="5" fill="var(--destaque)">
            <animateMotion dur="1.8s" repeatCount="indefinite" rotate="auto">
              <mpath href="#rota-carregando" />
            </animateMotion>
          </circle>
        </g>
      </svg>

      <p className="t-aux">{texto}</p>
    </div>
  )
}

/** Bloco cinza com a forma do conteúdo que ainda não chegou. */
export function Esqueleto({ className = '' }: { className?: string }) {
  return <div className={`esqueleto ${className}`} aria-hidden />
}

/** Esqueleto de uma lista de cartões — o que as abas mostram enquanto carregam. */
export function EsqueletoLista({ linhas = 3 }: { linhas?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Carregando">
      {Array.from({ length: linhas }).map((_, i) => (
        <div key={i} className="rounded-3xl bg-(--color-superficie-2) p-4">
          <Esqueleto className="h-4 w-1/3" />
          <Esqueleto className="mt-2.5 h-3 w-2/3" />
          <Esqueleto className="mt-2 h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
}

// ================================================================ cabeçalhos

/**
 * Cabeçalho de título, subtítulo opcional e a ação principal.
 *
 * `nivel` existe porque uma tela pode empilhar duas matérias grandes — o cofre e
 * a documentação exigida moram na mesma página — e duas <h1> na mesma página são
 * um leitor de tela dizendo "título" duas vezes sem dizer de quê. A ESTRUTURA
 * acompanha o tamanho: nível 2 é <h2>, não uma <h1> menor.
 */
export function Titulo({
  children,
  chapeu,
  descricao,
  acao,
  nivel = 1,
}: {
  children: ReactNode
  chapeu?: string
  descricao?: ReactNode
  acao?: ReactNode
  nivel?: 1 | 2
}) {
  const H = nivel === 1 ? 'h1' : 'h2'
  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-3 ${
        nivel === 1 ? 'mb-5' : 'mb-4'
      }`}
    >
      <div className="min-w-0">
        {chapeu && <p className="t-legenda mb-1.5">{chapeu}</p>}
        <H className={nivel === 1 ? 't-pagina' : 't-secao'}>{children}</H>
        {descricao && <p className="t-aux mt-1">{descricao}</p>}
      </div>
      {/* `shrink-0` existe para os botões não virarem reticências quando o título
          é longo. Mas sozinho ele estoura a PÁGINA quando as próprias ações são
          mais largas que a tela (dois botões de texto em 320px): o bloco se
          recusa a encolher e empurra uma barra de rolagem horizontal para fora.
          `flex-wrap` + `max-w-full` mantêm a intenção e resolvem: em vez de
          transbordar, as ações caem para a linha de baixo. */}
      {acao && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{acao}</div>}
    </div>
  )
}

/** Rótulo de seção. Curto, em caixa alta, cinza — nunca disputa com o título. */
export function Rotulo({ children }: { children: ReactNode }) {
  return <p className="t-legenda">{children}</p>
}

/** Cabeçalho de bloco dentro de uma página: rótulo à esquerda, ação à direita. */
export function CabecalhoSecao({ titulo, acao }: { titulo: string; acao?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-3">
      <Rotulo>{titulo}</Rotulo>
      {acao}
    </div>
  )
}

// ================================================================ cartão

// `padrao` é o card do sistema (regra 9 do redesign): mist, sem borda, sem
// sombra — a superfície que se levanta do papel branco só pela cor. `elevado`
// é o único que flutua de verdade (mapa, artefato de produto) e por isso é o
// único com sombra e borda de verdade. Os tons semânticos continuam existindo
// para alerta pequeno e pontual — não para "card azul"/"card verde" do dia a
// dia (regra 6): eles são a EXCEÇÃO deliberada, não o padrão.
type TomCartao = 'padrao' | 'elevado' | 'destaque' | 'sucesso' | 'atencao' | 'perigo' | 'info'

const FUNDO_CARTAO: Record<TomCartao, { background: string; borderColor: string }> = {
  padrao: { background: 'var(--color-superficie-2)', borderColor: 'transparent' },
  elevado: { background: 'var(--color-cartao)', borderColor: 'var(--color-borda)' },
  destaque: {
    background: 'var(--color-destaque-tenue)',
    borderColor: 'var(--color-destaque-fraco)',
  },
  sucesso: { background: 'var(--color-sucesso-bg)', borderColor: 'transparent' },
  atencao: { background: 'var(--color-atencao-bg)', borderColor: 'transparent' },
  perigo: { background: 'var(--color-perigo-bg)', borderColor: 'transparent' },
  info: { background: 'var(--color-info-bg)', borderColor: 'transparent' },
}

export function Cartao({
  children,
  className = '',
  style,
  tom = 'padrao',
  onClick,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
  tom?: TomCartao
  onClick?: () => void
}) {
  const base = 'quebra-evitar rounded-3xl border p-4'
  const estilo: CSSProperties = {
    ...FUNDO_CARTAO[tom],
    boxShadow: tom === 'elevado' ? 'var(--sombra-1)' : 'none',
    ...style,
  }

  return onClick ? (
    <button
      onClick={onClick}
      style={estilo}
      className={`${base} w-full cursor-pointer text-left transition-[filter,transform] hover:brightness-[0.97] active:scale-[0.99] ${className}`}
    >
      {children}
    </button>
  ) : (
    <div style={estilo} className={`${base} ${className}`}>
      {children}
    </div>
  )
}

/** Estado vazio. Toda aba usa este — nenhuma quebra por falta de dado. */
export function Vazio({
  titulo,
  texto,
  acao,
}: {
  titulo: string
  texto: string
  acao?: ReactNode
}) {
  return (
    <div className="rounded-3xl border border-dashed border-(--color-borda-forte) px-6 py-12 text-center">
      <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-(--color-superficie-2)">
        <Inbox className="text-(--color-tinta-3)" size={20} strokeWidth={1.75} />
      </span>
      <p className="t-cartao">{titulo}</p>
      <p className="t-aux mx-auto mt-1 max-w-sm">{texto}</p>
      {acao && <div className="mt-4 flex justify-center">{acao}</div>}
    </div>
  )
}

/** Falha de carregamento, com o caminho de volta. Nunca um beco sem saída. */
export function Falha({ texto, aoTentar }: { texto: string; aoTentar?: () => void }) {
  return (
    <div className="rounded-3xl bg-(--color-perigo-bg) px-6 py-8 text-center">
      <AlertTriangle className="mx-auto mb-2 text-(--color-perigo-ink)" size={20} />
      <p className="t-corpo font-medium text-(--color-perigo-ink)">{texto}</p>
      {aoTentar && (
        <div className="mt-3 flex justify-center">
          <Botao variante="secundario" onClick={aoTentar}>
            Tentar de novo
          </Botao>
        </div>
      )}
    </div>
  )
}

// ================================================================ badge

/** Exportados para o roteiro colorir o círculo do ícone da timeline com o mesmo par tom/tinta do badge. */
export const TONS: Record<string, { bg: string; ink: string }> = {
  voo: { bg: 'var(--color-voo-bg)', ink: 'var(--color-voo-ink)' },
  hospedagem: { bg: 'var(--color-hosp-bg)', ink: 'var(--color-hosp-ink)' },
  cruzeiro: { bg: 'var(--color-cruz-bg)', ink: 'var(--color-cruz-ink)' },
  passeio: { bg: 'var(--color-pass-bg)', ink: 'var(--color-pass-ink)' },
  traslado: { bg: 'var(--color-superficie-2)', ink: 'var(--color-tinta-2)' },
  documento: { bg: 'var(--color-perigo-bg)', ink: 'var(--color-perigo-ink)' },
  refeicao: { bg: 'var(--color-hosp-bg)', ink: 'var(--color-hosp-ink)' },
  // estados, não tipos de evento
  destaque: { bg: 'var(--color-destaque-fraco)', ink: 'var(--destaque)' },
  sucesso: { bg: 'var(--color-sucesso-bg)', ink: 'var(--color-sucesso-ink)' },
  atencao: { bg: 'var(--color-atencao-bg)', ink: 'var(--color-atencao-ink)' },
  perigo: { bg: 'var(--color-perigo-bg)', ink: 'var(--color-perigo-ink)' },
  info: { bg: 'var(--color-info-bg)', ink: 'var(--color-info-ink)' },
  neutro: { bg: 'var(--color-superficie-2)', ink: 'var(--color-tinta-2)' },
}

/**
 * Tipo novo do roteiro -> par de cor de um tipo antigo.
 *
 * Dezenove tipos de item não pedem dezenove paletas; pedem que trem e ônibus
 * leiam como "deslocamento" e que restaurante leia como "comida". Sem este
 * mapa, cada tipo novo cairia no cinza neutro e a linha do tempo perderia a
 * única pista de cor que ela tem.
 */
export const ALIAS_TOM: Record<string, string> = {
  trem: 'traslado',
  onibus: 'traslado',
  caminhada: 'traslado',
  local: 'passeio',
  ponto: 'passeio',
  compras: 'passeio',
  evento: 'passeio',
  restaurante: 'refeicao',
  tarefa: 'info',
  compromisso: 'info',
  dica: 'sucesso',
  observacao: 'neutro',
}

const NOMES: Record<string, string> = {
  voo: 'Voo',
  trem: 'Trem',
  onibus: 'Ônibus',
  traslado: 'Traslado',
  caminhada: 'Caminhada',
  cruzeiro: 'Cruzeiro',
  hospedagem: 'Hospedagem',
  local: 'Local',
  passeio: 'Passeio',
  ponto: 'Ponto turístico',
  restaurante: 'Restaurante',
  refeicao: 'Refeição',
  compras: 'Compras',
  evento: 'Evento',
  tarefa: 'Tarefa',
  compromisso: 'Compromisso',
  dica: 'Dica',
  observacao: 'Observação',
  documento: 'Documento',
}

/**
 * Etiqueta de estado. `icone` existe porque cor sozinha não é informação: quem
 * não distingue vermelho de verde precisa de um símbolo ou de uma palavra.
 */
export function Badge({
  tipo,
  texto,
  icone,
}: {
  tipo?: string
  texto?: string
  icone?: ReactNode
}) {
  const chave = tipo ?? ''
  const tom = TONS[chave] ?? TONS[ALIAS_TOM[chave] ?? ''] ?? TONS.neutro
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap"
      style={{ background: tom.bg, color: tom.ink }}
    >
      {icone}
      {texto ?? NOMES[tipo ?? ''] ?? tipo}
    </span>
  )
}

// ================================================================ botão

type Variante = 'principal' | 'secundario' | 'contorno' | 'fantasma' | 'perigo'

// Três famílias (regra 13 do redesign): `principal` é tinta sólida — a única
// cor primária do sistema é preta, em qualquer viagem; `secundario` é o par
// ghost da mesma pílula; `fantasma` é o link textual sem contêiner.
// `contorno`/`perigo` sobrevivem como variantes pragmáticas (acento da viagem,
// ação destrutiva) — não substituem as três, complementam onde elas não bastam.
const ESTILO: Record<Variante, CSSProperties> = {
  principal: {
    background: 'var(--color-tinta)',
    color: '#fff',
    border: '1px solid transparent',
  },
  secundario: {
    background: 'transparent',
    color: 'var(--color-tinta)',
    border: '1px solid var(--color-tinta)',
  },
  contorno: {
    background: 'transparent',
    color: 'var(--destaque)',
    border: '1px solid var(--destaque)',
  },
  fantasma: {
    background: 'transparent',
    color: 'var(--color-tinta-2)',
    border: '1px solid transparent',
  },
  perigo: {
    background: 'var(--color-perigo-ink)',
    color: '#fff',
    border: '1px solid transparent',
  },
}

export function Botao({
  children,
  onClick,
  variante = 'principal',
  tipo,
  tamanho = 'normal',
  carregando,
  desabilitado,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  variante?: Variante
  tipo?: 'button' | 'submit'
  tamanho?: 'normal' | 'pequeno'
  carregando?: boolean
  desabilitado?: boolean
  className?: string
}) {
  const inativo = Boolean(desabilitado || carregando)
  return (
    <button
      type={tipo ?? 'button'}
      onClick={onClick}
      disabled={inativo}
      aria-busy={carregando || undefined}
      style={{ ...ESTILO[variante], transition: 'all var(--transicao)' }}
      className={`${
        tamanho === 'pequeno' ? 'min-h-9 px-4 text-[13px]' : 'toque px-5 text-sm'
      } inline-flex cursor-pointer items-center justify-center gap-2 rounded-full font-medium disabled:cursor-not-allowed disabled:opacity-55 not-disabled:hover:brightness-95 not-disabled:active:scale-[0.97] ${className}`}
    >
      {carregando && <Girando />}
      {children}
    </button>
  )
}

/** Botão só de ícone. `rotulo` vira aria-label — ícone nunca vai sozinho. */
export function BotaoIcone({
  children,
  rotulo,
  onClick,
  tom = 'neutro',
  desabilitado,
}: {
  children: ReactNode
  rotulo: string
  onClick?: () => void
  /** `sobre-cor` é para quando o botão fica em cima de uma faixa colorida —
      ali o cinza do tom neutro some no fundo. */
  tom?: 'neutro' | 'perigo' | 'sobre-cor'
  desabilitado?: boolean
}) {
  const estilos = {
    neutro: 'text-(--color-tinta-2) hover:bg-(--color-superficie-2)',
    perigo: 'text-(--color-tinta-3) hover:bg-(--color-perigo-bg) hover:text-(--color-perigo-ink)',
    'sobre-cor': 'bg-white/90 text-(--color-tinta) shadow-sm hover:bg-white',
  }[tom]

  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      disabled={desabilitado}
      onClick={onClick}
      style={{ transition: 'all var(--transicao)' }}
      // 36x36 é o tamanho VISUAL — encolher a linha para caber 44px de botão em
      // toda listagem densa seria pior. A área de TOQUE vai a 44x44 pelo
      // pseudo-elemento, que não ocupa espaço no layout: o dedo acerta os 44 do
      // `.toque` sem que o desenho mude um pixel.
      className={`relative flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-2xl after:absolute after:-inset-1 after:content-[''] not-disabled:active:scale-90 disabled:cursor-not-allowed disabled:opacity-50 ${estilos}`}
    >
      {children}
    </button>
  )
}

export function Girando() {
  return (
    <span
      className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden
    />
  )
}

/** Copiar sem depender de rede nem de permissão especial. */
/**
 * Copia um valor com um toque. Duas formas, porque o que se copia num app de
 * viagem é de duas naturezas: `codigo` para localizador e assento — curto, lido
 * em voz alta na fila do check-in, merece tabular e negrito — e `texto` para
 * endereço, que é longo, entra cortado na linha e é lido pelo aplicativo de
 * carro, não pela pessoa.
 */
export function Copiar({
  valor,
  rotulo,
  variante = 'codigo',
}: {
  valor: string
  rotulo?: string
  variante?: 'codigo' | 'texto'
}) {
  const [feito, setFeito] = useState(false)
  const texto = variante === 'texto'
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(valor)
          setFeito(true)
          setTimeout(() => setFeito(false), 1600)
        } catch {
          /* contexto sem clipboard: o valor continua visível na tela */
        }
      }}
      aria-label={feito ? 'Copiado' : `Copiar ${rotulo ?? valor}`}
      // Endereço cortado precisa do texto inteiro em algum lugar alcançável: o
      // `title` serve o mouse, o `aria-label` serve o leitor de tela, e a cópia
      // leva o valor completo de qualquer jeito.
      title={texto ? valor : undefined}
      className={
        texto
          ? 'flex min-h-8 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-lg bg-(--color-superficie-2) px-2 text-left text-[12px] text-(--color-tinta-2) transition-colors hover:bg-(--color-destaque-tenue)'
          : 'toque inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 text-sm transition-colors hover:bg-(--color-superficie-2)'
      }
    >
      <span className={texto ? 'truncate' : 'tab-num font-semibold tracking-wider'}>{valor}</span>
      {feito ? (
        <Check
          size={14}
          className={`shrink-0 text-(--color-sucesso-ink) ${texto ? 'ml-auto' : ''}`}
        />
      ) : (
        <Copy size={14} className={`shrink-0 text-(--color-tinta-3) ${texto ? 'ml-auto' : ''}`} />
      )}
    </button>
  )
}

// ================================================================ formulário

export const CLASSE_CAMPO =
  'w-full rounded-2xl border border-(--color-borda-forte) bg-(--color-cartao) px-3.5 py-2.5 text-[15px] text-(--color-tinta) outline-none transition-colors placeholder:text-(--color-tinta-4) focus:border-(--destaque) focus:ring-2 focus:ring-(--color-destaque-fraco) disabled:cursor-not-allowed disabled:bg-(--color-superficie-2) disabled:text-(--color-tinta-3)'

/**
 * Campo com rótulo, dica e erro no mesmo lugar.
 *
 * O erro é ligado ao input por aria-describedby e marcado com aria-invalid: um
 * leitor de tela anuncia o problema, não só quem enxerga a borda vermelha.
 */
export function Campo({
  rotulo,
  valor,
  aoMudar,
  tipo = 'text',
  dica,
  erro,
  obrigatorio,
  desabilitado,
  inputMode,
  autoComplete,
  placeholder,
}: {
  rotulo: string
  valor: string
  aoMudar: (v: string) => void
  tipo?: string
  dica?: string
  erro?: string | null
  obrigatorio?: boolean
  desabilitado?: boolean
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email'
  autoComplete?: string
  placeholder?: string
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="flex items-baseline gap-2">
        <RotuloCampo>
          {rotulo}
          {obrigatorio ? ' *' : ''}
        </RotuloCampo>
        {dica && <span className="text-[12px] text-(--color-tinta-3)">{dica}</span>}
      </label>
      <input
        id={id}
        type={tipo}
        value={valor}
        required={obrigatorio}
        disabled={desabilitado}
        inputMode={inputMode}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? `${id}-erro` : undefined}
        onChange={(e) => aoMudar(e.target.value)}
        style={erro ? { borderColor: 'var(--color-perigo-ink)' } : undefined}
        className={`toque mt-1 ${CLASSE_CAMPO}`}
      />
      {erro && (
        <p
          id={`${id}-erro`}
          className="mt-1 flex items-center gap-1 text-[13px] text-(--color-perigo-ink)"
        >
          <AlertTriangle size={13} className="shrink-0" /> {erro}
        </p>
      )}
    </div>
  )
}

/** Lista de opções. `<select>` nativo — o do sistema já é acessível e rola bem no celular. */
export function Selecao({
  rotulo,
  valor,
  aoMudar,
  opcoes,
  dica,
  erro,
  compacto,
}: {
  rotulo: string
  valor: string
  aoMudar: (v: string) => void
  opcoes: { valor: string; nome: string }[]
  dica?: string
  erro?: string | null
  /** Sem rótulo em cima — para filtros, onde o próprio texto já diz o que é. */
  compacto?: boolean
}) {
  const id = useId()
  const campo = (
    <select
      id={id}
      value={valor}
      aria-label={compacto ? rotulo : undefined}
      aria-invalid={erro ? true : undefined}
      onChange={(e) => aoMudar(e.target.value)}
      style={erro ? { borderColor: 'var(--color-perigo-ink)' } : undefined}
      className={`toque ${compacto ? '' : 'mt-1'} ${CLASSE_CAMPO}`}
    >
      {opcoes.map((o) => (
        <option key={o.valor} value={o.valor}>
          {o.nome}
        </option>
      ))}
    </select>
  )

  if (compacto) return campo
  return (
    <div>
      <label htmlFor={id} className="flex items-baseline gap-2">
        <RotuloCampo>{rotulo}</RotuloCampo>
        {dica && <span className="text-[12px] text-(--color-tinta-3)">{dica}</span>}
      </label>
      {campo}
      {erro && (
        <p className="mt-1 flex items-center gap-1 text-[13px] text-(--color-perigo-ink)">
          <AlertTriangle size={13} className="shrink-0" /> {erro}
        </p>
      )}
    </div>
  )
}

/** Interruptor. Estado dito por aria-checked, não só pela posição da bolinha. */
export function Interruptor({
  rotulo,
  descricao,
  ligado,
  aoMudar,
}: {
  rotulo: string
  descricao?: string
  ligado: boolean
  aoMudar: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="min-w-0">
        <span className="t-corpo block font-medium">{rotulo}</span>
        {descricao && <span className="t-aux block">{descricao}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-label={rotulo}
        onClick={() => aoMudar(!ligado)}
        style={{
          background: ligado ? 'var(--destaque)' : 'var(--color-borda-forte)',
          transition: 'background var(--transicao)',
        }}
        className="relative h-6 w-11 shrink-0 cursor-pointer rounded-full"
      >
        <span
          className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm"
          style={{
            transform: ligado ? 'translateX(20px)' : 'none',
            transition: 'transform var(--transicao)',
          }}
        />
      </button>
    </div>
  )
}

/**
 * Grupo de campos com um título. É o que impede um formulário de onze campos
 * de virar uma pilha indistinta.
 */
export function GrupoCampos({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 border-t border-(--color-borda) pt-4 first:border-0 first:pt-0">
      <legend className="t-legenda mb-3">{titulo}</legend>
      <div className="grid grid-cols-1 gap-x-3 gap-y-3.5 sm:grid-cols-2">{children}</div>
    </fieldset>
  )
}

/** Rótulo de campo. Frase, não grito — o grito é do título da seção. */
export function RotuloCampo({ children }: { children: ReactNode }) {
  return <span className="block text-[13px] font-medium text-(--color-tinta-2)">{children}</span>
}

// ================================================================ modal

const LARGURA = { pequeno: 'max-w-sm', medio: 'max-w-lg', grande: 'max-w-2xl' } as const

/**
 * O modal do app. Um só, usado por toda edição e toda confirmação.
 *
 * Compacto e centralizado em qualquer tela — no celular ele ganha margem
 * lateral em vez de virar uma folha colada no rodapé, e o corpo rola por
 * dentro (em dvh) para que o teclado do aparelho nunca empurre Salvar para fora.
 */
export function AppModal({
  titulo,
  descricao,
  tamanho = 'medio',
  aoFechar,
  acoes,
  children,
}: {
  titulo: string
  descricao?: ReactNode
  tamanho?: keyof typeof LARGURA
  aoFechar: () => void
  /** Rodapé fixo. Fica sempre visível, mesmo com o corpo rolando. */
  acoes?: ReactNode
  children?: ReactNode
}) {
  const caixa = useRef<HTMLDivElement>(null)
  const id = useId()
  const { fechando, pedirFechar } = useFechamentoAnimado(aoFechar)

  useEffect(() => {
    const anterior = document.body.style.overflow
    const focoAnterior = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'

    // Foco entra no modal; Tab não escapa dele; Esc fecha. Sem isto, quem usa
    // teclado continua navegando a página escondida atrás do véu.
    const focaveis = () =>
      Array.from(
        caixa.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null)

    // Foca o primeiro campo, não o X: abrir um formulário já com o cursor no
    // botão de fechar convida ao engano. Sem campos, o foco vai para a própria
    // caixa — assim o leitor de tela anuncia o diálogo sem acender um anel em
    // volta do X, que leria como "o botão de fechar é a ação principal".
    const primeiroCampo = focaveis().find((el) =>
      ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName),
    )
    ;(primeiroCampo ?? caixa.current)?.focus()

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return pedirFechar()
      if (e.key !== 'Tab') return
      const lista = focaveis()
      if (lista.length === 0) return
      const primeiro = lista[0]
      const ultimo = lista[lista.length - 1]
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault()
        primeiro.focus()
      }
    }

    window.addEventListener('keydown', aoTeclar)
    return () => {
      document.body.style.overflow = anterior
      window.removeEventListener('keydown', aoTeclar)
      focoAnterior?.focus?.()
    }
  }, [pedirFechar])

  // Todo modal do app nasce de um clique, então nunca é renderizado no
  // servidor. A guarda existe só para o caso de um dia alguém montar um
  // <AppModal> já aberto — sem ela, seria um crash em vez de nada na tela.
  if (typeof document === 'undefined') return null

  // Portal para o <body>: montado onde foi chamado, o modal herdaria o
  // text-align de uma célula de tabela e morreria dentro de qualquer ancestral
  // com `transform`. Na raiz ele não depende de onde a página o abriu.
  return createPortal(
    <div
      className={`sem-impressao fixed inset-0 z-50 flex items-center justify-center p-4 text-left ${fechando ? 'anim-sair' : 'anim-surgir'}`}
      style={{ background: 'var(--veu)' }}
      onClick={pedirFechar}
    >
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-titulo`}
        aria-describedby={descricao ? `${id}-desc` : undefined}
        // Focável por código, fora da ordem do Tab: destino do foco quando o
        // diálogo não tem campo nenhum.
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: 'var(--sombra-modal)' }}
        className={`flex max-h-[85dvh] w-full ${LARGURA[tamanho]} flex-col overflow-hidden rounded-[24px] bg-(--color-cartao) ${fechando ? 'anim-descer' : 'anim-subir'}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0">
            <h2 id={`${id}-titulo`} className="t-secao">
              {titulo}
            </h2>
            {descricao && (
              <p id={`${id}-desc`} className="t-aux mt-1">
                {descricao}
              </p>
            )}
          </div>
          <button
            onClick={pedirFechar}
            aria-label="Fechar"
            className="-mt-1 -mr-1 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-(--color-tinta-3) transition-colors hover:bg-(--color-superficie-2) hover:text-(--color-tinta)"
          >
            <X size={18} />
          </button>
        </div>

        {children != null && (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">{children}</div>
        )}

        {acoes && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-(--color-borda) px-5 py-4">
            {acoes}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/**
 * Confirmação de ação destrutiva. Diz O QUE some, não só "tem certeza?".
 * Substitui window.confirm, que não é estilizável nem acessível de verdade.
 */
export function ConfirmarDialogo({
  titulo,
  descricao,
  rotuloConfirmar = 'Remover',
  carregando,
  aoConfirmar,
  aoCancelar,
}: {
  titulo: string
  descricao: ReactNode
  rotuloConfirmar?: string
  carregando?: boolean
  aoConfirmar: () => void
  aoCancelar: () => void
}) {
  return (
    <AppModal
      titulo={titulo}
      tamanho="pequeno"
      aoFechar={aoCancelar}
      acoes={
        <>
          <Botao variante="secundario" onClick={aoCancelar}>
            Cancelar
          </Botao>
          <Botao variante="perigo" onClick={aoConfirmar} carregando={carregando}>
            {rotuloConfirmar}
          </Botao>
        </>
      }
    >
      <div className="flex gap-3 pb-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--color-perigo-bg) text-(--color-perigo-ink)">
          <AlertTriangle size={18} />
        </span>
        <div className="t-corpo min-w-0 text-(--color-tinta-2)">{descricao}</div>
      </div>
    </AppModal>
  )
}

// ================================================================ avisos (toast)

type TomAviso = 'sucesso' | 'erro' | 'info'
type Aviso = { id: number; tom: TomAviso; texto: string; saindo?: boolean }

const CtxAviso = createContext<((tom: TomAviso, texto: string) => void) | null>(null)

/**
 * Avisos de ação. Toda escrita passa a dizer que aconteceu — salvar em silêncio
 * é o que faz alguém clicar duas vezes.
 *
 * Fora do provedor (teste, rota isolada) vira no-op em vez de estourar: nenhuma
 * tela deve quebrar por causa de um aviso.
 */
export function useAviso() {
  const avisar = useContext(CtxAviso)
  return useCallback((tom: TomAviso, texto: string) => avisar?.(tom, texto), [avisar])
}

const ICONE_AVISO: Record<TomAviso, ReactNode> = {
  sucesso: <CheckCircle2 size={17} />,
  erro: <XCircle size={17} />,
  info: <Info size={17} />,
}

const COR_AVISO: Record<TomAviso, { bg: string; ink: string }> = {
  sucesso: { bg: 'var(--color-sucesso-bg)', ink: 'var(--color-sucesso-ink)' },
  erro: { bg: 'var(--color-perigo-bg)', ink: 'var(--color-perigo-ink)' },
  info: { bg: 'var(--color-info-bg)', ink: 'var(--color-info-ink)' },
}

export function ProvedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const proximo = useRef(0)

  // Marca a saída e só desmonta depois — o corte seco era o próprio aviso
  // desaparecendo no meio da leitura, sem tempo de registrar que sumiu.
  const remover = useCallback((id: number) => {
    setAvisos((a) => a.map((x) => (x.id === id ? { ...x, saindo: true } : x)))
    setTimeout(
      () => setAvisos((a) => a.filter((x) => x.id !== id)),
      prefereMenosMovimento() ? 0 : 130,
    )
  }, [])

  const avisar = useCallback(
    (tom: TomAviso, texto: string) => {
      const id = ++proximo.current
      // Guarda no máximo três: uma pilha crescente tapa a tela que ela comenta.
      setAvisos((a) => [...a.slice(-2), { id, tom, texto }])
      setTimeout(() => remover(id), tom === 'erro' ? 6000 : 3200)
    },
    [remover],
  )

  return (
    <CtxAviso.Provider value={avisar}>
      {children}
      {/* aria-live: o leitor de tela anuncia sem roubar o foco de quem digita. */}
      <div
        aria-live="polite"
        className="sem-impressao pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
        style={{ bottom: 'calc(84px + env(safe-area-inset-bottom))' }}
      >
        {avisos.map((a) => (
          <div
            key={a.id}
            className={`pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-xl px-3.5 py-3 text-sm font-medium ${a.saindo ? 'anim-sair-toast' : 'anim-toast'}`}
            style={{
              background: COR_AVISO[a.tom].bg,
              color: COR_AVISO[a.tom].ink,
              boxShadow: 'var(--sombra-2)',
            }}
          >
            <span className="shrink-0">{ICONE_AVISO[a.tom]}</span>
            <span className="min-w-0 flex-1">{a.texto}</span>
            <button
              onClick={() => remover(a.id)}
              aria-label="Dispensar aviso"
              className="shrink-0 cursor-pointer rounded-lg p-1 opacity-70 hover:opacity-100"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </CtxAviso.Provider>
  )
}

// ================================================================ diversos

/** Foto da pessoa, ou as iniciais quando não há foto. */
export function Avatar({
  nome,
  url: urlBruta,
  tamanho = 40,
}: {
  nome: string
  /** Campo cru de linha (`users.avatar_url`) em todas as seis chamadas: a
      coercao mora aqui, e nao repetida em cada uma delas. */
  url?: unknown
  tamanho?: number
}) {
  const url = typeof urlBruta === 'string' && urlBruta.trim() ? urlBruta : null
  const iniciais = String(nome || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase()

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={`Foto de ${nome}`}
        style={{ width: tamanho, height: tamanho }}
        className="shrink-0 rounded-full object-cover"
      />
    )
  }

  return (
    <span
      aria-hidden
      style={{
        width: tamanho,
        height: tamanho,
        background: 'var(--destaque)',
        fontSize: Math.max(11, Math.round(tamanho * 0.36)),
      }}
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
    >
      {iniciais}
    </span>
  )
}

/** Bloco de estatística com ícone, usado no Início e em outras telas de resumo. */
export function CartaoEstatistica({
  icone: Icone,
  numero,
  rotulo,
  onClick,
}: {
  icone: React.ElementType
  numero: ReactNode
  rotulo: string
  onClick?: () => void
}) {
  return (
    <Cartao onClick={onClick} className="text-center">
      <div
        className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl"
        style={{ background: 'var(--color-destaque-fraco)', color: 'var(--destaque)' }}
      >
        <Icone size={18} strokeWidth={1.75} />
      </div>
      <p className="tab-num text-2xl leading-none font-bold">{numero}</p>
      <p className="mt-1 text-xs text-(--color-tinta-3)">{rotulo}</p>
    </Cartao>
  )
}

/** Linha rótulo/valor, o formato de meia dúzia de telas. */
export function Linha({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  if (valor === null || valor === undefined || valor === '') return null
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-sm text-(--color-tinta-3)">{rotulo}</span>
      <span className="text-right text-sm font-medium">{valor}</span>
    </div>
  )
}

/**
 * Progresso em anel. Não é enfeite do `Progresso` linear: a barra vive numa
 * LINHA, ao lado do nome de quem ela mede, e o anel vive num CARTÃO, onde o
 * número é o assunto. Trocar um pelo outro deixa a tabela alta demais ou o
 * cartão com uma tira solta no meio.
 *
 * `tom` aceita chave de `TONS` para o anel do painel virar vermelho quando o que
 * ele mede está atrasado — a cor entra pelo design system, nunca por um hex.
 */
export function Anel({
  pct,
  tamanho = 96,
  tom,
  legenda,
}: {
  pct: number
  tamanho?: number
  tom?: string
  legenda?: string
}) {
  const espessura = Math.max(6, Math.round(tamanho * 0.09))
  const raio = (tamanho - espessura) / 2
  const volta = 2 * Math.PI * raio
  const limitado = Math.min(100, Math.max(0, Math.round(pct)))
  const meio = tamanho / 2
  const cor = tom ? (TONS[tom]?.ink ?? 'var(--destaque)') : 'var(--destaque)'

  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox={`0 0 ${tamanho} ${tamanho}`}
      role="img"
      aria-label={legenda ?? `${limitado}% concluído`}
      className="shrink-0"
    >
      <circle
        cx={meio}
        cy={meio}
        r={raio}
        fill="none"
        stroke="var(--color-superficie-2)"
        strokeWidth={espessura}
      />
      <circle
        cx={meio}
        cy={meio}
        r={raio}
        fill="none"
        stroke={cor}
        strokeWidth={espessura}
        strokeLinecap="round"
        strokeDasharray={volta}
        strokeDashoffset={volta * (1 - limitado / 100)}
        transform={`rotate(-90 ${meio} ${meio})`}
        style={{ transition: 'stroke-dashoffset var(--transicao)' }}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="tab-num"
        style={{ fontSize: tamanho * 0.24, fontWeight: 700, fill: 'var(--color-tinta)' }}
      >
        {limitado}%
      </text>
    </svg>
  )
}

export function Progresso({ pct, rotulo }: { pct: number; rotulo?: string }) {
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-(--color-superficie-2)"
      role="progressbar"
      aria-label={rotulo}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%`, background: 'var(--destaque)' }}
      />
    </div>
  )
}
