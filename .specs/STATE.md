# Estado do Projeto — Planejador de Viagens em Grupo

## Decisions

### AD-001 — Next.js + Neon Postgres em vez de artifact de arquivo único
**Data:** 2026-08-21
**Contexto:** O pedido original era um React single-file offline, sem backend. O usuário depois trouxe uma conta Neon e pediu sincronização real entre 5 aparelhos.
**Decisão:** App Next.js (App Router) com Neon Postgres, deployado na Vercel.
**Razão:** A connection string do Neon não pode viver no navegador — exige uma API route no servidor. Sync real e proteção verdadeira do Financeiro só existem com backend.
**Consequência:** Deixa de ser um arquivo colável em artifact. Ganha sync, autorização de verdade e edição pela UI. Exige deploy.

### AD-002 — O banco é a fonte da verdade; o JSON de config é importador
**Data:** 2026-08-21
**Contexto:** A revisão 1 previa um objeto `TRIP_CONFIG` no topo do arquivo como fonte permanente.
**Decisão:** O conteúdo vive no Neon. O JSON padrão serve como carga inicial, enviado pela tela de admin.
**Razão:** O usuário quer editar durante a viagem (imprevistos). Na primeira edição pela UI, um arquivo versionado divergiria do banco e deixaria de ser fonte da verdade.
**Consequência:** Sem `npm run seed` e sem terminal. Conversão PDF → JSON continua sendo feita fora do app, sob demanda.

### AD-003 — Autenticação por nome + PIN com hash, autorização no servidor
**Data:** 2026-08-21
**Decisão:** Nome + PIN de 4 dígitos, bcrypt no banco, cookie httpOnly de 90 dias, rate limit de 10 tentativas/5min.
**Razão:** Sem email e sem senha para decorar, adequado a 5 pessoas conhecidas; 90 dias cobrem a viagem sem relogin no exterior.
**Consequência:** O Financeiro passa a ser protegido de verdade (403 no endpoint), não apenas escondido da interface.

### AD-004 — Offline-first por cache + fila, com last-write-wins
**Data:** 2026-08-21
**Decisão:** PWA com service worker, snapshot em IndexedDB, escritas otimistas numa fila que dá flush ao reconectar. Conflito resolvido por `updated_at` mais recente.
**Razão:** Entrega "abre em modo avião e funciona" sem introduzir CRDT.
**Consequência:** Simplificação deliberada com teto conhecido — duas edições simultâneas do mesmo campo perdem a mais antiga. Marcar com comentário `ponytail:` no código de merge.

### AD-005 — Credencial do Neon entregue pelo chat
**Data:** 2026-08-21
**Decisão:** O usuário cola a connection string na conversa; eu configuro tudo.
**Razão:** Escolha explícita do usuário, com o custo declarado.
**Consequência:** A senha fica no histórico da sessão. Mitigação combinada: rotacionar a senha no console do Neon depois do deploy.

### AD-006 - As referencias visuais do usuario sao a fonte da verdade do design
**Data:** 2026-08-21
**Contexto:** Numa pergunta anterior o usuario escolheu "painel denso" e pediu "cores vibrantes". Depois enviou duas imagens de referencia (mock mobile e desktop) que sao o oposto: espacosas, arejadas, monocromaticas em teal.
**Decisao:** As imagens ganham. Sistema visual calmo, teal `#0F766E`, muito branco, numeral gigante na contagem, mapa da rota como heroi.
**Razao:** Referencia visual concreta comunica intencao melhor que adjetivo abstrato. Confirmado com o usuario antes de codar.
**Consequencia:** Descartados a paleta vibrante de 8 cores categoricas e o par Fira Sans/Fira Code. Entram Inter e os badges de tipo pastel. Contraste de todo token foi medido, nao estimado: `#0D9488` e `#94A3B8` ficaram proibidos para texto por reprovarem AA.

### AD-007 - CRUD completo pela interface, incluindo viagem e viajantes
**Data:** 2026-08-21
**Contexto:** AD-002 definiu o banco como fonte da verdade com o JSON como importador. O usuario depois pediu CRUD para tudo, inclusive cadastrar a viagem pela tela.
**Decisao:** O admin cria, edita e remove tudo pela interface - viagem, viajantes, PINs e as 13 entidades de conteudo. A importacao de JSON continua existindo como atalho de carga em massa.
**Razao:** Pedido explicito. Sem isso o usuario depende de mim para cada mudanca de conteudo, o que anula o proposito de ter backend.
**Consequencia:** Nao substitui AD-002, estende. Entraram as historias P13 (gestao) e as tarefas de gestao da viagem e de viajantes. A folha de edicao e dirigida pelo schema zod, para nao escrever 13 formularios a mao.

