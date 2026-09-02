// POST /api/assistente - a conversa. NUNCA escreve.
//
// Esta rota não importa `lib/escrita.ts`, e isso é a decisão de segurança da
// feature inteira. A alternativa — uma rota só, com um `aplicar: true` no corpo —
// é uma rota que às vezes grava, e é onde alguém um dia esquece de checar a
// flag. Aqui a ausência de escrita se verifica lendo os imports.
//
// O contexto que o modelo recebe vem de `getSnapshot(tripId, papel,
// participanteId)`: o MESMO snapshot que a tela daquela pessoa recebe, já
// recortado por `financeiroDaViagem` e `documentosDaViagem`. Montar uma consulta
// própria aqui reabriria todos os vazamentos que essas duas funções fecham.
import Anthropic from '@anthropic-ai/sdk'
import { paraLog } from '@/lib/seguranca.ts'
import { getSnapshot, registrarUso, registrarTentativa } from '@/lib/db.ts'
import { exigirUsuario, exigirViagem } from '@/lib/auth.ts'
import { ErroHttp, LIMITES_ASSISTENTE } from '@/lib/session.ts'
import { rota, lerJson } from '@/lib/api.ts'
import { MODELO } from '@/config/precos.ts'
import { contextoDoSnapshot, montarPreparacao } from '@/lib/preparacao.ts'
import { papelAlcanca } from '@/config/navigation.ts'
import {
  ferramentas,
  digest,
  sistema,
  propostasDe,
  contextoDeAgora,
  fontesDe,
  MODOS,
  type BlocoBusca,
  type Modo,
  type BlocoFerramenta,
} from '@/lib/assistente.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Esforço por modo: pensar mais onde a resposta é decisão, menos onde é leitura. */
const ESFORCO: Record<Modo, 'low' | 'medium' | 'high'> = {
  criar_viagem: 'high',
  duvida: 'high',
  curiosidade: 'medium',
  // As pendências chegam calculadas por `montarPreparacao`; o modelo só ordena
  // e explica. Pensar muito aqui é pagar por trabalho que já foi feito.
  preparacao: 'low',
}

type Corpo = {
  trip_id?: string
  modo?: string
  mensagens?: { papel: string; texto: string }[]
  aba?: string
  contexto_tempo?: string
}

