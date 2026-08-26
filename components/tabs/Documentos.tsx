'use client'

// Documentos — uma tela, sem modos.
//
// Eram duas abas vizinhas chamadas "Documentos" e "Documentação exigida", que
// ninguém distinguia pelo nome; viraram uma aba com uma chave de modo, que ainda
// escondia metade atrás de um clique. São a mesma matéria vista de dois lados —
// o cofre guarda o que EXISTE, o painel cobra o que é EXIGIDO — e a pergunta
// diante da tela é uma só: "estou pronto, e isso abre quando eu precisar?".
//
// Então as duas ficam na página, uma embaixo da outra. O cofre primeiro porque é
// o uso DIÁRIO (achar o cartão de embarque na fila); a cobrança depois porque é
// o uso de PREPARO, mais longo e mais raro.
//
// O que nenhuma das versões anteriores conseguia dizer está no topo: uma frase
// com os dois números ao mesmo tempo. E ela é a própria navegação — cada metade
// é âncora para a sua seção, sem um controle a mais na tela.
import { useEffect } from 'react'
import { Titulo } from '../ui.tsx'
import { useTrip } from '../TripProvider.tsx'
import { Cofre } from './Cofre.tsx'
import { Documentacao, usePendenciasAbertas } from './Documentacao.tsx'

const plural = (n: number, um: string, muitos: string) => (n === 1 ? um : muitos)

export function Documentos({ ancora }: { ancora?: 'cofre' | 'exigidos' }) {
  const { snapshot } = useTrip()
  const guardados = snapshot?.documentos?.length ?? 0
  const { abertas, tom } = usePendenciasAbertas()

  // Quem chegou por "Resolver" pediu a cobrança, não o topo da página. Só depois
  // do snapshot: antes dele o cofre está vazio, a seção de baixo está a 200px do
  // topo, e rolar até ela não leva a lugar nenhum.
  //
  // Sem `smooth` de propósito — três mil pixels de rolagem animada no carregar
  // enjoa, e é exatamente o que "prefers-reduced-motion" pede para não existir.
  const pronto = Boolean(snapshot)
  useEffect(() => {
    if (ancora && pronto) document.getElementById(ancora)?.scrollIntoView()
  }, [ancora, pronto])

  return (
    <>
      <Titulo descricao={<Resumo guardados={guardados} abertas={abertas} tom={tom} />}>
        Documentos
      </Titulo>

      {/* scroll-mt: a âncora não pode encostar o título na borda de cima. */}
      <section id="cofre" className="scroll-mt-4">
        <Cofre />
      </section>

      {/* `h-px` + `bg`, e não `border-t`: com `border-0` na mesma classe o
          Tailwind zera a largura e a régua some sem erro nenhum. */}
      <hr className="my-10 h-px border-0 bg-(--color-borda)" />

      <section id="exigidos" className="scroll-mt-4">
        <Documentacao />
      </section>
    </>
  )
}

/**
 * O estado da viagem em uma frase, e a frase é o menu.
 *
 * Um número em cartão próprio seria mais visível e diria menos: o que interessa
 * é a RELAÇÃO entre os dois — ter trinta documentos guardados não ajuda se o
 * passaporte é um dos que faltam.
 */
function Resumo({ guardados, abertas, tom }: { guardados: number; abertas: number; tom: string }) {
  return (
    <>
      <a href="#cofre" className="font-medium text-(--color-tinta) hover:underline">
        {guardados} {plural(guardados, 'documento', 'documentos')} no cofre
      </a>
      {' · '}
      {abertas === 0 ? (
        <>nada pendente na documentação exigida</>
      ) : (
        <a
          href="#exigidos"
          className="font-medium hover:underline"
          style={{ color: `var(--color-${tom}-ink)` }}
        >
          {abertas} {plural(abertas, 'pendência', 'pendências')} na documentação exigida
        </a>
      )}
    </>
  )
}
