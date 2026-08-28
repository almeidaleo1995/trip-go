'use client'

// A Central de Preparação: "o que falta para a viagem estar pronta?".
//
// A tela não guarda nada. Ela monta o `Contexto` a partir do snapshot, pede as
// tarefas a `lib/preparacao.ts` e desenha — toda a inteligência é lá, testada
// sem navegador, e as regras crescem sem que este arquivo precise mudar.
//
// A linha do tempo é a espinha da tela e a única peça desenhada do zero. Ela
// ganhou o lugar porque a ordem CARREGA informação: um passaporte e uma etiqueta
// de mala não são duas tarefas iguais em ordem alfabética, são coisas que vencem
// em momentos diferentes, e é o momento que decide o que fazer hoje. Tudo em
// volta é o design system de sempre — cartão, badge, anel, progresso.
//
// O que decide QUEM VÊ o quê está no servidor. Um `visualizador` recebe um
// snapshot sem a despesa alheia e sem o documento pessoal de ninguém; a Central
// pinta o que chegou e nunca filtra por permissão.
import { useMemo, useState } from 'react'
import {
  ArrowRight,
  BellRing,
  Check,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileText,
  Luggage,
  MapPin,
  Plane,
  Plus,
  Sparkles,
  UserRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useTrip } from '../TripProvider.tsx'
import { AdminAcoes } from '../EditorSheet.tsx'
import { Clima } from './Checklist.tsx'
import {
  Anel,
  Avatar,
  Badge,
  Botao,
  Cartao,
  Interruptor,
  Progresso,
  Rotulo,
  Titulo,
  Vazio,
  TONS,
} from '../ui.tsx'
import type { AbaId } from '../Shell.tsx'
import {
  CAMPOS_PERFIL,
  montarMatriz,
  resumir,
  type PerfilResumo,
  type Requisito,
  type Submissao,
} from '@/lib/documentacao.ts'
import {
  FONTES,
  NOME_FASE,
  NOME_MOMENTO,
  SAIR_ANTES_MIN,
  TOM_PRIORIDADE,
  embarqueDe,
  montarPreparacao,
  type Contexto,
  type Degrau,
  type Obrigacao,
  type Fonte,
  type ResumoCategoria,
  type Tarefa,
  type Voo,
} from '@/lib/preparacao.ts'
import { parcelasDaViagem, percentual } from '@/lib/financeiro.ts'
import {
  formatarData,
  formatarDinheiro,
  formatarDuracao,
  formatarHora,
  proximoCompromisso,
  type Evento,
} from '@/lib/derive.ts'

const CHAVE_MODO = 'viagem:modo-viagem'

/** Ícone por fonte. Só identidade visual — a verdade está no motor. */
const ICONE_FONTE: Record<Fonte, LucideIcon> = {
  documento: FileText,
  perfil: UserRound,
  checklist: ClipboardCheck,
  voo: Plane,
  hospedagem: MapPin,
  pagamento: Wallet,
}

// ================================================================ dados

/**
 * O `Contexto` do motor, montado do snapshot.
 *
 * O financeiro entra por dois caminhos porque são duas respostas diferentes do
 * servidor, não uma com filtro: quem administra recebe as parcelas da viagem,
 * quem viaja recebe só as próprias obrigações. As duas têm a mesma forma aqui —
 * id, descrição, valor, pago, vencimento — e é isso que deixa uma regra só
 * atender aos dois papéis sem nunca ver o que não deveria.
 */
