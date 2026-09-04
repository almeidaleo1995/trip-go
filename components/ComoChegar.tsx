'use client'

// COMO CHEGAR — a face única da navegação.
//
// Um componente só, usado pela linha do tempo do Roteiro, pela visão
// Deslocamentos e pelo cartão "A seguir" do Hoje. Duas implementações do mesmo
// painel dariam dois horários de saída para o mesmo compromisso, e quem está
// na rua não teria como saber qual dos dois seguir.
//
// Nada aqui calcula: `lib/trechos.ts` já entregou o trecho pronto, com a mesma
// conta de "saia às" que a aba Hoje usa. Este arquivo só escolhe a cor e o
// tamanho de cada número — e a cor É a informação: verde cabe, âmbar aperta,
// vermelho não cabe.
//
// `sairAs`/`chegaAs` são Date e saem por `formatarHoraLocal`, NUNCA por
// `formatarHora(d.toISOString())`. `parseData` monta a data no relógio local e
// `toISOString` a reescreve em UTC, então o round-trip devolvia a hora deslocada
// pelo fuso do aparelho: um evento das 17:30 virava "20:30" no Brasil, com a
// hora certa logo ao lado na mesma tela.
import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Bike,
  Bus,
  Car,
  Clock,
  Footprints,
  MapPin,
  Navigation,
  Plane,
  Route,
  Ship,
  TrainFront,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { formatarDistancia, formatarDuracao } from '@/lib/derive.ts'
import { formatarHoraLocal, NOME_MODO } from '@/lib/hoje.ts'
import { hrefSeguro } from '@/lib/seguranca.ts'
import type { Ponta, Trecho } from '@/lib/trechos.ts'
import { AppModal, Cartao, Rotulo } from './ui.tsx'
import { AdminAcoes } from './EditorSheet.tsx'
import { useTrip } from './TripProvider.tsx'

/**
 * ESCOLHER UMA ALTERNATIVA, OU NENHUMA.
 *
 * A faixa amarela não é uma linha do banco — ela é calculada de `duracao_min`,
 * `distancia_m` e `transporte` do item de DESTINO. Não existe "apagar a faixa";
 * existe apagar o deslocamento que a produz. Daí este par: promover uma opção
 * escreve os três campos no item, e limpar apaga os três.
 *
 * Deixar SEM nenhum é uma escolha legítima e o app já sabe dizê-la: a faixa
 * passa a mostrar "Rota não conferida" em vez de um horário de saída. Um
 * "saia às" chutado é pior que nenhum — quem está na rua acredita nele.
 *
 * Só vale para item de ROTEIRO de verdade. As entradas derivadas (voo do
 * cadastro, check-in de reserva) e o trecho de volta ao hotel usam id com
 * prefixo — `voo:`, `checkin:`, `volta:` — e não existem como linha editável:
 * um `editar` nelas escreveria num id que `itinerary_events` não tem.
 */
function useDeslocamento(trecho: Trecho) {
  const { mutate, posso } = useTrip()
  const id = trecho.id
  const editavel = posso('editor') && Boolean(id) && !id.includes(':')

  const gravar = (campos: Record<string, unknown>) =>
    void mutate({
      op: 'editar',
      entidade: 'roteiro',
      id,
      campos,
      client_ts: new Date().toISOString(),
    })

  return {
    editavel,
    usar: (o: Record<string, unknown>) =>
      gravar({
        duracao_min: o.duracao_min ?? null,
        distancia_m: o.distancia_m ?? null,
        // O nome do modo, e não o código: `transporte` é texto livre que a
        // pessoa lê no cartão ("Metrô L4"), e `modoValido` reconhece de volta.
        transporte: nomeDoModo(o.modo),
      }),
    limpar: () => gravar({ duracao_min: null, distancia_m: null, transporte: null }),
  }
}

export const ICONE_MODO: Record<string, LucideIcon> = {
  a_pe: Footprints,
  metro: TrainFront,
  onibus: Bus,
  trem: TrainFront,
  taxi: Car,
  carro: Car,
  barco: Ship,
  aviao: Plane,
  bicicleta: Bike,
}

/** A cor de um trecho é o seu diagnóstico, não decoração. */
function tomDoTrecho(t: Trecho) {
  if (t.conflito) {
    return { ink: 'var(--color-perigo-ink)', bg: 'var(--color-perigo-bg)', rotulo: 'Não dá tempo' }
  }
  if (t.apertado) {
    return { ink: 'var(--color-atencao-ink)', bg: 'var(--color-atencao-bg)', rotulo: 'Em cima da hora' }
  }
  return { ink: 'var(--destaque)', bg: 'var(--color-destaque-tenue)', rotulo: '' }
}

