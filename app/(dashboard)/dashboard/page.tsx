'use client'

// Início — a casa da CONTA, não de uma viagem.
//
// A pergunta que esta tela responde é "quais são minhas viagens e o que eu quero
// fazer agora?". Ela mostra a próxima aventura, os números dela e os caminhos de
// volta; o detalhe de cada seção mora dentro da viagem, em /viagens/:id. Se uma
// informação só faz sentido com a viagem aberta, ela não pertence aqui.
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Plus,
  ArrowRight,
  Globe,
  MapPin,
  CalendarDays,
  Ticket,
  CircleCheck,
  Users,
  Lightbulb,
  Compass,
  Map as IconeMapa,
  Plane,
  Building2,
  ClipboardCheck,
  FileText,
  LifeBuoy,
  Wallet,
  Database,
  Home as IconeCasa,
  type LucideIcon,
} from 'lucide-react'
import { DashboardLayout } from '@/components/DashboardLayout.tsx'
import { CartaoViagem, periodo, type ViagemResumo } from '@/components/CartaoViagem.tsx'
import { CapaViagem } from '@/components/CapaViagem.tsx'
import { FormViagem } from '@/components/FormViagem.tsx'
import { Botao, Cartao, Carregando, Rotulo, Vazio, CartaoEstatistica } from '@/components/ui.tsx'
import { faseDaViagem, formatarRelativo } from '@/lib/derive.ts'
import { lerRecentes, type Recente } from '@/lib/recentes.ts'
import { siteConfig } from '@/config/site.ts'

/** Ícone de cada seção da viagem, para "Continue de onde parou". O nome da seção
 *  vem gravado no próprio registro — só o desenho mora aqui. */
const ICONE_ABA: Record<string, LucideIcon> = {
  inicio: IconeCasa,
  roteiro: IconeMapa,
  voos: Plane,
  cruzeiro: Compass,
  hospedagem: Building2,
  lugares: Globe,
  checklist: ClipboardCheck,
  documentos: FileText,
  emergencia: LifeBuoy,
  financeiro: Wallet,
  dados: Database,
}