### AD-008 - Cruzeiro e primeira classe no modelo, nao um caso de hospedagem
**Data:** 2026-08-21
**Contexto:** As referencias mostram uma aba Cruzeiro e a viagem real e um cruzeiro pelo Baltico.
**Decisao:** Tabelas `cruises` e `cruise_ports` proprias, e aba condicional que so aparece quando a viagem tem navio.
**Razao:** Embarque, cabine, portos e dias no mar nao cabem em `flights` nem em `stays` sem distorcer os dois modelos.
**Consequencia:** A navegacao passa a ser montada a partir dos dados, nao fixa no codigo - o que ja era necessario para o Financeiro por papel.

### AD-009 - Nenhuma chamada de LLM em producao; inteligencia roda em skills externas ao app
**Status:** SUPERADA por AD-010 (2026-09-01).
**Data:** 2026-08-24
**Contexto:** Design da feature `checklist-inteligente` (`.specs/features/checklist-inteligente/`) pedia decidir onde a "IA" de sugestao de checklist roda - um botao dentro do app chamando um provedor de LLM, ou a skill `viagem-para-json` (ja existente, ja roda fora do app) apenas ganhando mais um formato de saida.
**Decisao:** TripGo nunca tera uma dependencia de LLM/API de IA em producao. Toda inteligencia (leitura de documentos, pesquisa externa, geracao de sugestoes) acontece em skills executadas fora do app (Claude Code/Desktop); o app so recebe, valida e revisa o resultado estruturado.
**Razao:** Mantem o principio de "4 dependencias de proposito" do CLAUDE.md - sem chave de API para gerenciar, sem custo por geracao, sem superficie de prompt injection em producao. `viagem-para-json` ja seguia esse padrao informalmente; esta decisao o formaliza para toda feature futura.
**Consequencia:** Um pedido futuro de "IA ao vivo dentro do app" e uma proposta de superar esta decisao (exige uma nova AD que a substitua), nao algo a implementar em silencio.


### AD-010 - Assistente de IA dentro do app, substituindo a AD-009
**Data:** 2026-09-01
**Contexto:** A AD-009 proibiu LLM em producao e previu que um pedido de "IA ao vivo dentro do app" exigiria uma AD que a substituisse. O pedido veio: um assistente conversacional que entende a viagem, escreve nela por texto ou voz, resume um lugar recem-criado, responde como guia com informacao da internet e aponta o que falta preparar - no celular, durante a viagem, com a chave da Anthropic do dono. Spec em `.specs/features/assistente-ia/`.
**Decisao:** O TripGo passa a chamar a API da Anthropic em producao, a partir do servidor. `@anthropic-ai/sdk` entra como quinta dependencia de runtime, so no servidor. A skill `roteiro-trip-go` continua existindo para conversao de documentos em lote no desktop - a AD-010 nao a substitui, so deixa de exigir que TODA inteligencia passe por ela.
**Razao:** O que o usuario pediu e impossivel sob a AD-009 por um motivo estrutural, nao de preferencia: uma skill de Claude Code roda no desktop de uma pessoa, sob demanda, com o repositorio em maos. Ela nunca vai estar disponivel para cinco pessoas, no celular, no meio de uma viagem - que e exatamente quando o app precisa ser util. A AD-009 continua correta para o caso que ela decidiu (conversao de documento em lote); ela errava ao generalizar para "toda feature futura".
**Consequencia:** Tres custos assumidos, cada um com resposta na spec. (1) Custo por uso e dependencia de rede - o assistente e a primeira parte do app que nao funciona em modo aviao, e a spec exige que ele se declare indisponivel em vez de enfileirar (P1-9). (2) Segredo novo em producao - `ANTHROPIC_API_KEY` segue a regra do `DATABASE_URL`: existe so no processo servidor, nunca chega ao navegador. (3) Superficie de prompt injection, a razao mais forte da AD-009 - respondida nao por confianca no modelo, mas por arquitetura: a IA escreve pelo mesmo `autorizar`/`validarCampos` de `/api/mutate`, com o `Acesso` de quem falou, entao ela nao consegue fazer nada que a pessoa ja nao pudesse fazer pela tela (P1-2), e toda escrita fica marcada no `change_log` e desfazivel em lote (P1-5, P1-6). Injecao no pior caso e vandalismo rastreado, nunca escalada de privilegio.

