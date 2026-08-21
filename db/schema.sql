-- Planejador de Viagens em Grupo - schema completo.
-- Idempotente: rodar duas vezes seguidas nao gera erro. Aplicado por `npm run db:push`.
--
-- Duas convencoes de tempo, de proposito:
--   timestamp (sem timezone) -> hora LOCAL DO DESTINO, exatamente como esta no bilhete.
--                               Converter fuso num app usado offline em transito erra horario de voo.
--   timestamptz              -> tempo real de servidor (updated_at, criado_em), base do last-write-wins.
--
-- Dinheiro sempre em centavos como integer. Nunca float, nunca numeric.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- viagem

create table if not exists trips (
  id            text primary key default gen_random_uuid()::text,
  nome          text not null,
  subtitulo     text,
  data_partida  date not null,
  data_retorno  date not null,
  moeda         text not null default 'EUR',
  cor_destaque  text not null default '#0F766E',
  ativo         boolean not null default true,
  updated_at    timestamptz not null default now()
);

create table if not exists travelers (
  id          text primary key default gen_random_uuid()::text,
  trip_id     text not null references trips(id) on delete cascade,
  nome        text not null,
  papel       text not null default 'viajante' check (papel in ('admin', 'viajante')),
  pin_hash    text,
  telefone    text,
  passaporte  text,
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

-- ---------------------------------------------------------------- hospedagem

create table if not exists stays (
  id          text primary key default gen_random_uuid()::text,
  trip_id     text not null references trips(id) on delete cascade,
  nome        text not null,
  cidade      text,
  checkin     date,
  checkout    date,
  endereco    text,
  link        text,
  telefone    text,
  nota        text,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- lugares (alimenta o mapa da rota)

create table if not exists places (
  id          text primary key default gen_random_uuid()::text,
  trip_id     text not null references trips(id) on delete cascade,
  cidade      text not null,
  pais        text,
  dias        integer,
  notas       text,
  -- lat/lon opcionais: sem eles a cidade nao entra no mapa, mas a aba Lugares continua funcionando
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
  -- os PDFs do usuario trazem duas datas por item: a recomendada e o limite
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

create table if not exists documents (
  id          text primary key default gen_random_uuid()::text,
  trip_id     text not null references trips(id) on delete cascade,
  titulo      text not null,
  valor       text,
  tipo        text not null default 'texto' check (tipo in ('texto', 'link', 'telefone')),
  obs         text,
  ordem       integer not null default 0,
  updated_at  timestamptz not null default now()
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

-- ---------------------------------------------------------------- financeiro (so admin)

create table if not exists expense_categories (
  id          text primary key default gen_random_uuid()::text,
  trip_id     text not null references trips(id) on delete cascade,
  nome        text not null,
  ordem       integer not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists expenses (
  id             text primary key default gen_random_uuid()::text,
  trip_id        text not null references trips(id) on delete cascade,
  categoria_id   text references expense_categories(id) on delete set null,
  descricao      text not null,
  -- centavos, sempre. `pessoas` = quantas pessoas o valor por pessoa multiplica.
  valor_centavos integer not null default 0 check (valor_centavos >= 0),
  pessoas        integer not null default 1 check (pessoas >= 1),
  pago           boolean not null default false,
  estimado       boolean not null default true,
  nota           text,
  ordem          integer not null default 0,
  updated_at     timestamptz not null default now()
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

-- ---------------------------------------------------------------- indices

create index if not exists idx_travelers_trip           on travelers (trip_id);
create index if not exists idx_events_trip_quando       on itinerary_events (trip_id, ocorre_em);
create index if not exists idx_flights_trip             on flights (trip_id, ordem);
create index if not exists idx_flight_stops_flight      on flight_stops (flight_id, ordem);
create index if not exists idx_stays_trip               on stays (trip_id, checkin);
create index if not exists idx_places_trip              on places (trip_id, ordem);
create index if not exists idx_cruises_trip             on cruises (trip_id);
create index if not exists idx_cruise_ports_cruise      on cruise_ports (cruise_id, ordem);
create index if not exists idx_checklist_items_trip     on checklist_items (trip_id, ordem);
create index if not exists idx_checklist_state_traveler on checklist_state (traveler_id);
create index if not exists idx_documents_trip           on documents (trip_id, ordem);
create index if not exists idx_emergency_trip           on emergency_contacts (trip_id, ordem);
create index if not exists idx_expense_categories_trip  on expense_categories (trip_id, ordem);
create index if not exists idx_expenses_trip            on expenses (trip_id, categoria_id);
create index if not exists idx_change_log_trip          on change_log (trip_id, criado_em desc);
