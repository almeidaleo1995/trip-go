'use client'

// As peças de um documento: o semáforo, o cartão da lista, o preview e o modal de
// adicionar/editar.
//
// A tela que compõe tudo isso é `tabs/Cofre.tsx`. Aqui não há layout de página —
// estas peças também são usadas pelo roteiro, pelos voos e pela hospedagem.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BadgeCheck,
  Bus,
  CircleAlert,
  CloudOff,
  Cross,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  Hotel,
  IdCard,
  LifeBuoy,
  Loader2,
  Lock,
  Plane,
  Share2,
  ShieldCheck,
  Star,
  Ticket,
  Train,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  AppModal,
  Avatar,
  Badge,
  Botao,
  BotaoIcone,
  Campo,
  Falha,
  Interruptor,
  Progresso,
  Rotulo,
  Selecao,
  TONS,
  useAviso,
} from './ui.tsx'
import { useTrip } from './TripProvider.tsx'
import {
  CATEGORIAS,
  extensao,
  fichaCategoria,
  documentosDe,
  documentosDoDia,
  formatarTamanho,
  podeApagar,
  podeEscrever,
  statusOffline,
  statusValidade,
  temArquivo,
  type Categoria,
  type Documento,
  type StatusOffline,
} from '@/lib/cofre.ts'
// `Progresso` ja e o componente de barra do design system; aqui o tipo entra
// como `ProgressoEnvio` para nao brigar com ele.
import { enviarArquivo, type Progresso as ProgressoEnvio } from '@/lib/arquivo.ts'
import { abrir, esquecerOffline, jaSalvos, salvarOffline, sincronizar } from '@/lib/cofreOffline.ts'
import { CATEGORIAS_DOCUMENTO } from '@/lib/schema.ts'
import { formatarData } from '@/lib/derive.ts'

// ---------------------------------------------------------------- ícones

/** Um ícone por categoria. A tabela de rótulo/tom vive em `lib/cofre.ts`, que roda sem DOM. */
export const ICONE_CATEGORIA: Record<Categoria, LucideIcon> = {
  pessoal: IdCard,
  passaporte: BadgeCheck,
  seguro: ShieldCheck,
  voo: Plane,
  trem: Train,
  onibus: Bus,
  hospedagem: Hotel,
  reserva: Hotel,
  ingresso: Ticket,
  transfer: Bus,
  financeiro: CreditCard,
  saude: Cross,
  emergencia: LifeBuoy,
  outro: FileText,
}

/**
 * A chave de ícone de uma categoria — devolve a CHAVE, não o componente.
 *
 * Duas restrições se cruzam aqui. `documents.categoria` é texto livre, então
 * indexar `ICONE_CATEGORIA` com ele direto não compila (e, antes do tipo ser
 * corrigido, derrubava a tela). E o lint recusa uma função que DEVOLVE
 * componente dentro do render, porque isso conta como componente novo a cada
 * pintura, que remonta e perde estado.
 *
 * Devolver a chave atende as duas: quem chama faz
 * `ICONE_CATEGORIA[chaveIcone(...)]`, que é acesso direto a um mapa com uma
 * chave que o tipo garante existir.
 */
export function chaveIcone(categoria: string | null | undefined): Categoria {
  return categoria && categoria in ICONE_CATEGORIA ? (categoria as Categoria) : 'outro'
}

// ---------------------------------------------------------------- estado offline

/**
 * O estado do cofre NESTE aparelho.
 *
 * Ele é separado do snapshot de propósito: `documents.offline` é a intenção do
 * grupo, e isto aqui é o fato local. Um hook porque três telas diferentes
 * (cofre, roteiro, voo) precisam saber se um documento abre sem rede.
 */
