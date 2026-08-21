// POST /api/sessao   -> login por nome + PIN
// DELETE /api/sessao -> logout
import { viagemAtiva, viajantePorId } from '@/lib/db.ts'
import {
  verifyPin,
  criarToken,
  gravarCookie,
  limparCookie,
  registrarFalha,
  estaBloqueado,
  limparFalhas,
  ErroHttp,
} from '@/lib/session.ts'
import { rota, lerJson, chaveOrigem } from '@/lib/api.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = rota(async (req) => {
  const chave = chaveOrigem(req)

  // Checa o bloqueio ANTES de gastar CPU com scrypt: caso contrário o rate limit
  // vira ele próprio um vetor de carga.
  if (estaBloqueado(chave)) {
    throw new ErroHttp(429, 'Muitas tentativas. Tente em 15 minutos.')
  }

  const corpo = (await lerJson(req, 1024)) as { travelerId?: string; pin?: string }
  const viagem = await viagemAtiva()
  if (!viagem) throw new ErroHttp(404, 'Nenhuma viagem cadastrada ainda.')

  const viajante = corpo.travelerId ? await viajantePorId(corpo.travelerId) : null

  // Mensagem idêntica para "não existe" e "PIN errado": dizer qual dos dois falhou
  // confirmaria para quem tenta adivinhar que o nome existe.
  const ok =
    viajante !== null &&
    viajante.trip_id === viagem.id &&
    (await verifyPin(String(corpo.pin ?? ''), viajante.pin_hash))

  if (!ok) {
    const { bloqueado } = registrarFalha(chave)
    if (bloqueado) throw new ErroHttp(429, 'Muitas tentativas. Tente em 15 minutos.')
    throw new ErroHttp(401, 'Nome ou PIN incorreto.')
  }

  limparFalhas(chave)
  await gravarCookie(criarToken(viajante.id, viajante.papel))
  return { ok: true, nome: viajante.nome, papel: viajante.papel }
})

export const DELETE = rota(async () => {
  await limparCookie()
  return { ok: true }
})
