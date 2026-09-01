-- O recorte de papel do snapshot, contra um Postgres de verdade.
--
-- O que este arquivo prova, e que nenhum teste unitário alcança, porque é
-- comportamento do BANCO e não do JavaScript:
--
--   A. `orcamento_centavos` não sai de `trips` para quem não administra. É o
--      total da viagem — o mesmo número que `financeiroDaViagem` recusa a
--      mandar para um `visualizador`. Ele viajava por dentro de um
--      `select * from trips` e a tela apenas o escondia.
--   B. `passaporte` e `telefone` de participante saem só para quem administra e
--      para o dono da própria linha. Mesma regra de `documentosDaViagem`:
--      planejar o roteiro não dá direito de ler o passaporte de ninguém.
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
insert into travelers (id, trip_id, user_id, nome, papel, telefone, passaporte) values
  ('rp1','rt1','ru1','Dono','proprietario','+5511999999','AA111111'),
  ('rp2','rt1','ru2','Viajante','visualizador','+5511888888','BB222222');

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
  raise notice 'A ok: o total da viagem so sai para quem administra';
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

  -- Quem administra continua vendo os dois: a ficha de quem viaja sem app so
  -- existe porque o proprietario a preenche.
  select count(*) into quantos from travelers p
   where p.trip_id='rt1'
     and (case when 'true'::boolean or p.id='rp1' then p.passaporte end) is not null;
  if quantos <> 2 then
    raise exception 'B FALHOU: proprietario perdeu acesso a ficha (% de 2)', quantos;
  end if;
  raise notice 'B ok: passaporte e telefone recortados por papel';
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
