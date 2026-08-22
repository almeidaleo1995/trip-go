// GET    /api/viagens -> as viagens da conta
// POST   /api/viagens -> criar viagem (quem cria vira proprietário)
// PUT    /api/viagens -> escolher a viagem aberta (só grava o cookie de preferência)
// DELETE /api/viagens -> apagar viagem (só proprietário)
import { sql, viagensDoUsuario } from '@/lib/db.ts'
import { exigirUsuario, exigirViagem } from '@/lib/auth.ts'
import { gravarViagemAtual, ErroHttp } from '@/lib/session.ts'
import { ViagemSchema, formatarErroZod } from '@/lib/schema.ts'
import { rota, lerJson } from '@/lib/api.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// `eu` vai junto para a tela de Início poder saudar pelo nome sem uma segunda
// requisição (nem puxar um snapshot inteiro de viagem só por causa disso).
export const GET = rota(async () => {
  const u = await exigirUsuario()
  return { viagens: await viagensDoUsuario(u.id), eu: u }
})

export const POST = rota(async (req) => {
  const u = await exigirUsuario()
  const parsed = ViagemSchema.safeParse(await lerJson(req, 16 * 1024))
  if (!parsed.success) throw new ErroHttp(400, formatarErroZod(parsed.error))

  const v = parsed.data
  if (v.data_retorno < v.data_partida) {
    throw new ErroHttp(400, 'A data de retorno não pode ser anterior à de partida.')
  }

  const r = await sql`
    insert into trips (owner_id, nome, subtitulo, descricao, data_partida, data_retorno,
                       moeda, cor_destaque, capa_url)
    values (${u.id}, ${v.nome}, ${v.subtitulo ?? null}, ${v.descricao ?? null},
            ${v.data_partida}, ${v.data_retorno}, ${v.moeda}, ${v.cor_destaque},
            ${v.capa_url ?? null})
    returning *
  `
  const viagem = r[0] as { id: string }

  // Quem cria entra como participante proprietário na mesma operação: uma viagem
  // sem dono não apareceria para ninguém, nem para quem acabou de criá-la.
  await sql`
    insert into travelers (trip_id, user_id, nome, email, papel, ordem)
    values (${viagem.id}, ${u.id}, ${u.nome}, ${u.email}, 'proprietario', 0)
  `

  await gravarViagemAtual(viagem.id)
  return { ok: true, viagem }
})

export const PUT = rota(async (req) => {
  const u = await exigirUsuario()
  const corpo = (await lerJson(req, 1024)) as { id?: string }
  if (!corpo.id) throw new ErroHttp(400, 'Informe a viagem.')
  // Passa por exigirViagem: sem isso, o cookie aceitaria o id de qualquer viagem.
  await exigirViagem(u.id, corpo.id)
  await gravarViagemAtual(corpo.id)
  return { ok: true }
})

export const DELETE = rota(async (req) => {
  const u = await exigirUsuario()
  const corpo = (await lerJson(req, 1024)) as { id?: string }
  if (!corpo.id) throw new ErroHttp(400, 'Informe a viagem.')
  await exigirViagem(u.id, corpo.id, 'proprietario')
  // Todas as tabelas filhas têm `on delete cascade`: uma linha some com tudo dela.
  await sql`delete from trips where id = ${corpo.id}`
  return { ok: true }
})
