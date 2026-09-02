'use client'

// O menu "⋮" de um cartão de viagem, com tudo que ele abre.
//
// É um modal, não um dropdown flutuante. Um dropdown precisaria de posicionamento,
// fechamento por clique fora, armadilha de foco e uma versão de bottom sheet para
// o celular — quatro problemas para exibir sete linhas. O modal do app já resolve
// os quatro, e no celular a lista grande é melhor de acertar com o dedo.
import { useState } from 'react'
import {
  MoreVertical,
  ExternalLink,
  Pencil,
  Copy,
  Users,
  Download,
  Archive,
  ArchiveRestore,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { AppModal, Botao, BotaoIcone, Campo, ConfirmarDialogo, useAviso } from './ui.tsx'
import { FormViagem } from './FormViagem.tsx'
import type { ViagemResumo } from './CartaoViagem.tsx'
import { papelAlcanca } from '@/config/navigation.ts'
import { parseData } from '@/lib/derive.ts'
import { esquecerViagem } from '@/lib/recentes.ts'

/** Blocos que a cópia pode trazer. O marcado por padrão é a estrutura da viagem;
 *  o que envolve dinheiro ou reserva confirmada começa desmarcado. */
const BLOCOS = [
  { id: 'roteiro', nome: 'Roteiro, voos, cruzeiro e cidades', padrao: true },
  { id: 'checklist', nome: 'Checklist', padrao: true },
  { id: 'documentos', nome: 'Documentos e contatos de emergência', padrao: true },
  { id: 'reservas', nome: 'Reservas', padrao: false },
  { id: 'financeiro', nome: 'Financeiro', padrao: false },
] as const

type Aberto = null | 'menu' | 'editar' | 'duplicar' | 'excluir'

export function AcoesViagem({
  viagem,
  aoMudar,
}: {
  viagem: ViagemResumo
  /** Chamado depois de qualquer alteração: a lista se recarrega do servidor. */
  aoMudar: () => void
}) {
  const avisar = useAviso()
  const [aberto, setAberto] = useState<Aberto>(null)
  const [ocupado, setOcupado] = useState(false)

  const dono = papelAlcanca(viagem.papel, 'proprietario')
  const editor = papelAlcanca(viagem.papel, 'editor')

  async function chamar(metodo: string, corpo: unknown, sucesso: string, url = '/api/viagens') {
    setOcupado(true)
    try {
      const r = await fetch(url, {
        method: metodo,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        avisar('erro', d.erro || 'Não consegui completar a ação.')
        return false
      }
      avisar('sucesso', sucesso)
      setAberto(null)
      aoMudar()
      return true
    } catch {
      avisar('erro', 'Sem conexão. Tente de novo quando a internet voltar.')
      return false
    } finally {
      setOcupado(false)
    }
  }

  return (
    <>
      <BotaoIcone
        tom="sobre-cor"
        rotulo={`Ações de ${viagem.nome}`}
        onClick={() => setAberto('menu')}
      >
        <MoreVertical size={16} />
      </BotaoIcone>

      {aberto === 'menu' && (
        <AppModal
          titulo={viagem.nome}
          descricao="O que você quer fazer?"
          tamanho="pequeno"
          aoFechar={() => setAberto(null)}
        >
          <div className="pb-1">
            <Acao icone={ExternalLink} href={`/viagens/${viagem.id}`}>
              Abrir viagem
            </Acao>
            {editor && (
              <Acao icone={Pencil} onClick={() => setAberto('editar')}>
                Editar viagem
              </Acao>
            )}
            {/* Mesmo limiar que /api/viagens/duplicar exige no servidor. A copia
                carrega orcamento, despesas e parcelas, e quem duplica vira dono
                dela -- oferecer isto a um visualizador era mostrar a porta de uma
                escalada. A barreira real esta na rota; isto so para de mentir. */}
            {editor && (
              <Acao icone={Copy} onClick={() => setAberto('duplicar')}>
                Duplicar viagem
              </Acao>
            )}
            {dono && (
              <Acao icone={Users} href={`/viagens/${viagem.id}?aba=dados`}>
                Gerenciar participantes
              </Acao>
            )}
            <Acao icone={Download} href={`/api/export?trip=${encodeURIComponent(viagem.id)}`}>
              Exportar dados
            </Acao>
            {dono && (
              <Acao
                icone={viagem.arquivada ? ArchiveRestore : Archive}
                onClick={() =>
                  void chamar(
                    'PATCH',
                    { id: viagem.id, arquivada: !viagem.arquivada },
                    viagem.arquivada ? 'Viagem reativada.' : 'Viagem arquivada.',
                  )
                }
              >
                {viagem.arquivada ? 'Reativar viagem' : 'Arquivar viagem'}
              </Acao>
            )}
            {dono && (
              <Acao icone={Trash2} perigo onClick={() => setAberto('excluir')}>
                Excluir viagem
              </Acao>
            )}
          </div>
        </AppModal>
      )}

      {aberto === 'editar' && (
        <FormViagem
          viagem={viagem}
          aoFechar={() => setAberto(null)}
          aoSalvar={() => {
            avisar('sucesso', 'Viagem atualizada.')
            setAberto(null)
            aoMudar()
          }}
        />
      )}

      {aberto === 'duplicar' && (
        <Duplicar
          viagem={viagem}
          ocupado={ocupado}
          aoFechar={() => setAberto(null)}
          aoConfirmar={(corpo) =>
            void chamar('POST', corpo, 'Viagem duplicada.', '/api/viagens/duplicar')
          }
        />
      )}

      {/* A confirmação diz O QUE some junto — não só "tem certeza?". */}
      {aberto === 'excluir' && (
        <ConfirmarDialogo
          titulo={`Excluir “${viagem.nome}”?`}
          descricao="O roteiro, as reservas, o checklist e as despesas desta viagem saem junto. Não dá para desfazer pelo app."
          rotuloConfirmar="Excluir viagem"
          carregando={ocupado}
          aoCancelar={() => setAberto(null)}
          aoConfirmar={() => {
            void chamar('DELETE', { id: viagem.id }, 'Viagem excluída.').then((ok) => {
              if (ok) esquecerViagem(viagem.id)
            })
          }}
        />
      )}
    </>
  )
}

function Acao({
  icone: Icone,
  children,
  onClick,
  href,
  perigo,
}: {
  icone: LucideIcon
  children: React.ReactNode
  onClick?: () => void
  href?: string
  perigo?: boolean
}) {
  const classe = `toque flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors ${
    perigo
      ? 'text-(--color-perigo-ink) hover:bg-(--color-perigo-bg)'
      : 'text-(--color-tinta) hover:bg-(--color-superficie-2)'
  }`
  const conteudo = (
    <>
      <Icone size={17} strokeWidth={1.75} className="shrink-0 text-(--color-tinta-3)" />
      {children}
    </>
  )
  return href ? (
    <a href={href} className={classe}>
      {conteudo}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={classe}>
      {conteudo}
    </button>
  )
}

function Duplicar({
  viagem,
  ocupado,
  aoFechar,
  aoConfirmar,
}: {
  viagem: ViagemResumo
  ocupado: boolean
  aoFechar: () => void
  aoConfirmar: (corpo: Record<string, unknown>) => void
}) {
  const original = String(viagem.data_partida).slice(0, 10)
  const [nome, setNome] = useState(`${viagem.nome} (cópia)`)
  const [partida, setPartida] = useState(original)
  const [copiar, setCopiar] = useState<Record<string, boolean>>(
    Object.fromEntries(BLOCOS.map((b) => [b.id, b.padrao])),
  )

  // Deslocamento assinado em dias: a cópia inteira anda junto com a nova partida.
  // Precisa ser assinado, então não dá para usar `diasAte` (que nunca é negativa).
  const a = parseData(original)
  const b = parseData(partida)
  const dias = a && b ? Math.round((b.getTime() - a.getTime()) / 86_400_000) : 0

  return (
    <AppModal
      titulo="Duplicar viagem"
      descricao="A cópia é sua. Participantes, marcações do checklist e histórico não vêm junto."
      tamanho="medio"
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            carregando={ocupado}
            onClick={() => aoConfirmar({ id: viagem.id, nome: nome.trim(), dias, copiar })}
          >
            Duplicar viagem
          </Botao>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <Campo rotulo="Nome da cópia" valor={nome} aoMudar={setNome} obrigatorio />
        <Campo
          rotulo="Nova data de partida"
          dica={dias === 0 ? 'mesmas datas' : `desloca tudo em ${dias > 0 ? '+' : ''}${dias} dias`}
          tipo="date"
          valor={partida}
          aoMudar={setPartida}
        />

        <fieldset>
          <legend className="t-legenda mb-2">O que deseja copiar?</legend>
          <div className="space-y-0.5">
            {BLOCOS.map((bloco) => (
              <label
                key={bloco.id}
                className="toque flex cursor-pointer items-center gap-3 rounded-xl px-2 text-sm hover:bg-(--color-superficie-2)"
              >
                <input
                  type="checkbox"
                  checked={copiar[bloco.id] ?? false}
                  onChange={(e) => setCopiar((c) => ({ ...c, [bloco.id]: e.target.checked }))}
                  style={{ accentColor: 'var(--destaque)' }}
                  className="h-4 w-4 shrink-0 cursor-pointer"
                />
                {bloco.nome}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </AppModal>
  )
}
