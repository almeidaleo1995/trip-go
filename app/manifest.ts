// O manifest da instalação — e ele é CÓDIGO, não um JSON estático, por causa da
// regra do projeto: nenhuma string de marca vive fora de config/site.ts. Um
// `public/manifest.json` com "TripGo" escrito dentro faria o rebranding exigir
// dois lugares, e o segundo é sempre o que alguém esquece.
//
// Por que isto importa mais do que parece: sem manifest o app NÃO é instalável, e
// no iPhone isso não é uma firula de ícone. O Safari apaga os dados de sites que
// não recebem visita há 7 dias — e "dados" inclui o IndexedDB, onde mora a cópia
// offline da viagem inteira e os documentos do cofre. Site adicionado à Tela de
// Início é isento dessa regra. Sem isto, alguém prepara a viagem em novembro,
// embarca em março e abre no avião para encontrar o app vazio — exatamente o
// cenário que o app existe para evitar.
//
// Fica em `app/manifest.ts` (Metadata Route do Next) e é servido em /manifest.webmanifest.
import type { MetadataRoute } from 'next'
import { siteConfig } from '@/config/site.ts'
import { theme } from '@/config/theme.ts'

export const dynamic = 'force-static'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteConfig.nome,
    short_name: siteConfig.nome,
    description: siteConfig.descricao,

    // `standalone` tira a barra do navegador: a viagem abre como app, e é o que
    // faz o iOS tratar a instalação como app instalado.
    display: 'standalone',
    orientation: 'portrait',

    // Abre direto na lista de viagens, não na landing: quem instalou já decidiu.
    start_url: '/viagens',
    scope: '/',

    // `background_color` é a tela de abertura; `theme_color` é a barra de status.
    // Ambos saem de theme.ts pelo mesmo motivo que o nome sai de site.ts.
    background_color: theme.cores.fundo,
    theme_color: theme.cores.destaque,

    lang: 'pt-BR',
    categories: ['travel', 'productivity'],

    icons: [
      { src: '/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // O Android recorta o ícone na forma do sistema e come até 20% de cada
      // borda. O `maskable` tem o desenho encolhido para essa zona segura — sem
      // ele, o mapinha aparece com as pontas cortadas.
      {
        src: '/icone-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
