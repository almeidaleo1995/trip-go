-- O recorte de papel do snapshot, contra um Postgres de verdade.
--
-- O que este arquivo prova, e que nenhum teste unitário alcança, porque é
-- comportamento do BANCO e não do JavaScript:
--
--   A. `orcamento_centavos` não sai de `trips` para quem não administra. É o
--      total da viagem — o mesmo número que `financeiroDaViagem` recusa a
--      mandar para um `visualizador`. Ele viajava por dentro de um
--      `select * from trips` e a tela apenas o escondia.
--   B. `passaporte` e `telefone` de participante saem só para o PROPRIETÁRIO e
--      para o dono da própria linha. Mesma regra de `documentosDaViagem`:
--      planejar o roteiro não dá direito de ler o passaporte de ninguém.
--   B2. E um EDITOR também não os lê. Os dois limiares desta consulta são
--      diferentes de propósito: o orçamento corta em `editor` (o corte do
--      dinheiro, de `financeiroDaViagem`) e o passaporte em `proprietario` (o
--      corte do documento). Reusar um pelo outro foi o erro que este bloco pega.
--   D. A entrega de documentacao: um `visualizador` ve o ESTADO de todo mundo
--      (quem ja cumpriu o requisito do pais) e o VALOR de ninguem -- nem numero,
--      nem validade, nem o comentario da revisao. Esta linha AFROUXOU de
--      proposito: antes ele so via as proprias entregas. O bloco existe para
--      fixar ate ONDE ela afrouxou, porque a parte que continua fechada e a que
--      nao tem como ser testada olhando a tela.
--   C. O `case when $1::boolean` funciona com o booleano chegando como TEXTO,
--      que é como o driver HTTP do Neon manda parâmetro. Se essa coerção
--      falhasse, o snapshot inteiro quebraria — toda tela do app.
--
-- Como rodar (Postgres local, banco descartável):
--   createdb tripgo_teste
--   psql -d tripgo_teste -f db/schema.sql
--   psql -d tripgo_teste -v ON_ERROR_STOP=1 -f db/teste-recorte.sql
--
-- Sai com erro no primeiro `assert` que falhar.

begin;

insert into users (id, nome, email, senha_hash) values
  ('ru1','Dono','dono@ex.com','x'),
  ('ru2','Viajante','viajante@ex.com','x');
insert into trips (id, owner_id, nome, data_partida, data_retorno, orcamento_centavos)
  values ('rt1','ru1','Viagem de teste','2027-06-01','2027-06-10', 1820000);
insert into users (id, nome, email, senha_hash) values ('ru3','Coorg','coorg@ex.com','x');
insert into travelers (id, trip_id, user_id, nome, papel, telefone, passaporte) values
  ('rp1','rt1','ru1','Dono','proprietario','+5511999999','AA111111'),
  ('rp2','rt1','ru2','Viajante','visualizador','+5511888888','BB222222'),
  ('rp3','rt1','ru3','Coorganizador','editor','+5511777777','CC333333');

-- As duas consultas exatamente como `getSnapshot` em lib/db.ts as monta. O
-- booleano entra como texto de propósito: é o que o driver do Neon envia.
prepare viagem (boolean, text) as
  select nome, case when $1::boolean then orcamento_centavos end as orcamento_centavos
  from trips where id = $2;

prepare gente (boolean, text, text) as
  select p.id, p.nome, p.papel,
         case when $1::boolean or p.id = $3 then p.telefone end as telefone,
         case when $1::boolean or p.id = $3 then p.passaporte end as passaporte
  from travelers p left join users u on u.id = p.user_id
  where p.trip_id = $2 order by p.ordem, p.nome;

-- ---------------------------------------------------------------- A
\echo 'A. o orcamento da viagem nao sai para visualizador'

do $$
declare orc bigint;
begin
  select orcamento_centavos into orc
    from (select case when 'false'::boolean then orcamento_centavos end as orcamento_centavos
          from trips where id='rt1') q;
  if orc is not null then
    raise exception 'A FALHOU: visualizador recebeu o orcamento da viagem (%)', orc;
  end if;

  select orcamento_centavos into orc
    from (select case when 'true'::boolean then orcamento_centavos end as orcamento_centavos
          from trips where id='rt1') q;
  if orc is distinct from 1820000 then
    raise exception 'A FALHOU: quem administra perdeu o orcamento (veio %)', orc;
  end if;
  raise notice 'A ok: o total da viagem so sai para quem administra (editor para cima)';
