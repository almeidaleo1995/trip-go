// GET /api/export - baixa a viagem no MESMO formato que a importação aceita.
//
// Round-trip é requisito, não conveniência: exportar, zerar o banco e reimportar
// tem que reproduzir a viagem idêntica. Por isso a saída é montada a partir do
// snapshot e validada contra o próprio TripImportSchema antes de sair.
import { viagemPadrao, getSnapshot } from '@/lib/db.ts'
import { ErroHttp } from '@/lib/session.ts'
import { exigirUsuario, exigirViagem } from '@/lib/auth.ts'
import { SCHEMA_VERSION, validarImportacao } from '@/lib/schema.ts'
import { normalizarCategoria, tagsComCategoria } from '@/lib/cofre.ts'
import { rota } from '@/lib/api.ts'
import { parseData } from '@/lib/derive.ts'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const texto = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : String(v))
const numero = (v: unknown) => (v === null || v === undefined ? undefined : Number(v))

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Formata data/hora no formato do arquivo, a partir do que o driver devolver.
 *
 * O driver do Neon materializa colunas `date` e `timestamp` como objeto Date, e
 * `String(date)` vira "Mon Dec 30 2026 ..." - fatiar isso produzia "Mon Dec 3" e
 * o backup não restaurava. Para `timestamp without time zone` o Date é construído
 * na hora local, então ler pelos getters locais devolve exatamente a hora gravada,
 * sem deslocamento de fuso.
 */
function formatar(v: unknown, comHora: boolean): string | undefined {
  if (v === null || v === undefined || v === '') return undefined
  // Date vem do driver; string vem das colunas que a query já converte em texto.
  // `parseData` e não `new Date(...)`: o construtor lê "2027-01-02" como meia-noite
  // UTC, e o backup sairia com a véspera em qualquer fuso a oeste de Greenwich.
  const d = v instanceof Date ? v : parseData(String(v))
  if (!d || Number.isNaN(d.getTime())) return undefined
  const data = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return comHora ? `${data}T${pad(d.getHours())}:${pad(d.getMinutes())}` : data
}

const quando = (v: unknown) => formatar(v, true)
const dia = (v: unknown) => formatar(v, false)

