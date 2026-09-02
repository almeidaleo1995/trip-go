# Changelog — skill roteiro-trip-go (antes `viagem-para-json`)

Uma entrada por versão aplicada. Uma proposta de versão que ainda não foi
revisada/aplicada não entra aqui — ela vive só no relatório da skill até
alguém aceitar.



## 1.5.0

**A linha entre dado e codigo virou a regra numero 1, e as duas metades ganharam
autorizacoes opostas.**

- **Em DADO, decide e executa.** Ler os arquivos, escolher o que entra, montar o
  roteiro e gravar na viagem que ja existe deixou de ser coisa para pedir
  permissao. "Adiciona um passeio no dia 12" tem como resposta o passeio no app,
  nao um plano de como adiciona-lo.
- **Em CODIGO, nunca mexe — especifica.** Pedido que so seria possivel com campo,
  tabela ou tela nova vira `.specs/propostas/<slug>.md`, com seis coisas: o
  pedido na frase da pessoa, por que nao da hoje, o que da para fazer so com
  dado, a mudanca minima na ordem do checklist de 10 passos do README, a
  pergunta de seguranca (quem pode LER o campo) e o que quebra se ninguem fizer.
  A proposta e a entrega; implementar e outra conversa, fora da skill.
  Enfiar o dado num `nota` para "resolver" tambem esta proibido: e o campo que
  nenhuma tela le, nenhum filtro acha e nenhuma exportacao carrega.

**Passo 0 deixou de exigir round de perguntas.** Pedido pequeno e definido segue
direto; viagem inteira a partir de documentos mantem as 4 perguntas (cidades,
lugares, valores, quem vai). A quinta pergunta (onde salvar) so existe quando ha
arquivo a entregar — "sobe na minha viagem" nao gera arquivo nenhum.

**`scripts/viagens.mjs`** (novo): lista as contas e as viagens de cada uma, com o
id. E o que tira o uuid da conversa — uma viagem so na conta e essa, varias
perguntam pelo NOME. Le `trips` + `travelers` + `users` e nada mais: descobrir
para ONDE escrever nao exige ler o que ja esta escrito la, e `lib/skill.test.ts`
falha se ele encostar em `expenses`/`documents`.

**O PDF deixou de ser "sempre".** Item solto que subiu para o app nao vira PDF —
o app e a tela offline dele. Viagem montada do zero, backup ou pedido explicito,
sim.

**Quando parar antes de gravar** ficou escrito: acrescentar item novo grava;
MUDAR o que ja esta la (trocar a cidade do Reveillon, remexer em custo com
pagador, mexer em participante) pergunta antes, porque nao e acrescentar, e
reescrever a decisao de outra pessoa.

## 1.4.0

**A skill passou a subir a viagem sozinha.** Antes, "escrita direta" era uma
instrucao para escrever um script descartavel na hora e apaga-lo depois — na
pratica, cada carga era um script novo, sem dedup, sem autorizacao e sem volta.
Agora sao tres scripts de verdade:

- `scripts/subir.mjs` — grava no app. `--nova` cria a viagem pelo mesmo
  `importarViagem` de `/api/import`; `--viagem <tripId>` SOMA numa existente,
  operacao a operacao, por `exigirViagem` + `autorizar` + `aplicar`. A skill nao
  tem caminho proprio para o banco, entao ela nao consegue fazer nada que a conta
  em `--conta` ja nao pudesse fazer pela tela: visualizador leva 403, quem nao
  participa leva 404. Nao duplica (chave natural por secao, o que ja existe e
  pulado com o motivo impresso) e nao grava sem deixar volta.
- `scripts/desfazer.mjs` — reverte a carga inteira pelo `lote`, em ordem inversa,
  com `autorizar` linha a linha e `colunaValida` no campo lido do `change_log`.
- `scripts/campos.mjs` — imprime a lista de campos VIVA, lida de `SECOES_ARQUIVO`
  em `lib/schema.ts`. Virou o passo 4: a documentacao desta skill e apoio, e em
  qualquer divergencia a saida dele vence. O zod descarta chave desconhecida em
  silencio, entao uma secao renomeada nao da erro — importa vazia.
- `scripts/projeto.mjs` — resolve o alias `@/` para os tres acima poderem
  importar `lib/` do app em vez de reimplementar as regras.

**Regra nova, e verificavel:** a skill mexe em dado, nunca em codigo.
`lib/skill.test.ts` (no projeto, roda em `npm test`) falha se `subir.mjs` ou
`desfazer.mjs` ganharem qualquer escrita de arquivo ou execucao de comando, se
pararem de passar por `autorizar`/`aplicar`, ou se `campos.mjs` deixar de ler o
schema do app.

Escritas da skill ficam marcadas com `origem = 'skill'` no `change_log`.

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
