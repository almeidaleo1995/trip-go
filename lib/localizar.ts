// Achar a coordenada de um lugar pelo nome, no Nominatim — o serviço de busca do
// mesmo OpenStreetMap que já desenha os ladrilhos do mapa.
//
// Existe para o caso comum: ninguém tem um mapa do Google pronto para exportar,
// e "Puerta del Sol, Madri" é uma pergunta que alguém já sabe responder. Sem
// isto, a única entrada de coordenada no app é digitar dois números.
//
// Roda no cliente, como o clima: não é dado do servidor, não entra no snapshot
// e não existe em modo avião. Nunca lança — devolve lista vazia — porque quem
// chama só decide "mostra ou não mostra", nunca trata rede como conteúdo.
//
// ponytail: sem cache. Uma busca é um clique deliberado da pessoa, não algo que
// a tela refaz sozinha ao repintar; se um dia virar automático, o cache por
// consulta é o mesmo padrão de `lib/clima.ts`.

export type Achado = { nome: string; lat: number; lon: number }

/**
 * A política do Nominatim pede no máximo uma busca por segundo. A fila serializa
 * TUDO num app só — "localizar todas as paradas" dispara vinte buscas de uma
 * vez, e vinte chamadas paralelas é exatamente o que tira o serviço gratuito do
 * ar para todo mundo.
 */
const ESPERA = 1100
let fila: Promise<unknown> = Promise.resolve()

function enfileirar<T>(tarefa: () => Promise<T>): Promise<T> {
  const proxima = fila.then(tarefa)
  // A fila anda mesmo quando a tarefa falha; e só depois da espera, para a
  // seguinte não sair colada nesta.
  fila = proxima.catch(() => {}).then(() => new Promise((ok) => setTimeout(ok, ESPERA)))
  return proxima
}

/**
 * O texto de busca de uma parada, do mais específico ao mais genérico.
 *
 * `local` e `endereco` são campos de LUGAR — é o que se pergunta a um mapa. O
 * título é a última opção porque descreve o que acontece ("Volta a pé para o
 * hotel"), não onde: buscar isso devolve qualquer coisa, e é por isso que a
 * consulta fica editável na tela em vez de ser disparada em silêncio.
 *
 * A cidade entra sempre que já não estiver escrita no texto — "Barajas T4"
 * sozinho tem homônimo no mundo inteiro.
 */
export function consultaDaParada(parada: {
  local?: unknown
  endereco?: unknown
  titulo?: unknown
  cidade?: unknown
}): string {
  const texto = String(parada.endereco ?? '').trim() || String(parada.local ?? '').trim()
  const base = texto || String(parada.titulo ?? '').trim()
  const cidade = String(parada.cidade ?? '').trim()
  if (!base) return cidade
  if (!cidade || base.toLowerCase().includes(cidade.toLowerCase())) return base
  return `${base}, ${cidade}`
}

/** Diz se a consulta saiu de um campo de lugar (`local`/`endereco`) ou foi
    raspada do título — quem só tem título não entra na busca em massa. */
export function temCampoDeLugar(parada: { local?: unknown; endereco?: unknown }): boolean {
  return Boolean(String(parada.local ?? '').trim() || String(parada.endereco ?? '').trim())
}

/**
 * Até `limite` lugares que batem com o texto. Lista vazia em qualquer falha.
 *
 * `addressdetails=0` e `limit` pequeno de propósito: a tela mostra o nome que o
 * Nominatim já monta e mais nada — escolher entre cinco linhas é uma decisão,
 * escolher entre cinquenta é desistir.
 */
export async function buscarLugar(texto: string, limite = 5): Promise<Achado[]> {
  const consulta = texto.trim()
  if (consulta.length < 3) return []

  return enfileirar(async () => {
    try {
      const url =
        `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=0` +
        `&limit=${limite}&accept-language=pt-BR&q=${encodeURIComponent(consulta)}`
      const r = await fetch(url)
      if (!r.ok) return []
      const linhas = await r.json()
      if (!Array.isArray(linhas)) return []
      return linhas.flatMap((l: Record<string, unknown>) => {
        const lat = Number(l.lat)
        const lon = Number(l.lon)
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return []
        return [
          {
            nome: String(l.display_name ?? consulta),
            // 5 casas é o que a coluna guarda — o mesmo arredondamento do KML,
            // para a pintura otimista bater com o que o banco devolve.
            lat: Number(lat.toFixed(5)),
            lon: Number(lon.toFixed(5)),
          },
        ]
      })
    } catch {
      return []
    }
  })
}