export function useCofre(documentos: Documento[]) {
  const [salvos, setSalvos] = useState<Set<string>>(new Set())
  const [erros, setErros] = useState<Map<string, string>>(new Map())
  const [sincronizando, setSincronizando] = useState(false)
  const { online } = useTrip()

  // A lista de ids marcados como offline é o que dispara uma nova sincronização.
  // Comparar o array inteiro re-sincronizaria a cada repintura do snapshot, e
  // baixar tudo de novo em roaming é caro de verdade.
  const alvo = documentos
    .filter((d) => d.offline && temArquivo(d))
    .map((d) => d.id)
    .sort()
    .join(',')

  const rodar = useCallback(async () => {
    setSincronizando(true)
    const r = await sincronizar(documentos)
    setSalvos(r.salvos)
    setErros(r.erros)
    setSincronizando(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo])

  useEffect(() => {
    // Sem rede não adianta tentar baixar: lê só o que já está guardado, para os
    // semáforos ficarem certos em modo avião em vez de acusarem erro em tudo.
    if (!online) {
      void jaSalvos().then(setSalvos)
      return
    }
    void rodar()
  }, [rodar, online])

  const marcar = useCallback(async (doc: Documento, offline: boolean) => {
    if (offline) {
      try {
        await salvarOffline(doc)
        setSalvos((s) => new Set(s).add(doc.id))
        setErros((e) => {
          const n = new Map(e)
          n.delete(doc.id)
          return n
        })
      } catch (err) {
        setErros((e) =>
          new Map(e).set(doc.id, err instanceof Error ? err.message : 'Falha ao preparar.'),
        )
        throw err
      }
    } else {
      await esquecerOffline(doc.id)
      setSalvos((s) => {
        const n = new Set(s)
        n.delete(doc.id)
        return n
      })
    }
  }, [])

  return { salvos, erros, sincronizando, ressincronizar: rodar, marcar }
}

// ---------------------------------------------------------------- semáforo

const SEMAFORO: Record<StatusOffline, { tom: string; texto: string; curto: string }> = {
  disponivel: { tom: 'sucesso', texto: 'Disponível offline', curto: 'Offline' },
  aguardando: { tom: 'atencao', texto: 'Aguardando download', curto: 'Baixando' },
  erro: { tom: 'perigo', texto: 'Problema ao salvar offline', curto: 'Erro' },
  online: { tom: 'neutro', texto: 'Somente online', curto: 'Online' },
}

/**
 * O semáforo do §2. Cor NUNCA vai sozinha: cada estado leva ícone e palavra, que
 * é o que faz a informação chegar a quem não distingue verde de vermelho — e a
 * quem está com o celular no sol de Lisboa.
 */
export function SeloOffline({ status, curto = false }: { status: StatusOffline; curto?: boolean }) {
  const s = SEMAFORO[status]
  const Icone =
    status === 'disponivel'
      ? BadgeCheck
      : status === 'erro'
        ? CircleAlert
        : status === 'aguardando'
          ? Loader2
          : CloudOff
  return (
    <Badge
      tipo={s.tom}
      texto={curto ? s.curto : s.texto}
      icone={<Icone size={13} className={status === 'aguardando' ? 'animate-spin' : undefined} />}
    />
  )
}

// ---------------------------------------------------------------- dono

/**
 * De quem é um documento pessoal — a informação que faltava no cartão.
 *
 * Quem organiza a viagem vê o cofre inteiro, e cinco linhas chamadas "Passaporte"
 * são indistinguíveis sem isto. Aparece só em documento `pessoal`: repetir
 * "todos os participantes" em cada reserva de hotel seria ruído.
 *
 * Documento SEU não mostra o seu nome, mostra um cadeado — a pergunta que você
 * faz sobre o próprio documento não é "de quem é", é "quem mais vê isto".
 */
function MarcaDono({ doc }: { doc: Documento }) {
  const { snapshot } = useTrip()
  if (doc.escopo !== 'pessoal') return null

  const eu = snapshot?.eu?.participanteId
  const dono = (snapshot?.participantes ?? []).find((p) => String(p.id) === doc.traveler_id)
  const compartilhado = doc.assigned_to?.length ?? 0

  if (doc.traveler_id === eu) {
    return (
      <span className="inline-flex items-center gap-1">
        <Lock size={11} aria-hidden />
        {compartilhado > 0 ? `Você e mais ${compartilhado}` : 'Só você'}
      </span>
    )
  }

  const nome = dono ? String(dono.nome) : 'Documento pessoal'
  return (
    <span className="inline-flex items-center gap-1" title={`Documento pessoal de ${nome}`}>
      <Avatar nome={nome} url={dono?.avatar_url as string | null} tamanho={14} />
      {nome.split(/\s+/)[0]}
    </span>
  )
}

// ---------------------------------------------------------------- cartão

/**
 * Uma linha do cofre. É um botão inteiro, não um título clicável com ícones
 * soltos: a mão que abre isto está segurando uma mala.
 */
export function CartaoDocumento({
  doc,
  status,
  ativo,
  aoAbrir,
}: {
  doc: Documento
  status: StatusOffline
  ativo?: boolean
  aoAbrir: () => void
}) {
  const Icone = ICONE_CATEGORIA[chaveIcone(doc.categoria)]
  const tom = TONS[fichaCategoria(doc.categoria).tom] ?? TONS.neutro
  const validade = statusValidade(doc.validade)
  const ext = extensao(doc)

  return (
    <button
      onClick={aoAbrir}
      aria-current={ativo ? 'true' : undefined}
      className="toque group flex w-full cursor-pointer items-center gap-3 rounded-2xl border p-3 text-left transition-shadow hover:shadow-[var(--sombra-2)]"
      style={{
        background: 'var(--color-cartao)',
        borderColor: ativo ? 'var(--destaque)' : 'var(--color-borda)',
        boxShadow: ativo ? '0 0 0 1px var(--destaque)' : 'var(--sombra-1)',
      }}
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{ background: tom.bg, color: tom.ink }}
      >
        <Icone size={18} strokeWidth={1.9} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {doc.importante && (
            <Star
              size={13}
              className="shrink-0 fill-current text-(--color-atencao-ink)"
              aria-label="Documento importante"
            />
          )}
          <span className="t-corpo truncate font-medium">{doc.titulo}</span>
        </span>
        <span className="t-aux mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {doc.categoria && <span>{fichaCategoria(doc.categoria).rotulo}</span>}
          <MarcaDono doc={doc} />
          {ext && <span className="font-(family-name:--fonte-dados) uppercase">{ext}</span>}
          {doc.arquivo_bytes ? (
            <span className="font-(family-name:--fonte-dados)">
              {formatarTamanho(doc.arquivo_bytes)}
            </span>
          ) : null}
          {!temArquivo(doc) && doc.valor && <span className="truncate">{doc.valor}</span>}
        </span>
        {validade && validade.nivel !== 'ok' && (
          <span className="t-aux mt-1 block text-(--color-perigo-ink)">
            {validade.nivel === 'vencido'
              ? `Venceu em ${formatarData(doc.validade ?? null)}`
              : `Vence em ${formatarData(doc.validade ?? null)}`}
          </span>
        )}
      </span>

      {temArquivo(doc) && (
        <span className="shrink-0">
          <SeloOffline status={status} curto />
        </span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------- preview

/**
 * O documento aberto. PDF e imagem renderizam aqui mesmo (§12): obrigar a baixar
 * um arquivo só para conferir o número do voo é o comportamento que o cofre
 * existe para eliminar.
 *
 * A URL vem de `lib/cofreOffline.ts`, que decide entre aparelho e rede. Esta tela
 * não sabe de onde veio — só mostra qual foi, porque saber que o arquivo abre sem
 * sinal é justamente a garantia que a pessoa quer antes de embarcar.
 */
export function PreviewDocumento({ doc }: { doc: Documento }) {
  const [estado, setEstado] = useState<{
    url?: string
    mime?: string
    origem?: string
    erro?: string
    carregando: boolean
  }>(() => ({ carregando: temArquivo(doc) }))
  const [tentativa, setTentativa] = useState(0)

  // O efeito assina um sistema externo (o cofre) e só grava estado dentro do
  // callback da promessa — nunca de forma síncrona no corpo. `vivo` é o que
  // impede a resposta de um documento antigo de sobrescrever a tela depois que a
  // pessoa já abriu outro: numa lista longa, trocar rápido de cartão fazia o
  // preview piscar o arquivo errado.
  useEffect(() => {
    if (!temArquivo(doc)) return
    let vivo = true
    let criada: string | null = null

    abrir(doc)
      .then((r) => {
        if (!vivo) return URL.revokeObjectURL(r.url)
        criada = r.url
        setEstado({ url: r.url, mime: r.mime, origem: r.origem, carregando: false })
      })
      .catch((e: unknown) => {
        if (!vivo) return
        setEstado({
          erro: e instanceof Error ? e.message : 'Não foi possível abrir.',
          carregando: false,
        })
      })

    return () => {
      // Sem revoke o blob fica preso na memória da aba até a página recarregar.
      vivo = false
      if (criada) URL.revokeObjectURL(criada)
    }
  }, [doc, tentativa])

  const tentarDeNovo = () => {
    setEstado({ carregando: true })
    setTentativa((n) => n + 1)
  }

  // Documento que é um número, um link ou um telefone: o "preview" é o próprio
  // valor, grande e copiável. Não há arquivo nenhum para renderizar.
  if (!temArquivo(doc)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="t-aux">{doc.tipo === 'link' ? 'Link' : 'Valor'}</p>
        {doc.valor ? (
          doc.tipo === 'link' ? (
            <a
              href={doc.valor}
              target="_blank"
              rel="noreferrer"
              className="toque inline-flex items-center gap-1.5 font-medium break-all"
              style={{ color: 'var(--destaque)' }}
            >
              {doc.valor} <ExternalLink size={14} />
            </a>
          ) : (
            <p className="font-(family-name:--fonte-dados) text-2xl font-semibold break-all">
              {doc.valor}
            </p>
          )
        ) : (
          <p className="t-aux">A preencher.</p>
        )}
      </div>
    )
  }

  if (estado.carregando) {
    return (
      <div className="flex h-full items-center justify-center gap-2 p-8">
        <Loader2 size={18} className="animate-spin text-(--color-tinta-3)" />
        <span className="t-aux">Abrindo documento…</span>
      </div>
    )
  }

  if (estado.erro) {
    return (
      <div className="p-6">
        <Falha texto={estado.erro} aoTentar={tentarDeNovo} />
      </div>
    )
  }

  const ehImagem = estado.mime?.startsWith('image/')
  const ehPdf = estado.mime === 'application/pdf'

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto rounded-xl bg-(--color-superficie-2)">
        {ehImagem ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={estado.url} alt={doc.titulo} className="mx-auto h-auto max-w-full" />
        ) : ehPdf ? (
          <object data={estado.url} type="application/pdf" className="h-full min-h-[60vh] w-full">
            {/* Alguns navegadores de celular não embutem PDF. Em vez de uma caixa
                cinza sem explicação, a saída honesta é oferecer abrir fora. */}
            <SemPreview url={estado.url!} />
          </object>
        ) : (
          <SemPreview url={estado.url!} />
        )}
      </div>
      {estado.origem === 'aparelho' && (
        <p className="t-aux mt-2 flex items-center gap-1.5">
          <BadgeCheck size={13} className="text-(--color-sucesso-ink)" />
          Aberto do seu aparelho, sem usar internet.
        </p>
      )}
    </div>
  )
}

function SemPreview({ url }: { url: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <FileText size={28} className="text-(--color-tinta-3)" strokeWidth={1.5} />
      <p className="t-corpo font-medium">Este arquivo não tem visualização rápida.</p>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="toque inline-flex items-center gap-2 rounded-xl px-4 text-sm font-medium text-white"
        style={{ background: 'var(--destaque)' }}
      >
        Abrir documento <ExternalLink size={14} />
      </a>
    </div>
  )
}

// ---------------------------------------------------------------- ações

/** Baixar e compartilhar. São coisas diferentes de "salvar offline" (§26). */
export function AcoesDocumento({ doc }: { doc: Documento }) {
  const avisar = useAviso()
  const [ocupado, setOcupado] = useState(false)

  const comArquivo = async (fn: (blob: Blob, nome: string) => Promise<void> | void) => {
    setOcupado(true)
    try {
      const r = await abrir(doc)
      const resposta = await fetch(r.url)
      const blob = await resposta.blob()
      await fn(blob, doc.arquivo_nome ?? doc.titulo)
      URL.revokeObjectURL(r.url)
    } catch (e) {
      avisar('erro', e instanceof Error ? e.message : 'Não foi possível abrir o documento.')
    } finally {
      setOcupado(false)
    }
  }

  const baixar = () =>
    comArquivo((blob, nome) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nome
      a.click()
      URL.revokeObjectURL(url)
    })

  const compartilhar = () =>
    comArquivo(async (blob, nome) => {
      const arquivo = new File([blob], nome, { type: blob.type })
      // `canShare` antes de `share`: no desktop o share existe mas recusa
      // arquivos, e a promessa rejeitada viraria um erro sem sentido para quem
      // clicou. Sem suporte, baixar é a saída honesta.
      if (navigator.canShare?.({ files: [arquivo] })) {
        await navigator.share({ files: [arquivo], title: doc.titulo })
        return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nome
      a.click()
      URL.revokeObjectURL(url)
      avisar('info', 'Seu navegador não compartilha arquivos. Baixamos o documento.')
    })

  if (!temArquivo(doc)) return null

  return (
    <div className="flex flex-wrap gap-2">
      <Botao variante="secundario" tamanho="pequeno" onClick={baixar} carregando={ocupado}>
        <Download size={14} /> Baixar
      </Botao>
      <Botao variante="secundario" tamanho="pequeno" onClick={compartilhar}>
        <Share2 size={14} /> Compartilhar
      </Botao>
    </div>
  )
}

// ---------------------------------------------------------------- modal

const ACEITOS = 'application/pdf,image/jpeg,image/png,image/webp'

type Rascunho = {
  titulo: string
  categoria: string
  escopo: string
  traveler_id: string
  cidade: string
  pais: string
  dia: string
  flight_id: string
  reservation_id: string
  itinerary_event_id: string
  tags: string
  validade: string
  obs: string
  importante: boolean
  offline: boolean
}

/**
 * `eu` só é passado por quem NÃO organiza a viagem.
 *
 * Um viajante só pode gravar documento pessoal dele — é o que o servidor deixa
 * passar (`autorizar` em /api/mutate e a checagem em /api/documento). O rascunho
 * já nasce assim para o formulário não oferecer uma escolha que vira 403 no
 * salvar: oferecer e recusar depois é pior do que não oferecer.
 */
function rascunhoDe(doc?: Documento | null, eu?: string): Rascunho {
  return {
    titulo: doc?.titulo ?? '',
    categoria: doc?.categoria ?? '',
    escopo: doc?.escopo ?? (eu ? 'pessoal' : 'global'),
    traveler_id: doc?.traveler_id ?? eu ?? '',
    cidade: doc?.cidade ?? '',
    pais: doc?.pais ?? '',
    dia: doc?.dia ?? '',
    flight_id: doc?.flight_id ?? '',
    reservation_id: doc?.reservation_id ?? '',
    itinerary_event_id: doc?.itinerary_event_id ?? '',
    tags: (doc?.tags ?? []).join(', '),
    validade: doc?.validade ?? '',
    obs: doc?.obs ?? '',
    importante: doc?.importante ?? false,
    offline: doc?.offline ?? true,
  }
}

/**
 * Adicionar ou editar um documento. Pequeno, branco e centralizado — não a folha
 * genérica de 16 campos: quem está subindo o voucher do hotel no saguão precisa
 * de nome, categoria e destino, e o resto é opcional.
 *
 * O arquivo sobe por /api/documento (FormData); os metadados de um documento que
 * já existe vão por /api/mutate, como qualquer outra entidade. São dois caminhos
 * porque só um deles carrega bytes — e o de bytes não pode entrar na fila offline.
 */
export function FormDocumento({
  arquivo,
  documento,
  aoFechar,
}: {
  /** Arquivo recém-escolhido. Ausente = editando a ficha de um documento existente. */
  arquivo?: File | null
  documento?: Documento | null
  aoFechar: () => void
}) {
  const { snapshot, mutate, recarregar, posso } = useTrip()
  const avisar = useAviso()
  const soMinhas = !posso('editor')
  const eu = String(snapshot?.eu?.participanteId ?? '')
  const [d, setD] = useState<Rascunho>(() => rascunhoDe(documento, soMinhas ? eu : undefined))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [progresso, setProgresso] = useState<ProgressoEnvio | null>(null)

  const participantes = snapshot?.participantes ?? []
  const lugares = snapshot?.lugares ?? []
  const voos = snapshot?.voos ?? []
  const reservas = snapshot?.reservas ?? []

  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setD((r) => ({ ...r, [k]: v }))

  const campos = () => {
    const lugar = lugares.find((l) => String(l.cidade) === d.cidade)
    return {
      titulo: d.titulo.trim(),
      categoria: d.categoria || null,
      escopo: d.escopo,
      traveler_id: d.escopo === 'pessoal' ? d.traveler_id || null : null,
      cidade: d.cidade || null,
      // O país acompanha a cidade escolhida: pedir os dois seria pedir à pessoa
      // que repita o que a viagem já sabe.
      pais: d.cidade ? ((lugar?.pais as string) ?? null) : d.pais || null,
      dia: d.dia || null,
      flight_id: d.flight_id || null,
      reservation_id: d.reservation_id || null,
      itinerary_event_id: d.itinerary_event_id || null,
      tags: d.tags
        .split(',')
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean),
      validade: d.validade || null,
      obs: d.obs.trim() || null,
      importante: d.importante,
      offline: d.offline,
    }
  }

  const salvar = async () => {
    if (!d.titulo.trim()) return setErro('Dê um nome ao documento.')
    if (d.escopo === 'pessoal' && !d.traveler_id) {
      return setErro('Escolha de quem é este documento pessoal.')
    }
    setErro(null)
    setSalvando(true)
    try {
      if (arquivo) {
        // Encolhe foto grande, recusa o que passa do teto e fatia o resto em
        // quantas requisições couberem. Ver lib/arquivo.ts.
        await enviarArquivo({
          arquivo,
          tripId: String(snapshot?.viagem?.id ?? ''),
          campos: campos(),
          id: documento?.id,
          aoProgredir: setProgresso,
        })
        await recarregar()
      } else {
        await mutate({
          op: documento?.id ? 'editar' : 'criar',
          entidade: 'documento',
          id: documento?.id ?? null,
          campos: campos(),
          client_ts: new Date().toISOString(),
        })
      }
      avisar('sucesso', documento?.id ? 'Documento atualizado.' : 'Documento adicionado ao cofre.')
      aoFechar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
      setProgresso(null)
    }
  }

  return (
    <AppModal
      titulo={documento?.id ? 'Editar documento' : 'Adicionar documento'}
      descricao={arquivo ? arquivo.name : undefined}
      tamanho="pequeno"
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={() => void salvar()} carregando={salvando}>
            Salvar documento
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

        <Campo
          rotulo="Nome do documento"
          valor={d.titulo}
          aoMudar={(v) => set('titulo', v)}
          obrigatorio
          placeholder="Seguro viagem Europa"
        />

        <Selecao
          rotulo="Categoria"
          valor={d.categoria}
          aoMudar={(v) => set('categoria', v)}
          opcoes={[
            { valor: '', nome: 'Sem categoria' },
            ...CATEGORIAS_DOCUMENTO.map((c) => ({ valor: c, nome: CATEGORIAS[c].rotulo })),
          ]}
        />

        <Selecao
          rotulo="Destino"
          valor={d.cidade}
          aoMudar={(v) => set('cidade', v)}
          dica="Sem destino, o documento vale para a viagem inteira."
          opcoes={[
            { valor: '', nome: 'Toda a viagem' },
            ...lugares.map((l) => ({
              valor: String(l.cidade),
              nome: l.pais ? `${String(l.cidade)} · ${String(l.pais)}` : String(l.cidade),
            })),
          ]}
        />

        {soMinhas ? (
          <p className="t-aux rounded-xl bg-(--color-superficie-2) px-3 py-2">
            Este documento é seu. Só você e quem criou a viagem podem abri-lo.
          </p>
        ) : (
          <>
            <Selecao
              rotulo="Disponível para"
              valor={d.escopo}
              aoMudar={(v) => set('escopo', v)}
              opcoes={[
                { valor: 'global', nome: 'Todos os participantes' },
                { valor: 'pessoal', nome: 'Somente uma pessoa' },
              ]}
            />

            {d.escopo === 'pessoal' && (
              <Selecao
                rotulo="De quem é"
                valor={d.traveler_id}
                aoMudar={(v) => set('traveler_id', v)}
                dica="Só esta pessoa e o dono da viagem verão o documento."
                opcoes={[
                  { valor: '', nome: 'Escolha…' },
                  ...participantes.map((p) => ({ valor: String(p.id), nome: String(p.nome) })),
                ]}
              />
            )}
          </>
        )}

        <details className="rounded-xl border border-(--color-borda) px-3 py-2">
          <summary className="toque cursor-pointer text-sm font-medium">
            Ligar ao roteiro, voo ou reserva
          </summary>
          <div className="mt-3 space-y-3">
            <Campo rotulo="Dia" valor={d.dia} aoMudar={(v) => set('dia', v)} tipo="date" />
            <Selecao
              rotulo="Voo"
              valor={d.flight_id}
              aoMudar={(v) => set('flight_id', v)}
              opcoes={[
                { valor: '', nome: 'Nenhum' },
                ...voos.map((v) => ({
                  valor: String(v.id),
                  nome: `${String(v.companhia)} ${String(v.numero ?? '')} · ${String(v.origem_iata ?? '')}→${String(v.destino_iata ?? '')}`,
                })),
              ]}
            />
            <Selecao
              rotulo="Hospedagem ou reserva"
              valor={d.reservation_id}
              aoMudar={(v) => set('reservation_id', v)}
              opcoes={[
                { valor: '', nome: 'Nenhuma' },
                ...reservas.map((r) => ({ valor: String(r.id), nome: String(r.nome) })),
              ]}
            />
          </div>
        </details>

        <Campo
          rotulo="Tags"
          valor={d.tags}
          aoMudar={(v) => set('tags', v)}
          dica="Separe por vírgula: hotel, embarque, urgente."
          placeholder="hotel, embarque"
        />

        <Campo
          rotulo="Validade"
          valor={d.validade}
          aoMudar={(v) => set('validade', v)}
          tipo="date"
          dica="Avisamos quando faltarem 90 dias."
        />

        <Campo rotulo="Observações" valor={d.obs} aoMudar={(v) => set('obs', v)} />

        <div className="rounded-xl bg-(--color-superficie-2) px-3 py-1">
          <Interruptor
            rotulo="Disponível offline"
            descricao="Guarda o arquivo neste aparelho para abrir sem internet."
            ligado={d.offline}
            aoMudar={(v) => set('offline', v)}
          />
          <Interruptor
            rotulo="Importante"
            descricao="Aparece no topo do cofre e nos dias do roteiro."
            ligado={d.importante}
            aoMudar={(v) => set('importante', v)}
          />
        </div>
      </div>
    </AppModal>
  )
}

