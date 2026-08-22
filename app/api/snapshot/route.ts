// GET /api/snapshot?trip=<id> - tudo que a sessão pode ver desta viagem, numa
// resposta só. Sem `trip`, devolve a viagem preferida da conta.
//
// A resposta carrega também a lista de viagens e as notificações porque a casca
// do app (seletor de viagem, sino) precisa delas em toda tela — e porque assim o
// cache offline guarda um app inteiro, não uma tela.
import { getSnapshot, viagensDoUsuario, notificacoesDoUsuario } from '@/lib/db.ts'
import { exigirUsuario, exigirViagem, viagemAtual } from '@/lib/auth.ts'
import { rota } from '@/lib/api.ts'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = rota(async (req) => {
  const u = await exigirUsuario()
  const pedido = new URL(req.url).searchParams.get('trip')

  const [viagens, notificacoes] = await Promise.all([
    viagensDoUsuario(u.id),
    notificacoesDoUsuario(u.id),
  ])

  const escolhida = pedido ?? (await viagemAtual(u.id))?.id ?? null

  // Conta nova, sem nenhuma viagem: resposta válida e vazia, não erro. A tela de
  // "crie sua primeira viagem" precisa de um 200 para existir.
  if (!escolhida) {
    return NextResponse.json(
      { viagem: null, viagens, notificacoes, eu: { userId: u.id, usuario: u } },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const acesso = await exigirViagem(u.id, escolhida)
  const snapshot = await getSnapshot(escolhida, acesso.papel, acesso.participanteId)

  return NextResponse.json(
    {
      ...snapshot,
      viagens,
      notificacoes,
      eu: {
        userId: u.id,
        usuario: u,
        participanteId: acesso.participanteId,
        papel: acesso.papel,
      },
    },
    // Snapshot nunca vai para cache HTTP: quem guarda cópia offline é o IndexedDB.
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
