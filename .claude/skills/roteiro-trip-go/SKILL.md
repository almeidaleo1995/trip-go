---
name: roteiro-trip-go
description: Monta e atualiza a viagem do TripGo. Converte documentos de viagem (PDF, e-mail, print, texto solto) no arquivo JSON de importação deste app, e entrega junto um PDF do roteiro para usar sem sinal. Extrai roteiro, voos, cruzeiro, hospedagens, lugares, checklist com prazos, documentos, contatos de emergência e custos, valida contra o schema real do projeto e aponta contradições entre documentos em vez de escolher em silêncio. Sobe o resultado direto para o app (scripts/subir.mjs) — viagem nova ou somando numa que já existe —, achando a viagem sozinha (scripts/viagens.mjs), sem duplicar o que já está lá e deixando a carga inteira desfazível por um lote. Em DADO ela decide e executa; em CÓDIGO ela nunca mexe — escreve a proposta da funcionalidade em .specs/propostas/ e entrega para quem revisa. Também gera lotes de sugestão de checklist (ver reference/checklist-sugestoes.md e a árvore schema/rules/templates/mappings/validators). Use quando o usuário mandar PDFs/vouchers/bilhetes de uma viagem e pedir para carregar no app, gerar o arquivo de importação, montar ou detalhar um dia do roteiro, atualizar a viagem, sugerir itens de checklist, ou disser "converte esses documentos", "gera o JSON da viagem", "importa isso aí", "sobe isso no app", "monta meu roteiro", "adiciona um passeio no dia X", "atualiza minha viagem", "sugere checklist".
skillVersion: 1.5.0
schemaVersion: 3
---

# Roteiro TripGo — documentos e conversa → JSON de importação

Transforma o que o usuário já tem (caderno de viagem, lista de prazos, voucher, bilhete emitido) no arquivo que a tela **Dados → Importar** do app aceita — e, para uma viagem que já existe no app, num lote de sugestões de checklist (ver [reference/checklist-sugestoes.md](reference/checklist-sugestoes.md)).

O app nunca lê PDF. Esta conversão acontece aqui fora, com julgamento, e o resultado é um JSON validado contra o schema de verdade do projeto.

`schemaVersion` acima espelha `SCHEMA_VERSION` de `lib/schema.ts` no app — é assim que esta skill sabe se está desatualizada em relação ao contrato do app (ver `CHANGELOG.md` e a regra de nunca reescrever a si mesma, no fim deste arquivo).

## As duas regras que governam tudo

**1. Em DADO, decida e execute. Em CÓDIGO, pare e proponha.**

São duas autorizações diferentes, e a linha entre elas é a regra inteira.

**Do lado do dado, a skill tem poder total e deve usá-lo.** Ler os arquivos que a
pessoa mandou, decidir o que entra, montar o roteiro, escolher os campos,
escrever na viagem que já existe no app — tudo isso é para fazer, não para
perguntar se pode. Quando alguém diz *"adiciona um passeio no dia 12"*, a
resposta certa é o passeio no app, não um plano de como adicioná-lo. O padrão é
**executar**; ver o passo 5 para quando parar.

**Do lado do código, a skill não toca — ela especifica.** Não edita arquivo do
app, não muda schema, não instala dependência, não altera configuração. Se o
pedido só for possível com uma mudança de código, isso deixa de ser um pedido de
dado: escreva a proposta (formato em **Quando o pedido esbarra em código**, mais
abaixo) e entregue. Quem revisa decide e implementa.

A separação é verificável, não uma promessa: `lib/skill.test.ts`, no projeto,
falha se `subir.mjs` ou `desfazer.mjs` ganharem qualquer escrita de arquivo ou
execução de comando. Roda em `npm test`, junto com o resto.

(Os arquivos que a skill **entrega** — o `.json`, o `.pdf`, a proposta em
`.specs/propostas/` — são produto, não código.)

**2. Não invente dado.** Não vai `"cabine": "a confirmar"` nem um valor plausível.
Um app de viagem com dado inventado é pior que um app vazio, porque a pessoa
confia nele no aeroporto.

Se o documento não diz o número da cabine, o campo fica ausente. Quando faltar
algo importante, liste no relatório final sob **"Faltando nos documentos"**.

## Processo

### 0. Descobrir o tamanho do pedido, e perguntar só o que trava

