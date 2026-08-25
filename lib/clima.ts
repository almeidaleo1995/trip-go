// Clima ao vivo via Open-Meteo (sem chave, uso não-comercial). Roda no cliente
// — não é dado do servidor, então nunca aparece no snapshot nem no cache
// offline; sem rede, o painel simplesmente não tem nada para mostrar.

export type PrevisaoDia = {
  data: string
  tempMin: number
  tempMax: number
  codigo: number
}

const DESCRICAO_CODIGO: Record<number, string> = {
  0: 'Céu limpo',
  1: 'Poucas nuvens',
  2: 'Parcialmente nublado',
  3: 'Nublado',
  45: 'Neblina',
  48: 'Neblina com geada',
  51: 'Garoa fraca',
  53: 'Garoa',
  55: 'Garoa forte',
  61: 'Chuva fraca',
  63: 'Chuva',
  65: 'Chuva forte',
  71: 'Neve fraca',
  73: 'Neve',
  75: 'Neve forte',
  80: 'Pancadas de chuva',
  81: 'Pancadas de chuva',
  82: 'Pancadas fortes',
  95: 'Trovoada',
  96: 'Trovoada com granizo',
  99: 'Trovoada forte',
}

export function descricaoClima(codigo: number): string {
  return DESCRICAO_CODIGO[codigo] ?? 'Sem descrição'
}

export type ClimaAgora = { temp: number; codigo: number }

/**
 * Cache do tempo de agora por coordenada. A mesma cidade aparece em vários dias
 * da viagem, e passar de dia em dia não deveria refazer a mesma chamada.
 *
 * ponytail: em memória, morre no refresh. Se um dia precisar sobreviver ao
 * reload, é caso para o IndexedDB que o app já usa em `lib/offline.ts`.
 */
const AGORA = new Map<string, { em: number; valor: ClimaAgora }>()
const VALIDADE_AGORA = 10 * 60 * 1000

/**
 * O tempo NESTE MOMENTO numa coordenada — não a previsão para a data da viagem.
 *
 * São coisas diferentes e a distinção importa: a previsão só existe para os
 * próximos ~16 dias, então numa viagem marcada para daqui a meses ela não tem o
 * que dizer. "Agora" responde sempre, e é o que dá para saber hoje sobre como
 * costuma estar lá. Quem exibe precisa escrever "agora" na tela — senão vira um
 * número que parece falar da data da viagem e não fala.
 */
export async function buscarClimaAgora(lat: number, lon: number): Promise<ClimaAgora | null> {
  const chave = `${lat},${lon}`
  const guardado = AGORA.get(chave)
  if (guardado && Date.now() - guardado.em < VALIDADE_AGORA) return guardado.valor
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`
    const r = await fetch(url)
    if (!r.ok) return null
    const j = await r.json()
    const c = j?.current
    if (typeof c?.temperature_2m !== 'number') return null
    const valor = { temp: c.temperature_2m, codigo: Number(c.weather_code) }
    AGORA.set(chave, { em: Date.now(), valor })
    return valor
  } catch {
    return null
  }
}

/**
 * Previsão dos próximos dias. `null` em qualquer falha (rede, resposta
 * inesperada) — nunca lança, para o chamador só decidir "mostra ou não
 * mostra", nunca tratar erro de rede como conteúdo.
 */
export async function buscarClima(
  lat: number,
  lon: number,
  dias = 5,
): Promise<PrevisaoDia[] | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=${dias}`
    const r = await fetch(url)
    if (!r.ok) return null
    const j = await r.json()
    const d = j?.daily
    if (!Array.isArray(d?.time)) return null
    return d.time.map((data: string, i: number) => ({
      data,
      tempMin: Number(d.temperature_2m_min[i]),
      tempMax: Number(d.temperature_2m_max[i]),
      codigo: Number(d.weathercode[i]),
    }))
  } catch {
    return null
  }
}
