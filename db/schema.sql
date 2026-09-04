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
  -- Fuso IANA do destino ("Europe/Madrid"). Nulo = usar o relogio do aparelho,
  -- que e o certo em transito: o celular troca de fuso sozinho ao pousar. So a
  -- tela HOJE le isto, e so para saber que horas sao LA quando se planeja daqui.
  fuso          text,
  cor_destaque  text not null default '#0F766E',
  capa_url      text,
  arquivada     boolean not null default false,
  -- Codigo do convite: o que separa "sei o e-mail de um participante" de "posso
  -- entrar nesta viagem". Quem se cadastra em /register informa este codigo para
  -- que `vincularParticipantesPorEmail` ligue a conta a linha de `travelers` que
  -- tem aquele e-mail. Sem ele, o endereco de e-mail SOZINHO era a credencial da
  -- vaga -- e o dono digita esse endereco no app muito antes da pessoa se cadastrar.
  --
  -- `gen_random_uuid()` e nao `random()`: isto e uma credencial, e `random()` nao
  -- e gerador criptografico. Dez hexadecimais dao 40 bits, que e o suficiente para
  -- um segredo combinado por WhatsApp entre cinco pessoas e curto o bastante para
  -- ser ditado por telefone.
  codigo_convite text not null unique
                 default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
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

-- Um dia da viagem. A linha existe SO quando alguem escreveu algo sobre o dia
-- (titulo, resumo, alerta, ritual de sair ou dormir) -- a lista de dias em si e
-- derivada de trips.data_partida..data_retorno e nao precisa de linha nenhuma
-- aqui. Por isso a tela faz upsert por (trip_id, dia) e nunca "cria os dias" ao
-- criar a viagem: uma viagem de 17 dias sem anotacao tem zero linhas.
create table if not exists itinerary_days (
  id            text primary key default gen_random_uuid()::text,
  trip_id       text not null references trips(id) on delete cascade,
  dia           date not null,
  titulo        text,
  cidade        text,
  pais          text,
  resumo        text,
  -- dia-ancora: embarque, troca de cidade, retorno. Ganha destaque no seletor.
  ancora        boolean not null default false,
  -- as tres listas abaixo sao UM ITEM POR LINHA. Uma tabela filha por lista daria
  -- tres entidades, tres editores e tres round-trips de export para guardar frases.
  alertas       text,
  antes_sair    text,
  antes_dormir  text,
  -- "Rotulo|https://..." por linha; sem barra, a url vira o proprio rotulo
  links         text,
  -- link externo do mapa do dia (Google Maps, Citymapper). Sem ele a secao some.
  mapa_url      text,
  updated_at    timestamptz not null default now(),
  unique (trip_id, dia)
);

create table if not exists itinerary_events (
  id          text primary key default gen_random_uuid()::text,
  trip_id     text not null references trips(id) on delete cascade,
  ocorre_em   timestamp not null,
  fim_em      timestamp,
  cidade      text,
  local       text,
  endereco    text,
  -- lat/lon opcionais, igual a places: sem eles o botao "ver no mapa" some
  lat         numeric(8, 5),
  lon         numeric(8, 5),
  titulo      text not null,
  descricao   text,
  -- tipo alimenta o badge colorido e o icone da linha do tempo
  tipo        text not null default 'passeio'
              check (tipo in ('voo', 'trem', 'onibus', 'traslado', 'caminhada', 'cruzeiro',
                              'hospedagem', 'local', 'passeio', 'ponto', 'restaurante',
                              'refeicao', 'compras', 'evento', 'tarefa', 'compromisso',
                              'dica', 'observacao', 'documento')),
  ancora      boolean not null default false,
  -- o DESLOCAMENTO ATE AQUI, nao a partir daqui. Fica no item de destino porque
  -- e assim que se le um roteiro: "para chegar no Speicherstadt, 850 m a pe".
  distancia_m  integer check (distancia_m is null or distancia_m >= 0),
  duracao_min  integer check (duracao_min is null or duracao_min >= 0),
  transporte   text,
  como_chegar  text,
  -- uma dica por linha
  dicas        text,
  -- "Rotulo|https://..." por linha
  links        text,
  -- custo ESTIMADO deste item. Despesa de verdade mora em `expenses` e nao e
  -- espelhada aqui: misturar estimativa com gasto registrado e o erro do modulo.
  custo_centavos integer check (custo_centavos is null or custo_centavos >= 0),
  -- reserva_id e documento_id nao moram aqui: `reservations` e `documents` sao
  -- criadas mais abaixo neste arquivo, e uma referencia para frente quebra o
  -- db:push num banco novo. As duas colunas entram na secao de migracoes.
  nota        text,
  ordem       integer not null default 0,
  updated_at  timestamptz not null default now()
);

