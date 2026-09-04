'use client'

// Cartão de viagem usado no Início e em Minhas viagens. Existe uma vez para que
// as duas telas não descrevam a mesma viagem de dois jeitos diferentes.
import type { ReactNode } from 'react'
import Link from 'next/link'
import { CalendarDays, Users, Globe, ChevronRight, type LucideIcon } from 'lucide-react'
import { faseDaViagem, formatarData, formatarRelativo, statusViagem } from '@/lib/derive.ts'
import type { StatusViagem } from '@/lib/derive.ts'
import { CapaViagem } from './CapaViagem.tsx'
import { Badge, Progresso } from './ui.tsx'

export type ViagemResumo = {
  id: string
  nome: string
  subtitulo?: string | null
  descricao?: string | null
  data_partida: string
  data_retorno: string
  moeda?: string
  cor_destaque?: string
  capa_url?: string | null
  arquivada?: boolean
  papel?: 'proprietario' | 'editor' | 'visualizador'
  participantes: number
  /** Contagens vindas de /api/viagens. Ausentes só em respostas antigas. */
  cidades?: number
  paises?: number
  compromissos?: number
  reservas?: number
  tarefas?: number
  tarefas_feitas?: number
  atualizada_em?: string
  /** Cidades e países da viagem, concatenados. Só a busca lê isto. */
  destinos?: string | null
}

/** Rótulo e tom de cada status. Os tons são pares ink/bg já medidos em ui.tsx. */
export const ROTULO_STATUS: Record<StatusViagem, { texto: string; tom: string }> = {
  planejando: { texto: 'Planejando', tom: 'info' },
  proxima: { texto: 'Próxima', tom: 'sucesso' },
  andamento: { texto: 'Em andamento', tom: 'atencao' },
  concluida: { texto: 'Concluída', tom: 'neutro' },
  arquivada: { texto: 'Arquivada', tom: 'neutro' },
}

/** A frase de contagem: o que muda de um cartão para o outro. */
export function contagem(v: ViagemResumo): string {
  const f = faseDaViagem(new Date(), v.data_partida, v.data_retorno)
  if (f.fase === 'durante') return `Dia ${f.diaAtual} de ${f.totalDias}`
  if (f.fase === 'depois') return `${f.totalDias} ${f.totalDias === 1 ? 'dia' : 'dias'} de viagem`
  if (f.diasRestantes === 0) return 'Parte hoje'
  return `Faltam ${f.diasRestantes} ${f.diasRestantes === 1 ? 'dia' : 'dias'}`
}

export function periodo(v: ViagemResumo): string {
  return `${formatarData(v.data_partida, { day: '2-digit', month: 'short' })} — ${formatarData(
    v.data_retorno,
    { day: '2-digit', month: 'short', year: 'numeric' },
  )}`
}

