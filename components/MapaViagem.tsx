'use client'

// A VISÃO MAPA do roteiro: a viagem inteira sobre o mapa, ou um dia dentro dela.
//
// Não é um módulo novo — é a terceira leitura do MESMO roteiro que a Agenda e os
// Deslocamentos já mostram, e por isso não tem aba própria e não guarda nada.
// Tudo o que aparece aqui vem do snapshot por `lib/mapaViagem.ts` (puro,
// testado) e a navegação reusa o `ComoChegar` do dia — duas implementações de
// "saia às" dariam dois horários para o mesmo compromisso, e quem está na rua
// não teria como saber qual dos dois está certo.
//
// O QUE ESTA TELA NUNCA FAZ: inventar. Um lugar sem endereço herda o centro da
// cidade e aparece com o anel tracejado de "localização aproximada"; uma perna
// que nenhum voo, trem ou traslado registra sai apagada e escrita como "rota não
// verificada". As duas marcas são visíveis ANTES de qualquer texto, porque quem
// abre um mapa acredita no que vê nele.
import { useMemo, useState } from 'react'
import {
  Layers,
  MapPin,
  X,
  ChevronRight,
  Ship,
  TriangleAlert,
  Navigation,
  CircleDot,
  Globe2,
  CloudOff,
} from 'lucide-react'
import { MapaRota, ESTILO_CATEGORIA, type Segmento } from './MapaRota.tsx'
import { CorpoComoChegar, SaiaAs, ICONE_MODO, useDesktop } from './ComoChegar.tsx'
import { AppModal, Botao, Cartao, Interruptor, Rotulo, Vazio } from './ui.tsx'
import { useTrip } from './TripProvider.tsx'
import {
  NOME_CATEGORIA,
  auditarMapa,
  etapasDaViagem,
  marcadoresDaViagem,
  marcadoresDoDia,
  mesmaCidade,
  pernasDaViagem,
  type Categoria,
  type Etapa,
  type Marcador,
  type Perna,
} from '@/lib/mapaViagem.ts'
import { trechosDoDia, type Trecho } from '@/lib/trechos.ts'
import { formatarData, formatarDistancia, formatarDuracao, formatarHora } from '@/lib/derive.ts'
import { corDaEtapa } from '@/config/theme.ts'

/** As camadas ligáveis, na ordem em que se procura por elas. `rota` não é uma
    categoria de marcador — é a linha da viagem —, e por isso viaja à parte. */
const CAMADAS: (Categoria | 'rota')[] = [
  'cidade',
  'hotel',
  'atividade',
  'aeroporto',
  'estacao',
  'porto',
  'restaurante',
  'rota',
]

const NOME_CAMADA: Record<Categoria | 'rota', string> = {
  ...NOME_CATEGORIA,
  rota: 'Rota da viagem',
}

/**
 * O que vem ligado ao abrir.
 *
 * Restaurante começa DESLIGADO de propósito: numa viagem de duas semanas ele é
 * a categoria mais numerosa e a menos consultada no mapa — quem procura onde
 * jantar abre a agenda do dia, não o mapa da Europa. É a mesma escolha da tela
 * de referência, e é reversível num toque.
 */
const CAMADAS_PADRAO: Record<Categoria | 'rota', boolean> = {
  cidade: true,
  hotel: true,
  atividade: true,
  aeroporto: true,
  estacao: true,
  porto: true,
  restaurante: false,
  rota: true,
}

type Selecao =
  | { tipo: 'etapa'; id: string }
  | { tipo: 'marcador'; id: string }
  | { tipo: 'perna'; id: string }
  | null

