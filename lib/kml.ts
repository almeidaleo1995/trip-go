// O KML que o Google My Maps exporta, virando coordenada nas paradas do roteiro.
//
// Existe porque a coordenada é o dado que ninguém digita: quem monta a viagem
// já alfineta os lugares num mapa do Google, e sem uma ponte esse trabalho tem
// de ser refeito à mão, um par de números por parada, para o mapa do dia sair
// do lugar.
//
// A leitura do XML é do navegador (`DOMParser`) — arquivo torto falha alto e na
// hora. O que erra em silêncio é o CASAMENTO: "Puerta del Sol" contra "Réveillon
// na Puerta del Sol" é um acerto, contra "Volta a pé para o hotel" não é, e um
// limiar mal posto grava a coordenada errada numa parada certa. Essa parte mora
// aqui, pura e testada sem navegador — e ainda assim passa pela conferência de
// quem importa, porque nenhuma heurística de nome merece confiança cega.

export type PontoKml = { nome: string; lat: number; lon: number }

/** Sem acento, sem pontuação, minúsculo: "Puerta del Sol" e "puerta-del-sol"
    são o mesmo lugar. */
export function normalizar(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Palavras que aparecem em tudo e não distinguem um lugar de outro. Ficam de
    fora dos dois lados da comparação, nunca de um só. */
const VAZIAS = new Set(
  'de da do das dos e a o as os na no em para com the of la el les del di du der die das'.split(
    ' ',
  ),
)

function palavras(t: string): string[] {
  return normalizar(t)
    .split(' ')
    .filter((p) => p.length > 2 && !VAZIAS.has(p))
}

/**
 * Quanto o nome do ponto do KML parece com o texto de uma parada, de 0 a 1.
 *
 * Três degraus, do mais seguro ao mais frouxo: nome igual, nome contido no
 * texto (o caso comum — o roteiro descreve, o mapa nomeia), e palavras em
 * comum. O último nunca passa de 0.8 para não empatar com uma contenção real.
 */
export function pontuar(nome: string, texto: string): number {
  const a = normalizar(nome)
  const b = normalizar(texto)
  if (!a || !b) return 0
  if (a === b) return 1
  if (b.includes(a) || a.includes(b)) return 0.9
  const doPonto = palavras(nome)
  if (doPonto.length === 0) return 0
  const daParada = new Set(palavras(texto))
  return (doPonto.filter((p) => daParada.has(p)).length / doPonto.length) * 0.8
}

/** Abaixo disto o palpite vira chute: sobra para a pessoa escolher na mão. */
export const LIMIAR = 0.5

/**
 * Palpite de qual parada cada ponto do KML descreve — `null` quando nenhuma
 * chega ao limiar.
 *
 * Ganancioso pela melhor pontuação, e cada parada só recebe um ponto: dois
 * pontos disputando a mesma parada com o casamento por id gravariam um por cima
 * do outro, e o número que sobrasse seria o do sorteio.
 *
 * Empate de pontuação vai para a parada que AINDA NÃO tem local: importar KML é
 * preencher buraco, e "Puerta del Sol" casa igualmente bem com as duas paradas
 * que passam por lá — só uma delas está faltando no mapa.
 */
export function casarPontos<T extends { id: string; texto: string; temLocal?: boolean }>(
  pontos: PontoKml[],
  paradas: T[],
): (string | null)[] {
  const pares: { p: number; i: number; s: number }[] = []
  pontos.forEach((ponto, p) =>
    paradas.forEach((parada, i) => {
      const s = pontuar(ponto.nome, parada.texto)
      if (s >= LIMIAR) pares.push({ p, i, s })
    }),
  )
  // Depois do buraco a preencher, empate resolvido pela ordem do arquivo e do
  // roteiro — nunca pela do motor de ordenação, que varia entre navegadores e
  // faria a mesma importação dar resultados diferentes em dois aparelhos.
  const jaTem = (i: number) => (paradas[i].temLocal ? 1 : 0)
  pares.sort((x, y) => y.s - x.s || jaTem(x.i) - jaTem(y.i) || x.p - y.p || x.i - y.i)

  const escolha: (string | null)[] = pontos.map(() => null)
  const tomadas = new Set<number>()
  for (const { p, i } of pares) {
    if (escolha[p] || tomadas.has(i)) continue
    escolha[p] = paradas[i].id
    tomadas.add(i)
  }
  return escolha
}

/**
 * Os pontos de um KML. Só `Placemark` com `Point`: linha e polígono (as rotas
 * desenhadas no My Maps) também têm `<coordinates>`, e pegar o primeiro par
 * deles marcaria a ponta de um traço como se fosse um lugar.
 *
 * `getElementsByTagNameNS('*', …)` porque metade dos exportadores prefixa as
 * tags (`<kml:Placemark>`) e a outra metade não.
 */
export function lerKml(xml: string): PontoKml[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  if (doc.getElementsByTagName('parsererror').length > 0)
    throw new Error('Não consegui ler o arquivo como KML — confira se ele não foi cortado.')

  return [...doc.getElementsByTagNameNS('*', 'Placemark')].flatMap((marca) => {
    const coord =
      marca
        .getElementsByTagNameNS('*', 'Point')[0]
        ?.getElementsByTagNameNS('*', 'coordinates')[0]
        ?.textContent?.trim() ?? ''
    // KML é lon,lat,altitude — nessa ordem, ao contrário de todo o resto do app.
    const [lon, lat] = coord.split(',').map(Number)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return []
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return []
    return [
      {
        nome: marca.getElementsByTagNameNS('*', 'name')[0]?.textContent?.trim() ?? '',
        // 5 casas é o que a coluna guarda (~1 m). Arredondar aqui faz a pintura
        // otimista mostrar exatamente o número que o banco vai devolver.
        lat: Number(lat.toFixed(5)),
        lon: Number(lon.toFixed(5)),
      },
    ]
  })
}

// ---------------------------------------------------------------- kmz

/**
 * O `.kmz` é um zip com um `.kml` dentro — é o que o Google My Maps baixa por
 * padrão, e mandar a pessoa voltar lá para remarcar uma caixinha era transferir
 * para ela um trabalho de quarenta linhas.
 *
 * Zip lido na mão em vez de biblioteca: `DecompressionStream` (nativo) faz o
 * deflate, e o que sobra é aritmética de cabeçalho. O caminho é o correto, pelo
 * diretório central, não pelo chute de que o `.kml` é a primeira entrada.
 *
 * ponytail: sem zip64 e sem entrada cifrada. KMZ do My Maps tem um `.kml` e
 * alguns ícones — não chega perto dos 4 GB que fariam o zip64 aparecer.
 */
export async function extrairKmz(dados: ArrayBuffer): Promise<string> {
  const v = new DataView(dados)
  const u8 = new Uint8Array(dados)

  // O fim do diretório central mora nos últimos 22 bytes, ou mais atrás se o
  // arquivo tiver comentário — daí a varredura de trás para frente.
  let fim = -1
  for (let i = dados.byteLength - 22; i >= Math.max(0, dados.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      fim = i
      break
    }
  }
  if (fim < 0) throw new Error('Este .kmz não parece um arquivo zip válido.')

  const quantas = v.getUint16(fim + 10, true)
  let p = v.getUint32(fim + 16, true)

  for (let n = 0; n < quantas; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break
    const metodo = v.getUint16(p + 10, true)
    const comprimido = v.getUint32(p + 20, true)
    const nomeLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const comentLen = v.getUint16(p + 32, true)
    const inicioLocal = v.getUint32(p + 42, true)
    const nome = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nomeLen))

    if (nome.toLowerCase().endsWith('.kml')) {
      // O cabeçalho local repete nome e extra com tamanhos PRÓPRIOS: usar os do
      // diretório central aqui desalinha o começo dos dados em alguns zips.
      const dadosEm =
        inicioLocal + 30 + v.getUint16(inicioLocal + 26, true) + v.getUint16(inicioLocal + 28, true)
      const bruto = u8.subarray(dadosEm, dadosEm + comprimido)
      if (metodo === 0) return new TextDecoder().decode(bruto)
      if (metodo === 8)
        return await new Response(
          new Blob([bruto]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
        ).text()
      throw new Error(`O .kml dentro do .kmz usa uma compressão que não sei abrir (${metodo}).`)
    }
    p += 46 + nomeLen + extraLen + comentLen
  }
  throw new Error('Não achei nenhum .kml dentro deste .kmz.')
}

/** Os pontos de um arquivo de mapa, seja ele `.kml` ou `.kmz`. */
export async function lerArquivoDeMapa(arquivo: File): Promise<PontoKml[]> {
  const ehKmz =
    arquivo.name.toLowerCase().endsWith('.kmz') ||
    arquivo.type === 'application/vnd.google-earth.kmz'
  return lerKml(ehKmz ? await extrairKmz(await arquivo.arrayBuffer()) : await arquivo.text())
}
