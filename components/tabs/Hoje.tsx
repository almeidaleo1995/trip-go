'use client'

// A tela HOJE: o roteiro reduzido ao que serve a quem está de pé na rua.
//
// Ela responde cinco perguntas, nesta ordem, e nada mais: o que estou fazendo
// agora, o que vem depois, que horas preciso sair, onde durmo hoje, o que falta
// marcar. Tudo o mais — planejar, editar, conferir preço — mora nas outras abas.
//
// NADA aqui edita o roteiro. A única escrita da tela é marcar um item do
// checklist, que é o mesmo `checklist_state` da aba Checklist: marcar aqui marca
// lá, e sincroniza entre os cinco aparelhos. Um segundo sistema de marcação seria
// duas verdades sobre a mesma mochila.
//
// As contas todas moram em lib/hoje.ts, puro e testado. Este arquivo desenha.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bed,
  Bus,
  CalendarDays,
  Car,
  Check,
  ChevronDown,
  Clock,
  Compass,
  FileText,
  Footprints,
  Globe2,
  Landmark,
  ListChecks,
  MapPin,
  Navigation,
  Phone,
  Plane,
  Ship,
  ShoppingBag,
  Sparkles,
  Ticket,
  Train,
  TramFront,
  Utensils,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useTrip } from '../TripProvider.tsx'
import { ModalComoChegar } from '../ComoChegar.tsx'
import { trechosDoDia, type Trecho } from '@/lib/trechos.ts'
import { AppModal, Botao, Cartao, useAviso } from '../ui.tsx'
import { PreviewDocumento } from '../CofreDocumento.tsx'
import { documentosDe, type Documento } from '@/lib/cofre.ts'
import { formatarData, formatarDinheiro, formatarDistancia, parseData } from '@/lib/derive.ts'
import { buscarClimaAgora, descricaoClima, type ClimaAgora } from '@/lib/clima.ts'
import {
  enderecoDe,
  formatarHoraLocal,
  formatarRestante,
  montarHoje,
  NOME_MODO,
  type Endereco,
  type Hoje as DadosHoje,
  type ItemRoteiro,
  type Modo,
  type Reserva,
} from '@/lib/hoje.ts'
import type { AbaId } from '../Shell.tsx'

// ---------------------------------------------------------------- relógio

/**
 * O relógio da tela, num estado só.
 *
 * Um `new Date()` por componente faria "agora" e "restam 1h06" discordarem no
 * mesmo render. Repinta a cada 30 s: a contagem é em minutos, e meio minuto de
 * atraso na virada é invisível — um timer de 1 s só gastaria bateria de quem
 * está com 12% e longe de uma tomada.
 */
function useRelogio(): Date {
  const [agora, setAgora] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 30_000)
    // A aba fica aberta no bolso o dia inteiro; voltar para ela precisa acertar o
    // relógio na hora, sem esperar o próximo tique.
    const acordar = () => document.visibilityState === 'visible' && setAgora(new Date())
    document.addEventListener('visibilitychange', acordar)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', acordar)
    }
  }, [])
  return agora
}

// ---------------------------------------------------------------- ícones

const ICONE_MODO: Record<Modo, LucideIcon> = {
  a_pe: Footprints,
  metro: TramFront,
  onibus: Bus,
  trem: Train,
  taxi: Car,
  carro: Car,
  barco: Ship,
  aviao: Plane,
}

const ICONE_TIPO: Record<string, LucideIcon> = {
  voo: Plane,
  trem: Train,
  onibus: Bus,
  traslado: Car,
  caminhada: Footprints,
  cruzeiro: Ship,
  hospedagem: Bed,
  restaurante: Utensils,
  refeicao: Utensils,
  documento: FileText,
  passeio: Landmark,
  local: Landmark,
  ponto: Landmark,
  evento: Ticket,
  compras: ShoppingBag,
  tarefa: ListChecks,
  compromisso: Clock,
  dica: Sparkles,
  observacao: Sparkles,
}

// ================================================================ a tela