Dois pedidos muito diferentes chegam por esta porta, e tratá-los igual é o que
faz a skill parecer burocrática ou imprudente, dependendo do lado que erra.

**Pedido pequeno e definido** — *"adiciona um passeio no Prado dia 14 às 18h"*,
*"marca o voo de volta como comprado"*, *"cria o checklist do visto"*. O
conteúdo está na frase. **Não faça round de perguntas.** Descubra a viagem
(abaixo), monte, mostre com `--conferir`, e grave. Perguntar "em qual viagem?"
quando a conta tem uma só é ruído.

**Viagem inteira a partir de documentos** — um monte de PDF, um caderno, uma
conversa longa. Aí sim o documento diz o que foi comprado e não o que a pessoa
quer, e as respostas mudam o resultado. Pergunte em **uma única mensagem**,
numeradas, e espere:

1. **Cidades** — quais entram de verdade, e quantos dias em cada uma? Cidade
   citada num PDF não é cidade visitada (ver Armadilhas). Se o documento já
   resolve, confirme em vez de perguntar aberto: *"Entendi Madri (2), Hamburgo
   (2), Bruges (bate-volta do navio) — falta ou sobra alguma?"*
2. **Lugares** — dentro de cada cidade, o que a pessoa quer ver/fazer? Pergunte o
   interesse (museu, caminhada, comida, com criança, mobilidade reduzida), não
   uma lista pronta.
3. **Valores** — o que está pago, o que é cotação, e quem pagou cada coisa.
   Decide `estimado`, `pagador` e `divisoes[]`, que nenhum PDF traz.
4. **Quem vai** — os nomes exatos, do jeito que já estão no app. A divisão de
   despesa e o `assigned_to_nomes` casam **por nome**; nome errado importa como
   despesa sem dono.

Se a pessoa responder "tanto faz, decide você", grave só o que o documento
sustenta e liste o resto em **"Faltando nos documentos"**. Não preencha o
silêncio com plausível.

**Achar a viagem — sem pedir uuid a ninguém:**

```bash
node --env-file=.env.local .claude/skills/roteiro-trip-go/scripts/viagens.mjs
```

Lista as contas e as viagens de cada uma, com o id. Uma viagem só na conta: é
essa, siga. Várias: pergunte pelo **nome**, nunca pelo id. Nenhuma: é caso de
viagem nova (passo 5).

**Onde salvar arquivo** — só pergunte quando for entregar `.json`/`.pdf`. Se o
pedido é "sobe na minha viagem", não há arquivo para salvar e não há o que
perguntar. Quando houver, **nunca escolha a pasta sozinha**: scratchpad de sessão
some, a raiz do repositório entra no git sem ninguém pedir. Ofereça opções
concretas e aceite um caminho digitado.

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

O app muda; esta skill não muda sozinha. **A primeira coisa a rodar, sempre:**

```bash
node .claude/skills/roteiro-trip-go/scripts/campos.mjs           # todas as seções
node .claude/skills/roteiro-trip-go/scripts/campos.mjs roteiro   # uma só
```

Ele imprime a lista de campos **viva**, lida de `SECOES_ARQUIVO` em
`lib/schema.ts` — obrigatórios, tipos, enums, padrões, e os vínculos por nome
entre seções. Não escreve nada; só lê o schema.

Isto não é conferência de rotina, é a defesa contra a falha mais silenciosa que
existe aqui: **o zod descarta chave desconhecida sem erro**. Uma seção renomeada
não falha, importa vazia. Um campo renomeado não falha, some. A documentação
desta skill (`reference/formato.md`) é apoio de leitura; **em qualquer
divergência, a saída de `campos.mjs` vence.**

Confira também `SCHEMA_VERSION` na primeira linha da saída contra o
`schemaVersion` do frontmatter. Se subiu, a skill está desatualizada: monte pelo
schema real e **proponha a nova versão no relatório final** — sem editar este
arquivo (ver Versionamento, no fim).

`custos[].valor_centavos` já trocou de sentido uma vez (era por pessoa, hoje é o
total): campo que continua existindo com o mesmo nome também muda.

**Para uma viagem que já existe no app**, olhe também o estado atual antes de
propor qualquer coisa: exporte por **Dados → Exportar** (ou peça o JSON ao
usuário) e compare. Item que já está lá vira atualização ou nada — não uma
segunda cópia. As regras de deduplicação estão em
[rules/dedup-e-prioridade.md](rules/dedup-e-prioridade.md).

