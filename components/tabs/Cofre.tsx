'use client'

// O Cofre de Documentos.
//
// A tela é lida em pé, com uma mala na mão, às vezes sem sinal. Duas decisões
// saem daí e explicam quase todo o resto:
//
//   1. A ordem é a da VIAGEM, não a alfabética nem a de upload. Quem está em
//      Madri quer Madri perto do topo.
//   2. O estado offline é dito em toda parte, com palavra e ícone, nunca só com
//      cor — porque a pergunta real diante da tela é "isto abre no avião?".
//
// O que decide quem vê o quê está no servidor (`documentosDaViagem`, lib/db.ts).
// Esta tela pinta o que recebeu; ela não filtra por permissão.
import { useMemo, useState, useSyncExternalStore } from 'react'
import { ArrowLeft, Filter, Search, Star, X } from 'lucide-react'
import {
  AppModal,
  Badge,
  Botao,
  BotaoIcone,
  Cartao,
  CLASSE_CAMPO,
  Rotulo,
  Titulo,
  Vazio,
  useAviso,
} from '../ui.tsx'
import { AdminAcoes } from '../EditorSheet.tsx'
import { useTrip } from '../TripProvider.tsx'
import {
  CartaoDocumento,
  EntradaArquivos,
  FichaDocumento,
  FormDocumento,
  PreviewDocumento,
  SeloOffline,
  useCofre,
  ZonaSoltar,
} from '../CofreDocumento.tsx'
import {
  agruparPorDestino,
  CATEGORIAS,
  pessoasComDocumentos,
  chaveDestino,
  filtrarDocumentos,
  ordenarDocumentos,
  resumoCofre,
  statusOffline,
  temArquivo,
  type Categoria,
  type Documento,
  type Lugar,
} from '@/lib/cofre.ts'
import { CATEGORIAS_DOCUMENTO } from '@/lib/schema.ts'
import { formatarData } from '@/lib/derive.ts'

/**
 * Os atalhos do topo (§31). Não são as catorze categorias — são as quatro que a
 * pessoa procura correndo. O resto mora no painel de filtros, que é onde se
 * procura com calma.
 */
const ATALHOS: { id: string; nome: string; categorias: Categoria[] }[] = [
  { id: 'voos', nome: 'Voos', categorias: ['voo'] },
  { id: 'hospedagens', nome: 'Hospedagens', categorias: ['hospedagem'] },
  { id: 'seguros', nome: 'Seguros', categorias: ['seguro', 'saude'] },
  { id: 'reservas', nome: 'Reservas', categorias: ['reserva', 'ingresso', 'transfer'] },
]