function useCentral() {
  const { snapshot, posso } = useTrip()
  const admin = posso('editor')

  return useMemo(() => {
    const v = snapshot?.viagem
    const hoje = new Date()
    const eu = String(snapshot?.eu?.participanteId ?? '')

    const participantes = (snapshot?.participantes ?? []).map((p) => ({
      id: String(p.id),
      nome: String(p.nome),
      avatar_url: (p.avatar_url as string | null) ?? null,
    }))
    const requisitos = (snapshot?.requisitos ?? []) as unknown as Requisito[]
    const perfis = (snapshot?.perfis ?? []) as unknown as PerfilResumo[]
    const matriz = montarMatriz(
      requisitos,
      (snapshot?.entregas ?? []) as unknown as Submissao[],
      participantes,
      perfis,
      hoje,
    )

    // Campo do perfil que ALGUM requisito puxa e que esta pessoa não preencheu.
    // Só os que a viagem pede: cobrar a nacionalidade de quem nunca vai precisar
    // dela é inventar trabalho, e é assim que uma lista de pendências perde a
    // credibilidade toda.
    const meuPerfil = perfis.find((p) => p.traveler_id === eu)
    const pedidos = [...new Set(requisitos.map((r) => r.campo_perfil).filter(Boolean))] as string[]
    const perfilFaltando = pedidos
      .filter((c) => !meuPerfil?.campos?.[c])
      .map((c) => ({ chave: c, rotulo: CAMPOS_PERFIL[c]?.rotulo ?? c }))

    const feitos = Object.fromEntries(
      (snapshot?.checklist_state ?? [])
        .filter((e) => String(e.traveler_id) === eu)
        .map((e) => [String(e.item_id), Boolean(e.feito)]),
    )

    // A parcela da viagem e a obrigacao pessoal viram a MESMA forma aqui — id,
    // descricao, valor, pago, vencimento. E o que deixa uma regra so atender aos
    // dois papeis: o motor nunca precisa saber qual das duas respostas chegou.
    const financeiro = snapshot?.financeiro
    const obrigacoes: Obrigacao[] = !financeiro
      ? []
      : financeiro.admin
        ? parcelasDaViagem(financeiro.despesas as never, financeiro.parcelas as never, hoje).map(
            (p) => ({
              id: String(p.id),
              descricao: p.descricao,
              valor_centavos: Number(p.valor_centavos),
              pago_centavos: Number(p.pago_centavos ?? 0),
              vence_em: p.vence_em,
              status: p.status,
            }),
          )
        : financeiro.obrigacoes

    const contexto: Contexto = {
      hoje,
      partida: (v?.data_partida as string | null) ?? null,
      retorno: (v?.data_retorno as string | null) ?? null,
      matriz,
      eu,
      admin,
      perfilFaltando,
      documentos: (snapshot?.documentos ?? []) as never,
      checklist: (snapshot?.checklist ?? []) as never,
      feitos,
      voos: (snapshot?.voos ?? []) as unknown as Voo[],
      reservas: (snapshot?.reservas ?? []) as never,
      obrigacoes,
    }

    return { contexto, participantes, central: montarPreparacao(contexto), admin }
  }, [snapshot, admin])
}

// ================================================================ raiz

export function Preparacao({ irPara }: { irPara: (a: AbaId) => void }) {
  const { snapshot } = useTrip()
  const { contexto, central, participantes, admin } = useCentral()
  // Preferência DESTE aparelho, não da viagem: um pode estar dirigindo em modo
  // viagem enquanto o outro confere o checklist no hotel. Uma coluna no banco
  // faria o toggle de um mexer na tela do outro.
  //
  // Lido no inicializador e não num efeito: `Preparacao` só monta depois de o
  // snapshot chegar (a página mostra `Carregando` até lá), então não há HTML do
  // servidor com que divergir — e ler aqui evita a repintura em cascata de um
  // setState dentro de efeito. O `try` cobre o navegador com armazenamento
  // bloqueado, onde o modo vale enquanto a aba estiver aberta.
  const [modoViagem, setModoViagem] = useState(() => {
    try {
      const salvo = localStorage.getItem(CHAVE_MODO)
      // Durante a viagem ele começa ligado: quem já embarcou não abre esta tela
      // para preparar nada, abre para saber o que vem agora.
      return salvo === null ? central.fase === 'viagem' : salvo === '1'
    } catch {
      return false
    }
  })

  const trocarModo = (v: boolean) => {
    setModoViagem(v)
    try {
      localStorage.setItem(CHAVE_MODO, v ? '1' : '0')
    } catch {
      /* idem */
    }
  }

  const v = snapshot?.viagem
  const fase = NOME_FASE[central.fase]
  const embarque = embarqueDe(contexto.voos, contexto.partida)

  return (
    <>
      <Titulo
        chapeu="O que falta resolver"
        descricao={
          <>
            Acompanhe tudo que falta resolver para sua viagem ser perfeita.
            <span className="tab-num block sm:mt-0 sm:ml-1 sm:inline">
              {v?.data_partida ? (
                <>
                  {formatarData(String(v.data_partida), { day: '2-digit', month: 'short' })} –{' '}
                  {formatarData(String(v.data_retorno ?? null), {
                    day: '2-digit',
                    month: 'short',
                  })}{' '}
                  ·{' '}
                </>
              ) : null}
              {participantes.length} {participantes.length === 1 ? 'viajante' : 'viajantes'}
            </span>
          </>
        }
        acao={
          <div className="w-52">
            <Interruptor
              rotulo="Modo viagem"
              descricao="Só o que importa hoje"
              ligado={modoViagem}
              aoMudar={trocarModo}
            />
          </div>
        }
      >
        Preparação da viagem
      </Titulo>

      {modoViagem ? (
        <ModoViagem central={central} embarque={embarque} irPara={irPara} />
      ) : (
        <div className="lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start lg:gap-5">
          <div className="space-y-5">
            <ResumoPreparacao central={central} fase={fase} irPara={irPara} />
            <LinhaDoTempo
              degraus={central.degraus}
              embarque={embarque}
              partida={contexto.partida}
              irPara={irPara}
            />
            {admin && <ProgressoGrupo />}
          </div>

          {/* No celular a lateral desce inteira para depois da linha do tempo: a
              ordem do DOM já é a ordem de prioridade que o §26 pede. */}
          <div className="mt-5 space-y-4 lg:mt-0">
            <ProximoCompromisso irPara={irPara} />
            <PendenciasImportantes central={central} irPara={irPara} />
            <Clima vazio={<p className="t-aux">A previsão aparece mais perto da viagem.</p>} />
            <ResumoFinanceiro irPara={irPara} />
            <ChecklistRapido irPara={irPara} />
            <AcoesRapidas irPara={irPara} />
          </div>
        </div>
      )}
    </>
  )
}

