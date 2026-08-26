'use client'

// Perfil da conta: quem eu sou, minha senha, minhas preferências, minhas viagens.
//
// A página é do USUÁRIO, não de uma viagem — por isso ela mora fora de
// /viagens/:id e lê /api/perfil, não o snapshot. Um viajante que participa de
// quatro viagens tem um perfil só.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { KeyRound, Mail, Phone, Plus, Camera, IdCard } from 'lucide-react'
import { DashboardLayout } from '@/components/DashboardLayout.tsx'
import { CartaoViagem, type ViagemResumo } from '@/components/CartaoViagem.tsx'
import { formatarData } from '@/lib/derive.ts'
import {
  Avatar,
  Botao,
  Campo,
  Cartao,
  Carregando,
  Falha,
  Interruptor,
  Linha,
  Rotulo,
  Titulo,
  Vazio,
  AppModal,
  CLASSE_CAMPO,
  useAviso,
} from '@/components/ui.tsx'
import { MOEDAS } from '@/lib/schema.ts'

/** Os dados documentais da conta (§12). Todos opcionais: quem viaja dentro do
    país não precisa de passaporte, e um formulário que exige tudo não é
    preenchido por ninguém. */
export type DadosViagem = {
  nome_completo?: string | null
  nome_social?: string | null
  nascimento?: string | null
  cpf?: string | null
  rg?: string | null
  nacionalidade?: string | null
  passaporte_numero?: string | null
  passaporte_nome?: string | null
  passaporte_emissao?: string | null
  passaporte_validade?: string | null
  passaporte_pais?: string | null
  emergencia_nome?: string | null
  emergencia_telefone?: string | null
  emergencia_parentesco?: string | null
}

type Perfil = {
  id: string
  nome: string
  email: string
  avatar_url: string | null
  telefone: string | null
  moeda_preferida: string
  notificacoes: boolean
}