**Emenda de 2026-09-01 (mesma sessao, entrevista complementar).** A decisao de escrita direta foi revertida pelo usuario antes de qualquer linha ser escrita: "ele nao sai colocando as coisas, mas quando pedir eu quero que ele ja insira". O assistente passa a PROPOR e so gravar apos aceite. Tres consequencias: (a) a remocao pela IA, que o design tinha proibido porque o change_log nao guarda o conteudo da linha apagada, volta a ser permitida - com confirmacao ela e tao deliberada quanto o botao de apagar da tela; (b) a conversa e o aceite viram DUAS rotas, e a de conversa nao importa lib/escrita.ts, entao ela nao tem como gravar - verificavel por leitura de import, nao por confianca; (c) a defesa contra prompt injection deixa de depender so de arquitetura e ganha um humano lendo antes de cada escrita.

Entraram na mesma emenda: os tres modos do guia (criar viagem em tela propria, duvida dentro da viagem, curiosidades dentro do Roteiro e das Cidades - nao sao abas novas) e um relatorio de consumo da API. O relatorio tem duas metades de disponibilidade diferente: o consumo do proprio app, calculado do campo `usage` de cada resposta, sempre funciona; o gasto consolidado da organizacao depende da Admin API, que a documentacao oficial declara indisponivel para conta individual. A segunda metade e um bloco condicional que se explica quando ausente, nunca um erro.

### AD-011 - Remover o assistente de IA e montar viagem em SQL, substituindo a AD-010
**Data:** 2026-09-02
**Contexto:** A AD-010 apostou numa dependencia que quem opera o app precisa manter: uma chave da Anthropic ativa, com fatura, servindo cinco pessoas que nao veem a conta. O usuario decidiu que nao vai manter isso ("remova tudo isso que eu nao vou conseguir fazer") e pediu o que o assistente fazia de util -- montar a viagem inteira, o roteiro, o guia -- por SQL, com a SQL olhando para o sistema e se atualizando, terminando num arquivo que o proprio app importa.
**Decisao:** Sai o modulo inteiro: as 4 rotas `/api/assistente`, `lib/assistente.ts`, `lib/consumo.ts`, `lib/voz.ts`, os 5 componentes, `config/precos.ts`, a tabela `ai_usage`, o balde de rate limit proprio, `ANTHROPIC_API_KEY`/`ANTHROPIC_ADMIN_KEY`/`OPERADOR_EMAILS` e a dependencia `@anthropic-ai/sdk`. Entra `db/montar.sql`: uma funcao por secao do arquivo de importacao, montando um rascunho em jsonb e devolvendo o MESMO JSON que a tela ja aceita.
**Razao:** O que a AD-010 comprou de verdade nao foi o modelo, foi o CAMINHO -- uma forma de descrever a viagem inteira de uma vez, em vez de item por item na tela. Esse caminho nao precisa de modelo nenhum: precisa de uma superficie que aceite a viagem inteira e valide contra o contrato do app. SQL ja e a linguagem do banco que o projeto tem, custa zero dependencia e zero segredo novo, e roda offline em qualquer Postgres.
**Consequencia:** Quatro, todas deliberadas. (1) A SQL e GERADA de `SECOES_ARQUIVO` (novo em `lib/schema.ts`, e agora tambem a fonte do proprio `TripArquivoSchema`), e `lib/montar.test.ts` falha quando o arquivo commitado diverge do gerador -- e o que faz "a SQL olhar para o sistema". (2) `montar.*` nao escreve em tabela do app, de proposito: quem roda SQL tem a `DATABASE_URL` e ja esta acima de todo papel, entao um `select` de conveniencia ali publicaria passaporte alheio num jsonb que vira arquivo; quem le e `/api/export` (corta por papel), quem grava e `lib/importar.ts` (passa pela autorizacao). Uma gravadora em PL/pgSQL seria a segunda copia das regras. (3) `montar.conferir` faz o que o zod nao alcanca -- uma secao conferida contra a outra --, o que sobra de valor do "revisar antes de gravar" da AD-010, sem humano lendo proposta. (4) A defesa contra prompt injection deixa de ser necessaria: nao ha prompt.
**O que se perdeu, honestamente:** conversar sobre a viagem em linguagem natural no celular, e o resumo de guia de uma cidade escrito na hora. Nada disso volta por SQL. A skill `roteiro-trip-go` continua existindo para conversao de documentos no desktop -- a AD-011 nao a substitui.

