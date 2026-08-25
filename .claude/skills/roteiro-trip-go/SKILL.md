---
name: roteiro-trip-go
description: Monta e atualiza a viagem do TripGo. Converte documentos de viagem (PDF, e-mail, print, texto solto) no arquivo JSON de importação deste app. Extrai roteiro, voos, cruzeiro, hospedagens, lugares, checklist com prazos, documentos, contatos de emergência e custos, valida contra o schema real do projeto e aponta contradições entre documentos em vez de escolher em silêncio. Também gera lotes de sugestão de checklist (ver reference/checklist-sugestoes.md e a árvore schema/rules/templates/mappings/validators) para viagens já existentes no app. Use quando o usuário mandar PDFs/vouchers/bilhetes de uma viagem e pedir para carregar no app, gerar o arquivo de importação, atualizar a viagem, sugerir itens de checklist, ou disser "converte esses documentos", "gera o JSON da viagem", "importa isso aí", "sugere checklist".
skillVersion: 1.2.0
schemaVersion: 3
---

# Roteiro TripGo — documentos e conversa → JSON de importação

Transforma o que o usuário já tem (caderno de viagem, lista de prazos, voucher, bilhete emitido) no arquivo que a tela **Dados → Importar** do app aceita — e, para uma viagem que já existe no app, num lote de sugestões de checklist (ver [reference/checklist-sugestoes.md](reference/checklist-sugestoes.md)).

O app nunca lê PDF. Esta conversão acontece aqui fora, com julgamento, e o resultado é um JSON validado contra o schema de verdade do projeto.

`schemaVersion` acima espelha `SCHEMA_VERSION` de `lib/schema.ts` no app — é assim que esta skill sabe se está desatualizada em relação ao contrato do app (ver `CHANGELOG.md` e a regra de nunca reescrever a si mesma, no fim deste arquivo).

## Regra que governa tudo

**Não invente dado.** Se o documento não diz o número da cabine, o campo fica ausente — não vai `"cabine": "a confirmar"` nem um valor plausível. Um app de viagem com dado inventado é pior que um app vazio, porque a pessoa confia nele no aeroporto.

Quando faltar algo importante, liste no relatório final sob **"Faltando nos documentos"**.

## Processo

### 0. Perguntar antes de montar — sempre

**Nunca entregue um JSON sem perguntar primeiro.** Mesmo com os documentos na
mão, o documento diz o que foi comprado, não o que a pessoa quer. Faça as
perguntas em **uma única mensagem**, numeradas, e espere a resposta:

1. **Cidades** — quais entram de verdade na viagem, e quantos dias em cada uma?
   Cidade citada num PDF não é cidade visitada (ver Armadilhas). Se o documento
   já resolve isso, confirme a lista em vez de perguntar aberto:
   *"Entendi Madri (2), Hamburgo (2), Bruges (bate-volta do navio) — falta ou
   sobra alguma?"*
2. **Lugares** — dentro de cada cidade, o que a pessoa quer ver/fazer? É o que
   vira `lugares[].notas` e itens de roteiro. Pergunte o interesse
   (museu, caminhada, comida, com criança, mobilidade reduzida), não uma lista
   pronta.
3. **Valores** — o que está pago, o que é cotação, e quem pagou cada coisa.
   Decide `estimado`, `pagador` e `divisoes[]`, que nenhum PDF traz.
4. **Quem vai** — os nomes exatos dos participantes, do jeito que já estão no
   app (a divisão de despesa e o `assigned_to_nomes` do checklist casam **por
   nome**; nome errado importa como despesa sem dono).

Se a pessoa responder "tanto faz, decide você", grave só o que o documento
sustenta e liste o resto em **"Faltando nos documentos"**. Não preencha o
silêncio com plausível.

### 1. Extrair o texto

```bash
node .claude/skills/roteiro-trip-go/scripts/extrair.mjs <arquivo.pdf> [...]
```

Escreve `.txt` ao lado de cada PDF e imprime o caminho. Detecta a ferramenta disponível (`pdftotext`, `pdftoppm`, `pypdf`) e diz o que fazer se não houver nenhuma.

**Sempre UTF-8 e sempre `-layout`.** Sem `-enc UTF-8` os acentos viram `�`. Sem `-layout` as tabelas perdem as colunas.

