-- Testes do assistente contra um Postgres de verdade.
--
-- O que este arquivo prova, e que nenhum teste unitário alcança, porque é
-- comportamento do BANCO e não do JavaScript:
--
--   A. O desfazer precisa ler o change_log de trás para frente. Com duas
--      edições no mesmo campo, a ordem crescente restaura o valor
--      INTERMEDIÁRIO — um bug silencioso que devolve dado errado.
--   B. Uma remoção não tem desfazer, e o cascade leva os filhos junto. É o
--      teto documentado no README, aqui demonstrado em vez de afirmado.
--   C. O check `not valid` em change_log.origem tolera linha antiga e recusa
--      INSERT novo — o comportamento que a seção de migrações depende.
--
-- Como rodar (Postgres local, banco descartável):
--   createdb tripgo_teste
--   psql -d tripgo_teste -f db/schema.sql
--   psql -d tripgo_teste -v ON_ERROR_STOP=1 -f db/teste-assistente.sql
--
-- Sai com erro no primeiro `assert` que falhar.

begin;

insert into users (id, nome, email, senha_hash) values ('tu1','Teste','teste@ex.com','x');
insert into trips (id, owner_id, nome, data_partida, data_retorno)
  values ('tt1','tu1','Viagem de teste','2027-06-01','2027-06-10');
insert into travelers (id, trip_id, user_id, nome, papel)
  values ('tp1','tt1','tu1','Teste','proprietario');

-- ---------------------------------------------------------------- A
\echo 'A. ordem do replay do desfazer'

insert into itinerary_events (id,trip_id,ocorre_em,titulo,cidade)
  values ('te1','tt1','2027-06-04 10:00','Museu','Paris');
insert into change_log (trip_id,traveler_id,entidade,entidade_id,campo,de,para,origem,lote,criado_em)
  values ('tt1','tp1','roteiro','te1','cidade','Paris','Lyon','assistente','TL1', now());
update itinerary_events set cidade='Lyon' where id='te1';
insert into change_log (trip_id,traveler_id,entidade,entidade_id,campo,de,para,origem,lote,criado_em)
  values ('tt1','tp1','roteiro','te1','cidade','Lyon','Nice','assistente','TL1', now() + interval '1 second');
update itinerary_events set cidade='Nice' where id='te1';

do $$
declare r record; atual text;
begin
  -- exatamente a ordem de /api/assistente/desfazer
  for r in select * from change_log where lote='TL1' order by criado_em desc, id desc loop
    execute format('update itinerary_events set %I=$1 where id=$2', r.campo)
      using r.de, r.entidade_id;
  end loop;

  select cidade into atual from itinerary_events where id='te1';
  if atual is distinct from 'Paris' then
    raise exception 'A FALHOU: replay reverso devolveu "%" em vez de "Paris"', atual;
  end if;
  raise notice 'A ok: replay reverso restaurou o valor original';
end $$;

-- ---------------------------------------------------------------- B
\echo 'B. remocao nao volta, e leva os filhos'

insert into itinerary_events (id,trip_id,ocorre_em,titulo) values ('te2','tt1','2027-06-05 09:00','Passeio');
insert into itinerary_options (id,event_id,modo,detalhe) values ('to1','te2','trem','RER C');
insert into change_log (trip_id,traveler_id,entidade,entidade_id,campo,de,para,origem,lote)
  values ('tt1','tp1','roteiro','te2','(registro)','existia','removido','assistente','TL2');
delete from itinerary_events where id='te2';

do $$
declare guardado text; filhos int;
begin
  select de into guardado from change_log where lote='TL2';
  if guardado is distinct from 'existia' then
    raise exception 'B FALHOU: o log guardou "%" — se ele guardasse o registro, o desfazer seria possivel', guardado;
  end if;
  select count(*) into filhos from itinerary_options where event_id='te2';
  if filhos <> 0 then
    raise exception 'B FALHOU: cascade nao levou os filhos (% restaram)', filhos;
  end if;
  raise notice 'B ok: remocao e irreversivel e o cascade levou os filhos — o aviso na tela de revisao e verdadeiro';
end $$;

-- ---------------------------------------------------------------- C
\echo 'C. o check not valid recusa origem invalida'

do $$
begin
  begin
    insert into change_log (trip_id,entidade,campo,origem)
      values ('tt1','roteiro','x','invalida');
    raise exception 'C FALHOU: o check aceitou uma origem fora da lista';
  exception when check_violation then
    raise notice 'C ok: origem fora da lista recusada no insert';
  end;
end $$;

-- ---------------------------------------------------------------- D
\echo 'D. apagar a viagem preserva o historico de gasto'

insert into ai_usage (trip_id,user_id,modo,modelo,entrada,saida)
  values ('tt1','tu1','duvida','claude-opus-5',100,50);
delete from trips where id='tt1';

do $$
declare linhas int; viagem text;
begin
  select count(*) into linhas from ai_usage where user_id='tu1';
  if linhas <> 1 then
    raise exception 'D FALHOU: apagar a viagem levou o registro de gasto junto';
  end if;
  select trip_id into viagem from ai_usage where user_id='tu1';
  if viagem is not null then
    raise exception 'D FALHOU: trip_id deveria virar null, veio "%"', viagem;
  end if;
  raise notice 'D ok: o gasto sobreviveu a viagem, com trip_id nulo';
end $$;

rollback;