-- Como chegar: as opcoes de transporte de UM deslocamento (a pe / metro / taxi).
-- Tabela filha pelo mesmo motivo de flight_stops: sao varias por item, cada uma
-- com quatro campos, e uma marcada como recomendada.
create table if not exists itinerary_options (
  id           text primary key default gen_random_uuid()::text,
  event_id     text not null references itinerary_events(id) on delete cascade,
  modo         text not null default 'a_pe'
               check (modo in ('a_pe', 'metro', 'onibus', 'trem', 'taxi', 'carro', 'barco', 'aviao')),
  duracao_min  integer check (duracao_min is null or duracao_min >= 0),
  distancia_m  integer check (distancia_m is null or distancia_m >= 0),
  -- faixa de preco em texto ("30-40 EUR"), nao centavos: estimativa de guia, nao despesa
  custo        text,
  detalhe      text,
  recomendado  boolean not null default false,
  ordem        integer not null default 0,
  updated_at   timestamptz not null default now()
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
  -- lat/lon opcionais, igual a places e itinerary_events: sem eles o hotel ainda
  -- aparece no mapa, mas herdando o centro da cidade e marcado como aproximado
  lat            numeric(8, 5),
  lon            numeric(8, 5),
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
  -- mesma regra de places: sem coordenada a escala herda o centro da cidade
  lat         numeric(8, 5),
  lon         numeric(8, 5),
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
  -- donos do item; vazio = todos. So faz sentido preenchido em escopo pessoal ou
  -- para destacar responsabilidade num item global (ver constraint abaixo).
  assigned_to             text[] not null default '{}',
  prioridade              text not null default 'importante'
                            check (prioridade in ('obrigatorio', 'importante', 'recomendado', 'opcional')),
  pais                    text,
  cidade                  text,
  itinerary_event_id      text references itinerary_events(id) on delete set null,
  flight_id               text references flights(id) on delete set null,
  cruise_id               text references cruises(id) on delete set null,
  -- sugestao da skill ainda nao revisada pelo admin
  pendente                boolean not null default false,
  fonte_tipo              text check (fonte_tipo is null or fonte_tipo in ('documento', 'pesquisa', 'sugestao', 'manual')),
  fonte_detalhe           text,
  fonte_consultado_em     date,
  updated_at              timestamptz not null default now(),
  constraint checklist_pessoal_tem_dono check (escopo <> 'pessoal' or array_length(assigned_to, 1) > 0)
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
  -- dono do documento pessoal (o passaporte do Leonardo). Nulo = documento do grupo.
  traveler_id    text references travelers(id) on delete set null,
  titulo         text not null,
  valor          text,
  tipo           text not null default 'texto' check (tipo in ('texto', 'link', 'telefone', 'arquivo')),
  categoria      text check (categoria is null or categoria in
                   ('pessoal', 'passaporte', 'seguro', 'voo', 'trem', 'onibus', 'hospedagem',
                    'reserva', 'ingresso', 'transfer', 'financeiro', 'saude', 'emergencia', 'outro')),
  arquivo_url    text,
  -- nome ORIGINAL do arquivo ("Reserva_Hotel_Madrid.pdf"). Diferente de `titulo`,
  -- que e como a pessoa chama o documento na tela.
  arquivo_nome   text,
  arquivo_mime   text,
  arquivo_bytes  integer,
  obs            text,
  ordem          integer not null default 0,

  -- ---------------- cofre ----------------
  -- Quem enxerga. Mesmo vocabulario de checklist_items de proposito: 'global' e
  -- do grupo, 'pessoal' e de `traveler_id` (mais quem estiver em assigned_to, mais
  -- o proprietario). A leitura e recortada na QUERY, nao escondida na tela.
  escopo         text not null default 'global' check (escopo in ('global', 'pessoal')),
  -- compartilhamento extra de um documento pessoal; vazio = so o dono.
  assigned_to    text[] not null default '{}',
  tags           text[] not null default '{}',
  importante     boolean not null default false,
  -- INTENCAO de estar disponivel offline, nao o estado do cache. Se ESTE aparelho
  -- ja baixou o arquivo e coisa do IndexedDB (lib/offline.ts), nao do servidor:
  -- o mesmo documento pode estar baixado no celular e nao no notebook.
  offline        boolean not null default false,
  validade       date,

  -- vinculos com a viagem. Todos opcionais: um seguro vale a viagem inteira,
  -- um cartao de embarque vale um voo. Mesmos nomes de coluna de checklist_items.
  pais               text,
  cidade             text,
  dia                date,
  itinerary_event_id text references itinerary_events(id) on delete set null,
  flight_id          text references flights(id) on delete set null,
  -- cobre hospedagem tambem: `stays` virou `reservations` com tipo = 'hospedagem'.
  reservation_id     text references reservations(id) on delete set null,

  criado_por     text references travelers(id) on delete set null,
  criado_em      timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint documento_pessoal_tem_dono check (escopo <> 'pessoal' or traveler_id is not null)
);