/**
 * A CHAVE do ícone de um trecho, não o ícone.
 *
 * Devolver o componente daqui faz o lint ler "componente criado durante a
 * render" — ele não distingue escolher de criar. Uma chave e um `ICONE_MODO[…]`
 * no corpo é o mesmo padrão do resto do app.
 */
function chaveDoIcone(t: Trecho): string {
  if (t.modo) return t.modo
  // `transporte` é texto livre ("Metrô L2", "Táxi até o porto"): casamento por
  // palavra-chave, nunca chave de enum. Sem palavra reconhecida, a pé — o
  // deslocamento mais comum de um dia de cidade.
  const texto = (t.transporte ?? '').toLowerCase()
  if (/metr[oô]|u-?bahn|s-?bahn|subway|trem|train/.test(texto)) return 'metro'
  if (/[oô]nibus|bus/.test(texto)) return 'onibus'
  if (/t[aá]xi|uber|carro/.test(texto)) return 'carro'
  if (/barco|balsa|ferry|navio/.test(texto)) return 'barco'
  if (/avi[aã]o|voo|flight/.test(texto)) return 'aviao'
  if (/bike|bicicleta/.test(texto)) return 'bicicleta'
  return 'a_pe'
}

/** O nome do modo como se lê: o texto livre quando existe, senão o modo. */
function legendaDoModo(t: Trecho): string {
  if (t.transporte) return t.transporte
  return t.modo ? NOME_MODO[t.modo] : ''
}

/** O modo de uma linha de `itinerary_options` — valor cru do banco, então o
    próprio texto é a saída quando ele não está na tabela de nomes. */
function nomeDoModo(modo: unknown): string {
  const chave = String(modo ?? '')
  return chave in NOME_MODO ? NOME_MODO[chave as keyof typeof NOME_MODO] : chave
}

/**
 * O link de navegação externa (§31).
 *
 * Coordenada quando existe — é o que todo aplicativo de mapa aceita sem
 * ambiguidade; senão o endereço. Passa por `hrefSeguro` como todo valor gravado
 * por um participante e clicado por outro, mesmo com a URL montada aqui: a
 * garantia tem que valer para o campo, não para o caminho que trouxe o campo.
 */