export function MapaViagem({
  chaveDoDia,
  rotuloDoDia,
  aoVerDia,
}: {
  /** O dia em foco na aba Roteiro. `null` no modo "toda a viagem". */
  chaveDoDia: string | null
  rotuloDoDia: string
  /** Leva a Agenda até um dia — o botão "Ver dia a dia" do painel. */
  aoVerDia: (chave: string) => void
}) {
  const { snapshot, online, ultimaSync } = useTrip()
  const desktop = useDesktop()
  const [camadas, setCamadas] = useState(CAMADAS_PADRAO)
  const [camadasAbertas, setCamadasAbertas] = useState(true)
  const [selecao, setSelecao] = useState<Selecao>(null)
  const [tudo, setTudo] = useState(true)
  const [auditoriaAberta, setAuditoriaAberta] = useState(false)
  const [comoChegar, setComoChegar] = useState<Trecho | null>(null)

  // Recalculado só quando o snapshot muda — não a cada toque num pino (§29).
  const etapas = useMemo(() => etapasDaViagem(snapshot), [snapshot])
  // Uma cor por etapa, em rotação (regra visual: o mapa é a única tela que
  // colore por cidade — o resto da interface continua monocromático). Chave é
  // o NOME da cidade porque é por nome que os marcadores se agrupam a ela
  // (`mesmaCidade`), não por id de `places`.
  const corPorCidade = useMemo(
    () => new Map(etapas.map((e, i) => [e.cidade, corDaEtapa(i)])),
    [etapas],
  )
  const pernas = useMemo(() => pernasDaViagem(snapshot), [snapshot])
  const auditoria = useMemo(() => auditarMapa(snapshot), [snapshot])
  const todosMarcadores = useMemo(() => marcadoresDaViagem(snapshot), [snapshot])
  const doDia = useMemo(
    () => (chaveDoDia ? marcadoresDoDia(snapshot, chaveDoDia) : []),
    [snapshot, chaveDoDia],
  )

  const etapaSelecionada =
    selecao?.tipo === 'etapa' ? (etapas.find((e) => e.id === selecao.id) ?? null) : null
  const marcadorSelecionado =
    selecao?.tipo === 'marcador' ? (todosMarcadores.find((m) => m.id === selecao.id) ?? null) : null
  const pernaSelecionada =
    selecao?.tipo === 'perna' ? (pernas.find((p) => p.id === selecao.id) ?? null) : null

  // O recorte, em três degraus: a viagem inteira, um dia, ou uma cidade. Uma
  // cidade escolhida MANDA sobre o dia — foi o gesto mais recente da pessoa.
  const visiveis = useMemo(() => {
    const base = etapaSelecionada
      ? todosMarcadores.filter(
          (m) =>
            mesmaCidade(m.cidade, etapaSelecionada.cidade) || m.nome === etapaSelecionada.cidade,
        )
      : tudo
        ? todosMarcadores
        : doDia
    return base.filter((m) => camadas[m.categoria])
  }, [etapaSelecionada, tudo, todosMarcadores, doDia, camadas])

  // A rota só aparece no mapa macro: dentro de uma cidade ela seria uma linha
  // reta ligando dois bairros, que é uma afirmação sobre o trajeto que ninguém
  // conferiu. Ali quem responde "como vou" é o Como chegar.
  const segmentos: Segmento[] = useMemo(() => {
    if (!camadas.rota || etapaSelecionada) return []
    // A cor da perna é a da cidade de ORIGEM: sair de Lisboa desenha verde até
    // chegar em Madri, que passa a vermelho na perna seguinte — o olho lê a
    // rota inteira como uma sequência de capítulos, não uma linha só.
    return pernas.map((p) => ({
      id: p.id,
      de: p.de,
      para: p.para,
      modo: p.modo,
      verificado: p.verificado,
      rotulo: `${p.de.nome} → ${p.para.nome}`,
      cor: corPorCidade.get(p.de.nome),
    }))
  }, [camadas.rota, etapaSelecionada, pernas, corPorCidade])

  if (!snapshot) return null

  if (todosMarcadores.length === 0) {
    return (
      <Vazio
        titulo="Nada para mostrar no mapa ainda"
        texto="O mapa se monta sozinho a partir das cidades, das paradas do roteiro, dos hotéis e das escalas do cruzeiro. Cadastre as cidades em Cidades — é de lá que vem a coordenada que localiza o resto."
      />
    )
  }

  const escolher = (s: Selecao) => {
    setSelecao(s)
    // Escolher uma cidade sai do modo "toda a viagem": é o zoom que a pessoa
    // pediu ao tocar nela.
    if (s?.tipo === 'etapa') setTudo(false)
  }

  const painel = (
    <PainelContexto
      etapa={etapaSelecionada}
      marcador={marcadorSelecionado}
      perna={pernaSelecionada}
      marcadores={todosMarcadores}
      chaveDoDia={chaveDoDia}
      aoFechar={() => setSelecao(null)}
      aoVerDia={aoVerDia}
      aoComoChegar={setComoChegar}
    />
  )

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        {/* No celular a coluna vira duas gavetas acima do mapa — nunca duas
            colunas espremidas (§33). */}
        <div className="min-w-0 space-y-3">
          <ListaEtapas
            etapas={etapas}
            selecionada={etapaSelecionada?.id ?? null}
            aoEscolher={(id) => escolher(id ? { tipo: 'etapa', id } : null)}
          />
          <PainelCamadas
            camadas={camadas}
            aberto={camadasAbertas}
            aoAlternarAberto={() => setCamadasAbertas((v) => !v)}
            aoMudar={(chave, v) => setCamadas((c) => ({ ...c, [chave]: v }))}
          />
        </div>

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setTudo(true)
                setSelecao(null)
              }}
              aria-pressed={tudo && !etapaSelecionada}
              className="toque flex cursor-pointer items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium transition-colors"
              style={
                tudo && !etapaSelecionada
                  ? { background: 'var(--color-destaque-tenue)', color: 'var(--destaque)' }
                  : { color: 'var(--color-tinta-2)', border: '1px solid var(--color-borda-forte)' }
              }
            >
              <Globe2 size={14} aria-hidden /> Mostrar toda a viagem
            </button>
            <button
              type="button"
              onClick={() => {
                setTudo(false)
                setSelecao(null)
              }}
              aria-pressed={!tudo && !etapaSelecionada}
              className="toque flex cursor-pointer items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium transition-colors"
              style={
                !tudo && !etapaSelecionada
                  ? { background: 'var(--color-destaque-tenue)', color: 'var(--destaque)' }
                  : { color: 'var(--color-tinta-2)', border: '1px solid var(--color-borda-forte)' }
              }
            >
              <CircleDot size={14} aria-hidden /> {rotuloDoDia}
            </button>
            <span className="ml-auto text-[12px] text-(--color-tinta-3)">
              {visiveis.length} {visiveis.length === 1 ? 'local' : 'locais'}
            </span>
          </div>

          {/* §26: o que sobrevive sem sinal, dito na cara. O ladrilho vem da
              rede e some no avião; os locais, endereços, coordenadas e
              deslocamentos vêm do cache e continuam ali. Fingir que o mapa
              inteiro funciona offline seria a mentira mais cara desta tela —
              ela é lida exatamente quando não há como conferir. */}
          {!online && (
            <p
              className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[12px]"
              style={{
                background: 'var(--color-superficie-2)',
                color: 'var(--color-tinta-2)',
              }}
            >
              <CloudOff size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                Mapa detalhado indisponível offline. Os locais, endereços e rotas salvos continuam
                aqui.
                {ultimaSync && (
                  <span className="tab-num block text-(--color-tinta-3)">
                    Última sincronização: {formatarData(ultimaSync)} {formatarHora(ultimaSync)}
                  </span>
                )}
              </span>
            </p>
          )}

          <Cartao className="!p-0 overflow-hidden">
            <div className="h-[24rem] sm:h-[30rem]">
              <MapaRota
                lugares={[]}
                marcadores={visiveis}
                segmentos={segmentos}
                selecionado={selecao?.id ?? null}
                aoSelecionar={(id) => escolher({ tipo: 'marcador', id })}
                aoSelecionarSegmento={(id) => escolher({ tipo: 'perna', id })}
                corMarcador={(m) =>
                  m.categoria === 'cidade' ? corPorCidade.get(m.cidade ?? '') : undefined
                }
              />
            </div>
          </Cartao>

          {/* A alternativa textual do mapa (§34): a mesma informação em lista,
              para quem não enxerga o pino e para quando o ladrilho não carrega.
              Não é um extra — sem ela o mapa é a única fonte, e um mapa que só
              existe como imagem exclui quem usa leitor de tela. */}
          <ListaTextual
            marcadores={visiveis}
            corPorCidade={corPorCidade}
            aoEscolher={(id) => escolher({ tipo: 'marcador', id })}
          />

          <ResumoAuditoria auditoria={auditoria} aoAbrir={() => setAuditoriaAberta(true)} />
        </div>
      </div>

      {selecao && (desktop ? painel : <div className="lg:hidden">{painel}</div>)}

      {auditoriaAberta && (
        <AppModal
          titulo="Auditoria do mapa"
          tamanho="grande"
          aoFechar={() => setAuditoriaAberta(false)}
        >
          <DetalheAuditoria auditoria={auditoria} />
        </AppModal>
      )}

      {comoChegar && (
        <AppModal titulo="Como chegar" aoFechar={() => setComoChegar(null)}>
          <CorpoComoChegar trecho={comoChegar} />
        </AppModal>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- painel esquerdo

/** "Roteiro no mapa": as etapas na ordem da viagem, uma linha por cidade. */
function ListaEtapas({
  etapas,
  selecionada,
  aoEscolher,
}: {
  etapas: Etapa[]
  selecionada: string | null
  aoEscolher: (id: string | null) => void
}) {
  if (etapas.length === 0) return null

  return (
    <Cartao className="!p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <Rotulo>Roteiro no mapa</Rotulo>
        {selecionada && (
          <button
            type="button"
            onClick={() => aoEscolher(null)}
            className="flex min-h-9 cursor-pointer items-center gap-1 text-[12px] font-medium"
            style={{ color: 'var(--destaque)' }}
          >
            <X size={13} aria-hidden /> Limpar
          </button>
        )}
      </div>
      <ul className="divide-y divide-(--color-borda)">
        {etapas.map((e, i) => {
          const ativa = selecionada === e.id
          const cor = corDaEtapa(i)
          const partes = [
            e.atividades > 0 &&
              `${e.atividades} ${e.atividades === 1 ? 'atividade' : 'atividades'}`,
            e.hoteis > 0 && `${e.hoteis} ${e.hoteis === 1 ? 'hotel' : 'hotéis'}`,
            e.destinos > 0 && `${e.destinos} destinos`,
          ].filter(Boolean)
          return (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => aoEscolher(ativa ? null : e.id)}
                aria-pressed={ativa}
                className="toque flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-(--color-superficie-2)"
                style={ativa ? { background: 'var(--color-destaque-tenue)' } : undefined}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
                  style={{ background: cor }}
                >
                  {e.cruzeiro ? <Ship size={15} aria-hidden /> : <MapPin size={15} aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">
                    {e.cidade}
                    {e.pais ? `, ${e.pais}` : ''}
                  </span>
                  <span className="tab-num block text-[12px] text-(--color-tinta-3)">
                    {[formatarData(e.chegaEm), formatarData(e.saiEm)].filter(Boolean).join(' — ') ||
                      'Sem datas'}
                  </span>
                  {partes.length > 0 && (
                    <span className="block text-[12px] text-(--color-tinta-3)">
                      {partes.join(' · ')}
                    </span>
                  )}
                </span>
                <ChevronRight size={15} className="shrink-0 text-(--color-tinta-3)" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
    </Cartao>
  )
}

/** As camadas. Cada interruptor ESCONDE de verdade — nenhum controle decorativo (§9). */
function PainelCamadas({
  camadas,
  aberto,
  aoAlternarAberto,
  aoMudar,
}: {
  camadas: Record<Categoria | 'rota', boolean>
  aberto: boolean
  aoAlternarAberto: () => void
  aoMudar: (chave: Categoria | 'rota', v: boolean) => void
}) {
  return (
    <Cartao className="!p-0 overflow-hidden">
      <button
        type="button"
        onClick={aoAlternarAberto}
        aria-expanded={aberto}
        className="toque flex w-full cursor-pointer items-center justify-between px-4 text-left"
      >
        <span className="flex items-center gap-2">
          <Layers size={14} className="text-(--color-tinta-3)" aria-hidden />
          <Rotulo>Camadas do mapa</Rotulo>
        </span>
        <ChevronRight
          size={15}
          className="text-(--color-tinta-3) transition-transform"
          style={{ transform: aberto ? 'rotate(90deg)' : undefined }}
          aria-hidden
        />
      </button>
      {aberto && (
        <div className="border-t border-(--color-borda) px-4 py-1">
          {CAMADAS.map((chave) => {
            const Icone = chave === 'rota' ? Navigation : ESTILO_CATEGORIA[chave].Icone
            const cor = chave === 'rota' ? 'var(--destaque)' : ESTILO_CATEGORIA[chave].cor
            return (
              <div key={chave} className="flex items-center gap-2.5">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: `color-mix(in srgb, ${cor} 12%, white)` }}
                >
                  <Icone size={13} style={{ color: cor }} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <Interruptor
                    rotulo={NOME_CAMADA[chave]}
                    ligado={camadas[chave]}
                    aoMudar={(v) => aoMudar(chave, v)}
                  />
                </span>
              </div>
            )
          })}
        </div>
      )}
    </Cartao>
  )
}

// ---------------------------------------------------------------- painel inferior

function PainelContexto({
  etapa,
  marcador,
  perna,
  marcadores,
  chaveDoDia,
  aoFechar,
  aoVerDia,
  aoComoChegar,
}: {
  etapa: Etapa | null
  marcador: Marcador | null
  perna: Perna | null
  marcadores: Marcador[]
  chaveDoDia: string | null
  aoFechar: () => void
  aoVerDia: (chave: string) => void
  aoComoChegar: (t: Trecho) => void
}) {
  const { snapshot } = useTrip()

  const corpo = etapa ? (
    <CorpoEtapa etapa={etapa} marcadores={marcadores} aoVerDia={aoVerDia} />
  ) : marcador ? (
    <CorpoMarcador
      marcador={marcador}
      chaveDoDia={chaveDoDia}
      snapshot={snapshot}
      aoVerDia={aoVerDia}
      aoComoChegar={aoComoChegar}
    />
  ) : perna ? (
    <CorpoPerna perna={perna} />
  ) : null

  if (!corpo) return null

  return (
    <Cartao className="!p-0 overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-(--color-borda) px-4 py-2.5">
        <Rotulo>{etapa ? 'Cidade' : marcador ? 'Local' : 'Trecho'}</Rotulo>
        <button
          type="button"
          onClick={aoFechar}
          aria-label="Fechar detalhes"
          className="-mt-1 -mr-1 flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-(--color-tinta-3) hover:bg-(--color-superficie-2)"
        >
          <X size={15} aria-hidden />
        </button>
      </div>
      <div className="p-4">{corpo}</div>
    </Cartao>
  )
}

function CorpoEtapa({
  etapa,
  marcadores,
  aoVerDia,
}: {
  etapa: Etapa
  marcadores: Marcador[]
  aoVerDia: (chave: string) => void
}) {
  const daCidade = marcadores.filter((m) => mesmaCidade(m.cidade, etapa.cidade))
  const agenda = daCidade
    .filter((m) => m.quando && m.categoria !== 'cidade')
    .sort((a, b) => String(a.quando).localeCompare(String(b.quando)))
    .slice(0, 8)

  return (
    <>
      <h3 className="t-titulo text-[15px] font-semibold">
        {etapa.cidade}
        {etapa.pais ? `, ${etapa.pais}` : ''}
      </h3>
      <p className="tab-num mt-0.5 text-[12px] text-(--color-tinta-3)">
        {[formatarData(etapa.chegaEm), formatarData(etapa.saiEm)].filter(Boolean).join(' — ') ||
          'Sem datas'}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {(
          [
            [etapa.atividades, 'atividades'],
            [etapa.hoteis, 'hotéis'],
            [etapa.destinos, 'destinos'],
          ] as const
        )
          .filter(([n]) => n > 0)
          .map(([n, rotulo]) => (
            <span
              key={rotulo}
              className="rounded-xl bg-(--color-superficie-2) px-3 py-1.5 text-center"
            >
              <span className="tab-num block text-[15px] font-semibold">{n}</span>
              <span className="block text-[11px] text-(--color-tinta-3)">{rotulo}</span>
            </span>
          ))}
      </div>

      {agenda.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {agenda.map((m) => (
            <li key={m.id} className="flex items-baseline gap-2 text-[13px]">
              <span className="tab-num w-11 shrink-0 text-(--color-tinta-3)">
                {formatarHora(m.quando) || '—'}
              </span>
              <span className="min-w-0 flex-1 truncate">{m.nome}</span>
            </li>
          ))}
        </ul>
      )}

      {etapa.chegaEm && (
        <div className="mt-3">
          <Botao
            variante="secundario"
            tamanho="pequeno"
            onClick={() => aoVerDia(String(etapa.chegaEm).slice(0, 10))}
          >
            Ver dia a dia
          </Botao>
        </div>
      )}
    </>
  )
}

function CorpoMarcador({
  marcador,
  chaveDoDia,
  snapshot,
  aoVerDia,
  aoComoChegar,
}: {
  marcador: Marcador
  chaveDoDia: string | null
  snapshot: ReturnType<typeof useTrip>['snapshot']
  aoVerDia: (chave: string) => void
  aoComoChegar: (t: Trecho) => void
}) {
  const { Icone, cor } = ESTILO_CATEGORIA[marcador.categoria]

  // O trecho que CHEGA neste marcador — o mesmo que a Agenda e os Deslocamentos
  // usam, recalculado do dia dele. É o que permite reaproveitar `ComoChegar`
  // inteiro em vez de escrever uma segunda conta de "saia às".
  const trecho = useMemo(() => {
    const chave = marcador.chaveDia
    if (!chave || marcador.origem.entidade !== 'roteiro') return null
    const itens = ((snapshot?.roteiro ?? []) as Record<string, unknown>[]).filter((e) =>
      String(e.ocorre_em ?? '').startsWith(chave),
    )
    return trechosDoDia(itens).find((t) => t.id === marcador.origem.id) ?? null
  }, [marcador, snapshot])

  return (
    <>
      <div className="flex items-start gap-2.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
          style={{ background: cor }}
        >
          <Icone size={16} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="t-titulo text-[15px] font-semibold">{marcador.nome}</h3>
          <p className="tab-num text-[12px] text-(--color-tinta-3)">
            {[NOME_CATEGORIA[marcador.categoria], formatarHora(marcador.quando)]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </div>

      {marcador.endereco && (
        <p className="mt-2.5 flex items-start gap-1.5 text-[13px] text-(--color-tinta-2)">
          <MapPin size={13} className="mt-0.5 shrink-0" aria-hidden />
          {marcador.endereco}
        </p>
      )}

      {/* A ressalva vem ANTES dos botões: quem já tocou em "Como chegar" não
          volta para ler que a coordenada era aproximada. */}
      {marcador.aproximado && (
        <p
          className="mt-2.5 flex items-start gap-1.5 rounded-xl px-3 py-2 text-[12px]"
          style={{ background: 'var(--color-atencao-bg)', color: 'var(--color-atencao-ink)' }}
        >
          <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
          Localização aproximada — o pino está no centro de {marcador.cidade ?? 'a cidade'}, não no
          endereço deste local.
        </p>
      )}

      {trecho && (
        <div className="mt-3">
          <SaiaAs trecho={trecho} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {marcador.chaveDia && marcador.chaveDia !== chaveDoDia && (
          <Botao
            variante="secundario"
            tamanho="pequeno"
            onClick={() => aoVerDia(marcador.chaveDia!)}
          >
            Ver no roteiro
          </Botao>
        )}
        {trecho && (
          <Botao tamanho="pequeno" onClick={() => aoComoChegar(trecho)}>
            <Navigation size={13} /> Como chegar
          </Botao>
        )}
      </div>
    </>
  )
}

function CorpoPerna({ perna }: { perna: Perna }) {
  const Icone = perna.modo ? (ICONE_MODO[perna.modo] ?? Navigation) : Navigation

  return (
    <>
      <div className="flex items-start gap-2.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'var(--color-destaque-tenue)', color: 'var(--destaque)' }}
        >
          <Icone size={16} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="t-titulo text-[15px] font-semibold">
            {perna.de.nome} → {perna.para.nome}
          </h3>
          <p className="tab-num text-[12px] text-(--color-tinta-3)">
            {[perna.nomeModo, formatarData(perna.quando)].filter(Boolean).join(' · ') ||
              'Sem data registrada'}
          </p>
        </div>
      </div>

      <dl className="mt-3 flex gap-4">
        {[
          ['Duração', formatarDuracao(perna.duracaoMin)],
          ['Distância', formatarDistancia(perna.distanciaM)],
        ]
          .filter(([, v]) => Boolean(v))
          .map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] text-(--color-tinta-3)">{k}</dt>
              <dd className="tab-num text-[14px] font-semibold">{v}</dd>
            </div>
          ))}
      </dl>

      {!perna.verificado && (
        <p
          className="mt-3 flex items-start gap-1.5 rounded-xl px-3 py-2 text-[12px]"
          style={{ background: 'var(--color-atencao-bg)', color: 'var(--color-atencao-ink)' }}
        >
          <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
          Rota não verificada — as duas cidades se seguem no roteiro, mas nenhum voo, trem ou
          traslado registra este trecho. A linha mostra a ordem, não o caminho.
        </p>
      )}
    </>
  )
}

// ---------------------------------------------------------------- alternativa textual

/** O mapa em lista. Mesma informação, sem depender de enxergar o pino (§34). */
function ListaTextual({
  marcadores,
  corPorCidade,
  aoEscolher,
}: {
  marcadores: Marcador[]
  corPorCidade: Map<string, string>
  aoEscolher: (id: string) => void
}) {
  const [aberto, setAberto] = useState(false)
  if (marcadores.length === 0) return null

  return (
    <Cartao className="!p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="toque flex w-full cursor-pointer items-center justify-between px-4 text-left"
      >
        <Rotulo>Locais no mapa, em lista</Rotulo>
        <ChevronRight
          size={15}
          className="text-(--color-tinta-3) transition-transform"
          style={{ transform: aberto ? 'rotate(90deg)' : undefined }}
          aria-hidden
        />
      </button>
      {aberto && (
        <ul className="divide-y divide-(--color-borda) border-t border-(--color-borda)">
          {marcadores.map((m) => {
            const { Icone, cor: corPadrao } = ESTILO_CATEGORIA[m.categoria]
            const cor =
              (m.categoria === 'cidade' ? corPorCidade.get(m.cidade ?? '') : undefined) ??
              corPadrao
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => aoEscolher(m.id)}
                  className="toque flex w-full cursor-pointer items-center gap-2.5 px-4 py-2 text-left hover:bg-(--color-superficie-2)"
                >
                  <Icone size={14} style={{ color: cor }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{m.nome}</span>
                  {m.aproximado && (
                    <span className="shrink-0 text-[11px] text-(--color-tinta-3)">aproximado</span>
                  )}
                  <span className="tab-num shrink-0 text-[12px] text-(--color-tinta-3)">
                    {formatarHora(m.quando)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Cartao>
  )
}

// ---------------------------------------------------------------- auditoria

function ResumoAuditoria({
  auditoria,
  aoAbrir,
}: {
  auditoria: ReturnType<typeof auditarMapa>
  aoAbrir: () => void
}) {
  const pendencias = auditoria.aproximados + auditoria.semLocal + auditoria.rotasNaoVerificadas
  if (pendencias === 0) return null

  return (
    <button
      type="button"
      onClick={aoAbrir}
      className="toque flex w-full cursor-pointer items-center gap-2.5 rounded-xl border px-3 text-left text-[13px]"
      style={{
        // Erro é vermelho; só impreciso é âmbar. A cor nunca é o único sinal —
        // o texto ao lado diz o que é.
        borderColor:
          auditoria.semLocal > 0 ? 'var(--color-perigo-ink)' : 'var(--color-borda-forte)',
        background: auditoria.semLocal > 0 ? 'var(--color-perigo-bg)' : 'var(--color-atencao-bg)',
        color: auditoria.semLocal > 0 ? 'var(--color-perigo-ink)' : 'var(--color-atencao-ink)',
      }}
    >
      <TriangleAlert size={15} className="shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        {auditoria.semLocal > 0 && `${auditoria.semLocal} fora do mapa`}
        {auditoria.semLocal > 0 && auditoria.aproximados > 0 && ' · '}
        {auditoria.aproximados > 0 && `${auditoria.aproximados} aproximados`}
        {(auditoria.semLocal > 0 || auditoria.aproximados > 0) &&
          auditoria.rotasNaoVerificadas > 0 &&
          ' · '}
        {auditoria.rotasNaoVerificadas > 0 &&
          `${auditoria.rotasNaoVerificadas} ${auditoria.rotasNaoVerificadas === 1 ? 'rota' : 'rotas'} sem conferir`}
      </span>
      <ChevronRight size={15} className="shrink-0" aria-hidden />
    </button>
  )
}

function DetalheAuditoria({ auditoria }: { auditoria: ReturnType<typeof auditarMapa> }) {
  const localizados = (Object.keys(NOME_CATEGORIA) as Categoria[]).filter(
    (c) => auditoria.localizados[c] > 0,
  )

  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {localizados.map((c) => {
          const { Icone, cor } = ESTILO_CATEGORIA[c]
          return (
            <li
              key={c}
              className="flex items-center gap-2 rounded-xl bg-(--color-superficie-2) px-3 py-2"
            >
              <Icone size={14} style={{ color: cor }} aria-hidden />
              <span className="tab-num text-[14px] font-semibold">{auditoria.localizados[c]}</span>
              <span className="min-w-0 truncate text-[12px] text-(--color-tinta-3)">
                {NOME_CATEGORIA[c]}
              </span>
            </li>
          )
        })}
      </ul>

      {auditoria.lacunas.length === 0 ? (
        <p className="text-[13px] text-(--color-tinta-2)">
          Tudo o que a viagem tem está localizado, e toda perna da rota tem um registro que a
          comprova.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {auditoria.lacunas.map((l, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px]">
              <span
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                style={{
                  background:
                    l.nivel === 'erro' ? 'var(--color-perigo-ink)' : 'var(--color-atencao-ink)',
                }}
                aria-hidden
              />
              {/* O nível vai em TEXTO também: um ponto colorido sozinho não
                  sobrevive a daltonismo nem a leitor de tela (§34). */}
              <span className="min-w-0">
                <span className="sr-only">{l.nivel === 'erro' ? 'Erro: ' : 'Aviso: '}</span>
                {l.texto}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
