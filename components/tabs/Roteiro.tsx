'use client'

// O Roteiro — a aba que deixou de ser agenda e virou o manual operacional da
// viagem, um dia de cada vez.
//
// Três níveis: VIAGEM → DIA → ITEM. O seletor no topo escolhe o dia, a linha do
// tempo mostra o que acontece nele, e cada item abre os detalhes que só
// interessam quando você está prestes a fazer aquilo — como chegar, dicas,
// reserva, documento, custo.
//
// Duas decisões que explicam quase tudo aqui:
//
// 1. A LISTA DE DIAS É DERIVADA das datas da viagem (`montarDias`), não lida do
//    banco. A tabela `itinerary_days` guarda só o que alguém escreveu SOBRE um
//    dia. Uma viagem recém-criada já abre com todos os dias na tela, sem seed,
//    sem "gerar roteiro" e sem uma linha gravada.
//
// 2. O QUE JÁ EXISTE EM OUTRA ABA NÃO É COPIADO PARA CÁ. Voo, hospedagem e
//    cruzeiro entram na linha do tempo como entradas derivadas (`derivadas`),
//    marcadas e não editáveis daqui. Duplicar o voo como item de roteiro criaria
//    dois registros do mesmo fato que envelhecem em ritmos diferentes — e é
//    exatamente assim que um app de viagem começa a mentir sobre o horário.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Plane,
  TrainFront,
  Bus,
  Car,
  Footprints,
  Ship,
  BedDouble,
  MapPin,
  Ticket,
  UtensilsCrossed,
  Coffee,
  ShoppingBag,
  PartyPopper,
  Camera,
  ListChecks,
  Clock,
  Lightbulb,
  StickyNote,
  FileText,
  Anchor,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Star,
  AlertTriangle,
  Route,
  Wallet,
  Map as IconeMapa,
  Moon,
  Sunrise,
  ArrowUp,
  ArrowDown,
  Copy,
  type LucideIcon,
} from 'lucide-react'
import { useTrip } from '../TripProvider.tsx'
import { type Papel } from '@/config/navigation.ts'
import { AdminAcoes } from '../EditorSheet.tsx'
import { Badge, Botao, Cartao, Rotulo, Titulo, Vazio, Copiar } from '../ui.tsx'
import {
  montarDias,
  resumoDoDia,
  diaFoco,
  chaveDia,
  formatarDistancia,
  formatarData,
  formatarHora,
  formatarDuracao,
  formatarDinheiro,
  linhas,
  lerLinks,
  noites,
  type DiaRoteiro,
} from '@/lib/derive.ts'

// ---------------------------------------------------------------- vocabulário

/** Ícone por tipo de item. Cor vem do `Badge`; aqui é só a forma. */
const ICONE: Record<string, LucideIcon> = {
  voo: Plane,
  trem: TrainFront,
  onibus: Bus,
  traslado: Car,
  caminhada: Footprints,
  cruzeiro: Ship,
  hospedagem: BedDouble,
  local: MapPin,
  passeio: Ticket,
  ponto: Camera,
  restaurante: UtensilsCrossed,
  refeicao: Coffee,
  compras: ShoppingBag,
  evento: PartyPopper,
  tarefa: ListChecks,
  compromisso: Clock,
  dica: Lightbulb,
  observacao: StickyNote,
  documento: FileText,
}

const ICONE_MODO: Record<string, LucideIcon> = {
  a_pe: Footprints,
  metro: TrainFront,
  onibus: Bus,
  trem: TrainFront,
  taxi: Car,
  carro: Car,
  barco: Ship,
  aviao: Plane,
}

const NOME_MODO: Record<string, string> = {
  a_pe: 'A pé',
  metro: 'Transporte público',
  onibus: 'Ônibus',
  trem: 'Trem',
  taxi: 'Táxi',
  carro: 'Carro',
  barco: 'Barco',
  aviao: 'Avião',
  outro: 'Outro deslocamento',
}

