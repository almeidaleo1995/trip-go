# Sugestões de checklist para uma viagem existente

Diferente do fluxo principal deste skill (documentos → JSON de viagem nova),
este processo parte de uma viagem que **já existe** no app e devolve um lote
de sugestões de checklist para o admin revisar e importar pela tela.

## Quando usar

O usuário pede para a skill olhar os documentos (ou a viagem) e sugerir o que
falta preparar/levar/verificar — não para gerar a viagem inteira de novo.

## Processo

### 0. Perguntar primeiro

Vale o **passo 0 do `SKILL.md`** aqui também: antes de sugerir qualquer coisa,
pergunte quais cidades/lugares interessam de verdade, o que já está pago e
quem é quem. Sugestão de checklist para um passeio que a pessoa não vai fazer
é ruído que ela precisa rejeitar item a item.

### 1. Reunir o contexto da viagem

Peça (ou já tenha em mãos) um export recente da viagem (`Dados → Exportar` no
app) ou o snapshot equivalente. É dele que vêm os nomes exatos de
participantes, roteiro, voos e cruzeiro que o passo 4 usa para os vínculos —
sem isso, todo `assigned_to_nomes` vira erro na importação.

### 2. Ler os documentos

Mesmo processo do fluxo principal: extrair texto
(`.claude/skills/roteiro-trip-go/scripts/extrair.mjs`), ler tudo antes de
escrever, reconciliar conflitos entre documentos por data de revisão.

### 3. Identificar o que vira sugestão

Para cada coisa a fazer/levar/verificar que os documentos (ou o roteiro já
importado) revelam, decida:

- **Categoria** — ver [templates/categorias-e-fases.md](../templates/categorias-e-fases.md)
- **Escopo** — `pessoal` só quando dá para apontar de quem é; senão `global`
- **Prioridade** — ver [rules/dedup-e-prioridade.md](../rules/dedup-e-prioridade.md)
- **Prazo** (`prazo_ideal`/`prazo_maximo`) quando o documento ou o bom senso
  do destino/atividade indicar um
- **Fonte** — de onde veio isso, obrigatório em toda sugestão (ver regras)

Se precisar pesquisar informação que não está nos documentos (requisito de
entrada do destino, clima esperado, exigência de visto), pesquise na
internet, priorizando fonte oficial, e registre `fonte_tipo: "pesquisa"` com
`fonte_detalhe` e `fonte_consultado_em`. Nunca invente — sem fonte
confiável, não sugira.

### 4. Resolver nomes

`assigned_to_nomes`, `evento`, `voo`, `cruzeiro` vão por nome, nunca por id
— ver [mappings/campo-para-app.md](../mappings/campo-para-app.md) para o
formato exato de cada um e o que acontece quando o nome não bate.

### 5. Montar o lote

Formato completo: [schema/checklist-sugestoes.schema.json](../schema/checklist-sugestoes.schema.json).
Contrato executável (quem manda de verdade): `ChecklistSugestoesBatchSchema`
em `lib/schema.ts` na raiz do projeto.

```json
{
  "viagem": "Europa 2027",
  "gerado_em": "2026-08-24",
  "sugestoes": [
    {
      "titulo": "Conferir validade do passaporte (mín. 6 meses)",
      "categoria": "Documentos",
      "escopo": "global",
      "prioridade": "obrigatorio",
      "fonte_tipo": "sugestao"
    },
    {
      "titulo": "Levar protetor solar",
      "categoria": "Bagagem",
      "escopo": "pessoal",
      "assigned_to_nomes": ["Alana Martins"],
      "prioridade": "recomendado",
      "fonte_tipo": "sugestao"
    },
    {
      "titulo": "Confirmar exigências de entrada na Alemanha",
      "escopo": "global",
      "prioridade": "obrigatorio",
      "fonte_tipo": "pesquisa",
      "fonte_detalhe": "site oficial do governo alemão",
      "fonte_consultado_em": "2026-08-20"
    }
  ]
}
```

### 6. Validar — obrigatório antes de entregar

```bash
node --experimental-strip-types .claude/skills/roteiro-trip-go/validators/validar-sugestoes.mjs <arquivo.json>
```

Saída diferente de zero significa não entregar. Confira também os avisos
(item pessoal sem dono, título repetido no lote) — eles não travam a
validação, mas apontam o que a importação no app vai rejeitar ou descartar.

### 7. Relatório final

Igual ao fluxo principal: contagem por `fonte_tipo`, o que foi pesquisado
(com fonte e data), e o que não deu para confirmar.

## O que acontece depois

O app nunca confirma uma sugestão sozinho. O admin importa o lote pela tela
de Checklist, revisa cada sugestão (aceitar, editar, ou rejeitar), e só aí
ela vira um item de verdade — ver
[rules/dedup-e-prioridade.md](../rules/dedup-e-prioridade.md#nunca-autoaplica).
