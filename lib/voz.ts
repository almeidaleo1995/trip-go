// Ditado por voz, direto do navegador. Sem dependência nova — a Web Speech API
// já está em Chrome, Edge e Safari, e onde não está o botão simplesmente não
// aparece.
//
// Uma decisão de produto mora aqui: o texto reconhecido NUNCA é enviado sozinho.
// Ele volta para a caixa e espera a pessoa. Reconhecimento de fala erra, e
// "apaga o jantar" saindo de "paga o jantar" não pode virar uma proposta de
// remoção que a pessoa não leu.

type Reconhecimento = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}

type ComReconhecimento = {
  SpeechRecognition?: new () => Reconhecimento
  webkitSpeechRecognition?: new () => Reconhecimento
}

function construtor(): (new () => Reconhecimento) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as ComReconhecimento
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** true quando este navegador entende ditado. Decide se o botão existe. */
export function vozDisponivel(): boolean {
  return construtor() !== null
}

export type Ditado = { parar: () => void }

/**
 * Começa a ouvir. `aoTexto` recebe o que foi reconhecido — parcial enquanto
 * fala, final ao terminar. `aoFim` avisa que parou, por silêncio ou por erro.
 */
export function ouvir(
  aoTexto: (texto: string, final: boolean) => void,
  aoFim: () => void,
): Ditado | null {
  const Classe = construtor()
  if (!Classe) return null

  const r = new Classe()
  r.lang = 'pt-BR'
  r.continuous = false
  // Parcial ligado: sem isso a tela fica muda por vários segundos e a pessoa
  // não sabe se o microfone pegou.
  r.interimResults = true

  r.onresult = (e) => {
    let texto = ''
    for (let i = 0; i < e.results.length; i++) texto += e.results[i][0].transcript
    aoTexto(texto.trim(), false)
  }
  r.onerror = () => aoFim()
  r.onend = () => aoFim()

  try {
    r.start()
  } catch {
    return null
  }
  return { parar: () => r.stop() }
}