-- Os BYTES do arquivo, em tabela separada de proposito.
--
-- `documents` inteira vai para o snapshot a cada carga da tela e fica em cache no
-- IndexedDB. Um `select *` que arrastasse PDFs junto tornaria a primeira pintura
-- do app impagavel e estouraria a cota do navegador. Aqui so se le por
-- /api/documento, um id por vez, sob demanda.
--
-- bytea e o passo 1 de `DocumentStorage`: guardar o arquivo no mesmo lugar que ja
-- tem backup, transacao e autorizacao. Trocar por um bucket depois mexe nesta
-- tabela e na rota, nao na tela.
create table if not exists document_files (
  document_id text primary key references documents(id) on delete cascade,
  bytes       bytea not null,
  mime        text not null,
  criado_em   timestamptz not null default now()
);

-- ---------------------------------------------------------------- documentacao exigida

-- O QUE cada pessoa precisa TER para esta viagem. E o oposto de `documents`:
-- `documents` guarda o que ja existe, isto guarda a exigencia -- e uma exigencia
-- vale mesmo quando ninguem cumpriu ainda (que e justamente o caso interessante).
--
-- Pertence a VIAGEM: Europa 2027 exige passaporte e seguro; um bate-volta a
-- Buenos Aires exige RG. Por isso a lista nao e fixa no codigo.
create table if not exists document_requirements (
  id             text primary key default gen_random_uuid()::text,
  trip_id        text not null references trips(id) on delete cascade,
  nome           text not null,
  descricao      text,
  categoria      text,
  -- false = recomendado. A pessoa ve o item, mas ele nao conta como pendencia
  -- que trava a viagem, e o painel do admin o separa do que e obrigatorio.
  obrigatorio    boolean not null default true,
  -- true  -> vale para todos os participantes, inclusive quem entrar depois
  -- false -> vale so para quem estiver em `assigned_to`
  -- Duas colunas em vez de "lista vazia = todos" porque as duas coisas existem:
  -- um requisito recem-criado sem ninguem marcado nao e "de todo mundo".
  aplica_todos   boolean not null default true,
  assigned_to    text[] not null default '{}',
  -- O que precisa ser entregue. Os tres podem coexistir (passaporte pede numero,
  -- validade e foto) ou vir sozinhos (CPF pede so o numero).
  exige_numero   boolean not null default false,
  exige_validade boolean not null default false,
  exige_arquivo  boolean not null default false,
  -- Liga o requisito a um campo do PERFIL da conta, em vez de pedir o dado de
  -- novo a cada viagem: 'cpf' e o mesmo CPF em toda viagem que o exigir. Nulo =
  -- o dado vive so na entrega desta viagem. Ver `CAMPOS_PERFIL` em lib/documentacao.ts.
  campo_perfil   text,
  -- Data limite para ENVIAR (§21). Diferente da validade do documento (§22):
  -- um passaporte valido ate 2031 ainda pode estar atrasado para entrega.
  prazo          date,
  -- O pais que EXIGE este documento. NULO = a viagem inteira exige, que e o
  -- comportamento de sempre -- por isso a coluna nasce nula e nenhum requisito
  -- ja cadastrado muda de sentido ao ganha-la.
  --
  -- Texto livre, e nao um country_code ISO, pela mesma razao que places.pais,
  -- itinerary_days.pais, cruise_ports.pais e checklist_items.pais ja sao texto:
  -- um quinto vocabulario para a mesma coisa e como o app passa a ter duas
  -- cabecas. `requisitosDoPais` (lib/documentacao.ts) casa sem acento e sem caixa.
  pais           text,
  obs            text,
  ordem          integer not null default 0,
  criado_por     text references travelers(id) on delete set null,
  criado_em      timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint requisito_pessoal_tem_dono
    check (aplica_todos or array_length(assigned_to, 1) > 0)
);

