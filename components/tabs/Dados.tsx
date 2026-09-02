'use client'

// Aba Dados (só admin): importar viagem, exportar backup, imprimir PDF de bolso.
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Upload, Download, Printer, AlertTriangle, ChevronRight } from 'lucide-react'
import { useTrip } from '../TripProvider.tsx'
import { Avatar, Badge, Botao, Cartao, Progresso, Rotulo, Titulo } from '../ui.tsx'
import { formatarData } from '@/lib/derive.ts'
import { AdminAcoes } from '../EditorSheet.tsx'

type Resumo = Record<string, number>

const NOME_PAPEL: Record<string, string> = {
  proprietario: 'Dono da viagem',
  editor: 'Editor',
  visualizador: 'Visualizador',
}

export function Dados() {
  const { posso, recarregar, snapshot } = useTrip()
  if (!posso('proprietario') || !snapshot) return null

  return (
    <>
      <Titulo descricao="Só você, como dono da viagem, enxerga esta aba.">
        Participantes e dados
      </Titulo>
      <div className="space-y-3">
        <Cartao>
          <div className="flex items-start justify-between gap-3">
            <div>
              <Rotulo>A viagem</Rotulo>
              <p className="mt-1 font-semibold">{String(snapshot.viagem?.nome ?? '—')}</p>
              <p className="tab-num text-sm text-(--color-tinta-3)">
                {formatarData(String(snapshot.viagem?.data_partida ?? '').slice(0, 10), {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}{' '}
                a{' '}
                {formatarData(String(snapshot.viagem?.data_retorno ?? '').slice(0, 10), {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}{' '}
                · {String(snapshot.viagem?.moeda ?? '')}
              </p>
            </div>
            <AdminAcoes entidade="viagem" registro={snapshot.viagem ?? undefined} />
          </div>
        </Cartao>

        <Cartao>
          <div className="mb-2 flex items-center justify-between">
            <Rotulo>Participantes</Rotulo>
            <AdminAcoes entidade="participante">Participante</AdminAcoes>
          </div>
          <p className="mb-3 text-[12px] text-(--color-tinta-3)">
            Informar o e-mail de uma conta existente liga o participante a ela; sem conta, fica só
            um nome na lista — uma criança, por exemplo, ou quem não quer usar o app.
          </p>

          {/* O codigo do convite so chega aqui para o proprietario: o snapshot o
              recorta na consulta (`codigo_convite` em getSnapshot), nao na tela.
              Esta aba ja e `posso('proprietario')`, entao os dois cortes batem. */}
          {Boolean(snapshot.viagem?.codigo_convite) && (
            <div className="mb-3 rounded-xl bg-(--color-superficie-2) px-3 py-2.5">
              <Rotulo>Código do convite</Rotulo>
              <p className="mt-1 font-mono text-base font-semibold tracking-wider select-all">
                {String(snapshot.viagem?.codigo_convite ?? '')}
              </p>
              <p className="mt-1.5 text-[12px] text-(--color-tinta-3)">
                Quem você adicionou acima precisa deste código para criar a conta e entrar na viagem
                — passe por mensagem, não por e-mail. Sem ele, saber o endereço de e-mail não basta
                para reivindicar uma vaga. Quem já tem conta não precisa: adicione o participante
                com o e-mail dela e o vínculo é feito aqui mesmo.
              </p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {snapshot.participantes.map((t) => (
              <CartaoParticipante
                key={String(t.id)}
                participante={t}
                euId={String(snapshot.eu.participanteId)}
                estado={snapshot.checklist_state}
                totalChecklist={snapshot.checklist.length}
              />
            ))}
          </div>
        </Cartao>

        <Cartao>
          <Rotulo>PDF de bolso</Rotulo>
          <p className="mt-1 text-sm text-(--color-tinta-2)">
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
          <p className="mt-1 text-sm text-(--color-tinta-2)">
            Baixa um JSON com a viagem inteira, no mesmo formato que a importação aceita.
          </p>
          <div className="mt-3">
            <Botao
              variante="secundario"
              onClick={() => (window.location.href = `/api/export?trip=${snapshot.viagem?.id}`)}
            >
              <Download size={16} /> Baixar JSON
            </Botao>
          </div>
        </Cartao>

        <Importar aoConcluir={recarregar} />
      </div>
    </>
  )
}

/**
 * Cartão de um viajante: quem é, que papel tem e como está a preparação dele.
 *
 * O progresso do checklist só aparece para quem tem conta — participante sem
 * conta (uma criança, alguém que não quer o app) nunca vai marcar nada, e uma
 * barra em 0% ao lado do nome dessa pessoa leria como atraso, não como ausência.
 */
function CartaoParticipante({
  participante: t,
  euId,
  estado,
  totalChecklist,
}: {
  participante: Record<string, unknown>
  euId: string
  estado: Record<string, unknown>[]
  totalChecklist: number
}) {
  const id = String(t.id)
  const souEu = id === euId
  const temConta = Boolean(t.user_id)
  const feitos = estado.filter((e) => String(e.traveler_id) === id && e.feito).length
  const faltam = Math.max(0, totalChecklist - feitos)

  return (
    <div className="quebra-evitar rounded-2xl border border-(--color-borda) bg-(--color-cartao) p-3.5">
      <div className="flex items-start gap-3">
        <Avatar nome={String(t.nome)} url={t.avatar_url as string | null} tamanho={38} />
        <div className="min-w-0 flex-1">
          <p className="t-cartao truncate">
            {String(t.nome)}
            {souEu && <span className="ml-1.5 text-[12px] text-(--color-tinta-3)">(você)</span>}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge
              tipo={t.papel === 'proprietario' ? 'voo' : 'neutro'}
              texto={NOME_PAPEL[String(t.papel)] ?? String(t.papel)}
            />
            {!temConta && <Badge tipo="neutro" texto="Sem conta" />}
          </div>
        </div>
        <AdminAcoes entidade="participante" registro={t} />
      </div>

      {temConta && totalChecklist > 0 && (
        <div className="mt-3 border-t border-(--color-borda) pt-2.5">
          <div className="mb-1.5 flex items-baseline justify-between text-[12px]">
            <span className="text-(--color-tinta-3)">Checklist</span>
            <span className="tab-num font-semibold">
              {faltam === 0
                ? 'tudo pronto'
                : `${faltam} ${faltam === 1 ? 'pendente' : 'pendentes'}`}
            </span>
          </div>
          <Progresso
            pct={Math.round((feitos / totalChecklist) * 100)}
            rotulo={`Checklist de ${String(t.nome)}`}
          />
        </div>
      )}

      {souEu && (
        <Link
          href="/perfil"
          className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium"
          style={{ color: 'var(--destaque)' }}
        >
          Ver meu perfil <ChevronRight size={14} />
        </Link>
      )}
    </div>
  )
}

function Importar({ aoConcluir }: { aoConcluir: () => Promise<void> }) {
  const router = useRouter()
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
      router.push(`/viagens/${d.id}`)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falhou.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Cartao>
      <Rotulo>Importar como nova viagem</Rotulo>
      <p className="mt-1 text-sm text-(--color-tinta-2)">
        Sobe um JSON no formato do app. Cria uma viagem nova na sua conta — esta aqui não é alterada
        nem arquivada.
      </p>

      <div className="mt-3">
        <label className="toque inline-flex cursor-pointer items-center gap-2 rounded-xl border border-(--color-borda) px-4 text-sm font-medium">
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
        <p className="mt-3 rounded-xl bg-(--color-alerta-bg) px-3 py-2 text-sm text-(--color-alerta-ink)">
          {erro}
        </p>
      )}

      {resumo && (
        <div className="mt-4 rounded-xl border border-(--color-borda) p-3">
          <div className="mb-2 flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-(--color-alerta-ink)" />
            <p className="text-sm">
              Vai criar <strong>{nomeViagem}</strong> como uma nova viagem e abrir nela. Esta viagem
              continua exatamente como está.
            </p>
          </div>
          <ul className="tab-num mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
            {Object.entries(resumo).map(([secao, n]) => (
              <li
                key={secao}
                className="flex justify-between border-b border-(--color-borda) py-0.5"
              >
                <span className="text-(--color-tinta-3) capitalize">{secao}</span>
                <span className={n === 0 ? 'text-(--color-tinta-3)' : 'font-semibold'}>{n}</span>
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