// ---------------------------------------------------------------- entrada de arquivo

/**
 * O botão de adicionar, o arrastar-e-soltar e o seletor do celular, numa peça só.
 *
 * Arquivos entram UM DE CADA VEZ no modal, mesmo quando a pessoa solta cinco:
 * cada documento precisa de categoria e destino próprios, e um formulário com
 * cinco abas empilhadas é exatamente o modal grande que o brief recusa. A fila
 * fica visível, e quem quiser parar no meio fecha.
 */
export function EntradaArquivos({
  aoEscolher,
  children,
}: {
  aoEscolher: (arquivos: File[]) => void
  children?: React.ReactNode
}) {
  const input = useRef<HTMLInputElement>(null)

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={ACEITOS}
        multiple
        className="sr-only"
        onChange={(e) => {
          const arquivos = Array.from(e.target.files ?? [])
          if (arquivos.length) aoEscolher(arquivos)
          // Zerar permite escolher o MESMO arquivo de novo: sem isto, corrigir um
          // upload que deu errado exigiria escolher outro arquivo no meio.
          e.target.value = ''
        }}
      />
      <Botao onClick={() => input.current?.click()}>
        <Upload size={15} /> {children ?? 'Adicionar documento'}
      </Botao>
    </>
  )
}

/**
 * A área que aceita arquivo solto do desktop.
 *
 * Envolve a lista inteira, não o botão: mirar um botão de 40 px com o arquivo na
 * mão é pior do que abrir o seletor. No celular ela nunca dispara — não há de
 * onde arrastar — e por isso o botão continua sendo o caminho principal.
 *
 * Não precisa de `<input>`: `drop` já entrega os arquivos.
 */
