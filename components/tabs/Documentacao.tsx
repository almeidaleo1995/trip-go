'use client'

// A documentação exigida: o que a viagem PEDE de cada pessoa, e quanto disso
// ainda falta.
//
// É a irmã do Cofre e não se confunde com ele. O cofre organiza o que EXISTE —
// um voucher de hotel que ninguém exigiu continua sendo um documento útil. Esta
// tela organiza o que FALTA, e um requisito que ninguém cumpriu ainda é
// justamente o caso que interessa: ele não tem arquivo, não tem linha de
// entrega, e mesmo assim precisa aparecer em vermelho na frente de alguém.
//
// Duas telas em um arquivo, de propósito. Elas leem a MESMA matriz (montada uma
// vez em `montarMatriz`) por eixos diferentes: o viajante lê a própria linha, o
// administrador lê a tabela inteira. Separar em dois arquivos duplicaria o
// semáforo, e a segunda cópia divergiria na primeira regra nova.
//
// O que decide QUEM VÊ o quê está no servidor (`documentacaoDaViagem`, lib/db.ts):
// um editor recebe o ESTADO da documentação alheia sem o número do passaporte, e
// um visualizador recebe só a própria. Esta tela pinta o que recebeu.
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  CalendarClock,
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Clock3,
  FileCheck2,
  Filter,
  Hourglass,
  Paperclip,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import Link from 'next/link'
import {
  Anel,
  AppModal,
  Avatar,
  Badge,
  Botao,
  BotaoIcone,
  Cartao,
  Campo,
  Falha,
  Interruptor,
  Progresso,
  Rotulo,
  Selecao,
  Titulo,
  TONS,
  Vazio,
  useAviso,
} from '../ui.tsx'
import { useTrip } from '../TripProvider.tsx'
import { ICONE_CATEGORIA, chaveIcone } from '../CofreDocumento.tsx'
import {
  CAMPOS_PERFIL,
  ESTADOS,
  ORDEM_ESTADOS,
  aplicaA,
  checklistDaDocumentacao,
  entregue,
  fichaCampoPerfil,
  filtrarCelulas,
  montarMatriz,
  ordenarCelulas,
  ordenarRequisitos,
  pendenciasDe,
  pendenciasPorRequisito,
  resumir,
  textoFalta,
  validadeDe,
  type Celula,
  type EstadoRequisito,
  type FiltrosDocumentacao,
  type Matriz,
  type PerfilResumo,
  type Requisito,
  type Submissao,
} from '@/lib/documentacao.ts'
import { CATEGORIAS, fichaCategoria, formatarTamanho, type Documento } from '@/lib/cofre.ts'
// `Progresso` ja e o componente de barra do design system; aqui o tipo entra
// como `ProgressoEnvio` para nao brigar com ele.
import { LIMITE_TEXTO, enviarArquivo, type Progresso as ProgressoEnvio } from '@/lib/arquivo.ts'
import { CATEGORIAS_DOCUMENTO, CAMPOS_PERFIL_REQUISITO } from '@/lib/schema.ts'
import { formatarData } from '@/lib/derive.ts'

/** Data por extenso curta com ano. Vencimento sem ano não diz nada. */
const comAno = (d: string | null | undefined) =>
  formatarData(d ?? null, { day: '2-digit', month: '2-digit', year: 'numeric' })

// ================================================================ dados da tela

/**
 * Tudo que as duas telas leem, montado uma vez.
 *
 * A matriz é cara o suficiente (uma célula por requisito por pessoa) para não
 * ser refeita a cada tecla digitada na busca, e as duas telas precisam dela
 * inteira — o painel para contar, a tela pessoal para achar a própria linha.
 */
function useDocumentacao() {
  const { snapshot } = useTrip()

  const requisitos = useMemo(
    () => (snapshot?.requisitos ?? []) as unknown as Requisito[],
    [snapshot?.requisitos],
  )
  const entregas = useMemo(
    () => (snapshot?.entregas ?? []) as unknown as Submissao[],
    [snapshot?.entregas],
  )
  const perfis = useMemo(
    () => (snapshot?.perfis ?? []) as unknown as PerfilResumo[],
    [snapshot?.perfis],
  )
  const participantes = useMemo(
    () =>
      (snapshot?.participantes ?? []).map((p) => ({
        id: String(p.id),
        nome: String(p.nome),
        papel: p.papel ? String(p.papel) : undefined,
        avatar_url: (p.avatar_url as string | null) ?? null,
      })),
    [snapshot?.participantes],
  )

  const matriz = useMemo(
    () => montarMatriz(requisitos, entregas, participantes, perfis),
    [requisitos, entregas, participantes, perfis],
  )

  const perfilDe = useMemo(() => new Map(perfis.map((p) => [p.traveler_id, p])), [perfis])
  const nomeDe = useMemo(() => new Map(participantes.map((p) => [p.id, p.nome])), [participantes])

  return {
    requisitos,
    participantes,
    matriz,
    perfilDe,
    nomeDe,
    eu: String(snapshot?.eu?.participanteId ?? ''),
  }
}

/** A data de vencimento crua de uma célula. A célula só guarda "faltam N dias". */
function vencimentoDe(c: Celula, perfilDe: Map<string, PerfilResumo>): string | null {
  return validadeDe(c.requisito, c.submissao, perfilDe.get(c.traveler_id))
}

/**
 * O número que a chave de modo mostra ao lado de "Exigidos".
 *
 * As SUAS pendências se você viaja; as da viagem inteira se você organiza — o
 * mesmo recorte que decide qual das duas telas abre. O tom é o pior estado da
 * lista: vermelho quando algo já venceu ou voltou reprovado, âmbar quando só
 * falta entregar.
 */
export function usePendenciasAbertas(): { abertas: number; tom: string } {
  const { posso } = useTrip()
  const { matriz, eu } = useDocumentacao()
  const admin = posso('editor')

  return useMemo(() => {
    const celulas = admin
      ? matriz.celulas.filter((c) => ESTADOS[c.estado].ativo)
      : eu
        ? pendenciasDe(matriz, eu)
        : []
    return {
      abertas: celulas.length,
      tom: celulas.some((c) => ESTADOS[c.estado].tom === 'perigo') ? 'perigo' : 'atencao',
    }
  }, [admin, matriz, eu])
}

// ================================================================ raiz

export function Documentacao() {
  const { posso } = useTrip()
  const admin = posso('editor')
  // O administrador também viaja. O painel é o que ele abre para cobrar os
  // outros; a própria documentação dele continua sendo dele, e escondê-la atrás
  // do painel faria o organizador da viagem ser o único sem lugar para o próprio
  // passaporte.
  const [vendo, setVendo] = useState<'painel' | 'minha'>('painel')

  if (!admin) return <MinhaDocumentacao />
  if (vendo === 'minha') {
    return (
      <MinhaDocumentacao
        aoVoltar={() => setVendo('painel')}
        acaoExtra={
          <Botao variante="secundario" onClick={() => setVendo('painel')}>
            <ArrowLeft size={15} /> Painel
          </Botao>
        }
      />
    )
  }
  return <PainelDocumentacao aoVerMinha={() => setVendo('minha')} />
}

// ================================================================ viajante

