// GET /api/export - baixa a viagem no MESMO formato que a importação aceita.
//
// Round-trip é requisito, não conveniência: exportar, zerar o banco e reimportar
// tem que reproduzir a viagem idêntica. Por isso a saída é montada a partir do
// snapshot e validada contra o próprio TripImportSchema antes de sair.
import { viagemAtiva, getSnapshot } from '@/lib/db.ts'
import { requireSession, ErroHttp } from '@/lib/session.ts'
import { SCHEMA_VERSION, validarImportacao } from '@/lib/schema.ts'
import { rota } from '@/lib/api.ts'
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
  const d = v instanceof Date ? v : new Date(String(v).replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return undefined
  const data = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return comHora ? `${data}T${pad(d.getHours())}:${pad(d.getMinutes())}` : data
}

const quando = (v: unknown) => formatar(v, true)
const dia = (v: unknown) => formatar(v, false)

export const GET = rota(async () => {
  const sessao = await requireSession()
  const viagem = await viagemAtiva()
  if (!viagem) throw new ErroHttp(404, 'Nenhuma viagem cadastrada ainda.')

  const s = await getSnapshot(viagem.id, sessao.papel)
  const v = s.viagem as Record<string, unknown>
  const catPorId = new Map(
    (s.financeiro?.categorias ?? []).map((c) => [String(c.id), String(c.nome)]),
  )

  const arquivo = {
    schemaVersion: SCHEMA_VERSION,
    viagem: {
      nome: String(v.nome),
      subtitulo: texto(v.subtitulo),
      data_partida: dia(v.data_partida)!,
      data_retorno: dia(v.data_retorno)!,
      moeda: String(v.moeda),
      cor_destaque: String(v.cor_destaque),
    },
    // PIN nunca é exportado: o arquivo circula por e-mail e pen drive.
    viajantes: s.viajantes.map((t) => ({
      nome: String(t.nome),
      papel: t.papel as 'admin' | 'viajante',
      telefone: texto(t.telefone),
      passaporte: texto(t.passaporte),
      ordem: Number(t.ordem ?? 0),
    })),
    roteiro: s.roteiro.map((e) => ({
      ocorre_em: quando(e.ocorre_em)!,
      cidade: texto(e.cidade),
      local: texto(e.local),
      titulo: String(e.titulo),
      descricao: texto(e.descricao),
      tipo: e.tipo,
      ancora: Boolean(e.ancora),
      nota: texto(e.nota),
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
    hospedagens: s.hospedagens.map((h) => ({
      nome: String(h.nome),
      cidade: texto(h.cidade),
      checkin: dia(h.checkin),
      checkout: dia(h.checkout),
      endereco: texto(h.endereco),
      link: texto(h.link),
      telefone: texto(h.telefone),
      nota: texto(h.nota),
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
    checklist: s.checklist.map((c) => ({
      titulo: String(c.titulo),
      categoria: texto(c.categoria),
      escopo: c.escopo as 'global' | 'pessoal',
      prazo_ideal: dia(c.prazo_ideal),
      prazo_maximo: dia(c.prazo_maximo),
      valor_estimado_centavos: numero(c.valor_estimado_centavos),
      detalhe: texto(c.detalhe),
      ordem: Number(c.ordem ?? 0),
    })),
    documentos: s.documentos.map((d) => ({
      titulo: String(d.titulo),
      valor: texto(d.valor),
      tipo: d.tipo as 'texto' | 'link' | 'telefone',
      obs: texto(d.obs),
      ordem: Number(d.ordem ?? 0),
    })),
    emergencia: s.emergencia.map((e) => ({
      titulo: String(e.titulo),
      telefone: texto(e.telefone),
      detalhe: texto(e.detalhe),
      ordem: Number(e.ordem ?? 0),
    })),
    // Viajante exporta arquivo SEM nenhum dado financeiro (BKP-04).
    categorias: (s.financeiro?.categorias ?? []).map((c) => ({
      nome: String(c.nome),
      ordem: Number(c.ordem ?? 0),
    })),
    custos: (s.financeiro?.custos ?? []).map((c) => ({
      categoria: c.categoria_id ? catPorId.get(String(c.categoria_id)) : undefined,
      descricao: String(c.descricao),
      valor_centavos: Number(c.valor_centavos),
      pessoas: Number(c.pessoas),
      pago: Boolean(c.pago),
      estimado: Boolean(c.estimado),
      nota: texto(c.nota),
      ordem: Number(c.ordem ?? 0),
    })),
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