export default function PaginaPerfil() {
  const avisar = useAviso()
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [viagens, setViagens] = useState<ViagemResumo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [falhou, setFalhou] = useState(false)
  const [editando, setEditando] = useState(false)
  const [meusDocumentos, setMeusDocumentos] = useState<Record<string, unknown>[]>([])
  const [dadosViagem, setDadosViagem] = useState<DadosViagem>({})
  const [editandoViagem, setEditandoViagem] = useState(false)
  const [trocandoSenha, setTrocandoSenha] = useState(false)
  const [salvandoPref, setSalvandoPref] = useState(false)

  /** Busca perfil e viagens numa ida só. `vivo` evita gravar estado em uma
      tela que a pessoa já deixou — sair antes de a resposta chegar é comum. */
  function carregar(vivo = { atual: true }) {
    Promise.all([
      fetch('/api/perfil').then((r) => r.json()),
      fetch('/api/viagens').then((r) => r.json()),
    ])
      .then(([p, v]) => {
        if (!vivo.atual) return
        if (!p.usuario) throw new Error('sem usuario')
        setPerfil(p.usuario)
        setMeusDocumentos(p.documentos ?? [])
        setDadosViagem(p.viagem ?? {})
        setViagens(v.viagens ?? [])
        setFalhou(false)
      })
      .catch(() => {
        if (vivo.atual) setFalhou(true)
      })
      .finally(() => {
        if (vivo.atual) setCarregando(false)
      })
  }

  useEffect(() => {
    const vivo = { atual: true }
    carregar(vivo)
    return () => {
      vivo.atual = false
    }
  }, [])

  /** Salva o perfil inteiro. O interruptor de avisos usa isto direto: mudar um
      interruptor e depois ter que apertar "Salvar" é um passo que ninguém espera. */
  async function salvar(mudanca: Partial<Perfil>, mensagem: string) {
    if (!perfil) return false
    const corpo = { ...perfil, ...mudanca }
    const r = await fetch('/api/perfil', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nome: corpo.nome,
        avatar_url: corpo.avatar_url || null,
        telefone: corpo.telefone || null,
        moeda_preferida: corpo.moeda_preferida,
        notificacoes: corpo.notificacoes,
      }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) {
      avisar('erro', d.erro ?? 'Não foi possível salvar. Tente de novo.')
      return false
    }
    setPerfil(d.usuario)
    avisar('sucesso', mensagem)
    return true
  }

  if (carregando) return <Carregando texto="Carregando seu perfil…" />

  if (falhou || !perfil) {
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-3xl">
          <Falha
            texto="Não consegui carregar seu perfil."
            aoTentar={() => {
              setCarregando(true)
              carregar()
            }}
          />
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-3xl">
        <Titulo>Perfil</Titulo>

        {/* identidade */}
        <Cartao className="mb-5">
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
            <Avatar nome={perfil.nome} url={perfil.avatar_url} tamanho={72} />
            <div className="min-w-0 flex-1">
              <p className="t-secao truncate">{perfil.nome}</p>
              <p className="t-aux truncate">{perfil.email}</p>
            </div>
            <Botao variante="secundario" onClick={() => setEditando(true)}>
              Editar perfil
            </Botao>
          </div>
        </Cartao>

        {/* minhas informações */}
        <section className="mb-5">
          <Rotulo>Minhas informações</Rotulo>
          <Cartao className="mt-2.5">
            <div className="divide-y divide-(--color-borda)">
              <ItemInfo icone={Mail} rotulo="E-mail" valor={perfil.email} />
              <ItemInfo
                icone={Phone}
                rotulo="Telefone"
                valor={perfil.telefone || 'Não informado'}
                fraco={!perfil.telefone}
              />
            </div>
          </Cartao>
        </section>

        {/* segurança */}
        <section className="mb-5">
          <Rotulo>Segurança</Rotulo>
          <Cartao className="mt-2.5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--color-superficie-2) text-(--color-tinta-2)">
                  <KeyRound size={17} />
                </span>
                <div className="min-w-0">
                  <p className="t-corpo font-medium">Senha</p>
                  <p className="tab-num t-aux tracking-widest">••••••••</p>
                </div>
              </div>
              <Botao variante="secundario" onClick={() => setTrocandoSenha(true)}>
                Alterar senha
              </Botao>
            </div>
          </Cartao>
        </section>

        {/* Dados de viagem (§12). São da CONTA, não da viagem: o CPF é o mesmo em
            Europa 2027 e num bate-volta a Buenos Aires, e redigitá-lo a cada
            viagem é o trabalho que este bloco existe para eliminar.

            Só esta tela vê os VALORES. O snapshot de uma viagem carrega apenas
            quais campos estão preenchidos — uma bolinha verde no painel do
            administrador não justifica publicar o passaporte de cinco pessoas.
            Ver `documentacaoDaViagem` em lib/db.ts. */}
        <section className="mb-5">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <Rotulo>Dados de viagem</Rotulo>
            <Botao variante="fantasma" onClick={() => setEditandoViagem(true)}>
              {temDadosViagem(dadosViagem) ? 'Editar' : 'Preencher'}
            </Botao>
          </div>
          <Cartao>
            {!temDadosViagem(dadosViagem) ? (
              <div className="flex items-start gap-3">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: 'var(--color-destaque-fraco)', color: 'var(--destaque)' }}
                >
                  <IdCard size={18} />
                </span>
                <p className="t-aux">
                  Guarde aqui CPF, passaporte e contato de emergência. Toda viagem que exigir
                  esses dados vai encontrá-los prontos, e você não precisa digitá-los de novo.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-(--color-borda)">
                <Linha rotulo="Nome completo" valor={dadosViagem.nome_completo} />
                <Linha rotulo="Nome social" valor={dadosViagem.nome_social} />
                <Linha
                  rotulo="Nascimento"
                  valor={dadosViagem.nascimento ? formatarData(dadosViagem.nascimento) : ''}
                />
                <Linha rotulo="CPF" valor={mascararCpf(dadosViagem.cpf)} />
                <Linha rotulo="RG" valor={dadosViagem.rg} />
                <Linha rotulo="Nacionalidade" valor={dadosViagem.nacionalidade} />
                <Linha rotulo="Passaporte" valor={dadosViagem.passaporte_numero} />
                <Linha
                  rotulo="Passaporte vence em"
                  valor={
                    dadosViagem.passaporte_validade
                      ? formatarData(dadosViagem.passaporte_validade, {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })
                      : ''
                  }
                />
                <Linha rotulo="Emitido por" valor={dadosViagem.passaporte_pais} />
                <Linha rotulo="Contato de emergência" valor={dadosViagem.emergencia_nome} />
                <Linha rotulo="Telefone de emergência" valor={dadosViagem.emergencia_telefone} />
                <Linha rotulo="Parentesco" valor={dadosViagem.emergencia_parentesco} />
              </div>
            )}
          </Cartao>
        </section>

        {/* Meus documentos (§23). Só os PESSOAIS desta conta, de todas as
            viagens — o servidor recorta por `travelers.user_id`, e documento
            pessoal de outro participante nunca chega aqui. O arquivo em si abre
            no cofre da viagem, onde ele tem o contexto todo. */}
        {meusDocumentos.length > 0 && (
          <section className="mb-5">
            <Rotulo>Meus documentos</Rotulo>
            <Cartao className="mt-2.5">
              <ul className="divide-y divide-(--color-borda)">
                {meusDocumentos.map((d) => (
                  <li
                    key={String(d.id)}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{String(d.titulo)}</span>
                      <span className="block text-[13px] text-(--color-tinta-3)">
                        {String(d.viagem)}
                        {d.validade ? ` · vence em ${formatarData(String(d.validade))}` : ''}
                      </span>
                    </span>
                    <a
                      href={`/viagens/${String(d.trip_id)}?aba=documentos`}
                      className="toque shrink-0 text-[13px] font-medium"
                      style={{ color: 'var(--destaque)' }}
                    >
                      Abrir
                    </a>
                  </li>
                ))}
              </ul>
            </Cartao>
          </section>
        )}

        {/* preferências */}
        <section className="mb-5">
          <Rotulo>Preferências</Rotulo>
          <Cartao className="mt-2.5">
            <Interruptor
              rotulo="Avisos da viagem"
              descricao="Receber avisos quando alguém alterar algo em uma viagem sua."
              ligado={perfil.notificacoes}
              aoMudar={async (v) => {
                // Otimista: a bolinha vira na hora e volta se o servidor recusar.
                const antes = perfil.notificacoes
                setPerfil({ ...perfil, notificacoes: v })
                setSalvandoPref(true)
                const ok = await salvar(
                  { notificacoes: v },
                  v ? 'Avisos ativados.' : 'Avisos desativados.',
                )
                if (!ok) setPerfil((p) => (p ? { ...p, notificacoes: antes } : p))
                setSalvandoPref(false)
              }}
            />
            <div className="mt-1 border-t border-(--color-borda) pt-3">
              <label className="block">
                <span className="block text-[13px] font-medium text-(--color-tinta-2)">
                  Moeda preferida
                </span>
                <span className="t-aux mb-1.5 block text-[12px]">
                  Usada como padrão ao criar uma viagem nova.
                </span>
                <select
                  value={perfil.moeda_preferida}
                  disabled={salvandoPref}
                  onChange={(e) =>
                    void salvar({ moeda_preferida: e.target.value }, 'Preferência salva.')
                  }
                  className={`toque max-w-40 ${CLASSE_CAMPO}`}
                >
                  {MOEDAS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Cartao>
        </section>

        {/* minhas viagens */}
        <section>
          <div className="mb-2.5 flex items-center justify-between">
            <Rotulo>Minhas viagens</Rotulo>
            <Link
              href="/viagens"
              className="text-sm font-medium"
              style={{ color: 'var(--destaque)' }}
            >
              Gerenciar →
            </Link>
          </div>
          {viagens.length === 0 ? (
            <Vazio
              titulo="Nenhuma viagem ainda"
              texto="Crie a primeira e comece a montar o roteiro, o checklist e as reservas."
              acao={
                <Link href="/viagens">
                  <Botao>
                    <Plus size={16} /> Criar viagem
                  </Botao>
                </Link>
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {viagens.map((v) => (
                <CartaoViagem key={v.id} viagem={v} />
              ))}
            </div>
          )}
        </section>
      </div>

      {editando && (
        <FormularioPerfil
          perfil={perfil}
          aoFechar={() => setEditando(false)}
          aoSalvar={async (dados) => {
            const ok = await salvar(dados, 'Alterações salvas.')
            if (ok) setEditando(false)
            return ok
          }}
        />
      )}

      {trocandoSenha && <FormularioSenha aoFechar={() => setTrocandoSenha(false)} />}

      {editandoViagem && (
        <FormularioDadosViagem
          dados={dadosViagem}
          aoFechar={() => setEditandoViagem(false)}
          aoSalvo={(d) => {
            setDadosViagem(d)
            setEditandoViagem(false)
            avisar('sucesso', 'Dados de viagem salvos.')
          }}
        />
      )}
    </DashboardLayout>
  )
}

