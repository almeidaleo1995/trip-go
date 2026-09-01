// GET   /api/perfil -> a conta de quem está na sessão
// PATCH /api/perfil -> altera nome, foto, telefone e preferências
// POST  /api/perfil -> altera os dados de viagem (CPF, passaporte, emergência)
// PUT   /api/perfil -> troca a senha
//
// A senha é tratada exatamente como no cadastro: `hashSenha` do lib/session.ts,
// scrypt com sal por senha. Nada de gravar texto puro, nada de hash próprio.
import {
  atualizarPerfil,
  atualizarPerfilViagem,
  documentosPessoais,
  hashDoUsuario,
  perfilDeViagem,
  trocarSenha,
} from '@/lib/db.ts'
import { exigirUsuario } from '@/lib/auth.ts'
import { hashSenha, verifySenha, ErroHttp, LIMITES_LOGIN } from '@/lib/session.ts'
import {
  PerfilSchema,
  PerfilViagemSchema,
  TrocaSenhaSchema,
  formatarErroZod,
} from '@/lib/schema.ts'
import { rota, lerJson, limitar } from '@/lib/api.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = rota(async () => {
  const usuario = await exigirUsuario()
  // "Meus documentos" (§23): so os pessoais desta conta, de todas as viagens.
  // Documento pessoal de outro participante nunca entra nesta consulta.
  //
  // `viagem` sao os dados documentais da PESSOA (CPF, passaporte, contato de
  // emergencia). Eles saem com os VALORES aqui, e so aqui: esta rota responde a
  // propria conta. O snapshot de uma viagem carrega apenas quais campos estao
  // preenchidos — ver `documentacaoDaViagem` em lib/db.ts.
  const [documentos, viagem] = await Promise.all([
    documentosPessoais(usuario.id),
    perfilDeViagem(usuario.id),
  ])
  return { usuario, documentos, viagem }
})

// POST /api/perfil -> os dados de viagem da conta (§6, §7, §8).
//
// Separado do PATCH de propósito: são dois formulários diferentes em duas telas
// diferentes, e um PATCH que aceitasse os dois zeraria o passaporte de quem
// salvasse só o apelido.
export const POST = rota(async (req) => {
  const u = await exigirUsuario()
  const parsed = PerfilViagemSchema.safeParse(await lerJson(req, 8192))
  if (!parsed.success) throw new ErroHttp(400, formatarErroZod(parsed.error))

  return { ok: true, viagem: await atualizarPerfilViagem(u.id, parsed.data) }
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
  // Esta rota confere a senha ATUAL, o que a torna um verificador de senha para
  // quem já tem o cookie. Mesmo limite do login, e antes do scrypt: sem ele, um
  // cookie roubado vira um oráculo para descobrir a senha e assumir a conta em
  // definitivo. Chave própria para não comer a cota de quem está fazendo login.
  limitar(`senha:${u.id}`, LIMITES_LOGIN, 'Muitas tentativas. Tente de novo em 15 minutos.')

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
