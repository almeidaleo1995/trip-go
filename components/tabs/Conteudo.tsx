'use client'

// Abas de leitura: Roteiro, Voos, Cruzeiro, Hospedagem, Cidades, Documentos.
//
// Ficam num arquivo só porque compartilham a mesma forma — ler do snapshot,
// ordenar, renderizar cartão, tratar vazio. Separá-las em seis arquivos daria
// seis cabeçalhos de import iguais e nada mais.
import { ExternalLink, Phone, Anchor, Waves, MapPin, Moon, Plane } from 'lucide-react'
import { useTrip } from '../TripProvider.tsx'
import { Cartao, Vazio, Rotulo, Badge, Copiar, Titulo, Linha } from '../ui.tsx'
import { AdminAcoes } from '../EditorSheet.tsx'
import {
  ordenarEventos,
  formatarData,
  formatarHora,
  formatarDuracao,
  noites,
  noitesABordo,
  parseData,
} from '@/lib/derive.ts'

// ---------------------------------------------------------------- Roteiro

export function Roteiro() {
  const { snapshot } = useTrip()
  const eventos = ordenarEventos((snapshot?.roteiro ?? []) as any[])

  if (eventos.length === 0) {
    return (
      <>
        <Titulo acao={<AdminAcoes entidade="roteiro">+ Evento</AdminAcoes>}>Roteiro</Titulo>
        <Vazio
          titulo="Roteiro ainda vazio"
          texto="Quando os dias da viagem forem cadastrados, eles aparecem aqui em ordem, dia a dia."
        />
      </>
    )
  }

  // Agrupa por dia. Evento sem data válida cai em "Sem data" no fim.
  const porDia = new Map<string, any[]>()
  for (const e of eventos) {
    const d = parseData(e.ocorre_em)
    const chave = d ? formatarData(e.ocorre_em, { day: '2-digit', month: '2-digit' }) : 'Sem data'
    if (!porDia.has(chave)) porDia.set(chave, [])
    porDia.get(chave)!.push(e)
  }

  return (
    <>
      <Titulo acao={<AdminAcoes entidade="roteiro">+ Evento</AdminAcoes>}>Roteiro</Titulo>
      <div className="space-y-5">
        {[...porDia.entries()].map(([dia, doDia]) => (
          <div key={dia}>
            <div className="mb-2 flex items-baseline gap-2">
              <p className="tab-num text-lg font-bold">{dia}</p>
              <p className="text-sm text-[--color-tinta-3]">
                {doDia[0].ocorre_em
                  ? formatarData(doDia[0].ocorre_em, { weekday: 'long' })
                  : 'data a confirmar'}
              </p>
            </div>
            <div className="space-y-2">
              {doDia.map((e) => (
                <Cartao
                  key={String(e.id)}
                  className={e.ancora ? '!border-l-4' : ''}
                  {...(e.ancora ? { style: { borderLeftColor: 'var(--destaque)' } } : {})}
                >
                  <div className="flex items-start gap-3">
                    <span className="tab-num w-12 shrink-0 pt-0.5 text-sm font-semibold text-[--color-tinta-2]">
                      {formatarHora(e.ocorre_em) || '—'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{String(e.titulo)}</p>
                      {(e.cidade || e.local) && (
                        <p className="mt-0.5 text-[13px] text-[--color-tinta-3]">
                          {[e.local, e.cidade].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {e.descricao && (
                        <p className="mt-1.5 text-sm text-[--color-tinta-2]">
                          {String(e.descricao)}
                        </p>
                      )}
                      {e.nota && (
                        <p className="mt-1.5 text-sm text-[--color-tinta-3] italic">
                          {String(e.nota)}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tipo={String(e.tipo)} />
                      <AdminAcoes entidade="roteiro" registro={e} />
                    </div>
                  </div>
                </Cartao>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Voos

export function Voos() {
  const { snapshot } = useTrip()
  const voos = (snapshot?.voos ?? []) as any[]

  if (voos.length === 0) {
    return (
      <>
        <Titulo acao={<AdminAcoes entidade="voo">+ Voo</AdminAcoes>}>Voos</Titulo>
        <Vazio titulo="Nenhum voo cadastrado" texto="Os trechos aéreos aparecem aqui em cartões." />
      </>
    )
  }

  const ordenados = [...voos].sort((a, b) => {
    const ta = parseData(a.parte_em)?.getTime() ?? Infinity
    const tb = parseData(b.parte_em)?.getTime() ?? Infinity
    return ta - tb
  })

  return (
    <>
      <Titulo acao={<AdminAcoes entidade="voo">+ Voo</AdminAcoes>}>Voos e transportes</Titulo>

      {/* tabela — só no desktop, onde as colunas cabem sem rolagem horizontal */}
      <div className="mb-3 hidden overflow-hidden rounded-2xl border border-[--color-borda] bg-[--color-cartao] shadow-[0_1px_3px_rgb(0_0_0/0.06)] lg:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[--color-borda] bg-[--color-fundo] text-left">
              {['Data', 'Origem → Destino', 'Voo', 'Horário', 'Duração', 'Localizador'].map((h) => (
                <th
                  key={h}
                  className="px-4 py-2.5 text-[11px] font-semibold tracking-[0.06em] text-[--color-tinta-3] uppercase"
                >
                  {h}
                </th>
              ))}
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[--color-borda]">
            {ordenados.map((v) => (
              <tr key={String(v.id)} className="transition-colors hover:bg-[--color-fundo]">
                <td className="tab-num px-4 py-3 whitespace-nowrap">
                  {formatarData(v.parte_em) || '—'}
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2 font-medium">
                    <Plane size={14} className="shrink-0" style={{ color: 'var(--destaque)' }} />
                    {v.origem_cidade ?? v.origem_iata ?? '—'}
                    <span className="text-[--color-tinta-3]">→</span>
                    {v.destino_cidade ?? v.destino_iata ?? '—'}
                  </span>
                </td>
                <td className="tab-num px-4 py-3 whitespace-nowrap">
                  <span className="block">{String(v.companhia ?? '')}</span>
                  {v.numero && (
                    <span className="text-[12px] text-[--color-tinta-3]">{String(v.numero)}</span>
                  )}
                </td>
                <td className="tab-num px-4 py-3 whitespace-nowrap">
                  {formatarHora(v.parte_em) || '—'}
                  {v.chega_em ? ` – ${formatarHora(v.chega_em)}` : ''}
                </td>
                <td className="tab-num px-4 py-3 whitespace-nowrap text-[--color-tinta-2]">
                  {v.duracao_min ? formatarDuracao(Number(v.duracao_min)) : '—'}
                </td>
                <td className="px-4 py-3">
                  {v.localizador ? <Copiar valor={String(v.localizador)} /> : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <AdminAcoes entidade="voo" registro={v} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* cartões — celular e tablet */}
      <div className="space-y-3 lg:hidden">
        {ordenados.map((v) => {
          const escalas = (v.escalas ?? []) as any[]
          return (
            <Cartao key={String(v.id)}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{String(v.companhia)}</p>
                  {v.numero && (
                    <p className="tab-num text-[13px] text-[--color-tinta-3]">{String(v.numero)}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {v.duracao_min ? (
                    <Badge tipo="voo" texto={formatarDuracao(Number(v.duracao_min))} />
                  ) : null}
                  <AdminAcoes entidade="voo" registro={v} />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Ponta
                  iata={v.origem_iata}
                  cidade={v.origem_cidade}
                  quando={v.parte_em}
                  alinhamento="esquerda"
                />
                <div className="flex-1 text-center">
                  <div className="relative h-px bg-[--color-borda]">
                    <span
                      className="absolute -top-[7px] left-1/2 -translate-x-1/2 rounded-full bg-[--color-cartao] px-1.5 text-[10px] font-semibold"
                      style={{ color: 'var(--destaque)' }}
                    >
                      {escalas.length === 0
                        ? 'Direto'
                        : `${escalas.length} ${escalas.length === 1 ? 'escala' : 'escalas'}`}
                    </span>
                  </div>
                </div>
                <Ponta
                  iata={v.destino_iata}
                  cidade={v.destino_cidade}
                  quando={v.chega_em}
                  alinhamento="direita"
                />
              </div>

              {escalas.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-[--color-borda] pt-3">
                  {escalas.map((e, i) => (
                    <li key={i} className="flex justify-between text-[13px] text-[--color-tinta-2]">
                      <span>
                        Escala em {e.cidade ?? e.iata}
                        {e.iata && e.cidade ? ` (${e.iata})` : ''}
                      </span>
                      {e.espera_min ? (
                        <span className="tab-num font-medium">
                          {formatarDuracao(Number(e.espera_min))} de espera
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {v.localizador && (
                <div className="mt-3 flex items-center justify-between border-t border-[--color-borda] pt-3">
                  <Rotulo>Localizador</Rotulo>
                  <Copiar valor={String(v.localizador)} rotulo="localizador" />
                </div>
              )}

              {v.nota && (
                <p className="mt-3 rounded-xl bg-[--color-fundo] px-3 py-2 text-[13px] text-[--color-tinta-2]">
                  {String(v.nota)}
                </p>
              )}
            </Cartao>
          )
        })}
      </div>
    </>
  )
}

function Ponta({
  iata,
  cidade,
  quando,
  alinhamento,
}: {
  iata?: string
  cidade?: string
  quando?: string
  alinhamento: 'esquerda' | 'direita'
}) {
  return (
    <div className={alinhamento === 'direita' ? 'text-right' : ''}>
      <p className="tab-num text-xl leading-none font-bold">{iata ?? '—'}</p>
      <p className="mt-1 max-w-[9ch] truncate text-[11px] text-[--color-tinta-3]">{cidade ?? ''}</p>
      {quando && (
        <p className="tab-num mt-1 text-sm font-semibold">
          {formatarHora(quando)}
          <span className="ml-1 text-[11px] font-normal text-[--color-tinta-3]">
            {formatarData(quando)}
          </span>
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Cruzeiro

export function Cruzeiro() {
  const { snapshot } = useTrip()
  const cruzeiros = (snapshot?.cruzeiros ?? []) as any[]

  if (cruzeiros.length === 0) {
    return (
      <>
        <Titulo acao={<AdminAcoes entidade="cruzeiro">+ Cruzeiro</AdminAcoes>}>Cruzeiro</Titulo>
        <Vazio
          titulo="Sem cruzeiro nesta viagem"
          texto="Esta aba aparece quando há um navio no roteiro."
        />
      </>
    )
  }

  return (
    <>
      <Titulo acao={<AdminAcoes entidade="cruzeiro">+ Cruzeiro</AdminAcoes>}>Cruzeiro</Titulo>
      <div className="space-y-4">
        {cruzeiros.map((c) => {
          const portos = [...((c.portos ?? []) as any[])].sort(
            (a, b) => Number(a.ordem ?? 0) - Number(b.ordem ?? 0),
          )
          const nApenas = noitesABordo(c.embarque_em, c.desembarque_em)
          return (
            <div key={String(c.id)} className="space-y-3">
              <Cartao>
                <div className="flex items-start gap-3">
                  <Anchor
                    size={20}
                    className="mt-1 shrink-0"
                    style={{ color: 'var(--destaque)' }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-lg leading-tight font-semibold">{String(c.navio)}</p>
                    {c.companhia && (
                      <p className="text-sm text-[--color-tinta-3]">{String(c.companhia)}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {nApenas > 0 && (
                      <Badge
                        tipo="cruzeiro"
                        texto={`${nApenas} ${nApenas === 1 ? 'noite' : 'noites'}`}
                      />
                    )}
                    <AdminAcoes entidade="cruzeiro" registro={c} />
                  </div>
                </div>

                <div className="mt-3 divide-y divide-[--color-borda] border-t border-[--color-borda] pt-1">
                  <Linha
                    rotulo="Embarque"
                    valor={
                      c.embarque_em
                        ? `${c.porto_embarque ?? ''} · ${formatarData(c.embarque_em)} ${formatarHora(c.embarque_em)}`
                        : (c.porto_embarque ?? null)
                    }
                  />
                  <Linha
                    rotulo="Desembarque"
                    valor={
                      c.desembarque_em
                        ? `${c.porto_desembarque ?? ''} · ${formatarData(c.desembarque_em)} ${formatarHora(c.desembarque_em)}`
                        : (c.porto_desembarque ?? null)
                    }
                  />
                  <Linha rotulo="Terminal" valor={c.terminal ?? null} />
                  <Linha rotulo="Cabine" valor={c.cabine ?? null} />
                  <Linha
                    rotulo="Reserva"
                    valor={c.localizador ? <Copiar valor={String(c.localizador)} /> : null}
                  />
                </div>

                {c.nota && (
                  <p className="mt-3 rounded-xl bg-[--color-fundo] px-3 py-2 text-[13px] text-[--color-tinta-2]">
                    {String(c.nota)}
                  </p>
                )}
              </Cartao>

              {portos.length > 0 && (
                <div>
                  <Rotulo>Escalas</Rotulo>
                  <div className="mt-2 space-y-2">
                    {portos.map((p, i) => (
                      <Cartao key={String(p.id ?? i)}>
                        <div className="flex items-start gap-3">
                          {p.dia_no_mar ? (
                            <Waves size={18} className="mt-0.5 shrink-0 text-[--color-tinta-3]" />
                          ) : (
                            <MapPin
                              size={18}
                              className="mt-0.5 shrink-0"
                              style={{ color: 'var(--destaque)' }}
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="font-medium">
                              {p.dia_no_mar ? 'Dia no mar' : (p.porto ?? p.cidade ?? 'Porto')}
                            </p>
                            <p className="text-[13px] text-[--color-tinta-3]">
                              {[p.dia_no_mar ? null : p.cidade, p.pais].filter(Boolean).join(' · ')}
                            </p>
                            {p.nota && (
                              <p className="mt-1.5 text-sm text-[--color-tinta-2]">
                                {String(p.nota)}
                              </p>
                            )}
                          </div>
                          <div className="tab-num shrink-0 text-right text-sm">
                            {p.chega_em && (
                              <p className="font-semibold">{formatarData(p.chega_em)}</p>
                            )}
                            {!p.dia_no_mar && (p.chega_em || p.sai_em) && (
                              <p className="text-[--color-tinta-3]">
                                {formatarHora(p.chega_em)}
                                {p.sai_em ? ` – ${formatarHora(p.sai_em)}` : ''}
                              </p>
                            )}
                          </div>
                        </div>
                      </Cartao>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Hospedagem

export function Hospedagem() {
  const { snapshot } = useTrip()
  const estadias = ((snapshot?.reservas ?? []) as any[]).filter((r) => r.tipo === 'hospedagem')

  if (estadias.length === 0) {
    return (
      <>
        <Titulo acao={<AdminAcoes entidade="reserva">+ Estadia</AdminAcoes>}>Hospedagem</Titulo>
        <Vazio
          titulo="Nenhuma estadia cadastrada"
          texto="Hotéis e apartamentos aparecem aqui, com as noites calculadas."
        />
      </>
    )
  }

  return (
    <>
      <Titulo acao={<AdminAcoes entidade="reserva">+ Estadia</AdminAcoes>}>Hospedagem</Titulo>
      <div className="space-y-3">
        {estadias.map((h) => {
          const n = noites(h.inicio_em, h.fim_em)
          return (
            <Cartao key={String(h.id)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{String(h.nome)}</p>
                  {h.cidade && <p className="text-sm text-[--color-tinta-3]">{String(h.cidade)}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {n > 0 && (
                    <span className="tab-num inline-flex items-center gap-1 rounded-full bg-[--color-fundo] px-2.5 py-1 text-[11px] font-semibold">
                      <Moon size={11} /> {n} {n === 1 ? 'noite' : 'noites'}
                    </span>
                  )}
                  <AdminAcoes entidade="reserva" registro={h} />
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[--color-borda] pt-3">
                <div>
                  <Rotulo>Check-in</Rotulo>
                  <p className="tab-num mt-0.5 font-medium">{formatarData(h.inicio_em) || '—'}</p>
                </div>
                <div>
                  <Rotulo>Check-out</Rotulo>
                  <p className="tab-num mt-0.5 font-medium">{formatarData(h.fim_em) || '—'}</p>
                </div>
              </div>

              {h.endereco && (
                <p className="mt-3 text-sm text-[--color-tinta-2]">{String(h.endereco)}</p>
              )}
              {h.nota && (
                <p className="mt-2 rounded-xl bg-[--color-fundo] px-3 py-2 text-[13px] text-[--color-tinta-2]">
                  {String(h.nota)}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {h.link && (
                  <a
                    href={String(h.link)}
                    target="_blank"
                    rel="noreferrer"
                    className="toque inline-flex items-center gap-1.5 rounded-xl border border-[--color-borda] px-3 text-sm"
                  >
                    <ExternalLink size={14} /> Abrir reserva
                  </a>
                )}
                {h.telefone && (
                  <a
                    href={`tel:${String(h.telefone).replace(/\s/g, '')}`}
                    className="toque inline-flex items-center gap-1.5 rounded-xl border border-[--color-borda] px-3 text-sm"
                  >
                    <Phone size={14} /> {String(h.telefone)}
                  </a>
                )}
              </div>
            </Cartao>
          )
        })}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Cidades

export function Lugares() {
  const { snapshot } = useTrip()
  const lugares = (snapshot?.lugares ?? []) as any[]

  if (lugares.length === 0) {
    return (
      <>
        <Titulo acao={<AdminAcoes entidade="lugar">+ Cidade</AdminAcoes>}>Cidades & Países</Titulo>
        <Vazio
          titulo="Nenhum lugar cadastrado"
          texto="Cada cidade visitada aparece aqui, com país, dias e as suas notas."
        />
      </>
    )
  }

  return (
    <>
      <Titulo acao={<AdminAcoes entidade="lugar">+ Cidade</AdminAcoes>}>Cidades & Países</Titulo>
      <div className="space-y-3">
        {lugares.map((l) => (
          <Cartao key={String(l.id)}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{String(l.cidade)}</p>
                {l.pais && <p className="text-sm text-[--color-tinta-3]">{String(l.pais)}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {l.dias ? (
                  <span className="tab-num rounded-full bg-[--color-fundo] px-2.5 py-1 text-[11px] font-semibold">
                    {Number(l.dias)} {Number(l.dias) === 1 ? 'dia' : 'dias'}
                  </span>
                ) : null}
                <AdminAcoes entidade="lugar" registro={l} />
              </div>
            </div>
            {l.notas && <p className="mt-2.5 text-sm text-[--color-tinta-2]">{String(l.notas)}</p>}
            {l.lat == null && (
              <p className="mt-2 text-[12px] text-[--color-tinta-3]">
                Sem coordenada — não aparece no mapa do Início.
              </p>
            )}
          </Cartao>
        ))}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Documentos

export function Documentos() {
  const { snapshot } = useTrip()
  const docs = (snapshot?.documentos ?? []) as any[]

  if (docs.length === 0) {
    return (
      <>
        <Titulo acao={<AdminAcoes entidade="documento">+ Documento</AdminAcoes>}>Documentos</Titulo>
        <Vazio
          titulo="Nenhum documento cadastrado"
          texto="Localizadores, apólices e links importantes ficam aqui."
        />
      </>
    )
  }

  return (
    <>
      <Titulo acao={<AdminAcoes entidade="documento">+ Documento</AdminAcoes>}>Documentos</Titulo>
      <div className="space-y-2">
        {docs.map((d) => (
          <Cartao key={String(d.id)}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{String(d.titulo)}</p>
                {d.obs && (
                  <p className="mt-0.5 text-[13px] text-[--color-tinta-3]">{String(d.obs)}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <AdminAcoes entidade="documento" registro={d} />
                {!d.valor ? (
                  <span className="rounded-full bg-[--color-alerta-bg] px-2.5 py-1 text-[11px] font-semibold text-[--color-alerta-ink]">
                    A preencher
                  </span>
                ) : d.tipo === 'link' ? (
                  <a
                    href={String(d.valor)}
                    target="_blank"
                    rel="noreferrer"
                    className="toque inline-flex items-center gap-1.5 text-sm font-medium"
                    style={{ color: 'var(--destaque)' }}
                  >
                    Abrir <ExternalLink size={14} />
                  </a>
                ) : d.tipo === 'telefone' ? (
                  <a
                    href={`tel:${String(d.valor).replace(/\s/g, '')}`}
                    className="tab-num toque inline-flex items-center gap-1.5 text-sm font-semibold"
                    style={{ color: 'var(--destaque)' }}
                  >
                    <Phone size={14} /> {String(d.valor)}
                  </a>
                ) : (
                  <Copiar valor={String(d.valor)} rotulo={String(d.titulo)} />
                )}
              </div>
            </div>
          </Cartao>
        ))}
      </div>
    </>
  )
}
