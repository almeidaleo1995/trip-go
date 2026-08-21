'use client'

// Aba Dados (só admin): importar viagem, exportar backup, imprimir PDF de bolso.
import { useState } from 'react'
import { Upload, Download, Printer, AlertTriangle } from 'lucide-react'
import { useTrip } from '../TripProvider.tsx'
import { Cartao, Rotulo, Titulo, Botao } from '../ui.tsx'

type Resumo = Record<string, number>

export function Dados() {
  const { souAdmin, recarregar } = useTrip()
  if (!souAdmin) return null

  return (
    <>
      <Titulo>Dados</Titulo>
      <div className="space-y-3">
        <Cartao>
          <Rotulo>PDF de bolso</Rotulo>
          <p className="mt-1 text-sm text-[--color-tinta-2]">
            Uma folha com voos, cruzeiro, endereços, contatos de emergência e documentos. Escolha
            &ldquo;Salvar como PDF&rdquo; para guardar na galeria, ou imprima antes de sair de casa.
          </p>
          <div className="mt-3">
            <Botao variante="secundario" onClick={() => window.print()}>
              <Printer size={16} /> Imprimir ou salvar em PDF
            </Botao>
          </div>
        </Cartao>

        <Cartao>
          <Rotulo>Exportar backup</Rotulo>
          <p className="mt-1 text-sm text-[--color-tinta-2]">
            Baixa um JSON com a viagem inteira, no mesmo formato que a importação aceita. Os PINs
            <strong> não</strong> vão no arquivo — quem restaurar precisa defini-los de novo.
          </p>
          <div className="mt-3">
            <Botao variante="secundario" onClick={() => (window.location.href = '/api/export')}>
              <Download size={16} /> Baixar JSON
            </Botao>
          </div>
        </Cartao>

        <Importar aoConcluir={recarregar} />
      </div>
    </>
  )
}

function Importar({ aoConcluir }: { aoConcluir: () => Promise<void> }) {
  const [arquivo, setArquivo] = useState<{ nome: string; texto: string } | null>(null)
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [nomeViagem, setNomeViagem] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  // Passo 1: dry_run. Mostra o que vai entrar ANTES de tocar no banco (DATA-02).
  async function prever(texto: string, nome: string) {
    setErro(null)
    setOcupado(true)
    try {
      const r = await fetch('/api/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dry_run: true, arquivo: JSON.parse(texto) }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.erro ?? 'Arquivo inválido.')
      setArquivo({ nome, texto })
      setResumo(d.resumo)
      setNomeViagem(d.viagem)
    } catch (e) {
      setArquivo(null)
      setResumo(null)
      setErro(e instanceof Error ? e.message : 'Arquivo inválido.')
    } finally {
      setOcupado(false)
    }
  }

  async function confirmar() {
    if (!arquivo) return
    setOcupado(true)
    try {
      const r = await fetch('/api/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: arquivo.texto,
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.erro ?? 'Falhou.')
      setArquivo(null)
      setResumo(null)
      await aoConcluir()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falhou.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Cartao>
      <Rotulo>Importar viagem</Rotulo>
      <p className="mt-1 text-sm text-[--color-tinta-2]">
        Sobe um JSON no formato do app. A viagem atual é arquivada e a nova vira a ativa.
      </p>

      <div className="mt-3">
        <label className="toque inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[--color-borda] px-4 text-sm font-medium">
          <Upload size={16} /> {ocupado ? 'Lendo…' : 'Escolher arquivo'}
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              await prever(await f.text(), f.name)
              e.target.value = ''
            }}
          />
        </label>
      </div>

      {erro && (
        <p className="mt-3 rounded-xl bg-[--color-alerta-bg] px-3 py-2 text-sm text-[--color-alerta-ink]">
          {erro}
        </p>
      )}

      {resumo && (
        <div className="mt-4 rounded-xl border border-[--color-borda] p-3">
          <div className="mb-2 flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[--color-alerta-ink]" />
            <p className="text-sm">
              Vai importar <strong>{nomeViagem}</strong> e arquivar a viagem atual. Isso não pode
              ser desfeito pelo app — exporte um backup antes se quiser voltar atrás.
            </p>
          </div>
          <ul className="tab-num mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
            {Object.entries(resumo).map(([secao, n]) => (
              <li
                key={secao}
                className="flex justify-between border-b border-[--color-borda] py-0.5"
              >
                <span className="text-[--color-tinta-3] capitalize">{secao}</span>
                <span className={n === 0 ? 'text-[--color-tinta-3]' : 'font-semibold'}>{n}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <Botao onClick={confirmar}>{ocupado ? 'Importando…' : 'Confirmar importação'}</Botao>
            <Botao
              variante="secundario"
              onClick={() => {
                setArquivo(null)
                setResumo(null)
              }}
            >
              Cancelar
            </Botao>
          </div>
        </div>
      )}
    </Cartao>
  )
}
