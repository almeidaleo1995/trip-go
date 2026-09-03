'use client'

// A casca das telas da CONTA — Início, Minhas viagens, Perfil.
//
// Cabeçalho de topo, o MESMO desenho do `Shell` de dentro de uma viagem: logo à
// esquerda, o fio de seções no meio, o avatar à direita, tudo num traço de 64px.
//
// Era uma barra lateral fixa de 256px, e essa diferença não descrevia nada. As
// duas cascas navegam a mesma conta, e entrar numa viagem parecia entrar em
// outro produto: o menu saltava da esquerda para o topo, o conteúdo pulava
// 256px para o lado e a medida da página mudava junto. A lateral também cobrava
// caro pelo que entregava — três links ocupando um quarto de um monitor de
// 1280, dos quais a grade de cartões precisava.
//
// Abaixo de 1024px o menu vira um painel que abre pelo botão, como já era.
import { useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { navegacao } from '@/config/navigation.ts'
import { LogOut, Menu, X, MapPinned } from 'lucide-react'
import { siteConfig } from '@/config/site.ts'

export function DashboardLayout({ children }: { children: ReactNode }) {
  const [menuAberto, setMenuAberto] = useState(false)
  const caminho = usePathname()

  async function sair() {
    await fetch('/api/sessao', { method: 'DELETE' })
    window.location.href = '/login'
  }

  return (
    <div className="min-h-dvh bg-(--color-fundo)">
      <header className="sticky top-0 z-40 border-b border-(--color-borda) bg-(--color-cartao)/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-4 lg:px-10">
          <Link href="/dashboard" className="flex shrink-0 items-center gap-3">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white"
              style={{ background: 'var(--destaque)' }}
              aria-hidden
            >
              <MapPinned size={17} strokeWidth={2} />
            </span>
            <span className="text-lg font-bold tracking-tight">{siteConfig.nome}</span>
          </Link>

          {/* O fio, centrado, some no celular — lá ele abre pelo botão. Três
              itens cabem em qualquer largura de desktop sem rolagem, então esta
              barra não tem `overflow`: navegação que exige rolar para ser vista
              não é navegação. */}
          <nav
            aria-label="Seções da conta"
            className="hidden min-w-0 flex-1 items-center justify-center gap-1 lg:flex"
          >
            {navegacao.map((item) => (
              <ItemTopo key={item.href} item={item} ativo={caminho === item.href} />
            ))}
          </nav>

          <div className="flex flex-1 items-center justify-end gap-1 lg:flex-none">
            <button
              onClick={sair}
              className="toque hidden cursor-pointer items-center gap-2 rounded-xl px-3 text-sm font-medium text-(--color-tinta-2) transition-colors hover:bg-(--color-superficie-2) lg:flex"
            >
              <LogOut size={17} strokeWidth={1.75} aria-hidden />
              Sair
            </button>

            <button
              onClick={() => setMenuAberto((a) => !a)}
              aria-label={menuAberto ? 'Fechar menu' : 'Abrir menu'}
              aria-expanded={menuAberto}
              className="toque flex cursor-pointer items-center justify-center rounded-xl text-(--color-tinta-2) transition-colors hover:bg-(--color-superficie-2) lg:hidden"
            >
              {menuAberto ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {menuAberto && (
          <nav
            aria-label="Seções da conta"
            className="border-t border-(--color-borda) px-3 py-3 lg:hidden"
          >
            <div className="mx-auto max-w-[1400px] space-y-1">
              {navegacao.map((item) => (
                <ItemPainel
                  key={item.href}
                  item={item}
                  ativo={caminho === item.href}
                  aoIr={() => setMenuAberto(false)}
                />
              ))}
              <button
                onClick={sair}
                className="toque mt-2 flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-sm text-(--color-tinta-2) transition-colors hover:bg-(--color-superficie-2)"
              >
                <span className="flex w-6 shrink-0 justify-center">
                  <LogOut size={18} aria-hidden />
                </span>
                Sair
              </button>
            </div>
          </nav>
        )}
      </header>

      {/* O conteúdo é centrado e tem teto — a mesma medida do cabeçalho, para o
          logo e a primeira coluna da página caírem no mesmo x. Quem define a
          medida de LEITURA é cada página; aqui fica só o limite de que nada
          cresce sem fim num monitor de 2560. */}
      <main className="mx-auto w-full max-w-[1400px] px-4 py-6 lg:px-10 lg:py-10">{children}</main>
    </div>
  )
}

/** Um item do fio do cabeçalho — ícone e rótulo lado a lado, num traço só. */
function ItemTopo({ item, ativo }: { item: (typeof navegacao)[number]; ativo: boolean }) {
  const Icone = item.icone
  return (
    <Link
      href={item.href}
      aria-current={ativo ? 'page' : undefined}
      className="toque relative flex shrink-0 items-center gap-2 rounded-xl px-3 text-sm transition-colors"
      style={{
        color: ativo ? 'var(--color-tinta)' : 'var(--color-tinta-2)',
        fontWeight: ativo ? 600 : 500,
      }}
    >
      <Icone size={17} strokeWidth={ativo ? 2.25 : 1.75} aria-hidden />
      {item.nome}
      {/* O mesmo traço de 2px que marca a aba ativa dentro de uma viagem. Cor
          E peso, nunca a cor sozinha: quem não distingue os dois cinzas continua
          lendo o negrito e vendo o traço. */}
      {ativo && (
        <span
          className="absolute inset-x-3 -bottom-px h-[2px] rounded-full"
          style={{ background: 'var(--destaque)' }}
          aria-hidden
        />
      )}
    </Link>
  )
}

/** O mesmo item no painel do celular: linha inteira, ícone numa coluna fixa. */
function ItemPainel({
  item,
  ativo,
  aoIr,
}: {
  item: (typeof navegacao)[number]
  ativo: boolean
  aoIr: () => void
}) {
  const Icone = item.icone
  return (
    <Link
      href={item.href}
      onClick={aoIr}
      aria-current={ativo ? 'page' : undefined}
      className="toque flex items-center gap-3 rounded-xl px-3 text-sm transition-colors"
      style={
        ativo
          ? { background: 'var(--destaque)', color: '#fff', fontWeight: 600 }
          : { color: 'var(--color-tinta-2)' }
      }
    >
      {/* Caixa de largura fixa: os glifos do Lucide não ocupam a mesma largura
          dentro do quadro, e sem ela o rótulo de cada linha começa alguns pixels
          adiante do de cima. */}
      <span className="flex w-6 shrink-0 justify-center">
        <Icone size={18} strokeWidth={ativo ? 2.25 : 1.75} aria-hidden />
      </span>
      {item.nome}
    </Link>
  )
}
