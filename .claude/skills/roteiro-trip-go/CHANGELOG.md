# Changelog — skill roteiro-trip-go (antes `viagem-para-json`)

Uma entrada por versão aplicada. Uma proposta de versão que ainda não foi
revisada/aplicada não entra aqui — ela vive só no relatório da skill até
alguém aceitar.

## 1.4.0 — 2026-08-29

O app ganhou a aba **Hoje** — o roteiro reduzido ao que serve andando na rua — e
ela é montada a partir de campos que a skill vinha deixando vazios com
frequência, porque nenhuma tela os usava de forma visível.

- **Seção nova "O roteiro alimenta a aba HOJE"** no SKILL.md: quais campos
  acendem o quê, e por que `duracao_min` no item de destino virou o campo mais
  valioso do roteiro (é o que calcula "saia às").
- **`reference/formato.md`**: `roteiro[]` passa a documentar `fim_em`,
  `endereco`, `lat`/`lon`, `distancia_m`, `duracao_min` e `transporte`;
  `reservas[]` documenta `endereco` e `telefone`; `viagem` ganha `fuso` (IANA).
  Todos já existiam em `lib/schema.ts` — o que faltava era a skill saber que
  eles importam.
- **Tabela "O que a aba HOJE consome"** no fim de `formato.md`, com as duas
  regras de extração: o deslocamento mora no item de DESTINO, e coordenada não
  se inventa.

## 1.3.0 — 2026-08-25

A skill entregava só um arquivo, e para viagem que já existe o arquivo é a
ferramenta errada. Descoberto montando o dia 31/12 da Europa 2027.

- **Passo 5 novo — arquivo ou escrita direta**: `/api/import` sempre cria
  viagem nova (`importarViagem` abre com `randomUUID()`), de propósito. Para
  viagem que já existe no app, o caminho é escrever nas tabelas pelo
  `trip_id`; para backup, é **Dados → Exportar**, sem replicar as 324 linhas
  de mapeamento de `/api/export`. Entregar arquivo no caso errado duplica a
  viagem pela metade. Renumera montar/validar/relatório para 6/7/8.
- **Passo 8 novo — PDF junto com o JSON**, sempre, via HTML próprio + Chrome
  headless. O produto existe para funcionar sem sinal, e JSON não se lê no
  aeroporto. Inclui a exigência de conferir por `--screenshot` antes de
  entregar, e a proibição de usar o `render_pdf.py` da skill `roteiro-viagem`
  (formato de dossiê inteiro — preenchê-lo para um dia seria inventar dado).
- **Passo 0 ganha a pergunta 5 — onde salvar.** Era a única decisão que a
  skill vinha tomando sozinha, e nenhum padrão é seguro: scratchpad some, raiz
  do repo entra no git. É também a única pergunta que não aceita "decide você".
- **Armadilha nova**: o driver do Neon materializa `timestamp` como `Date` e
  imprimir desloca o fuso — `17:30` aparece como `20:30Z`. Conferir o estado
  da viagem com `to_char`, senão a skill "corrige" um roteiro que estava certo.
- Passo 9 (relatório) passa a exigir o caminho dos arquivos e, quando houve
  escrita direta, o que foi inserido vs. atualizado — para dar como desfazer.

## 1.2.0 — 2026-08-25

Renomeada de `viagem-para-json` para `roteiro-trip-go`.

- **Passo 0 obrigatório**: perguntar cidades, lugares, valores e nomes dos
  participantes antes de montar qualquer JSON. O documento diz o que foi
  comprado, não o que a pessoa quer.
- **Passo 4 novo**: conferir `lib/schema.ts` (e o export da viagem, quando ela
  já existe) antes de escrever — Zod descarta chave desconhecida em silêncio,
  então seção renomeada importava vazia sem erro.
- Documentação alinhada ao `SCHEMA_VERSION = 3` real, que já tinha divergido:
  `viajantes`/`pin`/`papel: admin` → `participantes`/`email`/`proprietario·
  editor·visualizador`, `hospedagens` → `reservas`, `custos[].valor_centavos`
  passa a ser o **total** (não o valor por pessoa × `pessoas`), pago vira
  `parcelas[].pago_centavos`, checklist ganha `prioridade`/`fonte_*`.

## 1.1.0 — 2026-08-24

`schemaVersion` alinhada a `SCHEMA_VERSION = 3` de `lib/schema.ts`.

- Nova capacidade: gerar lotes de sugestão de checklist para uma viagem já
  existente no app (`reference/checklist-sugestoes.md`), em vez de só o JSON
  de importação de uma viagem inteira.
- Estrutura nova: `schema/`, `rules/`, `templates/`, `mappings/`,
  `validators/`, mais este `CHANGELOG.md` na raiz da skill — versionamento
  explícito e evolução controlada, sem a skill reescrever o próprio
  `SKILL.md`.

## 1.0.0

Versão original: converte documentos de viagem no JSON de importação
completo (roteiro, voos, cruzeiro, hospedagens, lugares, checklist,
documentos, contatos de emergência, custos).