function MinhaDocumentacao({
  aoVoltar,
  acaoExtra,
}: {
  aoVoltar?: () => void
  acaoExtra?: React.ReactNode
}) {
  const { matriz, perfilDe, eu, participantes } = useDocumentacao()
  const [celulaAberta, setCelulaAberta] = useState<string | null>(null)

  const minhas = useMemo(() => ordenarCelulas(matriz.porParticipante.get(eu) ?? []), [matriz, eu])
  const resumo = useMemo(() => resumir(minhas), [minhas])
  const pendentes = useMemo(() => pendenciasDe(matriz, eu), [matriz, eu])

  const vencimentos = useMemo(
    () =>
      minhas
        .filter((c) => c.validade && c.validade.nivel !== 'ok')
        .sort((a, b) => (a.validade?.dias ?? 0) - (b.validade?.dias ?? 0)),
    [minhas],
  )

  const aberta = minhas.find((c) => c.requisito.id === celulaAberta) ?? null
  const souParticipante = participantes.some((p) => p.id === eu)

  return (
    <>
      <Titulo nivel={2} chapeu="O que a viagem pede" acao={acaoExtra}>
        Minha documentação
      </Titulo>

      {!souParticipante ? (
        <Vazio
          titulo="Você não está na lista de participantes"
          texto="Quem organiza a viagem precisa incluir você como participante para a documentação passar a valer."
        />
      ) : minhas.length === 0 ? (
        <Vazio
          titulo="Nada exigido por enquanto"
          texto="Quando quem organiza a viagem cadastrar os documentos obrigatórios, eles aparecem aqui com prazo e status."
        />
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <Cartao>
              <Rotulo>Minha documentação</Rotulo>
              <div className="mt-3 flex items-center gap-4">
                <Anel
                  pct={resumo.pct}
                  tamanho={84}
                  tom={resumo.pct === 100 ? 'sucesso' : undefined}
                  legenda={`${resumo.pct}% da sua documentação está completa`}
                />
                <div className="min-w-0 text-sm">
                  <p className="font-medium">
                    <span className="tab-num">
                      {minhas.filter((c) => entregue(c.estado)).length} de {minhas.length}
                    </span>{' '}
                    completos
                  </p>
                  <p className="t-aux mt-1">
                    {resumo.revisando > 0 && <>{resumo.revisando} em revisão · </>}
                    {resumo.pendentes + resumo.problemas} a resolver
                  </p>
                </div>
              </div>
            </Cartao>

            <Cartao tom={pendentes.length > 0 ? 'atencao' : 'padrao'}>
              <div className="flex items-center justify-between">
                <Rotulo>Pendentes</Rotulo>
                {pendentes.length > 0 && <Badge tipo="atencao" texto={String(pendentes.length)} />}
              </div>
              {pendentes.length === 0 ? (
                <p className="t-aux mt-3 flex items-center gap-1.5">
                  <Check size={15} className="text-(--color-sucesso-ink)" /> Nada pendente.
                </p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {pendentes.slice(0, 3).map((c) => (
                    <li key={c.requisito.id}>
                      <button
                        onClick={() => setCelulaAberta(c.requisito.id)}
                        className="toque flex w-full cursor-pointer items-center gap-2 rounded-lg text-left text-sm hover:underline"
                      >
                        <IconeRequisito categoria={c.requisito.categoria} tamanho={26} />
                        <span className="truncate">{c.requisito.nome}</span>
                      </button>
                    </li>
                  ))}
                  {pendentes.length > 3 && <li className="t-aux">e mais {pendentes.length - 3}</li>}
                </ul>
              )}
            </Cartao>

            <Cartao tom={vencimentos.length > 0 ? 'perigo' : 'padrao'}>
              <div className="flex items-center justify-between">
                <Rotulo>Próximos vencimentos</Rotulo>
                {vencimentos.length > 0 && (
                  <Badge tipo="perigo" texto={String(vencimentos.length)} />
                )}
              </div>
              {vencimentos.length === 0 ? (
                <p className="t-aux mt-3">Nenhum documento seu vence nos próximos 90 dias.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {vencimentos.slice(0, 2).map((c) => (
                    <li key={c.requisito.id} className="text-sm">
                      <p className="font-medium">{c.requisito.nome}</p>
                      <p className="t-aux">
                        {c.validade!.nivel === 'vencido' ? 'Venceu em ' : 'Vence em '}
                        <span className="tab-num">{comAno(vencimentoDe(c, perfilDe))}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Cartao>
          </div>

          {pendentes.length > 0 && (
            <div className="mb-5">
              <Rotulo>O que resolver agora</Rotulo>
              <div className="mt-2 space-y-2">
                {pendentes.map((c) => (
                  <LinhaRequisito
                    key={c.requisito.id}
                    celula={c}
                    vencimento={vencimentoDe(c, perfilDe)}
                    aoAbrir={() => setCelulaAberta(c.requisito.id)}
                  />
                ))}
              </div>
            </div>
          )}

          <Rotulo>Todos os requisitos da viagem</Rotulo>
          <div className="mt-2 space-y-2">
            {minhas.map((c) => (
              <LinhaRequisito
                key={c.requisito.id}
                celula={c}
                vencimento={vencimentoDe(c, perfilDe)}
                aoAbrir={() => setCelulaAberta(c.requisito.id)}
              />
            ))}
          </div>
        </>
      )}

      {aberta && (
        <FichaCelula
          celula={aberta}
          vencimento={vencimentoDe(aberta, perfilDe)}
          aoFechar={() => setCelulaAberta(null)}
        />
      )}

      {aoVoltar && (
        <div className="mt-6">
          <Botao variante="secundario" onClick={aoVoltar}>
            <ArrowLeft size={15} /> Voltar ao painel
          </Botao>
        </div>
      )}
    </>
  )
}

// ================================================================ administrador

type SubAba = 'geral' | 'participantes' | 'documentos' | 'pendencias'

const SUB_ABAS: { id: SubAba; nome: string }[] = [
  { id: 'geral', nome: 'Visão geral' },
  { id: 'participantes', nome: 'Por participante' },
  { id: 'documentos', nome: 'Por documento' },
  { id: 'pendencias', nome: 'Pendências' },
]

function PainelDocumentacao({ aoVerMinha }: { aoVerMinha: () => void }) {
  const { posso } = useTrip()
  const { requisitos, participantes, matriz, perfilDe, nomeDe } = useDocumentacao()

  const [subAba, setSubAba] = useState<SubAba>('geral')
  const [filtros, setFiltros] = useState<FiltrosDocumentacao>({})
  const [maisFiltros, setMaisFiltros] = useState(false)
  const [editando, setEditando] = useState<Requisito | null | undefined>(undefined)
  const [participanteAberto, setParticipanteAberto] = useState<string | null>(null)
  const [celulaAberta, setCelulaAberta] = useState<Celula | null>(null)

  const visiveis = useMemo(
    () => filtrarCelulas(matriz.celulas, filtros, nomeDe),
    [matriz, filtros, nomeDe],
  )
  const resumo = useMemo(() => resumir(visiveis), [visiveis])

  const vencendo = useMemo(
    () =>
      visiveis
        .filter((c) => c.validade && c.validade.nivel !== 'ok')
        .sort((a, b) => (a.validade?.dias ?? 0) - (b.validade?.dias ?? 0)),
    [visiveis],
  )

  const porRequisito = useMemo(
    () => pendenciasPorRequisito({ ...matriz, celulas: visiveis }, requisitos),
    [matriz, visiveis, requisitos],
  )

  // O recorte dos filtros vale para a tabela de participantes também: filtrar por
  // "passaporte" e continuar vendo 100% de quem já entregou tudo MENOS ele seria
  // responder outra pergunta.
  const linhasParticipante = useMemo(() => {
    const porPessoa = new Map<string, Celula[]>()
    for (const c of visiveis) {
      if (!porPessoa.has(c.traveler_id)) porPessoa.set(c.traveler_id, [])
      porPessoa.get(c.traveler_id)!.push(c)
    }
    return participantes
      .map((p) => ({ participante: p, celulas: porPessoa.get(p.id) ?? [] }))
      .filter((l) => l.celulas.length > 0)
      .map((l) => ({ ...l, resumo: resumir(l.celulas) }))
  }, [visiveis, participantes])

  const filtrando = Object.values(filtros).some((v) =>
    Array.isArray(v) ? v.length > 0 : Boolean(v),
  )

  const categoriasEmUso = useMemo(
    () => [...new Set(requisitos.map((r) => r.categoria).filter(Boolean))] as string[],
    [requisitos],
  )

  return (
    <>
      <Titulo
        nivel={2}
        chapeu="O que a viagem pede"
        acao={
          <>
            <Botao variante="secundario" onClick={aoVerMinha}>
              <UserRound size={15} /> Minha documentação
            </Botao>
            {posso('editor') && (
              <Botao onClick={() => setEditando(null)}>
                <Plus size={15} /> Adicionar requisito
              </Botao>
            )}
          </>
        }
      >
        Documentação exigida
      </Titulo>

      {requisitos.length === 0 ? (
        <Vazio
          titulo="Nenhum documento obrigatório ainda"
          texto="Cadastre o que a viagem exige — passaporte, seguro, vistos — e acompanhe aqui quem já entregou e quem ainda deve."
          acao={
            posso('editor') ? (
              <Botao onClick={() => setEditando(null)}>
                <Plus size={15} /> Adicionar requisito
              </Botao>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* busca + filtros */}
          <div className="mb-4 flex gap-2">
            <div className="relative flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-(--color-tinta-3)"
              />
              <input
                type="search"
                value={filtros.busca ?? ''}
                onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
                placeholder="Buscar quem deve o quê"
                aria-label="Buscar quem deve o quê"
                className="toque w-full rounded-xl border border-(--color-borda) bg-(--color-cartao) pr-3 pl-9 text-sm"
              />
            </div>
            <Botao
              variante={maisFiltros ? 'principal' : 'secundario'}
              onClick={() => setMaisFiltros((a) => !a)}
            >
              <Filter size={15} />
              <span className="hidden sm:inline">Filtros</span>
              {filtrando && !maisFiltros && (
                <span
                  className="ml-0.5 h-1.5 w-1.5 rounded-full"
                  style={{ background: 'var(--destaque)' }}
                  aria-label="filtros ativos"
                />
              )}
            </Botao>
          </div>

          {/* cartões de contagem */}
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Cartao className="flex items-center gap-3">
              <Anel
                pct={resumo.pct}
                tamanho={68}
                tom={resumo.pct === 100 ? 'sucesso' : resumo.problemas > 0 ? 'perigo' : undefined}
                legenda={`Progresso geral: ${resumo.pct}%`}
              />
              <span className="t-aux">Progresso geral</span>
            </Cartao>
            <Contagem
              icone={FileCheck2}
              numero={resumo.completos}
              rotulo="Completos"
              tom="sucesso"
            />
            <Contagem
              icone={Hourglass}
              numero={resumo.revisando}
              rotulo="Aguardando revisão"
              tom="info"
              onClick={() => setFiltros((f) => ({ ...f, estados: ['enviado'] }))}
            />
            <Contagem
              icone={ClipboardList}
              numero={resumo.pendentes}
              rotulo="Pendentes"
              tom="atencao"
              onClick={() => setFiltros((f) => ({ ...f, estados: ['pendente'] }))}
            />
            <Contagem
              icone={CalendarClock}
              numero={vencendo.length}
              rotulo="Próximos vencimentos"
              tom="perigo"
              onClick={() => setFiltros((f) => ({ ...f, estados: ['vencido', 'proximo'] }))}
            />
          </div>

          {maisFiltros && (
            <Cartao className="mb-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Selecao
                  rotulo="Participante"
                  valor={filtros.participantes?.[0] ?? ''}
                  aoMudar={(v) => setFiltros((f) => ({ ...f, participantes: v ? [v] : [] }))}
                  opcoes={[
                    { valor: '', nome: 'Todos os participantes' },
                    ...participantes.map((p) => ({ valor: p.id, nome: p.nome })),
                  ]}
                />
                <Selecao
                  rotulo="Documento"
                  valor={filtros.requisitos?.[0] ?? ''}
                  aoMudar={(v) => setFiltros((f) => ({ ...f, requisitos: v ? [v] : [] }))}
                  opcoes={[
                    { valor: '', nome: 'Todos os documentos' },
                    ...ordenarRequisitos(requisitos).map((r) => ({
                      valor: r.id,
                      nome: r.nome,
                    })),
                  ]}
                />
                <Selecao
                  rotulo="Categoria"
                  valor={filtros.categorias?.[0] ?? ''}
                  aoMudar={(v) => setFiltros((f) => ({ ...f, categorias: v ? [v] : [] }))}
                  opcoes={[
                    { valor: '', nome: 'Todas as categorias' },
                    ...categoriasEmUso.map((c) => ({
                      valor: c,
                      nome: fichaCategoria(c).rotulo,
                    })),
                  ]}
                />
                <Selecao
                  rotulo="Status"
                  valor={filtros.estados?.[0] ?? ''}
                  aoMudar={(v) =>
                    setFiltros((f) => ({
                      ...f,
                      estados: v ? [v as EstadoRequisito] : [],
                    }))
                  }
                  opcoes={[
                    { valor: '', nome: 'Todos os status' },
                    ...ORDEM_ESTADOS.map((e) => ({ valor: e, nome: ESTADOS[e].rotulo })),
                  ]}
                />
                <div className="flex items-end">
                  <div className="w-full">
                    <Interruptor
                      rotulo="Só obrigatórios"
                      ligado={Boolean(filtros.obrigatorios)}
                      aoMudar={(v) => setFiltros((f) => ({ ...f, obrigatorios: v }))}
                    />
                  </div>
                </div>
                <div className="flex items-end">
                  <div className="w-full">
                    <Interruptor
                      rotulo="Prazo vencendo"
                      descricao="Envio atrasado ou nos próximos 30 dias"
                      ligado={Boolean(filtros.comPrazo)}
                      aoMudar={(v) => setFiltros((f) => ({ ...f, comPrazo: v }))}
                    />
                  </div>
                </div>
              </div>
              {filtrando && (
                <div className="mt-3 flex justify-end">
                  <Botao variante="fantasma" onClick={() => setFiltros({})}>
                    <X size={15} /> Limpar filtros
                  </Botao>
                </div>
              )}
            </Cartao>
          )}

          {/* sub-abas */}
          <div
            role="tablist"
            aria-label="Visões do painel"
            className="mb-4 flex gap-1 overflow-x-auto border-b border-(--color-borda)"
          >
            {SUB_ABAS.map((a) => (
              <button
                key={a.id}
                role="tab"
                aria-selected={subAba === a.id}
                onClick={() => setSubAba(a.id)}
                className="toque -mb-px shrink-0 cursor-pointer border-b-2 px-3 text-sm font-medium transition-colors"
                style={{
                  borderColor: subAba === a.id ? 'var(--destaque)' : 'transparent',
                  color: subAba === a.id ? 'var(--destaque)' : 'var(--color-tinta-2)',
                }}
              >
                {a.nome}
              </button>
            ))}
          </div>

          {visiveis.length === 0 ? (
            <Vazio
              titulo="Nada com esses filtros"
              texto="Nenhum requisito bate com a combinação escolhida. Tente afrouxar um filtro."
              acao={<Botao onClick={() => setFiltros({})}>Limpar filtros</Botao>}
            />
          ) : subAba === 'geral' ? (
            <div className="space-y-5">
              <TabelaParticipantes linhas={linhasParticipante} aoAbrir={setParticipanteAberto} />
              <div className="grid gap-3 lg:grid-cols-2">
                <PainelPendencias grupos={porRequisito} nomeDe={nomeDe} />
                <PainelVencimentos
                  celulas={vencendo}
                  nomeDe={nomeDe}
                  perfilDe={perfilDe}
                  aoAbrir={setCelulaAberta}
                />
              </div>
            </div>
          ) : subAba === 'participantes' ? (
            <RelatorioParticipantes linhas={linhasParticipante} aoAbrir={setParticipanteAberto} />
          ) : subAba === 'documentos' ? (
            <RelatorioRequisitos
              requisitos={requisitos}
              matriz={{ ...matriz, celulas: visiveis }}
              participantes={participantes}
              nomeDe={nomeDe}
              aoEditar={setEditando}
              aoAbrirCelula={setCelulaAberta}
            />
          ) : (
            <ListaPendencias
              celulas={ordenarCelulas(visiveis.filter((c) => ESTADOS[c.estado].ativo))}
              nomeDe={nomeDe}
              perfilDe={perfilDe}
              aoAbrir={setCelulaAberta}
            />
          )}
        </>
      )}

      {editando !== undefined && (
        <FormRequisito requisito={editando} aoFechar={() => setEditando(undefined)} />
      )}

      {participanteAberto && (
        <DetalheParticipante
          travelerId={participanteAberto}
          aoFechar={() => setParticipanteAberto(null)}
        />
      )}

      {celulaAberta && (
        <FichaCelula
          celula={celulaAberta}
          vencimento={vencimentoDe(celulaAberta, perfilDe)}
          aoFechar={() => setCelulaAberta(null)}
        />
      )}
    </>
  )
}

// ================================================================ tabelas do painel

type LinhaPessoa = {
  participante: { id: string; nome: string; avatar_url: string | null }
  celulas: Celula[]
  resumo: ReturnType<typeof resumir>
}

/**
 * A tabela de participantes.
 *
 * Vira cartões no celular em vez de rolar na horizontal: uma tabela de seis
 * colunas dentro de 360 px esconde a metade que importa atrás de um gesto que
 * ninguém descobre. As duas formas mostram os MESMOS números.
 */
function TabelaParticipantes({
  linhas,
  aoAbrir,
}: {
  linhas: LinhaPessoa[]
  aoAbrir: (id: string) => void
}) {
  return (
    <div>
      <Rotulo>Participantes</Rotulo>

      {/* celular */}
      <div className="mt-2 space-y-2 md:hidden">
        {linhas.map((l) => (
          <Cartao key={l.participante.id} onClick={() => aoAbrir(l.participante.id)}>
            <div className="flex items-center gap-3">
              <Avatar nome={l.participante.nome} url={l.participante.avatar_url} tamanho={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{l.participante.nome}</span>
                <span className="t-aux tab-num">
                  {l.resumo.completos} completos · {l.resumo.revisando} em revisão ·{' '}
                  {l.resumo.pendentes + l.resumo.problemas} pendentes
                </span>
              </span>
              <span className="tab-num shrink-0 text-sm font-semibold">{l.resumo.pct}%</span>
            </div>
            <div className="mt-2">
              <Progresso pct={l.resumo.pct} rotulo={`Documentação de ${l.participante.nome}`} />
            </div>
          </Cartao>
        ))}
      </div>

      {/* desktop */}
      <div className="mt-2 hidden overflow-x-auto rounded-2xl border border-(--color-borda) bg-(--color-cartao) md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-(--color-borda) text-left">
              <Th>Participante</Th>
              <Th>Progresso</Th>
              <Th alinhar="right">Completos</Th>
              <Th alinhar="right">Aguardando revisão</Th>
              <Th alinhar="right">Pendentes</Th>
              <Th alinhar="right">Ações</Th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.participante.id} className="border-b border-(--color-borda) last:border-0">
                <Td>
                  <span className="flex items-center gap-2">
                    <Avatar
                      nome={l.participante.nome}
                      url={l.participante.avatar_url}
                      tamanho={26}
                    />
                    <span className="truncate font-medium">{l.participante.nome}</span>
                  </span>
                </Td>
                <Td>
                  <span className="flex items-center gap-2">
                    <span className="tab-num w-9 shrink-0 font-semibold">{l.resumo.pct}%</span>
                    <span className="w-24">
                      <Progresso
                        pct={l.resumo.pct}
                        rotulo={`Documentação de ${l.participante.nome}`}
                      />
                    </span>
                  </span>
                </Td>
                <Td alinhar="right">
                  <span className="tab-num">{l.resumo.completos}</span>
                </Td>
                <Td alinhar="right">
                  <Numero valor={l.resumo.revisando} tom="info" />
                </Td>
                <Td alinhar="right">
                  <Numero valor={l.resumo.pendentes + l.resumo.problemas} tom="perigo" />
                </Td>
                <Td alinhar="right">
                  <Botao
                    variante="secundario"
                    tamanho="pequeno"
                    onClick={() => aoAbrir(l.participante.id)}
                  >
                    Ver detalhes
                  </Botao>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const ORDENACOES = {
  progresso_menor: 'Menor progresso',
  progresso_maior: 'Maior progresso',
  pendencias: 'Mais pendências',
  vencendo: 'Documentos vencendo',
  nome: 'Nome',
} as const

/** O relatório por participante (§19), ordenável — quem cobra começa pelo pior. */
function RelatorioParticipantes({
  linhas,
  aoAbrir,
}: {
  linhas: LinhaPessoa[]
  aoAbrir: (id: string) => void
}) {
  const [ordem, setOrdem] = useState<keyof typeof ORDENACOES>('progresso_menor')

  const ordenadas = useMemo(() => {
    const vencendo = (l: LinhaPessoa) =>
      l.celulas.filter((c) => c.validade && c.validade.nivel !== 'ok').length
    const copia = [...linhas]
    copia.sort((a, b) => {
      if (ordem === 'nome') return a.participante.nome.localeCompare(b.participante.nome, 'pt-BR')
      if (ordem === 'progresso_maior') return b.resumo.pct - a.resumo.pct
      if (ordem === 'pendencias') {
        return b.resumo.pendentes + b.resumo.problemas - (a.resumo.pendentes + a.resumo.problemas)
      }
      if (ordem === 'vencendo') return vencendo(b) - vencendo(a)
      return a.resumo.pct - b.resumo.pct
    })
    return copia
  }, [linhas, ordem])

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Rotulo>Progresso por participante</Rotulo>
        <div className="w-52">
          <Selecao
            compacto
            rotulo="Ordenar por"
            valor={ordem}
            aoMudar={(v) => setOrdem(v as keyof typeof ORDENACOES)}
            opcoes={Object.entries(ORDENACOES).map(([valor, nome]) => ({ valor, nome }))}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {ordenadas.map((l) => (
          <Cartao key={l.participante.id} onClick={() => aoAbrir(l.participante.id)}>
            <div className="flex items-center gap-3">
              <Anel
                pct={l.resumo.pct}
                tamanho={56}
                tom={
                  l.resumo.pct === 100 ? 'sucesso' : l.resumo.problemas > 0 ? 'perigo' : undefined
                }
                legenda={`${l.participante.nome}: ${l.resumo.pct}%`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{l.participante.nome}</span>
                <span className="t-aux tab-num block">
                  {l.celulas.filter((c) => entregue(c.estado)).length} de {l.celulas.length}{' '}
                  documentos
                </span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {l.resumo.revisando > 0 && (
                    <Badge tipo="info" texto={`${l.resumo.revisando} em revisão`} />
                  )}
                  {l.resumo.pendentes > 0 && (
                    <Badge tipo="neutro" texto={`${l.resumo.pendentes} pendentes`} />
                  )}
                  {l.resumo.problemas > 0 && (
                    <Badge tipo="perigo" texto={`${l.resumo.problemas} com problema`} />
                  )}
                </span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-(--color-tinta-3)" />
            </div>
          </Cartao>
        ))}
      </div>
    </div>
  )
}

/** O relatório por documento (§18): um requisito, quem já entregou, quem deve. */
function RelatorioRequisitos({
  requisitos,
  matriz,
  participantes,
  nomeDe,
  aoEditar,
  aoAbrirCelula,
}: {
  requisitos: Requisito[]
  matriz: Matriz
  participantes: { id: string; nome: string }[]
  nomeDe: Map<string, string>
  aoEditar: (r: Requisito) => void
  aoAbrirCelula: (c: Celula) => void
}) {
  const { posso, mutate } = useTrip()
  const avisar = useAviso()
  const [expandido, setExpandido] = useState<string | null>(null)

  // A matriz recebida já vem filtrada; um requisito sem célula visível saiu do
  // recorte e não deve aparecer com "0 de 0".
  const visiveis = useMemo(() => {
    const porReq = new Map<string, Celula[]>()
    for (const c of matriz.celulas) {
      if (!porReq.has(c.requisito.id)) porReq.set(c.requisito.id, [])
      porReq.get(c.requisito.id)!.push(c)
    }
    return ordenarRequisitos(requisitos)
      .map((r) => ({ requisito: r, celulas: porReq.get(r.id) ?? [] }))
      .filter((g) => g.celulas.length > 0)
  }, [requisitos, matriz])

  const remover = async (r: Requisito) => {
    await mutate({
      op: 'remover',
      entidade: 'requisito',
      id: r.id,
      campos: {},
      client_ts: new Date().toISOString(),
    })
    avisar('sucesso', 'Requisito removido.')
  }

  return (
    <div className="space-y-2">
      {visiveis.map(({ requisito, celulas }) => {
        const r = resumir(celulas)
        const aberto = expandido === requisito.id
        const devendo = ordenarCelulas(celulas.filter((c) => ESTADOS[c.estado].ativo))
        return (
          <Cartao key={requisito.id}>
            <div className="flex items-start gap-3">
              <IconeRequisito categoria={requisito.categoria} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{requisito.nome}</p>
                  {requisito.obrigatorio === false ? (
                    <Badge tipo="neutro" texto="Recomendado" />
                  ) : (
                    <Badge tipo="destaque" texto="Obrigatório" />
                  )}
                  {requisito.prazo && (
                    <span className="t-aux tab-num flex items-center gap-1">
                      <Clock3 size={13} /> até {comAno(requisito.prazo)}
                    </span>
                  )}
                </div>
                <p className="t-aux mt-0.5">
                  {requisito.aplica_todos !== false
                    ? 'Obrigatório para todos os participantes'
                    : `Só para ${(requisito.assigned_to ?? [])
                        .map((id) => nomeDe.get(id) ?? '—')
                        .join(', ')}`}
                </p>
                {requisito.descricao && <p className="t-aux mt-1">{requisito.descricao}</p>}

                <div className="mt-2 flex items-center gap-2">
                  <span className="max-w-40 flex-1">
                    <Progresso pct={r.pct} rotulo={`Entregas de ${requisito.nome}`} />
                  </span>
                  <span className="tab-num text-sm font-semibold">{r.pct}%</span>
                  <span className="t-aux tab-num">
                    {celulas.filter((c) => entregue(c.estado)).length}/{celulas.length}
                  </span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {posso('editor') && (
                  <>
                    <BotaoIcone rotulo="Editar requisito" onClick={() => aoEditar(requisito)}>
                      <ClipboardList size={16} />
                    </BotaoIcone>
                    <BotaoIcone rotulo="Remover requisito" onClick={() => void remover(requisito)}>
                      <Trash2 size={16} />
                    </BotaoIcone>
                  </>
                )}
              </div>
            </div>

            <button
              onClick={() => setExpandido(aberto ? null : requisito.id)}
              aria-expanded={aberto}
              className="toque mt-2 cursor-pointer text-sm font-medium text-(--destaque) hover:underline"
            >
              {aberto
                ? 'Esconder participantes'
                : devendo.length > 0
                  ? `Ver ${devendo.length} pendente${devendo.length > 1 ? 's' : ''}`
                  : 'Ver participantes'}
            </button>

            {aberto && (
              <ul className="mt-2 space-y-1.5 border-t border-(--color-borda) pt-2">
                {ordenarCelulas(celulas).map((c) => (
                  <li key={c.traveler_id}>
                    <button
                      onClick={() => aoAbrirCelula(c)}
                      className="toque flex w-full cursor-pointer items-center gap-2 rounded-lg px-1 text-left text-sm hover:bg-(--color-superficie-2)"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {nomeDe.get(c.traveler_id) ?? '—'}
                      </span>
                      <SeloEstado estado={c.estado} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>
        )
      })}
      {participantes.length === 0 && (
        <Vazio
          titulo="Nenhum participante na viagem"
          texto="Adicione participantes para a documentação passar a valer para alguém."
        />
      )}
    </div>
  )
}

/** "Quem ainda não enviou o quê" (§17), agrupado por documento. */
function PainelPendencias({
  grupos,
  nomeDe,
}: {
  grupos: { requisito: Requisito; celulas: Celula[] }[]
  nomeDe: Map<string, string>
}) {
  return (
    <Cartao>
      <div className="mb-2 flex items-center justify-between">
        <Rotulo>Documentos pendentes</Rotulo>
        {grupos.length > 0 && <Badge tipo="atencao" texto={String(grupos.length)} />}
      </div>
      {grupos.length === 0 ? (
        <p className="t-aux flex items-center gap-1.5">
          <Check size={15} className="text-(--color-sucesso-ink)" /> Ninguém está devendo nada.
        </p>
      ) : (
        <ul className="space-y-2">
          {grupos.map(({ requisito, celulas }) => (
            <li key={requisito.id} className="text-sm">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{requisito.nome}</span>
                <Badge
                  tipo="perigo"
                  texto={`${celulas.length} participante${celulas.length > 1 ? 's' : ''}`}
                />
              </div>
              <p className="t-aux truncate">
                {celulas.map((c) => nomeDe.get(c.traveler_id) ?? '—').join(', ')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  )
}

/** O relatório de vencimentos (§22): documento, pessoa, data e quantos dias faltam. */
function PainelVencimentos({
  celulas,
  nomeDe,
  perfilDe,
  aoAbrir,
}: {
  celulas: Celula[]
  nomeDe: Map<string, string>
  perfilDe: Map<string, PerfilResumo>
  aoAbrir: (c: Celula) => void
}) {
  return (
    <Cartao>
      <div className="mb-2 flex items-center justify-between">
        <Rotulo>Próximos vencimentos</Rotulo>
        {celulas.length > 0 && <Badge tipo="perigo" texto={String(celulas.length)} />}
      </div>
      {celulas.length === 0 ? (
        <p className="t-aux">Nenhum documento vence nos próximos 90 dias.</p>
      ) : (
        <ul className="space-y-2">
          {celulas.map((c) => (
            <li key={`${c.requisito.id}:${c.traveler_id}`}>
              <button
                onClick={() => aoAbrir(c)}
                className="toque flex w-full cursor-pointer items-center gap-2 rounded-lg text-left text-sm hover:bg-(--color-superficie-2)"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.requisito.nome}</span>
                  <span className="t-aux block truncate">{nomeDe.get(c.traveler_id) ?? '—'}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="tab-num block">{comAno(vencimentoDe(c, perfilDe))}</span>
                  <span
                    className="t-aux tab-num block"
                    style={{
                      color:
                        c.validade!.nivel === 'vencido'
                          ? 'var(--color-perigo-ink)'
                          : 'var(--color-atencao-ink)',
                    }}
                  >
                    {c.validade!.nivel === 'vencido'
                      ? `${Math.abs(c.validade!.dias)} dias atrás`
                      : `${c.validade!.dias} dias`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  )
}

/** Toda pendência da viagem numa lista só, da mais urgente para a menos. */
function ListaPendencias({
  celulas,
  nomeDe,
  perfilDe,
  aoAbrir,
}: {
  celulas: Celula[]
  nomeDe: Map<string, string>
  perfilDe: Map<string, PerfilResumo>
  aoAbrir: (c: Celula) => void
}) {
  if (celulas.length === 0) {
    return (
      <Vazio
        titulo="Nenhuma pendência"
        texto="Toda a documentação exigida foi entregue e revisada. É o estado que a viagem quer estar."
      />
    )
  }
  return (
    <div className="space-y-2">
      {celulas.map((c) => (
        <LinhaRequisito
          key={`${c.requisito.id}:${c.traveler_id}`}
          celula={c}
          vencimento={vencimentoDe(c, perfilDe)}
          dono={nomeDe.get(c.traveler_id)}
          aoAbrir={() => aoAbrir(c)}
        />
      ))}
    </div>
  )
}

// ================================================================ peças

function Th({
  children,
  alinhar = 'left',
}: {
  children: React.ReactNode
  alinhar?: 'left' | 'right'
}) {
  return (
    <th
      scope="col"
      className={`t-legenda px-3 py-2.5 font-medium ${alinhar === 'right' ? 'text-right' : ''}`}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  alinhar = 'left',
}: {
  children: React.ReactNode
  alinhar?: 'left' | 'right'
}) {
  return <td className={`px-3 py-2.5 ${alinhar === 'right' ? 'text-right' : ''}`}>{children}</td>
}

/** Contagem que vira filtro ao ser clicada: o número já responde "quem?". */
function Contagem({
  icone: Icone,
  numero,
  rotulo,
  tom,
  onClick,
}: {
  icone: React.ElementType
  numero: number
  rotulo: string
  tom: string
  onClick?: () => void
}) {
  const cor = TONS[tom] ?? TONS.neutro
  return (
    <Cartao onClick={onClick}>
      <div
        className="mb-2 flex h-8 w-8 items-center justify-center rounded-xl"
        style={{ background: cor.bg, color: cor.ink }}
      >
        <Icone size={16} strokeWidth={1.9} />
      </div>
      <p className="tab-num text-2xl leading-none font-bold">{numero}</p>
      <p className="t-aux mt-1">{rotulo}</p>
    </Cartao>
  )
}

/** Zero em cinza, diferente de zero na cor do assunto. Um painel só de vermelho não tem hierarquia. */
function Numero({ valor, tom }: { valor: number; tom: string }) {
  const cor = TONS[tom] ?? TONS.neutro
  return (
    <span
      className="tab-num font-semibold"
      style={{ color: valor === 0 ? 'var(--color-tinta-3)' : cor.ink }}
    >
      {valor}
    </span>
  )
}

function SeloEstado({ estado }: { estado: EstadoRequisito }) {
  const e = ESTADOS[estado]
  return <Badge tipo={e.tom} texto={e.curto} />
}

function IconeRequisito({
  categoria,
  tamanho = 36,
}: {
  categoria?: string | null
  tamanho?: number
}) {
  const Icone = ICONE_CATEGORIA[chaveIcone(categoria)]
  const tom = TONS[fichaCategoria(categoria).tom] ?? TONS.neutro
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-xl"
      style={{
        width: tamanho,
        height: tamanho,
        background: tom.bg,
        color: tom.ink,
      }}
    >
      <Icone size={Math.round(tamanho * 0.5)} strokeWidth={1.9} />
    </span>
  )
}

/**
 * Uma linha de requisito. É um botão inteiro pela mesma razão do cartão do cofre:
 * a mão que abre isto está segurando outra coisa.
 */
function LinhaRequisito({
  celula,
  vencimento,
  dono,
  aoAbrir,
}: {
  celula: Celula
  vencimento: string | null
  dono?: string
  aoAbrir: () => void
}) {
  const e = ESTADOS[celula.estado]
  return (
    <button
      onClick={aoAbrir}
      className="toque flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-(--color-borda) bg-(--color-cartao) p-3 text-left shadow-[var(--sombra-1)] transition-shadow hover:shadow-[var(--sombra-2)]"
    >
      <IconeRequisito categoria={celula.requisito.categoria} />

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="t-corpo font-medium">{celula.requisito.nome}</span>
          {dono && <span className="t-aux">· {dono}</span>}
        </span>
        <span className="t-aux mt-0.5 block truncate">
          {celula.requisito.obrigatorio === false
            ? 'Recomendado'
            : celula.requisito.aplica_todos !== false
              ? 'Obrigatório para todos'
              : 'Obrigatório para você'}
          {celula.falta.length > 0 && <> · falta {textoFalta(celula.falta)}</>}
        </span>
        {celula.prazo && (
          <span
            className="t-aux tab-num mt-0.5 block"
            style={celula.prazo.vencido ? { color: 'var(--color-perigo-ink)' } : undefined}
          >
            {celula.prazo.vencido
              ? `Prazo de envio venceu há ${celula.prazo.dias} dias`
              : `Enviar até ${comAno(celula.requisito.prazo)}`}
          </span>
        )}
        {celula.validade && celula.validade.nivel !== 'ok' && (
          <span className="t-aux tab-num mt-0.5 block" style={{ color: 'var(--color-perigo-ink)' }}>
            {celula.validade.nivel === 'vencido' ? 'Venceu em ' : 'Vence em '}
            {comAno(vencimento)}
          </span>
        )}
        {celula.comentario && (
          <span className="t-aux mt-1 flex items-start gap-1.5 text-(--color-perigo-ink)">
            <CircleAlert size={13} className="mt-0.5 shrink-0" />
            <span className="min-w-0">{celula.comentario}</span>
          </span>
        )}
      </span>

      <span className="flex shrink-0 items-center gap-2">
        <SeloEstado estado={celula.estado} />
        {e.acao && (
          <span
            className="hidden rounded-xl px-3 py-1.5 text-sm font-semibold sm:inline"
            style={{ background: 'var(--color-destaque-fraco)', color: 'var(--destaque)' }}
          >
            {e.acao}
          </span>
        )}
      </span>
    </button>
  )
}

// ================================================================ ficha de uma célula

/**
 * O requisito de uma pessoa aberto: o que falta, o que foi entregue, o que o
 * revisor escreveu — e as duas metades de ação que nunca se misturam.
 *
 * Quem é dono da linha ENTREGA. Quem revisa dá o VEREDITO. As duas convivem no
 * mesmo modal porque um administrador conferindo a própria documentação faz as
 * duas coisas, mas o servidor separa as permissões (`autorizar` em /api/mutate)
 * e a tela só mostra o que ele deixaria passar.
 */
function FichaCelula({
  celula,
  vencimento,
  aoFechar,
}: {
  celula: Celula
  vencimento: string | null
  aoFechar: () => void
}) {
  const { snapshot, posso } = useTrip()
  const eu = String(snapshot?.eu?.participanteId ?? '')
  const meu = celula.traveler_id === eu
  const revisor = posso('editor')
  const [entregando, setEntregando] = useState(false)

  const nome =
    (snapshot?.participantes ?? []).find((p) => String(p.id) === celula.traveler_id)?.nome ?? ''
  const campo = fichaCampoPerfil(celula.requisito.campo_perfil)
  const e = ESTADOS[celula.estado]
  const sub = celula.submissao

  if (entregando) {
    return (
      <FormEntrega
        celula={celula}
        aoFechar={() => {
          setEntregando(false)
          aoFechar()
        }}
      />
    )
  }

  return (
    <AppModal
      titulo={celula.requisito.nome}
      descricao={meu ? 'Sua documentação' : `Documentação de ${nome}`}
      tamanho="pequeno"
      aoFechar={aoFechar}
      acoes={
        meu && e.acao ? (
          <>
            <Botao variante="secundario" onClick={aoFechar}>
              Fechar
            </Botao>
            {/* O atalho para o perfil está na ficha, como linha — não como o
                botão principal. Um requisito que puxa do perfil quase sempre pede
                o ARQUIVO também, e mandar a pessoa para o perfil sem lugar para
                anexar o PDF é um beco: ela volta com o número preenchido e o
                requisito ainda pendente, sem entender por quê. */}
            <Botao onClick={() => setEntregando(true)}>{e.acao}</Botao>
          </>
        ) : (
          <Botao variante="secundario" onClick={aoFechar}>
            Fechar
          </Botao>
        )
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <SeloEstado estado={celula.estado} />
          <span className="t-aux">{e.rotulo}</span>
        </div>

        {celula.requisito.descricao && <p className="t-corpo">{celula.requisito.descricao}</p>}

        {celula.comentario && (
          <div
            className="rounded-xl p-3 text-sm"
            style={{ background: 'var(--color-perigo-bg)', color: 'var(--color-perigo-ink)' }}
          >
            <p className="flex items-center gap-1.5 font-semibold">
              <CircleAlert size={15} /> O que o revisor pediu
            </p>
            <p className="mt-1">{celula.comentario}</p>
          </div>
        )}

        <dl className="divide-y divide-(--color-borda) text-sm">
          {campo && (
            <Par
              rotulo="Vem do perfil"
              valor={
                <Link href="/perfil" className="text-(--destaque) hover:underline">
                  {campo.rotulo}
                </Link>
              }
            />
          )}
          {sub?.numero && (
            <Par rotulo="Número" valor={<span className="tab-num">{sub.numero}</span>} />
          )}
          {vencimento && (
            <Par rotulo="Validade" valor={<span className="tab-num">{comAno(vencimento)}</span>} />
          )}
          {sub?.emitido_em && (
            <Par
              rotulo="Emitido em"
              valor={<span className="tab-num">{comAno(sub.emitido_em)}</span>}
            />
          )}
          {celula.requisito.prazo && (
            <Par
              rotulo="Prazo de envio"
              valor={<span className="tab-num">{comAno(celula.requisito.prazo)}</span>}
            />
          )}
          {sub?.tem_arquivo && (
            <Par
              rotulo="Arquivo"
              valor={
                sub.documento_id ? (
                  <a
                    href={`/api/documento?id=${sub.documento_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-(--destaque) hover:underline"
                  >
                    <Paperclip size={13} /> Abrir
                  </a>
                ) : (
                  // O editor recebe `tem_arquivo` sem o id: ele cobra a entrega,
                  // não lê o passaporte alheio. Ver `documentacaoDaViagem`.
                  <span className="t-aux">Anexado</span>
                )
              }
            />
          )}
          {celula.falta.length > 0 && (
            <Par
              rotulo="Ainda falta"
              valor={<span className="text-(--color-perigo-ink)">{textoFalta(celula.falta)}</span>}
            />
          )}
          {celula.requisito.obs && <Par rotulo="Observação" valor={celula.requisito.obs} />}
        </dl>

        {revisor && sub && <Revisao celula={celula} aoFechar={aoFechar} />}

        {!meu && !sub && (
          <p className="t-aux">
            {String(nome)} ainda não cadastrou este documento. A entrega é preenchida pela própria
            pessoa — você pode cobrar, não preencher por ela.
          </p>
        )}
      </div>
    </AppModal>
  )
}

function Par({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-(--color-tinta-3)">{rotulo}</dt>
      <dd className="text-right font-medium">{valor}</dd>
    </div>
  )
}

/** O veredito (§25). Recusar sem dizer por quê devolve a pessoa ao mesmo erro. */
function Revisao({ celula, aoFechar }: { celula: Celula; aoFechar: () => void }) {
  const { mutate } = useTrip()
  const avisar = useAviso()
  const [motivo, setMotivo] = useState(celula.comentario ?? '')
  const [pedindo, setPedindo] = useState<'rejeitado' | 'correcao' | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const decidir = async (status: 'aprovado' | 'rejeitado' | 'correcao') => {
    if (status !== 'aprovado' && !motivo.trim()) {
      setErro('Diga o que precisa ser corrigido. Sem isso a pessoa reenvia o mesmo arquivo.')
      return
    }
    setErro(null)
    setSalvando(true)
    try {
      await mutate({
        op: 'editar',
        entidade: 'entrega',
        id: celula.submissao?.id ?? null,
        campos: {
          requirement_id: celula.requisito.id,
          traveler_id: celula.traveler_id,
          status,
          comentario: status === 'aprovado' ? null : motivo.trim(),
        },
        client_ts: new Date().toISOString(),
      })
      avisar(
        'sucesso',
        status === 'aprovado'
          ? 'Documento aprovado.'
          : status === 'correcao'
            ? 'Correção solicitada.'
            : 'Documento recusado.',
      )
      aoFechar()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível salvar a revisão.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="rounded-xl border border-(--color-borda) p-3">
      <Rotulo>Revisão</Rotulo>
      {erro && (
        <div className="mt-2">
          <Falha texto={erro} />
        </div>
      )}

      {pedindo && (
        <div className="mt-2">
          <label className="block">
            <span className="t-aux">
              {pedindo === 'correcao' ? 'O que precisa ser corrigido' : 'Motivo da recusa'}
            </span>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              placeholder="Imagem ilegível. Envie uma foto mais nítida."
              className="toque mt-1 w-full rounded-xl border border-(--color-borda-forte) bg-(--color-cartao) px-3 py-2 text-sm"
            />
          </label>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {pedindo ? (
          <>
            <Botao
              variante={pedindo === 'rejeitado' ? 'perigo' : 'principal'}
              carregando={salvando}
              onClick={() => void decidir(pedindo)}
            >
              {pedindo === 'correcao' ? 'Solicitar correção' : 'Rejeitar'}
            </Botao>
            <Botao variante="fantasma" onClick={() => setPedindo(null)}>
              Cancelar
            </Botao>
          </>
        ) : (
          <>
            <Botao carregando={salvando} onClick={() => void decidir('aprovado')}>
              <Check size={15} /> Aprovar
            </Botao>
            <Botao variante="secundario" onClick={() => setPedindo('correcao')}>
              Solicitar correção
            </Botao>
            <Botao variante="fantasma" onClick={() => setPedindo('rejeitado')}>
              Rejeitar
            </Botao>
          </>
        )}
      </div>
    </div>
  )
}

// ================================================================ entrega

/**
 * O que a pessoa entrega: o número, a validade e/ou o arquivo.
 *
 * O formulário mostra só o que o requisito EXIGE. Pedir a validade de um CPF
 * porque o formulário é genérico é como o app inventa trabalho que ninguém pediu.
 *
 * O arquivo tem dois caminhos, e os dois existem: subir um novo (que entra no
 * cofre como documento pessoal) ou apontar um que já está lá. Sem o segundo, o
 * passaporte anexado aqui seria uma cópia do passaporte que já está no cofre — e
 * as duas versões divergiriam na primeira renovação.
 */
function FormEntrega({ celula, aoFechar }: { celula: Celula; aoFechar: () => void }) {
  const { snapshot, mutate, recarregar } = useTrip()
  const avisar = useAviso()
  const req = celula.requisito
  const sub = celula.submissao

  const [numero, setNumero] = useState(sub?.numero ?? '')
  const [validade, setValidade] = useState(sub?.validade?.slice(0, 10) ?? '')
  const [emitido, setEmitido] = useState(sub?.emitido_em?.slice(0, 10) ?? '')
  const [documentoId, setDocumentoId] = useState(sub?.documento_id ?? '')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  // Quais campos esta tela preencheu sozinha, para a dica dizer de onde vieram.
  const [doPerfil, setDoPerfil] = useState<string[]>([])
  const [progresso, setProgresso] = useState<ProgressoEnvio | null>(null)

  // O formulário abre com o que a pessoa JÁ cadastrou no perfil da conta.
  //
  // O snapshot não serve para isto de propósito: ele carrega só quais campos
  // estão preenchidos, nunca os valores, para o número do passaporte de um não
  // trafegar para a viagem inteira (`PerfilResumo`, lib/documentacao.ts).
  // `GET /api/perfil` é a única rota que devolve valores, e devolve os da própria
  // conta — por isso a busca só acontece quando a linha é a minha.
  const souEu = celula.traveler_id === String(snapshot?.eu?.participanteId ?? '')
  useEffect(() => {
    const ficha = fichaCampoPerfil(req.campo_perfil)
    if (!souEu || !ficha) return
    let vivo = true
    void fetch('/api/perfil')
      .then((r) => (r.ok ? r.json() : null))
      .then((corpo: { viagem?: Record<string, string | null> } | null) => {
        const perfil = corpo?.viagem
        if (!vivo || !perfil) return
        // Funcional e com `||`: a resposta chega depois da primeira pintura, e a
        // entrega já gravada — ou o que a pessoa começou a digitar enquanto isso —
        // ganha do perfil. Sobrescrever seria apagar a correção em andamento.
        const valor = (coluna?: string | null) => (coluna ? (perfil[coluna] ?? '').trim() : '')
        const numeroPerfil = valor(ficha.coluna)
        const validadePerfil = valor(ficha.validade)
        const emissaoPerfil = valor(ficha.emissao)

        const veio: string[] = []
        if (numeroPerfil && !sub?.numero) {
          setNumero((a) => a || numeroPerfil)
          veio.push('numero')
        }
        if (validadePerfil && !sub?.validade) {
          setValidade((a) => a || validadePerfil)
          veio.push('validade')
        }
        if (emissaoPerfil && !sub?.emitido_em) setEmitido((a) => a || emissaoPerfil)
        setDoPerfil(veio)
      })
    return () => {
      vivo = false
    }
  }, [souEu, req.campo_perfil, sub?.numero, sub?.validade, sub?.emitido_em])

  // Só os documentos DESTA pessoa entram na lista de anexos existentes. O
  // snapshot já não traz os alheios, mas a tela não depende disso para acertar.
  const meusDocumentos = useMemo(
    () =>
      ((snapshot?.documentos ?? []) as unknown as Documento[]).filter(
        (d) => d.traveler_id === celula.traveler_id && d.tipo === 'arquivo',
      ),
    [snapshot?.documentos, celula.traveler_id],
  )

  // O que o formulário COBRA é `celula.falta`, não `req.exige_*`.
  //
  // Um passaporte cujo número e validade já estão no perfil não pode exigir que
  // a pessoa os digite de novo aqui só porque o requisito diz "exige número" —
  // ela já os cadastrou, e o app estaria pedindo o mesmo dado duas vezes. Ver
  // `faltando` em lib/documentacao.ts, que é quem sabe o que veio do perfil.
  const falta = (p: 'numero' | 'validade' | 'arquivo') => celula.falta.includes(p)

  const salvar = async () => {
    if (falta('numero') && !numero.trim()) return setErro('Informe o número do documento.')
    if (falta('validade') && !validade) return setErro('Informe a data de validade.')
    if (falta('arquivo') && !arquivo && !documentoId) {
      return setErro('Anexe o arquivo ou escolha um que já esteja no seu cofre.')
    }
    setErro(null)
    setSalvando(true)
    try {
      let anexo = documentoId

      // O arquivo entra pelo cofre, não por uma tabela paralela: ele PRECISA
      // aparecer em "Meus documentos" e viajar offline como qualquer outro.
      if (arquivo) {
        // Encolhe foto grande, recusa o que passa do teto e fatia o resto em
        // quantas requisições couberem. Ver lib/arquivo.ts.
        const enviado = await enviarArquivo({
          arquivo,
          tripId: String(snapshot?.viagem?.id ?? ''),
          campos: {
            titulo: req.nome,
            categoria: req.categoria ?? 'pessoal',
            escopo: 'pessoal',
            traveler_id: celula.traveler_id,
            validade: validade || null,
            // Documento exigido é justamente o que não pode faltar sem sinal.
            offline: true,
            importante: true,
          },
          aoProgredir: setProgresso,
        })
        anexo = enviado.documento_id
        await recarregar()
      }

      await mutate({
        op: sub?.id ? 'editar' : 'criar',
        entidade: 'entrega',
        id: sub?.id ?? null,
        campos: {
          requirement_id: req.id,
          traveler_id: celula.traveler_id,
          numero: numero.trim() || null,
          validade: validade || null,
          emitido_em: emitido || null,
          documento_id: anexo || null,
          // Reenviar limpa o veredito anterior; quem faz isso é o servidor.
          status: 'enviado',
        },
        client_ts: new Date().toISOString(),
      })

      avisar('sucesso', 'Documentação enviada. Quem organiza a viagem vai revisar.')
      aoFechar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
      setProgresso(null)
    }
  }

  const nadaExigido = !req.exige_numero && !req.exige_validade && !req.exige_arquivo

  return (
    <AppModal
      titulo={req.nome}
      descricao={req.descricao ?? undefined}
      tamanho="pequeno"
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={() => void salvar()} carregando={salvando}>
            Enviar
          </Botao>
        </>
      }
    >
      <div className="space-y-3">
        {erro && <Falha texto={erro} />}

        {progresso && progresso.partes > 1 && (
          <div aria-live="polite">
            <p className="t-aux">
              Enviando parte {progresso.parte} de {progresso.partes} —{' '}
              {formatarTamanho(progresso.enviado)} de {formatarTamanho(progresso.total)}
            </p>
            <Progresso
              pct={(progresso.enviado / progresso.total) * 100}
              rotulo="Enviando arquivo"
            />
          </div>
        )}

        {nadaExigido && (
          <p className="t-aux">
            Este requisito só pede a sua confirmação. Enviar marca como cumprido para quem organiza
            a viagem.
          </p>
        )}

        {req.exige_numero && (
          <Campo
            rotulo="Número"
            valor={numero}
            aoMudar={setNumero}
            dica={
              doPerfil.includes('numero')
                ? 'Veio do seu perfil'
                : req.campo_perfil
                  ? 'Preencha uma vez só no seu perfil'
                  : undefined
            }
            placeholder="XX123456"
          />
        )}

        {req.exige_validade && (
          <Campo
            rotulo="Válido até"
            valor={validade}
            aoMudar={setValidade}
            tipo="date"
            dica={doPerfil.includes('validade') ? 'Veio do seu perfil' : undefined}
          />
        )}

        {(req.exige_validade || req.exige_arquivo) && (
          <Campo rotulo="Emitido em" valor={emitido} aoMudar={setEmitido} tipo="date" />
        )}

        {req.exige_arquivo && (
          <>
            <label className="block">
              <span className="t-aux">
                Arquivo (PDF, JPG, PNG ou WEBP, até {LIMITE_TEXTO} — foto grande é reduzida no
                envio)
              </span>
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  setArquivo(e.target.files?.[0] ?? null)
                  if (e.target.files?.[0]) setDocumentoId('')
                }}
                className="toque mt-1 w-full rounded-xl border border-(--color-borda-forte) bg-(--color-cartao) px-3 py-2 text-sm"
              />
            </label>

            {meusDocumentos.length > 0 && !arquivo && (
              <Selecao
                rotulo="Ou use um documento que já está no cofre"
                valor={documentoId}
                aoMudar={setDocumentoId}
                opcoes={[
                  { valor: '', nome: 'Nenhum' },
                  ...meusDocumentos.map((d) => ({ valor: d.id, nome: d.titulo })),
                ]}
              />
            )}
          </>
        )}
      </div>
    </AppModal>
  )
}

// ================================================================ requisito

type RascunhoRequisito = {
  nome: string
  categoria: string
  descricao: string
  obrigatorio: boolean
  aplica_todos: boolean
  assigned_to: string[]
  exige_numero: boolean
  exige_validade: boolean
  exige_arquivo: boolean
  campo_perfil: string
  prazo: string
  obs: string
}

function rascunhoDe(r?: Requisito | null): RascunhoRequisito {
  return {
    nome: r?.nome ?? '',
    categoria: r?.categoria ?? '',
    descricao: r?.descricao ?? '',
    obrigatorio: r?.obrigatorio !== false,
    aplica_todos: r?.aplica_todos !== false,
    assigned_to: r?.assigned_to ?? [],
    exige_numero: Boolean(r?.exige_numero),
    exige_validade: Boolean(r?.exige_validade),
    exige_arquivo: Boolean(r?.exige_arquivo),
    campo_perfil: r?.campo_perfil ?? '',
    prazo: r?.prazo?.slice(0, 10) ?? '',
    obs: r?.obs ?? '',
  }
}

/** Atalhos do que quase toda viagem exige. Não são regra legal — são o formulário
    já preenchido, que é o que faz a diferença entre cadastrar cinco requisitos e
    desistir no segundo. Quem cadastra ainda revisa tudo antes de salvar. */
const MODELOS: { nome: string; ficha: Partial<RascunhoRequisito> }[] = [
  {
    nome: 'Passaporte',
    ficha: {
      nome: 'Passaporte',
      categoria: 'passaporte',
      campo_perfil: 'passaporte',
      exige_numero: true,
      exige_validade: true,
      exige_arquivo: true,
      descricao: 'Passaporte válido durante toda a viagem.',
    },
  },
  {
    nome: 'Seguro viagem',
    ficha: {
      nome: 'Seguro viagem',
      categoria: 'seguro',
      exige_numero: true,
      exige_validade: true,
      exige_arquivo: true,
      descricao: 'Apólice com cobertura para todo o período.',
    },
  },
  {
    nome: 'CPF',
    ficha: { nome: 'CPF', categoria: 'pessoal', campo_perfil: 'cpf', exige_numero: true },
  },
  {
    nome: 'Contato de emergência',
    ficha: {
      nome: 'Contato de emergência',
      categoria: 'emergencia',
      campo_perfil: 'emergencia',
    },
  },
  {
    nome: 'Comprovante de vacinação',
    ficha: { nome: 'Comprovante de vacinação', categoria: 'saude', exige_arquivo: true },
  },
  {
    nome: 'Carteira de motorista',
    ficha: {
      nome: 'Carteira de motorista',
      categoria: 'pessoal',
      obrigatorio: false,
      aplica_todos: false,
      exige_numero: true,
      exige_validade: true,
      exige_arquivo: true,
      descricao: 'Só para quem vai dirigir.',
    },
  },
]

function FormRequisito({
  requisito,
  aoFechar,
}: {
  requisito: Requisito | null
  aoFechar: () => void
}) {
  const { snapshot, mutate } = useTrip()
  const avisar = useAviso()
  const [d, setD] = useState<RascunhoRequisito>(() => rascunhoDe(requisito))
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const participantes = snapshot?.participantes ?? []
  const set = <K extends keyof RascunhoRequisito>(k: K, v: RascunhoRequisito[K]) =>
    setD((r) => ({ ...r, [k]: v }))

  const salvar = async () => {
    if (!d.nome.trim()) return setErro('Dê um nome ao requisito.')
    if (!d.aplica_todos && d.assigned_to.length === 0) {
      return setErro('Escolha quem precisa entregar este documento.')
    }
    setErro(null)
    setSalvando(true)
    try {
      await mutate({
        op: requisito?.id ? 'editar' : 'criar',
        entidade: 'requisito',
        id: requisito?.id ?? null,
        campos: {
          nome: d.nome.trim(),
          categoria: d.categoria || null,
          descricao: d.descricao.trim() || null,
          obrigatorio: d.obrigatorio,
          aplica_todos: d.aplica_todos,
          assigned_to: d.aplica_todos ? [] : d.assigned_to,
          exige_numero: d.exige_numero,
          exige_validade: d.exige_validade,
          exige_arquivo: d.exige_arquivo,
          campo_perfil: d.campo_perfil || null,
          prazo: d.prazo || null,
          obs: d.obs.trim() || null,
        },
        client_ts: new Date().toISOString(),
      })
      avisar('sucesso', requisito?.id ? 'Requisito atualizado.' : 'Requisito criado.')
      aoFechar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <AppModal
      titulo={requisito?.id ? 'Editar requisito' : 'Adicionar requisito'}
      descricao="O que cada participante precisa ter para esta viagem."
      tamanho="pequeno"
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={() => void salvar()} carregando={salvando}>
            Salvar requisito
          </Botao>
        </>
      }
    >
      <div className="space-y-3">
        {erro && <Falha texto={erro} />}

        {!requisito?.id && (
          <div>
            <Rotulo>Começar de um modelo</Rotulo>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {MODELOS.map((m) => (
                <button
                  key={m.nome}
                  onClick={() => setD((r) => ({ ...r, ...m.ficha }))}
                  className="toque cursor-pointer rounded-full border border-(--color-borda-forte) px-3 text-sm hover:bg-(--color-superficie-2)"
                >
                  {m.nome}
                </button>
              ))}
            </div>
          </div>
        )}

        <Campo rotulo="Nome" valor={d.nome} aoMudar={(v) => set('nome', v)} obrigatorio />

        <Selecao
          rotulo="Categoria"
          valor={d.categoria}
          aoMudar={(v) => set('categoria', v)}
          opcoes={[
            { valor: '', nome: 'Sem categoria' },
            ...CATEGORIAS_DOCUMENTO.map((c) => ({ valor: c, nome: CATEGORIAS[c].rotulo })),
          ]}
        />

        <label className="block">
          <span className="t-aux">Descrição</span>
          <textarea
            value={d.descricao}
            onChange={(e) => set('descricao', e.target.value)}
            rows={2}
            placeholder="Passaporte válido para toda a viagem."
            className="toque mt-1 w-full rounded-xl border border-(--color-borda-forte) bg-(--color-cartao) px-3 py-2 text-sm"
          />
        </label>

        <Interruptor
          rotulo="Obrigatório"
          descricao="Desligado, ele aparece como recomendado e não conta como pendência."
          ligado={d.obrigatorio}
          aoMudar={(v) => set('obrigatorio', v)}
        />

        <Interruptor
          rotulo="Vale para todos"
          descricao="Inclusive quem entrar na viagem depois."
          ligado={d.aplica_todos}
          aoMudar={(v) => set('aplica_todos', v)}
        />

        {!d.aplica_todos && (
          <div>
            <Rotulo>Quem precisa entregar</Rotulo>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {participantes.map((p) => {
                const id = String(p.id)
                const marcado = d.assigned_to.includes(id)
                return (
                  <button
                    key={id}
                    onClick={() =>
                      set(
                        'assigned_to',
                        marcado ? d.assigned_to.filter((x) => x !== id) : [...d.assigned_to, id],
                      )
                    }
                    aria-pressed={marcado}
                    className="toque cursor-pointer rounded-full border px-3 text-sm"
                    style={
                      marcado
                        ? {
                            background: 'var(--color-destaque-fraco)',
                            borderColor: 'var(--destaque)',
                            color: 'var(--destaque)',
                          }
                        : { borderColor: 'var(--color-borda-forte)' }
                    }
                  >
                    {String(p.nome)}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-(--color-borda) p-3">
          <Rotulo>O que precisa ser entregue</Rotulo>
          <Interruptor
            rotulo="Número"
            descricao="Número do passaporte, da apólice, do CPF."
            ligado={d.exige_numero}
            aoMudar={(v) => set('exige_numero', v)}
          />
          <Interruptor
            rotulo="Data de validade"
            ligado={d.exige_validade}
            aoMudar={(v) => set('exige_validade', v)}
          />
          <Interruptor
            rotulo="Arquivo (PDF ou imagem)"
            ligado={d.exige_arquivo}
            aoMudar={(v) => set('exige_arquivo', v)}
          />
        </div>

        <Selecao
          rotulo="Puxar do perfil"
          valor={d.campo_perfil}
          aoMudar={(v) =>
            // Campo de perfil que carrega vencimento (passaporte) já traz a
            // validade junto: é o dado que o §22 acompanha, e deixá-lo desligado
            // criaria um requisito que nunca avisa que venceu. Vale no momento da
            // ESCOLHA — quem quiser desligar depois, desliga.
            setD((r) => ({
              ...r,
              campo_perfil: v,
              exige_validade: CAMPOS_PERFIL[v]?.validade ? true : r.exige_validade,
            }))
          }
          dica="Evita pedir o mesmo dado a cada viagem"
          opcoes={[
            { valor: '', nome: 'Não puxar — o dado vale só nesta viagem' },
            ...CAMPOS_PERFIL_REQUISITO.map((c) => ({
              valor: c,
              nome: CAMPOS_PERFIL[c]?.rotulo ?? c,
            })),
          ]}
        />

        <Campo
          rotulo="Prazo para envio"
          valor={d.prazo}
          aoMudar={(v) => set('prazo', v)}
          tipo="date"
          dica="Diferente da validade do documento"
        />

        <Campo rotulo="Observação" valor={d.obs} aoMudar={(v) => set('obs', v)} />
      </div>
    </AppModal>
  )
}

// ================================================================ detalhe do participante

function DetalheParticipante({
  travelerId,
  aoFechar,
}: {
  travelerId: string
  aoFechar: () => void
}) {
  const { matriz, perfilDe, nomeDe, participantes } = useDocumentacao()
  const [celulaAberta, setCelulaAberta] = useState<Celula | null>(null)

  const celulas = useMemo(
    () => ordenarCelulas(matriz.porParticipante.get(travelerId) ?? []),
    [matriz, travelerId],
  )
  const resumo = useMemo(() => resumir(celulas), [celulas])
  const pessoa = participantes.find((p) => p.id === travelerId)
  const perfil = perfilDe.get(travelerId)

  if (celulaAberta) {
    return (
      <FichaCelula
        celula={celulaAberta}
        vencimento={vencimentoDe(celulaAberta, perfilDe)}
        aoFechar={() => setCelulaAberta(null)}
      />
    )
  }

  return (
    <AppModal
      titulo={`Documentação de ${nomeDe.get(travelerId) ?? ''}`}
      descricao={`${celulas.filter((c) => entregue(c.estado)).length} de ${celulas.length} completos`}
      tamanho="medio"
      aoFechar={aoFechar}
      acoes={
        <Botao variante="secundario" onClick={aoFechar}>
          Fechar
        </Botao>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Anel
            pct={resumo.pct}
            tamanho={72}
            tom={resumo.pct === 100 ? 'sucesso' : resumo.problemas > 0 ? 'perigo' : undefined}
            legenda={`${resumo.pct}% completo`}
          />
          <div className="flex flex-wrap gap-1.5">
            {resumo.completos > 0 && (
              <Badge tipo="sucesso" texto={`${resumo.completos} aprovados`} />
            )}
            {resumo.revisando > 0 && <Badge tipo="info" texto={`${resumo.revisando} em revisão`} />}
            {resumo.pendentes > 0 && (
              <Badge tipo="neutro" texto={`${resumo.pendentes} pendentes`} />
            )}
            {resumo.problemas > 0 && (
              <Badge tipo="perigo" texto={`${resumo.problemas} com problema`} />
            )}
          </div>
        </div>

        {/* Só quais campos do perfil estão preenchidos — nunca os valores. O
            servidor não os manda, e é essa a razão: uma bolinha verde não
            justifica publicar o CPF de cinco pessoas. */}
        {perfil && (
          <div>
            <Rotulo>Dados de viagem no perfil</Rotulo>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {Object.entries(CAMPOS_PERFIL).map(([chave, ficha]) => (
                <Badge
                  key={chave}
                  tipo={perfil.campos?.[chave] ? 'sucesso' : 'neutro'}
                  texto={ficha.rotulo}
                  icone={perfil.campos?.[chave] ? <Check size={11} /> : <X size={11} />}
                />
              ))}
            </div>
          </div>
        )}

        <div>
          <Rotulo>Documentos exigidos</Rotulo>
          <div className="mt-1.5 space-y-2">
            {celulas.length === 0 ? (
              <p className="t-aux">Nenhum requisito se aplica a {pessoa?.nome ?? 'esta pessoa'}.</p>
            ) : (
              celulas.map((c) => (
                <LinhaRequisito
                  key={c.requisito.id}
                  celula={c}
                  vencimento={vencimentoDe(c, perfilDe)}
                  aoAbrir={() => setCelulaAberta(c)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </AppModal>
  )
}

// ================================================================ integrações

/**
 * O aviso de documentação nas telas que não são esta (§20).
 *
 * Aparece no Início e no Cofre. É a mesma pergunta do app inteiro — "o que eu
 * preciso fazer agora?" — respondida onde a pessoa já está, em vez de esperar
 * que ela abra a aba certa.
 */
export function AvisoDocumentacao({ aoAbrir }: { aoAbrir: () => void }) {
  const { matriz, eu } = useDocumentacao()
  const pendentes = useMemo(() => (eu ? pendenciasDe(matriz, eu) : []), [matriz, eu])

  if (pendentes.length === 0) return null
  const pior = pendentes[0]
  const e = ESTADOS[pior.estado]

  return (
    <Cartao tom={e.tom === 'perigo' ? 'perigo' : 'atencao'}>
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" style={{ color: TONS[e.tom]?.ink }} />
        <div className="min-w-0 flex-1">
          <p className="t-corpo font-medium">
            {pior.estado === 'vencido'
              ? `Seu ${pior.requisito.nome.toLowerCase()} está vencido.`
              : pior.estado === 'proximo'
                ? `Seu ${pior.requisito.nome.toLowerCase()} vence em ${pior.validade?.dias} dias.`
                : pior.estado === 'correcao' || pior.estado === 'rejeitado'
                  ? `Seu ${pior.requisito.nome.toLowerCase()} precisa ser reenviado.`
                  : `Você ainda precisa enviar seu ${pior.requisito.nome.toLowerCase()}.`}
          </p>
          <p className="t-aux mt-0.5">
            {pendentes.length > 1
              ? `E mais ${pendentes.length - 1} documento${pendentes.length > 2 ? 's' : ''} da viagem.`
              : 'É o último item da sua documentação.'}
          </p>
        </div>
        <Botao variante="secundario" onClick={aoAbrir}>
          Resolver
        </Botao>
      </div>
    </Cartao>
  )
}

/**
 * Os itens de checklist que a documentação gera (§26).
 *
 * São VIRTUAIS: não existe linha em `checklist_items` e não há o que marcar à
 * mão. O item fica feito quando o documento é entregue, e por isso não tem como
 * divergir do cofre — que é exatamente o que "não duplicar dados" quer dizer.
 */
export function ChecklistDocumentacao({ aoAbrir }: { aoAbrir: () => void }) {
  const { matriz, eu } = useDocumentacao()
  const itens = useMemo(() => (eu ? checklistDaDocumentacao(matriz, eu) : []), [matriz, eu])

  if (itens.length === 0) return null
  const feitos = itens.filter((i) => i.feito).length

  return (
    <Cartao className="mb-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <Rotulo>Documentação</Rotulo>
        <span className="t-aux tab-num">
          {feitos}/{itens.length}
        </span>
      </div>
      <ul className="space-y-1.5">
        {itens.map((i) => (
          <li key={i.id} className="flex items-center gap-2 text-sm">
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border"
              style={
                i.feito
                  ? {
                      background: 'var(--color-sucesso-ink)',
                      borderColor: 'var(--color-sucesso-ink)',
                      color: '#fff',
                    }
                  : { borderColor: 'var(--color-borda-forte)' }
              }
              aria-hidden
            >
              {i.feito && <Check size={13} strokeWidth={3} />}
            </span>
            <span className={`min-w-0 flex-1 truncate ${i.feito ? 'text-(--color-tinta-3)' : ''}`}>
              {i.titulo}
            </span>
            <SeloEstado estado={i.estado} />
          </li>
        ))}
      </ul>
      <button
        onClick={aoAbrir}
        className="toque mt-2 cursor-pointer text-sm font-medium text-(--destaque) hover:underline"
      >
        Abrir minha documentação
      </button>
    </Cartao>
  )
}

/**
 * Os documentos exigidos que valem para um dia do roteiro (§27).
 *
 * "Do dia" é mais largo do que uma data igual: quem embarca hoje precisa do
 * passaporte, que não tem data presa a ele. Ver `requisitosDoDia`.
 */
export function RequisitosDoDia({ dia }: { dia: string }) {
  const { matriz, eu } = useDocumentacao()

  const doDia = useMemo(() => {
    const minhas = matriz.porParticipante.get(eu) ?? []
    return ordenarCelulas(
      minhas.filter(
        (c) =>
          aplicaA(c.requisito, eu) &&
          (c.requisito.obrigatorio !== false ||
            (c.requisito.prazo != null && c.requisito.prazo <= dia)),
      ),
    )
  }, [matriz, eu, dia])

  if (doDia.length === 0) return null
  const faltando = doDia.filter((c) => ESTADOS[c.estado].ativo)

  return (
    <div className="rounded-2xl border border-(--color-borda) bg-(--color-cartao) p-3">
      <div className="mb-2 flex items-center gap-2">
        <ShieldCheck size={15} className="text-(--color-tinta-3)" />
        <Rotulo>Documentos que a viagem exige de você</Rotulo>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {doDia.map((c) => (
          <li key={c.requisito.id}>
            <Badge tipo={ESTADOS[c.estado].tom} texto={c.requisito.nome} />
          </li>
        ))}
      </ul>
      {faltando.length > 0 && (
        <p className="t-aux mt-2 flex items-center gap-1.5 text-(--color-perigo-ink)">
          <BellRing size={13} /> {faltando.length} ainda não{' '}
          {faltando.length > 1 ? 'estão prontos' : 'está pronto'}.
        </p>
      )}
    </div>
  )
}