export function ZonaSoltar({
  aoSoltar,
  children,
}: {
  aoSoltar: (arquivos: File[]) => void
  children: React.ReactNode
}) {
  const [arrastando, setArrastando] = useState(false)

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setArrastando(true)
      }}
      onDragLeave={(e) => {
        // `dragleave` dispara ao passar sobre cada filho. Só conta quando o
        // ponteiro sai do retângulo inteiro, senão a borda pisca a cada cartão.
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setArrastando(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setArrastando(false)
        const arquivos = Array.from(e.dataTransfer.files)
        if (arquivos.length) aoSoltar(arquivos)
      }}
      className="rounded-2xl transition-colors"
      style={arrastando ? { outline: '2px dashed var(--destaque)', outlineOffset: 8 } : undefined}
    >
      {arrastando && (
        <p
          className="mb-3 rounded-xl px-3 py-2 text-center text-sm font-medium"
          style={{ background: 'var(--color-destaque-fraco)', color: 'var(--destaque)' }}
        >
          Solte para adicionar ao cofre
        </p>
      )}
      {children}
    </div>
  )
}

// ---------------------------------------------------------------- detalhe

/** A ficha do documento (§11), ao lado do preview no desktop. */
export function FichaDocumento({
  doc,
  status,
  aoEditar,
  aoTrocarOffline,
  aoRemover,
}: {
  doc: Documento
  status: StatusOffline
  aoEditar: () => void
  aoTrocarOffline: (offline: boolean) => void
  aoRemover?: () => void
}) {
  const { snapshot, papel } = useTrip()
  const participantes = snapshot?.participantes ?? []
  const eu = String(snapshot?.eu?.participanteId ?? '')
  const escrevo = podeEscrever(doc, papel, eu)
  const apago = podeApagar(doc, papel, eu)
  const nome = (id?: string | null) =>
    participantes.find((p) => String(p.id) === id)?.nome as string | undefined
  const reserva = (snapshot?.reservas ?? []).find((r) => String(r.id) === doc.reservation_id)
  const voo = (snapshot?.voos ?? []).find((v) => String(v.id) === doc.flight_id)
  const validade = statusValidade(doc.validade)

  const linhas: [string, string][] = [
    ['Categoria', doc.categoria ? fichaCategoria(doc.categoria).rotulo : '—'],
    ['Destino', doc.cidade || doc.pais || 'Toda a viagem'],
    ['Dia', doc.dia ? formatarData(doc.dia) : '—'],
    ['Tamanho', formatarTamanho(doc.arquivo_bytes) || '—'],
    ['Adicionado por', nome(doc.criado_por) ?? '—'],
    ['Adicionado em', doc.criado_em ? formatarData(doc.criado_em.slice(0, 10)) : '—'],
    [
      'Disponível para',
      doc.escopo === 'pessoal'
        ? `${nome(doc.traveler_id) ?? 'Uma pessoa'}${(doc.assigned_to?.length ?? 0) > 0 ? ` e mais ${doc.assigned_to!.length}` : ''}`
        : 'Todos os participantes',
    ],
    ['Voo', voo ? `${String(voo.companhia)} ${String(voo.numero ?? '')}` : '—'],
    ['Reserva', reserva ? String(reserva.nome) : '—'],
    [
      'Validade',
      doc.validade
        ? `${formatarData(doc.validade)}${validade?.nivel === 'vencido' ? ' · vencido' : ''}`
        : '—',
    ],
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {temArquivo(doc) && <SeloOffline status={status} />}
        {doc.importante && <Badge tipo="atencao" texto="Importante" icone={<Star size={13} />} />}
      </div>

      {doc.obs && <p className="t-corpo text-(--color-tinta-2)">{doc.obs}</p>}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {linhas
          .filter(([, v]) => v !== '—')
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="t-aux">{k}</dt>
              <dd className="t-corpo text-right">{v}</dd>
            </div>
          ))}
      </dl>

      {(doc.tags?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {doc.tags!.map((t) => (
            <span
              key={t}
              className="rounded-full bg-(--color-superficie-2) px-2.5 py-1 text-[12px] text-(--color-tinta-2)"
            >
              #{t}
            </span>
          ))}
        </div>
      )}

      <AcoesDocumento doc={doc} />

      {/* A permissão é do DOCUMENTO, não do papel: um viajante mexe no próprio
          passaporte, e um editor não mexe no passaporte alheio. `podeEscrever`
          é o mesmo par de regras do servidor — ver lib/cofre.ts. */}
      {temArquivo(doc) && escrevo && (
        <div className="rounded-xl bg-(--color-superficie-2) px-3">
          <Interruptor
            rotulo="Disponível offline"
            descricao="Abre sem internet neste aparelho."
            ligado={Boolean(doc.offline)}
            aoMudar={aoTrocarOffline}
          />
        </div>
      )}

      {escrevo && (
        <div className="flex gap-2 border-t border-(--color-borda) pt-3">
          <Botao variante="secundario" tamanho="pequeno" onClick={aoEditar}>
            Editar
          </Botao>
          {aoRemover && apago && (
            <BotaoIcone rotulo="Remover documento" tom="perigo" onClick={aoRemover}>
              <Trash2 size={16} />
            </BotaoIcone>
          )}
        </div>
      )}
    </div>
  )
}

