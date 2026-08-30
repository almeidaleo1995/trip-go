import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ProvedorAvisos } from '@/components/ui.tsx'
import { siteConfig } from '@/config/site.ts'

// next/font auto-hospeda a fonte no build: zero requisicao a fonts.googleapis.com
// em tempo de uso, que e requisito do modo offline.
const inter = Inter({ subsets: ['latin'], variable: '--fonte-inter', display: 'swap' })

export const metadata: Metadata = {
  title: siteConfig.nome,
  description: 'Roteiro, voos, hospedagem e checklist da viagem do grupo. Funciona offline.',
  // Sem isto o app não é INSTALÁVEL, e no iPhone isso custa os dados offline:
  // o Safari limpa o armazenamento (IndexedDB incluído) de site não visitado há
  // 7 dias, e só quem está na Tela de Início escapa da regra. Ver app/manifest.ts.
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: siteConfig.nome,
    // A barra de status fica translúcida sobre o teal do topo, em vez de uma
    // faixa branca colada acima do cabeçalho.
    statusBarStyle: 'black-translucent',
  },
}

export const viewport: Viewport = {
  themeColor: '#0F766E',
  width: 'device-width',
  initialScale: 1,
  // Nao trava o zoom: bloquear pinch-zoom quebra acessibilidade para quem
  // precisa aumentar o texto.
  maximumScale: 5,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable} suppressHydrationWarning>
      <body className="antialiased">
        {/* Fica na raiz para que qualquer tela consiga avisar sem montar o seu próprio. */}
        <ProvedorAvisos>{children}</ProvedorAvisos>
      </body>
    </html>
  )
}
