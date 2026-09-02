'use client'

// O guia colado no conteúdo: um botão dentro do registro que já está aberto.
//
// É a diferença entre "tem uma IA no app" e "o app ficou inteligente". Ninguém
// escreve prompt: a receita mora no servidor (lib/assistente.ts → GATILHOS) e o
// botão só diz o que quer. Se o texto do pedido vivesse aqui, cada tela teria a
// sua versão e elas divergiriam na primeira melhoria.
//
// Não vira aba. Curiosidade sobre uma cidade pertence à tela da cidade — mandar
// a pessoa para outro lugar para perguntar sobre o que está na frente dela é
// perder o assunto no caminho.
import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Assistente, type ModoAssistente } from './Assistente.tsx'

export function GatilhoGuia({
  pergunta,
  rotulo,
  modo = 'curiosidade',
  aba,
}: {
  pergunta: string
  rotulo: string
  modo?: ModoAssistente
  aba?: string
}) {
  const [aberto, setAberto] = useState(false)

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-(--color-borda-forte) px-2.5 py-1.5 text-[12.5px] font-medium text-(--color-tinta-2) transition-colors hover:border-(--destaque) hover:text-(--destaque)"
      >
        <Sparkles size={13} />
        {rotulo}
      </button>

      {aberto && (
        <>
          <div
            onClick={() => setAberto(false)}
            className="sem-impressao fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px]"
          />
          <aside
            aria-label="Guia"
            className="sem-impressao fixed inset-x-0 bottom-0 z-50 h-[85dvh] rounded-t-2xl border border-(--color-borda) bg-(--color-cartao) shadow-[var(--sombra-2)] md:inset-y-0 md:right-0 md:left-auto md:h-full md:w-[27rem] md:rounded-t-none md:rounded-l-2xl"
          >
            <Assistente
              modo={modo}
              aba={aba}
              aberturaAutomatica={pergunta}
              aoFechar={() => setAberto(false)}
            />
          </aside>
        </>
      )}
    </>
  )
}
