'use client'

// Aba que escreve: Emergência (leitura, mas crítica). Checklist tem tela
// própria em tabs/Checklist.tsx — cresceu demais para caber aqui junto.
// O Financeiro tem tela própria em tabs/Financeiro.tsx — ele deixou de ser uma
// lista de custos e virou um módulo com divisão, parcelas e acertos.
import { useState } from 'react'
import { Phone } from 'lucide-react'
import { useTrip } from '../TripProvider.tsx'
import { Cartao, Titulo, Vazio } from '../ui.tsx'
import { AdminAcoes } from '../EditorSheet.tsx'

// ---------------------------------------------------------------- Emergência

export function Emergencia() {
  const { snapshot } = useTrip()
  const contatos = (snapshot?.emergencia ?? []) as Record<string, unknown>[]

  // Fonte maior que as demais abas de propósito (EMG-04): esta tela é lida sob
  // estresse, às vezes por outra pessoa segurando o celular.
  return (
    <div className="text-[17px]">
      <Titulo acao={<AdminAcoes entidade="emergencia">Contato</AdminAcoes>}>Emergência</Titulo>
      <p className="-mt-2 mb-4 text-sm text-(--color-tinta-2)">
        Funciona sem internet. Toque no número para ligar.
      </p>

      {contatos.length === 0 ? (
        <Vazio
          titulo="Nenhum contato cadastrado"
          texto="Telefones de emergência, consulados e seguro aparecem aqui."
        />
      ) : (
        <div className="space-y-2.5">
          {contatos.map((c) => (
            <Cartao key={String(c.id)}>
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold">{String(c.titulo)}</p>
                <AdminAcoes entidade="emergencia" registro={c} />
              </div>
              {Boolean(c.detalhe) && (
                <p className="mt-1 text-[15px] text-(--color-tinta-2)">{String(c.detalhe)}</p>
              )}
              {c.telefone ? (
                <a
                  href={`tel:${String(c.telefone).replace(/[^\d+]/g, '')}`}
                  className="tab-num toque mt-2.5 inline-flex items-center gap-2 rounded-xl px-4 text-lg font-bold text-white"
                  style={{ background: 'var(--destaque)' }}
                >
                  <Phone size={18} /> {String(c.telefone)}
                </a>
              ) : (
                <p className="mt-2 inline-block rounded-full bg-(--color-alerta-bg) px-3 py-1 text-[13px] font-semibold text-(--color-alerta-ink)">
                  A preencher
                </p>
              )}
            </Cartao>
          ))}
        </div>
      )}
    </div>
  )
}