export { X }

// ---------------------------------------------------------------- vínculos

/**
 * "DOCUMENTOS DO VOO", "DOCUMENTOS NECESSÁRIOS" — o mesmo bloco no roteiro, no
 * voo, na hospedagem e no checklist.
 *
 * Não duplica arquivo nenhum: é uma REFERÊNCIA ao documento que já está no cofre
 * (§18). Abrir aqui abre o mesmo arquivo, com o mesmo estado offline — e como o
 * `snapshot` já veio recortado pelo servidor, um documento pessoal de outra
 * pessoa nunca chega a esta lista.
 */
export function DocumentosVinculados({
  vinculo,
  dia,
  titulo = 'Documentos',
}: {
  /** Um item do roteiro, um voo ou uma reserva/hospedagem. */
  vinculo?: { evento?: string; voo?: string; reserva?: string }
  /** Um dia do roteiro: junta o que está preso ao dia e o que é importante sempre. */
  dia?: { data: string; eventos?: string[]; voos?: string[]; reservas?: string[] }
  titulo?: string
}) {
  const { snapshot } = useTrip()
  const [aberto, setAberto] = useState<Documento | null>(null)

  const documentos = useMemo(
    () => (snapshot?.documentos ?? []) as unknown as Documento[],
    [snapshot?.documentos],
  )

  const lista = useMemo(() => {
    if (dia) {
      return documentosDoDia(documentos, dia.data, {
        eventos: dia.eventos,
        voos: dia.voos,
        reservas: dia.reservas,
      })
    }
    return vinculo ? documentosDe(documentos, vinculo) : []
  }, [documentos, dia, vinculo])

  const { salvos, erros } = useCofre(lista)

  // Sem documento ligado, o bloco não existe: um cabeçalho seguido de "nenhum" é
  // ruído em toda linha do roteiro.
  if (lista.length === 0) return null

  return (
    <div className="mt-3">
      <Rotulo>{titulo}</Rotulo>
      <ul className="mt-1.5 space-y-1.5">
        {lista.map((doc) => {
          const Icone = ICONE_CATEGORIA[chaveIcone(doc.categoria)]
          return (
            <li key={doc.id}>
              <button
                onClick={() => setAberto(doc)}
                className="toque flex w-full cursor-pointer items-center gap-2 rounded-xl border border-(--color-borda) bg-(--color-cartao) px-3 text-left"
              >
                <Icone size={15} className="shrink-0 text-(--color-tinta-3)" />
                <span className="t-corpo min-w-0 flex-1 truncate">{doc.titulo}</span>
                {temArquivo(doc) && (
                  <SeloOffline status={statusOffline(doc, salvos, new Set(erros.keys()))} curto />
                )}
              </button>
            </li>
          )
        })}
      </ul>

      {aberto && (
        <AppModal
          titulo={aberto.titulo}
          tamanho="medio"
          aoFechar={() => setAberto(null)}
          acoes={<Botao onClick={() => setAberto(null)}>Fechar</Botao>}
        >
          <div className="mb-4 min-h-[40vh]">
            <PreviewDocumento doc={aberto} />
          </div>
          <AcoesDocumento doc={aberto} />
        </AppModal>
      )}
    </div>
  )
}