### 5. Onde isto vai parar — decidir antes de montar

**`/api/import` SEMPRE cria uma viagem nova. Ele nunca soma numa existente.**
Isso é decisão de projeto, não bug — está escrito em `app/api/import/route.ts`:
substituir seria destruição silenciosa, então a pessoa passa a ter duas e
escolhe qual manter. `importarViagem` começa com `randomUUID()`.

A consequência governa esta skill inteira:

| A viagem… | O destino |
| --- | --- |
| já existe, e o pedido é adicionar/detalhar (um passeio, um dia, um voo, um lote de checklist) | `subir.mjs --viagem <tripId>` — **o caso mais comum, e o padrão** |
| ainda não existe no app | `subir.mjs --nova` |
| a pessoa pediu o arquivo, e não a viagem no app | gere o `.json` e diga numa frase que importar CRIA viagem nova |
| já existe, e o pedido é backup/portabilidade | **Dados → Exportar** no app; não replique o mapeamento de `/api/export` |

Entregar um arquivo de importação para o segundo caso é o erro mais caro desta
skill: o usuário importa achando que soma, e ganha uma viagem duplicada pela
metade. Se ele pedir o arquivo mesmo assim, gere — e diga numa frase o que vai
acontecer se ele subir.

O `tripId` sai do `viagens.mjs` (passo 0), não de uma pergunta.

**Quando parar antes de gravar:** o `--conferir` é sempre; a pausa para o humano
não é. Pare e pergunte quando a escrita **muda o que já está lá** — trocar a
cidade do Réveillon, remexer em `custos` que já têm pagador, mexer em
`participantes` — porque isso não é acrescentar, é reescrever a decisão de
outra pessoa. Acrescentar item novo a uma viagem: grave, e mostre o lote.

### 6. Montar o JSON

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

### 7. Validar — obrigatório antes de entregar

```bash
node --experimental-strip-types .claude/skills/roteiro-trip-go/scripts/validar.mjs <arquivo.json>
```

Valida contra o `TripImportSchema` real e imprime a contagem por seção. **Saída diferente de zero significa não entregar.** O script aponta o campo exato (`voos[2].parte_em: ...`).

Confira também a contagem impressa contra o documento: se o caderno fala em 6 portos e o resumo mostra 4, faltou coisa.

### 8. Subir para o app — é isto que faz a viagem aparecer na tela

```bash
# viagem nova: cria e devolve o link
node --env-file=.env.local \
  .claude/skills/roteiro-trip-go/scripts/subir.mjs <arquivo.json> \
  --nova --conta <email da conta>

# somar numa viagem que já existe
node --env-file=.env.local \
  .claude/skills/roteiro-trip-go/scripts/subir.mjs <arquivo.json> \
  --viagem <tripId> --conta <email da conta>

# ver o que aconteceria, sem gravar nada
… --conferir
```

**Rode `--conferir` primeiro, sempre.** Ele imprime o que gravaria, o que já
existe na viagem (e por isso seria pulado) e os avisos — sem tocar no banco. Numa
viagem em uso, ler isso antes custa dez segundos e evita a limpeza manual.

Três coisas que este script faz e que valem saber:

- **Ele não tem poder próprio.** Toda gravação passa por `exigirViagem` +
  `autorizar` + `aplicar` de `lib/`, com o `Acesso` da conta em `--conta`. Um
  `visualizador` leva 403 aqui igual levaria no navegador; uma conta que não
  participa da viagem leva 404. A skill não consegue fazer nada que essa pessoa
  já não pudesse fazer pela tela.
- **Ele não duplica.** Cada seção tem uma chave natural (roteiro: hora+título;
  voo: companhia+número+partida; despesa: descrição+valor…) e o que já está lá é
  **pulado**, com o motivo impresso. Rodar duas vezes não dobra o roteiro.
  `--forcar` insere assim mesmo, quando você quer o duplicado de propósito.
- **Ele é reversível.** A carga inteira recebe um `lote` e grava
  `origem = 'skill'` no `change_log`. O número do lote sai no fim:

```bash
node --env-file=.env.local \
  .claude/skills/roteiro-trip-go/scripts/desfazer.mjs <lote> --conta <email>
```

