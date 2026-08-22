// GET   /api/perfil -> a conta de quem está na sessão
// PATCH /api/perfil -> altera nome, foto, telefone e preferências
// PUT   /api/perfil -> troca a senha
//
// A senha é tratada exatamente como no cadastro: `hashSenha` do lib/session.ts,
// scrypt com sal por senha. Nada de gravar texto puro, nada de hash próprio.
import { atualizarPerfil, hashDoUsuario, trocarSenha } from '@/lib/db.ts'
import { exigirUsuario } from '@/lib/auth.ts'
import { hashSenha, verifySenha, ErroHttp } from '@/lib/session.ts'
import { PerfilSchema, TrocaSenhaSchema, formatarErroZod } from '@/lib/schema.ts'
import { rota, lerJson } from '@/lib/api.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = rota(async () => {
  return { usuario: await exigirUsuario() }
})

export const PATCH = rota(async (req) => {
  const u = await exigirUsuario()
  const parsed = PerfilSchema.safeParse(await lerJson(req, 8192))
  if (!parsed.success) throw new ErroHttp(400, formatarErroZod(parsed.error))

  const d = parsed.data
  const usuario = await atualizarPerfil(u.id, {
    nome: d.nome,
    avatar_url: d.avatar_url ?? null,
    // Campo em branco vira NULL, não string vazia: no banco isso é "não informado".
    telefone: d.telefone?.trim() || null,
    moeda_preferida: d.moeda_preferida,
    notificacoes: d.notificacoes,
  })
  if (!usuario) throw new ErroHttp(404, 'Conta não encontrada.')

  return { ok: true, usuario }
})

export const PUT = rota(async (req) => {
  const u = await exigirUsuario()
  const parsed = TrocaSenhaSchema.safeParse(await lerJson(req, 4096))
  if (!parsed.success) throw new ErroHttp(400, formatarErroZod(parsed.error))

  // Confere a senha atual antes de trocar: sem isso, um cookie roubado bastaria
  // para assumir a conta de vez.
  const hash = await hashDoUsuario(u.id)
  if (!(await verifySenha(parsed.data.atual, hash))) {
    throw new ErroHttp(401, 'Senha atual incorreta.')
  }

  await trocarSenha(u.id, await hashSenha(parsed.data.nova))
  return { ok: true }
})
