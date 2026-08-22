-- TripGo - schema completo. Idempotente: rodar duas vezes seguidas nao gera erro.
-- Aplicado por `npm run db:push`.
--
-- O arquivo tem duas metades:
--   1. `create table if not exists` com a definicao FINAL  -> banco novo nasce pronto
--   2. `alter table ... if exists` na secao de migracoes    -> banco antigo alcanca a nova
-- As duas convergem no mesmo estado. Nunca edite so a primeira.
--
-- Duas convencoes de tempo, de proposito:
--   timestamp (sem timezone) -> hora LOCAL DO DESTINO, exatamente como esta no bilhete.
--                               Converter fuso num app usado offline em transito erra horario de voo.
--   timestamptz              -> tempo real de servidor (updated_at, criado_em), base do last-write-wins.
--
-- Dinheiro sempre em centavos como integer. Nunca float, nunca numeric.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- contas

-- Uma conta de pessoa, independente de viagem. E o que a sessao identifica.
-- Papel NAO vive aqui: uma pessoa e proprietaria de uma viagem e visualizadora
-- de outra, entao papel e propriedade do vinculo (tabela `travelers`).
create table if not exists users (
  id          text primary key default gen_random_uuid()::text,
  nome        text not null,
  -- guardado sempre em minusculas; o unique e a garantia de "e-mail nao duplicado"
  email       text not null unique,
  senha_hash  text not null,
  avatar_url  text,
  telefone    text,
  -- preferencias da pessoa, validas em qualquer viagem
  moeda_preferida text not null default 'BRL',
  notificacoes    boolean not null default true,
  criado_em   timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- viagem

create table if not exists trips (
  id            text primary key default gen_random_uuid()::text,
  owner_id      text references users(id) on delete cascade,
  nome          text not null,
  subtitulo     text,
  descricao     text,
  data_partida  date not null,
  data_retorno  date not null,
  moeda         text not null default 'BRL',
  cor_destaque  text not null default '#0F766E',
  capa_url      text,
  arquivada     boolean not null default false,
  updated_at    timestamptz not null default now()
);

-- Participante da viagem. Duas naturezas no mesmo registro, de proposito:
--   com `user_id`  -> tem conta, entra no app e enxerga esta viagem
--   sem `user_id`  -> so um nome na lista (crianca, quem nao quer conta)
-- Sem isso, "adicionar participante" exigiria criar conta para todo mundo.
create table if not exists travelers (
  id          text primary key default gen_random_uuid()::text,
  trip_id     text not null references trips(id) on delete cascade,
  user_id     text references users(id) on delete set null,
  nome        text not null,
  email       text,
  papel       text not null default 'visualizador'
              check (papel in ('proprietario', 'editor', 'visualizador')),
  telefone    text,
  passaporte  text,
  -- CPF ou RG, documento nacional -- diferente de `passaporte` (documento de viagem internacional)
  documento   text,
  nascimento  date,
  ordem       integer not null default 0,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- roteiro

create table if not exists itinerary_events (
  id          text primary key default gen_random_uuid()::text,
  trip_id     text not null references trips(id) on delete cascade,
  ocorre_em   timestamp not null,
  cidade      text,
  local       text,
  titulo      text not null,
  descricao   text,
  -- tipo alimenta o badge colorido da linha do tempo
  tipo        text not null default 'passeio'
              check (tipo in ('voo', 'hospedagem', 'cruzeiro', 'passeio', 'traslado', 'documento', 'refeicao')),
  ancora      boolean not null default false,
  nota        text,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- voos

create table if not exists flights (
  id              text primary key default gen_random_uuid()::text,
  trip_id         text not null references trips(id) on delete cascade,
  companhia       text not null,
  numero          text,
  origem_iata     text,
  origem_cidade   text,
  destino_iata    text,
  destino_cidade  text,
  parte_em        timestamp,
  chega_em        timestamp,
  duracao_min     integer,
  localizador     text,
  terminal        text,
  portao          text,
  assento         text,
  bagagem         text,
  nota            text,
  ordem           integer not null default 0,
  updated_at      timestamptz not null default now()
);

create table if not exists flight_stops (
  id          text primary key default gen_random_uuid()::text,
  flight_id   text not null references flights(id) on delete cascade,
  iata        text,
  cidade      text,
  espera_min  integer,
  ordem       integer not null default 0,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- reservas

-- Uma tabela para tudo que se reserva. O brief lista Hotel e Reservation como
-- modelos separados; hospedagem e uma reserva com check-in e check-out, e manter
-- duas tabelas com os mesmos oito campos duplicaria formulario, tela e query.
-- `tipo` faz a distincao, e a aba Reservas agrupa por ele.
create table if not exists reservations (
  id             text primary key default gen_random_uuid()::text,
  trip_id        text not null references trips(id) on delete cascade,
  tipo           text not null default 'hospedagem'
                 check (tipo in ('hospedagem', 'restaurante', 'passeio', 'ingresso', 'carro', 'transporte', 'outro')),
  nome           text not null,
  cidade         text,
  -- hospedagem usa os dois; um jantar usa so o inicio
  inicio_em      timestamp,
  fim_em         timestamp,
  endereco       text,
  link           text,
  telefone       text,
  localizador    text,
  valor_centavos integer check (valor_centavos is null or valor_centavos >= 0),
  nota           text,
  ordem          integer not null default 0,
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------- cidades (alimenta o mapa da rota)

create table if not exists places (
  id          text primary key default gen_random_uuid()::text,
  trip_id     text not null references trips(id) on delete cascade,
  cidade      text not null,
  pais        text,
  dias        integer,
  status      text not null default 'planejada' check (status in ('planejada', 'visitada')),
  chega_em    date,
  sai_em      date,
  notas       text,
  -- lat/lon opcionais: sem eles a cidade nao entra no mapa, mas a aba continua funcionando
  lat         numeric(8, 5),
  lon         numeric(8, 5),
  ordem       integer not null default 0,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- cruzeiro

create table if not exists cruises (
  id                 text primary key default gen_random_uuid()::text,
  trip_id            text not null references trips(id) on delete cascade,
  navio              text not null,
  companhia          text,
  embarque_em        timestamp,
  desembarque_em     timestamp,
  porto_embarque     text,
  porto_desembarque  text,
  cabine             text,
  localizador        text,
  terminal           text,
  nota               text,
  updated_at         timestamptz not null default now()
);

create table if not exists cruise_ports (
  id          text primary key default gen_random_uuid()::text,
  cruise_id   text not null references cruises(id) on delete cascade,
  porto       text,
  cidade      text,
  pais        text,
  chega_em    timestamp,
  sai_em      timestamp,
  dia_no_mar  boolean not null default false,
  ordem       integer not null default 0,
  nota        text,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- checklist

create table if not exists checklist_items (
  id                      text primary key default gen_random_uuid()::text,
  trip_id                 text not null references trips(id) on delete cascade,
  titulo                  text not null,
  categoria               text,
  escopo                  text not null default 'global' check (escopo in ('global', 'pessoal')),
  -- duas datas por item: a recomendada e o limite
  prazo_ideal             date,
  prazo_maximo            date,
  valor_estimado_centavos integer check (valor_estimado_centavos is null or valor_estimado_centavos >= 0),
  detalhe                 text,
  ordem                   integer not null default 0,
  updated_at              timestamptz not null default now()
);

create table if not exists checklist_state (
  traveler_id  text not null references travelers(id) on delete cascade,
  item_id      text not null references checklist_items(id) on delete cascade,
  feito        boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (traveler_id, item_id)
);

-- ---------------------------------------------------------------- documentos e emergencia

-- `valor` guarda o conteudo curto (numero do passaporte, telefone, link).
-- `arquivo_url` guarda o ponteiro para o arquivo quando existir upload. As duas
-- colunas coexistem porque a maioria dos "documentos" de viagem e um numero, nao
-- um PDF - e obrigar upload para guardar um numero de apolice seria pior.
create table if not exists documents (
  id             text primary key default gen_random_uuid()::text,
  trip_id        text not null references trips(id) on delete cascade,
  traveler_id    text references travelers(id) on delete set null,
  titulo         text not null,
  valor          text,
  tipo           text not null default 'texto' check (tipo in ('texto', 'link', 'telefone', 'arquivo')),
  categoria      text,
  arquivo_url    text,
  arquivo_mime   text,
  arquivo_bytes  integer,
  obs            text,
  ordem          integer not null default 0,
  updated_at     timestamptz not null default now()
);

create table if not exists emergency_contacts (
  id          text primary key default gen_random_uuid()::text,
  trip_id     text not null references trips(id) on delete cascade,
  titulo      text not null,
  telefone    text,
  detalhe     text,
  ordem       integer not null default 0,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- financeiro

create table if not exists expense_categories (
  id          text primary key default gen_random_uuid()::text,
  trip_id     text not null references trips(id) on delete cascade,
  nome        text not null,
  ordem       integer not null default 0,
  updated_at  timestamptz not null default now()
);

-- Uma despesa da viagem.
--
-- Tres papeis diferentes convivem aqui, e confundi-los e o erro classico deste
-- modulo:
--   `traveler_id`  -> quem PAGOU o fornecedor (adiantou o dinheiro pelo grupo)
--   `expense_shares` -> quem DEVE arcar com ela, e com quanto
--   `payments`     -> quem REEMBOLSOU quem
--
-- `valor_centavos` e o valor TOTAL da despesa, nunca o valor por pessoa. Ate a
-- versao 2 do formato ele guardava o valor por pessoa e `pessoas` multiplicava;
-- a secao de migracoes converte e derruba a coluna.
create table if not exists expenses (
  id             text primary key default gen_random_uuid()::text,
  trip_id        text not null references trips(id) on delete cascade,
  categoria_id   text references expense_categories(id) on delete set null,
  -- quem pagou o fornecedor. Null = ninguem adiantou (despesa so prevista).
  traveler_id    text references travelers(id) on delete set null,
  descricao      text not null,
  valor_centavos integer not null default 0 check (valor_centavos >= 0),
  moeda          text,
  ocorre_em      date,
  -- como o valor foi repartido entre os participantes
  divisao        text not null default 'igual'
                 check (divisao in ('igual', 'peso', 'personalizado')),
  estimado       boolean not null default true,
  nota           text,
  ordem          integer not null default 0,
  updated_at     timestamptz not null default now()
);

-- Quem arca com a despesa. Uma linha por participante que entra nela.
--
-- `peso` e quantas partes a pessoa assume: um casal que paga por dois e peso 2.
-- Isso representa casal, crianca meia-entrada e quem so entrou num pedaco sem
-- precisar de uma entidade "casal" no modelo.
--
-- `valor_centavos` e o resultado ja resolvido - guardado, nao recalculado na
-- leitura, para que a soma das partes continue batendo com o total mesmo depois
-- de alguem sair da viagem.
create table if not exists expense_shares (
  id             text primary key default gen_random_uuid()::text,
  expense_id     text not null references expenses(id) on delete cascade,
  traveler_id    text not null references travelers(id) on delete cascade,
  peso           integer not null default 1 check (peso >= 0),
  valor_centavos integer not null default 0 check (valor_centavos >= 0),
  updated_at     timestamptz not null default now(),
  unique (expense_id, traveler_id)
);

-- Parcela de uma despesa. A vista e uma parcela unica: toda despesa tem pelo
-- menos uma linha aqui, para vencimento, atraso e quitacao terem um lugar so.
--
-- `pago_centavos` e quanto ja foi pago AO FORNECEDOR. Reembolso entre pessoas e
-- outra coisa e mora em `payments`.
create table if not exists installments (
  id             text primary key default gen_random_uuid()::text,
  expense_id     text not null references expenses(id) on delete cascade,
  numero         integer not null check (numero >= 1),
  vence_em       date,
  valor_centavos integer not null default 0 check (valor_centavos >= 0),
  pago_centavos  integer not null default 0 check (pago_centavos >= 0),
  pago_em        date,
  updated_at     timestamptz not null default now(),
  unique (expense_id, numero)
);

-- Reembolso de uma pessoa para outra. Nao e a despesa: e o dinheiro voltando
-- para quem adiantou.
--
-- `parcela_id` amarra o reembolso a uma parcela especifica, e e o que permite
-- dizer "pago 150 de 300 desta parcela". Nulo = acerto avulso no fim da viagem,
-- que entra no saldo sem se referir a nenhuma despesa.
create table if not exists payments (
  id             text primary key default gen_random_uuid()::text,
  trip_id        text not null references trips(id) on delete cascade,
  de_id          text references travelers(id) on delete set null,
  para_id        text references travelers(id) on delete set null,
  parcela_id     text references installments(id) on delete set null,
  valor_centavos integer not null default 0 check (valor_centavos >= 0),
  ocorre_em      date,
  referencia     text,
  nota           text,
  criado_em      timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------- mensagens e avisos

create table if not exists messages (
  id          text primary key default gen_random_uuid()::text,
  trip_id     text not null references trips(id) on delete cascade,
  user_id     text references users(id) on delete set null,
  texto       text not null,
  criado_em   timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists notifications (
  id          text primary key default gen_random_uuid()::text,
  user_id     text not null references users(id) on delete cascade,
  trip_id     text references trips(id) on delete cascade,
  titulo      text not null,
  texto       text,
  href        text,
  lida        boolean not null default false,
  criado_em   timestamptz not null default now()
);

-- ---------------------------------------------------------------- historico de alteracoes

create table if not exists change_log (
  id           text primary key default gen_random_uuid()::text,
  trip_id      text not null references trips(id) on delete cascade,
  traveler_id  text references travelers(id) on delete set null,
  entidade     text not null,
  entidade_id  text,
  campo        text,
  de           text,
  para         text,
  criado_em    timestamptz not null default now()
);

-- ================================================================ migracoes
-- Levam um banco da versao anterior (viagem unica, login por PIN) ate aqui.
-- Em banco novo todas sao no-op, porque as colunas ja nasceram acima.

alter table trips     add column if not exists owner_id   text references users(id) on delete cascade;
alter table trips     add column if not exists descricao  text;
alter table trips     add column if not exists capa_url   text;
alter table trips     add column if not exists arquivada  boolean not null default false;

-- Preferências da conta. Ficam em `users`, não em `travelers`: são da pessoa,
-- não do vínculo com uma viagem — a moeda preferida vale em todas elas.
alter table users     add column if not exists telefone         text;
alter table users     add column if not exists moeda_preferida  text not null default 'BRL';
alter table users     add column if not exists notificacoes     boolean not null default true;

alter table travelers add column if not exists user_id    text references users(id) on delete set null;
alter table travelers add column if not exists email      text;
alter table travelers add column if not exists documento  text;
alter table travelers add column if not exists nascimento date;

alter table flights   add column if not exists terminal   text;
alter table flights   add column if not exists portao     text;
alter table flights   add column if not exists assento    text;
alter table flights   add column if not exists bagagem    text;

alter table places    add column if not exists status     text not null default 'planejada';
alter table places    add column if not exists chega_em   date;
alter table places    add column if not exists sai_em     date;

alter table documents add column if not exists traveler_id   text references travelers(id) on delete set null;
alter table documents add column if not exists categoria     text;
alter table documents add column if not exists arquivo_url   text;
alter table documents add column if not exists arquivo_mime  text;
alter table documents add column if not exists arquivo_bytes integer;

alter table expenses  add column if not exists traveler_id text references travelers(id) on delete set null;
alter table expenses  add column if not exists moeda       text;
alter table expenses  add column if not exists ocorre_em   date;

-- Orcamento previsto da viagem, para o cartao "Total previsto". Fica nulo ate
-- alguem definir: a tela convida a preencher em vez de exibir um zero que
-- parece numero real.
alter table trips     add column if not exists orcamento_centavos integer;

-- ---------------------------------------------------------------- despesa v3
--
-- O modelo de despesa deixou de ser "valor POR PESSOA x pessoas" e passou a ser
-- "valor TOTAL + quem divide (expense_shares) + quando vence (installments)".
--
-- A conversao roda UMA vez: `divisao` nula e a marca de linha ainda nao
-- convertida, e a propria conversao a preenche. Rodar o arquivo de novo nao
-- multiplica valor nenhum, que e o unico jeito de uma migracao de dinheiro ser
-- idempotente de verdade.
alter table expenses  add column if not exists divisao text;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'expenses' and column_name = 'pessoas') then
    update expenses
       set valor_centavos = valor_centavos * greatest(pessoas, 1),
           divisao = 'igual'
     where divisao is null;
  end if;

  -- Toda despesa passa a ter pelo menos uma parcela. O `pago` booleano antigo
  -- vira "parcela unica quitada" — sem isto, o que ja estava pago voltaria a
  -- aparecer como em aberto.
  if exists (select 1 from information_schema.columns
             where table_name = 'expenses' and column_name = 'pago') then
    insert into installments (expense_id, numero, vence_em, valor_centavos, pago_centavos, pago_em)
    select e.id, 1, e.ocorre_em, e.valor_centavos,
           case when e.pago then e.valor_centavos else 0 end,
           case when e.pago then e.ocorre_em end
      from expenses e
     where not exists (select 1 from installments i where i.expense_id = e.id);
  end if;
end $$;

-- As linhas antigas nao sabem QUEM dividia a despesa (o modelo so guardava
-- quantas pessoas). Nao inventamos participante: a despesa fica sem divisao, a
-- tela a marca como "a dividir" e ninguem passa a dever um valor que nao foi
-- decidido por uma pessoa.
alter table expenses  drop column if exists pessoas;
alter table expenses  drop column if exists pago;

update expenses set divisao = 'igual' where divisao is null;
alter table expenses alter column divisao set default 'igual';
alter table expenses alter column divisao set not null;
alter table expenses drop constraint if exists expenses_divisao_check;
alter table expenses add  constraint expenses_divisao_check
  check (divisao in ('igual', 'peso', 'personalizado'));

-- `ativo` (viagem unica ativa) vira `arquivada` (varias viagens, algumas guardadas).
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'trips' and column_name = 'ativo') then
    update trips set arquivada = not ativo;
    alter table trips drop column ativo;
  end if;
end $$;

-- Papeis: o par admin/viajante vira a escala de tres do compartilhamento.
do $$
begin
  if exists (select 1 from travelers where papel in ('admin', 'viajante')) then
    alter table travelers drop constraint if exists travelers_papel_check;
    update travelers set papel = case papel
      when 'admin'    then 'proprietario'
      when 'viajante' then 'visualizador'
      else papel end;
  end if;
end $$;

alter table travelers drop constraint if exists travelers_papel_check;
alter table travelers add  constraint travelers_papel_check
  check (papel in ('proprietario', 'editor', 'visualizador'));
alter table travelers alter column papel set default 'visualizador';

-- `stays` vira `reservations` com tipo = 'hospedagem'. Copia antes de derrubar;
-- rodar de novo nao duplica porque a tabela de origem ja nao existe.
do $$
begin
  if to_regclass('public.stays') is not null then
    insert into reservations (id, trip_id, tipo, nome, cidade, inicio_em, fim_em,
                              endereco, link, telefone, nota, updated_at)
    select id, trip_id, 'hospedagem', nome, cidade, checkin::timestamp, checkout::timestamp,
           endereco, link, telefone, nota, updated_at
    from stays
    on conflict (id) do nothing;
    drop table stays;
  end if;
end $$;

-- O PIN de 4 digitos foi substituido pela senha da conta em `users`.
alter table travelers drop column if exists pin_hash;

-- ---------------------------------------------------------------- indices

create index if not exists idx_users_email             on users (email);
create index if not exists idx_trips_owner             on trips (owner_id, arquivada);
create index if not exists idx_travelers_trip          on travelers (trip_id);
create index if not exists idx_travelers_user          on travelers (user_id);
create index if not exists idx_events_trip_quando      on itinerary_events (trip_id, ocorre_em);
create index if not exists idx_flights_trip            on flights (trip_id, ordem);
create index if not exists idx_flight_stops_flight     on flight_stops (flight_id, ordem);
create index if not exists idx_reservations_trip       on reservations (trip_id, tipo, inicio_em);
create index if not exists idx_places_trip             on places (trip_id, ordem);
create index if not exists idx_cruises_trip            on cruises (trip_id);
create index if not exists idx_cruise_ports_cruise     on cruise_ports (cruise_id, ordem);
create index if not exists idx_checklist_items_trip    on checklist_items (trip_id, ordem);
create index if not exists idx_checklist_state_travel  on checklist_state (traveler_id);
create index if not exists idx_documents_trip          on documents (trip_id, ordem);
create index if not exists idx_emergency_trip          on emergency_contacts (trip_id, ordem);
create index if not exists idx_expense_categories_trip on expense_categories (trip_id, ordem);
create index if not exists idx_expenses_trip           on expenses (trip_id, categoria_id);
create index if not exists idx_expense_shares_expense  on expense_shares (expense_id);
create index if not exists idx_expense_shares_traveler on expense_shares (traveler_id);
create index if not exists idx_installments_expense    on installments (expense_id, numero);
create index if not exists idx_installments_vence      on installments (vence_em);
create index if not exists idx_payments_trip           on payments (trip_id, ocorre_em desc);
create index if not exists idx_payments_de             on payments (de_id);
create index if not exists idx_messages_trip           on messages (trip_id, criado_em desc);
create index if not exists idx_notifications_user      on notifications (user_id, lida, criado_em desc);
create index if not exists idx_change_log_trip         on change_log (trip_id, criado_em desc);
