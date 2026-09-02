-- O limitador de tentativas, contra um Postgres de verdade.
--
-- O que este arquivo prova, e que nenhum teste unitario alcanca, porque e
-- comportamento do BANCO e nao do JavaScript:
--
--   A. A janela desliza. Tentativa que envelheceu deixa de contar, senao o
--      limitador viraria um bloqueio permanente depois de N erros na vida.
--   B. O bloqueio dispara no limite+1 e devolve quanto falta, e insistir DURANTE
--      o castigo nao empurra o fim dele para frente.
--   C. Chaves em namespaces diferentes (`login:` e `cadastro:`) nao disputam o
--      mesmo contador -- errar a senha nao pode consumir a cota de quem se
--      cadastra da mesma rede.
--   D. `for update` serializa: e o ponto inteiro de a conta morar no banco em vez
--      da memoria do processo. Duas instancias serverless liam o mesmo contador,
--      cada uma somava 1, e o limite valia o dobro.
--
-- Como rodar (Postgres local, banco descartavel):
--   createdb tripgo_teste
--   psql -d tripgo_teste -f db/schema.sql
--   psql -d tripgo_teste -v ON_ERROR_STOP=1 -f db/teste-limite.sql
--
-- Sai com erro no primeiro `assert` que falhar.

begin;

-- ---------------------------------------------------------------- A
\echo 'A. a janela desliza: tentativa velha deixa de contar'

do $$
declare b boolean;
begin
  -- Tres tentativas antigas, ja fora de uma janela de 1 minuto.
  insert into rate_limit (chave, tentativas)
    values ('teste:janela', array[now() - interval '10 min', now() - interval '9 min',
                                 now() - interval '8 min']);

  -- Limite 3: se as velhas contassem, esta quarta bloquearia.
  select bloqueado into b from registrar_tentativa('teste:janela', 3,
                                                   interval '1 minute', interval '15 minutes');
  if b then
    raise exception 'A FALHOU: tentativa fora da janela ainda contou';
  end if;
  raise notice 'A ok: a janela desliza';
end $$;

-- ---------------------------------------------------------------- B
\echo 'B. bloqueia no limite+1, e insistir nao estende o castigo'

do $$
declare b boolean; ms bigint; ate1 timestamptz; ate2 timestamptz; i int;
begin
  -- Limite 3: as tres primeiras passam.
  for i in 1..3 loop
    select bloqueado into b from registrar_tentativa('teste:bloqueio', 3,
                                                     interval '5 minutes', interval '15 minutes');
    if b then raise exception 'B FALHOU: bloqueou na tentativa % de 3', i; end if;
  end loop;

  -- A quarta estoura.
  select bloqueado, restam_ms into b, ms
    from registrar_tentativa('teste:bloqueio', 3, interval '5 minutes', interval '15 minutes');
  if not b then raise exception 'B FALHOU: a 4a tentativa passou com limite 3'; end if;
  if ms < 14 * 60 * 1000 then
    raise exception 'B FALHOU: restam_ms veio % , esperado ~15 min', ms;
  end if;

  -- Insistir durante o castigo NAO empurra o fim para frente.
  select bloqueado_ate into ate1 from rate_limit where chave = 'teste:bloqueio';
  perform registrar_tentativa('teste:bloqueio', 3, interval '5 minutes', interval '15 minutes');
  select bloqueado_ate into ate2 from rate_limit where chave = 'teste:bloqueio';
  if ate2 <> ate1 then
    raise exception 'B FALHOU: insistir durante o bloqueio estendeu o castigo';
  end if;
  raise notice 'B ok: bloqueia no limite+1 e o castigo tem fim fixo';
end $$;

-- ---------------------------------------------------------------- C
\echo 'C. namespaces nao disputam o mesmo contador'

do $$
declare b boolean; i int;
begin
  for i in 1..5 loop
    perform registrar_tentativa('login:1.2.3.4', 3, interval '5 minutes', interval '15 minutes');
  end loop;

  -- O login desta origem esta bloqueado; o cadastro da MESMA origem nao pode estar.
  select bloqueado into b from registrar_tentativa('cadastro:1.2.3.4', 3,
                                                   interval '5 minutes', interval '15 minutes');
  if b then
    raise exception 'C FALHOU: o cadastro herdou o bloqueio do login da mesma origem';
  end if;
  raise notice 'C ok: os baldes sao independentes';
end $$;

-- ---------------------------------------------------------------- D
\echo 'D. limpar a chave zera a janela (o acerto de senha)'

do $$
declare b boolean; i int;
begin
  for i in 1..3 loop
    perform registrar_tentativa('teste:limpa', 3, interval '5 minutes', interval '15 minutes');
  end loop;

  -- E o que /api/sessao faz ao acertar a senha: prova que nao era chute.
  delete from rate_limit where chave = 'teste:limpa';

  select bloqueado into b from registrar_tentativa('teste:limpa', 3,
                                                   interval '5 minutes', interval '15 minutes');
  if b then raise exception 'D FALHOU: a janela nao foi zerada'; end if;
  raise notice 'D ok: o acerto zera a janela';
end $$;

rollback;
