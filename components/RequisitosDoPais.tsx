'use client'

// A nota de requisitos no cabeçalho de um dia do Roteiro.
//
// Ela responde uma pergunta só — "o que este país exige, e já foi cumprido?" —
// e responde de canto: superfície rebaixada, sem sombra e sem borda colorida.
// As três coisas que o design system usa para dizer "objeto separado" ficam de
// fora de propósito, porque esta nota não é um objeto separado do dia; é
// informação SOBRE o dia, como a cidade e o clima logo acima dela.
//
// Nada aqui é um segundo sistema de documentação. Os requisitos, as entregas e o
// semáforo são os mesmos de `lib/documentacao.ts` que a aba Documentos já usa —
// marcar aqui não existe, e resolver acontece lá. Um cadastro próprio nesta nota
// seria a segunda verdade que o módulo inteiro existe para não ter.
//
// O que decide QUEM VÊ o quê continua no servidor (`documentacaoDaViagem` em
// lib/db.ts): um visualizador recebe o ESTADO de todo mundo e o VALOR de
// ninguém. Este arquivo desenha o que chegou e não filtra permissão — não teria
// como, e fingir que tem seria esconder na tela o que a rede já entregou.
import { useMemo, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { useTrip } from './TripProvider.tsx'
import { AppModal } from './ui.tsx'
import {
  ESTADOS,
  entregue,
  montarMatriz,
  ordenarCelulas,
  requisitosDoPais,
  type Celula,
  type Participante,
  type PerfilResumo,
  type Requisito,
  type Submissao,
} from '@/lib/documentacao.ts'

/** O que a nota precisa saber, depois de cruzar o país do dia com a matriz. */
type Resumo = {
  requisitos: Requisito[]
  celulas: Celula[]
  cumpridos: number
  total: number
  /** O que falta, para a segunda linha. Vazio quando está tudo cumprido. */
  faltando: string[]
}

/**
 * A nota. Sem nota a desenhar ela devolve `vazio` — e `null` quando ninguém
 * passa um. São três casos, e cada um é deliberado: dia sem país cadastrado (o
 * país nunca é adivinhado pelo nome da cidade), viagem sem requisito nenhum, e
 * país sem requisito que se aplique a ele.
 *
 * O `vazio` existe porque o Roteiro precisa de uma linha de altura CONSTANTE
 * aqui: com a nota sumindo, a faixa de dias e a agenda inteira subiam alguns
 * pixels ao trocar para um dia sem país, e o dia parecia outra tela. Onde não
 * há esse problema — o celular, onde a nota é a única linha daquele espaço —
 * continua valendo sumir, porque um bloco dizendo "nada a exigir aqui" ensina a
 * pessoa a ignorar aquele canto.
 */
export function RequisitosDoPais({
  pais,
  bandeira,
  vazio = null,
}: {
  pais: string | null
  bandeira: string | null
  vazio?: ReactNode
}) {
  const { snapshot } = useTrip()
  const [aberto, setAberto] = useState(false)

  const resumo = useMemo(() => montarResumo(snapshot, pais), [snapshot, pais])
  if (!resumo) return <>{vazio}</>

  const tudoCerto = resumo.cumpridos === resumo.total
  const detalhe =
    resumo.faltando.length === 0
      ? resumo.requisitos
          .slice(0, 2)
          .map((r) => r.nome)
          .join(', ') +
        (resumo.requisitos.length > 2 ? ` e mais ${resumo.requisitos.length - 2}` : '')
      : resumo.faltando.length === 1
        ? `Falta ${resumo.faltando[0].toLowerCase()}`
        : `Faltam ${resumo.faltando.length} documentos`

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        // `w-full` + `text-left`: o botão ocupa a largura da nota para a área de
        // toque ser a nota inteira, não só as palavras.
        className="toque mt-3 flex w-full items-center gap-3 rounded-xl bg-(--color-superficie-2) px-3.5 py-2.5 text-left transition-colors hover:bg-(--color-borda)"
        aria-label={`Requisitos ${pais}: ${resumo.cumpridos} de ${resumo.total} cumpridos`}
      >
        {bandeira && (
          <span className="shrink-0 text-lg leading-none" aria-hidden>
            {bandeira}
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold text-(--color-tinta)">
            Requisitos {pais}
          </span>
          <span className="block truncate text-[12.5px] text-(--color-tinta-2)">{detalhe}</span>
        </span>

        {/* Texto + número, nunca a cor sozinha: quem não distingue verde de
            âmbar continua lendo "3 de 4". */}
        <span
          className="tab-num shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold"
          style={{
            background: tudoCerto ? 'var(--color-sucesso-bg)' : 'var(--color-atencao-bg)',
            color: tudoCerto ? 'var(--color-sucesso-ink)' : 'var(--color-atencao-ink)',
          }}
        >
          {resumo.cumpridos} de {resumo.total}
        </span>

        <ChevronRight size={16} className="shrink-0 text-(--color-tinta-3)" aria-hidden />
      </button>

      {aberto && (
        <AppModal titulo={`Requisitos ${pais}`} aoFechar={() => setAberto(false)}>
          <Detalhe resumo={resumo} />
        </AppModal>
      )}
    </>
  )
}

/**
 * Quem já cumpriu e quem não, requisito por requisito.
 *
 * Mostra o ESTADO e o nome, e mais nada: número, validade e arquivo de outra
 * pessoa não chegam neste componente porque o servidor não os manda. Resolver
 * continua sendo assunto da aba Documentos — repetir o formulário aqui criaria
 * dois lugares para escrever a mesma linha.
 */
function Detalhe({ resumo }: { resumo: Resumo }) {
  const { snapshot } = useTrip()
  const nomes = new Map(
    (snapshot?.participantes ?? []).map((p) => [String(p.id), String(p.nome ?? '')]),
  )

  return (
    <div className="space-y-5">
      {resumo.requisitos.map((req) => {
        const celulas = ordenarCelulas(resumo.celulas.filter((c) => c.requisito.id === req.id))
        return (
          <section key={req.id}>
            <h3 className="text-[15px] font-semibold text-(--color-tinta)">{req.nome}</h3>
            <p className="t-aux mt-0.5 text-(--color-tinta-2)">
              {[
                req.obrigatorio === false ? 'Recomendado' : 'Obrigatório',
                // `pais` nulo é o requisito que vale para a viagem toda. Dizer
                // isso evita a leitura errada de que ele é exigência do país.
                req.pais ? null : 'vale para a viagem inteira',
                req.prazo ? `prazo ${req.prazo}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>

            <ul className="mt-2 divide-y divide-(--color-borda) rounded-xl border border-(--color-borda)">
              {celulas.map((c) => (
                <li key={c.traveler_id} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-(--color-tinta)">
                    {nomes.get(c.traveler_id) ?? 'Participante'}
                  </span>
                  <span
                    className="shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
                    style={{
                      background: `var(--color-${tomCss(c)}-bg)`,
                      color: `var(--color-${tomCss(c)}-ink)`,
                    }}
                  >
                    {ESTADOS[c.estado].curto}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      <p className="t-aux text-(--color-tinta-3)">
        Para cadastrar ou atualizar um documento, abra Documentos › Exigidos.
      </p>
    </div>
  )
}

/**
 * Tom do design system para o estado. `neutro` não tem par `--color-neutro-*`,
 * então ele vira `superficie-2`/`tinta-2` — as mesmas duas variáveis que `TONS`
 * usa para `neutro` em components/ui.tsx.
 */
function tomCss(c: Celula): string {
  const tom = ESTADOS[c.estado].tom
  return tom === 'neutro' ? 'superficie-2' : tom
}

/**
 * Snapshot + país -> o que a nota desenha. `null` quando não há nota a desenhar.
 *
 * A matriz é montada com a lista INTEIRA de requisitos e depois recortada pelo
 * país, e não o contrário: `montarMatriz` já ordena, indexa e resolve o perfil
 * de cada pessoa, e montar uma matriz por país repetiria esse trabalho a cada
 * dia do roteiro que a tela abre.
 */
function montarResumo(
  snapshot: ReturnType<typeof useTrip>['snapshot'],
  pais: string | null,
): Resumo | null {
  if (!snapshot || !pais) return null

  const requisitos = requisitosDoPais(snapshot.requisitos as unknown as Requisito[], pais)
  if (requisitos.length === 0) return null

  const participantes = snapshot.participantes.map((p) => ({
    id: String(p.id),
    nome: String(p.nome ?? ''),
  })) as Participante[]

  const matriz = montarMatriz(
    requisitos,
    snapshot.entregas as unknown as Submissao[],
    participantes,
    snapshot.perfis as unknown as PerfilResumo[],
  )

  const cumpridos = matriz.celulas.filter((c) => entregue(c.estado)).length

  // A segunda linha nomeia o requisito quando falta UM. Com dois ou mais ela
  // conta, porque três nomes de documento não cabem na largura de um celular e
  // um nome truncado no meio é pior que um número.
  const faltando = requisitos
    .filter((r) => (matriz.porRequisito.get(r.id) ?? []).some((c) => !entregue(c.estado)))
    .map((r) => r.nome)

  return {
    requisitos,
    celulas: matriz.celulas,
    cumpridos,
    total: matriz.celulas.length,
    faltando,
  }
}