export function CartaoViagem({
  viagem,
  acoes,
  href,
}: {
  viagem: ViagemResumo
  /** Menu de ações, ancorado no canto da capa. */
  acoes?: React.ReactNode
  href?: string
}) {
  // A capa não usa mais `cor_destaque`: era o último lugar do sistema onde a
  // cor da viagem ainda pintava a interface, e o redesign editorial é
  // monocromático por definição (cor sobra só para o mapa e o pêssego — ver
  // nota em app/globals.css § --destaque). O horizonte gerado continua vivo,
  // só que sempre no mesmo cinza neutro, como qualquer outro card do sistema.
  const cor = '#9a9a9c'
  const status = statusViagem(
    new Date(),
    viagem.data_partida,
    viagem.data_retorno,
    viagem.arquivada,
  )
  const rotulo = ROTULO_STATUS[status]
  const f = faseDaViagem(new Date(), viagem.data_partida, viagem.data_retorno)
  const total = viagem.tarefas ?? 0
  const pct = total > 0 ? Math.round(((viagem.tarefas_feitas ?? 0) / total) * 100) : null

  return (
    // O único movimento do cartão: 2px para cima com a sombra abrindo junto,
    // 200ms. É resposta a um gesto da pessoa, não enfeite — diz "isto abre".
    // `transition-[box-shadow,translate]` e não `transition-all`: só estas duas
    // o navegador compõe na GPU, e `all` faria a altura do cartão animar quando
    // o texto muda. `prefers-reduced-motion` zera a duração em globals.css, e aí
    // a sombra ainda muda — o retorno visual nunca depende só do movimento.
    <div className="group relative flex flex-col overflow-hidden rounded-3xl border border-(--color-borda) bg-(--color-cartao) shadow-[var(--sombra-1)] transition-[box-shadow,translate] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--sombra-2)]">
      <Link href={href ?? `/viagens/${viagem.id}`} className="flex flex-1 flex-col">
        {/* A capa não tem texto em cima: assim nenhum contraste depende da arte. */}
        <div className="relative h-24 shrink-0 overflow-hidden">
          <CapaViagem cor={cor} semente={viagem.id} url={viagem.capa_url} />
        </div>

        <div className="flex flex-1 flex-col p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="t-cartao truncate text-base">{viagem.nome}</p>
              {viagem.subtitulo && <p className="t-aux truncate">{String(viagem.subtitulo)}</p>}
            </div>
            <Badge tipo={rotulo.tom} texto={rotulo.texto} />
          </div>

          {/* UMA COLUNA DE ÍCONES, não ícones soltos no meio do texto.
              Cada linha é `[ícone de 16px] [texto]` com o mesmo recuo, então os
              três ícones se alinham verticalmente e os três textos começam no
              mesmo x. Antes cada linha usava um gap diferente (2, 2, 1.5) e a
              segunda enfileirava dois pares ícone+texto na mesma linha, o que
              punha o globo num x que dependia de quantos participantes a viagem
              tinha. */}
          <ul className="space-y-1.5 text-sm text-(--color-tinta-2)">
            <LinhaMeta Icone={CalendarDays} numerico>
              {periodo(viagem)}
              {f.totalDias > 0 && (
                <span className="text-(--color-tinta-3)"> · {f.totalDias} dias</span>
              )}
            </LinhaMeta>
            <LinhaMeta Icone={Users}>
              {viagem.participantes} {viagem.participantes === 1 ? 'participante' : 'participantes'}
            </LinhaMeta>
            {(viagem.paises ?? 0) > 0 && (
              <LinhaMeta Icone={Globe}>
                {viagem.paises} {viagem.paises === 1 ? 'país' : 'países'}
                {(viagem.cidades ?? 0) > 0 && (
                  <span className="text-(--color-tinta-3)">
                    {' '}
                    · {viagem.cidades} {viagem.cidades === 1 ? 'cidade' : 'cidades'}
                  </span>
                )}
              </LinhaMeta>
            )}
          </ul>

          {pct !== null && (
            <div className="mt-3">
              <div className="mb-1 flex items-baseline justify-between text-[12px] text-(--color-tinta-3)">
                <span>Preparação</span>
                <span className="tab-num font-semibold text-(--color-tinta-2)">{pct}%</span>
              </div>
              <Progresso pct={pct} rotulo={`Preparação de ${viagem.nome}`} />
            </div>
          )}

          {/* `mt-auto` empurra o rodapé para baixo: numa fileira de três cartões
              a grade já os deixa da mesma altura, mas sem isto o "Faltam 118
              dias" flutuava no meio do cartão mais curto e no pé do mais alto —
              três cartões iguais com a mesma informação em três alturas. */}
          <div className="mt-auto flex items-end justify-between gap-2 pt-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{contagem(viagem)}</p>
              {viagem.atualizada_em && (
                <p className="text-[12px] text-(--color-tinta-3)">
                  Atualizada {formatarRelativo(viagem.atualizada_em)}
                </p>
              )}
            </div>
            <ChevronRight
              size={18}
              className="shrink-0 text-(--color-tinta-3) transition-transform group-hover:translate-x-0.5"
            />
          </div>
        </div>
      </Link>

      {acoes &&<div className="absolute top-3 right-3 flex gap-1">{acoes}</div>}
    </div>
  )
}

/**
 * Uma linha de metadado do cartão: ícone numa caixa fixa, texto ao lado.
 *
 * A caixa de 16px é o que faz a coluna de ícones existir. `items-start` com um
 * `mt-px` no ícone, e não `items-center`: quando o texto quebra em duas linhas o
 * ícone tem de ficar junto da PRIMEIRA, senão ele desce para o meio do parágrafo
 * e sai da coluna — que é exatamente o caso de um nome de cidade longo num
 * cartão estreito.
 */
function LinhaMeta({
  Icone,
  numerico,
  children,
}: {
  Icone: LucideIcon
  /** Datas e contagens: dígitos de largura fixa, para não dançarem entre cartões. */
  numerico?: boolean
  children: ReactNode
}) {
  return (
    <li className={`flex items-start gap-2.5 ${numerico ? 'tab-num' : ''}`}>
      <Icone
        size={16}
        strokeWidth={1.75}
        aria-hidden
        className="mt-px shrink-0 text-(--color-tinta-3)"
      />
      <span className="min-w-0">{children}</span>
    </li>
  )
}
