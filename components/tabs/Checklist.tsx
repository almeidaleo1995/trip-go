'use client'

import { useState, useEffect, useMemo, type ChangeEvent } from 'react'
import type { z } from 'zod'
import {
  Check,
  AlertTriangle,
  Upload,
  FileText,
  Briefcase,
  Shirt,
  HeartPulse,
  Wallet,
  Smartphone,
  CalendarCheck,
  MapPin,
  Siren,
  RotateCcw,
  ClipboardList,
  type LucideIcon,
} from 'lucide-react'
import { useTrip } from '../TripProvider.tsx'
import { Badge, Cartao, Progresso, Rotulo, Titulo, Vazio, AppModal, Botao, Avatar, useAviso } from '../ui.tsx'
import { AdminAcoes } from '../EditorSheet.tsx'
import { progressoChecklist, formatarData, parseData } from '@/lib/derive.ts'
import { ChecklistSugestoesBatchSchema, type ChecklistItemSchema } from '@/lib/schema.ts'
import { resolverSugestoes, type ContextoResolucao, type ResultadoResolucao } from '@/lib/checklist.ts'
import { buscarClima, descricaoClima, type PrevisaoDia } from '@/lib/clima.ts'

type ChecklistItem = z.infer<typeof ChecklistItemSchema>
type EstadoLinha = { traveler_id: string; item_id: string; feito: boolean }
type Participante = { id: string; nome: string; avatar_url?: string | null }

const agora = () => new Date().toISOString()

type Visao = 'categoria' | 'pessoa' | 'destino' | 'tudo'

const VISOES: { id: Visao; nome: string }[] = [
  { id: 'categoria', nome: 'Por categoria' },
  { id: 'pessoa', nome: 'Por pessoa' },
  { id: 'destino', nome: 'Por destino' },
  { id: 'tudo', nome: 'Tudo' },
]

/** Ícone por categoria — mesmo padrão de `Roteiro.tsx` (mapa + fallback), só
    para dar identidade visual ao cartão; não é fonte de verdade nenhuma. */
const ICONE_CATEGORIA: Record<string, LucideIcon> = {
  documentos: FileText,
  bagagem: Briefcase,
  roupas: Shirt,
  saude: HeartPulse,
  dinheiro: Wallet,
  eletronicos: Smartphone,
  reservas: CalendarCheck,
  destino: MapPin,
  emergencia: Siren,
  retorno: RotateCcw,
}
const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
function iconeCategoria(nome: string): LucideIcon {
  return ICONE_CATEGORIA[semAcento(nome)] ?? ClipboardList
}

/** Agrupa os itens JÁ visíveis para quem pediu (o filtro de privacidade é do
    servidor, ver checklistDaViagem) — nenhuma visão aqui esconde item nenhum,
    só reorganiza (CHK-07, e mantém CHK-09: atrasado nunca some de visão nenhuma). */
function agrupar(
  itens: ChecklistItem[],
  visao: Visao,
  participantes: { id: string; nome: string }[],
): { titulo: string; itens: ChecklistItem[] }[] {
  if (visao === 'tudo') return itens.length > 0 ? [{ titulo: 'Todos os itens', itens }] : []

  if (visao === 'pessoa') {
    return participantes
      .map((p) => ({
        titulo: p.nome,
        itens: itens.filter((i) => i.assigned_to.length === 0 || i.assigned_to.includes(p.id)),
      }))
      .filter((g) => g.itens.length > 0)
  }

  const mapa = new Map<string, ChecklistItem[]>()
  for (const i of itens) {
    const chave =
      visao === 'categoria'
        ? i.categoria?.trim() || 'Sem categoria'
        : [i.cidade, i.pais].filter(Boolean).join(', ') || 'Sem destino'
    mapa.set(chave, [...(mapa.get(chave) ?? []), i])
  }
  return [...mapa.entries()].map(([titulo, itens]) => ({ titulo, itens }))
}

