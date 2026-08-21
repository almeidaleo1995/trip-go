// GET /api/viajantes - lista para a tela de login, antes de existir sessao.
//
// Devolve so id e nome. Nunca pin_hash, e nunca papel: revelar quem e o admin
// daria a quem for tentar adivinhar PIN exatamente o alvo que interessa.
import { viagemAtiva, listarViajantesPublico } from '@/lib/db.ts'
import { rota } from '@/lib/api.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = rota(async () => {
  const viagem = await viagemAtiva()
  if (!viagem) return { viajantes: [], precisaImportar: true }
  return {
    viajantes: await listarViajantesPublico(viagem.id),
    precisaImportar: false,
  }
})