### 2. Ler o texto inteiro antes de escrever qualquer coisa

Leia o arquivo do começo ao fim. Não comece a montar o JSON a partir da primeira página — documentos de viagem contradizem a si mesmos, e a informação que corrige a página 3 costuma estar na página 12.

### 3. Reconciliar documentos e conflitos

Quando houver mais de um documento:

- **Data de revisão manda.** O documento mais novo vence o mais velho.
- **Palavra de decisão manda mais.** "Decidido", "Emitido", "Confirmado" vencem "recomendado", "opção", "ideal".
- **Conflito que muda o roteiro nunca é resolvido em silêncio.** Monte a tabela comparando as duas versões e **pergunte ao usuário** antes de gravar. Trocar em que cidade a pessoa passa o Réveillon não é detalhe de formatação.

### 4. Conferir o app antes de montar — sempre

O app muda; esta skill não muda sozinha. Antes de escrever o JSON, **leia
`lib/schema.ts` na raiz do projeto** e confira três coisas:

```bash
grep -n "SCHEMA_VERSION" lib/schema.ts        # bate com o schemaVersion do frontmatter?
grep -n "^export const .*Schema = z.object" lib/schema.ts
```

- `SCHEMA_VERSION` continua igual ao `schemaVersion` do frontmatter desta skill?
  Se subiu, a skill está desatualizada: monte o JSON pelo schema real (nunca
  pela documentação daqui) e **proponha a nova versão no relatório final**.
- As seções que você vai escrever ainda existem com esse nome
  (`participantes`, `reservas`, `custos`…)? Zod **descarta chave desconhecida
  em silêncio** — uma seção renomeada não dá erro, importa vazia.
- Os campos que você vai preencher ainda existem, e ainda significam a mesma
  coisa. `custos[].valor_centavos` já trocou de sentido uma vez (era por
  pessoa, hoje é o total).

**Para uma viagem que já existe no app**, olhe também o estado atual antes de
propor qualquer coisa: exporte por **Dados → Exportar** (ou peça o JSON ao
usuário) e compare. Item que já está lá vira atualização ou nada — não uma
segunda cópia. As regras de deduplicação estão em
[rules/dedup-e-prioridade.md](rules/dedup-e-prioridade.md).

### 5. Montar o JSON

Formato completo em [reference/formato.md](reference/formato.md). O contrato executável é `lib/schema.ts` na raiz do projeto — em qualquer divergência, **o schema vence a documentação**.

Mapeamentos que exigem atenção:

| No documento | No JSON |
| --- | --- |
| "LA719 FLN 10:30 → SCL 14:10" | um `voos[]` com `parte_em`, `chega_em`, IATAs e `duracao_min` calculada |
| "10h40 de espera em Santiago" | uma `escalas[]` dentro do voo, com `espera_min: 640` |
| "Dia no mar" | um `portos[]` do cruzeiro com `dia_no_mar: true` e sem `porto` |
| "até 30/09 / prazo máx. 31/10" | `prazo_ideal` e `prazo_maximo` no item de checklist |
| "≈ R$ 4.835 · 967 × 5" | `valor_centavos: 483500` (o **total**), `divisao: "igual"`, `estimado: true` |
| "R$ 28.241, emitido" | `valor_centavos: 2824100`, `estimado: false`, e uma `parcelas[]` com `pago_centavos: 2824100` |
| Cidade citada no roteiro | um `lugares[]` com `lat`/`lon` para entrar no mapa |

**Regras rígidas:**