/** "1 local" / "3 locais". Em pt-BR o plural não é só acrescentar um "s". */
const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`

const agora = () => new Date().toISOString()

// ---------------------------------------------------------------- a aba

export function Roteiro() {
  const { snapshot, posso, mutate } = useTrip()
  // O "hoje" é o relógio do aparelho e é fixado na montagem: recalcular a cada
  // render faria o dia em foco pular sozinho à meia-noite, no meio de um toque.
  const [hoje] = useState(() => new Date())
  const [escolhido, setEscolhido] = useState<string | null>(null)

  const dias = useMemo(
    () => montarDias(snapshot?.viagem ?? null, snapshot?.roteiro ?? [], snapshot?.dias ?? []),
    [snapshot?.viagem, snapshot?.roteiro, snapshot?.dias],
  )

  const indicePadrao = diaFoco(dias, hoje)
  const indice = Math.max(
    0,
    escolhido ? dias.findIndex((d) => d.chave === escolhido) : indicePadrao,
  )
  const dia = dias[indice] ?? null
  const chaveHoje = chaveDia(hoje.toISOString())

  if (!snapshot) return null

  // Viagem sem datas E sem nenhum item: não há nem eixo para montar os dias.
  if (dias.length === 0) {
    return (
      <>
        <Titulo>Roteiro</Titulo>
        <Vazio
          titulo="Seu roteiro ainda não foi montado"
          texto="Defina as datas da viagem em Participantes e dados, ou adicione o primeiro item para o roteiro começar a se montar sozinho."
          acao={<AdminAcoes entidade="roteiro">Primeiro item</AdminAcoes>}
        />
      </>
    )
  }

  return (
    <>
      <Titulo
        descricao="Cada dia com o que fazer, como chegar e o que levar."
        acao={
          <>
            {chaveHoje !== dia?.chave && dias.some((d) => d.chave === chaveHoje) && (
              <Botao variante="secundario" onClick={() => setEscolhido(chaveHoje)}>
                Hoje
              </Botao>
            )}
            {dia && (
              <AdminAcoes entidade="roteiro" registro={{ ocorre_em: `${dia.chave}T09:00` }}>
                Adicionar item
              </AdminAcoes>
            )}
          </>
        }
      >
        Roteiro
      </Titulo>

      <SeletorDias
        dias={dias}
        indice={indice}
        chaveHoje={chaveHoje}
        aoEscolher={(c) => setEscolhido(c)}
      />

      {dia && (
        // Duas colunas só a partir de xl: em 1024px a coluna lateral espremeria
        // a linha do tempo, que é a razão de a tela existir.
        <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
            <PainelDoDia dia={dia} ehHoje={dia.chave === chaveHoje} mutate={mutate} posso={posso} />
          </div>
          <div className="min-w-0 space-y-4">
            <ColunaApoio dia={dia} />
          </div>
        </div>
      )}

      <NavegacaoDias dias={dias} indice={indice} aoEscolher={setEscolhido} />
    </>
  )
}

// ---------------------------------------------------------------- seletor de dias

function SeletorDias({
  dias,
  indice,
  chaveHoje,
  aoEscolher,
}: {
  dias: DiaRoteiro[]
  indice: number
  chaveHoje: string | null
  aoEscolher: (chave: string) => void
}) {
  const faixa = useRef<HTMLDivElement>(null)

  // Traz o dia escolhido para dentro da faixa. Sem isto, abrir a aba no dia 12
  // de uma viagem de 17 mostra a faixa parada no dia 1 e parece que nada foi
  // selecionado. `nearest` no bloco para a página não pular junto.
  useEffect(() => {
    const alvo = faixa.current?.querySelector<HTMLElement>('[data-ativo="1"]')
    alvo?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [indice])

  return (
    <div
      ref={faixa}
      className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-2"
      role="tablist"
      aria-label="Dias da viagem"
    >
      {dias.map((d, i) => {
        const ativo = i === indice
        const ehHoje = d.chave === chaveHoje
        const passado = chaveHoje !== null && d.chave < chaveHoje
        const ancora = Boolean(d.meta?.ancora)
        return (
          <button
            key={d.chave}
            role="tab"
            aria-selected={ativo}
            // O nome acessível é montado aqui porque o conteúdo do botão são três
            // fragmentos visuais ("02" / "JAN" / "Hamburgo") que um leitor de tela
            // soletraria como três coisas soltas.
            aria-label={[
              formatarData(d.chave, { day: '2-digit', month: 'long', weekday: 'long' }),
              String(d.meta?.cidade ?? ''),
              ehHoje ? 'hoje' : '',
              ancora ? 'dia-âncora' : '',
            ]
              .filter(Boolean)
              .join(', ')}
            data-ativo={ativo ? '1' : '0'}
            onClick={() => aoEscolher(d.chave)}
            style={
              ativo
                ? { background: 'var(--destaque)', borderColor: 'var(--destaque)', color: '#fff' }
                : undefined
            }
            className={`relative w-[4.75rem] shrink-0 snap-start cursor-pointer rounded-2xl border px-2 py-2.5 text-center transition-colors ${
              ativo
                ? 'shadow-[var(--sombra-1)]'
                : `border-(--color-borda) bg-(--color-cartao) hover:border-(--color-borda-forte) ${
                    passado ? 'opacity-60' : ''
                  }`
            }`}
          >
            {ancora && (
              <Anchor
                size={11}
                className="absolute top-1.5 right-1.5"
                style={{ color: ativo ? '#fff' : 'var(--destaque)' }}
                aria-label="Dia-âncora"
              />
            )}
            <span className="tab-num block text-lg leading-tight font-bold">
              {formatarData(d.chave, { day: '2-digit' })}
            </span>
            <span className="block text-[11px] font-semibold uppercase">
              {formatarData(d.chave, { month: 'short' }).replace('.', '')}
            </span>
            <span
              className={`mt-0.5 block truncate text-[11px] ${ativo ? '' : 'text-(--color-tinta-3)'}`}
            >
              {String(d.meta?.cidade ?? '') ||
                formatarData(d.chave, { weekday: 'short' }).replace('.', '')}
            </span>
            {ehHoje && (
              <span
                className="mx-auto mt-1 block h-1.5 w-1.5 rounded-full"
                style={{ background: ativo ? '#fff' : 'var(--color-perigo-ink)' }}
                aria-label="hoje"
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- painel do dia

function PainelDoDia({
  dia,
  ehHoje,
  mutate,
  posso,
}: {
  dia: DiaRoteiro
  ehHoje: boolean
  mutate: ReturnType<typeof useTrip>['mutate']
  posso: (minimo: Papel) => boolean
}) {
  const { snapshot } = useTrip()
  const derivadas = useMemo(() => entradasDerivadas(dia, snapshot), [dia, snapshot])
  const resumo = resumoDoDia(dia.itens)
  const alertas = linhas(dia.meta?.alertas)
  const moeda = String(snapshot?.viagem?.moeda ?? 'EUR')

  // A linha do tempo mistura os itens do roteiro com o que vem de outras abas,
  // reordenado por horário. Só os do roteiro carregam os botões de edição.
  const linha = [
    ...dia.itens.map((e) => ({ item: e, derivada: null as Derivada | null })),
    ...derivadas.map((d) => ({ item: d.como, derivada: d })),
  ].sort((a, b) => String(a.item.ocorre_em ?? '').localeCompare(String(b.item.ocorre_em ?? '')))

  // O registro semente do botão "adicionar": já com a data do dia aberto, para
  // ninguém precisar redigitar 02/01 num campo de data e hora.
  const semente = { ocorre_em: `${dia.chave}T09:00` }

  return (
    <div className="space-y-4">
      <Cartao>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="t-legenda">
              {formatarData(dia.chave, { weekday: 'long' })}
              {dia.numero > 0 ? ` · dia ${dia.numero}` : ''}
            </p>
            <h2 className="t-secao mt-0.5">
              {formatarData(dia.chave, { day: '2-digit', month: 'long' })}
            </h2>
            {(dia.meta?.cidade || dia.meta?.pais) && (
              <p className="mt-0.5 text-[15px] font-medium text-(--color-tinta-2)">
                {[dia.meta?.cidade, dia.meta?.pais].filter(Boolean).join(', ')}
              </p>
            )}
            {dia.meta?.titulo && (
              <p className="mt-1 text-sm text-(--color-tinta-2)">{String(dia.meta.titulo)}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {ehHoje && <Badge tipo="perigo" texto="Hoje" />}
            {dia.meta?.ancora && (
              <Badge tipo="info" texto="Dia-âncora" icone={<Anchor size={11} />} />
            )}
            <AdminAcoes entidade="dia" registro={dia.meta ?? { dia: dia.chave }} />
          </div>
        </div>

        <ChipsResumo resumo={resumo} moeda={moeda} />

        {dia.meta?.resumo && (
          <p className="mt-3 border-t border-(--color-borda) pt-3 text-[15px] text-(--color-tinta-2)">
            {String(dia.meta.resumo)}
          </p>
        )}
      </Cartao>

      {alertas.length > 0 && (
        <Cartao tom="atencao">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-(--color-atencao-ink)">
            <AlertTriangle size={14} /> Atenção hoje
          </p>
          <ul className="mt-2 space-y-1.5">
            {alertas.map((a, i) => (
              <li key={i} className="text-sm text-(--color-atencao-ink)">
                {a}
              </li>
            ))}
          </ul>
        </Cartao>
      )}

      {linha.length === 0 ? (
        <Vazio
          titulo="Este dia ainda está vazio"
          texto="Comece a montar o roteiro: atividades, deslocamentos, reservas, dicas e compromissos."
          acao={
            <AdminAcoes entidade="roteiro" registro={semente}>
              Adicionar ao dia
            </AdminAcoes>
          }
        />
      ) : (
        <>
          <ol className="space-y-0">
            {linha.map((l, i) => (
              <ItemLinha
                key={String(l.item.id ?? `d${i}`)}
                item={l.item}
                derivada={l.derivada}
                anterior={linha[i - 1]?.item ?? null}
                posterior={linha[i + 1]?.item ?? null}
                moeda={moeda}
                mutate={mutate}
                podeEditar={posso('editor')}
              />
            ))}
          </ol>
          {posso('editor') && (
            <AdminAcoes entidade="roteiro" registro={semente}>
              Adicionar item ao dia
            </AdminAcoes>
          )}
        </>
      )}

      <ResumoFinal resumo={resumo} moeda={moeda} />
    </div>
  )
}

/** Os números do dia, calculados dos itens. Chip vazio não é renderizado. */
function ChipsResumo({ resumo, moeda }: { resumo: ReturnType<typeof resumoDoDia>; moeda: string }) {
  const chips: { icone: LucideIcon; texto: string }[] = []
  if (resumo.locais > 0) {
    chips.push({ icone: MapPin, texto: plural(resumo.locais, 'local', 'locais') })
  }
  const dist = formatarDistancia(resumo.distanciaM)
  if (dist) chips.push({ icone: Route, texto: dist })
  if (resumo.deslocamentos > 0) {
    chips.push({
      icone: Car,
      texto: plural(resumo.deslocamentos, 'deslocamento', 'deslocamentos'),
    })
  }
  if (resumo.refeicoes > 0) {
    chips.push({ icone: UtensilsCrossed, texto: plural(resumo.refeicoes, 'refeição', 'refeições') })
  }
  if (resumo.reservas > 0) {
    chips.push({ icone: Ticket, texto: plural(resumo.reservas, 'reserva', 'reservas') })
  }
  if (resumo.minutos > 0) {
    chips.push({ icone: Clock, texto: `${formatarDuracao(resumo.minutos)} planejadas` })
  }
  if (resumo.custoCentavos > 0) {
    chips.push({ icone: Wallet, texto: formatarDinheiro(resumo.custoCentavos, moeda) })
  }
  if (chips.length === 0) return null

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span
          key={c.texto}
          className="inline-flex items-center gap-1.5 rounded-full bg-(--color-superficie-2) px-2.5 py-1 text-[12px] font-medium text-(--color-tinta-2)"
        >
          <c.icone size={13} /> {c.texto}
        </span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- item da linha do tempo

function ItemLinha({
  item,
  derivada,
  anterior,
  posterior,
  moeda,
  mutate,
  podeEditar,
}: {
  item: Record<string, any>
  derivada: Derivada | null
  anterior: Record<string, any> | null
  posterior: Record<string, any> | null
  moeda: string
  mutate: ReturnType<typeof useTrip>['mutate']
  podeEditar: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const tipo = String(item.tipo ?? 'passeio')
  const Icone = ICONE[tipo] ?? MapPin
  const dist = formatarDistancia(item.distancia_m)
  const dur = formatarDuracao(item.duracao_min)
  const temDeslocamento = Boolean(dist || dur || item.transporte)
  const temDetalhe =
    Boolean(item.descricao || item.como_chegar || item.nota || item.endereco) ||
    linhas(item.dicas).length > 0 ||
    lerLinks(item.links).length > 0 ||
    ((item.opcoes ?? []) as unknown[]).length > 0 ||
    Boolean(derivada?.detalhe)

  /**
   * Subir e descer trocam o HORÁRIO com o vizinho, não um campo de ordem.
   *
   * Num roteiro todo item tem hora, então "mover para cima" só pode significar
   * "acontecer antes" — mexer numa ordem paralela deixaria a linha do tempo
   * mostrando 14:00 acima de 10:00, contando uma história diferente da dos
   * próprios horários que ela exibe.
   */
  const trocar = (vizinho: Record<string, any> | null) => {
    if (!vizinho || !vizinho.id || !item.id) return
    const meu = paraCampo(item.ocorre_em)
    const dele = paraCampo(vizinho.ocorre_em)
    const ts = agora()
    void mutate({
      op: 'editar',
      entidade: 'roteiro',
      id: String(item.id),
      campos: { ocorre_em: dele },
      client_ts: ts,
    })
    void mutate({
      op: 'editar',
      entidade: 'roteiro',
      id: String(vizinho.id),
      campos: { ocorre_em: meu },
      client_ts: ts,
    })
  }

  const duplicar = () => {
    const copia: Record<string, unknown> = { ...item }
    for (const c of ['id', 'trip_id', 'updated_at', 'opcoes']) delete copia[c]
    copia.titulo = `${String(item.titulo)} (cópia)`
    void mutate({
      op: 'criar',
      entidade: 'roteiro',
      id: crypto.randomUUID(),
      campos: copia,
      client_ts: agora(),
    })
  }

  return (
    <li className="relative pl-11">
      {/* fio da linha do tempo — decorativo, some na impressão junto do resto */}
      <span
        aria-hidden
        className="absolute top-0 bottom-0 left-[0.9375rem] w-px bg-(--color-borda)"
      />

      {temDeslocamento && anterior && (
        <div className="relative flex items-center gap-2 py-1.5 pl-1">
          <span className="text-[12px] font-medium text-(--color-tinta-3)">
            {[dist, dur].filter(Boolean).join(' · ')}
            {item.transporte ? ` · ${String(item.transporte)}` : ''}
          </span>
        </div>
      )}

      <div className="relative flex gap-3 py-2">
        <span
          aria-hidden
          className="absolute top-3.5 left-[-2.375rem] flex h-8 w-8 items-center justify-center rounded-full border-2 border-(--color-cartao)"
          style={{ background: 'var(--color-superficie-2)' }}
        >
          <Icone size={15} className="text-(--color-tinta-2)" />
        </span>

        <span className="tab-num w-12 shrink-0 pt-3.5 text-sm font-semibold text-(--color-tinta-2)">
          {formatarHora(item.ocorre_em) || '—'}
        </span>

        <Cartao
          className={`min-w-0 flex-1 ${item.ancora ? 'border-l-4' : ''}`}
          style={item.ancora ? { borderLeftColor: 'var(--destaque)' } : undefined}
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{String(item.titulo)}</p>
              {(item.local || item.cidade) && (
                <p className="mt-0.5 text-[13px] text-(--color-tinta-3)">
                  {[item.local, item.cidade].filter(Boolean).join(' · ')}
                </p>
              )}
              {item.fim_em && (
                <p className="tab-num mt-0.5 text-[12px] text-(--color-tinta-3)">
                  {formatarHora(item.ocorre_em)} — {formatarHora(item.fim_em)}
                </p>
              )}
              {derivada && (
                <p className="mt-1 text-[12px] text-(--color-tinta-3) italic">{derivada.origem}</p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Badge tipo={tipo} />
              {podeEditar && !derivada && <AdminAcoes entidade="roteiro" registro={item} />}
            </div>
          </div>

          {temDetalhe && (
            <button
              onClick={() => setAberto((a) => !a)}
              aria-expanded={aberto}
              className="toque mt-1 -ml-1 inline-flex cursor-pointer items-center gap-1 rounded-xl px-1 text-[13px] font-medium"
              style={{ color: 'var(--destaque)' }}
            >
              {aberto ? 'Menos detalhes' : 'Detalhes'}
              <ChevronDown
                size={14}
                className={`transition-transform ${aberto ? 'rotate-180' : ''}`}
              />
            </button>
          )}

          {aberto && (
            <DetalheItem item={item} derivada={derivada} moeda={moeda} podeEditar={podeEditar} />
          )}

          {podeEditar && !derivada && (
            <div className="mt-2 flex items-center gap-1 border-t border-(--color-borda) pt-2">
              <BotaoMini
                icone={ArrowUp}
                rotulo="Antecipar (troca o horário com o item acima)"
                desabilitado={!anterior?.id}
                aoClicar={() => trocar(anterior)}
              />
              <BotaoMini
                icone={ArrowDown}
                rotulo="Adiar (troca o horário com o item abaixo)"
                desabilitado={!posterior?.id}
                aoClicar={() => trocar(posterior)}
              />
              <BotaoMini icone={Copy} rotulo="Duplicar item" aoClicar={duplicar} />
              <span className="ml-auto">
                <AdminAcoes entidade="opcao" registro={{ event_id: String(item.id) }}>
                  Como chegar
                </AdminAcoes>
              </span>
            </div>
          )}
        </Cartao>
      </div>
    </li>
  )
}

function BotaoMini({
  icone: Icone,
  rotulo,
  aoClicar,
  desabilitado,
}: {
  icone: LucideIcon
  rotulo: string
  aoClicar: () => void
  desabilitado?: boolean
}) {
  return (
    <button
      onClick={aoClicar}
      disabled={desabilitado}
      aria-label={rotulo}
      title={rotulo}
      className="sem-impressao flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl text-(--color-tinta-3) transition-colors hover:bg-(--color-superficie-2) hover:text-(--destaque) disabled:cursor-not-allowed disabled:opacity-35"
    >
      <Icone size={15} />
    </button>
  )
}

/** Nível 3: o que só interessa quando a pessoa vai fazer aquilo. */
function DetalheItem({
  item,
  derivada,
  moeda,
  podeEditar,
}: {
  item: Record<string, any>
  derivada: Derivada | null
  moeda: string
  podeEditar: boolean
}) {
  const { snapshot } = useTrip()
  const dicas = linhas(item.dicas)
  const links = lerLinks(item.links)
  const opcoes = ((item.opcoes ?? []) as Record<string, any>[])
    .slice()
    .sort(
      (a, b) => Number(b.recomendado) - Number(a.recomendado) || Number(a.ordem) - Number(b.ordem),
    )
  const reserva = (snapshot?.reservas ?? []).find((r: any) => r.id === item.reserva_id) as
    Record<string, any> | undefined
  const documento = (snapshot?.documentos ?? []).find((d: any) => d.id === item.documento_id) as
    Record<string, any> | undefined

  return (
    <div className="mt-3 space-y-3 border-t border-(--color-borda) pt-3">
      {derivada?.detalhe}

      {item.descricao && <p className="text-sm text-(--color-tinta-2)">{String(item.descricao)}</p>}

      {item.endereco && (
        <div className="flex items-start gap-2 text-sm text-(--color-tinta-2)">
          <MapPin size={14} className="mt-0.5 shrink-0 text-(--color-tinta-3)" />
          <span className="min-w-0 flex-1">{String(item.endereco)}</span>
          {item.lat != null && item.lon != null && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lon}`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-[13px] font-medium"
              style={{ color: 'var(--destaque)' }}
            >
              Ver localização
            </a>
          )}
        </div>
      )}

      {(item.como_chegar || opcoes.length > 0) && (
        <div>
          <Rotulo>Como chegar</Rotulo>
          {item.como_chegar && (
            <p className="mt-1 text-sm whitespace-pre-line text-(--color-tinta-2)">
              {String(item.como_chegar)}
            </p>
          )}
          {opcoes.length > 0 && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {opcoes.map((o) => {
                const IconeModo = ICONE_MODO[String(o.modo)] ?? Route
                return (
                  <div
                    key={String(o.id)}
                    className="rounded-xl border border-(--color-borda) p-2.5"
                    style={
                      o.recomendado
                        ? {
                            borderColor: 'var(--color-destaque-fraco)',
                            background: 'var(--color-destaque-tenue)',
                          }
                        : undefined
                    }
                  >
                    <div className="flex items-center gap-1.5">
                      <IconeModo size={14} className="text-(--color-tinta-2)" />
                      <span className="text-[13px] font-semibold">
                        {NOME_MODO[String(o.modo)] ?? String(o.modo)}
                      </span>
                      {o.recomendado && (
                        <Star
                          size={12}
                          style={{ color: 'var(--destaque)' }}
                          aria-label="recomendado"
                        />
                      )}
                      {podeEditar && (
                        <span className="ml-auto">
                          <AdminAcoes entidade="opcao" registro={o} />
                        </span>
                      )}
                    </div>
                    <p className="tab-num mt-1 text-[12px] text-(--color-tinta-3)">
                      {[formatarDuracao(o.duracao_min), formatarDistancia(o.distancia_m), o.custo]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {o.detalhe && (
                      <p className="mt-0.5 text-[12px] text-(--color-tinta-3)">
                        {String(o.detalhe)}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {dicas.length > 0 && (
        <div>
          <Rotulo>Dicas</Rotulo>
          <ul className="mt-1 space-y-1">
            {dicas.map((d, i) => (
              <li key={i} className="flex gap-2 text-sm text-(--color-tinta-2)">
                <Lightbulb size={14} className="mt-0.5 shrink-0 text-(--color-tinta-3)" />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {reserva && (
        <div>
          <Rotulo>Reserva</Rotulo>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-medium">{String(reserva.nome)}</span>
            {reserva.localizador && (
              <Copiar valor={String(reserva.localizador)} rotulo="Localizador" />
            )}
            {reserva.inicio_em && (
              <span className="tab-num text-(--color-tinta-3)">
                {formatarHora(reserva.inicio_em)}
              </span>
            )}
          </div>
        </div>
      )}

      {documento && (
        <div>
          <Rotulo>Documento necessário</Rotulo>
          <p className="mt-1 flex items-center gap-2 text-sm">
            <FileText size={14} className="text-(--color-tinta-3)" />
            {String(documento.titulo)}
            {documento.valor && (
              <span className="tab-num text-(--color-tinta-3)">{String(documento.valor)}</span>
            )}
          </p>
        </div>
      )}

      {Number(item.custo_centavos) > 0 && (
        <p className="text-sm">
          <span className="text-(--color-tinta-3)">Custo estimado: </span>
          <span className="tab-num font-semibold">
            {formatarDinheiro(Number(item.custo_centavos), moeda)}
          </span>
        </p>
      )}

      {links.length > 0 && (
        <div>
          <Rotulo>Links úteis</Rotulo>
          <ul className="mt-1 space-y-1">
            {links.map((l) => (
              <li key={l.url}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium"
                  style={{ color: 'var(--destaque)' }}
                >
                  {l.rotulo}
                  <ExternalLink size={12} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {item.nota && <p className="text-sm text-(--color-tinta-3) italic">{String(item.nota)}</p>}
    </div>
  )
}

// ---------------------------------------------------------------- coluna de apoio

function ColunaApoio({ dia }: { dia: DiaRoteiro }) {
  const { snapshot } = useTrip()
  const resumo = resumoDoDia(dia.itens)
  const links = lerLinks(dia.meta?.links)
  const hospedagem = hospedagemDoDia(dia, snapshot)
  const moeda = String(snapshot?.viagem?.moeda ?? 'EUR')

  return (
    <>
      {hospedagem && (
        <Cartao>
          <Rotulo>Sua acomodação</Rotulo>
          <p className="mt-1.5 font-semibold">{String(hospedagem.nome)}</p>
          {hospedagem.endereco && (
            <p className="mt-0.5 text-[13px] text-(--color-tinta-3)">
              {String(hospedagem.endereco)}
            </p>
          )}
          <div className="tab-num mt-2 space-y-0.5 text-[13px] text-(--color-tinta-2)">
            {hospedagem.inicio_em && (
              <p>
                Check-in {formatarData(hospedagem.inicio_em)} ·{' '}
                {formatarHora(hospedagem.inicio_em) || 'a confirmar'}
              </p>
            )}
            {hospedagem.fim_em && (
              <p>
                Check-out {formatarData(hospedagem.fim_em)} ·{' '}
                {formatarHora(hospedagem.fim_em) || 'a confirmar'}
              </p>
            )}
            {hospedagem.inicio_em && hospedagem.fim_em && (
              <p className="text-(--color-tinta-3)">
                {noites(String(hospedagem.inicio_em), String(hospedagem.fim_em))} noites
              </p>
            )}
          </div>
          {hospedagem.localizador && (
            <div className="mt-2">
              <Copiar valor={String(hospedagem.localizador)} rotulo="Localizador" />
            </div>
          )}
        </Cartao>
      )}

      <ChecklistDoDia dia={dia} />

      <RituaisDoDia dia={dia} />

      {resumo.porModo.length > 0 && (
        <Cartao>
          <Rotulo>Deslocamentos</Rotulo>
          <ul className="mt-2 space-y-1.5">
            {resumo.porModo.map((m) => {
              const IconeModo = ICONE_MODO[m.modo] ?? Route
              return (
                <li key={m.modo} className="flex items-center gap-2 text-[13px]">
                  <IconeModo size={14} className="shrink-0 text-(--color-tinta-3)" />
                  <span className="font-medium">{NOME_MODO[m.modo] ?? m.modo}</span>
                  <span className="tab-num ml-auto text-(--color-tinta-3)">
                    {[formatarDistancia(m.distanciaM), formatarDuracao(m.minutos)]
                      .filter(Boolean)
                      .join(' · ') || `${m.vezes}×`}
                  </span>
                </li>
              )
            })}
          </ul>
          {resumo.minutosDeslocamento > 0 && (
            <p className="mt-2 border-t border-(--color-borda) pt-2 text-[13px] text-(--color-tinta-2)">
              Tempo total em trânsito:{' '}
              <span className="tab-num font-semibold">
                {formatarDuracao(resumo.minutosDeslocamento)}
              </span>
            </p>
          )}
        </Cartao>
      )}

      <GastosDoDia dia={dia} moeda={moeda} />

      {(links.length > 0 || dia.meta?.mapa_url) && (
        <Cartao>
          <Rotulo>Links úteis do dia</Rotulo>
          <ul className="mt-2 space-y-1.5">
            {dia.meta?.mapa_url && (
              <li>
                <a
                  href={String(dia.meta.mapa_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium"
                  style={{ color: 'var(--destaque)' }}
                >
                  <IconeMapa size={13} /> Ver rota do dia
                </a>
              </li>
            )}
            {links.map((l) => (
              <li key={l.url}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium"
                  style={{ color: 'var(--destaque)' }}
                >
                  {l.rotulo} <ExternalLink size={12} />
                </a>
              </li>
            ))}
          </ul>
        </Cartao>
      )}
    </>
  )
}

/**
 * O checklist do dia NÃO é um sistema novo.
 *
 * São os itens do checklist da viagem cujo prazo cai neste dia, marcados no
 * mesmo `checklist_state` da aba Checklist. Um segundo sistema de tarefas por
 * dia significaria a mesma tarefa marcada num lugar e aberta no outro.
 */
function ChecklistDoDia({ dia }: { dia: DiaRoteiro }) {
  const { snapshot, mutate } = useTrip()
  if (!snapshot) return null

  const meuId = snapshot.eu.participanteId
  const doDia = (snapshot.checklist as Record<string, any>[]).filter(
    (i) => chaveDia(i.prazo_ideal) === dia.chave || chaveDia(i.prazo_maximo) === dia.chave,
  )
  if (doDia.length === 0) return null

  const meus = Object.fromEntries(
    snapshot.checklist_state
      .filter((e) => e.traveler_id === meuId)
      .map((e) => [String(e.item_id), Boolean(e.feito)]),
  )
  const feitos = doDia.filter((i) => meus[String(i.id)]).length

  return (
    <Cartao>
      <div className="flex items-baseline justify-between">
        <Rotulo>Checklist do dia</Rotulo>
        <span className="tab-num text-[13px] font-semibold text-(--color-tinta-3)">
          {feitos}/{doDia.length}
        </span>
      </div>
      <ul className="mt-2 space-y-1">
        {doDia.map((i) => (
          <li key={String(i.id)}>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl py-1.5 text-sm transition-colors hover:bg-(--color-superficie-2)">
              <input
                type="checkbox"
                checked={Boolean(meus[String(i.id)])}
                onChange={() =>
                  void mutate({
                    op: 'editar',
                    entidade: 'checklist_state',
                    campos: { item_id: String(i.id), feito: !meus[String(i.id)] },
                    client_ts: agora(),
                  })
                }
                className="h-4 w-4 shrink-0 accent-(--color-destaque)"
              />
              <span className={meus[String(i.id)] ? 'text-(--color-tinta-3) line-through' : ''}>
                {String(i.titulo)}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </Cartao>
  )
}

/**
 * "Antes de sair" e "antes de dormir": as listas do dia, ticadas neste aparelho.
 *
 * ponytail: a marcação vive em localStorage, não no banco. São rituais de um dia
 * ("levar o casaco", "carregar o celular") que não valem uma tabela nem uma
 * escrita sincronizada entre cinco pessoas. Se um dia alguém quiser ver o que o
 * outro já separou, isto vira `checklist_state` — a lista em si já está gravada
 * em `itinerary_days`, então só a marcação precisaria mudar de lugar.
 */
function RituaisDoDia({ dia }: { dia: DiaRoteiro }) {
  const sair = linhas(dia.meta?.antes_sair)
  const dormir = linhas(dia.meta?.antes_dormir)
  if (sair.length === 0 && dormir.length === 0) return null

  return (
    <>
      {sair.length > 0 && (
        <ListaLocal
          key={`${dia.chave}:sair`}
          titulo="Antes de sair"
          icone={Sunrise}
          chave={`${dia.chave}:sair`}
          itens={sair}
        />
      )}
      {dormir.length > 0 && (
        <ListaLocal
          key={`${dia.chave}:dormir`}
          titulo="Antes de dormir"
          icone={Moon}
          chave={`${dia.chave}:dormir`}
          itens={dormir}
        />
      )}
    </>
  )
}

function ListaLocal({
  titulo,
  icone: Icone,
  chave,
  itens,
}: {
  titulo: string
  icone: LucideIcon
  chave: string
  itens: string[]
}) {
  const armazem = `roteiro:ritual:${chave}`
  // Estado inicial, não efeito: o componente só monta no cliente (a aba inteira
  // espera o snapshot), e o `key` do chamador o remonta a cada dia — então ler
  // aqui é a leitura certa, uma vez, sem render extra.
  const [marcados, setMarcados] = useState<string[]>(() => {
    try {
      const bruto = localStorage.getItem(armazem)
      return bruto ? (JSON.parse(bruto) as string[]) : []
    } catch {
      /* aba anônima ou site data bloqueado: a lista funciona, só não lembra */
      return []
    }
  })

  const alternar = (item: string) => {
    const novo = marcados.includes(item) ? marcados.filter((m) => m !== item) : [...marcados, item]
    setMarcados(novo)
    try {
      localStorage.setItem(armazem, JSON.stringify(novo))
    } catch {
      /* idem */
    }
  }

  return (
    <Cartao>
      <p className="t-legenda flex items-center gap-1.5">
        <Icone size={13} /> {titulo}
      </p>
      <ul className="mt-2 space-y-1">
        {itens.map((i) => (
          <li key={i}>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl py-1.5 text-sm transition-colors hover:bg-(--color-superficie-2)">
              <input
                type="checkbox"
                checked={marcados.includes(i)}
                onChange={() => alternar(i)}
                className="h-4 w-4 shrink-0 accent-(--color-destaque)"
              />
              <span className={marcados.includes(i) ? 'text-(--color-tinta-3) line-through' : ''}>
                {i}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </Cartao>
  )
}

/**
 * O dinheiro do dia, no recorte que esta pessoa pode ver.
 *
 * Quem administra vê as despesas da viagem que caem neste dia. Um viajante comum
 * vê as parcelas DELE que vencem hoje — que é tudo que o servidor mandou. Não há
 * um total do grupo a esconder aqui porque ele nunca chegou ao navegador.
 */
function GastosDoDia({ dia, moeda }: { dia: DiaRoteiro; moeda: string }) {
  const { snapshot } = useTrip()
  const fin = snapshot?.financeiro
  if (!fin) return null

  const itens = fin.admin
    ? (fin.despesas as Record<string, any>[])
        .filter((d) => chaveDia(d.ocorre_em) === dia.chave)
        .map((d) => ({
          id: String(d.id),
          nome: String(d.descricao),
          centavos: Number(d.valor_centavos),
        }))
    : fin.obrigacoes
        .filter((o) => chaveDia(o.vence_em) === dia.chave)
        .map((o) => ({ id: o.id, nome: o.descricao, centavos: o.valor_centavos }))

  const estimado = dia.itens.reduce((s, e) => s + (Number(e.custo_centavos) || 0), 0)
  if (itens.length === 0 && estimado === 0) return null

  const total = itens.reduce((s, i) => s + i.centavos, 0)

  return (
    <Cartao>
      <Rotulo>{fin.admin ? 'Gastos do dia' : 'Seus pagamentos de hoje'}</Rotulo>
      {estimado > 0 && (
        <p className="mt-1.5 flex items-baseline justify-between text-[13px]">
          <span className="text-(--color-tinta-3)">Estimado no roteiro</span>
          <span className="tab-num font-semibold">{formatarDinheiro(estimado, moeda)}</span>
        </p>
      )}
      {itens.map((i) => (
        <p key={i.id} className="mt-1 flex items-baseline justify-between gap-3 text-[13px]">
          <span className="min-w-0 truncate text-(--color-tinta-2)">{i.nome}</span>
          <span className="tab-num shrink-0 font-semibold">
            {formatarDinheiro(i.centavos, moeda)}
          </span>
        </p>
      ))}
      {itens.length > 0 && (
        <p className="mt-2 flex items-baseline justify-between border-t border-(--color-borda) pt-2 text-[13px] font-semibold">
          <span>{fin.admin ? 'Registrado' : 'A pagar'}</span>
          <span className="tab-num">{formatarDinheiro(total, moeda)}</span>
        </p>
      )}
    </Cartao>
  )
}

/** O fecho do dia. Os mesmos números do cabeçalho, para quem chegou rolando. */
function ResumoFinal({ resumo, moeda }: { resumo: ReturnType<typeof resumoDoDia>; moeda: string }) {
  if (resumo.locais + resumo.deslocamentos + resumo.refeicoes === 0) return null
  return (
    <Cartao tom="destaque">
      <Rotulo>Resumo do dia</Rotulo>
      <ChipsResumo resumo={resumo} moeda={moeda} />
    </Cartao>
  )
}

// ---------------------------------------------------------------- navegação

function NavegacaoDias({
  dias,
  indice,
  aoEscolher,
}: {
  dias: DiaRoteiro[]
  indice: number
  aoEscolher: (chave: string) => void
}) {
  const anterior = dias[indice - 1]
  const proximo = dias[indice + 1]
  if (!anterior && !proximo) return null

  const rotulo = (d: DiaRoteiro) =>
    [
      formatarData(d.chave, { day: '2-digit', month: 'short' }),
      String(d.meta?.titulo ?? d.meta?.cidade ?? ''),
    ]
      .filter(Boolean)
      .join(' · ')

  return (
    <div className="sem-impressao mt-6 flex items-stretch gap-2">
      {anterior ? (
        <button
          onClick={() => aoEscolher(anterior.chave)}
          className="toque flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-2xl border border-(--color-borda) bg-(--color-cartao) px-3 text-left transition-colors hover:border-(--color-borda-forte)"
        >
          <ChevronLeft size={16} className="shrink-0 text-(--color-tinta-3)" />
          <span className="min-w-0">
            <span className="block text-[11px] text-(--color-tinta-3)">Dia anterior</span>
            <span className="block truncate text-[13px] font-medium">{rotulo(anterior)}</span>
          </span>
        </button>
      ) : (
        <span className="flex-1" />
      )}
      {proximo ? (
        <button
          onClick={() => aoEscolher(proximo.chave)}
          className="toque flex min-w-0 flex-1 cursor-pointer items-center justify-end gap-2 rounded-2xl border border-(--color-borda) bg-(--color-cartao) px-3 text-right transition-colors hover:border-(--color-borda-forte)"
        >
          <span className="min-w-0">
            <span className="block text-[11px] text-(--color-tinta-3)">Próximo dia</span>
            <span className="block truncate text-[13px] font-medium">{rotulo(proximo)}</span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-(--color-tinta-3)" />
        </button>
      ) : (
        <span className="flex-1" />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- integrações

type Derivada = {
  /** O item sintético que entra na linha do tempo. Nunca gravado. */
  como: Record<string, any>
  /** De onde ele veio, dito na tela: "do cadastro de voos". */
  origem: string
  detalhe?: ReactNode
}

/**
 * O que já está cadastrado em outra aba e acontece neste dia.
 *
 * Voo, check-in/check-out e embarque no navio aparecem na linha do tempo sem
 * virar registro de roteiro. Quem edita o voo continua editando na aba Voos, e
 * o roteiro reflete a mudança no mesmo instante — nada a sincronizar.
 */
function entradasDerivadas(
  dia: DiaRoteiro,
  snapshot: ReturnType<typeof useTrip>['snapshot'],
): Derivada[] {
  if (!snapshot) return []
  const saida: Derivada[] = []

  for (const v of snapshot.voos as Record<string, any>[]) {
    if (chaveDia(v.parte_em) !== dia.chave) continue
    const rota = [v.origem_iata ?? v.origem_cidade, v.destino_iata ?? v.destino_cidade]
      .filter(Boolean)
      .join(' → ')
    saida.push({
      como: {
        id: `voo:${v.id}`,
        tipo: 'voo',
        ocorre_em: v.parte_em,
        fim_em: v.chega_em,
        titulo: `Voo ${rota}`,
        local: [v.companhia, v.numero].filter(Boolean).join(' '),
        cidade: v.origem_cidade,
      },
      origem: 'do cadastro de voos',
      detalhe: (
        <div className="tab-num space-y-0.5 text-[13px] text-(--color-tinta-2)">
          {v.duracao_min ? <p>Duração {formatarDuracao(v.duracao_min)}</p> : null}
          {v.terminal ? <p>Terminal {String(v.terminal)}</p> : null}
          {v.portao ? <p>Portão {String(v.portao)}</p> : null}
          {v.assento ? <p>Assento {String(v.assento)}</p> : null}
          {v.localizador ? <Copiar valor={String(v.localizador)} rotulo="Localizador" /> : null}
        </div>
      ),
    })
  }

  for (const r of snapshot.reservas as Record<string, any>[]) {
    if (r.tipo !== 'hospedagem') continue
    if (chaveDia(r.inicio_em) === dia.chave) {
      saida.push({
        como: {
          id: `checkin:${r.id}`,
          tipo: 'hospedagem',
          ocorre_em: r.inicio_em,
          titulo: `Check-in · ${String(r.nome)}`,
          local: r.endereco,
          cidade: r.cidade,
        },
        origem: 'da aba Hospedagem',
      })
    }
    if (chaveDia(r.fim_em) === dia.chave) {
      saida.push({
        como: {
          id: `checkout:${r.id}`,
          tipo: 'hospedagem',
          ocorre_em: r.fim_em,
          titulo: `Check-out · ${String(r.nome)}`,
          local: r.endereco,
          cidade: r.cidade,
        },
        origem: 'da aba Hospedagem',
      })
    }
  }

  for (const c of snapshot.cruzeiros as Record<string, any>[]) {
    if (chaveDia(c.embarque_em) === dia.chave) {
      saida.push({
        como: {
          id: `embarque:${c.id}`,
          tipo: 'cruzeiro',
          ocorre_em: c.embarque_em,
          titulo: `Embarque · ${String(c.navio)}`,
          local: c.porto_embarque,
          ancora: true,
        },
        origem: 'da aba Cruzeiro',
      })
    }
    if (chaveDia(c.desembarque_em) === dia.chave) {
      saida.push({
        como: {
          id: `desembarque:${c.id}`,
          tipo: 'cruzeiro',
          ocorre_em: c.desembarque_em,
          titulo: `Desembarque · ${String(c.navio)}`,
          local: c.porto_desembarque,
          ancora: true,
        },
        origem: 'da aba Cruzeiro',
      })
    }
    for (const p of (c.portos ?? []) as Record<string, any>[]) {
      if (chaveDia(p.chega_em) !== dia.chave) continue
      saida.push({
        como: {
          id: `porto:${p.id}`,
          tipo: 'cruzeiro',
          ocorre_em: p.chega_em,
          fim_em: p.sai_em,
          titulo: p.dia_no_mar ? 'Dia no mar' : `Escala · ${String(p.porto ?? p.cidade ?? '')}`,
          cidade: p.cidade,
        },
        origem: 'da aba Cruzeiro',
      })
    }
  }

  return saida
}

/** A hospedagem em que se dorme NESTE dia: check-in até a véspera do check-out. */
function hospedagemDoDia(dia: DiaRoteiro, snapshot: ReturnType<typeof useTrip>['snapshot']) {
  return (snapshot?.reservas as Record<string, any>[] | undefined)?.find((r) => {
    if (r.tipo !== 'hospedagem') return false
    const entra = chaveDia(r.inicio_em)
    const sai = chaveDia(r.fim_em)
    if (!entra) return false
    return dia.chave >= entra && (!sai || dia.chave <= sai)
  })
}

/** Timestamp do banco -> o formato que o campo datetime-local e o zod aceitam. */
function paraCampo(valor: unknown): string {
  const bruto = String(valor ?? '')
  const m = bruto.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
  return m ? `${m[1]}T${m[2]}` : bruto
}
