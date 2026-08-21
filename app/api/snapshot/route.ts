// GET /api/snapshot - tudo que a sessao atual pode ver, numa resposta so.
import { viagemAtiva, getSnapshot } from '@/lib/db.ts'
import { requireSession, ErroHttp } from '@/lib/session.ts'
import { rota } from '@/lib/api.ts'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = rota(async () => {
  const sessao = await requireSession()
  const viagem = await viagemAtiva()
  if (!viagem) throw new ErroHttp(404, 'Nenhuma viagem cadastrada ainda.')

  const snapshot = await getSnapshot(viagem.id, sessao.papel)
  return NextResponse.json(
    {
      ...snapshot,
      sessao: { travelerId: sessao.travelerId, papel: sessao.papel },
    },
    // Snapshot nunca vai para cache HTTP: quem guarda copia offline e o IndexedDB.
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
