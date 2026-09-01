// POST /api/mutate - aplica a fila de escritas do cliente.
//
// A rota é uma casca: ela valida o lote, resolve a sessão e delega. Quem decide
// QUEM pode escrever o quê, e como a escrita cai na viagem certa, é
// `lib/escrita.ts` - o mesmo módulo que a rota do assistente usa, de propósito.
import { envelope } from '@/lib/db.ts'
import { exigirUsuario, exigirViagem } from '@/lib/auth.ts'
import { ErroHttp, LIMITES_ESCRITA } from '@/lib/session.ts'
import { MutationBatchSchema, formatarErroZod } from '@/lib/schema.ts'
import { autorizar, aplicar } from '@/lib/escrita.ts'
import { rota, lerJson, limitar } from '@/lib/api.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = rota(async (req) => {
  const u = await exigirUsuario()
  // Por CONTA, não por IP: a viagem inteira sincroniza pelo wi-fi do mesmo hotel.
  // Teto folgado de propósito — quem volta de um dia offline sobe a fila acumulada
  // de uma vez. Ver LIMITES_ESCRITA em lib/session.ts.
  limitar(`escrita:${u.id}`, LIMITES_ESCRITA, 'Muitas alterações seguidas. Tente em instantes.')

  const corpo = await lerJson(req)
  const parsed = MutationBatchSchema.safeParse(corpo)
  if (!parsed.success) throw new ErroHttp(400, formatarErroZod(parsed.error))

  const acesso = await exigirViagem(u.id, parsed.data.trip_id)

  const aplicadas: string[] = []
  const rejeitadas: { id?: string; motivo: string }[] = []

  for (const op of parsed.data.ops) {
    try {
      await autorizar(acesso, op.entidade, op.op, op.campos, op.id)
      const mudou = await aplicar(acesso, op)
      if (mudou) aplicadas.push(op.id ?? 'novo')
      else rejeitadas.push({ id: op.id ?? undefined, motivo: 'versão do servidor é mais nova' })
    } catch (e) {
      // Recusa deliberada (403 de autorização, 409 de integridade) aborta o lote:
      // engolir isso numa lista faria o cliente ver 200 e achar que passou.
      // Só erro de dado de UMA operação vira item de `rejeitadas`.
      if (e instanceof ErroHttp) throw e
      rejeitadas.push({ id: op.id ?? undefined, motivo: e instanceof Error ? e.message : 'erro' })
    }
  }

  return {
    aplicadas: aplicadas.length,
    rejeitadas,
    // Mesmo envelope de /api/snapshot: sem `eu`, o cliente perde o papel e o
    // participanteId depois de QUALQUER escrita, não só na carga inicial.
    snapshot: await envelope(acesso),
  }
})