function linkExterno(destino: Ponta, origem: Ponta | null): string | null {
  const ponto = (p: Ponta | null) =>
    p ? (p.lat != null && p.lon != null ? `${p.lat},${p.lon}` : (p.endereco ?? p.local ?? p.titulo)) : null

  const chegada = ponto(destino)
  if (!chegada) return null
  const partida = ponto(origem)
  const base = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(chegada)}`
  return hrefSeguro(partida ? `${base}&origin=${encodeURIComponent(partida)}` : base)
}

// ---------------------------------------------------------------- saia às

/**
 * O número mais alto da tela, e o único grande: a única conta que ninguém faz
 * de cabeça no meio da rua.
 *
 * Sem `duracao_min` cadastrada ele não aparece — um horário de saída chutado é
 * pior que nenhum, porque as pessoas confiam nele.
 */
export function SaiaAs({ trecho, tamanho = 'medio' }: { trecho: Trecho; tamanho?: 'medio' | 'grande' }) {
  if (!trecho.sairAs) return null
  const tom = tomDoTrecho(trecho)

  return (
    <div className="rounded-xl px-4 py-3 text-center" style={{ background: tom.bg }}>
      <p className="t-legenda" style={{ color: tom.ink }}>
        Saia às
      </p>
      <p
        className={`tab-num mt-0.5 font-semibold ${tamanho === 'grande' ? 'text-3xl' : 'text-2xl'}`}
        style={{ color: tom.ink }}
      >
        {formatarHoraLocal(trecho.sairAs)}
      </p>
      {trecho.chegaAs && (
        <p className="t-aux mt-0.5" style={{ color: tom.ink }}>
          Para chegar às {formatarHoraLocal(trecho.chegaAs)}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- faixa entre eventos

/**
 * O bloco de deslocamento que fica ENTRE dois eventos da linha do tempo (§5).
 *
 * Discreto de propósito: é tecido conjuntivo entre os compromissos, não um
 * terceiro compromisso. Só "Saia às" tem tamanho — o resto é legenda.
 */
export function FaixaTrecho({ trecho, aoAbrir }: { trecho: Trecho; aoAbrir: () => void }) {
  const Icone = ICONE_MODO[chaveDoIcone(trecho)] ?? Route
  const tom = tomDoTrecho(trecho)
  const numeros = [formatarDuracao(trecho.duracaoMin), formatarDistancia(trecho.distanciaM)]
    .filter(Boolean)
    .join('  ·  ')

  return (
    <button
      type="button"
      onClick={aoAbrir}
      aria-label={`Como chegar até ${trecho.destino.titulo}`}
      className="toque w-full cursor-pointer rounded-xl border p-3 text-left transition-colors"
      style={{
        background: trecho.conflito || trecho.apertado ? tom.bg : 'var(--color-superficie-2)',
        borderColor: trecho.conflito || trecho.apertado ? tom.ink : 'transparent',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="t-legenda" style={{ color: tom.ink }}>
            Como chegar ao próximo
          </p>
          <p className="mt-1.5 flex items-center gap-2 text-[13px] font-medium text-(--color-tinta)">
            <Icone size={15} className="shrink-0 text-(--color-tinta-3)" aria-hidden />
            <span className="tab-num">{numeros || 'Rota não conferida'}</span>
          </p>
          {legendaDoModo(trecho) && (
            <p className="mt-0.5 truncate text-[12px] text-(--color-tinta-3)">
              {legendaDoModo(trecho)}
            </p>
          )}
        </div>

        {trecho.sairAs ? (
          <div className="shrink-0 text-right">
            <p className="t-legenda" style={{ color: tom.ink }}>
              Saia às
            </p>
            <p className="tab-num text-2xl font-semibold" style={{ color: tom.ink }}>
              {formatarHoraLocal(trecho.sairAs)}
            </p>
            {trecho.chegaAs && (
              <p className="text-[12px]" style={{ color: tom.ink }}>
                Para chegar às {formatarHoraLocal(trecho.chegaAs)}
              </p>
            )}
          </div>
        ) : (
          <span className="shrink-0 text-[12px] text-(--color-tinta-3)">Ver opções</span>
        )}
      </div>

      {(trecho.conflito || trecho.apertado) && (
        <p
          className="mt-2 flex items-center gap-1.5 border-t pt-2 text-[12px] font-medium"
          style={{ color: tom.ink, borderColor: tom.ink }}
        >
          <AlertTriangle size={13} className="shrink-0" aria-hidden />
          {trecho.conflito
            ? `${trecho.folgaMin} min disponíveis, ${trecho.duracaoMin} min necessários`
            : `Chega sem os ${trecho.margemMin} min de margem`}
        </p>
      )}
    </button>
  )
}

// ---------------------------------------------------------------- painel

function Pontas({ trecho }: { trecho: Trecho }) {
  return (
    <div className="space-y-2">
      {trecho.origem && (
        <p className="flex items-center gap-2.5 text-sm">
          <span
            className="size-2.5 shrink-0 rounded-full border-2"
            style={{ borderColor: 'var(--destaque)' }}
            aria-hidden
          />
          <span className="min-w-0 truncate font-medium">{trecho.origem.titulo}</span>
        </p>
      )}
      <p className="flex items-center gap-2.5 text-sm">
        <MapPin size={12} className="shrink-0" style={{ color: 'var(--destaque)' }} aria-hidden />
        <span className="min-w-0 truncate font-medium">{trecho.destino.titulo}</span>
      </p>
    </div>
  )
}

/**
 * As alternativas de transporte (§8).
 *
 * Só as que estão cadastradas em `itinerary_options`. O app não estima uma
 * caminhada a partir da distância em linha reta: um "32 min a pé" inventado
 * atravessa rio e ferrovia, e é justamente onde a pessoa confiaria.
 */
function Opcoes({ trecho }: { trecho: Trecho }) {
  const { editavel, usar } = useDeslocamento(trecho)
  if (trecho.opcoes.length === 0) return null

  // Qual alternativa está VALENDO hoje: a que casa com o que está gravado no
  // item. Sem isto a lista mostra três opções e nenhuma pista de qual delas
  // gerou o "saia às" da faixa amarela.
  const emUso = (o: Record<string, unknown>) =>
    trecho.duracaoMin !== null && Number(o.duracao_min) === trecho.duracaoMin

  return (
    <div>
      <Rotulo>Opções</Rotulo>
      <ul className="mt-2 space-y-2">
        {trecho.opcoes.map((o, i) => {
          const Icone = ICONE_MODO[String(o.modo)] ?? Route
          const recomendado = Boolean(o.recomendado)
          return (
            <li
              key={String(o.id ?? i)}
              className="rounded-xl border p-3"
              style={{
                borderColor: recomendado ? 'var(--color-destaque-fraco)' : 'var(--color-borda)',
                background: recomendado ? 'var(--color-destaque-tenue)' : undefined,
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <Icone size={15} className="shrink-0 text-(--color-tinta-3)" aria-hidden />
                  <span className="truncate">{nomeDoModo(o.modo)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="tab-num text-sm font-semibold">
                    {formatarDuracao(o.duracao_min) || '—'}
                  </span>
                  {/* Editar e REMOVER a alternativa aqui, e não só lá dentro de
                      "Ver detalhes". Este painel é onde a pessoa olha as opções
                      lado a lado — é aqui que ela vê que uma está repetida ou
                      não faz sentido, e mandá-la procurar o mesmo botão em outra
                      tela é o caminho que ninguém faz. `AdminAcoes` decide
                      sozinho se aparece: quem não é editor não vê nada. */}
                  <AdminAcoes entidade="opcao" registro={o} />
                </span>
              </div>
              {Boolean(formatarDistancia(o.distancia_m) || o.custo) && (
                <p className="tab-num mt-1 text-[12px] text-(--color-tinta-3)">
                  {[formatarDistancia(o.distancia_m), o.custo ? String(o.custo) : '']
                    .filter(Boolean)
                    .join('  ·  ')}
                </p>
              )}
              {Boolean(o.detalhe) && (
                <p className="mt-1 text-[13px] text-(--color-tinta-2)">{String(o.detalhe)}</p>
              )}
              <div className="mt-1.5 flex items-center gap-2">
                {recomendado && (
                  <p className="t-legenda" style={{ color: 'var(--destaque)' }}>
                    Recomendado
                  </p>
                )}
                {editavel &&
                  (emUso(o) ? (
                    <p className="t-legenda ml-auto text-(--color-tinta-3)">Em uso</p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => usar(o)}
                      className="ml-auto cursor-pointer rounded-lg px-2 py-1 text-[12px] font-medium text-(--destaque) transition-colors hover:bg-(--color-destaque-tenue)"
                    >
                      Usar esta
                    </button>
                  ))}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** O corpo do painel. Vive fora do container para servir ao modal e à coluna. */
export function CorpoComoChegar({ trecho }: { trecho: Trecho }) {
  const link = linkExterno(trecho.destino, trecho.origem)
  const conferidoEm = trecho.destino.item?.updated_at
  const { editavel, limpar } = useDeslocamento(trecho)
  const temDeslocamento = Boolean(trecho.duracaoMin || trecho.distanciaM || trecho.transporte)

  return (
    <div className="space-y-4">
      <Pontas trecho={trecho} />

      {trecho.sairAs ? (
        <SaiaAs trecho={trecho} tamanho="grande" />
      ) : (
        // §26/§30: sem duração gravada a rota não foi conferida, e a tela diz
        // isso com todas as letras em vez de estimar um horário.
        <p className="rounded-xl bg-(--color-superficie-2) px-4 py-3 text-[13px] text-(--color-tinta-2)">
          Rota ainda não conferida. Sem a duração do deslocamento não dá para dizer a que horas
          sair — e um horário chutado é pior que nenhum.
        </p>
      )}

      {Boolean(trecho.duracaoMin || trecho.distanciaM) && (
        <p className="tab-num flex items-center gap-2 text-sm text-(--color-tinta-2)">
          <Clock size={14} className="shrink-0 text-(--color-tinta-3)" aria-hidden />
          {[formatarDuracao(trecho.duracaoMin), formatarDistancia(trecho.distanciaM)]
            .filter(Boolean)
            .join('  ·  ')}
          {trecho.margemMin > 0 && (
            <span className="text-(--color-tinta-3)">· {trecho.margemMin} min de margem</span>
          )}
        </p>
      )}

      {trecho.conflito && (
        <p
          className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] font-medium"
          style={{ background: 'var(--color-perigo-bg)', color: 'var(--color-perigo-ink)' }}
        >
          <AlertTriangle size={15} className="mt-px shrink-0" aria-hidden />
          <span>
            Não existe tempo suficiente para este deslocamento: {trecho.folgaMin} min disponíveis
            para {trecho.duracaoMin} min de trajeto. Faltam {trecho.faltamMin} min.
          </span>
        </p>
      )}

      {Boolean(trecho.destino.item?.como_chegar) && (
        <div>
          <Rotulo>Detalhes do trajeto</Rotulo>
          <p className="mt-1 text-sm whitespace-pre-line text-(--color-tinta-2)">
            {String(trecho.destino.item?.como_chegar)}
          </p>
        </div>
      )}

      <Opcoes trecho={trecho} />

      {/* EDITAR e EXCLUIR o deslocamento, no painel onde ele é lido.
          Os dois mexem nos mesmos três campos do item de destino —
          `duracao_min`, `distancia_m` e `transporte` — porque a faixa amarela é
          calculada deles e não é uma linha própria. Ficam DEPOIS das opções: é
          aqui que chega quem olhou as alternativas e quer ajustar o número na
          mão, ou não ficar com nenhuma.

          Editar reusa `AdminAcoes`, o mesmo editor do lápis do item, com o
          grupo "Como chegar" já lá dentro — um formulário próprio só para três
          campos seria uma quarta tela para manter em sincronia com o schema.

          Excluir não pede confirmação porque não destrói nada: as alternativas
          continuam ali e um clique em "Usar esta" refaz. */}
      {editavel && (
        <div className="flex flex-wrap items-center gap-1">
          <AdminAcoes entidade="roteiro" registro={trecho.destino.item}>
            Editar deslocamento
          </AdminAcoes>
          {temDeslocamento && (
            <button
              type="button"
              onClick={limpar}
              className="toque inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium text-(--color-tinta-3) transition-colors hover:bg-(--color-perigo-bg) hover:text-(--color-perigo-ink)"
            >
              <Trash2 size={15} aria-hidden /> Excluir deslocamento
            </button>
          )}
        </div>
      )}

      {trecho.destino.endereco && (
        <p className="flex items-start gap-2 text-[13px] text-(--color-tinta-2)">
          <MapPin size={14} className="mt-0.5 shrink-0 text-(--color-tinta-3)" aria-hidden />
          {trecho.destino.endereco}
        </p>
      )}

      {/* §31: o app já mostrou origem, destino, duração, hora de sair e margem.
          O aplicativo externo serve para a navegação passo a passo, não para a
          experiência básica — que continua funcionando sem sinal. */}
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="toque inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-(--color-borda) px-4 text-sm font-medium"
          style={{ color: 'var(--destaque)' }}
        >
          <Navigation size={14} aria-hidden /> Abrir no mapa
        </a>
      )}

      {/* §30: a rota é dado salvo, nunca consulta ao vivo. Dizer QUANDO foi
          conferida é o que impede alguém de tratar um número de três meses
          atrás como o trânsito de agora. */}
      {Boolean(conferidoEm) && (
        <p className="text-[12px] text-(--color-tinta-3)">
          Dados salvos no aparelho. Conferido em{' '}
          {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(
            new Date(String(conferidoEm)),
          )}
          .
        </p>
      )}
    </div>
  )
}

/**
 * O painel completo, com título e container.
 *
 * `AppModal` abaixo de xl — no celular a coluna de apoio fica depois de toda a
 * linha do tempo, e mandar a pessoa rolar até lá é perder o contexto do toque.
 * No desktop o mesmo corpo é embutido na coluna da direita pelo Roteiro.
 */
export function ModalComoChegar({ trecho, aoFechar }: { trecho: Trecho; aoFechar: () => void }) {
  return (
    <AppModal
      titulo="Como chegar"
      descricao={
        <span className="flex items-center gap-1.5">
          {trecho.origem?.titulo ?? 'Você'} <ArrowRight size={12} aria-hidden />{' '}
          {trecho.destino.titulo}
        </span>
      }
      tamanho="medio"
      aoFechar={aoFechar}
    >
      <div className="pb-2">
        <CorpoComoChegar trecho={trecho} />
      </div>
    </AppModal>
  )
}

/** O painel embutido — a coluna da direita do desktop (§36). */
export function PainelComoChegar({ trecho, aoFechar }: { trecho: Trecho; aoFechar: () => void }) {
  return (
    <Cartao>
      <div className="mb-3 flex items-start justify-between gap-2">
        <Rotulo>Como chegar</Rotulo>
        <button
          type="button"
          onClick={aoFechar}
          className="-mt-1 -mr-1 cursor-pointer rounded-lg px-2 py-1 text-[12px] text-(--color-tinta-3) hover:bg-(--color-superficie-2) hover:text-(--color-tinta)"
        >
          Fechar
        </button>
      </div>
      <CorpoComoChegar trecho={trecho} />
    </Cartao>
  )
}

/**
 * Desktop de verdade, para escolher entre painel embutido e modal.
 *
 * Começa `false` para o servidor e o primeiro pintar baterem — decidir por
 * `window` na primeira render dá dois HTMLs diferentes e o React reclama.
 */
export function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 80rem)')
    const aplicar = () => setDesktop(mq.matches)
    aplicar()
    mq.addEventListener('change', aplicar)
    return () => mq.removeEventListener('change', aplicar)
  }, [])

  return desktop
}