export function Hoje({ irPara }: { irPara: (a: AbaId) => void }) {
  const { snapshot, carregando, mutate } = useTrip()
  const relogio = useRelogio()

  const dados = useMemo(() => montarHoje(snapshot, relogio), [snapshot, relogio])

  // Painéis que a tela abre por cima de si mesma. Ambos vivem aqui para que só
  // um esteja aberto por vez.
  const [endereco, setEndereco] = useState<Endereco | null>(null)
  const [documento, setDocumento] = useState<Documento | null>(null)
  const [trecho, setTrecho] = useState<Trecho | null>(null)

  // Os MESMOS trechos do Roteiro, pela mesma função pura. O Hoje não recalcula
  // nada de navegação: recalcular daria dois horários de saída para o mesmo
  // compromisso, um em cada aba.
  const trechos = useMemo(
    () =>
      trechosDoDia((dados?.itensDoDia ?? []) as unknown as Record<string, unknown>[], {
        hospedagem: dados?.hospedagem as Record<string, unknown> | null,
      }),
    [dados?.itensDoDia, dados?.hospedagem],
  )
  const trechoProximo =
    trechos.find((t) => t.id === String(dados?.proximo?.item?.id ?? '')) ?? null
  /** A volta para o hotel (§29): o deslocamento que importa quando o dia acabou
      e a cidade é estranha. */
  const trechoVolta = trechos.find((t) => t.id.startsWith('volta:')) ?? null

  const documentos = useMemo(
    () => (snapshot?.documentos ?? []) as unknown as Documento[],
    [snapshot?.documentos],
  )

  const abrirDocumentos = useCallback(
    (vinculo: { evento?: string; reserva?: string }) => {
      const lista = documentosDe(documentos, vinculo)
      if (lista.length > 0) setDocumento(lista[0])
    },
    [documentos],
  )

  if (carregando && !snapshot) return <EsqueletoHoje />
  if (!dados) return null

  const marcar = (itemId: string, feito: boolean) =>
    mutate({
      op: 'editar',
      entidade: 'checklist_state',
      campos: { item_id: itemId, feito },
      client_ts: new Date().toISOString(),
    })

  return (
    <div className="mx-auto w-full max-w-2xl lg:max-w-5xl">
      <Cabecalho dados={dados} />

      {/* Desktop ganha uma coluna lateral em vez de esticar os cartões (§27): o
          que é sequência do dia fica à esquerda, o que é referência fixa à
          direita. No celular volta tudo para uma coluna, nesta mesma ordem. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4">
          <FaseOuAgora
            dados={dados}
            aoAbrirEndereco={setEndereco}
            aoAbrirDocumentos={abrirDocumentos}
            temDocumento={(v) => documentosDe(documentos, v).length > 0}
          />

          {dados.proximo && (
            <CartaoProximo
              dados={dados}
              trecho={trechoProximo}
              aoComoChegar={setTrecho}
              aoAbrirEndereco={setEndereco}
              aoAbrirDocumentos={abrirDocumentos}
              temDocumento={(v) => documentosDe(documentos, v).length > 0}
            />
          )}

          {dados.depois.length > 0 && <LinhaDepois itens={dados.depois} irPara={irPara} />}
        </div>

        <div className="space-y-4">
          {/* Fora da viagem o cartão some inteiro — inclusive o estado vazio:
              "nenhuma hospedagem para hoje" em novembro não é uma pendência,
              é uma frase sem sentido. */}
          {dados.dia.fase === 'durante' && (
            <CartaoHospedagem
              hospedagem={dados.hospedagem}
              trechoVolta={trechoVolta}
              aoComoChegar={setTrecho}
              aoAbrirEndereco={setEndereco}
              aoAbrirDocumentos={abrirDocumentos}
              temDocumento={(v) => documentosDe(documentos, v).length > 0}
              irPara={irPara}
            />
          )}

          {dados.pagamentoHoje && (
            <PagamentoHoje
              pagamento={dados.pagamentoHoje}
              moeda={String(snapshot?.viagem?.moeda ?? 'BRL')}
              irPara={irPara}
            />
          )}

          <LinhaRituais rituais={dados.rituais} aoMarcar={marcar} irPara={irPara} />
        </div>
      </div>

      {trecho && <ModalComoChegar trecho={trecho} aoFechar={() => setTrecho(null)} />}
      {endereco && <PainelEndereco endereco={endereco} aoFechar={() => setEndereco(null)} />}
      {documento && (
        <AppModal titulo={documento.titulo} tamanho="grande" aoFechar={() => setDocumento(null)}>
          <PreviewDocumento doc={documento} />
        </AppModal>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- cabeçalho

function Cabecalho({ dados }: { dados: DadosHoje }) {
  return (
    <header className="border-b border-(--color-borda) pb-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="t-legenda flex items-center gap-1.5 text-(--color-tinta-2)">
          <CalendarDays size={14} aria-hidden />
          {/* "30 dez · terça". O formato longo do pt-BR insere um "de" que só
              alonga a linha mais estreita da tela. */}
          {formatarData(chaveISO(dados.dia.data), { day: '2-digit' })}{' '}
          {formatarData(chaveISO(dados.dia.data), { month: 'short' }).replace('.', '')} ·{' '}
          {formatarData(chaveISO(dados.dia.data), { weekday: 'long' })}
        </p>

        {dados.dia.fase === 'durante' && dados.dia.total > 0 && (
          <p className="t-aux tab-num font-semibold text-(--color-tinta)">
            Dia {dados.dia.numero} de {dados.dia.total}
          </p>
        )}

        <div className="flex items-center gap-2">
          {dados.cidade && (
            <p className="t-legenda flex items-center gap-1.5 text-(--destaque)">
              <MapPin size={14} aria-hidden />
              {dados.cidade}
            </p>
          )}
          <Clima coordenada={dados.coordenada} />
        </div>
      </div>

      {/* O aviso existe porque o contrário seria mentir: sem ele, alguém em casa
          no Brasil veria "agora" apontando para o compromisso errado (§31). */}
      {dados.outroFuso && (
        <p className="t-aux mt-1.5 flex items-center gap-1.5 text-(--color-tinta-3)">
          <Clock size={13} aria-hidden />
          Horários do destino — seu aparelho está em outro fuso.
        </p>
      )}
    </header>
  )
}

/** Clima de agora, discreto (§20). Sem rede ou sem coordenada, simplesmente não existe. */
function Clima({ coordenada }: { coordenada: { lat: number; lon: number } | null }) {
  // O estado guarda a COORDENADA que respondeu, não só a temperatura: mudando de
  // cidade, o número velho deixa de bater com a chave e some sozinho, sem um
  // setState de limpeza dentro do efeito (que dispararia um render em cascata).
  const [resposta, setResposta] = useState<{ chave: string; clima: ClimaAgora } | null>(null)
  const chave = coordenada ? `${coordenada.lat},${coordenada.lon}` : ''

  useEffect(() => {
    if (!coordenada) return
    let vivo = true
    buscarClimaAgora(coordenada.lat, coordenada.lon).then((c) => {
      if (vivo && c) setResposta({ chave: `${coordenada.lat},${coordenada.lon}`, clima: c })
    })
    return () => {
      vivo = false
    }
  }, [coordenada])

  // Nunca inventa previsão: sem resposta, o bloco não aparece (§33).
  const clima = resposta && resposta.chave === chave ? resposta.clima : null
  if (!clima) return null
  return (
    <span
      className="t-aux tab-num font-semibold text-(--color-tinta-2)"
      title={descricaoClima(clima.codigo)}
    >
      {Math.round(clima.temp)}°C
    </span>
  )
}

// ---------------------------------------------------------------- agora / fases

type AcoesCartao = {
  aoAbrirEndereco: (e: Endereco) => void
  aoAbrirDocumentos: (v: { evento?: string; reserva?: string }) => void
  temDocumento: (v: { evento?: string; reserva?: string }) => boolean
}

/**
 * O topo da coluna principal muda com a fase da viagem (§22–§25). São quatro
 * telas diferentes e nenhuma delas finge que a outra está acontecendo.
 */
function FaseOuAgora({ dados, ...acoes }: { dados: DadosHoje } & AcoesCartao) {
  if (dados.dia.fase === 'antes') {
    return (
      <Cartao className="text-center">
        <p className="t-legenda">A viagem ainda não começou</p>
        <p className="t-hora mt-2 text-(--destaque)">
          {dados.dia.faltam} {dados.dia.faltam === 1 ? 'dia' : 'dias'}
        </p>
        <p className="t-aux mt-1">
          Esta tela acorda no primeiro dia. Até lá, a preparação fica no Início.
        </p>
      </Cartao>
    )
  }

  if (dados.dia.fase === 'depois') {
    return (
      <Cartao className="text-center">
        <Sparkles size={22} className="mx-auto text-(--destaque)" aria-hidden />
        <p className="t-secao mt-2">Viagem concluída</p>
        <p className="t-aux mt-1">
          {dados.dia.total} {dados.dia.total === 1 ? 'dia' : 'dias'} de roteiro. O histórico
          continua inteiro nas outras abas.
        </p>
      </Cartao>
    )
  }

  if (dados.atual) return <CartaoAgora dados={dados} {...acoes} />

  // Dia em curso, nada acontecendo: a tela diz isso e passa a bola para o
  // próximo, em vez de deixar um vazio que parece defeito (§22, §23).
  const acabou = !dados.proximo
  return (
    <Cartao>
      <div className="flex items-center gap-3">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-full"
          style={{ background: 'var(--color-superficie-2)' }}
        >
          {acabou ? (
            <Sparkles size={19} className="text-(--destaque)" aria-hidden />
          ) : (
            <Clock size={19} className="text-(--color-tinta-3)" aria-hidden />
          )}
        </span>
        <div className="min-w-0">
          <p className="t-cartao">
            {acabou ? 'Você terminou o roteiro de hoje.' : 'Nenhum compromisso agora'}
          </p>
          <p className="t-aux mt-0.5">
            {acabou
              ? 'O hotel e os rituais continuam aqui embaixo.'
              : 'O próximo já está logo abaixo.'}
          </p>
        </div>
      </div>
    </Cartao>
  )
}

function CartaoAgora({ dados, aoAbrirEndereco, aoAbrirDocumentos, temDocumento }: { dados: DadosHoje } & AcoesCartao) {
  const m = dados.atual!
  const item = m.item
  const Icone = ICONE_TIPO[String(item.tipo ?? '')] ?? Compass
  const endereco = enderecoDe(item)
  const vinculo = { evento: String(item.id ?? '') }

  return (
    <Cartao>
      <div className="flex items-start justify-between gap-3">
        <Etiqueta tom="agora">Agora</Etiqueta>
        <p className="t-aux tab-num flex items-center gap-1.5 font-semibold text-(--destaque)">
          {formatarHoraLocal(dados.agora)}
          <span className="size-1.5 rounded-full bg-(--destaque)" aria-hidden />
        </p>
      </div>

      <div className="mt-3 flex items-start gap-3">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-full"
          style={{ background: 'var(--color-destaque-tenue)' }}
        >
          <Icone size={19} className="text-(--destaque)" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="t-agora">{item.titulo}</h2>
          {item.descricao && <p className="t-aux mt-0.5 line-clamp-2">{item.descricao}</p>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="t-corpo tab-num flex items-center gap-1.5 font-semibold">
          <Clock size={15} className="text-(--color-tinta-3)" aria-hidden />
          {formatarHoraLocal(m.comeca)}
          {!m.presumido && <> – {formatarHoraLocal(m.termina)}</>}
        </span>

        {/* Sem `fim_em` a tela não promete um término que ninguém cadastrou: some
            a contagem e fica só a hora de início. */}
        {!m.presumido && (
          <span
            className="t-corpo tab-num inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-semibold"
            style={{ background: 'var(--color-destaque-tenue)', color: 'var(--destaque)' }}
          >
            <Clock size={14} aria-hidden />
            {formatarRestante(m.restanteMin)} restantes
          </span>
        )}
      </div>

      <Acoes>
        {temDocumento(vinculo) && (
          <BotaoAcao icone={Ticket} onClick={() => aoAbrirDocumentos(vinculo)}>
            Ingresso
          </BotaoAcao>
        )}
        {endereco && (
          <BotaoAcao icone={MapPin} onClick={() => aoAbrirEndereco(endereco)}>
            Endereço
          </BotaoAcao>
        )}
      </Acoes>
    </Cartao>
  )
}

// ---------------------------------------------------------------- a seguir

function CartaoProximo({
  dados,
  trecho,
  aoComoChegar,
  aoAbrirEndereco,
  aoAbrirDocumentos,
  temDocumento,
}: {
  dados: DadosHoje
  trecho: Trecho | null
  aoComoChegar: (t: Trecho) => void
} & AcoesCartao) {
  const { item, deslocamento: d } = dados.proximo!
  const Icone = ICONE_TIPO[String(item.tipo ?? '')] ?? Compass
  const endereco = enderecoDe(item)
  const vinculo = { evento: String(item.id ?? '') }
  const IconeModo = d.modo ? ICONE_MODO[d.modo] : Compass

  return (
    <Cartao>
      <div className="flex items-start justify-between gap-3">
        <Etiqueta tom="seguir">A seguir</Etiqueta>
        <p className="t-aux tab-num font-semibold text-(--color-tinta)">
          {formatarHoraLocal(parseData(item.ocorre_em))}
        </p>
      </div>

      <div className="mt-3 flex items-start gap-3">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-full"
          style={{ background: 'var(--color-atencao-bg)' }}
        >
          <Icone size={19} style={{ color: 'var(--color-atencao-ink)' }} aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="t-agora">{item.titulo}</h2>
          {item.descricao && <p className="t-aux mt-0.5 line-clamp-2">{item.descricao}</p>}
        </div>
      </div>

      {(d.distanciaM || d.duracaoMin) && (
        <div
          className="mt-3 grid grid-cols-2 divide-x rounded-xl px-1 py-2.5"
          style={{ background: 'var(--color-superficie-2)', borderColor: 'var(--color-borda)' }}
        >
          <Medida
            icone={IconeModo}
            valor={formatarDistancia(d.distanciaM) || '—'}
            rotulo={d.modo ? NOME_MODO[d.modo] : 'Distância'}
          />
          <Medida
            icone={Clock}
            valor={d.duracaoMin ? `${d.duracaoMin} min` : '—'}
            rotulo="Tempo até lá"
          />
        </div>
      )}

      {/* O elemento mais alto da tela, e o único em dourado: a única conta que
          ninguém faz de cabeça no meio da rua (§9). Sem `duracao_min` cadastrada
          ele não aparece — um horário de saída chutado é pior que nenhum. */}
      {d.sairAs && (
        <div
          className="mt-3 rounded-xl px-4 py-3 text-center"
          style={{ background: 'var(--color-atencao-bg)' }}
        >
          <p className="t-legenda" style={{ color: 'var(--color-atencao-ink)' }}>
            {d.atrasado ? 'Era para sair às' : 'Saia às'}
          </p>
          <p className="t-hora mt-0.5" style={{ color: 'var(--color-atencao-ink)' }}>
            {formatarHoraLocal(d.sairAs)}
          </p>
          <p className="t-aux mt-0.5" style={{ color: 'var(--color-atencao-ink)' }}>
            {d.atrasado
              ? 'Já passou da hora'
              : `Para chegar no horário · ${d.margemMin} min de folga`}
          </p>
        </div>
      )}

      <Acoes>
        {/* §14: o MESMO painel do Roteiro. Uma segunda implementação aqui
            começaria igual e envelheceria diferente. */}
        {trecho && (
          <BotaoAcao icone={Navigation} onClick={() => aoComoChegar(trecho)}>
            Como chegar
          </BotaoAcao>
        )}
        {temDocumento(vinculo) && (
          <BotaoAcao icone={Ticket} onClick={() => aoAbrirDocumentos(vinculo)}>
            Ingresso
          </BotaoAcao>
        )}
        {endereco && (
          <BotaoAcao icone={MapPin} onClick={() => aoAbrirEndereco(endereco)}>
            Endereço
          </BotaoAcao>
        )}
      </Acoes>
    </Cartao>
  )
}

function Medida({ icone: Icone, valor, rotulo }: { icone: LucideIcon; valor: string; rotulo: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-2" style={{ borderColor: 'var(--color-borda)' }}>
      <Icone size={17} className="shrink-0 text-(--color-tinta-3)" aria-hidden />
      <div className="min-w-0">
        <p className="t-corpo tab-num font-semibold">{valor}</p>
        <p className="t-aux text-[12px]">{rotulo}</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- depois disso

function LinhaDepois({ itens, irPara }: { itens: ItemRoteiro[]; irPara: (a: AbaId) => void }) {
  const [aberto, setAberto] = useState(false)

  return (
    <Cartao className="!p-0 overflow-hidden">
      <button
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="toque flex w-full cursor-pointer items-center gap-3 px-4 text-left"
      >
        <ListChecks size={18} className="shrink-0 text-(--color-tinta-3)" aria-hidden />
        <span className="t-cartao flex-1">Depois disso ({itens.length})</span>
        <ChevronDown
          size={18}
          aria-hidden
          className={`shrink-0 text-(--color-tinta-3) transition-transform ${aberto ? 'rotate-180' : ''}`}
        />
      </button>

      {aberto && (
        <ul className="border-t border-(--color-borda) px-4 py-1">
          {itens.map((e) => (
            <li key={String(e.id)} className="flex items-baseline gap-3 py-2.5">
              <span className="t-corpo tab-num w-12 shrink-0 font-semibold text-(--destaque)">
                {formatarHoraLocal(parseData(e.ocorre_em))}
              </span>
              <span className="t-corpo min-w-0 flex-1">{e.titulo}</span>
            </li>
          ))}
          <li className="border-t border-(--color-borda) py-2">
            <button
              onClick={() => irPara('roteiro')}
              className="t-aux cursor-pointer font-semibold text-(--destaque)"
            >
              Ver o dia inteiro no Roteiro
            </button>
          </li>
        </ul>
      )}
    </Cartao>
  )
}

// ---------------------------------------------------------------- hospedagem

function CartaoHospedagem({
  hospedagem,
  trechoVolta,
  aoComoChegar,
  irPara,
  aoAbrirEndereco,
  aoAbrirDocumentos,
  temDocumento,
}: {
  hospedagem: Reserva | null
  /** O caminho de volta ao hotel (§29). Entra como ação DESTE cartão em vez de
      um cartão próprio: o Hoje é uma tela só, e "como volto" é sobre o hotel. */
  trechoVolta: Trecho | null
  aoComoChegar: (t: Trecho) => void
  irPara: (a: AbaId) => void
} & AcoesCartao) {
  const avisar = useAviso()

  // Este cartão NUNCA some com o fim do roteiro: às 23h ele é a única coisa que
  // ainda importa na tela, e é o motivo de ele viver fora da linha do tempo.
  if (!hospedagem) {
    return (
      <Cartao>
        <p className="t-legenda flex items-center gap-1.5">
          <Bed size={14} aria-hidden /> Onde eu durmo hoje
        </p>
        <p className="t-corpo mt-2">Nenhuma hospedagem cadastrada para hoje.</p>
        <button
          onClick={() => irPara('hospedagem')}
          className="t-aux mt-1.5 cursor-pointer font-semibold text-(--destaque)"
        >
          Cadastrar na aba Hospedagem
        </button>
      </Cartao>
    )
  }

  const endereco = enderecoDe(hospedagem)
  const vinculo = { reserva: String(hospedagem.id ?? '') }
  const saida = parseData(hospedagem.fim_em ?? null)

  return (
    <Cartao tom="destaque">
      <p className="t-legenda flex items-center gap-2" style={{ color: 'var(--destaque)' }}>
        <span
          className="grid size-7 place-items-center rounded-full"
          style={{ background: 'var(--destaque)' }}
        >
          <Bed size={15} className="text-white" aria-hidden />
        </span>
        Onde eu durmo hoje
      </p>

      <h2 className="t-agora mt-2.5">{hospedagem.nome}</h2>

      {saida && (
        <p className="t-corpo tab-num mt-1 flex items-center gap-1.5 text-(--color-tinta-2)">
          <Clock size={15} aria-hidden /> Check-out: {formatarHoraLocal(saida)}
        </p>
      )}

      <Acoes>
        {trechoVolta && (
          <BotaoAcao icone={Navigation} onClick={() => aoComoChegar(trechoVolta)}>
            Como voltar
          </BotaoAcao>
        )}
        {endereco && (
          <BotaoAcao icone={MapPin} onClick={() => aoAbrirEndereco(endereco)}>
            Endereço
          </BotaoAcao>
        )}
        {hospedagem.telefone && (
          <BotaoAcao
            icone={Phone}
            onClick={() => ligar(hospedagem.telefone!, avisar)}
            rotuloAria={`Ligar para ${hospedagem.nome}`}
          >
            Telefone
          </BotaoAcao>
        )}
        {temDocumento(vinculo) && (
          <BotaoAcao icone={FileText} onClick={() => aoAbrirDocumentos(vinculo)}>
            Voucher
          </BotaoAcao>
        )}
      </Acoes>
    </Cartao>
  )
}

/**
 * No celular abre o discador; no desktop `tel:` não leva a lugar nenhum, então o
 * número vai para a área de transferência e a tela diz isso (§15).
 */
async function ligar(telefone: string, avisar: ReturnType<typeof useAviso>) {
  const toque = matchMedia?.('(hover: none) and (pointer: coarse)').matches
  if (toque) {
    location.href = `tel:${telefone.replace(/[^\d+]/g, '')}`
    return
  }
  try {
    await navigator.clipboard.writeText(telefone)
    avisar('sucesso', `${telefone} copiado.`)
  } catch {
    avisar('info', telefone)
  }
}

// ---------------------------------------------------------------- pagamento

function PagamentoHoje({
  pagamento,
  moeda,
  irPara,
}: {
  pagamento: { valorCentavos: number; descricao: string }
  moeda: string
  irPara: (a: AbaId) => void
}) {
  // Discreto de propósito (§36): o Financeiro inteiro tem aba própria, e o que
  // esta tela precisa dizer é só "vence hoje". O valor é o que o servidor já
  // decidiu que esta pessoa pode ver — a tela não soma nada além disso.
  return (
    <button
      onClick={() => irPara('financeiro')}
      className="toque flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-(--color-borda) bg-(--color-cartao) px-4 text-left"
      style={{ boxShadow: 'var(--sombra-1)' }}
    >
      <Wallet size={18} className="shrink-0 text-(--color-tinta-3)" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="t-aux block">Vence hoje · {pagamento.descricao}</span>
        <span className="t-cartao tab-num block">
          {formatarDinheiro(pagamento.valorCentavos, moeda)}
        </span>
      </span>
    </button>
  )
}

// ---------------------------------------------------------------- rituais

function LinhaRituais({
  rituais,
  aoMarcar,
  irPara,
}: {
  rituais: DadosHoje['rituais']
  aoMarcar: (id: string, feito: boolean) => void
  irPara: (a: AbaId) => void
}) {
  const [aberto, setAberto] = useState(false)

  if (rituais.total === 0) return null

  return (
    <Cartao className="!p-0 overflow-hidden">
      <button
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="toque flex w-full cursor-pointer items-center gap-3 px-4 text-left"
      >
        <ListChecks size={18} className="shrink-0 text-(--color-tinta-3)" aria-hidden />
        <span className="t-cartao flex-1">Rituais do dia</span>
        <span
          className="t-aux tab-num shrink-0 rounded-full px-2.5 py-1 font-semibold"
          style={{
            background:
              rituais.feitos === rituais.total
                ? 'var(--color-sucesso-bg)'
                : 'var(--color-superficie-2)',
            color:
              rituais.feitos === rituais.total
                ? 'var(--color-sucesso-ink)'
                : 'var(--color-tinta-2)',
          }}
        >
          {rituais.feitos} de {rituais.total}
        </span>
        <ChevronDown
          size={18}
          aria-hidden
          className={`shrink-0 text-(--color-tinta-3) transition-transform ${aberto ? 'rotate-180' : ''}`}
        />
      </button>

      {aberto && (
        <ul className="border-t border-(--color-borda) px-2 py-1">
          {rituais.itens.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => aoMarcar(r.id, !r.feito)}
                aria-pressed={r.feito}
                className="toque flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 text-left transition-colors hover:bg-(--color-superficie-2)"
              >
                <span
                  aria-hidden
                  className="grid size-6 shrink-0 place-items-center rounded-md border transition-colors"
                  style={{
                    background: r.feito ? 'var(--destaque)' : 'transparent',
                    borderColor: r.feito ? 'var(--destaque)' : 'var(--color-borda-forte)',
                  }}
                >
                  {r.feito && <Check size={15} className="text-white" />}
                </span>
                <span
                  className={`t-corpo min-w-0 flex-1 ${r.feito ? 'text-(--color-tinta-3) line-through' : ''}`}
                >
                  {r.titulo}
                </span>
                {/* A palavra, não só a cor — a tela é lida no sol (§40). */}
                {r.atrasado && (
                  <span
                    className="t-aux shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                    style={{
                      background: 'var(--color-perigo-bg)',
                      color: 'var(--color-perigo-ink)',
                    }}
                  >
                    atrasado
                  </span>
                )}
              </button>
            </li>
          ))}
          <li className="border-t border-(--color-borda) px-2 py-2">
            <button
              onClick={() => irPara('checklist')}
              className="t-aux cursor-pointer font-semibold text-(--destaque)"
            >
              Ver o checklist inteiro
            </button>
          </li>
        </ul>
      )}
    </Cartao>
  )
}

// ---------------------------------------------------------------- painel de endereço

/**
 * A tela que se vira para o motorista.
 *
 * Deliberadamente NÃO abre o mapa: sem sinal o mapa não abre, e quem está no
 * táxi precisa que o endereço apareça grande, agora. O mapa fica como ação
 * secundária, para quando houver rede e coordenada.
 */
function PainelEndereco({ endereco, aoFechar }: { endereco: Endereco; aoFechar: () => void }) {
  const avisar = useAviso()
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar()
    document.addEventListener('keydown', esc)
    const anterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', esc)
      document.body.style.overflow = anterior
    }
  }, [aoFechar])

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(endereco.completo)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2200)
    } catch {
      // Sem clipboard o endereço continua na tela, que é o que importa aqui.
      avisar('info', 'Copie o endereço direto da tela.')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Endereço de ${endereco.titulo}`}
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto"
      style={{ background: 'var(--color-cartao)' }}
    >
      <div className="flex justify-end p-3">
        <button
          onClick={aoFechar}
          aria-label="Fechar endereço"
          className="toque grid cursor-pointer place-items-center rounded-full text-(--color-tinta-2) transition-colors hover:bg-(--color-superficie-2)"
        >
          <X size={22} aria-hidden />
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 pb-8">
        <p className="t-legenda">{endereco.titulo}</p>

        <address className="mt-4 not-italic">
          {endereco.linhas.map((l, i) => (
            <span key={i} className="t-endereco block">
              {l}
            </span>
          ))}
          {endereco.cidade && (
            <span className="t-secao mt-3 block text-(--color-tinta-2)">{endereco.cidade}</span>
          )}
        </address>

        <div className="mt-8 space-y-2.5">
          <Botao onClick={copiar} className="w-full !min-h-14 text-base">
            {copiado ? (
              <>
                <Check size={18} aria-hidden /> Endereço copiado
              </>
            ) : (
              'Copiar endereço'
            )}
          </Botao>

          <div className="flex gap-2.5">
            {endereco.telefone && (
              <Botao
                variante="secundario"
                onClick={() => ligar(endereco.telefone!, avisar)}
                className="flex-1 !min-h-12"
              >
                <Phone size={16} aria-hidden /> Ligar
              </Botao>
            )}
            {endereco.lat !== null && endereco.lon !== null && (
              <a
                href={`https://www.openstreetmap.org/?mlat=${endereco.lat}&mlon=${endereco.lon}#map=17/${endereco.lat}/${endereco.lon}`}
                target="_blank"
                rel="noreferrer"
                className="toque inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-(--color-borda-forte) px-4 text-sm font-medium text-(--color-tinta) transition-colors hover:bg-(--color-superficie-2)"
              >
                <Globe2 size={16} aria-hidden /> Abrir no mapa
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- peças

function Etiqueta({ tom, children }: { tom: 'agora' | 'seguir'; children: React.ReactNode }) {
  const agora = tom === 'agora'
  return (
    <span
      className="t-legenda inline-flex items-center rounded-full px-3 py-1.5 !text-[11px]"
      style={{
        background: agora ? 'var(--destaque)' : 'var(--color-atencao-ink)',
        color: '#fff',
      }}
    >
      {children}
    </span>
  )
}

/** Rodapé de botões do cartão. Some inteiro quando não sobra nenhum (§5, §33). */
function Acoes({ children }: { children: React.ReactNode }) {
  // Quantos botões SOBRARAM decide a grade: um ocupa a linha, dois dividem, três
  // ficam lado a lado. Sem isto, o terceiro botão cai sozinho numa segunda linha
  // e o cartão ganha um buraco.
  const botoes = (Array.isArray(children) ? children : [children]).filter(Boolean)
  if (botoes.length === 0) return null
  const colunas = botoes.length >= 3 ? 'grid-cols-3' : botoes.length === 2 ? 'grid-cols-2' : 'grid-cols-1'
  return (
    <div className={`mt-3 grid ${colunas} gap-2 border-t border-(--color-borda) pt-3`}>{botoes}</div>
  )
}

function BotaoAcao({
  icone: Icone,
  onClick,
  children,
  rotuloAria,
}: {
  icone: LucideIcon
  onClick: () => void
  children: React.ReactNode
  rotuloAria?: string
}) {
  return (
    <button
      onClick={onClick}
      aria-label={rotuloAria}
      className="toque inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors"
      style={{ background: 'var(--color-destaque-tenue)', color: 'var(--destaque)' }}
    >
      <Icone size={17} aria-hidden />
      {children}
    </button>
  )
}

function EsqueletoHoje() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4" aria-busy="true" aria-label="Carregando o dia">
      <div className="h-6 animate-pulse rounded-lg bg-(--color-superficie-2)" />
      <div className="h-48 animate-pulse rounded-2xl bg-(--color-superficie-2)" />
      <div className="h-56 animate-pulse rounded-2xl bg-(--color-superficie-2)" />
      <div className="h-32 animate-pulse rounded-2xl bg-(--color-superficie-2)" />
    </div>
  )
}

/** Date -> "YYYY-MM-DD", que é o que `formatarData` espera receber. */
function chaveISO(d: Date): string {
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}