// ================================================================ resumo

/** O indicador geral (§4): um número, a fase que ele descreve, e os módulos. */
function ResumoPreparacao({
  central,
  fase,
  irPara,
}: {
  central: ReturnType<typeof montarPreparacao>
  fase: { titulo: string; texto: string }
  irPara: (a: AbaId) => void
}) {
  const pronto = central.pct === 100

  return (
    <Cartao>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          {central.pct === null ? (
            <span className="flex h-[104px] w-[104px] shrink-0 items-center justify-center rounded-full border-8 border-(--color-superficie-2)">
              <Sparkles size={26} className="text-(--color-tinta-3)" strokeWidth={1.5} />
            </span>
          ) : (
            <Anel
              pct={central.pct}
              tamanho={104}
              tom={pronto ? 'sucesso' : central.urgentes.length > 0 ? 'perigo' : undefined}
              legenda={`Viagem ${central.pct}% preparada`}
            />
          )}
          <div className="min-w-0">
            <Rotulo>Resumo da preparação</Rotulo>
            <p className="t-secao mt-1">{fase.titulo}</p>
            <p className="t-aux mt-1 max-w-xs">{fase.texto}</p>
          </div>
        </div>
      </div>

      {/* Os módulos. Cada um é botão para a aba dele — o número já responde
          "onde?", e obrigar a procurar a aba certa depois de ver o número é o
          clique que faz um painel virar relatório. */}
      <div className="mt-5 grid grid-cols-2 gap-2 border-t border-(--color-borda) pt-4 sm:grid-cols-3">
        {central.categorias.map((c) => (
          <Modulo key={c.id} categoria={c} irPara={irPara} />
        ))}
      </div>
    </Cartao>
  )
}

function Modulo({
  categoria,
  irPara,
}: {
  categoria: ResumoCategoria
  irPara: (a: AbaId) => void
}) {
  const tom = TONS[categoria.tom] ?? TONS.neutro
  const inativo = categoria.pct === null

  return (
    <button
      onClick={() => irPara(categoria.destino)}
      className="toque flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-(--color-superficie-2)"
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ background: tom.bg, color: tom.ink }}
      >
        {categoria.tom === 'sucesso' ? (
          <Check size={15} strokeWidth={2.5} />
        ) : (
          <span className="tab-num text-[11px] font-bold">
            {inativo ? '–' : `${categoria.pct}%`}
          </span>
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{categoria.rotulo}</span>
        <span
          className="block truncate text-[12px]"
          style={{ color: inativo ? 'var(--color-tinta-3)' : tom.ink }}
        >
          {categoria.nota}
        </span>
      </span>
    </button>
  )
}

// ================================================================ linha do tempo

/**
 * A espinha da tela (§5).
 *
 * `<ol>` e não `<div>`: isto É uma sequência, e a ordem é o que o leitor precisa
 * para decidir o que fazer hoje. Um leitor de tela anuncia "1 de 4" e a
 * informação chega igual a quem não vê a régua.
 *
 * A bolinha de cada parada carrega o pior estado dela — a régua é lida de cima a
 * baixo antes de qualquer palavra, e é ela que faz a urgência aparecer primeiro.
 */
