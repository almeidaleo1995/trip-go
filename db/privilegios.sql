-- Papel de menor privilégio para a aplicação. OPCIONAL e idempotente, como todo
-- o resto de db/.
--
-- POR QUE ISTO EXISTE. Por padrão a `DATABASE_URL` do Neon aponta para
-- `neondb_owner`, que é dono do schema: ele pode `drop table`, `truncate`,
-- `alter`, ler `pg_authid` e criar outros papéis. Nada disso é necessário para
-- servir o app — as 14 rotas só fazem select/insert/update/delete — e cada uma
-- dessas permissões a mais é quanto custa um erro. É o mesmo raciocínio de
-- `exigirViagem` estar colado na fonte do dado em vez de só no proxy: a barreira
-- vale mais perto do que ela protege.
--
-- O que muda para o app: nada. As consultas são as mesmas; só o papel da string
-- de conexão troca.
--
-- COMO USAR (uma vez, com a conexão de OWNER):
--   psql "$DATABASE_URL" -v senha="'uma senha longa e aleatoria'" -f db/privilegios.sql
--   e depois aponte a DATABASE_URL da aplicação para tripgo_app.
--
-- A ORDEM IMPORTA: rode `npm run db:push` (que aplica db/schema.sql) ANTES deste
-- arquivo. Ele concede sobre as tabelas que existem; tabela criada depois entra
-- pelo `alter default privileges` no fim, que vale para o que o owner criar dali
-- em diante. Depois de cada `db:push` que crie tabela nova, rodar isto de novo é
-- barato e idempotente.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- o papel

-- `\gset` + `\if` e nao um bloco `do $$`: o psql NAO substitui `:'senha'` dentro
-- de texto entre cifroes, entao a versao com `do $$ ... execute format(...) $$`
-- morria com "syntax error at or near \":\"" e o arquivo inteiro nao rodava. A
-- decisao de criar ou realinhar sobe para o psql, onde a variavel existe.
select not exists (select 1 from pg_roles where rolname = 'tripgo_app') as criar \gset

\if :criar
create role tripgo_app login password :'senha';
\else
-- Ja existe: so realinha a senha, sem derrubar conexao de ninguem.
alter role tripgo_app login password :'senha';
\endif

-- `nocreatedb nocreaterole nosuperuser nobypassrls` é redundante para um papel
-- recém-criado (é o padrão), e está aqui de propósito: a linha documenta o que
-- este papel NÃO é, e realinha um papel que alguém tenha promovido à mão.
alter role tripgo_app nocreatedb nocreaterole nosuperuser noinherit nobypassrls;

-- ---------------------------------------------------------------- o que ele vê

-- Enxergar o schema, e nada de criar dentro dele. Sem o `revoke create`, qualquer
-- papel pode criar tabela em `public` — inclusive uma que sombreie uma existente.
grant usage on schema public to tripgo_app;
revoke create on schema public from tripgo_app;
revoke create on schema public from public;

-- As quatro operações do CRUD. NENHUMA de DDL: `drop`, `alter` e `truncate` ficam
-- com o owner, que é quem roda a migração. Um `delete from` errado apaga linhas e
-- o backup as traz de volta; um `drop table` leva a tabela e o histórico junto.
grant select, insert, update, delete on all tables in schema public to tripgo_app;

-- As sequências das colunas que se numeram sozinhas.
grant usage, select on all sequences in schema public to tripgo_app;

-- Nada de `execute` genérico em função: o app não chama procedure nenhuma.
revoke all on all functions in schema public from tripgo_app;

-- ---------------------------------------------------------------- o que vier depois

-- Tabela criada pelo owner a partir de agora já nasce concedida. Sem isto, a
-- primeira entidade nova do próximo `db:push` daria "permission denied" em
-- produção e passaria limpo em qualquer banco recém-criado — exatamente a classe
-- de falha que o CLAUDE.md descreve para o `alter table` esquecido na metade de
-- migrações.
alter default privileges in schema public
  grant select, insert, update, delete on tables to tripgo_app;
alter default privileges in schema public
  grant usage, select on sequences to tripgo_app;

-- ---------------------------------------------------------------- o que NÃO está aqui
--
-- ROW LEVEL SECURITY. A ausência é deliberada e vale a explicação, porque "ligar
-- RLS" é a recomendação genérica para todo app com Postgres.
--
-- RLS decide linha a linha usando a IDENTIDADE da conexão — ou o papel conectado,
-- ou uma variável de sessão (`current_setting('app.usuario_id')`) escrita por um
-- `set local` dentro da transação. Nenhum dos dois existe aqui:
--
--   1. A conexão é uma só, do processo servidor, e é a mesma para as cinco
--      pessoas da viagem. O papel conectado não diz quem está pedindo.
--   2. `lib/db.ts` usa o driver HTTP do Neon (`neon()`), em que CADA consulta é
--      uma requisição HTTP independente. `set local` não sobrevive à consulta
--      seguinte, então não há onde escrever "quem sou eu" antes do `select`.
--
-- Uma política escrita sobre uma variável que nunca é preenchida não protege
-- linha nenhuma: ou ela nega tudo e o app para, ou ela é permissiva e existe só
-- para o relatório dizer "RLS: ativado". O recorte real vive em `exigirViagem`,
-- em `financeiroDaViagem`/`documentosDaViagem` e no `via` de lib/escrita.ts, é
-- testado, e é o mesmo que uma política faria.
--
-- O caminho de upgrade, se um dia valer: trocar o driver HTTP pelo `Pool` sobre
-- WebSocket (`@neondatabase/serverless` já traz), abrir transação por requisição,
-- `set local app.usuario_id = <id da sessão>` no começo dela, e então as
-- políticas passam a ter o que ler. Custa uma conexão de verdade por requisição —
-- que é justamente o que o driver HTTP foi escolhido para não pagar.