**Entregue o número do lote ao usuário no relatório final.** Escrever numa viagem
que outras pessoas já estão usando sem dizer como voltar atrás não é aceitável.

**O que NÃO sobe por `--viagem`, e por quê** (o script avisa em cada caso):

| Não sobe | Motivo |
| --- | --- |
| `participantes` | nome de participante é chave de dinheiro e de documento pessoal. Só com `--com-participantes`, depois de conferir a grafia com quem organiza |
| valor irregular de parcela, e parcela já paga | quem calcula parcela é o servidor (`gerarParcelas`), a partir do total e da quantidade — é a mesma regra da tela. Marque o pagamento na aba Financeiro |
| `pagamentos` (reembolsos) | apontam para uma parcela que só ganha id depois de gravada. Lance na aba Financeiro |
| bytes de documento | o cofre recebe o arquivo pela tela ou por `POST /api/documento`; o JSON carrega só a ficha |

Documento `pessoal` cujo `dono_nome` não bate com ninguém da viagem entra como
**global** — a viagem inteira passa a ver. O script avisa, e esse aviso vai para
o relatório: é mudança de quem enxerga o quê.

### 9. Gerar o PDF — quando houver arquivo para entregar

Vale quando a entrega inclui arquivo: viagem montada do zero, backup, ou pedido
explícito. Um item solto que já subiu para o app não vira PDF — o app é a tela
offline dele.

O objetivo do produto é **funcionar sem sinal**. Um JSON não se lê no
aeroporto, então a entrega com arquivo são **dois arquivos**, na pasta que o
usuário deu no passo 0:

```
<destino>/roteiro-<recorte>.json   # o registro, validado
<destino>/roteiro-<recorte>.pdf    # o que vai na mochila
<destino>/roteiro-<recorte>.html   # fonte do PDF, para reimprimir depois de editar
```

Monte um HTML próprio a partir do JSON e imprima com Chrome headless — o app
não tem lib de PDF de propósito, e esta skill não deve adicionar uma:

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless --disable-gpu \
  --no-pdf-header-footer --print-to-pdf="<abs>/roteiro.pdf" "file:///<abs>/roteiro.html"
```

- **Caminhos absolutos, e `file:///` na entrada.** Caminho relativo dá
  "Acesso negado" ao escrever. Se a pasta de destino recusar a escrita,
  imprima no scratchpad e copie.
- **Confira antes de entregar**: `--screenshot` do mesmo HTML e olhe. Acento
  quebrado e bloco cortado só aparecem assim.
- **Não use `render_pdf.py` da skill `roteiro-viagem`.** O formato dele é um
  dossiê inteiro (clima, gastronomia, golpes, consulado); preencher aquilo
  para um recorte menor é inventar dado — a regra que governa esta skill.
- Cores e nome do produto vêm de `config/theme.ts` e `config/site.ts`, não
  escritos à mão.

### 10. Relatório final

Entregue junto com os arquivos:

- **Contagem por seção** (a saída do validador).
- **Onde ficaram os arquivos** — caminho completo do `.json` e do `.pdf`.
- **Conflitos encontrados** e como foram resolvidos.
- **Faltando nos documentos** — o que o app vai mostrar vazio e por quê.
- **Não verificado** — o que veio de estimativa e deve ser confirmado na fonte oficial.
- **Se subiu para o app**: o link (`/viagens/<id>`), a contagem por seção, o que
  foi **pulado por já existir**, e o **número do lote** com o comando de desfazer.
  Uma carga sem caminho de volta não se entrega.
- **Se algo virou proposta de código**: uma frase dizendo o quê e o caminho do
  `.specs/propostas/<slug>.md`. Ver **Quando o pedido esbarra em código**.

## Quando o pedido esbarra em código

Uma hora vem um pedido que o app ainda não sabe guardar: *"marca quem é
vegetariano em cada refeição"*, *"quero anexar o áudio do guia"*, *"a despesa
precisa de uma segunda moeda"*. Não há campo, não há tabela, não há tela.

**Não improvise um lugar para o dado.** Enfiar "vegetariano" dentro de `nota`
resolve a tarde e cria o problema de sempre: um dado que nenhuma tela lê, nenhum
filtro acha e nenhuma exportação carrega, morando num campo de texto livre. Seis
meses depois ninguém sabe que está lá.

**Também não mude o código.** Não é o que esta skill faz, e um schema alterado
por baixo é a mudança que ninguém revisou.