-- A ENTREGA de um requisito por uma pessoa: o dado, o arquivo e a revisao.
--
-- Entrega e revisao na MESMA linha de proposito. Sao duas tabelas na teoria e um
-- fato so na pratica -- "o passaporte da Ana" tem um estado, nao um historico de
-- estados que alguem consulte. Quem quiser o historico ja o tem: toda mudanca
-- passa por /api/mutate e cai em `change_log`.
--
-- Uma linha por (requisito, pessoa). A linha SO EXISTE depois que alguem mexeu:
-- pendente e a ausencia da linha, nao um valor gravado -- senao criar um
-- requisito exigiria escrever cinco linhas e mante-las em dia a cada participante
-- que entra ou sai.
create table if not exists document_submissions (
  id             text primary key default gen_random_uuid()::text,
  requirement_id text not null references document_requirements(id) on delete cascade,
  traveler_id    text not null references travelers(id) on delete cascade,
  -- o DADO documental (§5): numero da apolice, do passaporte, do CPF
  numero         text,
  validade       date,
  emitido_em     date,
  -- o ARQUIVO, quando houver. Aponta para o cofre em vez de duplicar bytes:
  -- o passaporte anexado aqui e o mesmo que aparece em "Meus documentos".
  documento_id   text references documents(id) on delete set null,
  -- 'pendente' quase nunca e gravado (a ausencia da linha ja diz isso); ele
  -- existe para o caso de alguem limpar uma entrega sem apagar a linha.
  status         text not null default 'enviado'
                 check (status in ('pendente', 'enviado', 'aprovado', 'rejeitado', 'correcao')),
  -- o que o revisor escreveu ao pedir correcao ou rejeitar (§25)
  comentario     text,
  revisado_por   text references travelers(id) on delete set null,
  revisado_em    timestamptz,
  enviado_em     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (requirement_id, traveler_id)
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
  -- quem ORIGINOU a escrita. `traveler_id` continua sendo quem assina; esta coluna
  -- diz se a pessoa digitou na tela (`pessoa`) ou se a linha entrou por um lote da
  -- skill roteiro-trip-go (`skill`), que monta a viagem fora do app e grava pelo
  -- MESMO `autorizar`/`aplicar`. `assistente` e o valor de um modulo que nao existe
  -- mais -- ele fica na lista porque esta GRAVADO em historico de viagem em uso, e
  -- um check que o recusasse quebraria duplicar viagem e reimportar backup, os dois
  -- caminhos que RE-INSEREM linha antiga. Ver `Marca` em lib/escrita.ts.
  origem       text not null default 'pessoa'
               check (origem in ('pessoa', 'skill', 'assistente')),
  -- agrupa as linhas gravadas de uma vez. E o que torna um lote desfazivel: saber
  -- quais vieram juntas so e possivel se for gravado na hora. Sem ele, desfazer o
  -- que a skill acabou de subir seria linha por linha, na mao.
  lote         text,
  criado_em    timestamptz not null default now()
);

-- ---------------------------------------------------------------- limite de tentativas
--
-- O contador do rate limit, no BANCO e nao na memoria do processo.
--
-- Em memoria ele funcionava numa maquina so. Na Vercel cada instancia serverless
-- tinha o seu contador, entao dez instancias davam dez vezes o limite -- e quem
-- ataca senha nao precisa de mais do que isso. O que estava escrito como
-- `ponytail:` em lib/session.ts era exatamente esta tabela.
--
-- Uma linha por chave (`login:1.2.3.4`, `cadastro:1.2.3.4`, `escrita:<userId>`).
-- `tentativas` guarda os instantes dentro da janela; `bloqueado_ate` o fim do
-- castigo. Duas colunas em vez de um contador porque a janela e DESLIZANTE: um
-- inteiro nao sabe quais das dez tentativas ja envelheceram.
create table if not exists rate_limit (
  chave          text primary key,
  tentativas     timestamptz[] not null default '{}',
  bloqueado_ate  timestamptz,
  atualizado_em  timestamptz not null default now()
);

