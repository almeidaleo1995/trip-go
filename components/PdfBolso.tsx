'use client'

// PDF de bolso: uma folha com o essencial, para o dia em que o celular morrer.
//
// ponytail: window.print() + @media print, sem biblioteca de PDF. jspdf ou
// react-pdf custariam ~300 KB de bundle para produzir uma página A4 estática, e
// o diálogo do navegador já oferece "Salvar como PDF" e imprimir.
//
// Fica sempre montado, invisível na tela e visível só na impressão — assim o
// botão funciona de qualquer aba, sem trocar de rota.
import { useTrip } from './TripProvider.tsx'
import { formatarData, formatarHora, noites } from '@/lib/derive.ts'

export function PdfBolso() {
  const { snapshot } = useTrip()
  if (!snapshot?.viagem) return null
  const v = snapshot.viagem

  return (
    <div className="hidden print:block">
      <h1 style={{ fontSize: '16pt', fontWeight: 700, margin: 0 }}>{String(v.nome)}</h1>
      <p style={{ margin: '2mm 0 4mm', fontSize: '10pt' }}>
        {formatarData(v.data_partida, { day: '2-digit', month: '2-digit', year: 'numeric' })} a{' '}
        {formatarData(v.data_retorno, { day: '2-digit', month: '2-digit', year: 'numeric' })}
        {v.subtitulo ? ` · ${v.subtitulo}` : ''}
      </p>

      <Bloco titulo="Voos">
        {(snapshot.voos as any[]).map((f) => (
          <p key={String(f.id)} style={linha}>
            <strong>
              {f.origem_iata} → {f.destino_iata}
            </strong>{' '}
            · {formatarData(f.parte_em)} {formatarHora(f.parte_em)} · {f.companhia}
            {f.numero ? ` ${f.numero}` : ''}
            {f.localizador ? ` · loc. ${f.localizador}` : ''}
          </p>
        ))}
      </Bloco>

      {(snapshot.cruzeiros as any[]).length > 0 && (
        <Bloco titulo="Cruzeiro">
          {(snapshot.cruzeiros as any[]).map((c) => (
            <div key={String(c.id)}>
              <p style={linha}>
                <strong>{String(c.navio)}</strong> · embarque {formatarData(c.embarque_em)}{' '}
                {formatarHora(c.embarque_em)} em {c.porto_embarque ?? '—'}
                {c.terminal ? ` · terminal ${c.terminal}` : ' · TERMINAL: ________________'}
                {c.cabine ? ` · cabine ${c.cabine}` : ' · cabine: __________'}
              </p>
              {((c.portos ?? []) as any[]).map((p, i) => (
                <p key={i} style={{ ...linha, paddingLeft: '4mm' }}>
                  {formatarData(p.chega_em)} · {p.dia_no_mar ? 'dia no mar' : (p.porto ?? p.cidade)}
                  {!p.dia_no_mar && p.chega_em
                    ? ` · ${formatarHora(p.chega_em)}–${formatarHora(p.sai_em)}`
                    : ''}
                </p>
              ))}
            </div>
          ))}
        </Bloco>
      )}

      <Bloco titulo="Hospedagem">
        {(snapshot.reservas as any[])
          .filter((r) => r.tipo === 'hospedagem')
          .map((h) => (
            <p key={String(h.id)} style={linha}>
              <strong>{String(h.nome)}</strong>
              {h.cidade ? ` · ${h.cidade}` : ''} · {formatarData(h.inicio_em)} a{' '}
              {formatarData(h.fim_em)} ({noites(h.inicio_em, h.fim_em)}n)
              {h.endereco ? ` · ${h.endereco}` : ' · endereço: ______________________'}
              {h.telefone ? ` · ${h.telefone}` : ''}
            </p>
          ))}
      </Bloco>

      <Bloco titulo="Emergência">
        {(snapshot.emergencia as any[]).map((c) => (
          <p key={String(c.id)} style={linha}>
            <strong>{String(c.titulo)}:</strong>{' '}
            {c.telefone ? String(c.telefone) : '________________________'}
          </p>
        ))}
      </Bloco>

      <Bloco titulo="Documentos">
        {(snapshot.documentos as any[]).map((d) => (
          <p key={String(d.id)} style={linha}>
            <strong>{String(d.titulo)}:</strong>{' '}
            {d.valor ? String(d.valor) : '________________________'}
          </p>
        ))}
      </Bloco>

      <Bloco titulo="Viajantes">
        {(snapshot.participantes as any[]).map((t) => (
          <p key={String(t.id)} style={linha}>
            {String(t.nome)} · passaporte: {t.passaporte ? String(t.passaporte) : '______________'}{' '}
            · validade: __________
          </p>
        ))}
      </Bloco>

      <p style={{ marginTop: '6mm', fontSize: '8pt', color: '#475569' }}>
        Impresso de {String(v.nome)} · confira horários no voucher e no programa diário de bordo,
        que mandam mais que esta folha.
      </p>
    </div>
  )
}

const linha: React.CSSProperties = { margin: '1mm 0', fontSize: '9.5pt', lineHeight: 1.35 }

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="quebra-evitar" style={{ marginBottom: '4mm' }}>
      <h2
        style={{
          fontSize: '10pt',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          borderBottom: '0.5pt solid #94a3b8',
          paddingBottom: '1mm',
          marginBottom: '1.5mm',
        }}
      >
        {titulo}
      </h2>
      {children}
    </section>
  )
}