export const POST = rota(async (req) => {
  const chave = process.env.ANTHROPIC_API_KEY
  if (!chave) {
    throw new ErroHttp(
      503,
      'O assistente não está configurado neste servidor. Falta a chave da Anthropic.',
    )
  }

  const u = await exigirUsuario()
  const corpo = (await lerJson(req)) as Corpo

  // Limite POR CONTA, não por IP: cinco pessoas no wi-fi do hotel dividiriam um
  // balde só. O custo de furar aqui é dinheiro, não segurança.
  const limite = await registrarTentativa(`assistente:${u.id}`, LIMITES_ASSISTENTE)
  if (limite.bloqueado) {
    const min = Math.ceil(limite.restamMs / 60000)
    throw new ErroHttp(429, `Muitas perguntas seguidas. Tente de novo em ${min} min.`)
  }

  const modo = (MODOS.includes(corpo.modo as Modo) ? corpo.modo : 'duvida') as Modo
  const mensagens = (corpo.mensagens ?? []).filter((m) => m?.texto?.trim())
  if (mensagens.length === 0) throw new ErroHttp(400, 'Escreva ou dite alguma coisa primeiro.')

  // Sem viagem (modo criar_viagem, antes de a viagem existir) o contexto é vazio
  // e o papel é o mais alto: a pessoa está montando a própria viagem.
  let contexto = ''
  let papel: 'visualizador' | 'editor' | 'proprietario' = 'proprietario'
  let tripId: string | null = null
  let participanteId: string | null = null
  let agora = ''
  let pendencias = ''

  if (corpo.trip_id) {
    const acesso = await exigirViagem(u.id, corpo.trip_id)
    papel = acesso.papel
    tripId = acesso.tripId
    participanteId = acesso.participanteId
    const snapshot = await getSnapshot(acesso.tripId, acesso.papel, acesso.participanteId)
    contexto = digest(snapshot as never)
    // "Estou aqui e tenho 40 minutos" so e respondivel com isto: que horas sao
    // NO DESTINO, onde a pessoa esta na programacao, e o que vem depois. Tudo
    // derivado de lib/hoje.ts, nunca recalculado aqui — um segundo calculo do
    // "compromisso atual" divergiria da aba Hoje no primeiro caso de borda.
    agora = contextoDeAgora(snapshot as never, new Date())

    // As pendencias vem CALCULADAS de `montarPreparacao`, o mesmo motor puro
    // que desenha a aba Preparacao. O modelo ordena e explica; ele nao decide o
    // que esta pendente. Deixa-lo recalcular criaria uma segunda lista, e a
    // segunda lista e sempre a que ninguem confere.
    if (modo === 'preparacao') {
      const { contexto } = contextoDoSnapshot(
        snapshot as never,
        acesso.participanteId,
        papelAlcanca(acesso.papel, 'editor'),
        new Date(),
      )
      const central = montarPreparacao(contexto)
      const tarefas = central.tarefas
        .slice(0, 15)
        .map((t) => `- [${t.prioridade}] ${t.titulo}${t.detalhe ? ` — ${t.detalhe}` : ''}`)
      if (tarefas.length) {
        pendencias = `\n<pendencias calculadas="pelo aplicativo">\n${tarefas.join('\n')}\n</pendencias>`
      }
    }
  }

  const cliente = new Anthropic({ apiKey: chave })

  const partes = [
    corpo.aba ? `A pessoa está na aba "${corpo.aba}".` : '',
    agora,
    pendencias,
    corpo.contexto_tempo ?? '',
    contexto ? `\n<viagem>\n${contexto}\n</viagem>` : '',
  ].filter(Boolean)

  const resposta = await cliente.messages.create({
    model: MODELO,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: ESFORCO[modo] },
    // O prefixo cacheável termina AQUI. O digest da viagem muda a cada escrita;
    // se ele entrasse no `system`, invalidaria o cache a cada mensagem.
    system: [{ type: 'text', text: sistema(modo), cache_control: { type: 'ephemeral' } }],
    // A busca na web e o que separa um leitor do snapshot de um guia: horario de
    // museu, preco de bilhete e o que fechou hoje nao estao — e nao poderiam
    // estar — no banco da viagem.
    //
    // O dado pessoal nao chega aqui por CONSTRUCAO, nao por instrucao: `digest`
    // ja derrubou passaporte, telefone, e-mail e valor de documento antes de
    // qualquer texto ser montado. A busca roda em servidor de terceiro, entao
    // confiar numa regra de prompt para isso seria confiar no lugar errado.
    tools: [
      ...ferramentas(papel),
      { type: 'web_search_20260209', name: 'web_search', max_uses: 4 },
    ] as never,
    messages: [
      { role: 'user', content: partes.join('\n') || 'Sem contexto de viagem.' },
      ...mensagens.map((m) => ({
        role: (m.papel === 'assistente' ? 'assistant' : 'user') as 'assistant' | 'user',
        content: m.texto,
      })),
    ],
  })

  const texto = resposta.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('\n')
    .trim()

  const propostas = propostasDe(resposta.content as unknown as BlocoFerramenta[], papel)

  // As fontes vao para a tela junto da resposta: informacao de internet sem
  // procedencia e pior que informacao ausente, porque nao da para conferir.
  const { fontes, buscas } = fontesDe(resposta.content as unknown as BlocoBusca[])

  try {
    await registrarUso({
      tripId,
      userId: u.id,
      modo,
      modelo: resposta.model ?? MODELO,
      entrada: resposta.usage.input_tokens ?? 0,
      saida: resposta.usage.output_tokens ?? 0,
      cacheLeitura: resposta.usage.cache_read_input_tokens ?? 0,
      cacheEscrita: resposta.usage.cache_creation_input_tokens ?? 0,
      buscaWeb: buscas,
    })
  } catch (e) {
    console.error('[assistente] telemetria', paraLog(e))
  }

  return {
    texto: texto || 'Não consegui formular uma resposta. Tente reformular a pergunta.',
    propostas,
    fontes,
    participanteId,
  }
})