-- Conta uma tentativa e diz se ela passou do limite, ATOMICAMENTE.
--
-- O `for update` e o ponto inteiro desta funcao. Sem ele, duas instancias leem o
-- mesmo contador, cada uma soma 1 e grava, e o limite vale o dobro -- que e o
-- mesmo furo do contador em memoria, so que mais dificil de enxergar. Ler,
-- decidir e gravar acontecem sob a trava da linha, numa ida so ao banco.
--
-- Idempotente: `create or replace` roda de novo sem erro, como o resto do arquivo.
create or replace function registrar_tentativa(
  p_chave    text,
  p_limite   integer,
  p_janela   interval,
  p_bloqueio interval
) returns table (bloqueado boolean, restam_ms bigint)
language plpgsql as $$
declare
  v_ate      timestamptz;
  v_recentes timestamptz[];
begin
  -- Faxina oportunista: 1% das chamadas varre o que ja nao vale. A tabela e
  -- limitada por chaves distintas (IPs e contas), entao cresce devagar -- mas
  -- "devagar" sem limite ainda e sem limite.
  if random() < 0.01 then
    delete from rate_limit
     where atualizado_em < now() - interval '1 day'
       and (bloqueado_ate is null or bloqueado_ate < now());
  end if;

  insert into rate_limit (chave) values (p_chave) on conflict (chave) do nothing;
  select bloqueado_ate, tentativas into v_ate, v_recentes
    from rate_limit where chave = p_chave for update;

  -- Ja de castigo: nao acumula tentativa nova. Sem isto, quem insiste durante o
  -- bloqueio empurraria o fim dele para sempre.
  if v_ate is not null and v_ate > now() then
    return query select true, (extract(epoch from (v_ate - now())) * 1000)::bigint;
    return;
  end if;

  -- Descarta o que saiu da janela deslizante e conta esta tentativa.
  v_recentes := array(select t from unnest(v_recentes) t where t > now() - p_janela) || now();

  if array_length(v_recentes, 1) > p_limite then
    update rate_limit
       set tentativas = '{}', bloqueado_ate = now() + p_bloqueio, atualizado_em = now()
     where chave = p_chave;
    return query select true, (extract(epoch from p_bloqueio) * 1000)::bigint;
    return;
  end if;

  update rate_limit
     set tentativas = v_recentes, bloqueado_ate = null, atualizado_em = now()
   where chave = p_chave;
  return query select false, 0::bigint;
end $$;

-- ================================================================ migracoes
-- Levam um banco da versao anterior (viagem unica, login por PIN) ate aqui.
-- Em banco novo todas sao no-op, porque as colunas ja nasceram acima.

-- O consumo da API de IA sai junto com o modulo que o escrevia. A tabela guardava
-- CONTAGEM DE TOKEN de um assistente que nao existe mais -- nao ha dado de viagem
-- nem de pessoa nela, e nenhum codigo a consulta. Deixa-la de pe seria pior do que
-- apaga-la: a proxima pessoa a ler o schema nao teria como saber se ela esta viva.
drop table if exists ai_usage;

-- Origem e lote do change_log num banco que ja existe: ele nao ve o bloco `create`
-- acima. Sem estas duas linhas, uma escrita estoura com "column origem does not
-- exist" em producao e passa limpo em banco novo -- o pior par de resultados.
--
-- `assistente` fica na lista mesmo sem o modulo que o escrevia: o valor esta
-- GRAVADO em historico de viagem em uso, e um check que o recusasse faria falhar
-- justamente os caminhos que RE-INSEREM linha antiga (duplicar viagem, importar
-- backup) -- 500 em banco em uso e verde em banco novo, que e o pior par.
alter table change_log add column if not exists origem text not null default 'pessoa';
alter table change_log add column if not exists lote   text;
alter table change_log drop constraint if exists change_log_origem_check;
alter table change_log add  constraint change_log_origem_check
  check (origem in ('pessoa', 'skill', 'assistente')) not valid;

alter table trips     add column if not exists owner_id   text references users(id) on delete cascade;
alter table trips     add column if not exists descricao  text;
alter table trips     add column if not exists capa_url   text;
alter table trips     add column if not exists arquivada  boolean not null default false;

-- Codigo do convite num banco que ja existe. Em TRES passos, e nao num
-- `add column ... not null default`, porque o preenchimento das linhas antigas e
-- o ponto: uma viagem sem codigo trancaria para fora todo participante que ainda
-- nao se cadastrou -- e as viagens reais ja estao no ar com gente por cadastrar.
-- Depender do rewrite de tabela avaliar um default volatil por linha e uma aposta
-- em detalhe de versao do Postgres; o `update` explicito nao deixa duvida.
alter table trips add column if not exists codigo_convite text;
update trips set codigo_convite = substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)
 where codigo_convite is null;