## Handoff

**Fase atual:** Feature `checklist-inteligente` completa — 27/27 tarefas, Verifier independente com PASS na 2ª iteração (`.specs/features/checklist-inteligente/validation.md`). Branch `spec-checklist`, ~38 commits atômicos. Nada dado como `git push` ainda.
**Gates:** 178 testes unitários (`node --test`, +21 líquido: +29 novos, -8 de código morto removido) + `next build` limpo + sensor de discriminação (4/4 mutações mortas na 1ª iteração, 1/1 reconfirmada na 2ª).
**Estado do banco:** mesmo projeto Neon da viagem Europa 2027 real (`lucky-surf-81885593`). `checklist_items` migrada ao vivo: 11 colunas novas + 3 constraints (`checklist_pessoal_tem_dono` etc.), aplicada e conferida com `describe_table_schema`.
**Próximo passo:** revisar o diff e decidir sobre push/deploy — nada foi enviado ao remoto nesta sessão. `VERSAO` subiu de 3 para 4 em `lib/offline.ts` (cache antigo dos 5 participantes descarta sozinho no próximo carregamento).

**Bugs reais encontrados durante a execução, não por revisão:**
1. `app/api/mutate/route.ts` — o commit imediatamente anterior a esta sessão (`1a2c7c3`) tinha derrubado o `$` de dois placeholders parametrizados; `criar` de **qualquer** entidade do app quebrava com "bind message supplies N parameters, but prepared statement requires 0". Corrigido (`2aeddee`).
2. Array JS vazio como parâmetro de query perde o tipo do elemento — Postgres inferia `integer` em vez de `text[]` para `assigned_to: []`, e todo item `global` (o caso mais comum) falhava ao criar. Corrigido com cast `::text[]` explícito quando o valor é array.
3. `itinerary_events.ocorre_em` volta do `/api/snapshot` com sufixo `Z` e milissegundos; `parseData` (`lib/derive.ts`) não reconhece esse formato e devolve `null` em silêncio — afeta `proximoCompromisso`, `ordenarEventos`, `resumoDoDia` no app inteiro, não só checklist. **Não corrigido na raiz** (faltaria o mesmo `to_char` que `itinerary_days.dia` já usa); contornado localmente no painel de Dicas com `new Date(...)`. Registrado em `design.md` → Risks & Concerns da feature.
4. `VERSAO` do snapshot não tinha subido apesar de `checklist_items` ganhar 11 campos — pego pelo Verifier via edge case do spec, não por revisão de código nem pelos testes.
5. O checklist já vazava item pessoal para todo participante antes desta feature (`escopo: 'pessoal'` era só rótulo, sem filtro real na query nem no `/api/mutate`) — era o motivo da feature existir, não uma regressão dela.

**Não construído, e por quê:**
- Motor de diff/merge genérico para reconciliar roteiro/voos/hospedagens ao reimportar viagem existente — fora de escopo desta feature por decisão do usuário (ver spec Out of Scope). Checklist é aditivo porque é lista; entidades escalares (horário, endereço) precisam de outro desenho.
- Tombstone de sugestão de checklist rejeitada — decisão explícita de simplificar (`ponytail:` no código), reconsiderar se a skill repetir sugestão já recusada com frequência incômoda.
- Cobertura de teste automatizado para `checklistDaViagem`/`lib/db.ts` (o limite de privacidade, a razão de a feature existir) — consistente com o resto do repo (não existe `lib/db.test.ts` em lugar nenhum), mas é a linha mais sensível da feature sem nenhum teste que a defenda; o sensor do Verifier confirmou (mutante sobrevive). Considerar teste de integração contra um branch Neon descartável se este risco pesar.
- CRUD de escalas de voo e de portos do cruzeiro pela interface: as entidades existem no schema, na API e no `EditorSheet`, mas não há botão nas abas. Entram pela importação de JSON. Custo baixo de adicionar depois.
- Troca entre múltiplas viagens (ADM-07): o schema suporta, a UI não. Importar arquiva a anterior.
