// Guarda de servidor das telas privadas.
//
// As quatro páginas deste grupo são `'use client'` — elas não conseguem checar
// sessão, e até aqui a única barreira era o proxy.ts, que é OTIMISTA de propósito:
// ele confere a assinatura do cookie e nunca vai ao banco. Um token assinado de
// uma conta já apagada passava por ele.
//
// Não vazava dado: o conteúdo vem do /api/*, e lá `exigirUsuario` sempre bateu no
// banco. O que faltava era a segunda tranca da regra da casa — papel se confere
// duas vezes, e sessão também deveria. `exigirUsuarioOuLogin` foi escrita para
// isto e não tinha um chamador.
//
// A consulta que o proxy evita não volta aqui: `usuarioAtual` é `cache()`ada por
// requisição e este layout cobre 4 telas, não toda rota que o navegador pré-carrega.
import { exigirUsuarioOuLogin } from '@/lib/auth.ts'

export default async function LayoutPrivado({ children }: { children: React.ReactNode }) {
  await exigirUsuarioOuLogin()
  return children
}