alter table trips alter column codigo_convite
      set default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
alter table trips alter column codigo_convite set not null;
create unique index if not exists trips_codigo_convite_key on trips (codigo_convite);

-- Preferências da conta. Ficam em `users`, não em `travelers`: são da pessoa,
-- não do vínculo com uma viagem — a moeda preferida vale em todas elas.
alter table users     add column if not exists telefone         text;
alter table users     add column if not exists moeda_preferida  text not null default 'BRL';

-- Fuso do destino, para a tela HOJE saber que horas sao la (ver bloco `trips`).
alter table trips     add column if not exists fuso             text;
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

-- ---------------------------------------------------------------- roteiro por dia

alter table itinerary_events add column if not exists fim_em         timestamp;
alter table itinerary_events add column if not exists endereco       text;
alter table itinerary_events add column if not exists lat            numeric(8, 5);
alter table itinerary_events add column if not exists lon            numeric(8, 5);
alter table itinerary_events add column if not exists distancia_m    integer;
alter table itinerary_events add column if not exists duracao_min    integer;
alter table itinerary_events add column if not exists transporte     text;
alter table itinerary_events add column if not exists como_chegar    text;
alter table itinerary_events add column if not exists dicas          text;
alter table itinerary_events add column if not exists links          text;
alter table itinerary_events add column if not exists custo_centavos integer;
alter table itinerary_events add column if not exists reserva_id     text references reservations(id) on delete set null;
alter table itinerary_events add column if not exists documento_id   text references documents(id) on delete set null;
alter table itinerary_events add column if not exists ordem          integer not null default 0;

-- ---------------------------------------------------------------- coordenadas do mapa
--
-- O mapa da viagem mostra hotel e porto como categoria propria, e as duas
-- tabelas nasceram sem onde guardar isso. Sem estas colunas o pino do hotel cai
-- no centro da cidade (marcado `aproximado` na tela, nunca disfarcado) -- o que
-- ja e o comportamento correto, e por isso as colunas sao opcionais: elas
-- MELHORAM o mapa, nao sao condicao para ele existir.
--
-- Precisa estar aqui e nao so no `create table`: um banco em uso ja tem as duas
-- tabelas, e a metade de cima nao encosta em tabela existente.
alter table reservations add column if not exists lat numeric(8, 5);
alter table reservations add column if not exists lon numeric(8, 5);
alter table cruise_ports add column if not exists lat numeric(8, 5);
alter table cruise_ports add column if not exists lon numeric(8, 5);

-- O check de `tipo` cresceu de 7 para 19 valores. Trocar a constraint e o unico
-- caminho: `check` nao aceita `if not exists`, e a antiga recusaria 'restaurante'.
alter table itinerary_events drop constraint if exists itinerary_events_tipo_check;
alter table itinerary_events add  constraint itinerary_events_tipo_check
  check (tipo in ('voo', 'trem', 'onibus', 'traslado', 'caminhada', 'cruzeiro',
                  'hospedagem', 'local', 'passeio', 'ponto', 'restaurante',
                  'refeicao', 'compras', 'evento', 'tarefa', 'compromisso',
                  'dica', 'observacao', 'documento'));

-- ---------------------------------------------------------------- checklist inteligente

alter table checklist_items add column if not exists assigned_to         text[] not null default '{}';
alter table checklist_items add column if not exists prioridade          text not null default 'importante';
alter table checklist_items add column if not exists pais                text;
alter table checklist_items add column if not exists cidade              text;
alter table checklist_items add column if not exists itinerary_event_id  text references itinerary_events(id) on delete set null;
alter table checklist_items add column if not exists flight_id           text references flights(id) on delete set null;
alter table checklist_items add column if not exists cruise_id           text references cruises(id) on delete set null;
alter table checklist_items add column if not exists pendente            boolean not null default false;
alter table checklist_items add column if not exists fonte_tipo          text;
alter table checklist_items add column if not exists fonte_detalhe       text;
alter table checklist_items add column if not exists fonte_consultado_em date;

alter table checklist_items drop constraint if exists checklist_items_prioridade_check;
alter table checklist_items add  constraint checklist_items_prioridade_check
  check (prioridade in ('obrigatorio', 'importante', 'recomendado', 'opcional'));