export default function Inicio() {
  const router = useRouter()
  const [viagens, setViagens] = useState<ViagemResumo[]>([])
  const [nome, setNome] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [criando, setCriando] = useState(false)
  const [recentes, setRecentes] = useState<Recente[]>([])

  const carregar = useCallback(() => {
    return fetch('/api/viagens')
      .then((r) => r.json())
      .then((d) => {
        setViagens(d.viagens || [])
        setNome(String(d.eu?.nome ?? '').split(' ')[0] || '')
        // O histórico local entra junto com a lista: dois momentos de setState
        // seriam dois renders, e o de dentro do efeito ainda dispararia cascata.
        setRecentes(lerRecentes())
      })
      .catch(() => {})
      .finally(() => setCarregando(false))
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  if (carregando) return <Carregando texto="Carregando suas viagens…" />

  // Arquivada não aparece no Início: arquivar existe justamente para tirar a
  // viagem da frente. Ela continua em Minhas viagens, na aba Arquivadas.
  const ativas = viagens.filter((v) => !v.arquivada)

  // A viagem em foco é a que está acontecendo, ou a próxima a partir. Viagem
  // concluída nunca rouba o topo da tela.
  const emFoco = ativas
    .map((v) => ({ v, f: faseDaViagem(new Date(), v.data_partida, v.data_retorno) }))
    .filter((x) => x.f.fase !== 'depois')
    .sort((a, b) => a.f.diasRestantes - b.f.diasRestantes)[0]

  const dica = siteConfig.dicas[new Date().getDate() % siteConfig.dicas.length]

  function irPara(viagemId: string, aba: string) {
    router.push(`/viagens/${viagemId}?aba=${aba}`)
  }

  return (
    <DashboardLayout>
      {/* Quem limita e centra é o `DashboardLayout` — ver a nota lá. */}
      <div>
        <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h1 className="t-pagina">
              {nome ? siteConfig.saudacao.replace('{nome}', nome) : 'Olá!'}{' '}
              <span aria-hidden>👋</span>
            </h1>
            <p className="t-aux mt-1">{siteConfig.subsaudacao}</p>
          </div>
          <Botao onClick={() => setCriando(true)}>
            <Plus size={16} /> Nova viagem
          </Botao>
        </div>

        {ativas.length === 0 ? (
          <Vazio
            titulo="Você ainda não tem nenhuma viagem"
            texto="Sua próxima aventura começa aqui. Crie a viagem e vá montando o roteiro, o checklist e as reservas com quem vai junto."
            acao={
              <Botao onClick={() => setCriando(true)}>
                <Plus size={16} /> Criar minha primeira viagem
              </Botao>
            }
          />
        ) : (
          <>
            {emFoco && <Hero viagem={emFoco.v} />}

            {emFoco && <VisaoRapida viagem={emFoco.v} irPara={irPara} />}

            <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <section>
                <div className="mb-3 flex items-end justify-between gap-3">
                  <Rotulo>Minhas viagens</Rotulo>
                  <Link
                    href="/viagens"
                    className="inline-flex items-center gap-1 text-sm font-medium"
                    style={{ color: 'var(--color-destaque)' }}
                  >
                    Ver todas <ArrowRight size={14} />
                  </Link>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                  {ativas.slice(0, 3).map((v) => (
                    <CartaoViagem key={v.id} viagem={v} />
                  ))}
                  <button
                    onClick={() => setCriando(true)}
                    className="toque flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-(--color-borda-forte) px-4 py-8 text-center transition-colors hover:bg-(--color-superficie-2)"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-full border border-(--color-borda-forte) text-(--color-tinta-3)">
                      <Plus size={18} />
                    </span>
                    <span className="t-cartao">Criar nova viagem</span>
                    <span className="t-aux">Comece a planejar sua próxima aventura</span>
                  </button>
                </div>
              </section>

              <div className="space-y-6">
                <Continue recentes={recentes} irPara={irPara} />

                <section>
                  <Rotulo>Dica do dia</Rotulo>
                  <Cartao tom="destaque" className="mt-2.5">
                    <div className="flex gap-3">
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--color-cartao)"
                        style={{ color: 'var(--color-destaque)' }}
                      >
                        <Lightbulb size={17} strokeWidth={1.75} />
                      </span>
                      <div className="min-w-0">
                        <p className="t-corpo">{dica.texto}</p>
                        {emFoco && (
                          <button
                            onClick={() => irPara(emFoco.v.id, dica.aba)}
                            className="mt-2 inline-flex cursor-pointer items-center gap-1 text-sm font-semibold"
                            style={{ color: 'var(--color-destaque)' }}
                          >
                            {dica.acao} <ArrowRight size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  </Cartao>
                </section>
              </div>
            </div>
          </>
        )}
      </div>

      {criando && (
        <FormViagem
          aoFechar={() => setCriando(false)}
          aoSalvar={(v) => {
            setCriando(false)
            router.push(`/viagens/${v.id}`)
          }}
        />
      )}
    </DashboardLayout>
  )
}

/**
 * O destaque da tela: a próxima aventura.
 *
 * A arte é o fundo INTEIRO do cartão, com um degradê da cor do cartão por cima
 * do lado do texto. Assim o horizonte aparece e, ao mesmo tempo, cada palavra
 * continua assentada em `--color-cartao` — o contraste não depende do desenho.
 */
function Hero({ viagem }: { viagem: ViagemResumo }) {
  const f = faseDaViagem(new Date(), viagem.data_partida, viagem.data_retorno)
  const emAndamento = f.fase === 'durante'
  // A capa é sempre cinza neutro agora (não `cor_destaque`) — ver o mesmo
  // ajuste e a mesma nota em components/CartaoViagem.tsx.
  const cor = '#9a9a9c'

  return (
    <section className="relative overflow-hidden rounded-3xl border border-(--color-borda) bg-(--color-cartao) shadow-[var(--sombra-1)]">
      <div className="absolute inset-0" aria-hidden>
        <CapaViagem cor={cor} semente={viagem.id} url={viagem.capa_url} />
      </div>
      <div
        className="absolute inset-0 md:hidden"
        aria-hidden
        style={{
          background:
            'linear-gradient(180deg, transparent 0%, var(--color-cartao) 38%, var(--color-cartao) 100%)',
        }}
      />
      <div
        className="absolute inset-0 hidden md:block"
        aria-hidden
        style={{
          background:
            'linear-gradient(100deg, var(--color-cartao) 0%, var(--color-cartao) 46%, transparent 82%)',
        }}
      />

      <div className="relative grid gap-4 p-5 pt-28 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:p-7 md:pt-7">
        <div className="min-w-0">
          <Rotulo>{emAndamento ? 'Viagem em andamento' : 'Sua próxima aventura'}</Rotulo>
          <h2 className="mt-1.5 text-3xl leading-tight font-bold tracking-tight">{viagem.nome}</h2>
          <p className="tab-num t-aux mt-1">{periodo(viagem)}</p>
          <p className="t-aux mt-2 flex items-center gap-1.5">
            <Users size={14} className="text-(--color-tinta-3)" />
            {viagem.participantes} {viagem.participantes === 1 ? 'participante' : 'participantes'}
            {f.totalDias > 0 && ` · ${f.totalDias} dias de viagem`}
          </p>
        </div>

        <div className="flex items-end gap-5">
          {/* O número é o assunto do cartão: grande, tabular, com o rótulo pequeno. */}
          <div className="shrink-0">
            <p className="t-legenda">{emAndamento ? 'Você está no' : 'Faltam'}</p>
            <p className="t-destino tab-num !text-5xl">
              {emAndamento ? f.diaAtual : f.diasRestantes}
            </p>
            <p className="t-aux mt-1">
              {emAndamento ? `dia de ${f.totalDias}` : f.diasRestantes === 1 ? 'dia' : 'dias'}
            </p>
          </div>
          <Link
            href={`/viagens/${viagem.id}`}
            className="toque inline-flex shrink-0 items-center gap-2 rounded-full bg-(--color-tinta) px-5 text-sm font-semibold text-white"
          >
            Abrir viagem <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    </section>
  )
}

/** Os números da viagem em foco. Todos vêm do banco — nenhum é escrito no código. */
function VisaoRapida({
  viagem,
  irPara,
}: {
  viagem: ViagemResumo
  irPara: (id: string, aba: string) => void
}) {
  const pendentes = Math.max(0, (viagem.tarefas ?? 0) - (viagem.tarefas_feitas ?? 0))
  const itens = [
    { icone: Globe, numero: viagem.paises ?? 0, rotulo: 'Países', aba: 'lugares' },
    { icone: MapPin, numero: viagem.cidades ?? 0, rotulo: 'Cidades', aba: 'lugares' },
    {
      icone: CalendarDays,
      numero: viagem.compromissos ?? 0,
      rotulo: 'Compromissos',
      aba: 'roteiro',
    },
    { icone: Ticket, numero: viagem.reservas ?? 0, rotulo: 'Reservas', aba: 'hospedagem' },
    { icone: CircleCheck, numero: pendentes, rotulo: 'Tarefas pendentes', aba: 'checklist' },
  ]

  return (
    <section className="mt-8">
      <Rotulo>Visão rápida · {viagem.nome}</Rotulo>
      <div className="mt-2.5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {itens.map((i) => (
          <CartaoEstatistica
            key={i.rotulo}
            icone={i.icone}
            numero={i.numero}
            rotulo={i.rotulo}
            onClick={() => irPara(viagem.id, i.aba)}
          />
        ))}
      </div>
    </section>
  )
}