end $$;

-- ---------------------------------------------------------------- B
\echo 'B. passaporte de participante so para quem administra ou para o dono'

do $$
declare passa text; quantos int;
begin
  -- O visualizador rp2 olhando a lista: ve o proprio, nao ve o do dono.
  select (case when 'false'::boolean or p.id='rp2' then p.passaporte end) into passa
    from travelers p where p.id='rp1';
  if passa is not null then
    raise exception 'B FALHOU: visualizador leu o passaporte do dono (%)', passa;
  end if;

  select (case when 'false'::boolean or p.id='rp2' then p.passaporte end) into passa
    from travelers p where p.id='rp2';
  if passa is distinct from 'BB222222' then
    raise exception 'B FALHOU: a pessoa perdeu o proprio passaporte (veio %)', passa;
  end if;

  -- Telefone segue a mesma regra: e dado de contato da ficha, nao da viagem.
  select count(*) into quantos from travelers p
   where p.trip_id='rt1'
     and (case when 'false'::boolean or p.id='rp2' then p.telefone end) is not null;
  if quantos <> 1 then
    raise exception 'B FALHOU: visualizador viu % telefones, esperado 1', quantos;
  end if;

  -- O PROPRIETARIO continua vendo todos: a ficha de quem viaja sem app so existe
  -- porque ele a preenche.
  select count(*) into quantos from travelers p
   where p.trip_id='rt1'
     and (case when 'true'::boolean or p.id='rp1' then p.passaporte end) is not null;
  if quantos <> 3 then
    raise exception 'B FALHOU: proprietario perdeu acesso a ficha (% de 3)', quantos;
  end if;
  raise notice 'B ok: passaporte e telefone recortados por papel';
end $$;

-- ---------------------------------------------------------------- B2
\echo 'B2. um EDITOR tambem nao le o passaporte alheio'

do $$
declare passa text; quantos int;
begin
  -- O limiar aqui e `proprietario`, nao `editor`. E o erro que a primeira versao
  -- deste recorte cometeu: reusou o corte do DINHEIRO (`financeiroDaViagem`, onde
  -- editor recebe a forma de admin) para o corte do DOCUMENTO. Sao regras
  -- diferentes -- `documentosDaViagem`, `documentacaoDaViagem` e o
  -- `documentoVisivel` de /api/documento usam `proprietario`, e a razao esta
  -- escrita no CLAUDE.md: editar o roteiro nao da direito de ler passaporte.
  --
  -- Um co-organizador e o caso COMUM, nao o exotico: e para isso que o papel
  -- 'editor' existe. Este bloco e a diferenca entre o vazamento e a correcao.
  select (case when 'false'::boolean or p.id='rp3' then p.passaporte end) into passa
    from travelers p where p.id='rp1';
  if passa is not null then
    raise exception 'B2 FALHOU: editor leu o passaporte do dono (%)', passa;
  end if;

  select (case when 'false'::boolean or p.id='rp3' then p.passaporte end) into passa
    from travelers p where p.id='rp2';
  if passa is not null then
    raise exception 'B2 FALHOU: editor leu o passaporte do visualizador (%)', passa;
  end if;

  -- Mas o proprio continua vindo: o editor guarda a propria ficha.
  select count(*) into quantos from travelers p
   where p.trip_id='rt1'
     and (case when 'false'::boolean or p.id='rp3' then p.passaporte end) is not null;
  if quantos <> 1 then
    raise exception 'B2 FALHOU: editor viu % passaportes, esperado 1 (o proprio)', quantos;
  end if;
  raise notice 'B2 ok: editor ve so o proprio passaporte';
end $$;

-- ---------------------------------------------------------------- D
\echo 'D. um visualizador ve o estado da entrega alheia, nunca o valor'

insert into document_requirements (id, trip_id, nome, pais, exige_numero, exige_validade)
  values ('rr1','rt1','Passaporte','Espanha', true, true);
