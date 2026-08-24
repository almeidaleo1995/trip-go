'use client'

import { useState } from 'react'
import type { z } from 'zod'
import { Check, AlertTriangle } from 'lucide-react'
import { useTrip } from '../TripProvider.tsx'
import { Badge, Cartao, Progresso, Rotulo, Titulo, Vazio } from '../ui.tsx'
import { AdminAcoes } from '../EditorSheet.tsx'
import { progressoChecklist, formatarData, parseData } from '@/lib/derive.ts'
import type { ChecklistItemSchema } from '@/lib/schema.ts'

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
  const { snapshot, mutate } = useTrip()
  const [visao, setVisao] = useState<Visao>('categoria')
  if (!snapshot) return null

  const itens = snapshot.checklist as unknown as ChecklistItem[]
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

  if (itens.length === 0) {
    return (
      <>
        <Titulo acao={<AdminAcoes entidade="checklist_item">Item</AdminAcoes>}>Checklist</Titulo>
        <div className="mb-4">
          <Progresso pct={0} />
        </div>
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
      <Titulo acao={<AdminAcoes entidade="checklist_item">Item</AdminAcoes>}>Checklist</Titulo>
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
    <button
      onClick={onToggle}
      className="quebra-evitar flex w-full cursor-pointer items-start gap-3 rounded-2xl border border-(--color-borda) bg-(--color-cartao) p-3.5 text-left transition-colors"
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
  )
}
