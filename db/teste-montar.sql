-- A montagem de viagem em SQL, contra um Postgres de verdade.
--
-- O que este arquivo prova, e que nenhum teste unitário alcança, porque é
-- comportamento do BANCO e não do JavaScript:
--
--   A. Rodar o mesmo script de montagem DUAS vezes produz uma viagem, não duas.
--      É o requisito que decide o desenho inteiro de `montar.viagem`: corrigir um
--      horário é editar a linha e rodar de novo, e um rascunho que acumulasse
--      transformaria a segunda rodada num roteiro em dobro.
--   B. O enum é conferido no BANCO, no momento da chamada. Um `tipo` inventado
--      derruba o `select` que o escreveu — com o nome do campo e a lista válida —
--      em vez de viajar até o import e falhar longe de quem digitou.
--   C. `montar.conferir` acha o que o zod NÃO tem como ver: uma seção olhando
--      para a outra. Pagador que não é participante, categoria que não existe,
--      parcelas que não somam a despesa, documento pessoal sem dono, nome de
--      participante repetido. Cada uma dessas já custou uma importação que passou
--      verde e entregou viagem errada.
--   D. `montar.arquivo` produz o formato do app: `schemaVersion`, `viagem`, e uma
--      chave por seção — mesmo para a seção vazia, que sai como `[]` e não some.
--   E. `montar.carregar` fecha o círculo: arquivo -> rascunho -> arquivo devolve
--      o mesmo conteúdo. É o que permite exportar do app, editar em SQL e
--      reimportar.
--
-- Como rodar (Postgres local, banco descartável):
--   createdb tripgo_teste
--   psql -d tripgo_teste -f db/montar.sql
--   psql -d tripgo_teste -v ON_ERROR_STOP=1 -f db/teste-montar.sql
--
-- Sai com erro no primeiro `assert` que falhar. Não toca em nenhuma tabela do
-- app: `montar.*` é um schema à parte, e é por isso que este teste não precisa do
-- db/schema.sql aplicado antes.

begin;

-- ---------------------------------------------------------------- A
\echo 'A. rodar duas vezes produz uma viagem, nao duas'

do $$
declare n bigint;
begin
  perform montar.viagem('t', p_nome => 'Teste', p_data_partida => '2027-01-01',
                        p_data_retorno => '2027-01-10');
  perform montar.roteiro('t', p_ocorre_em => '2027-01-02T09:00', p_titulo => 'Passeio');
  perform montar.roteiro('t', p_ocorre_em => '2027-01-03T09:00', p_titulo => 'Outro');

  -- a "segunda rodada" do mesmo script
  perform montar.viagem('t', p_nome => 'Teste', p_data_partida => '2027-01-01',
                        p_data_retorno => '2027-01-10');
  perform montar.roteiro('t', p_ocorre_em => '2027-01-02T09:00', p_titulo => 'Passeio');
  perform montar.roteiro('t', p_ocorre_em => '2027-01-03T09:00', p_titulo => 'Outro');

  select count(*) into n
    from montar.itens i join montar.rascunhos r on r.id = i.rascunho_id
   where r.nome = 't' and i.secao = 'roteiro';

  if n <> 2 then
    raise exception 'A FALHOU: % itens de roteiro apos rodar duas vezes, esperado 2', n;
  end if;
  raise notice 'A ok: o rascunho recomeca em vez de acumular';
end $$;

-- Rascunho desconhecido erra alto: um nome errado devolvendo null faria o item
-- entrar em lugar nenhum e o script terminar "com sucesso" sem o passeio.
do $$
begin
  begin
    perform montar.roteiro('nao-existe', p_ocorre_em => '2027-01-02T09:00', p_titulo => 'X');
    raise exception 'A FALHOU: rascunho inexistente foi aceito em silencio';
  exception when others then
    if sqlerrm not like '%nao existe%' then raise; end if;
  end;
  raise notice 'A ok: rascunho inexistente derruba a chamada';
end $$;

-- ---------------------------------------------------------------- B
\echo 'B. enum invalido para no banco, com o nome do campo'

do $$
begin
  begin
    perform montar.roteiro('t', p_ocorre_em => '2027-01-02T09:00', p_titulo => 'X',
                           p_tipo => 'piquenique');
    raise exception 'B FALHOU: tipo fora da lista foi aceito';
  exception when others then
    if sqlerrm not like 'roteiro.tipo:%' then
      raise exception 'B FALHOU: a mensagem nao aponta o campo: %', sqlerrm;
    end if;
  end;
  raise notice 'B ok: enum conferido na chamada, com o campo na mensagem';
end $$;

-- ---------------------------------------------------------------- C
\echo 'C. montar.conferir acha o que o zod nao ve'

