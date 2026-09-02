// POST /api/usuarios -> criar conta
//
// Quem se cadastra entra já logado: pedir para a pessoa fazer login logo depois
// de digitar a senha duas vezes é uma etapa sem propósito.
import {
  criarUsuario,
  vincularParticipantesPorEmail,
  registrarTentativa,
  consultarBloqueio,
} from '@/lib/db.ts'
import { hashSenha, criarToken, gravarCookie, LIMITES_CADASTRO, ErroHttp } from '@/lib/session.ts'
import { CadastroSchema, formatarErroZod } from '@/lib/schema.ts'
import { rota, lerJson, chaveOrigem } from '@/lib/api.ts'
import { CAMPO_ARMADILHA, pareceRobo, verificarTurnstile } from '@/lib/seguranca.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = rota(async (req) => {
  // Cadastro tem limite proprio, e ele conta TODA tentativa — nao so as que
  // falham, como no login. O abuso aqui e a conta criada com SUCESSO: sem isto,
  // um laco enche a tabela `users` de graca, e cada linha nova ainda dispara
  // `vincularParticipantesPorEmail`, que varre participantes por e-mail.
  //
  // Chave em namespace proprio: errar a senha no login nao pode consumir a cota
  // de quem esta se cadastrando da mesma rede.
  const chave = `cadastro:${chaveOrigem(req)}`

  // Antes do scrypt, que e caro de proposito — checar depois faria do proprio
  // limite um vetor de carga (mesma razao do /api/sessao).
  if (await consultarBloqueio(chave)) {
    throw new ErroHttp(429, 'Muitas contas criadas deste local. Tente de novo mais tarde.')
  }

  const corpo = (await lerJson(req, 8192)) as Record<string, unknown>

  // O campo-armadilha, lido do corpo CRU e não do schema: ele não é um dado da
  // conta, e colocá-lo no CadastroSchema faria um campo inexistente aparecer na
  // folha de edição, no export e em tudo que deriva do schema.
  //
  // A resposta é a mesma que um erro de validação daria. Dizer "detectamos um
  // robô" ensina quem escreveu o robô exatamente qual campo apagar.
  if (pareceRobo(corpo?.[CAMPO_ARMADILHA])) {
    throw new ErroHttp(400, 'Não consegui criar a conta. Confira os dados e tente de novo.')
  }

  const parsed = CadastroSchema.safeParse(corpo)
  if (!parsed.success) throw new ErroHttp(400, formatarErroZod(parsed.error))

  // Antes de contar a tentativa: um captcha recusado nao e uma conta criada, e
  // gastar a cota de quem nem passou do desafio castigaria a rede inteira do
  // hotel por causa de um bot. Aqui e onde o captcha vale mais — o abuso desta
  // rota e a conta criada COM SUCESSO, e mil IPs distintos passam por baixo de
  // qualquer limite por origem.
  if (!(await verificarTurnstile(corpo.captcha as string, chaveOrigem(req)))) {
    throw new ErroHttp(400, 'Refaça a verificação de segurança e tente de novo.')
  }

  const { bloqueado } = await registrarTentativa(chave, LIMITES_CADASTRO)
  if (bloqueado) {
    throw new ErroHttp(429, 'Muitas contas criadas deste local. Tente de novo mais tarde.')
  }

  const { nome, email, senha, convite } = parsed.data
  const usuario = await criarUsuario(nome, email, await hashSenha(senha))

  // `criarUsuario` devolve null quando o unique do e-mail barrou o insert. É a
  // única checagem de duplicidade que não tem corrida entre o select e o insert.
  //
  // A resposta é IDÊNTICA à do erro de validação e à da armadilha — mesmo status,
  // mesmo texto — pelo motivo que o /api/sessao já aplica: um 409 distinguível
  // transforma o cadastro num verificador de e-mails cadastrados. Aqui isso pesa
  // mais que no login, porque `vincularParticipantesPorEmail` (logo abaixo) faz
  // do e-mail de um participante uma credencial: quem enumera aprende exatamente
  // quais e-mails da viagem ainda estão livres para serem reivindicados.
  //
  // Custa a mensagem útil para quem esqueceu que já tem conta. É o mesmo preço
  // que o login paga em 'E-mail ou senha incorretos.', e pelo mesmo motivo.
  if (!usuario) {
    throw new ErroHttp(400, 'Não consegui criar a conta. Confira os dados e tente de novo.')
  }

  // O codigo entra AQUI e nao vira campo da conta: ele e a prova de que quem se
  // cadastrou foi convidado para aquela viagem, gasta uma vez, e nao um dado da
  // pessoa. Codigo errado nao e erro -- a conta e criada, so nao entra em viagem
  // nenhuma; dizer "codigo invalido" transformaria o cadastro num verificador de
  // codigos de convite, que e o mesmo furo que o 409 do e-mail era.
  await vincularParticipantesPorEmail(usuario.id, usuario.email, convite)
  await gravarCookie(criarToken(usuario.id))
  return { ok: true, usuario }
})