export const GET = rota(async (req) => {
  const u = await exigirUsuario()
  const pedido = new URL(req.url).searchParams.get('trip')
  const tripId = pedido ?? (await viagemPadrao(u.id))?.id
  if (!tripId) throw new ErroHttp(404, 'Nenhuma viagem cadastrada ainda.')

  const acesso = await exigirViagem(u.id, tripId)
  const s = await getSnapshot(tripId, acesso.papel, acesso.participanteId)
  const v = s.viagem as Record<string, unknown>

  // Viajante comum exporta um arquivo SEM nenhum dado financeiro: o snapshot
  // dele nem traz as linhas, entao aqui o bloco simplesmente nao existe.
  const fin = s.financeiro.admin ? s.financeiro : null
  const catPorId = new Map((fin?.categorias ?? []).map((c) => [String(c.id), String(c.nome)]))
  // O item do roteiro aponta para reserva e documento por id; o arquivo não tem
  // ids, então sai o nome. Nome repetido religa no primeiro homônimo — e é o
  // mesmo compromisso que categoria e participante já fazem neste formato.
  const nomePorReserva = new Map(s.reservas.map((r) => [String(r.id), String(r.nome)]))
  const tituloPorDocumento = new Map(s.documentos.map((d) => [String(d.id), String(d.titulo)]))
  const nomePorParticipante = new Map(s.participantes.map((p) => [String(p.id), String(p.nome)]))
  const nomePorRequisito = new Map(
    (s.requisitos ?? []).map((r) => [String(r.id), String(r.nome)]),
  )
  const parcelasPorDespesa = new Map<string, Record<string, unknown>[]>()
  for (const p of fin?.parcelas ?? []) {
    const chave = String(p.expense_id)
    parcelasPorDespesa.set(chave, [...(parcelasPorDespesa.get(chave) ?? []), p])
  }

  // O reembolso aponta para a parcela por descrição + número, não por id: o id
  // é recriado na importação.
  const descPorDespesa = new Map(
    (fin?.despesas ?? []).map((c) => [String(c.id), String(c.descricao)]),
  )
  const porIdDeParcela = new Map(
    (fin?.parcelas ?? []).map((p) => [
      String(p.id),
      { descricao: descPorDespesa.get(String(p.expense_id)), numero: Number(p.numero) },
    ]),
  )

  const arquivo = {
    schemaVersion: SCHEMA_VERSION,
    viagem: {
      nome: String(v.nome),
      subtitulo: texto(v.subtitulo),
      data_partida: dia(v.data_partida)!,
      data_retorno: dia(v.data_retorno)!,
      moeda: String(v.moeda),
      fuso: texto(v.fuso),
      cor_destaque: String(v.cor_destaque),
      orcamento_centavos: numero(v.orcamento_centavos),
    },
    // A chave é `participantes`, igual à da importação. Enquanto ela se chamou
    // `viajantes` aqui, o zod descartava a seção inteira em silêncio e o backup
    // restaurava uma viagem sem ninguém dentro.
    // Senha nunca é exportada: o arquivo circula por e-mail e pen drive.
    participantes: s.participantes.map((t) => ({
      nome: String(t.nome),
      email: texto(t.email),
      papel: t.papel as 'proprietario' | 'editor' | 'visualizador',
      telefone: texto(t.telefone),
      passaporte: texto(t.passaporte),
      documento: texto(t.documento),
      nascimento: dia(t.nascimento),
      ordem: Number(t.ordem ?? 0),
    })),
    roteiro: s.roteiro.map((e) => ({
      ocorre_em: quando(e.ocorre_em)!,
      fim_em: quando(e.fim_em),
      cidade: texto(e.cidade),
      local: texto(e.local),
      endereco: texto(e.endereco),
      lat: numero(e.lat),
      lon: numero(e.lon),
      titulo: String(e.titulo),
      descricao: texto(e.descricao),
      tipo: e.tipo,
      ancora: Boolean(e.ancora),
      distancia_m: numero(e.distancia_m),
      duracao_min: numero(e.duracao_min),
      transporte: texto(e.transporte),
      como_chegar: texto(e.como_chegar),
      dicas: texto(e.dicas),
      links: texto(e.links),
      custo_centavos: numero(e.custo_centavos),
      reserva: texto(nomePorReserva.get(String(e.reserva_id))),
      documento: texto(tituloPorDocumento.get(String(e.documento_id))),
      nota: texto(e.nota),
      ordem: Number(e.ordem ?? 0),
      opcoes: ((e.opcoes ?? []) as Record<string, unknown>[]).map((o) => ({
        modo: o.modo,
        duracao_min: numero(o.duracao_min),
        distancia_m: numero(o.distancia_m),
        custo: texto(o.custo),
        detalhe: texto(o.detalhe),
        recomendado: Boolean(o.recomendado),
        ordem: Number(o.ordem ?? 0),
      })),
    })),
    dias: s.dias.map((d) => ({
      dia: dia(d.dia)!,
      titulo: texto(d.titulo),
      cidade: texto(d.cidade),
      pais: texto(d.pais),
      resumo: texto(d.resumo),
      ancora: Boolean(d.ancora),
      alertas: texto(d.alertas),
      antes_sair: texto(d.antes_sair),
      antes_dormir: texto(d.antes_dormir),
      links: texto(d.links),
      mapa_url: texto(d.mapa_url),
    })),
    voos: s.voos.map((f) => ({
      companhia: String(f.companhia),
      numero: texto(f.numero),
      origem_iata: texto(f.origem_iata),
      origem_cidade: texto(f.origem_cidade),
      destino_iata: texto(f.destino_iata),
      destino_cidade: texto(f.destino_cidade),
      parte_em: quando(f.parte_em),
      chega_em: quando(f.chega_em),
      duracao_min: numero(f.duracao_min),
      localizador: texto(f.localizador),
      nota: texto(f.nota),
      ordem: Number(f.ordem ?? 0),
      escalas: ((f.escalas ?? []) as Record<string, unknown>[]).map((es) => ({
        iata: texto(es.iata),
        cidade: texto(es.cidade),
        espera_min: numero(es.espera_min),
        ordem: Number(es.ordem ?? 0),
      })),
    })),
    cruzeiros: s.cruzeiros.map((c) => ({
      navio: String(c.navio),
      companhia: texto(c.companhia),
      embarque_em: quando(c.embarque_em),
      desembarque_em: quando(c.desembarque_em),
      porto_embarque: texto(c.porto_embarque),
      porto_desembarque: texto(c.porto_desembarque),
      cabine: texto(c.cabine),
      localizador: texto(c.localizador),
      terminal: texto(c.terminal),
      nota: texto(c.nota),
      portos: ((c.portos ?? []) as Record<string, unknown>[]).map((p) => ({
        porto: texto(p.porto),
        cidade: texto(p.cidade),
        pais: texto(p.pais),
        chega_em: quando(p.chega_em),
        sai_em: quando(p.sai_em),
        dia_no_mar: Boolean(p.dia_no_mar),
        ordem: Number(p.ordem ?? 0),
        nota: texto(p.nota),
      })),
    })),
    // Idem: era `hospedagens`, com o formato antigo de check-in/check-out, e o
    // resto das reservas (restaurante, passeio, carro) não saía no backup.
    reservas: s.reservas.map((r) => ({
      tipo: r.tipo as
        'hospedagem' | 'restaurante' | 'passeio' | 'ingresso' | 'carro' | 'transporte' | 'outro',
      nome: String(r.nome),
      cidade: texto(r.cidade),
      inicio_em: quando(r.inicio_em),
      fim_em: quando(r.fim_em),
      endereco: texto(r.endereco),
      link: texto(r.link),
      telefone: texto(r.telefone),
      localizador: texto(r.localizador),
      valor_centavos: numero(r.valor_centavos),
      nota: texto(r.nota),
      ordem: Number(r.ordem ?? 0),
    })),
    lugares: s.lugares.map((l) => ({
      cidade: String(l.cidade),
      pais: texto(l.pais),
      dias: numero(l.dias),
      notas: texto(l.notas),
      lat: numero(l.lat),
      lon: numero(l.lon),
      ordem: Number(l.ordem ?? 0),
    })),
    // itinerary_event_id/flight_id/cruise_id NAO saem: mesmo caso de reserva_id/
    // documento_id no roteiro (README) — o id nao sobrevive a importar como
    // viagem nova, e a viagem nova ainda nao tem os registros pra reencontrar por
    // nome. O vinculo se refaz pela tela ou por uma nova sugestao da skill.
    checklist: s.checklist.map((c) => ({
      titulo: String(c.titulo),
      categoria: texto(c.categoria),
      escopo: c.escopo as 'global' | 'pessoal',
      prazo_ideal: dia(c.prazo_ideal),
      prazo_maximo: dia(c.prazo_maximo),
      valor_estimado_centavos: numero(c.valor_estimado_centavos),
      detalhe: texto(c.detalhe),
      ordem: Number(c.ordem ?? 0),
      assigned_to_nomes: (c.assigned_to as string[] | null)
        ?.map((id) => nomePorParticipante.get(id))
        .filter((nome): nome is string => Boolean(nome)),
      prioridade: c.prioridade,
      pais: texto(c.pais),
      cidade: texto(c.cidade),
      pendente: Boolean(c.pendente),
      fonte_tipo: c.fonte_tipo ?? undefined,
      fonte_detalhe: texto(c.fonte_detalhe),
      fonte_consultado_em: dia(c.fonte_consultado_em),
    })),
    // O CONTEUDO do arquivo nao sai aqui, so o cartao de identificacao dele. Um
    // backup com trinta PDFs em base64 deixaria de ser um arquivo que alguem abre
    // e leria — os bytes ficam em `document_files` e saem por /api/documento.
    documentos: s.documentos.map((d) => ({
      titulo: String(d.titulo),
      valor: texto(d.valor),
      tipo: d.tipo as 'texto' | 'link' | 'telefone' | 'arquivo',
      // Normalizada, nao crua: a coluna foi texto livre, e uma categoria antiga
      // ("Companhias aereas") passa na constraint `not valid` do banco mas nao no
      // enum de `DocumentoSchema` — o backup falharia na propria trava de
      // round-trip logo abaixo, com 500, so em viagem que ja estava em uso. A
      // palavra vai junto em `tags`, entao nada se perde.
      categoria: normalizarCategoria(d.categoria as string | null) ?? undefined,
      arquivo_url: texto(d.arquivo_url),
      arquivo_nome: texto(d.arquivo_nome),
      arquivo_mime: texto(d.arquivo_mime),
      arquivo_bytes: numero(d.arquivo_bytes),
      obs: texto(d.obs),
      ordem: Number(d.ordem ?? 0),
      escopo: d.escopo as 'global' | 'pessoal',
      // Dono e compartilhamento saem por NOME. Sem isto, restaurar um backup
      // tornaria publico todo documento pessoal.
      dono_nome: texto(nomePorParticipante.get(String(d.traveler_id))),
      assigned_to_nomes: (d.assigned_to as string[] | null)
        ?.map((id) => nomePorParticipante.get(id))
        .filter((nome): nome is string => Boolean(nome)),
      tags: tagsComCategoria(d.tags as string[] | null, d.categoria as string | null),
      importante: Boolean(d.importante),
      offline: Boolean(d.offline),
      validade: dia(d.validade),
      pais: texto(d.pais),
      cidade: texto(d.cidade),
      dia: dia(d.dia),
      reserva: texto(nomePorReserva.get(String(d.reservation_id))),
    })),
    // A documentacao EXIGIDA. Sem ela, restaurar um backup traz os arquivos de
    // volta e perde a pergunta que os organiza: quem ainda deve o que. Os
    // requisitos saem antes das entregas porque elas apontam para eles por nome.
    requisitos: (s.requisitos ?? []).map((r) => ({
      nome: String(r.nome),
      descricao: texto(r.descricao),
      categoria: r.categoria as string | undefined,
      obrigatorio: r.obrigatorio !== false,
      aplica_todos: r.aplica_todos !== false,
      // Vazio no arquivo: quem se aplica a quem sai por NOME logo abaixo, porque
      // id de participante nao sobrevive a exportar de uma viagem e importar noutra.
      assigned_to: [],
      assigned_to_nomes: (r.assigned_to as string[] | null)
        ?.map((id) => nomePorParticipante.get(id))
        .filter((nome): nome is string => Boolean(nome)),
      exige_numero: Boolean(r.exige_numero),
      exige_validade: Boolean(r.exige_validade),
      exige_arquivo: Boolean(r.exige_arquivo),
      campo_perfil: r.campo_perfil as string | undefined,
      prazo: dia(r.prazo),
      obs: texto(r.obs),
      ordem: Number(r.ordem ?? 0),
    })),
    // A ENTREGA sai sem `documento_id`: o arquivo e reapontado na importacao pelo
    // titulo do documento, como todo vinculo deste arquivo. O `numero` sai porque
    // ele E o dado documental — este backup so e gerado por quem ja o enxerga
    // (`documentacaoDaViagem` redige o de terceiros antes de chegar aqui).
    entregas: (s.entregas ?? []).map((e) => ({
      requirement_id: '',
      traveler_id: '',
      requisito_nome: texto(nomePorRequisito.get(String(e.requirement_id))),
      dono_nome: texto(nomePorParticipante.get(String(e.traveler_id))),
      numero: texto(e.numero),
      validade: dia(e.validade),
      emitido_em: dia(e.emitido_em),
      status: (e.status ?? 'enviado') as
        | 'pendente'
        | 'enviado'
        | 'aprovado'
        | 'rejeitado'
        | 'correcao',
      comentario: texto(e.comentario),
    })),
    emergencia: s.emergencia.map((e) => ({
      titulo: String(e.titulo),
      telefone: texto(e.telefone),
      detalhe: texto(e.detalhe),
      ordem: Number(e.ordem ?? 0),
    })),
    categorias: (fin?.categorias ?? []).map((c) => ({
      nome: String(c.nome),
      ordem: Number(c.ordem ?? 0),
    })),
    // Pessoas e categorias saem por NOME: ids nao sobrevivem a exportar de uma
    // viagem e importar noutra.
    custos: (fin?.despesas ?? []).map((c) => ({
      categoria: c.categoria_id ? catPorId.get(String(c.categoria_id)) : undefined,
      descricao: String(c.descricao),
      valor_centavos: Number(c.valor_centavos),
      moeda: texto(c.moeda),
      ocorre_em: dia(c.ocorre_em),
      pagador: c.traveler_id ? nomePorParticipante.get(String(c.traveler_id)) : undefined,
      divisao: c.divisao as 'igual' | 'peso' | 'personalizado',
      estimado: Boolean(c.estimado),
      nota: texto(c.nota),
      ordem: Number(c.ordem ?? 0),
      divisoes: (fin?.divisoes ?? [])
        .filter((d) => d.expense_id === c.id)
        .map((d) => ({
          participante: nomePorParticipante.get(String(d.traveler_id)) ?? '',
          peso: Number(d.peso ?? 1),
          valor_centavos: Number(d.valor_centavos ?? 0),
        }))
        // Divisao de participante ja removido nao tem nome para restaurar.
        .filter((d) => d.participante !== ''),
      parcelas: (parcelasPorDespesa.get(String(c.id)) ?? [])
        .map((p) => ({
          numero: Number(p.numero),
          vence_em: dia(p.vence_em),
          valor_centavos: Number(p.valor_centavos),
          pago_centavos: Number(p.pago_centavos ?? 0),
          pago_em: dia(p.pago_em),
        }))
        .sort((a, b) => a.numero - b.numero),
    })),
    pagamentos: (fin?.pagamentos ?? []).map((g) => {
      const parcela = g.parcela_id ? porIdDeParcela.get(String(g.parcela_id)) : undefined
      return {
        de: g.de_id ? nomePorParticipante.get(String(g.de_id)) : undefined,
        para: g.para_id ? nomePorParticipante.get(String(g.para_id)) : undefined,
        valor_centavos: Number(g.valor_centavos),
        ocorre_em: dia(g.ocorre_em),
        despesa: parcela?.descricao,
        parcela: parcela?.numero,
        referencia: texto(g.referencia),
        nota: texto(g.nota),
      }
    }),
  }

  // Trava de round-trip: se o que saiu não valida na entrada, é bug nosso, não do
  // usuário — melhor falhar aqui do que entregar um backup que não restaura.
  const check = validarImportacao(JSON.parse(JSON.stringify(arquivo)))
  if (!check.sucesso) throw new ErroHttp(500, `Exportação inconsistente: ${check.erro}`)

  const nome = `viagem-${String(v.nome)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`
  return new NextResponse(JSON.stringify(arquivo, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nome}"`,
      'Cache-Control': 'no-store',
    },
  })
})