alter table checklist_items drop constraint if exists checklist_items_fonte_tipo_check;
alter table checklist_items add  constraint checklist_items_fonte_tipo_check
  check (fonte_tipo is null or fonte_tipo in ('documento', 'pesquisa', 'sugestao', 'manual'));

alter table checklist_items drop constraint if exists checklist_pessoal_tem_dono;
alter table checklist_items add  constraint checklist_pessoal_tem_dono
  check (escopo <> 'pessoal' or array_length(assigned_to, 1) > 0);

-- ---------------------------------------------------------------- cofre de documentos

-- `documents` deixou de ser so "numero da apolice" e passou a guardar tambem o
-- ARQUIVO e o contexto dele na viagem. As colunas antigas continuam valendo: a
-- maioria dos documentos de viagem ainda e um numero, e obrigar upload para
-- guardar um localizador seria pior.
alter table documents add column if not exists arquivo_nome       text;
alter table documents add column if not exists escopo             text not null default 'global';
alter table documents add column if not exists assigned_to        text[] not null default '{}';
alter table documents add column if not exists tags               text[] not null default '{}';
alter table documents add column if not exists importante         boolean not null default false;
alter table documents add column if not exists offline            boolean not null default false;
alter table documents add column if not exists validade           date;
alter table documents add column if not exists pais               text;
alter table documents add column if not exists cidade             text;
alter table documents add column if not exists dia                date;
alter table documents add column if not exists itinerary_event_id text references itinerary_events(id) on delete set null;
alter table documents add column if not exists flight_id          text references flights(id) on delete set null;
alter table documents add column if not exists reservation_id     text references reservations(id) on delete set null;
alter table documents add column if not exists criado_por         text references travelers(id) on delete set null;
alter table documents add column if not exists criado_em          timestamptz not null default now();

-- Documento que ja existia continua 'global' mesmo com traveler_id preenchido:
-- ate agora `traveler_id` so dizia "de quem e o passaporte", e todo mundo via a
-- linha. Marcar tudo como pessoal aqui SUMIRIA com documentos das telas alheias
-- sem ninguem ter pedido. Quem quiser privar um documento marca na tela.
-- `not valid` de proposito, e nao por preguica.
--
-- `categoria` sempre foi texto livre: um banco em uso ja tem linhas com valores
-- fora desta lista. Uma constraint normal VALIDA as linhas existentes na hora de
-- criar, entao ela falharia e derrubaria o db:push inteiro por causa de uma
-- palavra digitada meses atras — e a saida seria apagar o que a pessoa escreveu.
--
-- `not valid` deixa passar o que ja esta gravado e passa a exigir a lista em
-- todo INSERT e UPDATE dali em diante. A tela le categoria por `fichaCategoria`
-- (lib/cofre.ts), que mostra o valor legado como rotulo em tom neutro em vez de
-- quebrar. Para exigir a lista tambem do passado, depois de limpar os dados:
--   alter table documents validate constraint documents_categoria_check;
alter table documents drop constraint if exists documents_categoria_check;
alter table documents add  constraint documents_categoria_check
  check (categoria is null or categoria in
           ('pessoal', 'passaporte', 'seguro', 'voo', 'trem', 'onibus', 'hospedagem',
            'reserva', 'ingresso', 'transfer', 'financeiro', 'saude', 'emergencia', 'outro'))
  not valid;

-- `arquivo` como tipo e a razao de o cofre existir, e o `create table` acima ja o
-- lista -- mas um banco que nasceu antes disso continua com a constraint velha, e
-- todo upload morre em 500 com `documents_tipo_check`. O erro so aparece em banco
-- EM USO, que e onde ele custa caro: um `db:push` num banco novo passa limpo e da
-- a impressao de que esta tudo certo.
--
-- Constraint normal (nao `not valid`, ao contrario de `documents_categoria_check`
-- logo acima): esta so AMPLIA o conjunto permitido, entao toda linha ja gravada
-- passa na validacao e nao ha o que quebrar ao criar.
alter table documents drop constraint if exists documents_tipo_check;
alter table documents add  constraint documents_tipo_check
  check (tipo in ('texto', 'link', 'telefone', 'arquivo'));

alter table documents drop constraint if exists documents_escopo_check;
alter table documents add  constraint documents_escopo_check
  check (escopo in ('global', 'pessoal'));

