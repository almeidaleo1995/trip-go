'use client'

// Abas que escrevem: Emergência (leitura, mas crítica), Checklist e Financeiro.
import { useState } from 'react'
import { Phone, Plus, Trash2, Check } from 'lucide-react'
import { useTrip } from '../TripProvider.tsx'
import { Cartao, Vazio, Rotulo, Titulo, Progresso, Botao } from '../ui.tsx'
import {
  progressoChecklist,
  formatarData,
  formatarDinheiro,
  totaisFinanceiro,
  parseData,
} from '@/lib/derive.ts'

const agora = () => new Date().toISOString()

// ---------------------------------------------------------------- Emergência

export function Emergencia() {
  const { snapshot } = useTrip()
  const contatos = (snapshot?.emergencia ?? []) as any[]

  // Fonte maior que as demais abas de propósito (EMG-04): esta tela é lida sob
  // estresse, às vezes por outra pessoa segurando o celular.
  return (
    <div className="text-[17px]">
      <Titulo>Emergência</Titulo>
      <p className="-mt-2 mb-4 text-sm text-[--color-tinta-2]">
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
              <p className="font-semibold">{String(c.titulo)}</p>
              {c.detalhe && (
                <p className="mt-1 text-[15px] text-[--color-tinta-2]">{String(c.detalhe)}</p>
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
                <p className="mt-2 inline-block rounded-full bg-[--color-alerta-bg] px-3 py-1 text-[13px] font-semibold text-[--color-alerta-ink]">
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
  const meuId = snapshot.sessao.travelerId

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
  const total = snapshot.viajantes.length

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
        <Titulo>Checklist</Titulo>
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
      <Titulo>Checklist</Titulo>
      <Cartao className="mb-4">
        <div className="mb-2 flex items-baseline justify-between">
          <Rotulo>Seu progresso</Rotulo>
          <span className="tab-num text-sm font-semibold">
            {progresso.feitos}/{progresso.total} · {progresso.pct}%
          </span>
        </div>
        <Progresso pct={progresso.pct} />
        <p className="mt-2.5 text-[12px] text-[--color-tinta-3]">
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
      className="quebra-evitar flex w-full cursor-pointer items-start gap-3 rounded-2xl border border-[--color-borda] bg-[--color-cartao] p-3.5 text-left transition-colors"
      aria-pressed={feito}
    >
      <span
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 transition-colors"
        style={{
          borderColor: feito ? 'var(--destaque)' : 'var(--color-borda)',
          background: feito ? 'var(--destaque)' : 'transparent',
        }}
      >
        {feito && <Check size={15} className="text-white" strokeWidth={3} />}
      </span>

      <span className="min-w-0 flex-1">
        <span className={`block font-medium ${feito ? 'text-[--color-tinta-3] line-through' : ''}`}>
          {String(item.titulo)}
        </span>
        {item.detalhe && (
          <span className="mt-1 block text-[13px] text-[--color-tinta-2]">
            {String(item.detalhe)}
          </span>
        )}
        <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
          {item.categoria && (
            <span className="rounded-full bg-[--color-fundo] px-2 py-0.5 text-[--color-tinta-3]">
              {String(item.categoria)}
            </span>
          )}
          {item.prazo_ideal && (
            <span className="tab-num text-[--color-tinta-3]">
              ideal até {formatarData(item.prazo_ideal)}
            </span>
          )}
          {item.prazo_maximo && (
            <span
              className="tab-num font-semibold"
              style={{ color: vencido ? 'var(--color-alerta-ink)' : 'var(--color-tinta-3)' }}
            >
              limite {formatarData(item.prazo_maximo)}
              {vencido ? ' · vencido' : ''}
            </span>
          )}
          {grupo && (
            <span className="tab-num rounded-full bg-[--color-destaque-fraco] px-2 py-0.5 font-semibold text-[--color-voo-ink]">
              {grupo} do grupo
            </span>
          )}
        </span>
      </span>
    </button>
  )
}

// ---------------------------------------------------------------- Financeiro

export function Financeiro() {
  const { snapshot, mutate, souAdmin } = useTrip()
  const [novo, setNovo] = useState(false)

  // Defesa em profundidade: a aba não é montada para viajante, e mesmo assim o
  // snapshot dele não traz financeiro. Duas travas, nenhuma delas decorativa.
  if (!souAdmin || !snapshot?.financeiro) return null

  const { categorias, custos } = snapshot.financeiro
  const moeda = String(snapshot.viagem?.moeda ?? 'BRL')
  const totais = totaisFinanceiro(custos as any[])
  const pago = (custos as any[])
    .filter((c) => c.pago)
    .reduce((s, c) => s + Number(c.valor_centavos) * Number(c.pessoas), 0)

  return (
    <>
      <Titulo
        acao={
          <Botao onClick={() => setNovo(true)}>
            <Plus size={16} /> Custo
          </Botao>
        }
      >
        Financeiro
      </Titulo>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Resumo rotulo="Total" valor={formatarDinheiro(totais.total, moeda)} destaque />
        <Resumo rotulo="Já pago" valor={formatarDinheiro(pago, moeda)} />
        <Resumo rotulo="A pagar" valor={formatarDinheiro(totais.total - pago, moeda)} />
      </div>

      {novo && (
        <FormularioCusto
          categorias={categorias as any[]}
          aoFechar={() => setNovo(false)}
          aoSalvar={(campos) => {
            mutate({
              op: 'criar',
              entidade: 'custo',
              id: crypto.randomUUID(),
              campos,
              client_ts: agora(),
            })
            setNovo(false)
          }}
        />
      )}

      {custos.length === 0 && !novo ? (
        <Vazio
          titulo="Nenhum custo lançado"
          texto="Adicione os custos da viagem para ver o total por pessoa e o do grupo."
        />
      ) : (
        <div className="space-y-4">
          {(categorias as any[]).map((cat) => {
            const doGrupo = (custos as any[]).filter((c) => c.categoria_id === cat.id)
            if (doGrupo.length === 0) return null
            const subtotal = totais.porCategoria[String(cat.id)] ?? 0
            return (
              <div key={String(cat.id)}>
                <div className="mb-2 flex items-baseline justify-between">
                  <Rotulo>{String(cat.nome)}</Rotulo>
                  <span className="tab-num text-sm font-semibold">
                    {formatarDinheiro(subtotal, moeda)}
                  </span>
                </div>
                <div className="space-y-2">
                  {doGrupo.map((c) => (
                    <LinhaCusto key={String(c.id)} custo={c} moeda={moeda} mutate={mutate} />
                  ))}
                </div>
              </div>
            )
          })}

          {/* Custos sem categoria não podem sumir da tela. */}
          {(() => {
            const soltos = (custos as any[]).filter((c) => !c.categoria_id)
            if (soltos.length === 0) return null
            return (
              <div>
                <Rotulo>Sem categoria</Rotulo>
                <div className="mt-2 space-y-2">
                  {soltos.map((c) => (
                    <LinhaCusto key={String(c.id)} custo={c} moeda={moeda} mutate={mutate} />
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </>
  )
}

function Resumo({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string
  valor: string
  destaque?: boolean
}) {
  return (
    <Cartao
      className={destaque ? '!border-transparent' : ''}
      {...(destaque ? { style: { background: 'var(--color-destaque-fraco)' } } : {})}
    >
      <Rotulo>{rotulo}</Rotulo>
      <p className="tab-num mt-1 text-base leading-tight font-bold">{valor}</p>
    </Cartao>
  )
}

function LinhaCusto({
  custo,
  moeda,
  mutate,
}: {
  custo: any
  moeda: string
  mutate: (op: any) => Promise<void>
}) {
  const [confirmando, setConfirmando] = useState(false)
  const porPessoa = Number(custo.valor_centavos)
  const pessoas = Number(custo.pessoas)
  const total = porPessoa * pessoas

  return (
    <Cartao>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{String(custo.descricao)}</p>
          <p className="tab-num mt-0.5 text-[13px] text-[--color-tinta-3]">
            {formatarDinheiro(porPessoa, moeda)} × {pessoas}
            {custo.estimado ? ' · estimativa' : ''}
            {custo.pago ? ' · pago' : ''}
          </p>
          {custo.nota && (
            <p className="mt-1.5 text-[13px] text-[--color-tinta-2]">{String(custo.nota)}</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="tab-num font-semibold">{formatarDinheiro(total, moeda)}</p>
          <div className="mt-1.5 flex justify-end gap-1">
            <button
              onClick={() =>
                mutate({
                  op: 'editar',
                  entidade: 'custo',
                  id: custo.id,
                  campos: { pago: !custo.pago },
                  client_ts: agora(),
                })
              }
              className="cursor-pointer rounded-lg px-2 py-1 text-[12px] font-medium hover:bg-[--color-fundo]"
              style={{ color: custo.pago ? 'var(--destaque)' : 'var(--color-tinta-3)' }}
            >
              {custo.pago ? 'Pago' : 'Marcar pago'}
            </button>
            <button
              onClick={() => setConfirmando(true)}
              aria-label={`Remover ${custo.descricao}`}
              className="cursor-pointer rounded-lg p-1.5 text-[--color-tinta-3] hover:bg-[--color-alerta-bg] hover:text-[--color-alerta-ink]"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>

      {confirmando && (
        <div className="mt-3 rounded-xl bg-[--color-alerta-bg] p-3">
          <p className="text-sm text-[--color-alerta-ink]">
            Remover <strong>{String(custo.descricao)}</strong> ({formatarDinheiro(total, moeda)})?
          </p>
          <div className="mt-2.5 flex gap-2">
            <Botao
              variante="perigo"
              onClick={() => {
                mutate({
                  op: 'remover',
                  entidade: 'custo',
                  id: custo.id,
                  campos: {},
                  client_ts: agora(),
                })
                setConfirmando(false)
              }}
            >
              Remover
            </Botao>
            <Botao variante="secundario" onClick={() => setConfirmando(false)}>
              Cancelar
            </Botao>
          </div>
        </div>
      )}
    </Cartao>
  )
}

function FormularioCusto({
  categorias,
  aoSalvar,
  aoFechar,
}: {
  categorias: any[]
  aoSalvar: (campos: Record<string, unknown>) => void
  aoFechar: () => void
}) {
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [pessoas, setPessoas] = useState('1')
  const [categoria, setCategoria] = useState(categorias[0]?.id ?? '')
  const [erro, setErro] = useState<string | null>(null)

  return (
    <Cartao className="mb-4">
      <Rotulo>Novo custo</Rotulo>
      <div className="mt-3 space-y-2.5">
        <Campo rotulo="Descrição" valor={descricao} aoMudar={setDescricao} />
        <div className="grid grid-cols-2 gap-2.5">
          <Campo rotulo="Valor por pessoa" valor={valor} aoMudar={setValor} inputMode="decimal" />
          <Campo rotulo="Pessoas" valor={pessoas} aoMudar={setPessoas} inputMode="numeric" />
        </div>
        {categorias.length > 0 && (
          <label className="block">
            <span className="text-[11px] font-semibold tracking-[0.06em] text-[--color-tinta-3] uppercase">
              Categoria
            </span>
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="toque mt-1 w-full rounded-xl border border-[--color-borda] bg-[--color-cartao] px-3"
            >
              {categorias.map((c) => (
                <option key={String(c.id)} value={String(c.id)}>
                  {String(c.nome)}
                </option>
              ))}
            </select>
          </label>
        )}
        {erro && (
          <p className="rounded-xl bg-[--color-alerta-bg] px-3 py-2 text-sm text-[--color-alerta-ink]">
            {erro}
          </p>
        )}
        <div className="flex gap-2 pt-1">
          <Botao
            onClick={() => {
              // Vírgula decimal é o que a pessoa digita em pt-BR.
              const n = Number(valor.replace(/\./g, '').replace(',', '.'))
              const p = Number(pessoas)
              if (!descricao.trim()) return setErro('Escreva uma descrição.')
              if (!Number.isFinite(n) || n < 0) return setErro('Valor inválido.')
              if (!Number.isInteger(p) || p < 1) return setErro('Pessoas precisa ser 1 ou mais.')
              aoSalvar({
                descricao: descricao.trim(),
                valor_centavos: Math.round(n * 100),
                pessoas: p,
                categoria_id: categoria || null,
                estimado: true,
                pago: false,
              })
            }}
          >
            Salvar
          </Botao>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
        </div>
      </div>
    </Cartao>
  )
}

function Campo({
  rotulo,
  valor,
  aoMudar,
  inputMode,
}: {
  rotulo: string
  valor: string
  aoMudar: (v: string) => void
  inputMode?: 'text' | 'numeric' | 'decimal'
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold tracking-[0.06em] text-[--color-tinta-3] uppercase">
        {rotulo}
      </span>
      <input
        value={valor}
        inputMode={inputMode}
        onChange={(e) => aoMudar(e.target.value)}
        className="toque mt-1 w-full rounded-xl border border-[--color-borda] bg-[--color-cartao] px-3"
      />
    </label>
  )
}