function ItemInfo({
  icone: Icone,
  rotulo,
  valor,
  fraco,
}: {
  icone: React.ElementType
  rotulo: string
  valor: string
  fraco?: boolean
}) {
  return (
    <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--color-superficie-2) text-(--color-tinta-2)">
        <Icone size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-(--color-tinta-3)">{rotulo}</p>
        <p className={`t-corpo truncate ${fraco ? 'text-(--color-tinta-3)' : 'font-medium'}`}>
          {valor}
        </p>
      </div>
    </div>
  )
}

function FormularioPerfil({
  perfil,
  aoSalvar,
  aoFechar,
}: {
  perfil: Perfil
  aoSalvar: (d: Partial<Perfil>) => Promise<boolean>
  aoFechar: () => void
}) {
  const [nome, setNome] = useState(perfil.nome)
  const [telefone, setTelefone] = useState(perfil.telefone ?? '')
  const [avatar, setAvatar] = useState(perfil.avatar_url ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function enviar() {
    if (!nome.trim()) return setErro('Escreva seu nome.')
    setErro(null)
    setSalvando(true)
    await aoSalvar({ nome: nome.trim(), telefone: telefone.trim(), avatar_url: avatar.trim() })
    setSalvando(false)
  }

  return (
    <AppModal
      titulo="Editar perfil"
      tamanho="medio"
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={enviar} carregando={salvando}>
            Salvar
          </Botao>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <div className="flex items-center gap-4">
          <Avatar nome={nome || perfil.nome} url={avatar || null} tamanho={56} />
          <p className="t-aux flex items-center gap-1.5">
            <Camera size={14} className="shrink-0" />A foto vem de um link. Sem link, aparecem as
            suas iniciais.
          </p>
        </div>

        <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio autoComplete="name" />
        <Campo
          rotulo="Telefone"
          valor={telefone}
          aoMudar={setTelefone}
          tipo="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+55 48 99999-0000"
        />
        <Campo
          rotulo="Link da foto"
          valor={avatar}
          aoMudar={setAvatar}
          tipo="url"
          placeholder="https://…"
        />

        {/* E-mail é a identidade da conta: mostrado, nunca editável aqui. */}
        <Linha rotulo="E-mail" valor={perfil.email} />

        {erro && (
          <p
            role="alert"
            className="rounded-xl bg-(--color-perigo-bg) px-3 py-2 text-sm text-(--color-perigo-ink)"
          >
            {erro}
          </p>
        )}
      </div>
    </AppModal>
  )
}

function FormularioSenha({ aoFechar }: { aoFechar: () => void }) {
  const avisar = useAviso()
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function enviar() {
    if (nova !== confirmacao) return setErro('As senhas novas não são iguais.')
    setErro(null)
    setSalvando(true)
    try {
      const r = await fetch('/api/perfil', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ atual, nova, confirmacao }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErro(d.erro ?? 'Não foi possível alterar a senha.')
        return
      }
      avisar('sucesso', 'Senha alterada com sucesso.')
      aoFechar()
    } catch {
      setErro('Sem conexão. Tente de novo quando a internet voltar.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <AppModal
      titulo="Alterar senha"
      descricao="Você continua conectado neste aparelho depois de trocar."
      tamanho="pequeno"
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={enviar} carregando={salvando}>
            Alterar senha
          </Botao>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <Campo
          rotulo="Senha atual"
          valor={atual}
          aoMudar={setAtual}
          tipo="password"
          autoComplete="current-password"
          obrigatorio
        />
        <Campo
          rotulo="Nova senha"
          valor={nova}
          aoMudar={setNova}
          tipo="password"
          autoComplete="new-password"
          dica="mínimo 6 caracteres"
          obrigatorio
        />
        <Campo
          rotulo="Confirmar nova senha"
          valor={confirmacao}
          aoMudar={setConfirmacao}
          tipo="password"
          autoComplete="new-password"
          erro={confirmacao && nova !== confirmacao ? 'As senhas não são iguais.' : null}
          obrigatorio
        />

        {erro && (
          <p
            role="alert"
            className="rounded-xl bg-(--color-perigo-bg) px-3 py-2 text-sm text-(--color-perigo-ink)"
          >
            {erro}
          </p>
        )}
      </div>
    </AppModal>
  )
}

// ---------------------------------------------------------------- dados de viagem

/** Algum campo preenchido? Decide entre a ficha e o convite a preencher. */
function temDadosViagem(d: DadosViagem): boolean {
  return Object.values(d).some((v) => Boolean(v && String(v).trim()))
}

/** CPF na tela com máscara; no banco ele é guardado só como dígitos. */
function mascararCpf(cpf?: string | null): string {
  const n = (cpf ?? '').replace(/\D/g, '')
  if (n.length !== 11) return cpf ?? ''
  return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}`
}

/**
 * O formulário dos dados documentais.
 *
 * Vai por POST, não pelo PATCH do perfil: são dois formulários diferentes, e um
 * endpoint que aceitasse os dois zeraria o passaporte de quem salvasse só o
 * apelido. Ver o comentário em /api/perfil.
 */
function FormularioDadosViagem({
  dados,
  aoFechar,
  aoSalvo,
}: {
  dados: DadosViagem
  aoFechar: () => void
  aoSalvo: (d: DadosViagem) => void
}) {
  const [d, setD] = useState<DadosViagem>(dados)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const set = (k: keyof DadosViagem, v: string) => setD((r) => ({ ...r, [k]: v }))
  const val = (k: keyof DadosViagem) => (d[k] ?? '') as string

  const salvar = async () => {
    setErro(null)
    setSalvando(true)
    try {
      const r = await fetch('/api/perfil', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(d),
      })
      const corpo = (await r.json().catch(() => null)) as {
        viagem?: DadosViagem
        erro?: string
      } | null
      if (!r.ok) throw new Error(corpo?.erro ?? 'Não foi possível salvar.')
      aoSalvo(corpo?.viagem ?? d)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <AppModal
      titulo="Dados de viagem"
      descricao="Ficam na sua conta e valem para todas as suas viagens. Ninguém mais vê os valores."
      tamanho="pequeno"
      aoFechar={aoFechar}
      acoes={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={() => void salvar()} carregando={salvando}>
            Salvar
          </Botao>
        </>
      }
    >
      <div className="space-y-3">
        {erro && <Falha texto={erro} />}

        <Campo rotulo="Nome completo" valor={val('nome_completo')} aoMudar={(v) => set('nome_completo', v)} />
        <Campo
          rotulo="Nome social ou apelido"
          valor={val('nome_social')}
          aoMudar={(v) => set('nome_social', v)}
        />
        <Campo
          rotulo="Data de nascimento"
          valor={val('nascimento')}
          aoMudar={(v) => set('nascimento', v)}
          tipo="date"
        />
        <Campo
          rotulo="CPF"
          valor={val('cpf')}
          aoMudar={(v) => set('cpf', v)}
          inputMode="numeric"
          dica="Só os números"
        />
        <Campo rotulo="RG" valor={val('rg')} aoMudar={(v) => set('rg', v)} />
        <Campo
          rotulo="Nacionalidade"
          valor={val('nacionalidade')}
          aoMudar={(v) => set('nacionalidade', v)}
        />

        <div className="rounded-xl border border-(--color-borda) p-3">
          <Rotulo>Passaporte</Rotulo>
          <div className="mt-2 space-y-3">
            <Campo
              rotulo="Número"
              valor={val('passaporte_numero')}
              aoMudar={(v) => set('passaporte_numero', v)}
            />
            <Campo
              rotulo="Nome como está no passaporte"
              valor={val('passaporte_nome')}
              aoMudar={(v) => set('passaporte_nome', v)}
            />
            <Campo
              rotulo="Emitido em"
              valor={val('passaporte_emissao')}
              aoMudar={(v) => set('passaporte_emissao', v)}
              tipo="date"
            />
            <Campo
              rotulo="Válido até"
              valor={val('passaporte_validade')}
              aoMudar={(v) => set('passaporte_validade', v)}
              tipo="date"
              dica="É esta data que avisa você antes de vencer"
            />
            <Campo
              rotulo="País emissor"
              valor={val('passaporte_pais')}
              aoMudar={(v) => set('passaporte_pais', v)}
            />
          </div>
        </div>

        <div className="rounded-xl border border-(--color-borda) p-3">
          <Rotulo>Contato de emergência</Rotulo>
          <div className="mt-2 space-y-3">
            <Campo
              rotulo="Nome"
              valor={val('emergencia_nome')}
              aoMudar={(v) => set('emergencia_nome', v)}
            />
            <Campo
              rotulo="Telefone"
              valor={val('emergencia_telefone')}
              aoMudar={(v) => set('emergencia_telefone', v)}
              tipo="tel"
              inputMode="tel"
            />
            <Campo
              rotulo="Parentesco"
              valor={val('emergencia_parentesco')}
              aoMudar={(v) => set('emergencia_parentesco', v)}
              dica="Mãe, cônjuge, amigo…"
            />
          </div>
        </div>
      </div>
    </AppModal>
  )
}