- **Dinheiro em centavos inteiros.** `R$ 4.835,00` → `483500`. Nunca decimal.
- **`valor_centavos` é o TOTAL da despesa** (v3). Se o documento diz "967 × 5", grave `483500` e deixe o rateio para `divisao`/`divisoes[]`. O campo `pessoas` é v2 e só é lido para converter arquivo antigo — não escreva.
- **Pago é parcela, não booleano.** A vista é uma parcela única com `pago_centavos` igual a `valor_centavos`. `pago: true` é v2.
- **Horário é local do destino**, escrito `"2027-01-03T20:00"`. Nunca `Z`, nunca offset. É o que está no bilhete.
- **`ancora: true`** só no que não pode ser perdido: voo internacional, embarque no navio, saída de casa.
- **`estimado`** separa cotação de estimativa de planejamento. Documento que diz "EST." ou "≈" é `estimado: true`.
- **Nunca crie conta nem senha.** Participante é linha de nome+e-mail; cada pessoa se cadastra sozinha em `/register` com esse e-mail e o app vincula. Não existe mais PIN no schema.
- **Nomes de participante casam por nome exato** — em `custos[].divisoes[].participante`, `custos[].pagador` e `checklist[].assigned_to_nomes`. Confirme a grafia com o usuário (passo 0) antes de gravar.
- **Coordenadas**: só de cidade que você sabe onde fica. Cidade sem `lat`/`lon` continua aparecendo na aba Lugares, apenas não entra no mapa — isso é aceitável, chute não é.

### 6. Validar — obrigatório antes de entregar

```bash
node --experimental-strip-types .claude/skills/roteiro-trip-go/scripts/validar.mjs <arquivo.json>
```

Valida contra o `TripImportSchema` real e imprime a contagem por seção. **Saída diferente de zero significa não entregar.** O script aponta o campo exato (`voos[2].parte_em: ...`).

Confira também a contagem impressa contra o documento: se o caderno fala em 6 portos e o resumo mostra 4, faltou coisa.

### 7. Relatório final

Entregue junto com o arquivo:

- **Contagem por seção** (a saída do validador).
- **Conflitos encontrados** e como foram resolvidos.
- **Faltando nos documentos** — o que o app vai mostrar vazio e por quê.
- **Não verificado** — o que veio de estimativa e deve ser confirmado na fonte oficial.

## Armadilhas já pagas

- **`pdftotext -layout` intercala colunas de tabela.** Numa tabela de linha do tempo, a coluna de datas e a de descrições podem sair em blocos separados, e a associação data↔evento fica errada. Sempre confira alguns pares contra a lógica do texto corrido antes de gravar.
- **Rollover de data.** `2026-13-05` é aceito pelo construtor `Date` e vira janeiro de 2027. O schema rejeita, mas só se você não "corrigir" para uma data plausível antes. Se o documento tem data impossível, pergunte.
- **`Number(null)` é `0`.** Coordenada ausente vira ilha nula no golfo da Guiné. Omita o campo em vez de mandar `null` dentro de um objeto de coordenadas.
- **Cidade citada não é cidade visitada.** "Amsterdã fica a 40 min de trem" é uma sugestão de passeio, não uma parada da rota. Só entra em `lugares[]` o que a viagem realmente inclui.
- **Um cruzeiro não é uma hospedagem.** Vai em `cruzeiros[]`, com os portos em ordem.

## Sugestões de checklist para uma viagem que já existe

Formato completo, regras de deduplicação/prioridade e o mapeamento nome→campo estão em:

- [reference/checklist-sugestoes.md](reference/checklist-sugestoes.md) — o processo
- [schema/checklist-sugestoes.schema.json](schema/checklist-sugestoes.schema.json) — leitura humana do formato (a fonte real continua sendo `lib/schema.ts` no app)
- [rules/dedup-e-prioridade.md](rules/dedup-e-prioridade.md) — normalização de título, prioridade, fonte obrigatória
- [templates/categorias-e-fases.md](templates/categorias-e-fases.md) — categorias sugeridas e por que não existe campo `fase`
- [mappings/campo-para-app.md](mappings/campo-para-app.md) — `assigned_to_nomes`/`evento`/`voo`/`cruzeiro` por nome
- `validators/validar-sugestoes.mjs` — validação obrigatória antes de entregar um lote, igual ao passo 6 acima

## Versionamento — nunca reescreve a si mesma

Este `SKILL.md` declara `skillVersion`/`schemaVersion` no topo. Se o schema do app mudar de um jeito que quebra o contrato desta skill (campo renomeado, novo campo obrigatório, entidade removida), a skill **nunca edita este arquivo sozinha**. Ela propõe, em texto, no relatório final:

```
Nova versão sugerida: 1.2.0
Alterações: [o que mudou no schema do app e por quê isso afeta a skill]
```

Quem revisa decide se aplica. Cada versão aplicada ganha uma linha em [CHANGELOG.md](CHANGELOG.md).