export function Cofre() {
  const { snapshot, mutate, posso } = useTrip()
  const avisar = useAviso()

  // `?? []` cria um array novo a cada pintura, e um array novo invalida todo
  // useMemo abaixo — que existem justamente porque agrupar e filtrar o cofre
  // inteiro não é de graça. Memoizar a lista é o que faz os outros memos valerem.
  const documentos = useMemo(
    () => (snapshot?.documentos ?? []) as unknown as Documento[],
    [snapshot?.documentos],
  )
  const lugares = useMemo(
    () => (snapshot?.lugares ?? []) as unknown as Lugar[],
    [snapshot?.lugares],
  )
  const participantes = useMemo(() => snapshot?.participantes ?? [], [snapshot?.participantes])

  const { salvos, erros, sincronizando, ressincronizar, marcar } = useCofre(documentos)

  const [busca, setBusca] = useState('')
  const [atalho, setAtalho] = useState<string | null>(null)
  const [filtros, setFiltros] = useState<{
    categorias: Categoria[]
    destinos: string[]
    participantes: string[]
    offline: boolean
    importantes: boolean
  }>({ categorias: [], destinos: [], participantes: [], offline: false, importantes: false })
  const [painelFiltros, setPainelFiltros] = useState(false)
  const [gerenciando, setGerenciando] = useState(false)
  const [aberto, setAberto] = useState<string | null>(null)
  const [fila, setFila] = useState<File[]>([])
  const [editando, setEditando] = useState<Documento | null>(null)

  const eu = snapshot?.eu?.participanteId ?? ''

  // Só quem tem documento que ESTA sessão enxerga. Ver `pessoasComDocumentos`.
  const pessoasFiltraveis = useMemo(
    () => pessoasComDocumentos(documentos, participantes as { id: string }[]),
    [documentos, participantes],
  )

  const telaLarga = useTelaLarga()

  const participantesFiltraveis = useMemo(
    () => participantes.filter((p) => pessoasFiltraveis.includes(String(p.id))),
    [participantes, pessoasFiltraveis],
  )

  const nomePorParticipante = useMemo(
    () => new Map(participantes.map((p) => [String(p.id), String(p.nome)])),
    [participantes],
  )

  const categoriasAtivas = useMemo(() => {
    const doAtalho = ATALHOS.find((a) => a.id === atalho)?.categorias ?? []
    return [...new Set([...filtros.categorias, ...doAtalho])]
  }, [atalho, filtros.categorias])

  const visiveis = useMemo(
    () =>
      filtrarDocumentos(
        documentos,
        { ...filtros, categorias: categoriasAtivas, busca },
        nomePorParticipante,
      ),
    [documentos, filtros, categoriasAtivas, busca, nomePorParticipante],
  )

  const grupos = useMemo(() => agruparPorDestino(visiveis, lugares), [visiveis, lugares])
  const resumo = useMemo(
    () => resumoCofre(documentos, salvos, new Set(erros.keys())),
    [documentos, salvos, erros],
  )
  const importantes = useMemo(
    () => ordenarDocumentos(visiveis.filter((d) => d.importante)),
    [visiveis],
  )

  const docAberto = documentos.find((d) => d.id === aberto) ?? null
  const status = (doc: Documento) => statusOffline(doc, salvos, new Set(erros.keys()))

  const filtrando =
    Boolean(busca) ||
    Boolean(atalho) ||
    filtros.categorias.length > 0 ||
    filtros.destinos.length > 0 ||
    filtros.participantes.length > 0 ||
    filtros.offline ||
    filtros.importantes

  const limpar = () => {
    setBusca('')
    setAtalho(null)
    setFiltros({
      categorias: [],
      destinos: [],
      participantes: [],
      offline: false,
      importantes: false,
    })
  }

  const trocarOffline = async (doc: Documento, offline: boolean) => {
    // Duas gravações diferentes de propósito: a INTENÇÃO vai para o servidor (é
    // do grupo), e os BYTES vão para o IndexedDB (são deste aparelho). Inverter a
    // ordem deixaria o semáforo verde antes de o arquivo existir aqui.
    await mutate({
      op: 'editar',
      entidade: 'documento',
      id: doc.id,
      campos: { offline },
      client_ts: new Date().toISOString(),
    })
    try {
      await marcar({ ...doc, offline }, offline)
      avisar(
        'sucesso',
        offline
          ? 'Documento guardado para usar sem internet.'
          : 'Documento não viaja mais offline.',
      )
    } catch {
      avisar('erro', 'Não foi possível preparar este documento para acesso offline.')
    }
  }

  const remover = async (doc: Documento) => {
    await mutate({
      op: 'remover',
      entidade: 'documento',
      id: doc.id,
      campos: {},
      client_ts: new Date().toISOString(),
    })
    setAberto(null)
    avisar('sucesso', 'Documento removido do cofre.')
  }

  // Todo participante adiciona documento. O que muda e o ALCANCE: quem organiza
  // a viagem guarda o voucher do grupo, e um viajante guarda o proprio passaporte
  // — `FormDocumento` ja nasce pessoal para ele, e o servidor recusa o resto.
  // Seção, não página: o <h1> "Documentos" é da tela inteira, e o cofre é a
  // primeira das duas matérias que moram nela. "Cofre" sem "de documentos"
  // porque a palavra já está no título acima — a repetição não informa nada.
  const cabecalho = (
    <Titulo
      nivel={2}
      chapeu="O que você tem"
      acao={<EntradaArquivos aoEscolher={(arquivos) => setFila(arquivos)} />}
    >
      Cofre
    </Titulo>
  )

  return (
    <>
      {cabecalho}

      <ZonaSoltar aoSoltar={(arquivos) => setFila(arquivos)}>
        <PainelOffline
          resumo={resumo}
          sincronizando={sincronizando}
          aoGerenciar={() => setGerenciando(true)}
          aoTentar={() => void ressincronizar()}
        />

        <FaixaDestinos grupos={grupos} salvos={salvos} erros={erros} />

        {/* Barra de busca. Gruda no topo porque a lista é longa e a busca é o que
          se usa quando ela é longa. */}
        <div className="sticky top-0 z-10 -mx-1 mb-3 bg-(--color-fundo) px-1 py-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-(--color-tinta-3)"
              />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                type="search"
                placeholder="Buscar no cofre"
                aria-label="Buscar no cofre"
                // `CLASSE_CAMPO`: escrito à mão, este campo ficava com a borda
                // fraca (`borda`, não `borda-forte`) e sem o anel de foco do
                // sistema — a busca de cada aba tinha uma aparência.
                className={`toque pr-3 pl-9 ${CLASSE_CAMPO}`}
              />
            </div>
            <Botao
              variante={painelFiltros ? 'principal' : 'secundario'}
              onClick={() => setPainelFiltros((a) => !a)}
            >
              <Filter size={15} />
              <span className="hidden sm:inline">Filtros</span>
              {filtrando && !painelFiltros && (
                <span
                  className="ml-0.5 h-1.5 w-1.5 rounded-full"
                  style={{ background: 'var(--destaque)' }}
                  aria-label="filtros ativos"
                />
              )}
            </Botao>
          </div>

          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
            <Chip
              ativo={!atalho && filtros.participantes.length === 0}
              aoClicar={() => {
                setAtalho(null)
                setFiltros((f) => ({ ...f, participantes: [] }))
              }}
            >
              Todos
            </Chip>
            {/* O filtro mais usado em qualquer papel, e o único que um viajante
                comum usa de verdade — fica fora do modal por isso. Só aparece
                para quem realmente tem documento pessoal no cofre. */}
            {eu && pessoasFiltraveis.includes(eu) && (
              <Chip
                ativo={filtros.participantes.length === 1 && filtros.participantes[0] === eu}
                aoClicar={() =>
                  setFiltros((f) => ({
                    ...f,
                    participantes: f.participantes.includes(eu) ? [] : [eu],
                  }))
                }
              >
                Meus documentos
              </Chip>
            )}
            {ATALHOS.map((a) => (
              <Chip key={a.id} ativo={atalho === a.id} aoClicar={() => setAtalho(a.id)}>
                {a.nome}
              </Chip>
            ))}
          </div>

          <FiltrosAtivos
            filtros={filtros}
            setFiltros={setFiltros}
            busca={busca}
            setBusca={setBusca}
            nomePorParticipante={nomePorParticipante}
            lugares={lugares}
            aoLimpar={limpar}
          />
        </div>

        {/* Numa tela larga o painel abre AQUI, empurrando a lista para baixo, em
            vez de cobrir tudo com um modal: filtrar é conversa com a lista, e
            esconder a lista para escolher o filtro é perder o que se estava
            olhando. Fica FORA do bloco grudado de propósito — preso ao topo, ele
            cobriria a tela inteira durante a rolagem. No celular continua sendo
            folha de baixo: não há largura para quatro grupos. */}
        {painelFiltros && telaLarga && (
          <div className="mb-3 rounded-2xl border border-(--color-borda) bg-(--color-cartao) p-4">
            <ConteudoFiltros
              filtros={filtros}
              setFiltros={setFiltros}
              lugares={lugares}
              participantes={participantesFiltraveis}
              escondeAlheios={!posso('proprietario')}
              colunas
            />
          </div>
        )}

        {documentos.length === 0 ? (
          <Vazio
            titulo="Seu cofre ainda está vazio"
            texto="Adicione seus documentos importantes para ter tudo à mão durante a viagem."
            acao={<EntradaArquivos aoEscolher={(arquivos) => setFila(arquivos)} />}
          />
        ) : visiveis.length === 0 ? (
          <Vazio
            titulo="Nada encontrado"
            texto="Nenhum documento combina com a busca e os filtros atuais."
            acao={
              <Botao variante="secundario" onClick={limpar}>
                Limpar filtros
              </Botao>
            }
          />
        ) : (
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start lg:gap-6">
            <div className="space-y-6">
              {importantes.length > 0 && !filtrando && (
                <section>
                  <Rotulo>
                    <span className="inline-flex items-center gap-1.5">
                      <Star size={12} className="fill-current text-(--color-atencao-ink)" />
                      Documentos importantes
                    </span>
                  </Rotulo>
                  <div className="mt-2 space-y-2">
                    {importantes.map((doc) => (
                      <CartaoDocumento
                        key={doc.id}
                        doc={doc}
                        status={status(doc)}
                        ativo={aberto === doc.id}
                        aoAbrir={() => setAberto(doc.id)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {grupos.map((g) => (
                <section key={g.chave || 'toda-a-viagem'} id={`destino-${g.chave || 'viagem'}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="t-cartao">
                      {g.pais && (
                        <span className="t-aux mr-1.5 tracking-wide uppercase">{g.pais} —</span>
                      )}
                      {g.cidade}
                    </h3>
                    {g.chega_em && (
                      <span className="t-aux shrink-0 font-(family-name:--fonte-dados)">
                        {formatarData(g.chega_em, { day: '2-digit', month: '2-digit' })}
                        {g.sai_em &&
                          ` → ${formatarData(g.sai_em, { day: '2-digit', month: '2-digit' })}`}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 space-y-2">
                    {g.documentos.map((doc) => (
                      <CartaoDocumento
                        key={doc.id}
                        doc={doc}
                        status={status(doc)}
                        ativo={aberto === doc.id}
                        aoAbrir={() => setAberto(doc.id)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>

            {/* Desktop: o documento aberto fica ao lado da lista e acompanha a
              rolagem. No celular ele vira tela cheia, logo abaixo. */}
            <div className="sticky top-16 hidden lg:block">
              {docAberto ? (
                <Cartao className="max-h-[calc(100dvh-6rem)] overflow-auto">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <h3 className="t-cartao">{docAberto.titulo}</h3>
                    <BotaoIcone rotulo="Fechar documento" onClick={() => setAberto(null)}>
                      <X size={16} />
                    </BotaoIcone>
                  </div>
                  <div className="mb-4 min-h-[40vh]">
                    <PreviewDocumento doc={docAberto} />
                  </div>
                  <FichaDocumento
                    doc={docAberto}
                    status={status(docAberto)}
                    aoEditar={() => setEditando(docAberto)}
                    aoTrocarOffline={(v) => void trocarOffline(docAberto, v)}
                    aoRemover={() => void remover(docAberto)}
                  />
                </Cartao>
              ) : (
                <Cartao>
                  <p className="t-aux py-12 text-center">
                    Escolha um documento para ver o conteúdo aqui.
                  </p>
                </Cartao>
              )}
            </div>
          </div>
        )}
      </ZonaSoltar>

      {/* Celular: tela própria, do jeito que o §11 pede — não um painel espremido. */}
      {docAberto && (
        <div className="anim-surgir fixed inset-0 z-50 flex flex-col bg-(--color-fundo) lg:hidden">
          <header className="flex items-center gap-2 border-b border-(--color-borda) bg-(--color-cartao) px-3 py-2">
            <BotaoIcone rotulo="Voltar ao cofre" onClick={() => setAberto(null)}>
              <ArrowLeft size={18} />
            </BotaoIcone>
            <h2 className="t-corpo min-w-0 flex-1 truncate font-semibold">{docAberto.titulo}</h2>
          </header>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            <div className="mb-4 min-h-[45vh]">
              <PreviewDocumento doc={docAberto} />
            </div>
            <FichaDocumento
              doc={docAberto}
              status={status(docAberto)}
              aoEditar={() => setEditando(docAberto)}
              aoTrocarOffline={(v) => void trocarOffline(docAberto, v)}
              aoRemover={() => void remover(docAberto)}
            />
          </div>
        </div>
      )}

      {painelFiltros && !telaLarga && (
        <FolhaFiltros
          filtros={filtros}
          setFiltros={setFiltros}
          lugares={lugares}
          participantes={participantesFiltraveis}
          escondeAlheios={!posso('proprietario')}
          aoFechar={() => setPainelFiltros(false)}
          aoLimpar={limpar}
        />
      )}

      {gerenciando && (
        <GerenciarOffline
          documentos={documentos}
          salvos={salvos}
          erros={erros}
          aoTrocar={trocarOffline}
          aoFechar={() => setGerenciando(false)}
        />
      )}

      {/* Um arquivo por vez: cada documento tem categoria e destino próprios. */}
      {fila.length > 0 && (
        <FormDocumento
          key={fila[0].name + fila.length}
          arquivo={fila[0]}
          aoFechar={() => setFila((f) => f.slice(1))}
        />
      )}

      {editando && <FormDocumento documento={editando} aoFechar={() => setEditando(null)} />}
    </>
  )
}

// ---------------------------------------------------------------- peças

function Chip({
  ativo,
  aoClicar,
  children,
}: {
  ativo: boolean
  aoClicar: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={aoClicar}
      aria-pressed={ativo}
      className="toque shrink-0 cursor-pointer rounded-full border px-3 text-[13px] font-medium whitespace-nowrap"
      style={{
        background: ativo ? 'var(--destaque)' : 'var(--color-cartao)',
        borderColor: ativo ? 'var(--destaque)' : 'var(--color-borda)',
        color: ativo ? '#fff' : 'var(--color-tinta-2)',
      }}
    >
      {children}
    </button>
  )
}

/** O painel do §14: quantos documentos viajam com você, e o que falta. */
function PainelOffline({
  resumo,
  sincronizando,
  aoGerenciar,
  aoTentar,
}: {
  resumo: { disponiveis: number; aguardando: number; problemas: number }
  sincronizando: boolean
  aoGerenciar: () => void
  aoTentar: () => void
}) {
  const nada = resumo.disponiveis + resumo.aguardando + resumo.problemas === 0
  if (nada && !sincronizando) return null

  return (
    <Cartao className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Rotulo>Cofre offline</Rotulo>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tipo="sucesso" texto={`${resumo.disponiveis} disponíveis offline`} />
            {resumo.aguardando > 0 && (
              <Badge tipo="atencao" texto={`${resumo.aguardando} aguardando`} />
            )}
            {resumo.problemas > 0 && (
              <Badge tipo="perigo" texto={`${resumo.problemas} com problema`} />
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {resumo.problemas > 0 && (
            <Botao variante="secundario" tamanho="pequeno" onClick={aoTentar}>
              Tentar de novo
            </Botao>
          )}
          <Botao variante="secundario" tamanho="pequeno" onClick={aoGerenciar}>
            Gerenciar offline
          </Botao>
        </div>
      </div>
      <p className="t-aux mt-2">
        Os arquivos ficam guardados neste aparelho para abrir sem internet. Não é um cofre
        criptografado: quem tiver o aparelho desbloqueado abre os documentos.
      </p>
    </Cartao>
  )
}

/**
 * A faixa de destinos.
 *
 * É a única peça decorativa da tela, e ela ganhou o lugar por dizer duas coisas
 * de uma vez que nenhuma lista diz: em que ORDEM a viagem acontece, e quanto de
 * cada trecho já viaja offline. Ler "Madri 3/4" antes de embarcar é a informação
 * que faz alguém voltar e baixar o que falta.
 *
 * Some quando não há destino nenhum: uma régua com um item só é enfeite.
 */
function FaixaDestinos({
  grupos,
  salvos,
  erros,
}: {
  grupos: ReturnType<typeof agruparPorDestino>
  salvos: Set<string>
  erros: Map<string, string>
}) {
  const comDestino = grupos.filter((g) => g.chave)
  if (comDestino.length < 2) return null

  return (
    <nav aria-label="Destinos da viagem" className="mb-4 -mx-1 overflow-x-auto px-1 pb-1">
      <ul className="flex gap-2">
        {comDestino.map((g) => {
          const arquivos = g.documentos.filter(temArquivo)
          const prontos = arquivos.filter((d) => salvos.has(d.id)).length
          const falhou = arquivos.some((d) => erros.has(d.id))
          return (
            <li key={g.chave}>
              <a
                href={`#destino-${g.chave}`}
                className="toque flex min-w-36 flex-col justify-between rounded-xl border border-(--color-borda) bg-(--color-cartao) px-3 py-2"
              >
                <span className="t-aux tracking-wide uppercase">{g.pais ?? 'Viagem'}</span>
                <span className="t-corpo truncate font-medium">{g.cidade}</span>
                <span className="mt-1 flex items-center justify-between gap-2">
                  <span className="t-aux font-(family-name:--fonte-dados)">
                    {g.chega_em
                      ? formatarData(g.chega_em, { day: '2-digit', month: '2-digit' })
                      : ''}
                  </span>
                  {arquivos.length > 0 && (
                    <span
                      className="text-[11px] font-semibold font-(family-name:--fonte-dados)"
                      style={{
                        color: falhou
                          ? 'var(--color-perigo-ink)'
                          : prontos === arquivos.length
                            ? 'var(--color-sucesso-ink)'
                            : 'var(--color-atencao-ink)',
                      }}
                    >
                      {prontos}/{arquivos.length}
                    </span>
                  )}
                </span>
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/**
 * Larga o bastante para o painel de filtros caber acima da lista sem espremê-la.
 * 1024px é o mesmo ponto em que a tela ganha a coluna de preview (`lg:`).
 *
 * `useSyncExternalStore` em vez de um efeito com setState: o retorno do servidor
 * é `false` (o layout de celular), então a primeira pintura casa com o HTML e não
 * há hidratação divergente — e não há setState síncrono dentro de efeito, que é
 * o que gera renderização em cascata.
 */
const CONSULTA = '(min-width: 1024px)'

function useTelaLarga(): boolean {
  return useSyncExternalStore(
    (avisar) => {
      const mq = window.matchMedia(CONSULTA)
      mq.addEventListener('change', avisar)
      return () => mq.removeEventListener('change', avisar)
    },
    () => window.matchMedia(CONSULTA).matches,
    () => false,
  )
}

type EstadoFiltros = {
  categorias: Categoria[]
  destinos: string[]
  participantes: string[]
  offline: boolean
  importantes: boolean
}

type PropsFiltros = {
  filtros: EstadoFiltros
  setFiltros: (f: (anterior: EstadoFiltros) => EstadoFiltros) => void
  lugares: Lugar[]
  /** Já vem recortada: só quem tem documento visível para esta sessão. */
  participantes: Record<string, unknown>[]
  /** true quando esta sessão não é dona da viagem — há documentos pessoais que
      ela simplesmente não recebe, e o filtro precisa dizer isso em vez de deixar
      a pessoa concluir que ninguém subiu nada. */
  escondeAlheios: boolean
}

const chaveDe = (cidade: string) => chaveDestino({ id: '', titulo: '', tipo: '', cidade })

/**
 * Os grupos de filtro. Um componente só, usado pelo painel embutido do desktop e
 * pela folha do celular — duas cópias divergiriam na primeira alteração.
 */
function ConteudoFiltros({
  filtros,
  setFiltros,
  lugares,
  participantes,
  escondeAlheios,
  colunas = false,
}: PropsFiltros & {
  /** Distribui os grupos em colunas. Só faz sentido no painel embutido. */
  colunas?: boolean
}) {
  const alternar = <T,>(lista: T[], v: T): T[] =>
    lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]

  return (
    <div className={colunas ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-4' : 'space-y-4'}>
      <Grupo titulo="Destino">
        {lugares.map((l) => (
          <Caixa
            key={l.id}
            marcada={filtros.destinos.includes(chaveDe(l.cidade))}
            aoMudar={() =>
              setFiltros((f) => ({ ...f, destinos: alternar(f.destinos, chaveDe(l.cidade)) }))
            }
          >
            {l.cidade}
          </Caixa>
        ))}
      </Grupo>

      <Grupo titulo="Categoria">
        {CATEGORIAS_DOCUMENTO.map((c) => (
          <Caixa
            key={c}
            marcada={filtros.categorias.includes(c)}
            aoMudar={() => setFiltros((f) => ({ ...f, categorias: alternar(f.categorias, c) }))}
          >
            {CATEGORIAS[c].rotulo}
          </Caixa>
        ))}
      </Grupo>

      <Grupo titulo="Participante">
        {participantes.length === 0 && (
          <p className="t-aux">Nenhum documento pessoal no seu cofre ainda.</p>
        )}
        {participantes.map((p) => (
          <Caixa
            key={String(p.id)}
            marcada={filtros.participantes.includes(String(p.id))}
            aoMudar={() =>
              setFiltros((f) => ({
                ...f,
                participantes: alternar(f.participantes, String(p.id)),
              }))
            }
          >
            {String(p.nome)}
          </Caixa>
        ))}
        {escondeAlheios && (
          <p className="t-aux mt-1 w-full">
            Documentos pessoais de outras pessoas não aparecem no seu cofre. Só o dono da viagem vê
            todos.
          </p>
        )}
      </Grupo>

      <Grupo titulo="Outros">
        <Caixa
          marcada={filtros.offline}
          aoMudar={() => setFiltros((f) => ({ ...f, offline: !f.offline }))}
        >
          Disponível offline
        </Caixa>
        <Caixa
          marcada={filtros.importantes}
          aoMudar={() => setFiltros((f) => ({ ...f, importantes: !f.importantes }))}
        >
          Importantes
        </Caixa>
      </Grupo>
    </div>
  )
}

/** No celular os filtros abrem como folha: não há largura para quatro grupos. */
function FolhaFiltros({
  aoFechar,
  aoLimpar,
  ...props
}: PropsFiltros & { aoFechar: () => void; aoLimpar: () => void }) {
  return (
    <AppModal
      titulo="Filtros"
      tamanho="pequeno"
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao
            variante="secundario"
            onClick={() => {
              aoLimpar()
              aoFechar()
            }}
          >
            Limpar
          </Botao>
          <Botao onClick={aoFechar}>Ver resultados</Botao>
        </>
      }
    >
      <ConteudoFiltros {...props} />
    </AppModal>
  )
}

/**
 * O que está filtrando agora, sempre visível.
 *
 * É a peça que faz o filtro morar NA tela em vez de atrás de um botão: ninguém
 * precisa abrir nada para saber por que a lista encolheu, e cada critério sai com
 * um toque. Uma tela de cofre a que se chega correndo não pode esconder de quem
 * está olhando que ela mostra um recorte.
 */
function FiltrosAtivos({
  filtros,
  setFiltros,
  busca,
  setBusca,
  nomePorParticipante,
  lugares,
  aoLimpar,
}: {
  filtros: EstadoFiltros
  setFiltros: (f: (anterior: EstadoFiltros) => EstadoFiltros) => void
  busca: string
  setBusca: (v: string) => void
  nomePorParticipante: Map<string, string>
  lugares: Lugar[]
  aoLimpar: () => void
}) {
  const cidadePorChave = new Map(lugares.map((l) => [chaveDe(l.cidade), l.cidade]))

  const ativos: { chave: string; rotulo: string; remover: () => void }[] = [
    ...(busca ? [{ chave: 'busca', rotulo: busca, remover: () => setBusca('') }] : []),
    ...filtros.destinos.map((d) => ({
      chave: 'd:' + d,
      rotulo: cidadePorChave.get(d) ?? d,
      remover: () => setFiltros((f) => ({ ...f, destinos: f.destinos.filter((x) => x !== d) })),
    })),
    ...filtros.categorias.map((c) => ({
      chave: 'c:' + c,
      rotulo: CATEGORIAS[c].rotulo,
      remover: () => setFiltros((f) => ({ ...f, categorias: f.categorias.filter((x) => x !== c) })),
    })),
    ...filtros.participantes.map((p) => ({
      chave: 'p:' + p,
      rotulo: nomePorParticipante.get(p) ?? 'Participante',
      remover: () =>
        setFiltros((f) => ({ ...f, participantes: f.participantes.filter((x) => x !== p) })),
    })),
    ...(filtros.offline
      ? [
          {
            chave: 'offline',
            rotulo: 'Disponível offline',
            remover: () => setFiltros((f) => ({ ...f, offline: false })),
          },
        ]
      : []),
    ...(filtros.importantes
      ? [
          {
            chave: 'importantes',
            rotulo: 'Importantes',
            remover: () => setFiltros((f) => ({ ...f, importantes: false })),
          },
        ]
      : []),
  ]

  if (ativos.length === 0) return null

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="t-aux">Filtrando por</span>
      {ativos.map((a) => (
        <button
          key={a.chave}
          onClick={a.remover}
          aria-label={`Remover filtro ${a.rotulo}`}
          className="toque inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 text-[13px]"
          style={{
            background: 'var(--color-destaque-fraco)',
            borderColor: 'var(--destaque)',
            color: 'var(--destaque)',
          }}
        >
          {a.rotulo}
          <X size={12} aria-hidden />
        </button>
      ))}
      <button
        onClick={aoLimpar}
        className="toque cursor-pointer px-1 text-[13px] font-medium text-(--color-tinta-2) underline"
      >
        Limpar tudo
      </button>
    </div>
  )
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <Rotulo>{titulo}</Rotulo>
      <div className="mt-1.5 flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Caixa({
  marcada,
  aoMudar,
  children,
}: {
  marcada: boolean
  aoMudar: () => void
  children: React.ReactNode
}) {
  return (
    <label
      className="toque inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 text-[13px]"
      style={{
        background: marcada ? 'var(--color-destaque-fraco)' : 'var(--color-cartao)',
        borderColor: marcada ? 'var(--destaque)' : 'var(--color-borda)',
      }}
    >
      <input type="checkbox" checked={marcada} onChange={aoMudar} className="accent-(--destaque)" />
      {children}
    </label>
  )
}

/** §14: marcar e desmarcar offline em lote, sem sair para a ficha de cada um. */
function GerenciarOffline({
  documentos,
  salvos,
  erros,
  aoTrocar,
  aoFechar,
}: {
  documentos: Documento[]
  salvos: Set<string>
  erros: Map<string, string>
  aoTrocar: (doc: Documento, offline: boolean) => Promise<void>
  aoFechar: () => void
}) {
  const arquivos = ordenarDocumentos(documentos.filter(temArquivo))

  return (
    <AppModal
      titulo="Gerenciar offline"
      descricao="Escolha o que precisa abrir sem internet."
      tamanho="medio"
      aoFechar={aoFechar}
      acoes={<Botao onClick={aoFechar}>Pronto</Botao>}
    >
      {arquivos.length === 0 ? (
        <p className="t-aux py-6 text-center">
          Nenhum documento com arquivo ainda. Números e links já viajam com a viagem.
        </p>
      ) : (
        <ul className="space-y-2">
          {arquivos.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-(--color-borda) p-3"
            >
              <div className="min-w-0">
                <p className="t-corpo truncate font-medium">{doc.titulo}</p>
                <p className="t-aux">{doc.cidade || doc.pais || 'Toda a viagem'}</p>
                {erros.get(doc.id) && (
                  <p className="t-aux text-(--color-perigo-ink)">{erros.get(doc.id)}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <SeloOffline status={statusOffline(doc, salvos, new Set(erros.keys()))} curto />
                <input
                  type="checkbox"
                  checked={Boolean(doc.offline)}
                  onChange={(e) => void aoTrocar(doc, e.target.checked)}
                  aria-label={`Manter ${doc.titulo} disponível offline`}
                  className="toque accent-(--destaque)"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </AppModal>
  )
}

export { AdminAcoes }