**O que fazer: especificar a funcionalidade.** Escreva
`.specs/propostas/<slug>.md` — em `.specs/`, que é onde este projeto guarda
decisão e desenho, nunca em `lib/`, `app/` ou `db/` — com estas seis coisas:

```markdown
# <o que a pessoa pediu, na frase dela>

**Pedido:** a frase original, e o que ela quer no fim.
**Por que não dá hoje:** o campo/tabela/tela que falta, nomeada.
**O que dá para fazer agora:** o mais próximo possível só com dado — e o que
  isso deixa de fora. Às vezes é suficiente e a proposta morre aqui, o que é bom.
**Mudança mínima:** os arquivos, na ordem do checklist de 10 passos do README
  (db/schema.sql nas DUAS metades, lib/schema.ts, /api/export, lib/importar.ts,
  a tela, VERSAO em lib/offline.ts…).
**A pergunta de segurança:** quem pode LER esse campo, não só quem escreve. Se
  identifica uma pessoa, ele entra em CAMPOS_CIFRADOS e sai do snapshot dos
  outros. Ver a lista de 8 itens no CLAUDE.md.
**O que quebra se ninguém fizer:** nada, ou o dado fica num lugar errado?
```

Depois **diga em uma frase**, na conversa, o que ficou proposto e onde. Não
implemente e não peça permissão para implementar — a proposta é a entrega.

Se a pessoa responder "faz aí", aí sim é uma tarefa de código normal, fora da
skill: quem mexe no projeto é o assistente na conversa, com o diff à vista, e o
`npm test` no fim.

## O roteiro alimenta a aba HOJE

Um roteiro bem extraído não serve só para ser lido — ele resolve o dia. A aba
**Hoje** monta "o que é agora / o que vem depois / **saia às** / onde eu durmo"
a partir dos MESMOS campos, sem dado novo. O que muda a qualidade da tela:

- **`duracao_min` e `distancia_m` no item de DESTINO** ("para chegar no Casa
  Lucio, 950 m a pé, 14 min"). É daí que sai o "Saia às 11:11", que é a única
  conta que ninguém faz de cabeça no meio da rua. Sem `duracao_min` a tela não
  mostra horário de saída nenhum — e é assim que tem que ser.
- **`fim_em`** no que tem hora de terminar: é o que vira "1h06 restantes".
- **`endereco`** no item e na reserva: é a tela que se vira para o motorista.
- **`telefone`** na hospedagem.
- **`fuso`** na viagem (`"Europe/Madrid"`): faz o "agora" valer o relógio do
  destino quando alguém abre o app ainda em casa.

Vale a regra de sempre, e aqui ela pesa mais: **ausente é melhor que chutado.**
Esta é a tela que alguém lê com pressa e acredita sem conferir.

Detalhe campo a campo em [reference/formato.md](reference/formato.md).

## O roteiro alimenta o MAPA

A visão **Roteiro → Mapa** desenha a viagem inteira a partir dos mesmos campos —
não existe tabela de mapa. O que o mapa mostra sai de quatro lugares:

| No mapa aparece como | Vem de | Campo que decide |
|---|---|---|
| Cidade | `lugares[]` | `lat`/`lon` |
| Hotel | `reservas[]` com `tipo: "hospedagem"` | `lat`/`lon` |
| Restaurante | `reservas[]` `tipo: "restaurante"`, ou item `restaurante`/`refeicao` | `lat`/`lon` |
| Aeroporto | item de roteiro `tipo: "voo"` | `lat`/`lon` |
| Estação | item `tipo: "trem"` ou `"onibus"` | `lat`/`lon` |
| Porto | item `tipo: "cruzeiro"`, e `cruzeiros[].portos[]` | `lat`/`lon` |
| Atividade | qualquer outro item de roteiro | `lat`/`lon` |
| Rota da viagem | a ORDEM de `lugares[]`, mais `voos[]` e itens de trecho | — |

**`reservas[]` e `cruzeiros[].portos[]` aceitam `lat`/`lon`** — isto é novo.
Antes o hotel não tinha onde guardar coordenada. Rode
`node .claude/skills/roteiro-trip-go/scripts/campos.mjs reservas` para ver a
lista viva; chave fora dela é descartada em silêncio pelo zod.

### Coordenada: as três saídas honestas, nesta ordem

1. **O documento traz.** Voucher com "38.7223, -9.1393", link do Google Maps com
   `@lat,lon`, ficha do hotel com coordenada. Use, e registre a fonte.
2. **Você pesquisou e confirmou.** Só vale com fonte nomeada — o site oficial do
   hotel, o do museu, a página da estação. Registre em `links` (abaixo).
3. **Você não tem.** **Omita o campo.** Não mande `null` dentro de um objeto de
   coordenada, não arredonde o centro da cidade para parecer um endereço, não
   copie a coordenada do hotel para o restaurante ao lado.

A terceira saída não é falha — é o comportamento projetado. Um lugar sem
coordenada mas **com `cidade` que existe em `lugares[]`** aparece no mapa no
centro da cidade, com anel tracejado e o texto **"Localização aproximada"**. O
app já diz a verdade sozinho; o que ele não consegue é adivinhar que a
coordenada bonita que você escreveu era um chute.

**Portanto: `cidade` preenchida vale mais que coordenada inventada.** É a
diferença entre um pino honesto e um pino errado.

### Onde vai a FONTE e a data da verificação

Não existe coluna `fonte` nem `checked_at`, e **não invente uma** enfiando isso
num campo de texto livre — é exatamente o dado que nenhuma tela lê, nenhum
filtro acha e nenhuma exportação carrega. Use o que já existe:

- **A fonte vai em `links`**, um por linha, no formato `Rótulo|URL` que o campo
  já tem: `Fonte: Museu do Louvre|https://www.louvre.fr/visite/horaires`. Esse
  campo é exportado, clicável na tela e passa por `hrefSeguro`.
- **A data da verificação já é gravada pelo app.** Toda escrita da skill entra
  no `change_log` com `origem = 'skill'` e um `lote`, com data e autor. É o que
  torna a carga desfazível por `desfazer.mjs`, e é um registro melhor do que uma
  data digitada por você: ninguém consegue editá-lo por engano.

Se um pedido realmente exigir um campo de fonte estruturado, isso é **código**:
escreva `.specs/propostas/<slug>.md` e pare, do jeito que a seção "Quando o
pedido esbarra em código" manda.

### O que auditar antes de subir

O app tem auditoria própria (Roteiro → Mapa → o aviso no rodapé), mas ela só
enxerga o que já foi gravado. Confira antes:

- Toda cidade de `lugares[]` tem `lat`/`lon`? **Sem isso ela não entra no mapa e
  leva junto todo lugar daquela cidade** — é a lacuna que mais custa.
- A `cidade` escrita nos itens e nas reservas bate, letra por letra, com a de
  `lugares[]`? A comparação ignora caixa e acento, mas não apelido: "Madri" e
  "Madrid" são cidades diferentes para o mapa.
- `lugares[]` está na ORDEM da viagem? A rota macro é essa ordem, não a data.
- Cada trecho entre cidades tem um `voos[]` ou um item de roteiro (`trem`,
  `onibus`, `traslado`, `cruzeiro`) que o comprove? Sem isso a perna aparece
  apagada, escrita **"Rota não verificada"** — o que é honesto, mas é uma
  pergunta que sobra para quem viaja.
- Escala de cruzeiro em `portos[]` tem `lat`/`lon` ou pelo menos `cidade`?

### Sugestão nunca vira evento

Se você identificar uma oportunidade — uma janela livre perto de uma atração,
duas atividades que cruzam a cidade duas vezes —, **isso não entra no roteiro.**
Um evento gravado é um compromisso, e ninguém combinou esse. Traga no relatório
final, como texto, com o que você viu e o que propõe. Quem decide adiciona.

Vale o mesmo para contradição: dois documentos com horários diferentes para o
mesmo trem viram uma **pergunta**, nunca uma escolha silenciosa.

## Armadilhas já pagas

- **`pdftotext -layout` intercala colunas de tabela.** Numa tabela de linha do tempo, a coluna de datas e a de descrições podem sair em blocos separados, e a associação data↔evento fica errada. Sempre confira alguns pares contra a lógica do texto corrido antes de gravar.
- **Rollover de data.** `2026-13-05` é aceito pelo construtor `Date` e vira janeiro de 2027. O schema rejeita, mas só se você não "corrigir" para uma data plausível antes. Se o documento tem data impossível, pergunte.
- **`Number(null)` é `0`.** Coordenada ausente vira ilha nula no golfo da Guiné. Omita o campo em vez de mandar `null` dentro de um objeto de coordenadas.
- **Cidade citada não é cidade visitada.** "Amsterdã fica a 40 min de trem" é uma sugestão de passeio, não uma parada da rota. Só entra em `lugares[]` o que a viagem realmente inclui.
- **Um cruzeiro não é uma hospedagem.** Vai em `cruzeiros[]`, com os portos em ordem.
- **O driver do Neon materializa `timestamp` como `Date`, e imprimir desloca o fuso.** Conferindo o estado da viagem, um evento gravado às `17:30` sai no console como `2026-12-31T20:30:00.000Z` — três horas a mais, porque o `Date` foi construído na hora local. Quem lê isso como verdade "corrige" um roteiro que estava certo. Ao inspecionar, peça texto ao Postgres: `to_char(ocorre_em, 'YYYY-MM-DD"T"HH24:MI')`. É o mesmo motivo pelo qual `/api/export` usa os getters locais e não `toISOString()`.

## Documentos para o cofre

Um PDF ou uma foto que chega junto com a viagem tem dois destinos possíveis, e
confundi-los é o erro caro: **o texto** vira roteiro, voo, reserva e custo, como
sempre; **o arquivo em si** vira uma linha em `documentos[]` com `tipo: "arquivo"`
— o cofre offline do app. O mesmo voucher costuma render os dois.

Ao classificar um arquivo, preencha só o que ele **diz**:

| Campo | De onde sai |
|---|---|
| `titulo` | o que a pessoa chamaria isto na tela ("Reserva Hotel Madrid"), não o nome do arquivo |
| `arquivo_nome` | o nome do arquivo, cru (`Reserva_Hotel_Madrid.pdf`) |
| `categoria` | uma das catorze do `lib/schema.ts`. Na dúvida, `outro` — nunca invente uma |
| `cidade` / `pais` | só se o documento nomear o destino |
| `dia` | a data a que ele pertence, quando houver uma |
| `reserva` | o **nome** da hospedagem/reserva, não um id |
| `escopo` | `pessoal` só quando o documento é de UMA pessoa (passaporte, apólice individual) |
| `dono_nome` | obrigatório se `escopo: "pessoal"` — sem ele a importação rebaixa para `global` |
| `validade` | a data de expiração impressa (passaporte, seguro, visto) |
| `offline` | `true` para o que se abre em trânsito: embarque, reserva, seguro, passaporte |
| `importante` | `true` só para o punhado que se procura correndo |
| `tags` | palavras que aparecem no documento; não invente taxonomia |

**Não invente.** Se o PDF não diz a cidade, `cidade` fica ausente — a mesma regra
do resto da skill. Um documento categorizado errado some da busca da pessoa
exatamente quando ela precisa dele.

**Confira se já existe antes de criar.** Documento é o caso onde duplicar dói
mais: dois "Reserva Hotel Madrid" no cofre significam que um deles está
desatualizado e ninguém sabe qual. Compare por título normalizado
(`normalizarTitulo`, o mesmo de `lib/checklist.ts`) contra `snapshot.documentos`
antes de gravar — as regras de deduplicação de
[rules/dedup-e-prioridade.md](rules/dedup-e-prioridade.md) valem aqui inteiras.
Se bater, **atualize a linha existente** em vez de criar outra.

**Os bytes não passam pelo JSON.** `documentos[]` carrega a ficha; o conteúdo do
arquivo sobe pela tela do cofre ou por `POST /api/documento` (multipart, campo
`arquivo` + `campos`). Um JSON de importação com PDFs em base64 dentro deixa de
ser um arquivo que alguém consegue abrir e conferir.

## Documentação exigida — o que a viagem PEDE de cada pessoa

`documentos[]` guarda o que **existe** (o voucher que chegou por e-mail).
`requisitos[]` guarda o que **falta** — e um requisito que ninguém cumpriu ainda
é justamente o caso que importa: sem arquivo, sem entrega, e mesmo assim ele
precisa aparecer em vermelho na frente de alguém antes do embarque.

Ao processar uma viagem, proponha os requisitos que os **documentos dizem** e os
que o **trecho** implica:

| De onde vem | Exemplo |
|---|---|
| o bilhete | voo internacional → passaporte; cartão de embarque |
| a reserva | hotel que pede documento na entrada → identidade |
| o cruzeiro | a companhia lista o que exige no embarque |
| o carro alugado | carteira de motorista, **só para quem vai dirigir** (`aplica_todos: false`) |
| o país | exigência de entrada — **só com fonte**, ver abaixo |

Campos, em `reference/formato.md`. Os que decidem o comportamento:

- `obrigatorio: false` → é uma **recomendação**: aparece na lista, não conta como
  pendência e não derruba a porcentagem de ninguém.
- `aplica_todos: false` + `assigned_to_nomes` → vale só para as pessoas nomeadas.
  É como "documento de menor" e "carteira de motorista" existem sem cobrar todo
  mundo por algo que não lhes diz respeito.
- `exige_numero` / `exige_validade` / `exige_arquivo` → o que a pessoa entrega.
  Podem coexistir (passaporte quer os três) ou vir sozinhos (CPF quer só o número).
  **Nenhum dos três ligado** é válido: é o requisito que só pede o de-acordo.
- `campo_perfil` → `cpf` | `rg` | `passaporte` | `nascimento` | `nacionalidade` |
  `emergencia`. Liga o requisito ao perfil da CONTA, para o dado não ser pedido de
  novo a cada viagem. Use sempre que houver um campo equivalente.
- `prazo` → data limite para **enviar**, que não é a validade do documento. Um
  passaporte válido até 2031 ainda pode estar atrasado para entrega.

### Não invente exigência legal

Esta é a regra que mais custa se for quebrada: alguém pode não viajar por causa
dela.

- Exigência que o **documento em mãos afirma** (o cruzeiro lista o que pede no
  embarque) → cadastre, com a fonte na `descricao`.
- Exigência de **entrada em país** (visto, vacina, validade mínima de passaporte,
  ETIAS) → **pesquise antes** em fonte oficial (consulado, chancelaria, órgão de
  imigração), registre a fonte e a data em `obs`, e prefira `obrigatorio: true`
  apenas quando a fonte for explícita. Regra que você não confirmou **não entra**.
- Nunca deduza de "é Europa, então…". Regras mudam, e a que mudou é a que quebra.

### Entregas

`entregas[]` só faz sentido quando você está **restaurando um backup**. Ao montar
uma viagem nova a partir de PDFs, gere `requisitos[]` e deixe `entregas[]` vazio:
quem entrega é a pessoa, na tela, e uma entrega inventada marca como resolvido um
passaporte que ninguém conferiu.

## Sugestões de checklist para uma viagem que já existe

Formato completo, regras de deduplicação/prioridade e o mapeamento nome→campo estão em:

- [reference/checklist-sugestoes.md](reference/checklist-sugestoes.md) — o processo
- [schema/checklist-sugestoes.schema.json](schema/checklist-sugestoes.schema.json) — leitura humana do formato (a fonte real continua sendo `lib/schema.ts` no app)
- [rules/dedup-e-prioridade.md](rules/dedup-e-prioridade.md) — normalização de título, prioridade, fonte obrigatória
- [templates/categorias-e-fases.md](templates/categorias-e-fases.md) — categorias sugeridas e por que não existe campo `fase`
- [mappings/campo-para-app.md](mappings/campo-para-app.md) — `assigned_to_nomes`/`evento`/`voo`/`cruzeiro` por nome
- `validators/validar-sugestoes.mjs` — validação obrigatória antes de entregar um lote, igual ao passo 7 acima

Lote de sugestão é quase sempre o caso "a viagem já existe" do passo 5: o destino
natural é `subir.mjs --viagem <tripId>` com um arquivo que traz **só a seção
`checklist`** (mais o bloco `viagem`, que o schema exige), não um arquivo de
importação inteiro. As demais seções ficam vazias e nada mais é tocado.

## Versionamento — nunca reescreve a si mesma

Este `SKILL.md` declara `skillVersion`/`schemaVersion` no topo. Se o schema do app mudar de um jeito que quebra o contrato desta skill (campo renomeado, novo campo obrigatório, entidade removida), a skill **nunca edita este arquivo sozinha**. Ela propõe, em texto, no relatório final:

```
Nova versão sugerida: 1.4.0
Alterações: [o que mudou no schema do app e por quê isso afeta a skill]
```

Quem revisa decide se aplica. Cada versão aplicada ganha uma linha em [CHANGELOG.md](CHANGELOG.md).
