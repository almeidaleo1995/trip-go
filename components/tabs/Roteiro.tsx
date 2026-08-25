'use client'

// O Roteiro — a aba que deixou de ser agenda e virou o manual operacional da
// viagem, um dia de cada vez.
//
// A tela responde nesta ordem: cabeçalho do dia (data, cidade, dia N de M) →
// chips rápidos (clima, dia N de M, hospedagem) → faixa de dias →
// Detalhes / Reservas / Dicas / Checklists do dia) → conteúdo da aba + coluna
// fixa de apoio (mapa, clima, informações) → faixa de dias no rodapé.
//
// Quatro decisões que explicam quase tudo aqui:
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
//
// 3. NÃO HÁ BOTÃO DE IA NESTA TELA. Organizar e atualizar o roteiro é trabalho
//    da Skill do TripGo, feito por fora — aqui só se apresenta, edita e
//    gerencia o resultado. Essa fronteira é deliberada: misturar as duas coisas
//    na interface transformaria um guia de viagem pronto para uso numa tela de
//    configuração de IA.
//
// 4. NADA AQUI É INVENTADO. Idioma, voltagem e fuso horário do destino não têm
//    coluna no banco — mostrar isso exigiria "chutar" um fato sobre o país a
//    partir do nome da cidade, o que é exatamente o tipo de erro silencioso que
//    o resto do app se recusa a cometer com dinheiro e horário. "Informações do
//    dia" mostra só moeda (campo real da viagem) e a primeira linha de "Atenção
//    hoje" como dica — os dois já existem no banco.
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
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
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
  Sun,
  CloudSun,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudLightning,
  CloudFog,
  Umbrella,
  Maximize2,
  Upload,
  Search,
  type LucideIcon,
} from 'lucide-react'
import { useTrip } from '../TripProvider.tsx'
import { type Papel } from '@/config/navigation.ts'
import { AdminAcoes } from '../EditorSheet.tsx'
import {
  Badge,
  Botao,
  Cartao,
  Rotulo,
  Titulo,
  Vazio,
  Copiar,
  AppModal,
  BotaoIcone,
  useAviso,
  Selecao,
  CLASSE_CAMPO,
  TONS,
  ALIAS_TOM,
} from '../ui.tsx'
import { MapaRota } from '../MapaRota.tsx'
import { buscarClima, buscarClimaAgora, descricaoClima, type PrevisaoDia } from '@/lib/clima.ts'
import { DiaSchema, EventoSchema, formatarErroZod } from '@/lib/schema.ts'
import { lerArquivoDeMapa, casarPontos, type PontoKml } from '@/lib/kml.ts'
import { buscarLugar, consultaDaParada, temCampoDeLugar, type Achado } from '@/lib/localizar.ts'
import {
  montarDias,
  resumoDoDia,
  diaFoco,
  chaveDia,
  parseData,
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

/** Ícone por tipo de item. Cor vem do `Badge`/dos tons abaixo; aqui é só a forma. */
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

/** Tipos de item que JÁ SÃO um deslocamento — falam por si no mapa do dia. */
const TIPO_DESLOCAMENTO: Record<string, string> = {
  voo: 'Voo',
  trem: 'Trem',
  onibus: 'Ônibus',
  traslado: 'Traslado',
  caminhada: 'A pé',
  cruzeiro: 'Cruzeiro',
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

/**
 * Como se chega a esta parada, para o mapa do dia.
 *
 * A opção de transporte cadastrada (`opcoes[].modo`) manda: é o único campo com
 * vocabulário fechado (`MODOS_TRANSPORTE`). Sem ela, um item que já é um
 * deslocamento fala por si. `transporte` no evento é TEXTO LIVRE ("metrô U3",
 * "Via BR-101") — vira legenda no cartão do item, nunca chave de ícone.
 */
function modoDoPonto(e: Record<string, any>): { Icone: LucideIcon; nome: string } | null {
  const modo = String(((e?.opcoes ?? []) as Record<string, any>[])[0]?.modo ?? '')
  if (ICONE_MODO[modo]) return { Icone: ICONE_MODO[modo], nome: NOME_MODO[modo] ?? modo }
  const tipo = String(e?.tipo ?? '')
  const nome = TIPO_DESLOCAMENTO[tipo]
  return nome && ICONE[tipo] ? { Icone: ICONE[tipo], nome } : null
}

/** Par bg/ink do mesmo tom que o `Badge` usa — colore o círculo do ícone na timeline. */
function tomIcone(tipo: string) {
  return TONS[tipo] ?? TONS[ALIAS_TOM[tipo] ?? ''] ?? TONS.neutro
}

const agora = () => new Date().toISOString()

/** Bandeira por nome de país em pt-BR. Cobertura deliberadamente parcial — sem
    entrada correspondente, nenhuma bandeira aparece (nunca uma errada). */
const PAIS_BANDEIRA: Record<string, string> = {
  portugal: '🇵🇹',
  espanha: '🇪🇸',
  frança: '🇫🇷',
  franca: '🇫🇷',
  alemanha: '🇩🇪',
  itália: '🇮🇹',
  italia: '🇮🇹',
  'reino unido': '🇬🇧',
  inglaterra: '🇬🇧',
  holanda: '🇳🇱',
  'países baixos': '🇳🇱',
  'paises baixos': '🇳🇱',
  bélgica: '🇧🇪',
  belgica: '🇧🇪',
  suíça: '🇨🇭',
  suica: '🇨🇭',
  áustria: '🇦🇹',
  austria: '🇦🇹',
  grécia: '🇬🇷',
  grecia: '🇬🇷',
  brasil: '🇧🇷',
  'estados unidos': '🇺🇸',
  eua: '🇺🇸',
  canadá: '🇨🇦',
  canada: '🇨🇦',
  méxico: '🇲🇽',
  mexico: '🇲🇽',
  japão: '🇯🇵',
  japao: '🇯🇵',
  marrocos: '🇲🇦',
  turquia: '🇹🇷',
  croácia: '🇭🇷',
  croacia: '🇭🇷',
  'república tcheca': '🇨🇿',
  'republica tcheca': '🇨🇿',
  tchéquia: '🇨🇿',
  tchequia: '🇨🇿',
  polônia: '🇵🇱',
  polonia: '🇵🇱',
  dinamarca: '🇩🇰',
  noruega: '🇳🇴',
  suécia: '🇸🇪',
  suecia: '🇸🇪',
  finlândia: '🇫🇮',
  finlandia: '🇫🇮',
  irlanda: '🇮🇪',
  hungria: '🇭🇺',
}

function bandeiraDoPais(pais: string): string | null {
  return PAIS_BANDEIRA[pais.trim().toLowerCase()] ?? null
}

/** Código de moeda -> "Euro (EUR)". Cai no próprio código se o navegador não souber nomeá-lo. */
function nomeMoeda(codigo: string): string {
  try {
    const nome = new Intl.DisplayNames(['pt-BR'], { type: 'currency' }).of(codigo)
    if (!nome) return codigo
    return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} (${codigo})`
  } catch {
    return codigo
  }
}

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
  if (dias.length === 0 || !dia) {
    return (
      <>
        <Titulo
          descricao="Cada dia com o que fazer, como chegar e o que levar."
          acao={<AdminAcoes entidade="roteiro">Primeiro item</AdminAcoes>}
        >
          Roteiro
        </Titulo>
        <Vazio
          titulo="Seu roteiro ainda não foi montado"
          texto="Defina as datas da viagem em Participantes e dados, ou adicione o primeiro item para o roteiro começar a se montar sozinho."
          acao={<AdminAcoes entidade="roteiro">Primeiro item</AdminAcoes>}
        />
      </>
    )
  }

  const moeda = String(snapshot.viagem?.moeda ?? 'EUR')
  const locais = locaisDoDia(dia, snapshot)

  return (
    <>
      <Cabecalho dia={dia} dias={dias} indice={indice} aoEscolher={setEscolhido} />

      {/* A faixa fica ACIMA do itinerário: é com ela que se troca de dia, e no
          rodapé isso exigia rolar a página inteira só para ir ao dia seguinte —
          justamente o gesto mais repetido da tela. */}
      <FaixaDias dias={dias} indice={indice} chaveHoje={chaveHoje} aoEscolher={setEscolhido} />

      <div className="mt-4 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          <TimelineDia dia={dia} moeda={moeda} mutate={mutate} posso={posso} />
        </div>

        {/* A coluna de apoio: o dia inteiro ao lado do itinerário, um cartão por
            assunto, na ordem em que se consulta — onde estou, que tempo faz, o
            que preciso saber, o que está reservado, o que lembrar, como andar.
            Nada atrás de aba: o que fica escondido numa aba é exatamente o que
            se descobre tarde demais. Abaixo de xl a coluna desce e vira a
            continuação da página, que é como o celular lê. */}
        <div className="min-w-0 space-y-4">
          <MapaDoDia dia={dia} />
          {/* O clima que importa é o de onde o dia TERMINA — é lá que se dorme. */}
          <ClimaDoDia cidade={locais.destino ?? locais.cidade} chaveDia={dia.chave} />
          <InformacoesDoDia dia={dia} moeda={moeda} posso={posso} />
          <SecaoDia titulo="Reservas">
            <ReservasDia dia={dia} moeda={moeda} />
          </SecaoDia>
          <SecaoDia titulo="Dicas">
            <DicasDia dia={dia} />
          </SecaoDia>
          <SecaoDia titulo="Checklist do dia">
            <ChecklistsDoDiaSecao dia={dia} />
          </SecaoDia>
          <SecaoDia titulo="Transportes">
            <TransportesDoDia dia={dia} />
          </SecaoDia>
          <GastosDoDia dia={dia} moeda={moeda} />
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------- cabeçalho do dia

function Cabecalho({
  dia,
  dias,
  indice,
  aoEscolher,
}: {
  dia: DiaRoteiro
  dias: DiaRoteiro[]
  indice: number
  aoEscolher: (chave: string) => void
}) {
  const { snapshot, posso } = useTrip()
  const derivadas = useMemo(() => entradasDerivadas(dia, snapshot), [dia, snapshot])
  const tipoDia = tipoEspecialDoDia(derivadas)
  const anterior = dias[indice - 1] ?? null
  const proximo = dias[indice + 1] ?? null
  const locais = locaisDoDia(dia, snapshot)
  const bandeira = locais.pais ? bandeiraDoPais(locais.pais) : null
  const menu = useRef<HTMLDetailsElement>(null)
  const [importando, setImportando] = useState(false)

  return (
    <div>
      <nav
        aria-label="Caminho"
        className="mb-2 flex items-center gap-1.5 text-[13px] text-(--color-tinta-3)"
      >
        <span>Roteiro</span>
        <ChevronRight size={13} aria-hidden />
        <span className="font-medium text-(--color-tinta-2)">
          {dia.numero > 0
            ? `Dia ${dia.numero} de ${dias.length}`
            : formatarData(dia.chave, { day: '2-digit', month: 'long' })}
        </span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="t-pagina">
              {formatarData(dia.chave, { day: '2-digit', month: 'long', year: 'numeric' })}
            </h1>
            {dia.numero > 0 && <Badge tipo="destaque" texto={`Dia ${dia.numero}`} />}
            {dia.meta?.ancora && (
              <Badge tipo="info" texto="Dia-âncora" icone={<Anchor size={11} />} />
            )}
            {tipoDia && (
              <Badge tipo="info" texto={tipoDia.rotulo} icone={<tipoDia.Icone size={11} />} />
            )}
          </div>
          {locais.cidade && (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[15px] font-medium text-(--color-tinta-2)">
              {tipoDia ? (
                <tipoDia.Icone size={15} className="text-(--color-tinta-3)" aria-hidden />
              ) : (
                bandeira && <span aria-hidden>{bandeira}</span>
              )}
              <span>{locais.cidade}</span>
              {locais.destino && (
                <>
                  <ArrowRight size={14} className="text-(--color-tinta-3)" aria-hidden />
                  <span>{locais.destino}</span>
                </>
              )}
              {locais.pais && !locais.destino && (
                <span className="text-(--color-tinta-3)">· {locais.pais}</span>
              )}
            </p>
          )}
          {dia.meta?.titulo && (
            <p className="mt-1 text-sm text-(--color-tinta-2)">{String(dia.meta.titulo)}</p>
          )}
        </div>

        <div className="sem-impressao flex shrink-0 items-center gap-1.5">
          <AdminAcoes entidade="dia" registro={dia.meta ?? { dia: dia.chave }}>
            Editar dia
          </AdminAcoes>
          {posso('editor') && (
            // <details> em vez de estado + listener de clique fora: um menu de
            // uma ação só não justifica JS próprio — o navegador já sabe abrir
            // e fechar isto.
            <details ref={menu} className="group relative">
              <summary className="toque flex cursor-pointer list-none items-center gap-1.5 rounded-xl border border-(--color-borda-forte) bg-(--color-cartao) px-3 text-sm font-medium text-(--color-tinta) transition-colors select-none [&::-webkit-details-marker]:hidden hover:bg-(--color-superficie-2)">
                Mais opções
                <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
              </summary>
              <div
                className="absolute right-0 z-10 mt-1.5 min-w-52 rounded-xl border border-(--color-borda) bg-(--color-cartao) p-1.5"
                style={{ boxShadow: 'var(--sombra-2)' }}
              >
                <AdminAcoes entidade="roteiro" registro={{ ocorre_em: `${dia.chave}T09:00` }}>
                  Adicionar item
                </AdminAcoes>
                <button
                  onClick={() => {
                    menu.current?.removeAttribute('open')
                    setImportando(true)
                  }}
                  className="toque flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-left text-sm font-medium transition-colors hover:bg-(--color-destaque-tenue)"
                  style={{ color: 'var(--destaque)' }}
                >
                  <Upload size={15} /> Importar roteiro (JSON)
                </button>
              </div>
            </details>
          )}
          <span aria-hidden className="mx-1 h-6 w-px bg-(--color-borda)" />
          <BotaoIcone
            rotulo="Dia anterior"
            desabilitado={!anterior}
            onClick={() => anterior && aoEscolher(anterior.chave)}
          >
            <ChevronLeft size={17} />
          </BotaoIcone>
          <BotaoIcone
            rotulo="Próximo dia"
            desabilitado={!proximo}
            onClick={() => proximo && aoEscolher(proximo.chave)}
          >
            <ChevronRight size={17} />
          </BotaoIcone>
        </div>
      </div>

      <ChipsTopo dia={dia} totalDias={dias.length} />

      {importando && <ImportarRoteiroModal aoFechar={() => setImportando(false)} />}
    </div>
  )
}

/** Os quatro fatos rápidos do dia. Cada um só aparece com dado real por trás. */
function ChipsTopo({ dia, totalDias }: { dia: DiaRoteiro; totalDias: number }) {
  const { snapshot } = useTrip()
  const locais = locaisDoDia(dia, snapshot)
  const agora = useClimaAgora(locais.cidades)
  const hospedagem = hospedagemDoDia(dia, snapshot)

  const chips: {
    icone: ReactNode
    linha1: ReactNode
    linha2: ReactNode
    destaqueLinha1: boolean
  }[] = []

  if (dia.numero > 0) {
    chips.push({
      icone: <CalendarDays size={16} className="text-(--color-tinta-3)" />,
      linha1: `Dia ${dia.numero} de ${totalDias}`,
      linha2: formatarData(dia.chave, { weekday: 'long' }),
      destaqueLinha1: true,
    })
  }

  // Logo depois do "Dia N de M": uma cidade por chip, na ordem do trajeto.
  for (const c of agora) {
    const IconeClima = CODIGO_ICONE[c.codigo] ?? Cloud
    chips.push({
      icone: <IconeClima size={18} style={{ color: 'var(--destaque)' }} />,
      linha1: `${Math.round(c.temp)}° ${c.cidade}`,
      linha2: `agora · ${descricaoClima(c.codigo)}`,
      destaqueLinha1: true,
    })
  }

  if (hospedagem) {
    chips.push({
      icone: <BedDouble size={16} className="text-(--color-tinta-3)" />,
      linha1: 'Hospedagem',
      linha2: String(hospedagem.nome),
      destaqueLinha1: false,
    })
  }

  return (
    <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
      {chips.map((c, i) => (
        <div
          key={i}
          className="flex shrink-0 items-center gap-2.5 rounded-2xl border border-(--color-borda) bg-(--color-cartao) px-3 py-2"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-(--color-superficie-2)">
            {c.icone}
          </span>
          <span className="min-w-0">
            <span
              className={`block truncate text-[13px] ${c.destaqueLinha1 ? 'font-semibold' : 'text-(--color-tinta-3)'}`}
            >
              {c.linha1}
            </span>
            <span
              className={`block truncate text-[12px] ${c.destaqueLinha1 ? 'text-(--color-tinta-3)' : 'font-semibold'}`}
            >
              {c.linha2}
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- seções

/**
 * O título de cada bloco, agora que as abas sumiram.
 *
 * É o mesmo `t-legenda` dos rótulos de cartão, mas num `<h2>`: sem as abas, a
 * única coisa que dizia "aqui começa outro assunto" era o clique — e leitor de
 * tela nenhum navegava por isso. Com heading de verdade dá para pular de seção
 * em seção.
 */
/**
 * O vazio de uma seção da coluna lateral: uma linha, não um bloco.
 *
 * `Vazio` é desenhado para uma tela inteira sem conteúdo — ícone, título e duas
 * linhas de texto, uns 180px. A coluna tem sete assuntos; quatro caixas grandes
 * dizendo "nada aqui" empurram para fora da tela justamente o que TEM conteúdo.
 * A instrução de como preencher continua, só que sem ocupar o lugar do dia.
 */
function Nada({ children }: { children: ReactNode }) {
  return (
    <Cartao>
      <p className="text-[13px] text-(--color-tinta-3)">{children}</p>
    </Cartao>
  )
}

function SecaoDia({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="t-legenda mb-2">{titulo}</h2>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------- importar roteiro (json)

/**
 * O botão "Importar roteiro (JSON)" — a mesma peça que faltava para a Skill
 * poder alimentar uma viagem que já existe, não só criar uma nova.
 *
 * `/api/import` (a tela Dados → Importar) sempre CRIA uma viagem — nunca
 * atualiza a que já está aberta. Em vez de inventar uma rota nova para isto,
 * o formato de entrada é o mesmo vocabulário do arquivo de importação
 * (`dias[]`/`roteiro[]`, os campos de `DiaSchema`/`EventoSchema`), e a escrita
 * passa pelo MESMO `/api/mutate` que qualquer edição manual usa — mesma
 * autorização por papel, mesmo recorte por `trip_id`, mesmo last-write-wins.
 * Nada de novo no servidor.
 *
 * Duas regras, direto da seção 22 do brief original:
 *   1. Nunca apagar em silêncio — esta tela só CRIA e ATUALIZA, nunca remove.
 *   2. Toda alteração é mostrada, campo por campo, antes de gravar.
 */

type DiffCampo = { campo: string; antes: unknown; depois: unknown }
type PlanoRegistro = {
  tipo: 'novo' | 'atualizado'
  id?: string
  resumo: string
  campos: Record<string, any>
  opcoes: Record<string, any>[]
  diffs: DiffCampo[]
}
type Plano = { dias: PlanoRegistro[]; itens: PlanoRegistro[] }

const NOME_CAMPO: Record<string, string> = {
  titulo: 'Título',
  cidade: 'Cidade',
  pais: 'País',
  resumo: 'Resumo',
  ocorre_em: 'Horário',
  fim_em: 'Término',
  local: 'Local',
  endereco: 'Endereço',
  transporte: 'Transporte',
  como_chegar: 'Como chegar',
  dicas: 'Dicas',
  links: 'Links',
  nota: 'Observação',
  descricao: 'Descrição',
  custo_centavos: 'Custo estimado',
  distancia_m: 'Distância',
  duracao_min: 'Duração',
  ancora: 'Marcado como âncora',
  alertas: 'Atenção hoje',
  antes_sair: 'Antes de sair',
  antes_dormir: 'Antes de dormir',
  mapa_url: 'Link do mapa',
  tipo: 'Tipo',
}

/** "AAAA-MM-DDTHH:MM" — chave de casamento de horário, cega ao ":00" de segundos que o banco guarda e o JSON não. */
function chaveMinuto(valor: unknown): string {
  return String(valor ?? '').slice(0, 16)
}

/** Igualdade tolerante ao ":00" de segundos nos campos de horário; exata nos demais. */
function valoresIguais(campo: string, a: unknown, b: unknown): boolean {
  if (campo === 'ocorre_em' || campo === 'fim_em') return chaveMinuto(a) === chaveMinuto(b)
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

function camposAlterados(existente: Record<string, any>, novos: Record<string, any>): DiffCampo[] {
  const diffs: DiffCampo[] = []
  for (const campo of Object.keys(novos)) {
    const antes = existente[campo] ?? null
    const depois = novos[campo] ?? null
    if (!valoresIguais(campo, antes, depois)) diffs.push({ campo, antes, depois })
  }
  return diffs
}

/**
 * Só os campos que o ARQUIVO realmente mencionou — nunca o objeto validado
 * inteiro. `DiaSchema`/`EventoSchema` preenchem default (`ancora: false`,
 * `ordem: 0`...) em todo campo omitido; usar o objeto cheio numa ATUALIZAÇÃO
 * apagaria em silêncio um `ancora: true` que já estava salvo só porque o novo
 * arquivo não falou nada sobre aquele campo. Numa CRIAÇÃO isso não se aplica —
 * registro novo não tem nada para apagar, então usa o objeto cheio.
 */
function apenasCamposDoArquivo(
  bruto: Record<string, any>,
  validado: Record<string, any>,
): Record<string, any> {
  const saida: Record<string, any> = {}
  for (const chave of Object.keys(bruto)) {
    if (chave === 'id') continue
    saida[chave] = validado[chave]
  }
  return saida
}

function semChaves(obj: Record<string, any>, fora: string[]): Record<string, any> {
  const saida: Record<string, any> = {}
  for (const chave of Object.keys(obj)) {
    if (!fora.includes(chave)) saida[chave] = obj[chave]
  }
  return saida
}

function formatarValorDiff(campo: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '—'
  if (campo === 'ocorre_em' || campo === 'fim_em') {
    return `${formatarData(String(valor), { day: '2-digit', month: 'short' })} · ${formatarHora(String(valor))}`
  }
  if (campo === 'dia') return formatarData(String(valor), { day: '2-digit', month: 'long' })
  if (campo === 'custo_centavos') return formatarDinheiro(Number(valor))
  if (campo === 'distancia_m') return formatarDistancia(Number(valor)) || '—'
  if (campo === 'duracao_min') return formatarDuracao(Number(valor)) || '—'
  if (typeof valor === 'boolean') return valor ? 'sim' : 'não'
  if (Array.isArray(valor)) return `${valor.length} item(ns)`
  return String(valor).slice(0, 90)
}

function planejarDias(
  entradas: { bruto: Record<string, any>; dados: Record<string, any> }[],
  existentes: Record<string, any>[],
): PlanoRegistro[] {
  return entradas.map(({ bruto, dados }) => {
    const existente = existentes.find((e) => String(e.dia) === String(dados.dia))
    const campos = existente
      ? apenasCamposDoArquivo(bruto, dados)
      : apenasCamposDoArquivo({ ...dados }, dados) // criação: usa o objeto cheio (com os defaults do schema)
    return {
      tipo: existente ? ('atualizado' as const) : ('novo' as const),
      id: existente ? String(existente.id) : undefined,
      resumo: `${formatarData(String(dados.dia), { day: '2-digit', month: 'long' })}${
        dados.cidade ? ` · ${dados.cidade}` : ''
      }`,
      campos,
      opcoes: [],
      diffs: existente ? camposAlterados(existente, campos) : [],
    }
  })
}

function planejarItens(
  entradas: { bruto: Record<string, any>; dados: Record<string, any> }[],
  existentes: Record<string, any>[],
): PlanoRegistro[] {
  const usados = new Set<string>()
  return entradas.map(({ bruto, dados }) => {
    const alvo = chaveMinuto(dados.ocorre_em)
    const existente = existentes.find(
      (e) => !usados.has(String(e.id)) && chaveMinuto(e.ocorre_em) === alvo,
    )
    if (existente) usados.add(String(existente.id))

    // opcoes/reserva/documento não são colunas de `itinerary_events` — `opcoes`
    // vira mutações próprias depois de criado o item; `reserva`/`documento` (o
    // vínculo por NOME que só existe num arquivo de importação completo) fica
    // de fora nesta versão, então some do plano em vez de falhar a validação.
    const opcoes = (dados.opcoes ?? []) as Record<string, any>[]
    const brutoLimpo = semChaves(bruto, ['opcoes', 'reserva', 'documento', 'id'])
    const dadosLimpos = semChaves(dados, ['opcoes', 'reserva', 'documento', 'id'])

    const campos = existente ? apenasCamposDoArquivo(brutoLimpo, dadosLimpos) : dadosLimpos
    return {
      tipo: existente ? ('atualizado' as const) : ('novo' as const),
      id: existente ? String(existente.id) : undefined,
      resumo: `${formatarHora(String(dados.ocorre_em)) || '—'} · ${String(dados.titulo)}`,
      campos,
      // Opções de transporte só entram para atividades NOVAS: uma atividade que
      // já existe pode ter opções que alguém editou na mão, e casar a lista
      // antiga com a nova sem um id estável arrisca duplicar ou apagar opção —
      // exatamente o que a regra "nunca apagar em silêncio" proíbe.
      opcoes: existente ? [] : ((opcoes ?? []) as Record<string, any>[]),
      diffs: existente ? camposAlterados(existente, campos) : [],
    }
  })
}

function ImportarRoteiroModal({ aoFechar }: { aoFechar: () => void }) {
  const { snapshot, mutate } = useTrip()
  const avisar = useAviso()
  const [erro, setErro] = useState<string | null>(null)
  const [plano, setPlano] = useState<Plano | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [progresso, setProgresso] = useState(0)

  async function processar(texto: string) {
    setErro(null)
    let bruto: unknown
    try {
      bruto = JSON.parse(texto)
    } catch {
      setErro('Não consegui ler o arquivo como JSON — confira se ele não foi cortado.')
      return
    }
    const obj = (bruto ?? {}) as Record<string, any>
    const diasBrutos = Array.isArray(obj.dias) ? obj.dias : []
    const itensBrutos = Array.isArray(obj.roteiro)
      ? obj.roteiro
      : Array.isArray(obj.itens)
        ? obj.itens
        : []

    if (diasBrutos.length === 0 && itensBrutos.length === 0) {
      setErro('O arquivo não tem "dias" nem "roteiro" — nada para importar.')
      return
    }

    const diasValidados: { bruto: Record<string, any>; dados: Record<string, any> }[] = []
    for (let i = 0; i < diasBrutos.length; i++) {
      const r = DiaSchema.safeParse(diasBrutos[i])
      if (!r.success) {
        setErro(`dias[${i}]: ${formatarErroZod(r.error)}`)
        return
      }
      diasValidados.push({ bruto: diasBrutos[i], dados: r.data })
    }

    const itensValidados: { bruto: Record<string, any>; dados: Record<string, any> }[] = []
    for (let i = 0; i < itensBrutos.length; i++) {
      const r = EventoSchema.safeParse(itensBrutos[i])
      if (!r.success) {
        setErro(`roteiro[${i}]: ${formatarErroZod(r.error)}`)
        return
      }
      itensValidados.push({ bruto: itensBrutos[i], dados: r.data })
    }

    setPlano({
      dias: planejarDias(diasValidados, (snapshot?.dias ?? []) as Record<string, any>[]),
      itens: planejarItens(itensValidados, (snapshot?.roteiro ?? []) as Record<string, any>[]),
    })
  }

  async function aplicar() {
    if (!plano) return
    setOcupado(true)
    setErro(null)
    setProgresso(0)
    const ts = agora()
    let feito = 0

    try {
      for (const d of plano.dias) {
        if (d.tipo === 'novo') {
          await mutate({
            op: 'criar',
            entidade: 'dia',
            id: crypto.randomUUID(),
            campos: d.campos,
            client_ts: ts,
          })
        } else {
          await mutate({
            op: 'editar',
            entidade: 'dia',
            id: d.id!,
            campos: d.campos,
            client_ts: ts,
          })
        }
        setProgresso(++feito)
      }

      for (const it of plano.itens) {
        let itemId = it.id
        if (it.tipo === 'novo') {
          itemId = crypto.randomUUID()
          await mutate({
            op: 'criar',
            entidade: 'roteiro',
            id: itemId,
            campos: it.campos,
            client_ts: ts,
          })
          for (const o of it.opcoes) {
            await mutate({
              op: 'criar',
              entidade: 'opcao',
              id: crypto.randomUUID(),
              campos: { ...o, event_id: itemId },
              client_ts: ts,
            })
          }
        } else {
          await mutate({
            op: 'editar',
            entidade: 'roteiro',
            id: itemId!,
            campos: it.campos,
            client_ts: ts,
          })
        }
        setProgresso(++feito)
      }

      avisar(
        'sucesso',
        `Roteiro importado: ${plano.dias.length} dia(s), ${plano.itens.length} atividade(s).`,
      )
      aoFechar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falhou ao aplicar as mudanças. Tente de novo.')
    } finally {
      setOcupado(false)
    }
  }

  const total = plano ? plano.dias.length + plano.itens.length : 0

  return (
    <AppModal
      titulo="Importar roteiro (JSON)"
      descricao={
        plano
          ? 'Confira o que vai mudar antes de gravar — nada é apagado, só criado ou atualizado.'
          : 'Um arquivo com as seções "dias" e/ou "roteiro", no formato do arquivo de importação do app.'
      }
      tamanho="grande"
      aoFechar={aoFechar}
      acoes={
        plano ? (
          <>
            <Botao variante="secundario" onClick={() => setPlano(null)} desabilitado={ocupado}>
              Voltar
            </Botao>
            <Botao onClick={aplicar} carregando={ocupado} desabilitado={total === 0}>
              {ocupado ? `Aplicando… ${progresso}/${total}` : 'Confirmar importação'}
            </Botao>
          </>
        ) : undefined
      }
    >
      {!plano && (
        <>
          <label className="toque inline-flex cursor-pointer items-center gap-2 rounded-xl border border-(--color-borda-forte) px-4 text-sm font-medium">
            <Upload size={16} /> Escolher arquivo
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                await processar(await f.text())
                e.target.value = ''
              }}
            />
          </label>
          {erro && (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-(--color-perigo-bg) px-3 py-2 text-sm text-(--color-perigo-ink)">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {erro}
            </p>
          )}
        </>
      )}

      {plano && (
        <div className="space-y-4 pb-2">
          {erro && (
            <p className="flex items-start gap-2 rounded-xl bg-(--color-perigo-bg) px-3 py-2 text-sm text-(--color-perigo-ink)">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {erro}
            </p>
          )}
          {total === 0 && (
            <p className="text-sm text-(--color-tinta-3)">Nada reconhecido neste arquivo.</p>
          )}
          {plano.dias.length > 0 && (
            <div>
              <Rotulo>Dias ({plano.dias.length})</Rotulo>
              <ul className="mt-2 space-y-2">
                {plano.dias.map((d, i) => (
                  <PlanoLinha key={i} item={d} />
                ))}
              </ul>
            </div>
          )}
          {plano.itens.length > 0 && (
            <div>
              <Rotulo>Atividades ({plano.itens.length})</Rotulo>
              <ul className="mt-2 space-y-2">
                {plano.itens.map((it, i) => (
                  <PlanoLinha key={i} item={it} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </AppModal>
  )
}

function PlanoLinha({ item }: { item: PlanoRegistro }) {
  return (
    <li className="rounded-xl border border-(--color-borda) p-3">
      <div className="flex items-center gap-2">
        <Badge
          tipo={item.tipo === 'novo' ? 'sucesso' : 'info'}
          texto={item.tipo === 'novo' ? 'Novo' : 'Atualizado'}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.resumo}</span>
        {item.opcoes.length > 0 && (
          <span className="shrink-0 text-[12px] text-(--color-tinta-3)">
            +{item.opcoes.length} opção(ões) de transporte
          </span>
        )}
      </div>
      {item.diffs.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-(--color-borda) pt-2">
          {item.diffs.map((d) => (
            <li key={d.campo} className="text-[12px] text-(--color-tinta-2)">
              <span className="font-medium">{NOME_CAMPO[d.campo] ?? d.campo}: </span>
              <span className="text-(--color-tinta-3) line-through">
                {formatarValorDiff(d.campo, d.antes)}
              </span>
              {' → '}
              <span className="font-medium">{formatarValorDiff(d.campo, d.depois)}</span>
            </li>
          ))}
        </ul>
      )}
      {item.tipo === 'atualizado' && item.diffs.length === 0 && (
        <p className="mt-1 text-[12px] text-(--color-tinta-3)">
          Já está igual ao que está gravado — nada muda.
        </p>
      )}
    </li>
  )
}

// ---------------------------------------------------------------- seção: roteiro do dia

/** Roteiro do dia + entradas derivadas de outras abas, juntos numa linha do tempo por horário. */
function montarLinha(dia: DiaRoteiro, derivadas: Derivada[]) {
  return [
    ...dia.itens.map((e) => ({ item: e, derivada: null as Derivada | null })),
    ...derivadas.map((d) => ({ item: d.como, derivada: d })),
  ].sort((a, b) => String(a.item.ocorre_em ?? '').localeCompare(String(b.item.ocorre_em ?? '')))
}

function itemTemDetalhe(item: Record<string, any>, derivada: Derivada | null): boolean {
  return (
    Boolean(item.descricao || item.como_chegar || item.nota || item.endereco) ||
    linhas(item.dicas).length > 0 ||
    lerLinks(item.links).length > 0 ||
    ((item.opcoes ?? []) as unknown[]).length > 0 ||
    Number(item.custo_centavos) > 0 ||
    Boolean(derivada?.detalhe)
  )
}

function TimelineDia({
  dia,
  moeda,
  mutate,
  posso,
}: {
  dia: DiaRoteiro
  moeda: string
  mutate: ReturnType<typeof useTrip>['mutate']
  posso: (minimo: Papel) => boolean
}) {
  const { snapshot } = useTrip()
  const derivadas = useMemo(() => entradasDerivadas(dia, snapshot), [dia, snapshot])
  const linha = useMemo(() => montarLinha(dia, derivadas), [dia, derivadas])
  const semente = { ocorre_em: `${dia.chave}T09:00` }

  if (linha.length === 0) {
    return (
      <Vazio
        titulo="Este dia ainda está vazio"
        texto="Comece a montar o roteiro: atividades, deslocamentos, reservas, dicas e compromissos."
        acao={
          <AdminAcoes entidade="roteiro" registro={semente}>
            Adicionar atividade
          </AdminAcoes>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
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
          Adicionar atividade
        </AdminAcoes>
      )}
    </div>
  )
}

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
  const tom = tomIcone(tipo)
  const dist = formatarDistancia(item.distancia_m)
  const dur = formatarDuracao(item.duracao_min)
  const temDeslocamento = Boolean(dist || dur || item.transporte)
  const temDetalhe = itemTemDetalhe(item, derivada)

  // Duração da própria atividade (não do deslocamento até ela), só quando há hora de fim.
  const duracaoAtividade = (() => {
    const ini = parseData(item.ocorre_em)
    const fim = parseData(item.fim_em)
    if (!ini || !fim || fim <= ini) return ''
    return formatarDuracao(Math.round((fim.getTime() - ini.getTime()) / 60_000))
  })()
  const primeiraDica = linhas(item.dicas)[0] ?? null
  // Casamento de palavra-chave, não um enum — `transporte` é texto livre (quem
  // escreve digita "Metrô U3" ou "Táxi até o porto"). Sem palavra-chave
  // reconhecida cai em "a pé", o deslocamento mais comum num dia de cidade.
  const textoTransporte = String(item.transporte ?? '').toLowerCase()
  const IconeDeslocamento = /metr[oô]|u-?bahn|s-?bahn|subway|trem|train/.test(textoTransporte)
    ? TrainFront
    : /[oô]nibus|bus/.test(textoTransporte)
      ? Bus
      : /t[aá]xi|uber|carro/.test(textoTransporte)
        ? Car
        : /barco|balsa|ferry|navio/.test(textoTransporte)
          ? Ship
          : /avi[aã]o|voo|flight/.test(textoTransporte)
            ? Plane
            : Footprints

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
        className="absolute top-0 bottom-0 left-[0.9375rem] border-l border-dashed border-(--color-borda-forte)"
      />

      {temDeslocamento && anterior && (
        <div className="relative py-1.5">
          <div className="flex items-center gap-1.5 rounded-lg bg-(--color-superficie-2) px-3 py-1.5 text-[12px] font-medium text-(--color-tinta-2)">
            <IconeDeslocamento size={13} className="shrink-0 text-(--color-tinta-3)" />
            <span>
              {[dist, dur].filter(Boolean).join(' · ')}
              {item.transporte ? ` · ${String(item.transporte)}` : ''}
            </span>
          </div>
        </div>
      )}

      <div className="relative flex gap-3 py-2">
        <span
          aria-hidden
          className="absolute top-3.5 left-[-2.375rem] flex h-8 w-8 items-center justify-center rounded-full border-2 border-(--color-cartao)"
          style={{ background: tom.bg }}
        >
          <Icone size={15} style={{ color: tom.ink }} />
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

              {(duracaoAtividade || item.reserva_id || item.nota || primeiraDica) && (
                <div className="mt-1.5 space-y-1">
                  {duracaoAtividade && (
                    <p className="flex items-center gap-1.5 text-[12px] text-(--color-tinta-3)">
                      <Clock size={12} className="shrink-0" /> Duração sugerida: {duracaoAtividade}
                    </p>
                  )}
                  {Boolean(item.reserva_id) && (
                    <p className="flex items-center gap-1.5 text-[12px] text-(--color-tinta-3)">
                      <Ticket size={12} className="shrink-0" /> Reserva confirmada
                    </p>
                  )}
                  {(item.nota || primeiraDica) && (
                    <p className="flex items-center gap-1.5 text-[12px] text-(--color-tinta-3)">
                      <StickyNote size={12} className="shrink-0" />{' '}
                      {String(item.nota || primeiraDica)}
                    </p>
                  )}
                </div>
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
              {aberto ? 'Menos detalhes' : 'Ver detalhes'}
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

/** O que só interessa quando a pessoa vai fazer aquilo — endereço, como chegar, reserva, custo. */
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

// ---------------------------------------------------------------- seção: reservas

/** Toda reserva vinculada a este dia — hospedagem, e o que qualquer atividade carrega. */
function ReservasDia({ dia, moeda }: { dia: DiaRoteiro; moeda: string }) {
  const { snapshot } = useTrip()
  const hospedagem = hospedagemDoDia(dia, snapshot)
  const derivadas = useMemo(() => entradasDerivadas(dia, snapshot), [dia, snapshot])
  const comLocalizador = derivadas.filter((d) => d.detalhe)

  const itensComReserva = dia.itens
    .map((item) => ({
      item,
      reserva: (snapshot?.reservas as Record<string, any>[] | undefined)?.find(
        (r) => r.id === item.reserva_id,
      ),
    }))
    .filter((x): x is { item: Record<string, any>; reserva: Record<string, any> } =>
      Boolean(x.reserva),
    )

  if (!hospedagem && comLocalizador.length === 0 && itensComReserva.length === 0) {
    return (
      <Nada>
        Sem reserva hoje. Hospedagem, passeio ou transporte vinculados a uma atividade deste dia
        aparecem aqui.
      </Nada>
    )
  }

  return (
    <div className="space-y-3">
      {hospedagem && (
        <Cartao>
          <Rotulo>Hospedagem</Rotulo>
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
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {hospedagem.localizador && (
              <Copiar valor={String(hospedagem.localizador)} rotulo="Localizador" />
            )}
            {hospedagem.link && (
              <a
                href={String(hospedagem.link)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[13px] font-medium"
                style={{ color: 'var(--destaque)' }}
              >
                Ver reserva <ExternalLink size={12} />
              </a>
            )}
          </div>
        </Cartao>
      )}

      {comLocalizador.map((d) => (
        <Cartao key={String(d.como.id)}>
          <Rotulo>{String(d.como.titulo)}</Rotulo>
          <div className="mt-1.5">{d.detalhe}</div>
        </Cartao>
      ))}

      {itensComReserva.map(({ item, reserva }) => (
        <Cartao key={String(item.id)}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Rotulo>{String(item.titulo)}</Rotulo>
              <p className="mt-1.5 font-semibold">{String(reserva.nome)}</p>
            </div>
            <span className="tab-num shrink-0 text-[13px] text-(--color-tinta-3)">
              {formatarHora(item.ocorre_em)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {reserva.localizador && (
              <Copiar valor={String(reserva.localizador)} rotulo="Localizador" />
            )}
            {Number(reserva.valor_centavos) > 0 && (
              <span className="tab-num text-[13px] text-(--color-tinta-2)">
                {formatarDinheiro(Number(reserva.valor_centavos), moeda)}
              </span>
            )}
            {reserva.link && (
              <a
                href={String(reserva.link)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[13px] font-medium"
                style={{ color: 'var(--destaque)' }}
              >
                Ver reserva <ExternalLink size={12} />
              </a>
            )}
          </div>
        </Cartao>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- seção: dicas

/** Dicas no contexto certo: primeiro os alertas do dia, depois a dica de cada atividade que tem uma. */
function DicasDia({ dia }: { dia: DiaRoteiro }) {
  const { snapshot } = useTrip()
  const derivadas = useMemo(() => entradasDerivadas(dia, snapshot), [dia, snapshot])
  const linha = useMemo(() => montarLinha(dia, derivadas), [dia, derivadas])
  const alertas = linhas(dia.meta?.alertas)
  const comDica = linha.filter((l) => linhas(l.item.dicas).length > 0)
  const links = lerLinks(dia.meta?.links)
  const mapaUrl = dia.meta?.mapa_url ? String(dia.meta.mapa_url) : null

  if (alertas.length === 0 && comDica.length === 0 && links.length === 0 && !mapaUrl) {
    return (
      <Nada>
        Sem dica hoje. O que você escrever numa atividade, ou em Editar dia, aparece aqui.
      </Nada>
    )
  }

  return (
    <div className="space-y-3">
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

      {comDica.map((l, i) => (
        <Cartao key={String(l.item.id ?? `d${i}`)}>
          <p className="flex items-center gap-2 text-[13px] font-semibold text-(--color-tinta-2)">
            <span className="tab-num text-(--color-tinta-3)">
              {formatarHora(l.item.ocorre_em) || '—'}
            </span>
            {String(l.item.titulo)}
          </p>
          <ul className="mt-2 space-y-1.5">
            {linhas(l.item.dicas).map((d, j) => (
              <li key={j} className="flex gap-2 text-sm text-(--color-tinta-2)">
                <Lightbulb
                  size={14}
                  className="mt-0.5 shrink-0"
                  style={{ color: 'var(--destaque)' }}
                />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </Cartao>
      ))}

      {(links.length > 0 || mapaUrl) && (
        <Cartao>
          <Rotulo>Links úteis do dia</Rotulo>
          <ul className="mt-2 space-y-1.5">
            {mapaUrl && (
              <li>
                <a
                  href={mapaUrl}
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
    </div>
  )
}

// ---------------------------------------------------------------- seção: checklists do dia

/**
 * O checklist do dia NÃO é um sistema novo, e "antes de sair"/"antes de dormir"
 * também não são tarefas — os três só ficam juntos aqui porque são, os três,
 * coisas para marcar antes de seguir em frente.
 */
function ChecklistsDoDiaSecao({ dia }: { dia: DiaRoteiro }) {
  const { snapshot } = useTrip()
  const doDia = ((snapshot?.checklist ?? []) as Record<string, any>[]).filter(
    (i) => chaveDia(i.prazo_ideal) === dia.chave || chaveDia(i.prazo_maximo) === dia.chave,
  )
  const sair = linhas(dia.meta?.antes_sair)
  const dormir = linhas(dia.meta?.antes_dormir)

  if (doDia.length === 0 && sair.length === 0 && dormir.length === 0) {
    return (
      <Nada>
        Nada para marcar hoje. Itens com prazo neste dia, e os rituais de sair e dormir, aparecem
        aqui.
      </Nada>
    )
  }

  return (
    <div className="space-y-4">
      <ChecklistDoDia dia={dia} />
      <RituaisDoDia dia={dia} />
    </div>
  )
}

// ---------------------------------------------------------------- clima

const CODIGO_CHUVA = new Set([51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99])

/** Ícone por código do tempo (Open-Meteo) — mesmo padrão de `ICONE`/`ICONE_MODO`. */
const CODIGO_ICONE: Record<number, LucideIcon> = {
  0: Sun,
  1: CloudSun,
  2: CloudSun,
  3: Cloud,
  45: CloudFog,
  48: CloudFog,
  51: CloudRain,
  53: CloudRain,
  55: CloudRain,
  61: CloudRain,
  63: CloudRain,
  65: CloudRain,
  71: CloudSnow,
  73: CloudSnow,
  75: CloudSnow,
  80: CloudRain,
  81: CloudRain,
  82: CloudRain,
  95: CloudLightning,
  96: CloudLightning,
  99: CloudLightning,
}

/**
 * Clima ao vivo do dia aberto — roda no cliente, sem chave, nunca entra no
 * snapshot nem no cache offline.
 *
 * Só existe previsão real para os próximos ~16 dias (limite do Open-Meteo) e só
 * quando a cidade do dia bate com um lugar que tem coordenada em `places`. Fora
 * disso o chamador simplesmente não recebe `hoje` — nunca inventa número.
 *
 * ponytail: usado tanto pelo chip do cabeçalho quanto pelo cartão da coluna de
 * apoio, cada um busca por conta própria (duas chamadas ao Open-Meteo por troca
 * de dia). Um cache/contexto compartilhado só vale a pena se isso um dia pesar
 * de verdade — é uma API sem chave e sem custo por chamada.
 */
/** Horizonte da Open-Meteo. Um dia além disso não tem previsão — e uma viagem
    marcada para daqui a meses buscaria clima a cada troca de dia por nada. */
const DIAS_DE_PREVISAO = 16

function dentroDaPrevisao(chaveDiaAlvo: string): boolean {
  const alvo = parseData(chaveDiaAlvo)
  if (!alvo) return false
  const dias = (alvo.getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000
  return dias >= 0 && dias < DIAS_DE_PREVISAO
}

function usePrevisaoDoDia(cidade: string | null, chaveDiaAlvo: string) {
  const { snapshot } = useTrip()

  const lugar = useMemo(() => {
    if (!cidade) return null
    const alvo = cidade.trim().toLowerCase()
    return (
      (snapshot?.lugares as Record<string, any>[] | undefined)?.find(
        (l) =>
          String(l.cidade ?? '')
            .trim()
            .toLowerCase() === alvo &&
          l.lat != null &&
          l.lon != null,
      ) ?? null
    )
  }, [cidade, snapshot?.lugares])

  const lat = lugar ? Number(lugar.lat) : null
  const lon = lugar ? Number(lugar.lon) : null
  const chaveLugar = lat != null && lon != null ? `${lat},${lon}` : null

  // Guardado junto com a coordenada que gerou a busca: evita mostrar a
  // previsão da CIDADE ANTERIOR sob o nome da nova, no instante entre trocar
  // de dia e a resposta da nova busca chegar.
  const [estado, setEstado] = useState<{ chave: string; previsoes: PrevisaoDia[] } | null>(null)

  useEffect(() => {
    if (lat == null || lon == null || !dentroDaPrevisao(chaveDiaAlvo)) return
    let cancelado = false
    void buscarClima(lat, lon, 16).then((previsoes) => {
      if (!cancelado && previsoes) setEstado({ chave: `${lat},${lon}`, previsoes })
    })
    return () => {
      cancelado = true
    }
  }, [lat, lon, chaveDiaAlvo])

  const previsoes = estado?.chave === chaveLugar ? estado.previsoes : null
  const hoje = previsoes?.find((p) => p.data === chaveDiaAlvo) ?? null
  return { lugar, previsoes, hoje }
}

/**
 * O tempo AGORA em cada cidade por onde o dia passa.
 *
 * Não é a previsão para a data da viagem — essa mora no cartão da lateral e só
 * existe dentro da janela de ~16 dias. Numa viagem marcada para daqui a meses o
 * cartão fica calado, e este chip continua respondendo. Por isso a tela escreve
 * "agora": sem essa palavra o número mente sobre o dia que está aberto.
 *
 * Só entra cidade que tem coordenada em `lugares`. Nome de cidade não vira
 * coordenada por adivinhação.
 */
function useClimaAgora(cidades: string[]) {
  const { snapshot } = useTrip()
  const lugares = (snapshot?.lugares as Record<string, any>[] | undefined) ?? []

  // Serializado para o efeito ter UMA dependência honesta: a lista derivada é
  // um array novo a cada render, e como dep faria a busca rodar sem parar.
  const alvos = JSON.stringify(
    cidades
      .map((c) => lugares.find((l) => mesmaCidade(l.cidade, c) && l.lat != null && l.lon != null))
      .filter(Boolean)
      .map((l) => ({ cidade: String(l!.cidade), lat: Number(l!.lat), lon: Number(l!.lon) })),
  )

  // Guardado junto da chave que gerou a busca: sem isso, trocar de dia mostraria
  // a temperatura da cidade anterior sob o nome da nova até a resposta chegar.
  const [estado, setEstado] = useState<{
    chave: string
    itens: { cidade: string; temp: number; codigo: number }[]
  } | null>(null)

  useEffect(() => {
    const lista = JSON.parse(alvos) as { cidade: string; lat: number; lon: number }[]
    if (lista.length === 0) return
    let cancelado = false
    void Promise.all(
      lista.map(async (l) => {
        const c = await buscarClimaAgora(l.lat, l.lon)
        return c ? { cidade: l.cidade, temp: c.temp, codigo: c.codigo } : null
      }),
    ).then((r) => {
      if (!cancelado) setEstado({ chave: alvos, itens: r.filter((x) => x !== null) })
    })
    return () => {
      cancelado = true
    }
  }, [alvos])

  return estado?.chave === alvos ? estado.itens : []
}

/** Clima do dia aberto, com os próximos dias em tiras e a previsão completa num modal. */
function ClimaDoDia({ cidade, chaveDia: chaveAlvo }: { cidade: string | null; chaveDia: string }) {
  const { lugar, previsoes, hoje } = usePrevisaoDoDia(cidade, chaveAlvo)
  const [verTudo, setVerTudo] = useState(false)
  if (!lugar || !hoje) return null

  const Icone = CODIGO_ICONE[hoje.codigo] ?? Cloud
  const chove = CODIGO_CHUVA.has(hoje.codigo)
  const indiceHoje = previsoes?.findIndex((p) => p.data === chaveAlvo) ?? -1
  const proximos = indiceHoje >= 0 ? (previsoes ?? []).slice(indiceHoje, indiceHoje + 4) : []

  return (
    <>
      <Cartao className="sem-impressao">
        <div className="flex items-center justify-between gap-2">
          <Rotulo>Clima em {String(lugar.cidade)}</Rotulo>
          {(previsoes?.length ?? 0) > proximos.length && (
            <button
              onClick={() => setVerTudo(true)}
              className="shrink-0 cursor-pointer text-[12px] font-medium"
              style={{ color: 'var(--destaque)' }}
            >
              Ver previsão completa
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <Icone size={30} strokeWidth={1.75} style={{ color: 'var(--destaque)' }} />
          <div className="min-w-0 flex-1">
            <p className="tab-num text-[26px] leading-none font-bold">
              {Math.round(hoje.tempMax)}°
            </p>
            <p className="mt-0.5 truncate text-[13px] text-(--color-tinta-3)">
              {descricaoClima(hoje.codigo)}
            </p>
          </div>
          <p className="tab-num shrink-0 text-right text-[13px] leading-tight text-(--color-tinta-3)">
            Máx. {Math.round(hoje.tempMax)}°
            <br />
            Mín. {Math.round(hoje.tempMin)}°
          </p>
        </div>
        {chove && (
          <p className="mt-3 flex items-start gap-1.5 border-t border-(--color-borda) pt-2.5 text-[13px] text-(--color-tinta-2)">
            <Umbrella size={14} className="mt-0.5 shrink-0 text-(--color-tinta-3)" />
            Previsão de chuva — leve uma capa ou guarda-chuva.
          </p>
        )}
        {proximos.length > 1 && (
          <div className="mt-3 grid grid-cols-4 gap-1.5 border-t border-(--color-borda) pt-3">
            {proximos.map((p) => {
              const IconeDia = CODIGO_ICONE[p.codigo] ?? Cloud
              return (
                <div
                  key={p.data}
                  className="rounded-xl bg-(--color-superficie-2) px-1.5 py-2 text-center"
                >
                  <p className="text-[11px] font-semibold text-(--color-tinta-2)">
                    {formatarData(p.data, { weekday: 'short' }).replace('.', '')}{' '}
                    {formatarData(p.data, { day: '2-digit' })}
                  </p>
                  <IconeDia
                    size={18}
                    className="mx-auto mt-1"
                    style={{ color: 'var(--destaque)' }}
                  />
                  <p className="tab-num mt-1 text-[11px] text-(--color-tinta-3)">
                    {Math.round(p.tempMax)}°/{Math.round(p.tempMin)}°
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </Cartao>

      {verTudo && (
        <AppModal titulo={`Previsão em ${String(lugar.cidade)}`} aoFechar={() => setVerTudo(false)}>
          <ul className="divide-y divide-(--color-borda)">
            {(previsoes ?? []).map((p) => {
              const IconeDia = CODIGO_ICONE[p.codigo] ?? Cloud
              return (
                <li key={p.data} className="flex items-center gap-3 py-2.5">
                  <IconeDia size={20} style={{ color: 'var(--destaque)' }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {formatarData(p.data, { weekday: 'long', day: '2-digit', month: 'short' })}
                    </span>
                    <span className="block text-[12px] text-(--color-tinta-3)">
                      {descricaoClima(p.codigo)}
                    </span>
                  </span>
                  <span className="tab-num shrink-0 text-sm text-(--color-tinta-3)">
                    {Math.round(p.tempMax)}° / {Math.round(p.tempMin)}°
                  </span>
                </li>
              )
            })}
          </ul>
        </AppModal>
      )}
    </>
  )
}

// ---------------------------------------------------------------- tipo especial do dia

/**
 * O tipo especial do dia, para o cabeçalho — "Dia de voo", "Dia de embarque"...
 *
 * Lido só do que já está cadastrado nas outras abas (`derivadas`), na mesma
 * lógica do resto da tela: nada é escrito à parte para o roteiro contar essa
 * história — só lido do que já existe.
 */
function tipoEspecialDoDia(derivadas: Derivada[]): { Icone: LucideIcon; rotulo: string } | null {
  const acha = (prefixo: string) => derivadas.some((d) => String(d.como.id).startsWith(prefixo))
  if (acha('embarque:')) return { Icone: Ship, rotulo: 'Dia de embarque' }
  if (acha('desembarque:')) return { Icone: Ship, rotulo: 'Dia de desembarque' }
  if (acha('porto:')) return { Icone: Ship, rotulo: 'Escala' }
  if (derivadas.some((d) => d.como.tipo === 'voo')) return { Icone: Plane, rotulo: 'Dia de voo' }
  if (acha('checkin:')) return { Icone: BedDouble, rotulo: 'Check-in' }
  if (acha('checkout:')) return { Icone: BedDouble, rotulo: 'Check-out' }
  return null
}

// ---------------------------------------------------------------- mapas

/**
 * Mapa do dia: as paradas do dia sobre o mapa e em lista, com a distância e o
 * tempo total de deslocamento no rodapé. Reaproveita o mesmo mapa (ladrilho
 * real + Mercator) do Início — só que numerado, porque aqui a sequência de
 * visita é a informação, não as pontas de início e fim de uma rota entre
 * cidades.
 *
 * A LISTA É O DIA INTEIRO; O MAPA É A PARTE QUE TEM COORDENADA. Listar só as
 * paradas localizadas fazia o cartão mentir por omissão: um pino, uma linha, e
 * as outras seis paradas do dia sumiam sem avisar que existiam. A parada sem
 * coordenada aparece na lista sem número — o número É o pino — e o rodapé conta
 * quantas faltam, que é a pergunta que leva ao botão de importar o KML.
 *
 * Sem nenhuma coordenada e sem cidade conhecida, o cartão não aparece.
 */
function MapaDoDia({ dia }: { dia: DiaRoteiro }) {
  const { snapshot, posso } = useTrip()
  const [ampliado, setAmpliado] = useState(false)
  const [importando, setImportando] = useState(false)
  const resumo = resumoDoDia(dia.itens)

  const paradas = dia.itens.map((e) => {
    const lat = e.lat != null ? Number(e.lat) : null
    const lon = e.lon != null ? Number(e.lon) : null
    return {
      titulo: String(e.titulo ?? e.local ?? ''),
      hora: formatarHora(paraCampo(e.ocorre_em)),
      modo: modoDoPonto(e),
      lat,
      lon,
      // O que se cola no Uber. O endereço quando existe; senão a coordenada,
      // que todo aplicativo de mapa aceita e é o que uma parada trazida de um
      // arquivo KML tem para oferecer. Uma linha só: duas caixas de copiar na
      // mesma parada viram a pergunta "qual das duas?" a cada toque.
      copiavel:
        String(e.endereco ?? '').trim() || (lat != null && lon != null ? `${lat}, ${lon}` : null),
      distancia: formatarDistancia(e.distancia_m),
      duracao: formatarDuracao(e.duracao_min),
    }
  })

  const localizadas = paradas.filter((p) => p.lat != null && p.lon != null)

  // Sem coordenada em NENHUM item, o mapa cai para as CIDADES do dia, na ordem
  // em que acontecem — a coordenada real que `lugares` já guarda. Não se
  // inventa um ponto por item a partir do centro da cidade: cinco pinos
  // empilhados no mesmo lugar seriam um mapa que mente sobre a distância entre
  // eles. Nesse caso os pinos não são numerados, porque não correspondem um a
  // um às linhas da lista.
  const lugares = (snapshot?.lugares as Record<string, any>[] | undefined) ?? []
  const porCidade = locaisDoDia(dia, snapshot)
    .cidades.map((c) => lugares.find((l) => mesmaCidade(l.cidade, c)))
    .filter((l) => l?.lat != null && l?.lon != null)
    .map((l) => ({ cidade: String(l!.cidade), lat: Number(l!.lat), lon: Number(l!.lon) }))

  const numerado = localizadas.length > 0
  const pinos = numerado
    ? localizadas.map((p) => ({ cidade: p.titulo, lat: p.lat!, lon: p.lon! }))
    : porCidade

  if (pinos.length === 0 || paradas.length === 0) return null

  // O número da linha é a posição do pino no mapa — quem não tem pino não tem
  // número, senão a lista contaria uma sequência que o mapa não mostra.
  let contador = 0
  const numeros = paradas.map((p) => (p.lat != null && p.lon != null ? ++contador : null))
  const semLocal = paradas.length - localizadas.length
  const podeEditar = posso('editor')

  return (
    <>
      <Cartao className="sem-impressao !p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5">
          <Rotulo>Mapa do dia</Rotulo>
          <Botao variante="secundario" tamanho="pequeno" onClick={() => setAmpliado(true)}>
            <Maximize2 size={13} /> Tela cheia
          </Botao>
        </div>
        <div className="h-56">
          <MapaRota lugares={pinos} numerados={numerado} />
        </div>

        {!numerado && (
          <p className="border-b border-(--color-borda) px-4 py-2 text-[12px] text-(--color-tinta-3)">
            Pinos pela cidade — nenhuma parada deste dia tem local exato.
          </p>
        )}

        {/* Uma linha por parada: o número dela no mapa, o que é e a que horas, o
            modo de chegar até ela e quanto custa em distância e tempo. */}
        <ol className="divide-y divide-(--color-borda)">
          {paradas.map((p, i) => {
            const numero = numeros[i]
            return (
              <li key={`${p.titulo}-${i}`} className="flex items-center gap-2.5 px-4 py-2.5">
                {/* Círculo vazio contra círculo cheio é a única marca de "sem local"
                    na linha: escrever isso em cada parada repetia a mesma
                    palavra seis vezes num cartão de sete linhas, e a contagem
                    no rodapé já ensina a ler o símbolo. */}
                {numero == null ? (
                  <span
                    title="Sem local no mapa"
                    className="h-[18px] w-[18px] shrink-0 rounded-full border border-dashed border-(--color-borda-forte)"
                  >
                    <span className="sr-only">Sem local no mapa</span>
                  </span>
                ) : (
                  <span
                    className="tab-num flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ background: 'var(--destaque)' }}
                  >
                    {numero}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{p.titulo}</span>
                  {p.hora && (
                    <span className="tab-num block text-[12px] text-(--color-tinta-3)">
                      {p.hora}
                    </span>
                  )}
                  {p.copiavel && (
                    <span className="mt-1 block">
                      <Copiar
                        valor={p.copiavel}
                        rotulo={`endereço de ${p.titulo}`}
                        variante="texto"
                      />
                    </span>
                  )}
                </span>
                {p.modo && (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-(--color-superficie-2)">
                    <p.modo.Icone size={14} className="text-(--color-tinta-3)" aria-hidden />
                    <span className="sr-only">{p.modo.nome}</span>
                  </span>
                )}
                <span className="tab-num w-14 shrink-0 text-right text-[12px] text-(--color-tinta-3)">
                  {p.distancia || p.duracao ? (
                    <>
                      {p.distancia && <span className="block">{p.distancia}</span>}
                      {p.duracao && <span className="block">{p.duracao}</span>}
                    </>
                  ) : (
                    <span aria-hidden>—</span>
                  )}
                </span>
              </li>
            )
          })}
        </ol>

        {(resumo.distanciaM > 0 || resumo.minutosDeslocamento > 0) && (
          <p className="flex items-baseline justify-between border-t border-(--color-borda) px-4 py-2.5 text-[12px]">
            <span className="text-(--color-tinta-3)">Total em deslocamento</span>
            <span className="tab-num font-semibold">
              {[formatarDistancia(resumo.distanciaM), formatarDuracao(resumo.minutosDeslocamento)]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </p>
        )}

        {/* A contagem é o que explica o botão ao lado: o mapa está incompleto e
            este é o caminho de fora dele. */}
        {(semLocal > 0 || podeEditar) && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-(--color-borda) px-4 py-2.5">
            <span className="text-[12px] text-(--color-tinta-3)">
              {semLocal > 0
                ? `${semLocal} de ${paradas.length} ${paradas.length === 1 ? 'parada' : 'paradas'} sem local no mapa`
                : `Todas as ${paradas.length} paradas com local no mapa`}
            </span>
            {podeEditar && (
              <button
                onClick={() => setImportando(true)}
                className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg text-[12px] font-medium transition-colors hover:underline"
                style={{ color: 'var(--destaque)' }}
              >
                <MapPin size={13} aria-hidden /> Localizar paradas
              </button>
            )}
          </div>
        )}

        {lugares.length > 1 && (
          <div className="border-t border-(--color-borda) p-2.5">
            <MapaGeralBotao />
          </div>
        )}
      </Cartao>

      {ampliado && (
        <AppModal titulo="Mapa do dia" tamanho="grande" aoFechar={() => setAmpliado(false)}>
          <div className="h-[60dvh]">
            <MapaRota lugares={pinos} numerados={numerado} />
          </div>
        </AppModal>
      )}

      {importando && <LocalizarParadasModal dia={dia} aoFechar={() => setImportando(false)} />}
    </>
  )
}

/** Saída do mapa do dia para o mapa da viagem inteira — cidade após cidade, sem
    numeração de visita. Mora no rodapé do cartão do mapa: é a mesma pergunta
    ("onde eu estou?") num zoom maior, não um assunto novo na coluna. */
function MapaGeralBotao() {
  const { snapshot } = useTrip()
  const [ampliado, setAmpliado] = useState(false)
  const lugares = (snapshot?.lugares ?? []) as Record<string, any>[]
  if (lugares.length < 2) return null

  return (
    <>
      <button
        onClick={() => setAmpliado(true)}
        className="toque flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-(--color-borda-forte) bg-(--color-cartao) px-3 text-[13px] font-medium text-(--color-tinta) transition-colors hover:bg-(--color-superficie-2)"
      >
        <IconeMapa size={14} /> Ver mapa geral da viagem
      </button>
      {ampliado && (
        <AppModal
          titulo="Mapa geral da viagem"
          tamanho="grande"
          aoFechar={() => setAmpliado(false)}
        >
          <div className="h-[60dvh]">
            <MapaRota lugares={snapshot?.lugares as any[]} />
          </div>
        </AppModal>
      )}
    </>
  )
}

/** Uma coordenada candidata para uma parada, com de onde ela veio. */
type Candidato = { id: string; nome: string; lat: number; lon: number; fonte: string }

/** Uma parada sem local, com o que já se sabe sobre onde ela pode ser. */
type LinhaLocal = {
  id: string
  chaveDia: string
  dia: string
  titulo: string
  hora: string
  consulta: string
  /** A consulta saiu de um campo de lugar, não raspada do título — só essas
      entram na busca em massa. */
  temLugar: boolean
  /** Já tem pino no mapa: a busca completa o endereço e não encosta na
      coordenada, que alguém pode ter posto na mão. */
  temPino: boolean
  temEndereco: boolean
  /** O que a busca no mapa devolveu para ESTA parada. */
  achados: Achado[]
  buscou: boolean
  buscando: boolean
  /** `a<i>` para ponto do arquivo, `b<j>` para achado da busca, '' para nenhum. */
  escolhido: string
}

/**
 * Localizar paradas: dar coordenada para os itens do roteiro que não têm, que é
 * o que decide se eles aparecem ou não no mapa do dia.
 *
 * DUAS ENTRADAS, UMA LISTA SÓ. O arquivo de mapa do Google (.kml/.kmz) e a busca
 * no OpenStreetMap alimentam o mesmo seletor por parada — são duas maneiras de
 * responder à mesma pergunta, e duas telas separadas fariam a pessoa escolher a
 * ferramenta antes de saber qual delas conhece o lugar dela.
 *
 * A LISTA É DE PARADAS, NÃO DE PONTOS DO ARQUIVO. O que se quer completar é o
 * roteiro; um ponto do arquivo que não casou com nada continua alcançável no
 * seletor de qualquer parada, então nada do arquivo se perde por causa de um
 * palpite de nome que errou.
 *
 * NADA É GRAVADO SEM ALGUÉM OLHAR. Nem o casamento por nome nem o primeiro
 * resultado do Nominatim são prova de lugar — os dois são palpite, e palpite que
 * vira coordenada sozinho põe o pino no lugar errado sem fazer barulho.
 */
function LocalizarParadasModal({ dia, aoFechar }: { dia: DiaRoteiro; aoFechar: () => void }) {
  const { snapshot, mutate } = useTrip()
  const avisar = useAviso()
  const [erro, setErro] = useState<string | null>(null)
  const [pontosArquivo, setPontosArquivo] = useState<PontoKml[]>([])
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null)
  const [linhas, setLinhas] = useState<LinhaLocal[]>(() => paradasSemLocal(snapshot))
  const [viagemToda, setViagemToda] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [progresso, setProgresso] = useState<{ feito: number; total: number } | null>(null)

  // A tela pode fechar no meio de uma varredura de vinte buscas; sem isto o
  // laço continua rodando e escrevendo estado num componente que já saiu.
  //
  // O `true` é remarcado NA MONTAGEM, não só na declaração do ref: em modo
  // estrito o React monta, desmonta e remonta: a limpeza da primeira passagem
  // deixaria `vivo` em falso para sempre, e toda busca voltaria sem efeito.
  const vivo = useRef(true)
  useEffect(() => {
    vivo.current = true
    return () => {
      vivo.current = false
    }
  }, [])

  const mexer = (id: string, mudanca: Partial<LinhaLocal>) =>
    setLinhas((atual) => atual.map((l) => (l.id === id ? { ...l, ...mudanca } : l)))

  const doDia = linhas.filter((l) => l.chaveDia === dia.chave)
  const visiveis = viagemToda ? linhas : doDia
  const escolhidas = linhas.filter((l) => mudancasDe(l, pontosArquivo))

  async function carregarArquivo(arquivo: File) {
    setErro(null)
    let pontos: PontoKml[]
    try {
      pontos = await lerArquivoDeMapa(arquivo)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui ler este arquivo de mapa.')
      return
    }
    if (pontos.length === 0) {
      setErro('Nenhum lugar neste arquivo — confira se a camada exportada tem pontos marcados.')
      return
    }

    // O casamento corre sobre a viagem inteira, não sobre o dia aberto: um mapa
    // do My Maps cobre a viagem toda, e casar dia a dia seria subir o mesmo
    // arquivo dezessete vezes.
    const palpite = casarPontos(
      pontos,
      linhas.map((l) => ({ id: l.id, texto: l.consulta + ' ' + l.titulo })),
    )
    const porParada = new Map(
      palpite.flatMap((idParada, i) => (idParada ? [[idParada, `a${i}`] as const] : [])),
    )

    setPontosArquivo(pontos)
    setNomeArquivo(arquivo.name)
    setLinhas((atual) =>
      atual.map((l) => (porParada.has(l.id) ? { ...l, escolhido: porParada.get(l.id)! } : l)),
    )
    // O arquivo fala da viagem inteira; esconder atrás do filtro do dia o que
    // ele acabou de casar seria gravar em silêncio o que ninguém viu.
    setViagemToda(true)
  }

  async function buscar(linha: LinhaLocal) {
    mexer(linha.id, { buscando: true })
    const achados = await buscarLugar(linha.consulta)
    if (!vivo.current) return
    mexer(linha.id, {
      achados,
      buscou: true,
      buscando: false,
      // O primeiro resultado entra escolhido para o caso fácil não virar dois
      // cliques — e continua trocável, com o nome completo à vista.
      ...(achados.length > 0 && !linha.escolhido ? { escolhido: 'b0' } : {}),
    })
  }

  /** Varre as paradas que ainda não têm palpite. Só as que têm campo de lugar:
      buscar um título como "Volta a pé para o hotel" devolve um lugar qualquer,
      e um lugar qualquer é pior do que nenhum. */
  async function buscarTodas() {
    const alvos = visiveis.filter((l) => !l.escolhido && l.temLugar)
    setProgresso({ feito: 0, total: alvos.length })
    for (const [i, l] of alvos.entries()) {
      if (!vivo.current) return
      await buscar(l)
      setProgresso({ feito: i + 1, total: alvos.length })
    }
    if (vivo.current) setProgresso(null)
  }

  async function gravar() {
    setOcupado(true)
    setErro(null)
    const ts = agora()
    let feito = 0
    try {
      for (const l of escolhidas) {
        const campos = mudancasDe(l, pontosArquivo)
        if (!campos) continue
        await mutate({ op: 'editar', entidade: 'roteiro', id: l.id, campos, client_ts: ts })
        feito++
        setProgresso({ feito, total: escolhidas.length })
      }
      avisar('sucesso', `${feito} ${feito === 1 ? 'parada gravada' : 'paradas gravadas'}.`)
      aoFechar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falhou ao gravar os locais. Tente de novo.')
    } finally {
      setOcupado(false)
      setProgresso(null)
    }
  }

  const chip = (ligado: boolean) =>
    `toque cursor-pointer rounded-xl border px-3 text-[13px] font-medium transition-colors ${
      ligado
        ? 'border-transparent text-white'
        : 'border-(--color-borda-forte) bg-(--color-cartao) text-(--color-tinta) hover:bg-(--color-superficie-2)'
    }`

  // O cabeçalho de dia sai calculado antes do JSX: contar "mudou o dia?" com uma
  // variável que o próprio map reatribui é estado escondido dentro do render.
  const comCabecalho = visiveis.map((l, i) => ({
    linha: l,
    cabecalho: viagemToda && (i === 0 || visiveis[i - 1].dia !== l.dia) ? l.dia : null,
  }))

  return (
    <AppModal
      titulo="Localizar paradas"
      descricao="Toda parada com local vira um pino no mapa do dia. Busque pelo nome ou traga os pontos de um mapa do Google — nada é gravado antes de você conferir."
      tamanho="grande"
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="secundario" onClick={aoFechar} desabilitado={ocupado}>
            Fechar
          </Botao>
          <Botao onClick={gravar} carregando={ocupado} desabilitado={escolhidas.length === 0}>
            {ocupado && progresso
              ? `Gravando… ${progresso.feito}/${progresso.total}`
              : `Gravar ${escolhidas.length} ${escolhidas.length === 1 ? 'parada' : 'paradas'}`}
          </Botao>
        </>
      }
    >
      {erro && (
        <p className="mb-3 flex items-start gap-2 rounded-xl bg-(--color-perigo-bg) px-3 py-2 text-sm text-(--color-perigo-ink)">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {erro}
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="toque inline-flex cursor-pointer items-center gap-2 rounded-xl border border-(--color-borda-forte) px-3 text-[13px] font-medium">
          <Upload size={15} /> {nomeArquivo ?? 'Importar mapa (KML/KMZ)'}
          <input
            type="file"
            accept=".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              await carregarArquivo(f)
              e.target.value = ''
            }}
          />
        </label>
        <Botao
          variante="secundario"
          tamanho="pequeno"
          onClick={buscarTodas}
          desabilitado={Boolean(progresso) || ocupado}
        >
          <Search size={14} />
          {progresso && !ocupado
            ? `Buscando… ${progresso.feito}/${progresso.total}`
            : 'Buscar as que faltam'}
        </Botao>
      </div>

      {pontosArquivo.length > 0 && (
        <p className="mb-4 text-[13px] text-(--color-tinta-3)">
          {pontosArquivo.length} {pontosArquivo.length === 1 ? 'lugar' : 'lugares'} no arquivo. Os
          que não casaram com nenhuma parada continuam na lista de cada uma.
        </p>
      )}

      <div className="mb-4 flex gap-2">
        <button
          className={chip(!viagemToda)}
          style={viagemToda ? undefined : { background: 'var(--destaque)' }}
          onClick={() => setViagemToda(false)}
        >
          Só este dia ({doDia.length})
        </button>
        <button
          className={chip(viagemToda)}
          style={viagemToda ? { background: 'var(--destaque)' } : undefined}
          onClick={() => setViagemToda(true)}
        >
          Viagem inteira ({linhas.length})
        </button>
      </div>

      {visiveis.length === 0 && (
        <p className="py-6 text-center text-sm text-(--color-tinta-3)">
          {linhas.length === 0
            ? 'Todas as paradas da viagem já estão no mapa.'
            : 'Todas as paradas deste dia já estão no mapa.'}
        </p>
      )}

      <ul className="space-y-2 pb-2">
        {comCabecalho.map(({ linha, cabecalho }) => (
          <li key={linha.id}>
            {cabecalho && (
              <div className="mt-4 mb-2 first:mt-0">
                <Rotulo>{cabecalho}</Rotulo>
              </div>
            )}
            <LinhaParada
              linha={linha}
              arquivo={pontosArquivo}
              aoMudar={(m) => mexer(linha.id, m)}
              aoBuscar={() => buscar(linha)}
            />
          </li>
        ))}
      </ul>
    </AppModal>
  )
}

/** As paradas da viagem que não têm coordenada, na ordem do roteiro. */
function paradasSemLocal(snapshot: Record<string, unknown> | null | undefined): LinhaLocal[] {
  return (
    ((snapshot?.roteiro ?? []) as Record<string, unknown>[])
      // Falta pino OU falta endereço. O endereço é o que se cola no aplicativo de
      // carro, então uma parada com pino e sem endereço continua pela metade — e
      // sem entrar nesta lista não haveria por onde completá-la.
      .filter((e) => e.lat == null || e.lon == null || !String(e.endereco ?? '').trim())
      .map((e) => {
        const quando = paraCampo(e.ocorre_em)
        return {
          temPino: e.lat != null && e.lon != null,
          temEndereco: Boolean(String(e.endereco ?? '').trim()),
          id: String(e.id),
          chaveDia: chaveDia(quando) ?? '',
          dia: formatarData(quando, { weekday: 'short', day: '2-digit', month: 'short' }),
          titulo: String(e.titulo ?? e.local ?? ''),
          hora: formatarHora(quando),
          consulta: consultaDaParada(e),
          temLugar: temCampoDeLugar(e),
          achados: [],
          buscou: false,
          buscando: false,
          escolhido: '',
        }
      })
  )
}

/**
 * O que esta linha grava — `null` quando não grava nada.
 *
 * Coordenada só entra em parada que ainda não tem pino: a busca aqui existe
 * para completar, nunca para mudar em silêncio um lugar que alguém já acertou.
 *
 * Endereço só sai de resultado de BUSCA. O nome de um ponto de KML é um rótulo
 * que a pessoa escreveu no mapa dela ("Hotel", "Jantar") — colar isso num
 * aplicativo de carro não leva ninguém a lugar nenhum.
 */
function mudancasDe(
  linha: LinhaLocal,
  arquivo: PontoKml[],
): { lat?: number; lon?: number; endereco?: string } | null {
  const i = Number(linha.escolhido.slice(1))
  const doArquivo = linha.escolhido.startsWith('a') ? (arquivo[i] ?? null) : null
  const daBusca = linha.escolhido.startsWith('b') ? (linha.achados[i] ?? null) : null
  const achado = doArquivo ?? daBusca
  if (!achado) return null

  const campos: { lat?: number; lon?: number; endereco?: string } = {}
  if (!linha.temPino) {
    campos.lat = achado.lat
    campos.lon = achado.lon
  }
  if (!linha.temEndereco && daBusca) campos.endereco = daBusca.nome
  return Object.keys(campos).length > 0 ? campos : null
}

/** Uma parada da lista: o que ela é, o texto que vai ao mapa, e de onde sai a
    coordenada dela. */
function LinhaParada({
  linha,
  arquivo,
  aoMudar,
  aoBuscar,
}: {
  linha: LinhaLocal
  arquivo: PontoKml[]
  aoMudar: (m: Partial<LinhaLocal>) => void
  aoBuscar: () => void
}) {
  const candidatos: Candidato[] = [
    ...linha.achados.map((a, j) => ({ id: `b${j}`, ...a, fonte: 'mapa' })),
    ...arquivo.map((p, i) => ({
      id: `a${i}`,
      nome: p.nome || 'Lugar sem nome',
      lat: p.lat,
      lon: p.lon,
      fonte: 'arquivo',
    })),
  ]
  const escolhido = candidatos.find((c) => c.id === linha.escolhido)

  return (
    <div className="rounded-xl border border-(--color-borda) p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{linha.titulo}</span>
        <span className="tab-num shrink-0 text-[12px] text-(--color-tinta-3)">{linha.hora}</span>
      </div>

      {linha.temPino && (
        <p className="mt-1 text-[12px] text-(--color-tinta-3)">
          Já tem pino no mapa — a busca preenche só o endereço.
        </p>
      )}

      <div className="mt-2 flex gap-2">
        <input
          value={linha.consulta}
          onChange={(e) => aoMudar({ consulta: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), aoBuscar())}
          placeholder="Nome ou endereço do lugar"
          aria-label={`Onde fica "${linha.titulo}"`}
          className={`toque ${CLASSE_CAMPO}`}
        />
        <Botao
          variante="secundario"
          onClick={aoBuscar}
          carregando={linha.buscando}
          desabilitado={linha.consulta.trim().length < 3}
        >
          {!linha.buscando && <Search size={15} />}
          <span className="sr-only">Buscar no mapa</span>
        </Botao>
      </div>

      {candidatos.length > 0 && (
        <div className="mt-2">
          <Selecao
            compacto
            rotulo={`Local de "${linha.titulo}"`}
            valor={linha.escolhido}
            aoMudar={(v) => aoMudar({ escolhido: v })}
            opcoes={[
              { valor: '', nome: linha.temPino ? 'Deixar sem endereço' : 'Deixar sem local' },
              ...candidatos.map((c) => ({
                valor: c.id,
                // A origem escrita por extenso, não por emoji: um ícone dentro
                // de <option> depende da fonte do sistema e some em metade dos
                // aparelhos — e é ele que diz se a coordenada veio do arquivo
                // de alguém ou de um palpite de busca.
                nome: `${c.fonte === 'arquivo' ? 'Do arquivo' : 'Do mapa'}: ${c.nome}`,
              })),
            ]}
          />
        </div>
      )}

      {escolhido && (
        <p className="tab-num mt-1.5 text-[12px] text-(--color-tinta-3)">
          {escolhido.lat.toFixed(4)}, {escolhido.lon.toFixed(4)}
        </p>
      )}

      {linha.buscou && linha.achados.length === 0 && (
        <p className="mt-1.5 text-[12px] text-(--color-tinta-3)">
          Nada encontrado. Tente o nome do lugar como ele aparece no mapa, com a cidade.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- informações e gastos

/**
 * Tudo que o dia É, abaixo do mapa: os fatos da viagem que valem hoje (moeda, a
 * dica do topo de "Atenção hoje") e, na sequência, a ficha completa de cada
 * atividade — endereço, como chegar, dicas, reserva, custo — sem clicar em nada.
 *
 * Os dois eram telas separadas ("Informações do dia" num cartão no canto,
 * "Detalhes" atrás de uma aba) e respondiam à mesma pergunta: o que eu preciso
 * saber sobre hoje. Separados, quem lia um achava que tinha lido o dia inteiro.
 *
 * Idioma, voltagem e fuso do destino ficam de fora: não têm coluna no banco, e
 * deduzir do nome da cidade é o tipo de chute que o resto do app se recusa a dar.
 */
function InformacoesDoDia({
  dia,
  moeda,
  posso,
}: {
  dia: DiaRoteiro
  moeda: string
  posso: (minimo: Papel) => boolean
}) {
  const { snapshot } = useTrip()
  const dica = linhas(dia.meta?.alertas)[0] ?? null
  const derivadas = useMemo(() => entradasDerivadas(dia, snapshot), [dia, snapshot])
  const linha = useMemo(() => montarLinha(dia, derivadas), [dia, derivadas])

  return (
    <section>
      <h2 className="t-legenda mb-2">Informações do dia</h2>

      <Cartao>
        <div className="flex items-center justify-between gap-3 py-1 text-sm">
          <span className="flex items-center gap-2 text-(--color-tinta-3)">
            <Wallet size={14} /> Moeda
          </span>
          <span className="font-medium">{nomeMoeda(moeda)}</span>
        </div>
        {dica && (
          <p className="mt-2 flex items-start gap-2 border-t border-(--color-borda) pt-3 text-[13px] text-(--color-tinta-2)">
            <Lightbulb size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--destaque)' }} />
            <span>
              <span className="font-semibold">Dica do dia · </span>
              {dica}
            </span>
          </p>
        )}
      </Cartao>

      {linha.length > 0 && (
        <div className="mt-3 space-y-3">
          {linha.map((l, i) => {
            const tipo = String(l.item.tipo ?? 'passeio')
            const Icone = ICONE[tipo] ?? MapPin
            const tom = tomIcone(tipo)
            return (
              <Cartao key={String(l.item.id ?? `d${i}`)}>
                <div className="flex items-start gap-3">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: tom.bg }}
                  >
                    <Icone size={16} style={{ color: tom.ink }} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="tab-num text-[12px] font-semibold text-(--color-tinta-3)">
                      {formatarHora(l.item.ocorre_em) || '—'}
                    </p>
                    <p className="font-medium">{String(l.item.titulo)}</p>
                  </div>
                  <Badge tipo={tipo} />
                </div>
                {itemTemDetalhe(l.item, l.derivada) ? (
                  <DetalheItem
                    item={l.item}
                    derivada={l.derivada}
                    moeda={moeda}
                    podeEditar={posso('editor') && !l.derivada}
                  />
                ) : (
                  <p className="mt-3 border-t border-(--color-borda) pt-3 text-[13px] text-(--color-tinta-3)">
                    Sem detalhes adicionais para esta atividade.
                  </p>
                )}
              </Cartao>
            )
          })}
        </div>
      )}
    </section>
  )
}

/**
 * Como se anda no dia: um trecho por parada com deslocamento cadastrado, com o
 * modo, a distância, o tempo e as opções de "como chegar", mais o total por
 * modo no topo.
 *
 * Sai inteiro dos itens do roteiro — não existe tabela de transporte, e criar
 * uma duplicaria o horário que já vive no item.
 */
function TransportesDoDia({ dia }: { dia: DiaRoteiro }) {
  const resumo = resumoDoDia(dia.itens)
  const trechos = dia.itens.filter(
    (e) =>
      e.transporte ||
      e.como_chegar ||
      Number(e.distancia_m) > 0 ||
      Number(e.duracao_min) > 0 ||
      ((e.opcoes ?? []) as unknown[]).length > 0,
  )

  if (trechos.length === 0) {
    return (
      <Nada>
        Sem deslocamento hoje. Preencha “Como se chega aqui”, a distância ou a duração de uma
        atividade e o trecho aparece aqui.
      </Nada>
    )
  }

  return (
    <Cartao className="overflow-hidden !p-0">
      {resumo.porModo.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-(--color-borda) p-3">
          {resumo.porModo.map((m) => {
            const IconeModo = ICONE_MODO[m.modo] ?? Route
            return (
              <span
                key={m.modo}
                className="flex items-center gap-1.5 rounded-xl bg-(--color-superficie-2) px-2.5 py-1.5 text-[12px]"
              >
                <IconeModo size={13} className="text-(--color-tinta-3)" aria-hidden />
                <span className="font-medium">{NOME_MODO[m.modo] ?? m.modo}</span>
                <span className="tab-num text-(--color-tinta-3)">
                  {[
                    m.vezes > 1 ? `${m.vezes}×` : null,
                    formatarDistancia(m.distanciaM),
                    formatarDuracao(m.minutos),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
            )
          })}
        </div>
      )}

      <ul className="divide-y divide-(--color-borda)">
        {trechos.map((e, i) => {
          const modo = modoDoPonto(e)
          const Icone = modo?.Icone ?? Route
          const opcoes = (e.opcoes ?? []) as Record<string, any>[]
          const numeros =
            [
              formatarHora(paraCampo(e.ocorre_em)),
              formatarDistancia(e.distancia_m),
              formatarDuracao(e.duracao_min),
            ]
              .filter(Boolean)
              .join(' · ') || modo?.nome
          return (
            <li key={String(e.id ?? `t${i}`)} className="p-3.5">
              <div className="flex items-start gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-(--color-superficie-2)">
                  <Icone size={15} className="text-(--color-tinta-3)" aria-hidden />
                  {modo && <span className="sr-only">{modo.nome}</span>}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">
                    até {String(e.titulo ?? e.local ?? 'próxima parada')}
                  </p>
                  {numeros && (
                    <p className="tab-num text-[12px] text-(--color-tinta-3)">{numeros}</p>
                  )}
                </div>
              </div>

              {/* `transporte` é texto livre — "Via BR-101", "metrô U3". Serve de
                  legenda do trecho, nunca de chave de ícone. */}
              {e.transporte && (
                <p className="mt-1.5 pl-[42px] text-[13px] text-(--color-tinta-2)">
                  {String(e.transporte)}
                </p>
              )}
              {e.como_chegar && (
                <p className="mt-1 pl-[42px] text-[13px] text-(--color-tinta-2)">
                  {String(e.como_chegar)}
                </p>
              )}

              {opcoes.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5 pl-[42px]">
                  {opcoes.map((o) => {
                    const IconeOpcao = ICONE_MODO[String(o.modo)] ?? Route
                    return (
                      <span
                        key={String(o.id)}
                        className="flex items-center gap-1.5 rounded-lg border border-(--color-borda) px-2 py-1 text-[12px]"
                        style={
                          o.recomendado
                            ? {
                                borderColor: 'var(--color-destaque-fraco)',
                                background: 'var(--color-destaque-tenue)',
                              }
                            : undefined
                        }
                      >
                        <IconeOpcao size={12} className="text-(--color-tinta-3)" aria-hidden />
                        <span className="font-medium">
                          {NOME_MODO[String(o.modo)] ?? String(o.modo)}
                        </span>
                        <span className="tab-num text-(--color-tinta-3)">
                          {[
                            formatarDuracao(o.duracao_min),
                            formatarDistancia(o.distancia_m),
                            o.custo,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        {o.recomendado && (
                          <Star
                            size={11}
                            style={{ color: 'var(--destaque)' }}
                            aria-label="recomendado"
                          />
                        )}
                      </span>
                    )
                  })}
                </div>
              )}
            </li>
          )
        })}
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

// ---------------------------------------------------------------- checklist e rituais do dia

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
        {/* A seção lá fora já diz "Checklist do dia"; aqui o rótulo diz QUAL
            recorte é este cartão, senão o mesmo título aparece duas vezes. */}
        <Rotulo>Com prazo hoje</Rotulo>
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

// ---------------------------------------------------------------- faixa de dias (rodapé)

/** A navegação de dias do rodapé: setas + a faixa rolável, com o dia aberto sempre centralizado. */
function FaixaDias({
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

  const anterior = dias[indice - 1] ?? null
  const proximo = dias[indice + 1] ?? null

  return (
    <div className="sem-impressao mt-4 flex items-center gap-1.5">
      <BotaoIcone
        rotulo="Dia anterior"
        desabilitado={!anterior}
        onClick={() => anterior && aoEscolher(anterior.chave)}
      >
        <ChevronLeft size={17} />
      </BotaoIcone>

      <div
        ref={faixa}
        role="tablist"
        aria-label="Dias da viagem"
        className="flex min-w-0 flex-1 snap-x snap-mandatory gap-2 overflow-x-auto px-1 py-1"
      >
        {dias.map((d, i) => {
          const ativo = i === indice
          const ehHoje = d.chave === chaveHoje
          const passado = chaveHoje !== null && d.chave < chaveHoje
          const ancora = Boolean(d.meta?.ancora)
          // O rótulo útil na tira é onde o dia TERMINA: é a cidade em que se dorme.
          const onde = locaisDoDia(d, null)
          const rotuloLocal = onde.destino ?? onde.cidade ?? ''
          return (
            <button
              key={d.chave}
              role="tab"
              aria-selected={ativo}
              // O nome acessível é montado aqui porque o conteúdo do botão são
              // fragmentos visuais que um leitor de tela soletraria como coisas soltas.
              aria-label={[
                formatarData(d.chave, { day: '2-digit', month: 'long', weekday: 'long' }),
                rotuloLocal,
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
              className={`relative w-[5.25rem] shrink-0 snap-start cursor-pointer rounded-2xl border px-2 py-2.5 text-center transition-colors ${
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
                {formatarData(d.chave, { weekday: 'short' }).replace('.', '')}
              </span>
              <span
                className={`mt-0.5 block truncate text-[11px] ${ativo ? '' : 'text-(--color-tinta-3)'}`}
              >
                {rotuloLocal}
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

      <BotaoIcone
        rotulo="Próximo dia"
        desabilitado={!proximo}
        onClick={() => proximo && aoEscolher(proximo.chave)}
      >
        <ChevronRight size={17} />
      </BotaoIcone>
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

/** Comparação de cidade por nome — o único elo entre um item do roteiro e a
    linha de `lugares`, que é onde moram a coordenada e o país. */
function mesmaCidade(a: unknown, b: unknown): boolean {
  const n = (v: unknown) =>
    String(v ?? '')
      .trim()
      .toLowerCase()
  return n(a) !== '' && n(a) === n(b)
}

/**
 * Onde o dia acontece.
 *
 * `itinerary_days` guarda só o que alguém ESCREVEU sobre um dia — e a maioria
 * das viagens nunca escreve uma linha lá. Sem cair para a cidade dos próprios
 * itens, uma viagem inteira já cadastrada abre com cabeçalho sem lugar, sem
 * clima e sem mapa. Cidades repetidas em sequência viram uma só: o que
 * interessa é o trajeto do dia (Itajaí → Santiago), não quantas paradas cada
 * cidade teve.
 *
 * O país nunca é adivinhado a partir do nome da cidade — sai de `lugares`, que
 * já guarda cidade, país e coordenada na mesma linha, ou não sai.
 */
function locaisDoDia(
  dia: DiaRoteiro,
  snapshot: ReturnType<typeof useTrip>['snapshot'],
): { cidades: string[]; cidade: string | null; destino: string | null; pais: string | null } {
  const lugares = (snapshot?.lugares as Record<string, any>[] | undefined) ?? []
  const paisDe = (cidade: string | null) =>
    cidade ? (lugares.find((l) => mesmaCidade(l.cidade, cidade))?.pais ?? null) : null

  const cidades: string[] = dia.meta?.cidade ? [String(dia.meta.cidade)] : []
  if (cidades.length === 0) {
    for (const e of dia.itens) {
      const c = String(e.cidade ?? '').trim()
      if (c && !mesmaCidade(cidades[cidades.length - 1], c)) cidades.push(c)
    }
  }

  const cidade = cidades[0] ?? null
  const destino = cidades.length > 1 ? (cidades[cidades.length - 1] ?? null) : null
  const pais = dia.meta?.pais ? String(dia.meta.pais) : paisDe(destino ?? cidade)
  return { cidades, cidade, destino, pais: pais ? String(pais) : null }
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