insert into document_submissions (id, requirement_id, traveler_id, numero, validade, comentario)
  values ('rs1','rr1','rp1','AA111111','2031-04-02','conferido no balcao'),
         ('rs2','rr1','rp2','BB222222','2029-08-15',null);

do $$
declare linha record; quantas int; proprio text;
begin
  -- A consulta exatamente como `documentacaoDaViagem` a monta para quem NAO
  -- revisa. `rp2` e o visualizador olhando a linha do dono (`rp1`).
  select
    case when s.traveler_id='rp2' then s.numero end     as numero,
    case when s.traveler_id='rp2' then s.validade end   as validade,
    case when s.traveler_id='rp2' then s.comentario end as comentario,
    (s.validade is not null)    as tem_validade,
    (s.documento_id is not null) as tem_arquivo,
    s.status
  into linha
  from document_submissions s
  join document_requirements r on r.id = s.requirement_id
  where r.trip_id='rt1' and s.traveler_id='rp1';

  if linha.numero is not null then
    raise exception 'D FALHOU: visualizador leu o numero alheio (%)', linha.numero;
  end if;
  if linha.validade is not null then
    raise exception 'D FALHOU: visualizador leu a validade alheia (%)', linha.validade;
  end if;
  if linha.comentario is not null then
    raise exception 'D FALHOU: visualizador leu o comentario da revisao alheia (%)', linha.comentario;
  end if;

  -- E o que ele PRECISA ver continua vindo. Sem `tem_validade`, `faltando()`
  -- leria "sem data, logo falta a validade" e marcaria como pendente justamente
  -- quem ja cumpriu -- a redacao de privacidade virando bug de status, que e o
  -- mesmo motivo pelo qual `tem_arquivo` existe.
  if linha.tem_validade is not true then
    raise exception 'D FALHOU: o booleano da validade nao saiu, e o dono virou pendente';
  end if;
  if linha.status is null then
    raise exception 'D FALHOU: o estado da entrega alheia nao saiu';
  end if;

  -- Ele ve as DUAS linhas, nao so a propria: e essa a mudanca.
  select count(*) into quantas
    from document_submissions s
    join document_requirements r on r.id = s.requirement_id
   where r.trip_id='rt1';
  if quantas <> 2 then
    raise exception 'D FALHOU: visualizador viu % entregas, esperado 2', quantas;
  end if;

  -- E a propria linha vem inteira: o corte e por DONO, nao um apagao geral.
  select case when s.traveler_id='rp2' then s.numero end into proprio
    from document_submissions s where s.traveler_id='rp2';
  if proprio is null then
    raise exception 'D FALHOU: visualizador perdeu o numero do proprio documento';
  end if;

  raise notice 'D ok: estado de todo mundo, valor de ninguem';
end $$;

-- `passaporte_validade` e o unico VALOR do resumo de perfil, e ele NAO afrouxou:
-- continua cortado em `editor` ou dono da linha, com o booleano ao lado.
do $$
declare validade text; preenchida boolean;
begin
  select case when 'false'::boolean or p.id='rp2'
              then to_char(u.passaporte_validade, 'YYYY-MM-DD') end,
         (u.passaporte_validade is not null)
    into validade, preenchida
    from travelers p left join users u on u.id = p.user_id where p.id='rp1';

  if validade is not null then
    raise exception 'D FALHOU: visualizador leu a validade do perfil alheio (%)', validade;
  end if;
  raise notice 'D ok: a validade do perfil alheio continua fechada';
end $$;

-- ---------------------------------------------------------------- C
\echo 'C. o booleano chega como TEXTO e as duas consultas continuam de pe'

-- O que se prova aqui nao e o recorte, e que as consultas EXECUTAM com o
-- parametro vindo como texto -- que e como o driver HTTP do Neon manda um
-- booleano. `case when $1` sem o `::boolean` depende de inferencia, e inferencia
-- que falha nao devolve dado errado: derruba o snapshot, ou seja, toda tela.
execute viagem('false', 'rt1');
execute viagem('true', 'rt1');
execute gente('false', 'rt1', 'rp2');
execute gente('true', 'rt1', 'rp1');

\echo 'C ok: as duas consultas do snapshot executam com booleano em texto'

rollback;
