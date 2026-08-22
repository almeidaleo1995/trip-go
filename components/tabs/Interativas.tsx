'use client'

// Abas que escrevem: Emergência (leitura, mas crítica) e Checklist.
// O Financeiro tem tela própria em tabs/Financeiro.tsx — ele deixou de ser uma
// lista de custos e virou um módulo com divisão, parcelas e acertos.
import { useState } from 'react'
import { Phone, Check, AlertTriangle } from 'lucide-react'
import { useTrip } from '../TripProvider.tsx'
import { Badge, Cartao, Progresso, Rotulo, Titulo, Vazio } from '../ui.tsx'
import { AdminAcoes } from '../EditorSheet.tsx'
import { progressoChecklist, formatarData, parseData } from '@/lib/derive.ts'

const agora = () => new Date().toISOString()

// ---------------------------------------------------------------- Emergência

export function Emergencia() {
  const { snapshot } = useTrip()
  const contatos = (snapshot?.emergencia ?? []) as any[]

  // Fonte maior que as demais abas de propósito (EMG-04): esta tela é lida sob
  // estresse, às vezes por outra pessoa segurando o celular.
  return (
    <div className="text-[17px]">
      <Titulo acao={<AdminAcoes entidade="emergencia">Contato</AdminAcoes>}>Emergência</Titulo>
      <p className="-mt-2 mb-4 text-sm text-(--color-tinta-2)">
        Funciona sem internet. Toque no número para ligar.
      </p>

      {contatos.length === 0 ? (
        <Vazio
          titulo="Nenhum contato cadastrado"
          texto="Telefones de emergência, consulados e seguro aparecem aqui."
        />
      ) : (
        <div className="space-y-2.5">
          {contatos.map((c) => (
            <Cartao key={String(c.id)}>
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold">{String(c.titulo)}</p>
                <AdminAcoes entidade="emergencia" registro={c} />
              </div>
              {c.detalhe && (
                <p className="mt-1 text-[15px] text-(--color-tinta-2)">{String(c.detalhe)}</p>
              )}
              {c.telefone ? (
                <a
                  href={`tel:${String(c.telefone).replace(/[^\d+]/g, '')}`}
                  className="tab-num toque mt-2.5 inline-flex items-center gap-2 rounded-xl px-4 text-lg font-bold text-white"
                  style={{ background: 'var(--destaque)' }}
                >
                  <Phone size={18} /> {String(c.telefone)}
                </a>
              ) : (
                <p className="mt-2 inline-block rounded-full bg-(--color-alerta-bg) px-3 py-1 text-[13px] font-semibold text-(--color-alerta-ink)">
                  A preencher
                </p>
              )}
            </Cartao>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Checklist

export function Checklist() {
  const { snapshot, mutate } = useTrip()
  if (!snapshot) return null

  const itens = snapshot.checklist as any[]
  const meuId = snapshot.eu.participanteId

  const meus = Object.fromEntries(
    snapshot.checklist_state
      .filter((e) => e.traveler_id === meuId)
      .map((e) => [String(e.item_id), Boolean(e.feito)]),
  )
  const progresso = progressoChecklist(itens as { id: string }[], meus)

  /** Quantos viajantes concluíram um item global (CHK-03). */
  const quantosFizeram = (itemId: string) =>
    snapshot.checklist_state.filter((e) => String(e.item_id) === itemId && e.feito).length

  const globais = itens.filter((i) => i.escopo === 'global')
  const pessoais = itens.filter((i) => i.escopo === 'pessoal')
  const total = snapshot.participantes.length

  const alternar = (item: any) =>
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
      </Cartao>

      {globais.length > 0 && (
        <Secao titulo="Da viagem">
          {globais.map((i) => (
            <ItemChecklist
              key={String(i.id)}
              item={i}
              feito={Boolean(meus[String(i.id)])}
              onToggle={() => alternar(i)}
              grupo={`${quantosFizeram(String(i.id))}/${total}`}
            />
          ))}
        </Secao>
      )}

      {pessoais.length > 0 && (
        <Secao titulo="Seus">
          {pessoais.map((i) => (
            <ItemChecklist
              key={String(i.id)}
              item={i}
              feito={Boolean(meus[String(i.id)])}
              onToggle={() => alternar(i)}
            />
          ))}
        </Secao>
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
  item: any
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