/** Cartão de resumo de uma categoria, no carrossel do topo — só leitura, não
    filtra nada (filtrar por categoria já existe via a visão "Por categoria"). */
function CartaoCategoria({
  nome,
  Icone,
  total,
  feitos,
}: {
  nome: string
  Icone: LucideIcon
  total: number
  feitos: number
}) {
  const pct = total > 0 ? Math.round((feitos / total) * 100) : 0
  return (
    <div className="quebra-evitar flex w-40 shrink-0 flex-col rounded-2xl border border-(--color-borda) bg-(--color-cartao) p-3.5">
      <div
        className="mb-2.5 flex h-9 w-9 items-center justify-center rounded-xl"
        style={{ background: 'var(--color-destaque-fraco)', color: 'var(--destaque)' }}
      >
        <Icone size={18} />
      </div>
      <span className="truncate font-medium">{nome}</span>
      <span className="tab-num mb-2 text-[12px] text-(--color-tinta-3)">
        {feitos}/{total} {total === 1 ? 'item' : 'itens'}
      </span>
      <Progresso pct={pct} />
    </div>
  )
}

/** Avatar clicável da linha de filtro por pessoa — não é privacidade (isso já
    veio filtrado do servidor), só reorganização visual (CHK-07). */
function FiltroPessoa({
  nome,
  url,
  quantidade,
  selecionado,
  onClick,
}: {
  nome: string
  url?: string | null
  quantidade: number
  selecionado: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selecionado}
      className="flex shrink-0 cursor-pointer flex-col items-center gap-1.5 rounded-xl px-2 py-1.5 text-center transition-colors"
      style={{ background: selecionado ? 'var(--color-destaque-tenue)' : 'transparent' }}
    >
      <span
        className="rounded-full"
        style={{ boxShadow: selecionado ? '0 0 0 2px var(--destaque)' : 'none' }}
      >
        <Avatar nome={nome} url={url} tamanho={40} />
      </span>
      <span className="max-w-16 truncate text-[11px] font-medium text-(--color-tinta-2)">
        {nome.split(' ')[0]}
      </span>
      <span className="tab-num text-[10px] text-(--color-tinta-3)">{quantidade}</span>
    </button>
  )
}

/** Anel de progresso — não existia equivalente circular em `ui.tsx` (só o
    linear `Progresso`), então é SVG puro, sem nova dependência. */