function LinhaDoTempo({
  degraus,
  embarque,
  partida,
  irPara,
}: {
  degraus: Degrau[]
  embarque: ReturnType<typeof embarqueDe>
  partida: string | null
  irPara: (a: AbaId) => void
}) {
  // O dia da partida é o único degrau que existe sem tarefa nenhuma: mesmo com
  // tudo resolvido, "a que horas eu saio de casa" continua sendo uma pergunta. Se
  // nenhuma tarefa caiu nele e há voo, ele entra assim mesmo — só com o cartão.
  const paradas: Degrau[] =
    embarque && !degraus.some((d) => d.momento === 'dia')
      ? [
          ...degraus,
          { momento: 'dia', rotulo: NOME_MOMENTO.dia, data: partida, tarefas: [] },
        ]
      : degraus

  if (paradas.length === 0) {
    return (
      <Vazio
        titulo="Nada pendente por aqui"
        texto="Tudo que a viagem exige já está resolvido. Quando entrar um voo, uma reserva ou um documento novo, o que ele pedir aparece nesta linha."
      />
    )
  }

  return (
    <div>
      <Rotulo>Linha do tempo da preparação</Rotulo>
      <ol className="mt-3">
        {paradas.map((d, i) => {
          const cor =
            d.tarefas.length === 0
              ? 'var(--destaque)'
              : TONS[d.tarefas.some((t) => t.prioridade === 'urgente') ? 'perigo' : 'atencao'].ink
          const ultimo = i === paradas.length - 1

          return (
            <li key={d.momento} className="relative flex gap-3 pb-5 last:pb-0">
              {/* A régua. Para no último degrau: uma linha que continua depois do
                  fim promete um degrau que não existe. */}
              {!ultimo && (
                <span
                  aria-hidden
                  className="absolute top-4 bottom-0 left-[5px] w-0.5 bg-(--color-borda)"
                />
              )}
              <span
                aria-hidden
                className="relative mt-1.5 h-3 w-3 shrink-0 rounded-full ring-4 ring-(--color-fundo)"
                style={{ background: cor }}
              />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <h3 className="t-legenda" style={{ color: cor }}>
                    {d.rotulo}
                  </h3>
                  {d.data && (
                    <span className="t-aux tab-num">
                      {formatarData(d.data, { day: '2-digit', month: 'long' })}
                    </span>
                  )}
                  {d.tarefas.length > 0 && (
                    <span className="t-aux">
                      · {d.tarefas.length} {d.tarefas.length === 1 ? 'item' : 'itens'}
                    </span>
                  )}
                </div>

                {d.tarefas.length > 0 && (
                  <ul className="mt-2 space-y-2">
                    {d.tarefas.map((t) => (
                      <li key={t.id}>
                        <ItemTarefa tarefa={t} irPara={irPara} />
                      </li>
                    ))}
                  </ul>
                )}

                {/* O dia da partida ganha o cartão do voo (§5): é o único degrau
                    em que a pergunta deixa de ser "o que falta" e passa a ser
                    "a que horas eu saio de casa". */}
                {d.momento === 'dia' && embarque && (
                  <div className="mt-3">
                    <CartaoEmbarque embarque={embarque} partida={partida} irPara={irPara} />
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** Uma tarefa. O botão diz exatamente o que acontece ao ser tocado. */
function ItemTarefa({ tarefa, irPara }: { tarefa: Tarefa; irPara: (a: AbaId) => void }) {
  const ficha = FONTES[tarefa.fonte]
  const Icone = ICONE_FONTE[tarefa.fonte]
  const tom = TONS[TOM_PRIORIDADE[tarefa.prioridade]] ?? TONS.neutro

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-(--color-borda) bg-(--color-cartao) p-3 shadow-[var(--sombra-1)]">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
        style={{ background: tom.bg, color: tom.ink }}
      >
        <Icone size={16} strokeWidth={1.9} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="t-corpo min-w-0 font-medium">{tarefa.titulo}</p>
          <Badge tipo="neutro" texto={ficha.rotulo} />
        </div>
        <p className="t-aux mt-0.5 flex flex-wrap items-center gap-x-2">
          {tarefa.detalhe && <span>{tarefa.detalhe}</span>}
          {tarefa.prazo && (
            <span className="tab-num inline-flex items-center gap-1">
              <Clock3 size={12} /> até{' '}
              {formatarData(tarefa.prazo, { day: '2-digit', month: '2-digit', year: 'numeric' })}
            </span>
          )}
        </p>
      </div>

      {/* "Resolver" leva ao lugar onde a coisa se resolve. "Lembrete" é o que o
          app não consegue conferir — ele leva ao mesmo lugar, mas não promete
          que o clique encerra o assunto. */}
      <Botao
        variante={tarefa.acao === 'resolver' ? 'secundario' : 'fantasma'}
        tamanho="pequeno"
        onClick={() => irPara(ficha.destino)}
      >
        {tarefa.acao === 'resolver' ? 'Resolver' : 'Ver'}
      </Botao>
    </div>
  )
}

// ================================================================ embarque

/** O cartão do dia da partida (§5). Horários, terminal e para onde ir depois. */
function CartaoEmbarque({
  embarque,
  partida,
  irPara,
}: {
  embarque: NonNullable<ReturnType<typeof embarqueDe>>
  partida: string | null
  irPara: (a: AbaId) => void
}) {
  const v = embarque.voo
  const nome = [v.companhia, v.numero].filter(Boolean).join(' ') || 'Voo'

  const fatos = [
    embarque.sairAs
      ? {
          rotulo: 'Saída sugerida',
          valor: embarque.sairAs,
          // O app não sabe onde a pessoa mora nem como está o trânsito: o número
          // é a folga padrão para voo internacional, dita como sugestão. Um
          // horário apresentado como certeza é pior do que horário nenhum.
          nota: `${SAIR_ANTES_MIN / 60}h antes`,
        }
      : null,
    v.duracao_min ? { rotulo: 'Duração', valor: formatarDuracao(Number(v.duracao_min)) } : null,
    v.terminal ? { rotulo: 'Terminal', valor: String(v.terminal) } : null,
    v.localizador ? { rotulo: 'Localizador', valor: String(v.localizador) } : null,
  ].filter(Boolean) as { rotulo: string; valor: string; nota?: string }[]

  return (
    <div
      className="rounded-2xl border p-4"
      style={{
        background: 'var(--color-destaque-tenue)',
        borderColor: 'var(--color-destaque-fraco)',
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="flex items-center gap-2 font-semibold">
          <Plane size={16} style={{ color: 'var(--destaque)' }} />
          {nome}
        </p>
        <p className="tab-num text-xl leading-none font-bold">{formatarHora(v.parte_em ?? null)}</p>
      </div>

      <p className="t-aux mt-1">
        {[v.origem_cidade ?? v.origem_iata, v.destino_cidade ?? v.destino_iata]
          .filter(Boolean)
          .join(' → ')}
        {partida ? ` · ${formatarData(partida, { day: '2-digit', month: 'long' })}` : ''}
      </p>

      {fatos.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {fatos.map((f) => (
            <div
              key={f.rotulo}
              className="rounded-xl bg-(--color-cartao) px-3 py-2 text-center sm:text-left"
            >
              <dt className="t-legenda">{f.rotulo}</dt>
              <dd className="tab-num mt-0.5 font-semibold">{f.valor}</dd>
              {f.nota && <p className="t-aux">{f.nota}</p>}
            </div>
          ))}
        </dl>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Botao variante="secundario" tamanho="pequeno" onClick={() => irPara('voos')}>
          Ver detalhes do voo
        </Botao>
        <Botao variante="fantasma" tamanho="pequeno" onClick={() => irPara('documentos')}>
          Documentos necessários
        </Botao>
      </div>
    </div>
  )
}

// ================================================================ lateral

function ProximoCompromisso({ irPara }: { irPara: (a: AbaId) => void }) {
  const { snapshot } = useTrip()
  const proximo = proximoCompromisso((snapshot?.roteiro ?? []) as unknown as Evento[], new Date())

  return (
    <Cartao>
      <div className="mb-2 flex items-center justify-between gap-3">
        <Rotulo>Próximo compromisso</Rotulo>
        <button
          onClick={() => irPara('roteiro')}
          className="cursor-pointer text-[13px] font-medium"
          style={{ color: 'var(--destaque)' }}
        >
          Ver roteiro
        </button>
      </div>

      {!proximo ? (
        <p className="t-aux">
          Nenhum compromisso futuro no roteiro. Os passeios e traslados que você cadastrar aparecem
          aqui.
        </p>
      ) : (
        <button
          onClick={() => irPara('roteiro')}
          className="toque flex w-full cursor-pointer items-center gap-3 rounded-xl text-left"
        >
          <span className="w-12 shrink-0 text-center">
            <span className="tab-num block text-lg leading-none font-bold">
              {formatarData(String(proximo.ocorre_em ?? null), { day: '2-digit' })}
            </span>
            <span className="t-legenda mt-0.5 block">
              {formatarData(String(proximo.ocorre_em ?? null), { month: 'short' }).replace('.', '')}
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="t-corpo block truncate font-medium">{String(proximo.titulo)}</span>
            <span className="t-aux tab-num block truncate">
              {formatarHora(String(proximo.ocorre_em ?? null))}
              {proximo.cidade ? ` · ${String(proximo.cidade)}` : ''}
            </span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-(--color-tinta-3)" />
        </button>
      )}
    </Cartao>
  )
}

/** "Pendências importantes" (§8): quantas, de que tipo, e o caminho para cada. */
function PendenciasImportantes({
  central,
  irPara,
}: {
  central: ReturnType<typeof montarPreparacao>
  irPara: (a: AbaId) => void
}) {
  return (
    <Cartao>
      <div className="mb-2 flex items-center justify-between gap-3">
        <Rotulo>Pendências importantes</Rotulo>
        {central.tarefas.length > 0 && (
          <Badge
            tipo={central.urgentes.length > 0 ? 'perigo' : 'atencao'}
            texto={String(central.tarefas.length)}
          />
        )}
      </div>

      {central.porFonte.length === 0 ? (
        <p className="t-aux flex items-center gap-1.5">
          <Check size={15} className="text-(--color-sucesso-ink)" /> Tudo certo por aqui. Você não
          tem nenhuma pendência.
        </p>
      ) : (
        <ul className="divide-y divide-(--color-borda)">
          {central.porFonte.map((f) => {
            const Icone = ICONE_FONTE[f.fonte]
            const tom = TONS[f.urgentes > 0 ? 'perigo' : 'atencao']
            return (
              <li key={f.fonte}>
                <button
                  onClick={() => irPara(FONTES[f.fonte].destino)}
                  className="toque -mx-1 flex w-[calc(100%+0.5rem)] cursor-pointer items-center gap-3 rounded-xl px-1 py-2 text-left transition-colors hover:bg-(--color-superficie-2)"
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: tom.bg, color: tom.ink }}
                  >
                    <Icone size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {f.total}{' '}
                      {f.total === 1
                        ? FONTES[f.fonte].rotulo.toLowerCase()
                        : FONTES[f.fonte].plural}
                    </span>
                    <span className="t-aux block">
                      {f.urgentes > 0 ? `${f.urgentes} sem tempo a perder` : 'Aguardando você'}
                    </span>
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-(--color-tinta-3)" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Cartao>
  )
}

/**
 * O financeiro (§11), na versão que ESTE papel recebeu.
 *
 * Não é o painel do admin com campos escondidos: quando `admin` é falso o
 * snapshot simplesmente não traz o total da viagem. Ver `financeiroDaViagem`.
 */
function ResumoFinanceiro({ irPara }: { irPara: (a: AbaId) => void }) {
  const { snapshot } = useTrip()
  const f = snapshot?.financeiro
  const moeda = String(snapshot?.viagem?.moeda ?? 'EUR')
  if (!f) return null

  const linhas: [string, string][] = []
  let pct: number | null = null
  let titulo = 'Resumo financeiro'

  if (f.admin) {
    const parcelas = parcelasDaViagem(f.despesas as never, f.parcelas as never)
    const total = parcelas.reduce((s, p) => s + Number(p.valor_centavos), 0)
    const pago = parcelas.reduce((s, p) => s + Number(p.pago_centavos ?? 0), 0)
    const proxima = parcelas.find((p) => Number(p.pago_centavos ?? 0) < Number(p.valor_centavos))
    linhas.push(['Total da viagem', formatarDinheiro(total, moeda)])
    linhas.push(['Pago até agora', formatarDinheiro(pago, moeda)])
    linhas.push(['Saldo restante', formatarDinheiro(total - pago, moeda)])
    if (proxima?.vence_em) {
      linhas.push([
        'Próximo pagamento',
        `${formatarData(proxima.vence_em, { day: '2-digit', month: '2-digit' })} · ${formatarDinheiro(
          Number(proxima.valor_centavos) - Number(proxima.pago_centavos ?? 0),
          moeda,
        )}`,
      ])
    }
    pct = total > 0 ? percentual(pago, total) : null
  } else {
    titulo = 'Resumo financeiro (você)'
    const total = f.devendo + f.pago
    const proxima = f.obrigacoes
      .filter((o) => o.valor_centavos > o.pago_centavos && o.vence_em)
      .sort((a, b) => (a.vence_em! < b.vence_em! ? -1 : 1))[0]
    linhas.push(['Total atribuído', formatarDinheiro(total, moeda)])
    linhas.push(['Pago', formatarDinheiro(f.pago, moeda)])
    linhas.push(['Saldo', formatarDinheiro(f.devendo, moeda)])
    if (proxima?.vence_em) {
      linhas.push([
        'Próximo pagamento',
        `${formatarData(proxima.vence_em, { day: '2-digit', month: '2-digit' })} · ${formatarDinheiro(
          proxima.valor_centavos - proxima.pago_centavos,
          moeda,
        )}`,
      ])
    }
    pct = total > 0 ? percentual(f.pago, total) : null
  }

  return (
    <Cartao>
      <div className="mb-2 flex items-center justify-between gap-3">
        <Rotulo>{titulo}</Rotulo>
        <button
          onClick={() => irPara('financeiro')}
          className="cursor-pointer text-[13px] font-medium"
          style={{ color: 'var(--destaque)' }}
        >
          Ver financeiro
        </button>
      </div>

      {pct === null ? (
        <p className="t-aux">
          {f.admin
            ? 'Nenhuma despesa cadastrada ainda.'
            : 'Você não tem pagamentos atribuídos nesta viagem.'}
        </p>
      ) : (
        <>
          <dl className="space-y-1.5 text-sm">
            {linhas.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3">
                <dt className="t-aux">{k}</dt>
                <dd className="tab-num font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3">
            <Progresso pct={pct} rotulo="Quanto da viagem já foi pago" />
          </div>
        </>
      )}
    </Cartao>
  )
}

/** O checklist resumido (§10). Nunca um segundo checklist — só o espelho dele. */
function ChecklistRapido({ irPara }: { irPara: (a: AbaId) => void }) {
  const { snapshot } = useTrip()

  const grupos = useMemo(() => {
    const eu = String(snapshot?.eu?.participanteId ?? '')
    const feitos = new Set(
      (snapshot?.checklist_state ?? [])
        .filter((e) => String(e.traveler_id) === eu && Boolean(e.feito))
        .map((e) => String(e.item_id)),
    )
    const conta = new Map<string, { feitos: number; total: number }>()
    for (const i of snapshot?.checklist ?? []) {
      const nome = String(i.categoria ?? 'Sem categoria')
      const atual = conta.get(nome) ?? { feitos: 0, total: 0 }
      atual.total += 1
      if (feitos.has(String(i.id))) atual.feitos += 1
      conta.set(nome, atual)
    }
    return [...conta.entries()]
      .map(([nome, v]) => ({ nome, ...v, pct: Math.round((v.feitos / v.total) * 100) }))
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 4)
  }, [snapshot?.checklist, snapshot?.checklist_state, snapshot?.eu?.participanteId])

  return (
    <Cartao>
      <div className="mb-2 flex items-center justify-between gap-3">
        <Rotulo>Checklist rápido</Rotulo>
        <button
          onClick={() => irPara('checklist')}
          className="cursor-pointer text-[13px] font-medium"
          style={{ color: 'var(--destaque)' }}
        >
          Ver checklist
        </button>
      </div>

      {grupos.length === 0 ? (
        <p className="t-aux">
          Seu checklist ainda está vazio. Comece pela mala e pelos documentos — o progresso aparece
          aqui.
        </p>
      ) : (
        <div className="space-y-2.5">
          {grupos.map((g) => (
            <div key={g.nome}>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="truncate font-medium capitalize">{g.nome}</span>
                <span className="tab-num t-aux">{g.pct}%</span>
              </div>
              <Progresso pct={g.pct} rotulo={`Checklist: ${g.nome}`} />
            </div>
          ))}
        </div>
      )}
    </Cartao>
  )
}

/** Ações rápidas (§15). Cada uma abre o formulário de verdade do módulo dono. */
function AcoesRapidas({ irPara }: { irPara: (a: AbaId) => void }) {
  const { posso } = useTrip()

  return (
    <Cartao>
      <Rotulo>Ações rápidas</Rotulo>
      <div className="mt-2 flex flex-wrap gap-2">
        {/* AdminAcoes some sozinho para quem não alcança o papel do módulo. */}
        <AdminAcoes entidade="checklist_item">Adicionar tarefa</AdminAcoes>
        <AdminAcoes entidade="documento">Adicionar documento</AdminAcoes>
        {posso('editor') && (
          <Botao variante="fantasma" tamanho="pequeno" onClick={() => irPara('financeiro')}>
            <Plus size={14} /> Adicionar despesa
          </Botao>
        )}
        {posso('proprietario') && (
          <Botao variante="fantasma" tamanho="pequeno" onClick={() => irPara('dados')}>
            <Plus size={14} /> Convidar participante
          </Botao>
        )}
        <Botao variante="fantasma" tamanho="pequeno" onClick={() => irPara('lugares')}>
          <MapPin size={14} /> Ver cidades
        </Botao>
        <Botao variante="fantasma" tamanho="pequeno" onClick={() => irPara('roteiro')}>
          <ArrowRight size={14} /> Abrir roteiro
        </Botao>
      </div>
    </Cartao>
  )
}

// ================================================================ grupo

/**
 * O progresso do grupo (§14). Só para quem organiza.
 *
 * Mede a documentação exigida, que é a única coisa que o servidor manda de
 * TODOS: o checklist de outra pessoa e as despesas dela não chegam aqui, e
 * inventar uma média com metade dos dados diria um número errado com confiança.
 */
function ProgressoGrupo() {
  const { snapshot } = useTrip()

  const linhas = useMemo(() => {
    const participantes = (snapshot?.participantes ?? []).map((p) => ({
      id: String(p.id),
      nome: String(p.nome),
      avatar_url: (p.avatar_url as string | null) ?? null,
    }))
    const matriz = montarMatriz(
      (snapshot?.requisitos ?? []) as unknown as Requisito[],
      (snapshot?.entregas ?? []) as unknown as Submissao[],
      participantes,
      (snapshot?.perfis ?? []) as unknown as PerfilResumo[],
    )
    return participantes
      .map((p) => ({ p, celulas: matriz.porParticipante.get(p.id) ?? [] }))
      .filter((l) => l.celulas.length > 0)
      .map((l) => ({ ...l, resumo: resumir(l.celulas) }))
      .sort((a, b) => a.resumo.pct - b.resumo.pct)
  }, [snapshot?.participantes, snapshot?.requisitos, snapshot?.entregas, snapshot?.perfis])

  if (linhas.length === 0) return null

  return (
    <Cartao>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Rotulo>Progresso do grupo</Rotulo>
        <span className="t-aux">Documentação exigida</span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {linhas.map(({ p, resumo }) => (
          <li key={p.id} className="flex items-center gap-3">
            <Avatar nome={p.nome} url={p.avatar_url} tamanho={32} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{p.nome}</span>
              <span className="mt-1 block">
                <Progresso pct={resumo.pct} rotulo={`Documentação de ${p.nome}`} />
              </span>
            </span>
            <span
              className="tab-num shrink-0 text-sm font-semibold"
              style={{
                color:
                  resumo.pct === 100 ? 'var(--color-sucesso-ink)' : 'var(--color-tinta-2)',
              }}
            >
              {resumo.pct}%
            </span>
          </li>
        ))}
      </ul>
    </Cartao>
  )
}

// ================================================================ modo viagem

/**
 * Modo viagem (§16): a mesma matéria, recortada para quem já embarcou.
 *
 * Não é uma segunda tela — é a de sempre sem os degraus que só falavam do
 * futuro. Quem está com a mala na mão não precisa saber o que fazer "em 30
 * dias"; precisa do próximo compromisso, do que trava hoje e de onde estão os
 * documentos.
 */
function ModoViagem({
  central,
  embarque,
  irPara,
}: {
  central: ReturnType<typeof montarPreparacao>
  embarque: ReturnType<typeof embarqueDe>
  irPara: (a: AbaId) => void
}) {
  const hoje = central.degraus.filter((d) => d.momento === 'agora' || d.momento === 'dia')

  return (
    <div className="space-y-4">
      <ProximoCompromisso irPara={irPara} />

      {embarque && <CartaoEmbarque embarque={embarque} partida={null} irPara={irPara} />}

      {hoje.length === 0 ? (
        <Cartao tom="sucesso">
          <p className="t-corpo flex items-center gap-2 font-medium">
            <Check size={16} /> Nada trava a viagem hoje.
          </p>
          <p className="t-aux mt-1">
            Desligue o modo viagem para ver o que ainda está marcado para depois.
          </p>
        </Cartao>
      ) : (
        <div>
          <Rotulo>Para resolver hoje</Rotulo>
          <ul className="mt-2 space-y-2">
            {hoje.flatMap((d) => d.tarefas).map((t) => (
              <li key={t.id}>
                <ItemTarefa tarefa={t} irPara={irPara} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <Clima />

      <Cartao>
        <Rotulo>À mão</Rotulo>
        <div className="mt-2 flex flex-wrap gap-2">
          <Botao variante="secundario" tamanho="pequeno" onClick={() => irPara('documentos')}>
            <FileText size={14} /> Documentos
          </Botao>
          <Botao variante="secundario" tamanho="pequeno" onClick={() => irPara('hospedagem')}>
            <Luggage size={14} /> Hospedagem
          </Botao>
          <Botao variante="secundario" tamanho="pequeno" onClick={() => irPara('voos')}>
            <Plane size={14} /> Voos
          </Botao>
          <Botao variante="secundario" tamanho="pequeno" onClick={() => irPara('emergencia')}>
            <BellRing size={14} /> Emergência
          </Botao>
        </div>
      </Cartao>
    </div>
  )
}
