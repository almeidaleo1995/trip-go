'use client'

import { useState, type ChangeEvent } from 'react'
import type { z } from 'zod'
import { Check, AlertTriangle, Upload } from 'lucide-react'
import { useTrip } from '../TripProvider.tsx'
import { Badge, Cartao, Progresso, Rotulo, Titulo, Vazio, AppModal, Botao, useAviso } from '../ui.tsx'
import { AdminAcoes } from '../EditorSheet.tsx'
import { progressoChecklist, formatarData, parseData } from '@/lib/derive.ts'
import { ChecklistSugestoesBatchSchema, type ChecklistItemSchema } from '@/lib/schema.ts'
import { resolverSugestoes, type ContextoResolucao, type ResultadoResolucao } from '@/lib/checklist.ts'

type ChecklistItem = z.infer<typeof ChecklistItemSchema>
type EstadoLinha = { traveler_id: string; item_id: string; feito: boolean }

const agora = () => new Date().toISOString()

type Visao = 'categoria' | 'pessoa' | 'destino' | 'tudo'

const VISOES: { id: Visao; nome: string }[] = [
  { id: 'categoria', nome: 'Por categoria' },
  { id: 'pessoa', nome: 'Por pessoa' },
  { id: 'destino', nome: 'Por destino' },
  { id: 'tudo', nome: 'Tudo' },
]

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

export function Checklist() {
  const { snapshot, mutate, posso } = useTrip()
  const [visao, setVisao] = useState<Visao>('categoria')
  if (!snapshot) return null

  const todosOsItens = snapshot.checklist as unknown as ChecklistItem[]
  // Sugestão pendente nunca aparece nas visões normais — só na seção de
  // revisão abaixo, até o admin aceitar ou rejeitar (CHK-13, CHK-20).
  const itens = todosOsItens.filter((i) => !i.pendente)
  const pendentes = todosOsItens.filter((i) => i.pendente)
  const estados = snapshot.checklist_state as EstadoLinha[]
  const meuId = snapshot.eu.participanteId
  const souProprietario = snapshot.eu.papel === 'proprietario'
  const participantes = snapshot.participantes as { id: string; nome: string }[]

  const meus = Object.fromEntries(
    estados.filter((e) => e.traveler_id === meuId).map((e) => [String(e.item_id), e.feito]),
  )
  const progresso = progressoChecklist(itens as { id: string }[], meus)

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

  const grupos = agrupar(itens, visao, participantes)

  return (
    <>
      {titulo}
      {posso('editor') && pendentes.length > 0 && <Pendentes itens={pendentes} />}
      <Cartao className="mb-4">
        <div className="mb-2 flex items-baseline justify-between">
          <Rotulo>Seu progresso</Rotulo>
          <span className="tab-num text-sm font-semibold">
            {progresso.feitos}/{progresso.total} · {progresso.pct}%
          </span>
        </div>
        <Progresso pct={progresso.pct} />
        <p className="mt-2.5 text-[12px] text-(--color-tinta-3)">
          Suas marcações sincronizam entre os aparelhos quando há internet. Sem rede, ficam salvas
          aqui e sobem sozinhas depois.
        </p>

        {/* Progresso por pessoa: só quem administra vê, porque calcular direito
            exige enxergar o item pessoal de cada um (ver checklistDaViagem). */}
        {souProprietario && (
          <div className="mt-3.5 space-y-2 border-t border-(--color-borda) pt-3.5">
            {participantes.map((p) => {
              const estadoDaPessoa = Object.fromEntries(
                estados.filter((e) => e.traveler_id === p.id).map((e) => [String(e.item_id), e.feito]),
              )
              const relevantes = itens.filter(
                (i) => i.escopo === 'global' || i.assigned_to.includes(p.id),
              )
              const pp = progressoChecklist(relevantes as { id: string }[], estadoDaPessoa)
              return (
                <div key={p.id} className="flex items-center gap-2 text-[12px]">
                  <span className="w-24 shrink-0 truncate text-(--color-tinta-2)">{p.nome}</span>
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
        )}
      </Cartao>

      <Dicas />

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

      {grupos.map((g) => (
        <Secao key={g.titulo} titulo={g.titulo}>
          {g.itens.map((i) => (
            <ItemChecklist
              key={String(i.id)}
              item={i}
              feito={Boolean(meus[String(i.id)])}
              onToggle={() => alternar(i)}
              grupo={i.escopo === 'global' ? `${quantosFizeram(String(i.id))}/${totalParticipantes}` : undefined}
            />
          ))}
        </Secao>
      ))}
    </>
  )
}

/**
 * Lê `dicas` dos próximos eventos do roteiro, sem gerar texto novo (CHK-22).
 * Painel some sozinho quando não há nada — nunca mostra uma seção vazia.
 */
function Dicas() {
  const { snapshot } = useTrip()
  if (!snapshot) return null

  const agora = Date.now()
  const linhas: string[] = []
  for (const e of snapshot.roteiro as Record<string, any>[]) {
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
}: {
  item: ChecklistItem
  feito: boolean
  onToggle: () => void
  grupo?: string
}) {
  // Prazo vencido só é alarme se o item ainda não foi feito.
  const limite = parseData(item.prazo_maximo)
  const vencido = !feito && limite !== null && limite.getTime() < Date.now()

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
