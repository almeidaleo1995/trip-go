// "Continue de onde parou": a trilha do que a pessoa abriu por último.
//
// Mora no localStorage de propósito. Isto é preferência de APARELHO, não dado da
// viagem: quem abriu o checklist no celular ontem quer o celular lembrando disso,
// e quer isso funcionando em modo avião — que é a regra que rege o resto do app.
// Nenhuma requisição, nenhuma coluna nova, nada que quebre offline.
//
// ponytail: teto conhecido — não segue a pessoa de aparelho em aparelho, e some
// se ela limpar o navegador. Se um dia precisar atravessar aparelhos, o passo é
// uma tabela `user_recents (user_id, trip_id, aba, visto_em)` alimentada pelo
// mesmo `registrarRecente`, com este cache continuando como leitura offline.

export type Recente = {
  viagemId: string
  /** Nome da viagem no momento da visita — evita depender de a viagem ainda existir. */
  viagem: string
  aba: string
  /** Rótulo da aba, já em pt-BR. */
  nome: string
  /** Epoch ms. */
  em: number
}

const CHAVE = 'tripgo:recentes'
const MAXIMO = 6

function ler(): Recente[] {
  try {
    const bruto = localStorage.getItem(CHAVE)
    if (!bruto) return []
    const lista = JSON.parse(bruto)
    if (!Array.isArray(lista)) return []
    // Filtra registro malformado em vez de deixar a tela quebrar num `.slice` de
    // undefined: o storage é do usuário, qualquer coisa pode estar lá dentro.
    return lista.filter(
      (r): r is Recente =>
        r &&
        typeof r.viagemId === 'string' &&
        typeof r.aba === 'string' &&
        typeof r.em === 'number',
    )
  } catch {
    return []
  }
}

function gravar(lista: Recente[]) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(lista.slice(0, MAXIMO)))
  } catch {
    /* storage cheio ou bloqueado: perder o histórico não pode derrubar a navegação */
  }
}

export function lerRecentes(): Recente[] {
  return ler().sort((a, b) => b.em - a.em)
}

/** Registra uma visita. A mesma aba da mesma viagem sobe, não duplica. */
export function registrarRecente(r: Omit<Recente, 'em'>) {
  if (!r.viagemId || !r.aba) return
  const resto = ler().filter((x) => !(x.viagemId === r.viagemId && x.aba === r.aba))
  gravar([{ ...r, em: Date.now() }, ...resto])
}

/** Apaga a trilha de uma viagem removida — link para viagem que não existe mais é lixo. */
export function esquecerViagem(viagemId: string) {
  gravar(ler().filter((x) => x.viagemId !== viagemId))
}
