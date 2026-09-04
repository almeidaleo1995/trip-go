'use client'

// A aba Financeiro. Duas telas, escolhidas pelo que o SERVIDOR mandou:
//
//   snapshot.financeiro.admin === true  -> painel completo da viagem
//   snapshot.financeiro.admin === false -> "Meus pagamentos", só as obrigações
//                                          de quem está olhando
//
// Não é a mesma tela com pedaços escondidos: para um viajante comum, o total da
// viagem, o orçamento e a despesa de que ele não participa não chegaram pela
// rede. O `if` aqui é conveniência de renderização; a proteção é `lib/db.ts`.
import { useMemo, useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  CalendarDays,
  ChartColumn,
  Check,
  CircleAlert,
  Download,
  Filter,
  HandCoins,
  Info,
  Landmark,
  Lock,
  PartyPopper,
  PiggyBank,
  Plus,
  Receipt,
  Scale,
  Search,
  Trash2,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useTrip } from '../TripProvider.tsx'
import {
  AppModal,
  Avatar,
  Badge,
  Botao,
  BotaoIcone,
  Campo,
  Cartao,
  CLASSE_CAMPO,
  ConfirmarDialogo,
  Progresso,
  Rotulo,
  Selecao,
  Titulo,
  Vazio,
  useAviso,
} from '../ui.tsx'
import { FormDespesa } from '../FormDespesa.tsx'
import { formatarData, formatarDinheiro, paraCentavos, paraCampoDinheiro } from '@/lib/derive.ts'
import {
  totaisViagem,
  percentual,
  saldos,
  simplificar,
  parcelasDaViagem,
  parcelasDe,
  porCategoria,
  porParticipante,
  porMes,
  origemDaDivida,
  obrigacoesDe,
  paraDia,
  NOME_STATUS,
  type StatusParcela,
  type Obrigacao,
  type Saldo,
} from '@/lib/financeiro.ts'
import { CATEGORIAS_PADRAO } from '@/lib/schema.ts'

const agora = () => new Date().toISOString()

// Cor por situação de parcela. Vermelho é atraso, laranja é atenção, verde é
// resolvido — e todo estado leva a palavra junto, porque cor sozinha não informa.
const TOM_STATUS: Record<StatusParcela, string> = {
  paga: 'sucesso',
  atrasada: 'perigo',
  hoje: 'atencao',
  parcial: 'atencao',
  futura: 'neutro',
  pendente: 'neutro',
}

export function Financeiro() {
  const { snapshot } = useTrip()
  if (!snapshot) return null
  return snapshot.financeiro.admin ? <PainelDaViagem /> : <MeusPagamentos />
}

// ================================================================ admin

type AbaFin = 'despesas' | 'parcelas' | 'pagamentos' | 'saldos' | 'relatorios'

const ABAS: { id: AbaFin; nome: string; icone: React.ElementType }[] = [
  { id: 'despesas', nome: 'Despesas', icone: Receipt },
  { id: 'parcelas', nome: 'Parcelas', icone: CalendarClock },
  { id: 'pagamentos', nome: 'Pagamentos', icone: HandCoins },
  { id: 'saldos', nome: 'Saldos', icone: Scale },
  { id: 'relatorios', nome: 'Relatórios', icone: ChartColumn },
]