/** O caminho de volta para onde a pessoa estava. Vazio até ela abrir uma viagem. */
function Continue({
  recentes,
  irPara,
}: {
  recentes: Recente[]
  irPara: (id: string, aba: string) => void
}) {
  return (
    <section>
      <Rotulo>Continue de onde parou</Rotulo>
      {recentes.length === 0 ? (
        <Cartao className="mt-2.5">
          <p className="t-corpo font-medium">Ainda não há nada por aqui.</p>
          <p className="t-aux mt-1">Entre em uma viagem para começar.</p>
        </Cartao>
      ) : (
        <Cartao className="mt-2.5 !p-1.5">
          {recentes.map((r) => {
            const Icone = ICONE_ABA[r.aba] ?? Compass
            return (
              <button
                key={`${r.viagemId}:${r.aba}`}
                onClick={() => irPara(r.viagemId, r.aba)}
                className="toque flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 text-left transition-colors hover:bg-(--color-superficie-2)"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--color-superficie-2) text-(--color-tinta-2)">
                  <Icone size={16} strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.nome}</span>
                  <span className="block truncate text-[12px] text-(--color-tinta-3)">
                    {r.viagem} · {formatarRelativo(new Date(r.em).toISOString())}
                  </span>
                </span>
                <ArrowRight size={15} className="shrink-0 text-(--color-tinta-3)" />
              </button>
            )
          })}
        </Cartao>
      )}
    </section>
  )
}
