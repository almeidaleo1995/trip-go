# Regras de deduplicação, prioridade e fonte

Estas regras já estão implementadas no app (`lib/checklist.ts`, `resolverSugestoes`)
— este arquivo documenta o que a skill deve saber para não gerar lotes que o
app vai descartar ou rejeitar, não reimplementa nada.

## Deduplicação de título

O app normaliza cada título (minúsculo, sem acento, espaços colapsados) e
compara contra:

1. Os títulos já existentes no checklist da viagem.
2. Os outros títulos do mesmo lote.

Uma sugestão cujo título normalizado já bate um desses dois é **descartada em
silêncio** (não vira erro, não vira item — some da contagem "prontas para
importar"). Antes de gerar o lote, a skill deve:

- Pedir ou já ter em mãos o checklist atual da viagem (export/snapshot).
- Evitar títulos quase-idênticos entre si dentro do próprio lote — "Conferir
  passaporte" e "Confira o passaporte" colidem depois de normalizado, mas
  "Conferir passaporte" e "Conferir visto" não.

Título específico bate melhor que título genérico: prefira "Conferir validade
do passaporte (mín. 6 meses)" a "Passaporte" — mais fácil de não colidir com
algo que já existe, e mais útil para quem lê.

## Prioridade

Enum fixo, sem valor livre: `obrigatorio`, `importante` (default),
`recomendado`, `opcional`.

- `obrigatorio` — sem isso a viagem não acontece (documento de entrada,
  passagem, requisito legal do destino).
- `importante` — default; risco real se esquecido, mas não impede a viagem.
- `recomendado` — melhora a experiência, não é crítico.
- `opcional` — "seria bom", nada mais.

Não force tudo para `obrigatorio` — um lote onde tudo é urgente não ajuda
ninguém a priorizar.

## Fonte é obrigatória, e `pesquisa` exige data

Toda sugestão carrega `fonte_tipo`. As três primeiras regras do
[SKILL.md](../SKILL.md) ("Não invente dado") valem aqui também:

- `documento` — veio de um arquivo que o usuário enviou. Não precisa de
  `fonte_detalhe`, mas ajuda citar o nome do arquivo/página.
- `pesquisa` — a skill procurou na internet. **Obrigatório** informar
  `fonte_detalhe` (nome/URL da fonte) e `fonte_consultado_em` (data da
  consulta, não a data do evento). Sem os dois, o app rejeita a sugestão
  inteira.
- `sugestao` — inferência da skill sem uma fonte específica apontável (ex.:
  "leve protetor solar" porque o destino é tropical em janeiro).
- `manual` — a skill está só registrando algo que o próprio usuário pediu por
  texto durante a conversa, não uma descoberta dela.

Nunca use `pesquisa` para uma informação que na verdade é só bom senso — isso
é `sugestao`. Inflar a fonte para parecer mais confiável é o oposto do que
esta skill existe para fazer.

## Dono obrigatório em item pessoal

`escopo: "pessoal"` sem nenhum nome em `assigned_to_nomes` é rejeitado pelo
app inteiro (constraint no banco, backstop além da validação da skill). Se a
sugestão é sobre algo pessoal mas não dá para saber de quem, use
`escopo: "global"` em vez de adivinhar um dono.

## Nunca autoaplica

Nenhuma sugestão desta skill vira item confirmado sozinha — toda entra como
pendente, revisada por um humano no app. A skill nunca decide por conta
própria mudar de versão, editar seu `SKILL.md`, ou re-executar contra a
mesma viagem sem pedido explícito.
