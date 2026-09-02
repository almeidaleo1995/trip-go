// POST /api/assistente/aplicar - o aceite.
//
// O único ponto do assistente que escreve, e ele escreve pelo mesmo
// `autorizar`/`aplicar` de `lib/escrita.ts` que `/api/mutate` usa, com o
// `Acesso` de quem está falando. A IA não ganha nenhum poder que a pessoa já não
// tivesse pela tela: uma proposta aceita por engano ainda esbarra no 403.
//
// Tudo que entra aqui recebe um `lote`. É o que permite desfazer uma viagem
// inteira gerada de uma vez num toque — e é por isso que o lote existe mesmo
// para um aceite de uma proposta só.
import { randomUUID } from 'node:crypto'
import { envelope } from '@/lib/db.ts'
import { exigirUsuario, exigirViagem } from '@/lib/auth.ts'
import { ErroHttp } from '@/lib/session.ts'
import { rota, lerJson } from '@/lib/api.ts'
import { autorizar, aplicar } from '@/lib/escrita.ts'
import { ENTIDADES, type Entidade } from '@/lib/schema.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type PropostaRecebida = {
  ref?: string
  entidade?: string
  op?: string
  id?: string | null
  campos?: Record<string, unknown>
}

export const POST = rota(async (req) => {
  const u = await exigirUsuario()
  const corpo = (await lerJson(req)) as { trip_id?: string; propostas?: PropostaRecebida[] }
  if (!corpo.trip_id) throw new ErroHttp(400, 'Viagem não informada.')

  const acesso = await exigirViagem(u.id, corpo.trip_id)
  const propostas = corpo.propostas ?? []
  if (propostas.length === 0) throw new ErroHttp(400, 'Nenhuma proposta para aplicar.')
  if (propostas.length > 200) throw new ErroHttp(400, 'Lote grande demais.')

  const lote = randomUUID()
  const marca = { origem: 'assistente' as const, lote }
  const client_ts = new Date().toISOString()

  let aplicadas = 0
  const rejeitadas: { ref?: string; motivo: string }[] = []

  for (const p of propostas) {
    const entidade = p.entidade as Entidade
    if (!ENTIDADES.includes(entidade)) {
      rejeitadas.push({ ref: p.ref, motivo: `entidade desconhecida: ${p.entidade}` })
      continue
    }
    if (p.op !== 'criar' && p.op !== 'editar' && p.op !== 'remover') {
      rejeitadas.push({ ref: p.ref, motivo: 'operação inválida' })
      continue
    }

    const op = { op: p.op, entidade, id: p.id ?? null, campos: p.campos ?? {}, client_ts }

    try {
      // A barreira real. Vale de novo aqui mesmo o motor já ter filtrado as
      // ferramentas por papel: aquilo era ergonomia, isto é a permissão.
      await autorizar(acesso, entidade, p.op, op.campos, op.id)
      const mudou = await aplicar(acesso, op, marca)
      if (mudou) aplicadas += 1
      else rejeitadas.push({ ref: p.ref, motivo: 'versão do servidor é mais nova' })
    } catch (e) {
      // Diferente de `/api/mutate`, um 403 aqui NÃO aborta o lote: a pessoa
      // aceitou várias propostas de uma vez e derrubar as boas por causa de uma
      // recusada seria punir o aceite inteiro por um item. Cada recusa é
      // relatada com o motivo, e a tela mostra o que não entrou.
      rejeitadas.push({
        ref: p.ref,
        motivo: e instanceof ErroHttp ? e.message : e instanceof Error ? e.message : 'erro',
      })
    }
  }

  return {
    lote: aplicadas > 0 ? lote : null,
    aplicadas,
    rejeitadas,
    snapshot: await envelope(acesso),
  }
})