function PainelDaViagem() {
  const { snapshot, mutate } = useTrip()
  const avisar = useAviso()
  const [aba, setAba] = useState<AbaFin>('despesas')
  const [editando, setEditando] = useState<Record<string, unknown> | null | undefined>(undefined)
  const [orcamentoAberto, setOrcamentoAberto] = useState(false)

  const fin = snapshot!.financeiro
  if (!fin.admin) return null

  const moeda = String(snapshot!.viagem?.moeda ?? 'BRL')
  const pessoas = snapshot!.participantes as Record<string, unknown>[]
  const hoje = new Date()

  const t = totaisViagem(fin.despesas as never, fin.parcelas as never)
  const orcamento = Number(snapshot!.viagem?.orcamento_centavos ?? 0)
  const balanco = saldos(
    pessoas as never,
    fin.despesas as never,
    fin.divisoes as never,
    fin.pagamentos as never,
  )
  const acertos = simplificar(balanco)
  const parcelas = parcelasDaViagem(fin.despesas as never, fin.parcelas as never, hoje)
  const proximas = parcelas.filter((p) => p.status !== 'paga').slice(0, 3)

  const semCategorias = fin.categorias.length === 0

  function criarCategoriasPadrao() {
    CATEGORIAS_PADRAO.forEach((nome, i) => {
      void mutate({
        op: 'criar',
        entidade: 'categoria',
        id: crypto.randomUUID(),
        campos: { nome, ordem: i },
        client_ts: agora(),
      })
    })
    avisar('sucesso', 'Categorias criadas.')
  }

  // O painel lateral repete o que as abas Saldos e Parcelas mostram por inteiro;
  // some nelas para a mesma informação não aparecer duas vezes na mesma tela.
  const comLateral = aba === 'despesas'

  return (
    <>
      <Titulo
        descricao={
          <span className="inline-flex items-center gap-1.5">
            <Lock size={13} /> Só quem administra a viagem edita o financeiro.
          </span>
        }
        acao={
          <>
            {/* `?trip=` é obrigatório: sem ele a rota cai em `viagemPadrao()` e
                baixa o backup de OUTRA viagem — a que estava na tela nem entra
                no arquivo, e nada avisa. Mesma forma usada em Dados.tsx e em
                AcoesViagem.tsx. */}
            <Botao
              variante="secundario"
              onClick={() =>
                window.open(
                  `/api/export?trip=${encodeURIComponent(String(snapshot!.viagem?.id ?? ''))}`,
                  '_self',
                )
              }
            >
              <Download size={16} /> Exportar
            </Botao>
            <Botao onClick={() => setEditando(null)}>
              <Plus size={16} /> Adicionar despesa
            </Botao>
          </>
        }
      >
        Financeiro da viagem
      </Titulo>

      {/* ------------------------------------------------ cartões de resumo */}
      <div className="mb-5 grid grid-cols-2 gap-2.5 lg:grid-cols-5">
        <Resumo
          icone={Receipt}
          tom="destaque"
          rotulo="Total gasto"
          valor={formatarDinheiro(t.total, moeda)}
          detalhe={`${t.despesas} ${t.despesas === 1 ? 'despesa' : 'despesas'}`}
        />
        <Resumo
          icone={PiggyBank}
          tom="info"
          rotulo="Total previsto"
          valor={orcamento > 0 ? formatarDinheiro(orcamento, moeda) : '—'}
          detalhe={
            orcamento > 0 ? `${percentual(t.total, orcamento)}% comprometido` : 'Definir orçamento'
          }
          onClick={() => setOrcamentoAberto(true)}
        />
        <Resumo
          icone={BadgeCheck}
          tom="sucesso"
          rotulo="Já pago"
          valor={formatarDinheiro(t.pago, moeda)}
          detalhe={`${percentual(t.pago, t.total)}% do total`}
        />
        <Resumo
          icone={CircleAlert}
          tom="atencao"
          rotulo="Em aberto"
          valor={formatarDinheiro(t.aberto, moeda)}
          detalhe={`${percentual(t.aberto, t.total)}% do total`}
        />
        <Resumo
          icone={CalendarClock}
          tom="passeio"
          rotulo="Parcelas ativas"
          valor={formatarDinheiro(t.parcelasValor, moeda)}
          detalhe={`${t.parcelasAbertas} ${t.parcelasAbertas === 1 ? 'parcela' : 'parcelas'}`}
        />
      </div>

      <div className={comLateral ? 'gap-5 lg:flex lg:items-start' : ''}>
        <div className="min-w-0 flex-1">
          <Abas atual={aba} aoTrocar={setAba} />

          {aba === 'despesas' && (
            <Despesas
              moeda={moeda}
              aoEditar={setEditando}
              semCategorias={semCategorias}
              aoCriarCategorias={criarCategoriasPadrao}
            />
          )}
          {aba === 'parcelas' && <Parcelas moeda={moeda} lista={parcelas} />}
          {aba === 'pagamentos' && <Pagamentos moeda={moeda} />}
          {aba === 'saldos' && <Saldos moeda={moeda} balanco={balanco} acertos={acertos} />}
          {aba === 'relatorios' && <Relatorios moeda={moeda} />}
        </div>

        {comLateral && (
          <aside className="mt-5 w-full shrink-0 space-y-4 lg:mt-0 lg:w-80">
            <Cartao>
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="t-cartao">Saldos entre participantes</p>
                <button
                  onClick={() => setAba('saldos')}
                  className="cursor-pointer text-[12px] font-medium text-(--destaque) hover:underline"
                >
                  Ver detalhes
                </button>
              </div>
              <div className="space-y-2">
                {balanco.map((s) => (
                  <LinhaSaldo key={s.traveler_id} saldo={s} moeda={moeda} pessoas={pessoas} />
                ))}
              </div>
              {acertos.length > 0 && (
                <p className="mt-3 flex gap-2 rounded-xl bg-(--color-destaque-tenue) px-3 py-2.5 text-[12px] text-(--color-tinta-2)">
                  <Info size={14} className="mt-px shrink-0 text-(--destaque)" />
                  <span>
                    {acertos.length === 1
                      ? 'Uma transferência resolve tudo.'
                      : `${acertos.length} transferências resolvem tudo.`}{' '}
                    Veja quais em Saldos.
                  </span>
                </p>
              )}
            </Cartao>

            <Cartao>
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="t-cartao">Próximas parcelas</p>
                <button
                  onClick={() => setAba('parcelas')}
                  className="cursor-pointer text-[12px] font-medium text-(--destaque) hover:underline"
                >
                  Ver todas
                </button>
              </div>
              {proximas.length === 0 ? (
                <p className="t-aux">Nada em aberto por aqui.</p>
              ) : (
                <div className="space-y-2.5">
                  {proximas.map((p) => (
                    <div key={p.id} className="flex items-start gap-2.5">
                      <span
                        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                        style={{
                          background: `var(--color-${p.status === 'atrasada' ? 'perigo' : 'destaque'}-bg, var(--color-destaque-tenue))`,
                          color:
                            p.status === 'atrasada' ? 'var(--color-perigo-ink)' : 'var(--destaque)',
                        }}
                      >
                        <CalendarDays size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">
                          {p.descricao}
                          {p.total_parcelas > 1 && (
                            <span className="text-(--color-tinta-3)">
                              {' '}
                              · {Number(p.numero)}/{p.total_parcelas}
                            </span>
                          )}
                        </p>
                        <p className="tab-num text-[12px] text-(--color-tinta-3)">
                          {p.vence_em
                            ? `Vence ${formatarData(p.vence_em, { day: '2-digit', month: '2-digit', year: 'numeric' })}`
                            : 'Sem data'}
                        </p>
                      </div>
                      <span className="tab-num shrink-0 text-[13px] font-semibold">
                        {formatarDinheiro(
                          Number(p.valor_centavos) - Number(p.pago_centavos),
                          moeda,
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Cartao>

            <Cartao tom="destaque">
              <p className="t-cartao mb-1.5">Divisão inteligente</p>
              <p className="text-[13px] text-(--color-tinta-2)">
                O peso é quantas partes da despesa cada pessoa assume. Um casal que paga por dois
                entra com peso 2, e uma criança com 1 — sem precisar cadastrar casal nenhum. A soma
                sempre fecha com o total, até o último centavo.
              </p>
            </Cartao>
          </aside>
        )}
      </div>

      {editando !== undefined && (
        <FormDespesa despesa={editando} aoFechar={() => setEditando(undefined)} />
      )}
      {orcamentoAberto && <FormOrcamento aoFechar={() => setOrcamentoAberto(false)} />}
    </>
  )
}

// ---------------------------------------------------------------- peças do painel

const TOM_CARTAO: Record<string, { bg: string; ink: string }> = {
  destaque: { bg: 'var(--color-destaque-fraco)', ink: 'var(--destaque)' },
  info: { bg: 'var(--color-info-bg)', ink: 'var(--color-info-ink)' },
  sucesso: { bg: 'var(--color-sucesso-bg)', ink: 'var(--color-sucesso-ink)' },
  atencao: { bg: 'var(--color-atencao-bg)', ink: 'var(--color-atencao-ink)' },
  passeio: { bg: 'var(--color-pass-bg)', ink: 'var(--color-pass-ink)' },
}

function Resumo({
  icone: Icone,
  rotulo,
  valor,
  detalhe,
  tom,
  onClick,
}: {
  icone: React.ElementType
  rotulo: string
  valor: string
  detalhe: string
  tom: keyof typeof TOM_CARTAO
  onClick?: () => void
}) {
  const cor = TOM_CARTAO[tom]
  return (
    <Cartao onClick={onClick}>
      <span
        className="mb-2.5 flex h-8 w-8 items-center justify-center rounded-xl"
        style={{ background: cor.bg, color: cor.ink }}
      >
        <Icone size={16} strokeWidth={1.9} />
      </span>
      <p className="text-[12px] text-(--color-tinta-2)">{rotulo}</p>
      <p className="tab-num mt-0.5 text-lg leading-tight font-bold">{valor}</p>
      <p className="mt-0.5 text-[11px] text-(--color-tinta-3)">{detalhe}</p>
    </Cartao>
  )
}

function Abas({ atual, aoTrocar }: { atual: AbaFin; aoTrocar: (a: AbaFin) => void }) {
  // `overflow-y-hidden` não é decoração: com só `overflow-x-auto`, o CSS calcula
  // o outro eixo como `auto`, e o `-mb-px` das abas já basta para acender uma
  // barra de rolagem vertical de 1px ao lado de "Relatórios".
  return (
    <div
      role="tablist"
      aria-label="Seções do financeiro"
      className="mb-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-(--color-borda)"
    >
      {ABAS.map((a) => {
        const ativo = a.id === atual
        const Icone = a.icone
        return (
          <button
            key={a.id}
            role="tab"
            aria-selected={ativo}
            onClick={() => aoTrocar(a.id)}
            className="-mb-px flex shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors"
            style={{
              borderColor: ativo ? 'var(--destaque)' : 'transparent',
              color: ativo ? 'var(--destaque)' : 'var(--color-tinta-2)',
            }}
          >
            <Icone size={15} strokeWidth={ativo ? 2.1 : 1.75} />
            {a.nome}
          </button>
        )
      })}
    </div>
  )
}

function LinhaSaldo({
  saldo,
  moeda,
  pessoas,
  aoAbrir,
}: {
  saldo: Saldo
  moeda: string
  pessoas: Record<string, unknown>[]
  aoAbrir?: () => void
}) {
  const p = pessoas.find((x) => String(x.id) === saldo.traveler_id)
  const estado =
    saldo.saldo > 0
      ? { texto: 'A receber', tipo: 'sucesso' as const, cor: 'var(--color-sucesso-ink)' }
      : saldo.saldo < 0
        ? { texto: 'Deve', tipo: 'perigo' as const, cor: 'var(--color-perigo-ink)' }
        : { texto: 'Equilibrado', tipo: 'neutro' as const, cor: 'var(--color-tinta-2)' }

  const conteudo = (
    <>
      <Avatar nome={saldo.nome} url={p?.avatar_url} tamanho={28} />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{saldo.nome || '—'}</span>
      <Badge tipo={estado.tipo} texto={estado.texto} />
      <span className="tab-num shrink-0 text-[13px] font-bold" style={{ color: estado.cor }}>
        {formatarDinheiro(Math.abs(saldo.saldo), moeda)}
      </span>
    </>
  )

  return aoAbrir ? (
    <button
      onClick={aoAbrir}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-1 py-1 text-left transition-colors hover:bg-(--color-superficie-2)"
    >
      {conteudo}
    </button>
  ) : (
    <div className="flex items-center gap-2.5 px-1">{conteudo}</div>
  )
}

// ---------------------------------------------------------------- aba Despesas

function Despesas({
  moeda,
  aoEditar,
  semCategorias,
  aoCriarCategorias,
}: {
  moeda: string
  aoEditar: (d: Record<string, unknown> | null) => void
  semCategorias: boolean
  aoCriarCategorias: () => void
}) {
  const { snapshot, mutate } = useTrip()
  const avisar = useAviso()
  const [busca, setBusca] = useState('')
  const [catFiltro, setCatFiltro] = useState('')
  const [pagadorFiltro, setPagadorFiltro] = useState('')
  const [excluindo, setExcluindo] = useState<Record<string, unknown> | null>(null)

  const fin = snapshot!.financeiro

  // Sem `return null` antes daqui: o useMemo é um hook, e um hook que só roda às
  // vezes quebra a ordem entre renders.
  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return (fin.admin ? fin.despesas : []).filter((d) => {
      if (catFiltro && String(d.categoria_id ?? '') !== catFiltro) return false
      if (pagadorFiltro && String(d.traveler_id ?? '') !== pagadorFiltro) return false
      if (
        termo &&
        !String(d.descricao ?? '')
          .toLowerCase()
          .includes(termo)
      )
        return false
      return true
    })
  }, [fin, busca, catFiltro, pagadorFiltro])

  if (!fin.admin) return null
  const pessoas = snapshot!.participantes as Record<string, unknown>[]
  const nomeDe = (id: unknown) =>
    pessoas.find((p) => String(p.id) === String(id))?.nome as string | undefined

  if (fin.despesas.length === 0) {
    return (
      <>
        {semCategorias && <ConviteCategorias aoCriar={aoCriarCategorias} />}
        <Vazio
          titulo="Nenhuma despesa lançada"
          texto="Lance a primeira e o app calcula sozinho quanto cabe a cada um e quem reembolsa quem."
          acao={
            <Botao onClick={() => aoEditar(null)}>
              <Plus size={16} /> Adicionar despesa
            </Botao>
          }
        />
      </>
    )
  }

  return (
    <>
      {semCategorias && <ConviteCategorias aoCriar={aoCriarCategorias} />}

      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="relative sm:col-span-1">
          <Search
            size={15}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-(--color-tinta-3)"
          />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar despesa…"
            aria-label="Buscar despesa"
            // `CLASSE_CAMPO`, como os dois `Selecao` ao lado: escrito à mão,
            // este campo tinha raio, tamanho de texto e estado de foco
            // diferentes dos vizinhos da mesma linha.
            className={`toque pr-3 pl-9 ${CLASSE_CAMPO}`}
          />
        </label>
        <Selecao
          compacto
          rotulo="Categoria"
          valor={catFiltro}
          aoMudar={setCatFiltro}
          opcoes={[
            { valor: '', nome: 'Todas as categorias' },
            ...fin.categorias.map((c) => ({ valor: String(c.id), nome: String(c.nome) })),
          ]}
        />
        <Selecao
          compacto
          rotulo="Quem pagou"
          valor={pagadorFiltro}
          aoMudar={setPagadorFiltro}
          opcoes={[
            { valor: '', nome: 'Todos os responsáveis' },
            ...pessoas.map((p) => ({ valor: String(p.id), nome: String(p.nome) })),
          ]}
        />
      </div>

      {lista.length === 0 ? (
        <Vazio titulo="Nada com esses filtros" texto="Ajuste a busca ou limpe os filtros acima." />
      ) : (
        <div className="space-y-2">
          {lista.map((d) => {
            const parcelas = parcelasDe(d as never, fin.parcelas as never)
            const total = Number(d.valor_centavos)
            const pago = parcelas.reduce((s, p) => s + Number(p.pago_centavos ?? 0), 0)
            const quantos = fin.divisoes.filter((x) => x.expense_id === d.id).length
            const situacao =
              pago >= total && total > 0
                ? { tipo: 'sucesso', texto: 'Pago' }
                : parcelas.length > 1
                  ? { tipo: 'info', texto: `Parcelado ${parcelas.length}×` }
                  : pago > 0
                    ? { tipo: 'atencao', texto: 'Parcialmente pago' }
                    : { tipo: 'neutro', texto: 'Em aberto' }

            return (
              <Cartao key={String(d.id)}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="font-medium">{String(d.descricao)}</p>
                      <Badge tipo={situacao.tipo} texto={situacao.texto} />
                      {d.estimado ? <Badge tipo="atencao" texto="Estimado" /> : null}
                    </div>
                    <p className="tab-num mt-1 text-[13px] text-(--color-tinta-3)">
                      {Boolean(d.ocorre_em) &&
                        `${formatarData(paraDia(d.ocorre_em), { day: '2-digit', month: '2-digit', year: 'numeric' })} · `}
                      {/* "Pago" no selo é sobre o fornecedor; esta linha é sobre
                          quem do grupo adiantou o dinheiro. São coisas
                          diferentes, e a frase precisa deixar isso claro. */}
                      {d.traveler_id
                        ? `Adiantado por ${nomeDe(d.traveler_id) ?? 'alguém que saiu'}`
                        : 'Sem responsável pelo pagamento'}
                    </p>
                    <p className="mt-1 text-[13px] text-(--color-tinta-2)">
                      {quantos === 0 ? (
                        <span className="font-medium text-(--color-atencao-ink)">
                          A dividir — ninguém está assumindo esta despesa
                        </span>
                      ) : (
                        <>
                          Dividida entre {quantos} {quantos === 1 ? 'pessoa' : 'pessoas'} ·{' '}
                          {d.divisao === 'igual'
                            ? `igual (${formatarDinheiro(Math.round(total / quantos), moeda)} cada)`
                            : d.divisao === 'peso'
                              ? 'por peso'
                              : 'valores exatos'}
                        </>
                      )}
                    </p>
                    {Boolean(d.nota) && (
                      <p className="mt-1 text-[13px] text-(--color-tinta-2)">{String(d.nota)}</p>
                    )}
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="tab-num font-bold">{formatarDinheiro(total, moeda)}</p>
                    {parcelas.length > 1 && (
                      <p className="tab-num text-[12px] text-(--color-tinta-3)">
                        {parcelas.length}×{' '}
                        {formatarDinheiro(Number(parcelas[0].valor_centavos), moeda)}
                      </p>
                    )}
                    <div className="mt-1.5 flex items-center justify-end gap-1">
                      <Botao variante="fantasma" tamanho="pequeno" onClick={() => aoEditar(d)}>
                        Editar
                      </Botao>
                      <BotaoIcone
                        rotulo={`Excluir ${String(d.descricao)}`}
                        tom="perigo"
                        onClick={() => setExcluindo(d)}
                      >
                        <Trash2 size={14} />
                      </BotaoIcone>
                    </div>
                  </div>
                </div>
              </Cartao>
            )
          })}
        </div>
      )}

      {excluindo && (
        <ConfirmarDialogo
          titulo="Excluir despesa?"
          descricao={
            <>
              <strong className="text-(--color-tinta)">{String(excluindo.descricao)}</strong> (
              {formatarDinheiro(Number(excluindo.valor_centavos), moeda)}) sai do financeiro, junto
              com a divisão e as parcelas dela. Os saldos são recalculados. Não dá para desfazer.
            </>
          }
          rotuloConfirmar="Excluir"
          aoCancelar={() => setExcluindo(null)}
          aoConfirmar={() => {
            void mutate({
              op: 'remover',
              entidade: 'custo',
              id: String(excluindo.id),
              campos: {},
              client_ts: agora(),
            })
            setExcluindo(null)
            avisar('sucesso', 'Despesa excluída.')
          }}
        />
      )}
    </>
  )
}

function ConviteCategorias({ aoCriar }: { aoCriar: () => void }) {
  return (
    <Cartao tom="info" className="mb-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-(--color-info-ink)">
          Esta viagem ainda não tem categorias. Crio as dez mais comuns para você?
        </p>
        <Botao variante="secundario" tamanho="pequeno" onClick={aoCriar}>
          Criar categorias
        </Botao>
      </div>
    </Cartao>
  )
}

// ---------------------------------------------------------------- aba Parcelas

const FILTROS_PARCELA: { id: string; nome: string }[] = [
  { id: 'todas', nome: 'Todas' },
  { id: 'proximas', nome: 'Próximas' },
  { id: 'hoje', nome: 'Vencem hoje' },
  { id: 'atrasada', nome: 'Atrasadas' },
  { id: 'paga', nome: 'Pagas' },
  { id: 'parcial', nome: 'Parciais' },
]

function Parcelas({ moeda, lista }: { moeda: string; lista: ReturnType<typeof parcelasDaViagem> }) {
  const { snapshot } = useTrip()
  const [filtro, setFiltro] = useState('todas')
  const [pessoa, setPessoa] = useState('')
  const [quitando, setQuitando] = useState<(typeof lista)[number] | null>(null)

  const fin = snapshot!.financeiro
  const pessoas = snapshot!.participantes as Record<string, unknown>[]

  // Filtrar por pessoa não é recortar a mesma lista: a parcela da viagem é
  // R$ 600, e a parte de quem está selecionado é R$ 120. São números
  // diferentes, então é outra consulta — a mesma que o viajante comum recebe.
  const minhas = useMemo(() => {
    if (!pessoa || !fin.admin) return []
    return obrigacoesDe(pessoa, {
      categorias: fin.categorias as never,
      despesas: fin.despesas as never,
      divisoes: fin.divisoes as never,
      parcelas: fin.parcelas as never,
      pagamentos: fin.pagamentos as never,
      participantes: pessoas as never,
    })
  }, [pessoa, fin, pessoas])

  const passaFiltro = (status: StatusParcela) => {
    if (filtro === 'todas') return true
    if (filtro === 'proximas') return status === 'futura' || status === 'hoje'
    return status === filtro
  }

  const filtradas = lista.filter((p) => passaFiltro(p.status))

  // Agrupa por mês: é assim que se lê um calendário de pagamentos, não numa
  // lista corrida de trinta linhas.
  const meses = new Map<string, typeof filtradas>()
  for (const p of filtradas) {
    const chave = p.vence_em?.slice(0, 7) ?? 'sem-data'
    meses.set(chave, [...(meses.get(chave) ?? []), p])
  }

  const filtros = (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Filter size={14} className="mr-1 text-(--color-tinta-3)" />
        {FILTROS_PARCELA.map((f) => (
          <button
            key={f.id}
            onClick={() => setFiltro(f.id)}
            aria-pressed={filtro === f.id}
            className="cursor-pointer rounded-full border px-3 py-1 text-[12px] font-medium transition-colors"
            style={{
              borderColor: filtro === f.id ? 'var(--destaque)' : 'var(--color-borda-forte)',
              background: filtro === f.id ? 'var(--color-destaque-tenue)' : 'transparent',
              color: filtro === f.id ? 'var(--destaque)' : 'var(--color-tinta-2)',
            }}
          >
            {f.nome}
          </button>
        ))}
      </div>
      <div className="ms-auto w-full sm:w-56">
        <Selecao
          compacto
          rotulo="Ver as parcelas de"
          valor={pessoa}
          aoMudar={setPessoa}
          opcoes={[
            { valor: '', nome: 'Parcelas da viagem' },
            ...pessoas.map((p) => ({ valor: String(p.id), nome: `Só de ${String(p.nome)}` })),
          ]}
        />
      </div>
    </div>
  )

  if (pessoa) {
    return (
      <>
        {filtros}
        <PagamentosDaPessoa
          moeda={moeda}
          obrigacoes={minhas.filter((o) => passaFiltro(o.status))}
          total={minhas.length}
          pessoa={pessoas.find((p) => String(p.id) === pessoa)}
        />
      </>
    )
  }

  return (
    <>
      {filtros}

      {filtradas.length === 0 ? (
        <Vazio titulo="Nenhuma parcela aqui" texto="Troque o filtro para ver as outras." />
      ) : (
        <div className="space-y-4">
          {[...meses.entries()].map(([mes, itens]) => (
            <section key={mes}>
              <div className="mb-2 flex items-baseline justify-between">
                <Rotulo>{mes === 'sem-data' ? 'Sem vencimento' : nomeDoMes(mes)}</Rotulo>
                <span className="tab-num text-[13px] font-semibold">
                  {formatarDinheiro(
                    itens.reduce((s, p) => s + Number(p.valor_centavos), 0),
                    moeda,
                  )}
                </span>
              </div>
              <div className="space-y-2">
                {itens.map((p) => {
                  const falta = Number(p.valor_centavos) - Number(p.pago_centavos)
                  return (
                    <Cartao key={p.id}>
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">
                            {p.descricao}
                            {p.total_parcelas > 1 && (
                              <span className="text-(--color-tinta-3)">
                                {' '}
                                · Parcela {Number(p.numero)}/{p.total_parcelas}
                              </span>
                            )}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <Badge
                              tipo={TOM_STATUS[p.status]}
                              texto={
                                p.status === 'atrasada'
                                  ? `Atrasada há ${p.atraso_dias} ${p.atraso_dias === 1 ? 'dia' : 'dias'}`
                                  : NOME_STATUS[p.status]
                              }
                            />
                            {p.vence_em && (
                              <span className="tab-num text-[12px] text-(--color-tinta-3)">
                                {formatarData(p.vence_em, {
                                  day: '2-digit',
                                  month: '2-digit',
                                  year: 'numeric',
                                })}
                              </span>
                            )}
                          </div>
                          {Number(p.pago_centavos) > 0 && falta > 0 && (
                            <div className="mt-2 max-w-56">
                              <Progresso
                                pct={percentual(Number(p.pago_centavos), Number(p.valor_centavos))}
                                rotulo={`Pago de ${p.descricao}`}
                              />
                              <p className="tab-num mt-1 text-[12px] text-(--color-tinta-2)">
                                {formatarDinheiro(Number(p.pago_centavos), moeda)} de{' '}
                                {formatarDinheiro(Number(p.valor_centavos), moeda)} · faltam{' '}
                                {formatarDinheiro(falta, moeda)}
                              </p>
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="tab-num font-bold">
                            {formatarDinheiro(Number(p.valor_centavos), moeda)}
                          </p>
                          <div className="mt-1.5">
                            <Botao
                              variante="fantasma"
                              tamanho="pequeno"
                              onClick={() => setQuitando(p)}
                            >
                              {p.status === 'paga' ? 'Revisar' : 'Registrar pagamento'}
                            </Botao>
                          </div>
                        </div>
                      </div>
                    </Cartao>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {quitando && (
        <FormQuitarParcela parcela={quitando} moeda={moeda} aoFechar={() => setQuitando(null)} />
      )}
    </>
  )
}

/**
 * O que UMA pessoa paga, mês a mês, e para quem.
 *
 * É tabela e não cartão de propósito: aqui não se age sobre cada linha, se LÊ
 * uma coluna de valores para conferir um mês. Cartão é para objeto que se
 * edita; tabela é para número que se compara.
 *
 * Cada mês fecha com quanto mandar para CADA pessoa. É a pergunta real de quem
 * senta para pagar — ninguém transfere por despesa, transfere por pessoa —, e
 * é o único lugar da tela em que a soma some as despesas de vista.
 */
function PagamentosDaPessoa({
  moeda,
  obrigacoes,
  total,
  pessoa,
}: {
  moeda: string
  obrigacoes: Obrigacao[]
  /** Quantas obrigações existem antes do filtro de situação. */
  total: number
  pessoa?: Record<string, unknown>
}) {
  const { snapshot } = useTrip()
  const [acertando, setAcertando] = useState<{
    de: string
    para: string
    valor_centavos: number
  } | null>(null)

  const pessoas = snapshot!.participantes as Record<string, unknown>[]
  const nome = String(pessoa?.nome ?? 'Esta pessoa')
  const primeiro = nome.split(' ')[0]

  if (total === 0) {
    return (
      <Vazio
        titulo={`${primeiro} não divide nenhuma despesa`}
        texto="Abra uma despesa e inclua esta pessoa na divisão para que ela apareça aqui."
      />
    )
  }
  if (obrigacoes.length === 0) {
    return (
      <Vazio
        titulo="Nada com essa situação"
        texto={`${primeiro} tem pagamentos, mas nenhum nessa situação. Troque o filtro acima.`}
      />
    )
  }

  const devendo = obrigacoes.reduce(
    (s, o) => s + Math.max(0, o.valor_centavos - o.pago_centavos),
    0,
  )

  const meses = new Map<string, Obrigacao[]>()
  for (const o of obrigacoes) {
    const chave = o.vence_em?.slice(0, 7) ?? 'sem-data'
    meses.set(chave, [...(meses.get(chave) ?? []), o])
  }

  return (
    <>
      <Cartao tom="destaque" className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar nome={nome} url={pessoa?.avatar_url} tamanho={38} />
          <div className="min-w-0 flex-1">
            <p className="t-cartao truncate">{nome}</p>
            <p className="text-[13px] text-(--color-tinta-2)">
              {obrigacoes.length} {obrigacoes.length === 1 ? 'pagamento' : 'pagamentos'} em{' '}
              {meses.size} {meses.size === 1 ? 'mês' : 'meses'}
            </p>
          </div>
          <div className="text-right">
            <p className="t-legenda">Ainda deve</p>
            <p className="tab-num text-xl leading-tight font-bold">
              {formatarDinheiro(devendo, moeda)}
            </p>
          </div>
        </div>
      </Cartao>

      <div className="space-y-5">
        {[...meses.entries()].map(([mes, itens]) => {
          // O total do mês é o que FALTA, igual à coluna e ao rodapé. Somar o
          // valor cheio aqui deixaria três números na mesma seção que deveriam
          // fechar entre si e não fechavam.
          const doMes = itens.reduce(
            (s, o) => s + Math.max(0, o.valor_centavos - o.pago_centavos),
            0,
          )
          const cheioDoMes = itens.reduce((s, o) => s + o.valor_centavos, 0)

          // Quanto mandar para cada credor neste mês.
          const porCredor = new Map<string, { nome: string; valor: number }>()
          for (const o of itens) {
            const atual = porCredor.get(o.para_id) ?? { nome: o.para, valor: 0 }
            atual.valor += Math.max(0, o.valor_centavos - o.pago_centavos)
            porCredor.set(o.para_id, atual)
          }
          const credores = [...porCredor.entries()].filter(([, c]) => c.valor > 0)

          return (
            <section key={mes}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <Rotulo>{mes === 'sem-data' ? 'Sem vencimento' : nomeDoMes(mes)}</Rotulo>
                <span className="tab-num text-[13px] font-semibold">
                  {formatarDinheiro(doMes, moeda)}
                  {cheioDoMes !== doMes && (
                    <span className="ms-1.5 font-normal text-(--color-tinta-3)">
                      de {formatarDinheiro(cheioDoMes, moeda)}
                    </span>
                  )}
                </span>
              </div>

              <div className="overflow-hidden rounded-2xl border border-(--color-borda) bg-(--color-cartao)">
                {/* Cabeçalho só no desktop: no celular cada linha se lê sozinha. */}
                <div
                  aria-hidden
                  className="t-legenda hidden gap-3 border-b border-(--color-borda) bg-(--color-superficie-2) px-4 py-2 sm:grid sm:grid-cols-[minmax(0,2.2fr)_7rem_minmax(0,1.3fr)_7rem]"
                >
                  <span>Despesa</span>
                  <span>Vence</span>
                  <span>Pagar para</span>
                  <span className="text-right">Valor</span>
                </div>

                <div className="divide-y divide-(--color-borda)">
                  {itens.map((o) => {
                    const falta = Math.max(0, o.valor_centavos - o.pago_centavos)
                    const credor = pessoas.find((p) => String(p.id) === o.para_id)
                    return (
                      <div
                        key={o.id}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:grid-cols-[minmax(0,2.2fr)_7rem_minmax(0,1.3fr)_7rem]"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[14px] font-medium">
                            {o.descricao}
                            {o.total_parcelas > 1 && (
                              <span className="text-(--color-tinta-3)">
                                {' '}
                                {o.numero}/{o.total_parcelas}
                              </span>
                            )}
                          </p>
                          {o.categoria && (
                            <p className="truncate text-[12px] text-(--color-tinta-3)">
                              {o.categoria}
                            </p>
                          )}
                        </div>

                        {/* Vence — no celular vira etiqueta ao lado do credor. */}
                        <p className="tab-num order-3 text-[13px] text-(--color-tinta-2) sm:order-none">
                          {o.vence_em
                            ? formatarData(o.vence_em, { day: '2-digit', month: '2-digit' })
                            : '—'}
                          {o.status === 'atrasada' && (
                            <span className="ms-1.5 font-semibold text-(--color-perigo-ink)">
                              +{o.atraso_dias}d
                            </span>
                          )}
                        </p>

                        <div className="order-4 flex min-w-0 items-center gap-2 sm:order-none">
                          <Avatar nome={o.para} url={credor?.avatar_url} tamanho={22} />
                          <span className="truncate text-[13px]">{o.para}</span>
                        </div>

                        <div className="order-2 text-right sm:order-none">
                          <p className="tab-num font-semibold">{formatarDinheiro(falta, moeda)}</p>
                          {o.pago_centavos > 0 && (
                            <p className="tab-num text-[11px] text-(--color-sucesso-ink)">
                              pagou {formatarDinheiro(o.pago_centavos, moeda)}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {credores.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-(--color-borda) bg-(--color-superficie-2) px-4 py-2.5">
                    <span className="t-legenda">Fecha o mês</span>
                    {credores.map(([id, c]) => (
                      <button
                        key={id}
                        onClick={() =>
                          setAcertando({
                            de: String(pessoa?.id ?? ''),
                            para: id,
                            valor_centavos: c.valor,
                          })
                        }
                        className="tab-num flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 text-[13px] transition-colors hover:bg-(--color-cartao)"
                        title={`Registrar ${formatarDinheiro(c.valor, moeda)} de ${primeiro} para ${c.nome}`}
                      >
                        <HandCoins size={14} className="text-(--destaque)" />
                        <span className="text-(--color-tinta-2)">{c.nome}</span>
                        <span className="font-bold">{formatarDinheiro(c.valor, moeda)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )
        })}
      </div>

      {acertando && (
        <FormPagamento moeda={moeda} sugestao={acertando} aoFechar={() => setAcertando(null)} />
      )}
    </>
  )
}

/** Quanto desta parcela já foi pago ao fornecedor. Aceita pagamento parcial. */
function FormQuitarParcela({
  parcela,
  moeda,
  aoFechar,
}: {
  parcela: ReturnType<typeof parcelasDaViagem>[number]
  moeda: string
  aoFechar: () => void
}) {
  const { mutate } = useTrip()
  const avisar = useAviso()
  const valor = Number(parcela.valor_centavos)
  const [pago, setPago] = useState(paraCampoDinheiro(Number(parcela.pago_centavos)))
  const [quando, setQuando] = useState(paraDia(parcela.pago_em) ?? hojeISO())
  const [erro, setErro] = useState<string | null>(null)

  function salvar() {
    const c = paraCentavos(pago)
    if (c === null) return setErro('Informe um valor, ex: 600,00')
    if (c > valor) return setErro(`Não dá para pagar mais que ${formatarDinheiro(valor, moeda)}.`)
    void mutate({
      op: 'editar',
      entidade: 'parcela',
      id: parcela.id,
      campos: {
        expense_id: parcela.expense_id,
        pago_centavos: c,
        pago_em: c >= valor ? quando : null,
      },
      client_ts: agora(),
    })
    avisar('sucesso', c >= valor ? 'Parcela quitada.' : 'Pagamento registrado.')
    aoFechar()
  }

  return (
    <AppModal
      titulo="Registrar pagamento da parcela"
      descricao={`${parcela.descricao} · ${formatarDinheiro(valor, moeda)}`}
      tamanho="pequeno"
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={salvar}>Salvar</Botao>
        </>
      }
    >
      <div className="space-y-3.5 pb-2">
        <Campo
          rotulo="Quanto já foi pago"
          dica="pode ser parcial"
          valor={pago}
          aoMudar={setPago}
          inputMode="decimal"
          erro={erro}
        />
        <Campo rotulo="Data do pagamento" valor={quando} aoMudar={setQuando} tipo="date" />
        <div className="flex gap-2">
          <Botao
            variante="contorno"
            tamanho="pequeno"
            onClick={() => setPago(paraCampoDinheiro(valor))}
          >
            <Check size={14} /> Quitar tudo
          </Botao>
          <Botao variante="fantasma" tamanho="pequeno" onClick={() => setPago('0')}>
            Marcar como não paga
          </Botao>
        </div>
      </div>
    </AppModal>
  )
}

// ---------------------------------------------------------------- aba Pagamentos

function Pagamentos({ moeda }: { moeda: string }) {
  const { snapshot, mutate } = useTrip()
  const avisar = useAviso()
  const [novo, setNovo] = useState(false)
  const [excluindo, setExcluindo] = useState<Record<string, unknown> | null>(null)

  const fin = snapshot!.financeiro
  if (!fin.admin) return null
  const pessoas = snapshot!.participantes as Record<string, unknown>[]
  // Devolve string, nao `unknown`: e o proprio helper que fecha a coercao, em vez
  // de cada uma das quatro chamadas repetir um String() ao redor dele.
  const nomeDe = (id: unknown) =>
    String(pessoas.find((p) => String(p.id) === String(id))?.nome ?? '—')

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="t-aux">
          Reembolsos entre participantes. Cada um abate o saldo de quem pagou e o de quem recebeu.
        </p>
        <Botao tamanho="pequeno" onClick={() => setNovo(true)}>
          <Plus size={15} /> Registrar pagamento
        </Botao>
      </div>

      {fin.pagamentos.length === 0 ? (
        <Vazio
          titulo="Nenhum reembolso registrado"
          texto="Quando alguém devolver o dinheiro a quem adiantou, registre aqui e os saldos se ajustam."
          acao={<Botao onClick={() => setNovo(true)}>Registrar pagamento</Botao>}
        />
      ) : (
        <div className="space-y-2">
          {fin.pagamentos.map((g) => (
            <Cartao key={String(g.id)}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--color-sucesso-bg) text-(--color-sucesso-ink)">
                  <HandCoins size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-[14px] font-medium">
                    {nomeDe(g.de_id)}
                    <ArrowRight size={14} className="text-(--color-tinta-3)" />
                    {nomeDe(g.para_id)}
                  </p>
                  <p className="tab-num mt-0.5 text-[13px] text-(--color-tinta-3)">
                    {g.ocorre_em
                      ? formatarData(paraDia(g.ocorre_em), {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })
                      : 'Sem data'}
                    {g.referencia ? ` · ${String(g.referencia)}` : ''}
                  </p>
                  {Boolean(g.nota) && (
                    <p className="mt-1 text-[13px] text-(--color-tinta-2)">{String(g.nota)}</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="tab-num font-bold text-(--color-sucesso-ink)">
                    {formatarDinheiro(Number(g.valor_centavos), moeda)}
                  </p>
                  <div className="mt-1 flex justify-end">
                    <BotaoIcone
                      rotulo="Excluir pagamento"
                      tom="perigo"
                      onClick={() => setExcluindo(g)}
                    >
                      <Trash2 size={14} />
                    </BotaoIcone>
                  </div>
                </div>
              </div>
            </Cartao>
          ))}
        </div>
      )}

      {novo && <FormPagamento moeda={moeda} aoFechar={() => setNovo(false)} />}

      {excluindo && (
        <ConfirmarDialogo
          titulo="Excluir pagamento?"
          descricao={
            <>
              O reembolso de {formatarDinheiro(Number(excluindo.valor_centavos), moeda)} de{' '}
              {nomeDe(excluindo.de_id)} para {nomeDe(excluindo.para_id)} sai da conta, e os saldos
              voltam ao que eram.
            </>
          }
          rotuloConfirmar="Excluir"
          aoCancelar={() => setExcluindo(null)}
          aoConfirmar={() => {
            void mutate({
              op: 'remover',
              entidade: 'pagamento',
              id: String(excluindo.id),
              campos: {},
              client_ts: agora(),
            })
            setExcluindo(null)
            avisar('sucesso', 'Pagamento excluído.')
          }}
        />
      )}
    </>
  )
}

function FormPagamento({
  moeda,
  sugestao,
  aoFechar,
}: {
  moeda: string
  /** Acerto sugerido: preenche de/para/valor com um clique. */
  sugestao?: { de: string; para: string; valor_centavos: number }
  aoFechar: () => void
}) {
  const { snapshot, mutate } = useTrip()
  const avisar = useAviso()
  const pessoas = snapshot!.participantes as Record<string, unknown>[]

  const [de, setDe] = useState(sugestao?.de ?? String(pessoas[0]?.id ?? ''))
  const [para, setPara] = useState(sugestao?.para ?? String(pessoas[1]?.id ?? ''))
  const [valor, setValor] = useState(sugestao ? paraCampoDinheiro(sugestao.valor_centavos) : '')
  const [quando, setQuando] = useState(hojeISO())
  const [referencia, setReferencia] = useState('')
  const [erros, setErros] = useState<Record<string, string>>({})

  function salvar() {
    const novos: Record<string, string> = {}
    const c = paraCentavos(valor)
    if (c === null || c <= 0) novos.valor = 'Informe um valor maior que zero.'
    if (!de || !para) novos.pessoas = 'Escolha quem pagou e quem recebeu.'
    else if (de === para) novos.pessoas = 'Ninguém reembolsa a si mesmo.'
    setErros(novos)
    if (Object.keys(novos).length > 0) return

    void mutate({
      op: 'criar',
      entidade: 'pagamento',
      id: crypto.randomUUID(),
      campos: {
        de_id: de,
        para_id: para,
        valor_centavos: c,
        ocorre_em: quando || null,
        referencia: referencia.trim() || null,
      },
      client_ts: agora(),
    })
    avisar('sucesso', 'Pagamento registrado.')
    aoFechar()
  }

  const opcoes = pessoas.map((p) => ({ valor: String(p.id), nome: String(p.nome) }))

  return (
    <AppModal
      titulo="Registrar pagamento"
      descricao="Dinheiro voltando para quem adiantou."
      tamanho="medio"
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={salvar}>Registrar</Botao>
        </>
      }
    >
      <div className="space-y-3.5 pb-2">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Selecao rotulo="Quem pagou" valor={de} aoMudar={setDe} opcoes={opcoes} />
          <Selecao rotulo="Quem recebeu" valor={para} aoMudar={setPara} opcoes={opcoes} />
        </div>
        {erros.pessoas && (
          <p role="alert" className="text-[13px] text-(--color-perigo-ink)">
            {erros.pessoas}
          </p>
        )}
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Campo
            rotulo="Valor"
            valor={valor}
            aoMudar={setValor}
            inputMode="decimal"
            placeholder={formatarDinheiro(0, moeda)}
            erro={erros.valor}
            obrigatorio
          />
          <Campo rotulo="Data" valor={quando} aoMudar={setQuando} tipo="date" />
        </div>
        <Campo
          rotulo="Referência"
          dica="opcional"
          valor={referencia}
          aoMudar={setReferencia}
          placeholder="Passagem aérea, parcela 1/8"
        />
      </div>
    </AppModal>
  )
}

// ---------------------------------------------------------------- aba Saldos

function Saldos({
  moeda,
  balanco,
  acertos,
}: {
  moeda: string
  balanco: Saldo[]
  acertos: ReturnType<typeof simplificar>
}) {
  const { snapshot } = useTrip()
  const [detalhe, setDetalhe] = useState<Saldo | null>(null)
  const [acertando, setAcertando] = useState<(typeof acertos)[number] | null>(null)

  const fin = snapshot!.financeiro
  if (!fin.admin) return null
  const pessoas = snapshot!.participantes as Record<string, unknown>[]
  const nomeDe = (id: string) => String(pessoas.find((p) => String(p.id) === id)?.nome ?? '—')

  const equilibrada = balanco.every((s) => s.saldo === 0)

  return (
    <>
      <Cartao className="mb-4">
        <p className="t-cartao mb-3">Saldo de cada participante</p>
        <div className="space-y-2.5">
          {balanco.map((s) => (
            <LinhaSaldo
              key={s.traveler_id}
              saldo={s}
              moeda={moeda}
              pessoas={pessoas}
              aoAbrir={() => setDetalhe(s)}
            />
          ))}
        </div>
        <p className="mt-3 border-t border-(--color-borda) pt-2.5 text-[12px] text-(--color-tinta-3)">
          Saldo = o que a pessoa pagou − o que cabe a ela + o que reembolsou − o que recebeu. Toque
          num nome para ver de onde vem o número.
        </p>
      </Cartao>

      <div className="mb-2.5 flex items-center justify-between gap-2">
        <Rotulo>Acerto da viagem</Rotulo>
        {acertos.length > 0 && (
          <span className="text-[12px] text-(--color-tinta-3)">
            {acertos.length} {acertos.length === 1 ? 'transferência' : 'transferências'} resolvem
            tudo
          </span>
        )}
      </div>

      {equilibrada ? (
        <Cartao tom="sucesso">
          <div className="flex items-center gap-3">
            <PartyPopper size={20} className="shrink-0 text-(--color-sucesso-ink)" />
            <div>
              <p className="t-cartao text-(--color-sucesso-ink)">Viagem equilibrada</p>
              <p className="text-[13px] text-(--color-sucesso-ink)">Ninguém deve nada a ninguém.</p>
            </div>
          </div>
        </Cartao>
      ) : acertos.length === 0 ? (
        <Vazio
          titulo="Nada a acertar ainda"
          texto="Lance despesas com pagador e divisão para o app calcular quem deve para quem."
        />
      ) : (
        <div className="space-y-2">
          {acertos.map((a, i) => (
            <Cartao key={i}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <Avatar
                    nome={nomeDe(a.de)}
                    url={pessoas.find((p) => String(p.id) === a.de)?.avatar_url}
                    tamanho={30}
                  />
                  <span className="truncate text-sm font-medium">{nomeDe(a.de)}</span>
                  <ArrowRight size={16} className="shrink-0 text-(--color-tinta-3)" />
                  <Avatar
                    nome={nomeDe(a.para)}
                    url={pessoas.find((p) => String(p.id) === a.para)?.avatar_url}
                    tamanho={30}
                  />
                  <span className="truncate text-sm font-medium">{nomeDe(a.para)}</span>
                </div>
                <span className="tab-num font-bold">
                  {formatarDinheiro(a.valor_centavos, moeda)}
                </span>
                <Botao variante="contorno" tamanho="pequeno" onClick={() => setAcertando(a)}>
                  Registrar
                </Botao>
              </div>
            </Cartao>
          ))}
        </div>
      )}

      {detalhe && <DetalheSaldo saldo={detalhe} moeda={moeda} aoFechar={() => setDetalhe(null)} />}
      {acertando && (
        <FormPagamento moeda={moeda} sugestao={acertando} aoFechar={() => setAcertando(null)} />
      )}
    </>
  )
}

/** De onde vem o saldo de uma pessoa. Número sem explicação ninguém aceita pagar. */
function DetalheSaldo({
  saldo,
  moeda,
  aoFechar,
}: {
  saldo: Saldo
  moeda: string
  aoFechar: () => void
}) {
  const { snapshot } = useTrip()
  const fin = snapshot!.financeiro
  if (!fin.admin) return null
  const pessoas = snapshot!.participantes as Record<string, unknown>[]

  const dados = {
    categorias: fin.categorias as never,
    despesas: fin.despesas as never,
    divisoes: fin.divisoes as never,
    parcelas: fin.parcelas as never,
    pagamentos: fin.pagamentos as never,
  }

  // Contra quem ela tem dívida, e de que despesas.
  const credores = pessoas
    .map((p) => String(p.id))
    .filter((id) => id !== saldo.traveler_id)
    .map((id) => ({
      id,
      nome: String(pessoas.find((p) => String(p.id) === id)?.nome ?? '—'),
      itens: origemDaDivida(saldo.traveler_id, id, dados),
    }))
    .filter((c) => c.itens.length > 0)

  return (
    <AppModal
      titulo={saldo.nome || 'Participante'}
      descricao={
        saldo.saldo > 0
          ? `Tem ${formatarDinheiro(saldo.saldo, moeda)} a receber.`
          : saldo.saldo < 0
            ? `Deve ${formatarDinheiro(-saldo.saldo, moeda)}.`
            : 'Está em dia.'
      }
      tamanho="medio"
      aoFechar={aoFechar}
    >
      <div className="space-y-4 pb-2">
        <div className="rounded-xl bg-(--color-superficie-2) p-3">
          <Conta rotulo="Pagou pelo grupo" valor={saldo.pagou} moeda={moeda} />
          <Conta rotulo="Cabe a ela nas despesas" valor={-saldo.deve} moeda={moeda} />
          <Conta rotulo="Já reembolsou" valor={saldo.reembolsou} moeda={moeda} />
          <Conta rotulo="Já recebeu de volta" valor={-saldo.recebeu} moeda={moeda} />
          <div className="tab-num mt-1.5 flex items-baseline justify-between border-t border-(--color-borda-forte) pt-1.5 text-sm font-bold">
            <span>Saldo</span>
            <span
              style={{
                color:
                  saldo.saldo > 0
                    ? 'var(--color-sucesso-ink)'
                    : saldo.saldo < 0
                      ? 'var(--color-perigo-ink)'
                      : 'var(--color-tinta)',
              }}
            >
              {formatarDinheiro(saldo.saldo, moeda)}
            </span>
          </div>
        </div>

        {credores.map((c) => (
          <section key={c.id}>
            <Rotulo>Do que {c.nome} pagou</Rotulo>
            <div className="mt-1.5 space-y-1">
              {c.itens.map((i) => (
                <div
                  key={i.despesa_id}
                  className="tab-num flex items-baseline justify-between text-[13px]"
                >
                  <span className="text-(--color-tinta-2)">{i.descricao}</span>
                  <span className="font-semibold">{formatarDinheiro(i.valor_centavos, moeda)}</span>
                </div>
              ))}
              <div className="tab-num flex items-baseline justify-between border-t border-(--color-borda) pt-1 text-[13px] font-bold">
                <span>Total</span>
                <span>
                  {formatarDinheiro(
                    c.itens.reduce((s, i) => s + i.valor_centavos, 0),
                    moeda,
                  )}
                </span>
              </div>
            </div>
          </section>
        ))}
      </div>
    </AppModal>
  )
}

function Conta({ rotulo, valor, moeda }: { rotulo: string; valor: number; moeda: string }) {
  return (
    <div className="tab-num flex items-baseline justify-between py-0.5 text-[13px]">
      <span className="text-(--color-tinta-2)">{rotulo}</span>
      <span className="font-medium">
        {valor < 0 ? '−' : ''}
        {formatarDinheiro(Math.abs(valor), moeda)}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------- aba Relatórios

function Relatorios({ moeda }: { moeda: string }) {
  const { snapshot } = useTrip()
  const fin = snapshot!.financeiro
  if (!fin.admin) return null
  const pessoas = snapshot!.participantes as Record<string, unknown>[]

  const categorias = porCategoria(fin.despesas as never, fin.categorias as never)
  const participantes = porParticipante(pessoas as never, fin.divisoes as never)
  const meses = porMes(fin.despesas as never, fin.parcelas as never)

  if (fin.despesas.length === 0) {
    return (
      <Vazio titulo="Sem dados ainda" texto="Os relatórios aparecem assim que houver despesas." />
    )
  }

  return (
    <div className="space-y-4">
      <Cartao>
        <p className="t-cartao mb-3">Gastos por categoria</p>
        <div className="space-y-2.5">
          {categorias.map((c) => (
            <div key={c.id ?? 'sem'}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="truncate text-[13px] font-medium">{c.nome}</span>
                <span className="tab-num shrink-0 text-[13px] font-semibold">
                  {formatarDinheiro(c.total, moeda)}
                  <span className="ml-1.5 font-normal text-(--color-tinta-3)">{c.pct}%</span>
                </span>
              </div>
              <Progresso pct={c.pct} rotulo={c.nome} />
            </div>
          ))}
        </div>
      </Cartao>

      <Cartao>
        <p className="t-cartao mb-1">Quanto cabe a cada participante</p>
        <p className="t-aux mb-3">
          O que cada um assume nas despesas — diferente de quem adiantou o dinheiro.
        </p>
        <div className="space-y-2.5">
          {participantes.map((p) => (
            <div key={p.traveler_id}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="truncate text-[13px] font-medium">{p.nome}</span>
                <span className="tab-num shrink-0 text-[13px] font-semibold">
                  {formatarDinheiro(p.total, moeda)}
                  <span className="ml-1.5 font-normal text-(--color-tinta-3)">{p.pct}%</span>
                </span>
              </div>
              <Progresso pct={p.pct} rotulo={p.nome} />
            </div>
          ))}
        </div>
      </Cartao>

      <Cartao>
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp size={16} className="text-(--destaque)" />
          <p className="t-cartao">Programação dos próximos meses</p>
        </div>
        {meses.length === 0 ? (
          <p className="t-aux">Nenhuma parcela tem vencimento cadastrado.</p>
        ) : (
          <div className="space-y-1.5">
            {meses.map((m) => (
              <div key={m.mes} className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-(--color-tinta-2)">{nomeDoMes(m.mes)}</span>
                <span className="tab-num text-[13px]">
                  <span className="font-semibold">{formatarDinheiro(m.total, moeda)}</span>
                  {m.aberto > 0 && m.aberto < m.total && (
                    <span className="ml-2 text-(--color-atencao-ink)">
                      {formatarDinheiro(m.aberto, moeda)} em aberto
                    </span>
                  )}
                  {m.aberto === 0 && <span className="ml-2 text-(--color-sucesso-ink)">pago</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </Cartao>
    </div>
  )
}

// ---------------------------------------------------------------- orçamento

function FormOrcamento({ aoFechar }: { aoFechar: () => void }) {
  const { snapshot, mutate } = useTrip()
  const avisar = useAviso()
  const atual = Number(snapshot!.viagem?.orcamento_centavos ?? 0)
  const [valor, setValor] = useState(atual > 0 ? paraCampoDinheiro(atual) : '')
  const [erro, setErro] = useState<string | null>(null)

  function salvar() {
    const c = valor.trim() === '' ? 0 : paraCentavos(valor)
    if (c === null) return setErro('Informe um valor, ex: 18.200,00')
    void mutate({
      op: 'editar',
      entidade: 'viagem',
      campos: { orcamento_centavos: c },
      client_ts: agora(),
    })
    avisar('sucesso', 'Orçamento atualizado.')
    aoFechar()
  }

  return (
    <AppModal
      titulo="Orçamento da viagem"
      descricao="Quanto o grupo planeja gastar no total. Serve de referência para o quanto já foi comprometido."
      tamanho="pequeno"
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={salvar}>Salvar</Botao>
        </>
      }
    >
      <div className="pb-2">
        <Campo
          rotulo="Orçamento previsto"
          dica="deixe vazio para não usar"
          valor={valor}
          aoMudar={setValor}
          inputMode="decimal"
          erro={erro}
        />
      </div>
    </AppModal>
  )
}

// ================================================================ viajante comum

/**
 * A tela de quem não administra a viagem.
 *
 * Não existe aqui nenhum total da viagem, nenhum orçamento, nenhum saldo de
 * outra pessoa — porque nada disso chegou pela rede. Só o que esta pessoa deve,
 * para quem, quando, e o que ela já pagou.
 */
function MeusPagamentos() {
  const { snapshot } = useTrip()
  const fin = snapshot!.financeiro
  if (fin.admin) return null

  const moeda = String(snapshot!.viagem?.moeda ?? 'BRL')
  const nome = String(snapshot!.eu?.usuario?.nome ?? '').split(' ')[0]
  const abertas = fin.obrigacoes.filter((o) => o.valor_centavos > o.pago_centavos)
  const quitadas = fin.obrigacoes.filter((o) => o.valor_centavos <= o.pago_centavos)

  if (fin.obrigacoes.length === 0) {
    return (
      <>
        <Titulo>Meus pagamentos</Titulo>
        <Cartao tom="sucesso" className="text-center">
          <PartyPopper size={26} className="mx-auto mb-3 text-(--color-sucesso-ink)" />
          <p className="t-secao text-(--color-sucesso-ink)">Tudo certo por aqui!</p>
          <p className="mx-auto mt-2 max-w-sm text-[14px] text-(--color-sucesso-ink)">
            Você não tem nenhum pagamento pendente nesta viagem. Nenhum valor foi atribuído a você.
          </p>
        </Cartao>
      </>
    )
  }

  return (
    <>
      <Titulo descricao={`Só o que foi atribuído a você${nome ? `, ${nome}` : ''}.`}>
        Meus pagamentos
      </Titulo>

      <div className="mb-5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <Cartao tom={fin.devendo > 0 ? 'destaque' : 'sucesso'}>
          <p className="text-[12px] text-(--color-tinta-2)">Você precisa pagar</p>
          <p className="tab-num mt-0.5 text-2xl leading-tight font-bold">
            {formatarDinheiro(fin.devendo, moeda)}
          </p>
          <p className="mt-0.5 text-[12px] text-(--color-tinta-2)">
            {abertas.length} {abertas.length === 1 ? 'pagamento' : 'pagamentos'} em aberto
          </p>
        </Cartao>
        <Cartao>
          <p className="text-[12px] text-(--color-tinta-2)">Vence em até 30 dias</p>
          <p className="tab-num mt-0.5 text-2xl leading-tight font-bold">
            {formatarDinheiro(fin.do_mes, moeda)}
          </p>
          <p className="mt-0.5 text-[12px] text-(--color-tinta-3)">
            {fin.atrasadas > 0
              ? `${fin.atrasadas} ${fin.atrasadas === 1 ? 'parcela atrasada' : 'parcelas atrasadas'}`
              : 'Nada atrasado'}
          </p>
        </Cartao>
        <Cartao>
          <p className="text-[12px] text-(--color-tinta-2)">Você já pagou</p>
          <p className="tab-num mt-0.5 text-2xl leading-tight font-bold text-(--color-sucesso-ink)">
            {formatarDinheiro(fin.pago, moeda)}
          </p>
          <p className="mt-0.5 text-[12px] text-(--color-tinta-3)">
            {quitadas.length} {quitadas.length === 1 ? 'quitado' : 'quitados'}
          </p>
        </Cartao>
      </div>

      {abertas.length > 0 && (
        <section className="mb-5">
          <Rotulo>Próximos pagamentos</Rotulo>
          <div className="mt-2 space-y-2">
            {abertas.map((o) => (
              <CartaoObrigacao key={o.id} o={o} moeda={moeda} />
            ))}
          </div>
        </section>
      )}

      {quitadas.length > 0 && (
        <section>
          <Rotulo>Já pagos</Rotulo>
          <div className="mt-2 space-y-2">
            {quitadas.map((o) => (
              <Cartao key={o.id}>
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-(--color-sucesso-bg) text-(--color-sucesso-ink)">
                    <Check size={16} strokeWidth={2.5} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium">
                      {o.descricao}
                      {o.total_parcelas > 1 && (
                        <span className="text-(--color-tinta-3)">
                          {' '}
                          · {o.numero}/{o.total_parcelas}
                        </span>
                      )}
                    </p>
                    <p className="text-[12px] text-(--color-tinta-3)">Para {o.para}</p>
                  </div>
                  <span className="tab-num shrink-0 text-[14px] font-semibold">
                    {formatarDinheiro(o.valor_centavos, moeda)}
                  </span>
                </div>
              </Cartao>
            ))}
          </div>
        </section>
      )}

      {fin.historico.length > 0 && (
        <section className="mt-5">
          <Rotulo>Seus reembolsos registrados</Rotulo>
          <div className="mt-2 space-y-1.5">
            {fin.historico.map((g) => (
              <div
                key={String(g.id)}
                className="tab-num flex items-baseline justify-between rounded-xl bg-(--color-superficie-2) px-3 py-2 text-[13px]"
              >
                <span className="text-(--color-tinta-2)">
                  {g.ocorre_em
                    ? formatarData(String(g.ocorre_em), {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                      })
                    : 'Sem data'}
                  {g.referencia ? ` · ${String(g.referencia)}` : ''}
                </span>
                <span className="font-semibold">
                  {formatarDinheiro(Number(g.valor_centavos), moeda)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="mt-5 flex gap-2 rounded-xl bg-(--color-superficie-2) px-3.5 py-3 text-[12px] text-(--color-tinta-2)">
        <Landmark size={15} className="mt-px shrink-0 text-(--color-tinta-3)" />
        <span>
          Quem administra a viagem registra os pagamentos. Combine com a pessoa indicada em cada
          item e ela confirma o recebimento aqui.
        </span>
      </p>
    </>
  )
}

function CartaoObrigacao({ o, moeda }: { o: Obrigacao; moeda: string }) {
  const falta = o.valor_centavos - o.pago_centavos
  return (
    <Cartao>
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{
            background:
              o.status === 'atrasada' ? 'var(--color-perigo-bg)' : 'var(--color-destaque-fraco)',
            color: o.status === 'atrasada' ? 'var(--color-perigo-ink)' : 'var(--destaque)',
          }}
        >
          <Wallet size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {o.descricao}
            {o.total_parcelas > 1 && (
              <span className="text-(--color-tinta-3)">
                {' '}
                · Parcela {o.numero}/{o.total_parcelas}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-[13px] text-(--color-tinta-2)">
            Pagar para <strong className="font-semibold text-(--color-tinta)">{o.para}</strong>
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge
              tipo={TOM_STATUS[o.status]}
              texto={
                o.status === 'atrasada'
                  ? `Atrasada há ${o.atraso_dias} ${o.atraso_dias === 1 ? 'dia' : 'dias'}`
                  : NOME_STATUS[o.status]
              }
            />
            {o.vence_em && (
              <span className="tab-num text-[12px] text-(--color-tinta-3)">
                Vence{' '}
                {formatarData(o.vence_em, { day: '2-digit', month: '2-digit', year: 'numeric' })}
              </span>
            )}
          </div>
          {o.pago_centavos > 0 && (
            <p className="tab-num mt-1.5 text-[12px] text-(--color-tinta-2)">
              Já pagou {formatarDinheiro(o.pago_centavos, moeda)} de{' '}
              {formatarDinheiro(o.valor_centavos, moeda)}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="tab-num font-bold">{formatarDinheiro(falta, moeda)}</p>
          {o.pago_centavos > 0 && <p className="text-[11px] text-(--color-tinta-3)">a pagar</p>}
        </div>
      </div>
    </Cartao>
  )
}

// ---------------------------------------------------------------- utilidades

function hojeISO(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** "2026-09" -> "setembro de 2026". Intl faz o trabalho; não há tabela de meses. */
function nomeDoMes(mes: string): string {
  const texto = formatarData(`${mes}-01`, { month: 'long', year: 'numeric' })
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}