/**
 * O documento apontado por um item de checklist (§22): uma linha só, que abre o
 * arquivo em vez de mandar a pessoa procurá-lo.
 *
 * Não renderiza nada quando o documento não está no snapshot desta sessão — ou
 * ele foi apagado, ou é pessoal de outra pessoa. Nos dois casos, silêncio é o
 * certo: um "documento indisponível" contaria que ele existe.
 */
export function DocumentoDoItem({ documentoId }: { documentoId: string }) {
  const { snapshot } = useTrip()
  const [aberto, setAberto] = useState(false)

  const doc = (snapshot?.documentos ?? []).find((d) => String(d.id) === documentoId) as
    Documento | undefined
  if (!doc) return null

  const Icone = ICONE_CATEGORIA[chaveIcone(doc.categoria)]

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        className="toque mt-1 inline-flex cursor-pointer items-center gap-1.5 text-[13px] font-medium"
        style={{ color: 'var(--destaque)' }}
      >
        <Icone size={13} /> Abrir {doc.titulo}
      </button>
      {aberto && (
        <AppModal
          titulo={doc.titulo}
          tamanho="medio"
          aoFechar={() => setAberto(false)}
          acoes={<Botao onClick={() => setAberto(false)}>Fechar</Botao>}
        >
          <div className="mb-4 min-h-[40vh]">
            <PreviewDocumento doc={doc} />
          </div>
          <AcoesDocumento doc={doc} />
        </AppModal>
      )}
    </>
  )
}