function AnelProgresso({ pct, tamanho = 128 }: { pct: number; tamanho?: number }) {
  const espessura = 10
  const raio = (tamanho - espessura) / 2
  const circunferencia = 2 * Math.PI * raio
  const limitado = Math.min(100, Math.max(0, pct))
  const meio = tamanho / 2
  return (
    <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`} role="img" aria-label={`${pct}% concluído`}>
      <circle cx={meio} cy={meio} r={raio} fill="none" stroke="var(--color-superficie-2)" strokeWidth={espessura} />
      <circle
        cx={meio}
        cy={meio}
        r={raio}
        fill="none"
        stroke="var(--destaque)"
        strokeWidth={espessura}
        strokeLinecap="round"
        strokeDasharray={circunferencia}
        strokeDashoffset={circunferencia * (1 - limitado / 100)}
        transform={`rotate(-90 ${meio} ${meio})`}
        style={{ transition: 'stroke-dashoffset var(--transicao)' }}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="tab-num"
        style={{ fontSize: tamanho * 0.22, fontWeight: 700, fill: 'var(--color-tinta)' }}
      >
        {pct}%
      </text>
    </svg>
  )
}

function LinhaResumo({ cor, rotulo, valor }: { cor: string; rotulo: string; valor: number }) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cor }} aria-hidden />
      <span className="flex-1 text-(--color-tinta-2)">{rotulo}</span>
      <span className="tab-num font-semibold">{valor}</span>
    </div>
  )
}

export function Checklist() {
  const { snapshot, mutate, posso } = useTrip()
  const [visao, setVisao] = useState<Visao>('categoria')
  const [pessoaFiltro, setPessoaFiltro] = useState<string>('todos')
  // Lazy init (não useMemo): mesmo motivo do Dicas() logo abaixo — "vencido"
  // não precisa do milissegundo exato, só não pode chamar Date.now() no corpo
  // puro do render. Nome diferente do `agora()` de topo de arquivo (helper de
  // timestamp ISO) para não sombrear.
  const [agoraMs] = useState(() => Date.now())
  if (!snapshot) return null

  const todosOsItens = snapshot.checklist as unknown as ChecklistItem[]
  // Sugestão pendente nunca aparece nas visões normais — só na seção de
  // revisão abaixo, até o admin aceitar ou rejeitar (CHK-13, CHK-20).
  const itens = todosOsItens.filter((i) => !i.pendente)
  const pendentes = todosOsItens.filter((i) => i.pendente)
  const estados = snapshot.checklist_state as EstadoLinha[]
  const meuId = snapshot.eu.participanteId
  const souProprietario = snapshot.eu.papel === 'proprietario'
  const participantes = snapshot.participantes as Participante[]

  const meus = Object.fromEntries(
    estados.filter((e) => e.traveler_id === meuId).map((e) => [String(e.item_id), e.feito]),
  )

  const relevantePara = (i: ChecklistItem, participanteId: string) =>
    i.escopo === 'global' || i.assigned_to.includes(participanteId)

  // Linha de avatares filtra por pessoa (visual, CHK-07) — a privacidade real
  // já aconteceu no servidor (checklistDaViagem), isso só reorganiza a tela.
  const itensFiltrados =
    pessoaFiltro === 'todos' ? itens : itens.filter((i) => relevantePara(i, pessoaFiltro))
  const progresso = progressoChecklist(itensFiltrados as { id: string }[], meus)
  const vencidos = itensFiltrados.filter((i) => {
    if (meus[String(i.id)]) return false
    const limite = parseData(i.prazo_maximo)
    return limite !== null && limite.getTime() < agoraMs
  }).length

  /** Quantos viajantes concluíram um item global (CHK-03). */
  const quantosFizeram = (itemId: string) =>
    estados.filter((e) => String(e.item_id) === itemId && e.feito).length
  const totalParticipantes = participantes.length

  const alternar = (item: ChecklistItem) =>
    mutate({
      op: 'editar',
      entidade: 'checklist_state',
      campos: { item_id: String(item.id), feito: !meus[String(item.id)] },
      client_ts: agora(),
    })

  const titulo = (
    <Titulo
      acao={
        <>
          <ImportarSugestoes />
          <AdminAcoes entidade="checklist_item">Item</AdminAcoes>
        </>
      }
    >
      Checklist
    </Titulo>
  )

  if (itens.length === 0) {
    return (
      <>
        {titulo}
        <div className="mb-4">
          <Progresso pct={0} />
        </div>
        {posso('editor') && pendentes.length > 0 && <Pendentes itens={pendentes} />}
        <Vazio
          titulo="Checklist vazio"
          texto="Quando houver tarefas cadastradas, elas aparecem aqui para marcar."
        />
      </>
    )
  }

  const grupos = agrupar(itensFiltrados, visao, participantes)
  // O carrossel de categorias é visão geral: sempre sobre todos os itens, não
  // sobre `itensFiltrados` — trocar de pessoa no filtro não some com cartão.
  const categorias = agrupar(itens, 'categoria', participantes)

  return (
    <>
      {titulo}

      <div className="mb-5 -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1">
        {categorias.map((c) => (
          <CartaoCategoria
            key={c.titulo}
            nome={c.titulo}
            Icone={iconeCategoria(c.titulo)}
            total={c.itens.length}
            feitos={c.itens.filter((i) => meus[String(i.id)]).length}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap gap-1.5">
            {VISOES.map((v) => (
              <button
                key={v.id}
                onClick={() => setVisao(v.id)}
                aria-pressed={visao === v.id}
                className="cursor-pointer rounded-full border px-3 py-1 text-[12px] font-medium transition-colors"
                style={{
                  borderColor: visao === v.id ? 'var(--destaque)' : 'var(--color-borda-forte)',
                  background: visao === v.id ? 'var(--color-destaque-tenue)' : 'transparent',
                  color: visao === v.id ? 'var(--destaque)' : 'var(--color-tinta-2)',
                }}
              >
                {v.nome}
              </button>
            ))}
          </div>

          <div className="mb-5 flex gap-1 overflow-x-auto pb-1">
            <FiltroPessoa
              nome="Todos"
              quantidade={itens.length}
              selecionado={pessoaFiltro === 'todos'}
              onClick={() => setPessoaFiltro('todos')}
            />
            {participantes.map((p) => (
              <FiltroPessoa
                key={p.id}
                nome={p.nome}
                url={p.avatar_url}
                quantidade={itens.filter((i) => relevantePara(i, p.id)).length}
                selecionado={pessoaFiltro === p.id}
                onClick={() => setPessoaFiltro(p.id)}
              />
            ))}
          </div>

          {posso('editor') && pendentes.length > 0 && <Pendentes itens={pendentes} />}

          {grupos.length === 0 ? (
            <Vazio titulo="Nada por aqui" texto="Ninguém tem item nesta pessoa ou categoria." />
          ) : (
            grupos.map((g) => (
              <Secao key={g.titulo} titulo={g.titulo}>
                {g.itens.map((i) => (
                  <ItemChecklist
                    key={String(i.id)}
                    item={i}
                    feito={Boolean(meus[String(i.id)])}
                    onToggle={() => alternar(i)}
                    grupo={
                      i.escopo === 'global'
                        ? `${quantosFizeram(String(i.id))}/${totalParticipantes}`
                        : undefined
                    }
                    participantes={participantes}
                  />
                ))}
              </Secao>
            ))
          )}
        </div>

        <div className="space-y-4">
          <Cartao className="text-center">
            <Rotulo>Seu progresso geral</Rotulo>
            <div className="my-3 flex justify-center">
              <AnelProgresso pct={progresso.pct} />
            </div>
            <div className="space-y-1.5 text-left">
              <LinhaResumo cor="var(--destaque)" rotulo="Concluídos" valor={progresso.feitos} />
              <LinhaResumo
                cor="var(--color-borda-forte)"
                rotulo="Pendentes"
                valor={progresso.total - progresso.feitos}
              />
              <LinhaResumo cor="var(--color-perigo-ink)" rotulo="Vencidos" valor={vencidos} />
            </div>
            <p className="mt-3 text-[12px] text-(--color-tinta-3)">
              Suas marcações sincronizam entre os aparelhos quando há internet. Sem rede, ficam
              salvas aqui e sobem sozinhas depois.
            </p>
          </Cartao>

          {/* Progresso por pessoa: só quem administra vê, porque calcular
              direito exige enxergar o item pessoal de cada um (checklistDaViagem). */}
          {souProprietario && (
            <Cartao>
              <Rotulo>Progresso por pessoa</Rotulo>
              <div className="mt-3 space-y-2">
                {participantes.map((p) => {
                  const estadoDaPessoa = Object.fromEntries(
                    estados
                      .filter((e) => e.traveler_id === p.id)
                      .map((e) => [String(e.item_id), e.feito]),
                  )
                  const relevantes = itens.filter((i) => relevantePara(i, p.id))
                  const pp = progressoChecklist(relevantes as { id: string }[], estadoDaPessoa)
                  return (
                    <div key={p.id} className="flex items-center gap-2 text-[12px]">
                      <span className="w-16 shrink-0 truncate text-(--color-tinta-2)">
                        {p.nome.split(' ')[0]}
                      </span>
                      <div className="flex-1">
                        <Progresso pct={pp.pct} />
                      </div>
                      <span className="tab-num w-9 shrink-0 text-right font-semibold text-(--color-tinta-3)">
                        {pp.pct}%
                      </span>
                    </div>
                  )
                })}
              </div>
            </Cartao>
          )}

          <Dicas />
          <Clima />
        </div>
      </div>
    </>
  )
}

/**
 * Lê `dicas` dos próximos eventos do roteiro, sem gerar texto novo (CHK-22).
 * Painel some sozinho quando não há nada — nunca mostra uma seção vazia.
 */
type EventoDica = { dicas?: string | null; ocorre_em?: string | null }

function Dicas() {
  const { snapshot } = useTrip()
  // useState (não useMemo): o inicializador lazy é o lugar certo para uma
  // leitura impura como Date.now() — "próximo" não precisa do milissegundo
  // exato, só não pode rodar dentro do corpo puro do render.
  const [agora] = useState(() => Date.now())
  if (!snapshot) return null

  const linhas: string[] = []
  for (const e of snapshot.roteiro as EventoDica[]) {
    if (!e.dicas) continue
    // `ocorre_em` chega do /api/snapshot com sufixo Z (timestamp completo,
    // sem ambiguidade) — não é o mesmo caso que parseData existe para
    // resolver (data sem hora, que o construtor de Date lê como UTC).
    const data = e.ocorre_em ? new Date(String(e.ocorre_em)) : null
    if (!data || Number.isNaN(data.getTime()) || data.getTime() < agora) continue
    for (const linha of String(e.dicas)
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean)) {
      linhas.push(linha)
    }
  }
  if (linhas.length === 0) return null

  return (
    <Cartao className="mb-4">
      <Rotulo>Dicas para não esquecer nada</Rotulo>
      <ul className="mt-2 space-y-1.5 text-sm text-(--color-tinta-2)">
        {linhas.slice(0, 8).map((texto, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden>·</span>
            <span>{texto}</span>
          </li>
        ))}
      </ul>
    </Cartao>
  )
}

/**
 * Clima ao vivo (Open-Meteo, sem chave) dos próximos destinos com coordenada
 * conhecida. Nunca mostra nada sem dado de verdade (CHK-23) — sem coordenada,
 * sem rede, ou resposta inesperada, a cidade simplesmente não entra na lista.
 */
type LugarComCoordenada = {
  cidade: string
  lat?: number | string | null
  lon?: number | string | null
  status?: string | null
}

function Clima() {
  const { snapshot } = useTrip()
  const [previsoes, setPrevisoes] = useState<Record<string, PrevisaoDia[]>>({})

  const lugares = useMemo(() => {
    if (!snapshot) return []
    return (snapshot.lugares as LugarComCoordenada[])
      .filter((l) => l.lat != null && l.lon != null && l.status !== 'visitada')
      .slice(0, 3)
  }, [snapshot])

  useEffect(() => {
    let cancelado = false
    Promise.all(
      lugares.map(async (l) => {
        const previsao = await buscarClima(Number(l.lat), Number(l.lon), 3)
        return [String(l.cidade), previsao] as const
      }),
    ).then((resultados) => {
      if (cancelado) return
      const validos = resultados.filter(
        (r): r is [string, PrevisaoDia[]] => r[1] !== null && r[1].length > 0,
      )
      setPrevisoes(Object.fromEntries(validos))
    })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lugares.map((l) => l.cidade).join(',')])

  const cidades = Object.keys(previsoes)
  if (cidades.length === 0) return null

  return (
    <Cartao className="mb-4">
      <Rotulo>Clima nos próximos destinos</Rotulo>
      <div className="mt-2 space-y-1.5">
        {cidades.map((cidade) => {
          const hoje = previsoes[cidade][0]
          return (
            <div key={cidade} className="flex items-center justify-between text-sm">
              <span className="font-medium">{cidade}</span>
              <span className="text-(--color-tinta-2)">
                {descricaoClima(hoje.codigo)} · {Math.round(hoje.tempMin)}° – {Math.round(hoje.tempMax)}°
              </span>
            </div>
          )
        })}
      </div>
    </Cartao>
  )
}

const NOME_FONTE: Record<string, string> = {
  documento: 'Documento enviado',
  pesquisa: 'Pesquisado pela skill',
  sugestao: 'Sugestão da skill',
  manual: 'Adicionado manualmente',
}

/**
 * Sugestões da skill ainda não revisadas. Aceitar só troca `pendente` para
 * `false` — preserva fonte/detalhe/data (CHK-16). Rejeitar apaga a linha, sem
 * rastro (CHK-17). Nenhuma das duas acontece sozinha (CHK-20): as duas exigem
 * clique explícito daqui.
 */
function Pendentes({ itens }: { itens: ChecklistItem[] }) {
  const { mutate } = useTrip()

  const aceitar = (item: ChecklistItem) =>
    mutate({
      op: 'editar',
      entidade: 'checklist_item',
      id: String(item.id),
      campos: { pendente: false },
      client_ts: agora(),
    })

  const rejeitar = (item: ChecklistItem) =>
    mutate({
      op: 'remover',
      entidade: 'checklist_item',
      id: String(item.id),
      campos: {},
      client_ts: agora(),
    })

  return (
    <Cartao tom="atencao" className="mb-4">
      <Rotulo>Sugestões pendentes de revisão · {itens.length}</Rotulo>
      <div className="mt-2 space-y-2">
        {itens.map((item) => (
          <div
            key={String(item.id)}
            className="rounded-2xl border border-(--color-borda) bg-(--color-cartao) p-3.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{item.titulo}</p>
                <p className="mt-1 text-[12px] text-(--color-tinta-3)">
                  {NOME_FONTE[item.fonte_tipo ?? ''] ?? 'Sugestão'}
                  {item.fonte_detalhe && <> · {item.fonte_detalhe}</>}
                  {item.fonte_consultado_em && (
                    <> · consultado em {formatarData(item.fonte_consultado_em)}</>
                  )}
                </p>
              </div>
              <AdminAcoes entidade="checklist_item" registro={item} />
            </div>
            <div className="mt-2.5 flex gap-2">
              <Botao tamanho="pequeno" onClick={() => aceitar(item)}>
                Aceitar
              </Botao>
              <Botao tamanho="pequeno" variante="secundario" onClick={() => rejeitar(item)}>
                Rejeitar
              </Botao>
            </div>
          </div>
        ))}
      </div>
    </Cartao>
  )
}

/**
 * Carrega um arquivo `ChecklistSugestoesBatchSchema` (saída da skill
 * viagem-para-json), resolve nomes -> ids contra a viagem atual e grava as
 * válidas como `checklist_item` com `pendente: true` — nunca confirmadas
 * sozinhas (CHK-13, CHK-20). A revisão em si é a lista normal filtrada por
 * pendente (ver `Pendentes` acima).
 */
function ImportarSugestoes() {
  const { snapshot, mutate, posso } = useTrip()
  const avisar = useAviso()
  const [resultado, setResultado] = useState<ResultadoResolucao | null>(null)
  const [enviando, setEnviando] = useState(false)

  if (!snapshot || !posso('editor')) return null

  async function aoEscolherArquivo(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (!arquivo || !snapshot) return

    let bruto: unknown
    try {
      bruto = JSON.parse(await arquivo.text())
    } catch {
      avisar('erro', 'Arquivo não é um JSON válido.')
      return
    }
    const parsed = ChecklistSugestoesBatchSchema.safeParse(bruto)
    if (!parsed.success) {
      avisar('erro', 'Arquivo não bate com o formato de sugestões de checklist esperado.')
      return
    }

    const contexto: ContextoResolucao = {
      participantes: snapshot.participantes.map((p) => ({ id: String(p.id), nome: String(p.nome) })),
      roteiro: snapshot.roteiro.map((e) => ({ id: String(e.id), titulo: String(e.titulo) })),
      voos: snapshot.voos.map((v) => ({
        id: String(v.id),
        companhia: String(v.companhia),
        numero: v.numero ?? null,
      })),
      cruzeiros: snapshot.cruzeiros.map((c) => ({ id: String(c.id), navio: String(c.navio) })),
      checklistExistente: (snapshot.checklist as { titulo: string }[]).map((c) => ({
        titulo: c.titulo,
      })),
    }
    setResultado(resolverSugestoes(parsed.data.sugestoes, contexto))
  }

  async function confirmar() {
    if (!resultado) return
    setEnviando(true)
    for (const item of resultado.validas) {
      await mutate({ op: 'criar', entidade: 'checklist_item', campos: item, client_ts: agora() })
    }
    setEnviando(false)
    avisar(
      'sucesso',
      `${resultado.validas.length} sugestão(ões) importada(s) como pendente — revise antes de confirmar.`,
    )
    setResultado(null)
  }

  return (
    <>
      <label className="sem-impressao toque inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-(--color-tinta-2) transition-colors hover:bg-(--color-superficie-2)">
        <Upload size={16} />
        Importar sugestões
        <input type="file" accept="application/json" className="hidden" onChange={aoEscolherArquivo} />
      </label>

      {resultado && (
        <AppModal
          titulo="Sugestões da skill"
          aoFechar={() => setResultado(null)}
          acoes={
            <>
              <Botao variante="secundario" onClick={() => setResultado(null)}>
                Cancelar
              </Botao>
              <Botao
                onClick={confirmar}
                carregando={enviando}
                desabilitado={resultado.validas.length === 0}
              >
                Importar {resultado.validas.length} como pendente
              </Botao>
            </>
          }
        >
          <p className="text-sm text-(--color-tinta-2)">
            <strong className="text-(--color-tinta)">{resultado.validas.length}</strong> prontas
            para importar
            {resultado.duplicadas > 0 && <> · {resultado.duplicadas} duplicada(s) descartada(s)</>}
            {resultado.erros.length > 0 && <> · {resultado.erros.length} com problema</>}
          </p>

          {resultado.erros.length > 0 && (
            <div className="mt-3 space-y-2">
              {resultado.erros.map((e, i) => (
                <div
                  key={i}
                  className="rounded-xl bg-(--color-perigo-bg) px-3 py-2 text-[13px] text-(--color-perigo-ink)"
                >
                  <strong>{e.sugestao.titulo}</strong> — {e.motivo}
                </div>
              ))}
            </div>
          )}

          {resultado.validas.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {resultado.validas.map((v, i) => (
                <div key={i} className="rounded-xl border border-(--color-borda) px-3 py-2 text-sm">
                  {v.titulo}
                </div>
              ))}
            </div>
          )}
        </AppModal>
      )}
    </>
  )
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <Rotulo>{titulo}</Rotulo>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  )
}

function ItemChecklist({
  item,
  feito,
  onToggle,
  grupo,
  participantes,
}: {
  item: ChecklistItem
  feito: boolean
  onToggle: () => void
  grupo?: string
  participantes: Participante[]
}) {
  // Lazy init (não useMemo): mesmo motivo do Dicas() abaixo — não pode chamar
  // Date.now() no corpo puro do render.
  const [agora] = useState(() => Date.now())
  // Prazo vencido só é alarme se o item ainda não foi feito.
  const limite = parseData(item.prazo_maximo)
  const vencido = !feito && limite !== null && limite.getTime() < agora

  return (
    <div className="quebra-evitar rounded-2xl border border-(--color-borda) bg-(--color-cartao) p-3.5 transition-colors">
      <button
        onClick={onToggle}
        className="flex w-full cursor-pointer items-start gap-3 text-left"
        aria-pressed={feito}
      >
        <span
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2"
          style={{
            borderColor: feito ? 'var(--destaque)' : 'var(--color-borda-forte)',
            background: feito ? 'var(--destaque)' : 'transparent',
            transition: 'all var(--transicao)',
          }}
        >
          {/* O check cresce ao entrar: é o único sinal de que a marcação pegou,
              já que a escrita é otimista e não há espera pela rede. */}
          {feito && <Check size={15} className="anim-subir text-white" strokeWidth={3} />}
        </span>

        <span className="min-w-0 flex-1">
          <span className={`block font-medium ${feito ? 'text-(--color-tinta-3) line-through' : ''}`}>
            {String(item.titulo)}
          </span>
          {item.detalhe && (
            <span className="mt-1 block text-[13px] text-(--color-tinta-2)">
              {String(item.detalhe)}
            </span>
          )}
          <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
            {item.categoria && (
              <span className="rounded-full bg-(--color-fundo) px-2 py-0.5 text-(--color-tinta-3)">
                {String(item.categoria)}
              </span>
            )}
            {item.prazo_ideal && (
              <span className="tab-num text-(--color-tinta-3)">
                ideal até {formatarData(item.prazo_ideal)}
              </span>
            )}
            {item.prazo_maximo &&
              (vencido ? (
                // Vencido é etiqueta com ícone, não só texto vermelho: cor sozinha
                // não é informação para quem não a distingue.
                <Badge
                  tipo="perigo"
                  icone={<AlertTriangle size={11} />}
                  texto={`Vencido · ${formatarData(item.prazo_maximo)}`}
                />
              ) : (
                <span className="tab-num font-semibold text-(--color-tinta-3)">
                  limite {formatarData(item.prazo_maximo)}
                </span>
              ))}
            {grupo && (
              <span className="tab-num rounded-full bg-(--color-destaque-fraco) px-2 py-0.5 font-semibold text-(--color-voo-ink)">
                {grupo} do grupo
              </span>
            )}
          </span>
        </span>

        {item.assigned_to.length > 0 && (
          <span className="mt-0.5 flex shrink-0 items-center gap-1">
            {item.assigned_to.slice(0, 3).map((id) => {
              const p = participantes.find((p) => p.id === id)
              return p ? <Avatar key={id} nome={p.nome} url={p.avatar_url} tamanho={20} /> : null
            })}
            {item.assigned_to.length > 3 && (
              <span className="tab-num flex h-5 w-5 items-center justify-center rounded-full bg-(--color-superficie-2) text-[9px] font-semibold text-(--color-tinta-3)">
                +{item.assigned_to.length - 3}
              </span>
            )}
          </span>
        )}
      </button>

      {item.fonte_tipo && <ExplicacaoFonte item={item} />}
    </div>
  )
}

/** "Por que estou vendo isso?" — só existe quando o item carrega fonte (CHK-21). */
function ExplicacaoFonte({ item }: { item: ChecklistItem }) {
  const [aberto, setAberto] = useState(false)
  return (
    <div className="mt-2 border-t border-(--color-borda) pt-2 pl-9">
      <button
        onClick={() => setAberto((a) => !a)}
        className="cursor-pointer text-[12px] font-medium text-(--destaque)"
      >
        Por que estou vendo isso?
      </button>
      {aberto && (
        <p className="mt-1 text-[12px] text-(--color-tinta-3)">
          {NOME_FONTE[item.fonte_tipo ?? ''] ?? 'Sugestão'}
          {item.fonte_detalhe && <> · {item.fonte_detalhe}</>}
          {item.fonte_consultado_em && <> · consultado em {formatarData(item.fonte_consultado_em)}</>}
        </p>
      )}
    </div>
  )
}