alter table documents drop constraint if exists documento_pessoal_tem_dono;
alter table documents add  constraint documento_pessoal_tem_dono
  check (escopo <> 'pessoal' or traveler_id is not null);

-- Checklist aponta para documento: "Conferir seguro viagem" abre a apolice.
alter table checklist_items  add column if not exists documento_id text references documents(id) on delete set null;

-- ---------------------------------------------------------------- documentacao exigida

-- Dados de viagem da PESSOA, nao do participante: o CPF e o mesmo em toda viagem.
-- Ficam em `users` pelo mesmo motivo que `moeda_preferida` fica: sao da conta.
-- Quem viaja sem conta (crianca) nao tem perfil, e por isso `document_submissions`
-- guarda numero e validade tambem -- ver `valorDoPerfil` em lib/documentacao.ts.
alter table users add column if not exists nome_completo        text;
alter table users add column if not exists nome_social          text;
alter table users add column if not exists nascimento           date;
alter table users add column if not exists cpf                  text;
alter table users add column if not exists rg                   text;
alter table users add column if not exists nacionalidade        text;
alter table users add column if not exists passaporte_numero    text;
alter table users add column if not exists passaporte_nome      text;
alter table users add column if not exists passaporte_emissao   date;
alter table users add column if not exists passaporte_validade  date;
alter table users add column if not exists passaporte_pais      text;
alter table users add column if not exists emergencia_nome      text;
alter table users add column if not exists emergencia_telefone  text;
alter table users add column if not exists emergencia_parentesco text;

alter table document_requirements add column if not exists pais text;

alter table document_requirements drop constraint if exists requisito_pessoal_tem_dono;
alter table document_requirements add  constraint requisito_pessoal_tem_dono
  check (aplica_todos or array_length(assigned_to, 1) > 0);

alter table document_submissions drop constraint if exists document_submissions_status_check;
alter table document_submissions add  constraint document_submissions_status_check
  check (status in ('pendente', 'enviado', 'aprovado', 'rejeitado', 'correcao'));

-- Uma entrega por pessoa por requisito. Sem isto, dois toques no botao de salvar
-- em conexao ruim gravariam duas entregas e o painel contaria a pessoa duas vezes.
create unique index if not exists idx_submissions_unicas
  on document_submissions (requirement_id, traveler_id);

-- ---------------------------------------------------------------- indices

create index if not exists idx_users_email             on users (email);
create index if not exists idx_trips_owner             on trips (owner_id, arquivada);
create index if not exists idx_travelers_trip          on travelers (trip_id);
create index if not exists idx_travelers_user          on travelers (user_id);
create index if not exists idx_events_trip_quando      on itinerary_events (trip_id, ocorre_em);
create index if not exists idx_events_ordem            on itinerary_events (trip_id, ocorre_em, ordem);
create index if not exists idx_itinerary_days_trip     on itinerary_days (trip_id, dia);
create index if not exists idx_itinerary_options_event on itinerary_options (event_id, ordem);
create index if not exists idx_flights_trip            on flights (trip_id, ordem);
create index if not exists idx_flight_stops_flight     on flight_stops (flight_id, ordem);
create index if not exists idx_reservations_trip       on reservations (trip_id, tipo, inicio_em);
create index if not exists idx_places_trip             on places (trip_id, ordem);
create index if not exists idx_cruises_trip            on cruises (trip_id);
create index if not exists idx_cruise_ports_cruise     on cruise_ports (cruise_id, ordem);
create index if not exists idx_checklist_items_trip    on checklist_items (trip_id, ordem);
create index if not exists idx_checklist_state_travel  on checklist_state (traveler_id);
create index if not exists idx_documents_trip          on documents (trip_id, ordem);
create index if not exists idx_documents_dia           on documents (trip_id, dia);
create index if not exists idx_documents_evento        on documents (itinerary_event_id);
create index if not exists idx_documents_voo           on documents (flight_id);
create index if not exists idx_documents_reserva       on documents (reservation_id);
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
create index if not exists idx_doc_req_trip           on document_requirements (trip_id, ordem);
create index if not exists idx_doc_sub_req            on document_submissions (requirement_id);
create index if not exists idx_doc_sub_traveler       on document_submissions (traveler_id);
create index if not exists idx_doc_sub_documento      on document_submissions (documento_id);
create index if not exists idx_change_log_lote       on change_log (trip_id, lote);
create index if not exists idx_rate_limit_faxina    on rate_limit (atualizado_em);