do $$
declare achou int;
begin
  perform montar.viagem('c', p_nome => 'Conferir', p_data_partida => '2027-01-01',
                        p_data_retorno => '2027-01-10');
  perform montar.participante('c', p_nome => 'Ana');
  perform montar.participante('c', p_nome => 'Ana');          -- nome repetido
  perform montar.categoria('c', p_nome => 'Hospedagem');

  -- pagador que nao esta na lista + categoria que nao existe + parcelas que nao somam
  perform montar.custo('c', p_descricao => 'Hotel', p_valor_centavos => 10000,
                       p_pagador => 'Fulano', p_categoria => 'Comida',
                       p_parcelas => '[{"numero":1,"valor_centavos":3000}]'::jsonb);

  -- documento pessoal sem dono: a importacao rebaixa para global e o numero fica
  -- visivel para a viagem inteira
  perform montar.documento('c', p_titulo => 'Passaporte', p_escopo => 'pessoal');

  -- roteiro fora da janela da viagem
  perform montar.roteiro('c', p_ocorre_em => '2028-05-05T09:00', p_titulo => 'Depois da viagem');

  select count(*) into achou from montar.conferir('c')
   where problema like '%nome repetido%';
  if achou <> 1 then raise exception 'C FALHOU: nome repetido nao foi apontado'; end if;

  select count(*) into achou from montar.conferir('c')
   where secao = 'custos' and problema like 'pagador cita%';
  if achou <> 1 then raise exception 'C FALHOU: pagador desconhecido nao foi apontado'; end if;

  select count(*) into achou from montar.conferir('c')
   where secao = 'custos' and problema like 'categoria cita%';
  if achou <> 1 then raise exception 'C FALHOU: categoria inexistente nao foi apontada'; end if;

  select count(*) into achou from montar.conferir('c')
   where secao = 'custos' and problema like '%parcelas somam%';
  if achou <> 1 then raise exception 'C FALHOU: parcelas que nao fecham nao foram apontadas'; end if;

  select count(*) into achou from montar.conferir('c')
   where secao = 'documentos' and problema like '%pessoal sem dono_nome%';
  if achou <> 1 then raise exception 'C FALHOU: documento pessoal sem dono nao foi apontado'; end if;

  select count(*) into achou from montar.conferir('c')
   where secao = 'roteiro' and problema like '%fora da viagem%';
  if achou <> 1 then raise exception 'C FALHOU: data fora da janela nao foi apontada'; end if;

  -- E o rascunho limpo nao inventa problema nenhum.
  perform montar.viagem('limpo', p_nome => 'Limpa', p_data_partida => '2027-01-01',
                        p_data_retorno => '2027-01-10');
  perform montar.participante('limpo', p_nome => 'Ana');
  perform montar.roteiro('limpo', p_ocorre_em => '2027-01-02T09:00', p_titulo => 'Passeio');
  select count(*) into achou from montar.conferir('limpo');
  if achou <> 0 then
    raise exception 'C FALHOU: rascunho limpo acusou % problema(s)', achou;
  end if;

  raise notice 'C ok: as seis checagens de referencia pegam, e o rascunho limpo passa';
end $$;

-- ---------------------------------------------------------------- D
\echo 'D. montar.arquivo tem o formato do app'

do $$
declare a jsonb;
begin
  a := montar.arquivo('limpo');

  if (a ->> 'schemaVersion') is null then
    raise exception 'D FALHOU: arquivo sem schemaVersion';
  end if;
  if (a -> 'viagem' ->> 'nome') <> 'Limpa' then
    raise exception 'D FALHOU: o bloco viagem nao veio';
  end if;
  if jsonb_array_length(a -> 'roteiro') <> 1 then
    raise exception 'D FALHOU: o roteiro nao veio';
  end if;
  -- Secao vazia sai como [], nunca ausente: o zod tem default, mas um arquivo que
  -- some com a chave e um arquivo que ninguem consegue LER para saber o que falta.
  if a -> 'cruzeiros' <> '[]'::jsonb then
    raise exception 'D FALHOU: secao vazia sumiu do arquivo em vez de sair como []';
  end if;
  -- Hora local do destino, sem Z e sem offset — a convencao do app inteiro.
  if (a -> 'roteiro' -> 0 ->> 'ocorre_em') <> '2027-01-02T09:00' then
    raise exception 'D FALHOU: a hora saiu como %, esperado 2027-01-02T09:00',
      (a -> 'roteiro' -> 0 ->> 'ocorre_em');
  end if;

  raise notice 'D ok: schemaVersion, viagem, secoes e o formato de hora';
end $$;

-- ---------------------------------------------------------------- E
\echo 'E. arquivo -> rascunho -> arquivo devolve o mesmo conteudo'

do $$
declare antes jsonb; depois jsonb;
begin
  antes := montar.arquivo('limpo');
  perform montar.carregar('volta', antes);
  depois := montar.arquivo('volta');

  if antes <> depois then
    raise exception 'E FALHOU: o round-trip mudou o conteudo. antes: % / depois: %',
      antes, depois;
  end if;
  raise notice 'E ok: carregar e reemitir nao perde nada';
end $$;

rollback;
