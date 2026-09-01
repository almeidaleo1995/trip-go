'use client'

// A aba do guia. Casca fina de propósito: a conversa é o mesmo componente do
// painel flutuante, para não existirem duas implementações do mesmo diálogo
// divergindo em detalhes que ninguém compara.
//
// O que a aba acrescenta é espaço — no desktop uma conversa longa cabe numa
// coluna de leitura de verdade, e montar um roteiro inteiro é uma conversa longa.
import { Assistente } from '../Assistente.tsx'

export function AssistenteAba() {
  return (
    <div className="mx-auto h-[calc(100dvh-11rem)] max-w-2xl overflow-hidden rounded-2xl border border-(--color-borda) bg-(--color-cartao)">
      <Assistente aoFechar={() => history.back()} />
    </div>
  )
}
