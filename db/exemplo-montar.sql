-- Uma viagem inteira montada em SQL, do zero, para copiar e adaptar.
--
-- Rode assim (o `montar.sql` so precisa ser aplicado uma vez por banco):
--
--   psql "$DATABASE_URL" -f db/montar.sql
--   psql "$DATABASE_URL" -f db/exemplo-montar.sql
--   npm run montar -- exemplo --saida viagem.json
--
-- ou tudo de uma vez, que e o caminho normal:
--
--   npm run montar -- exemplo --sql db/exemplo-montar.sql --saida viagem.json
--
-- O arquivo que sai daí entra pelo botao Importar, na aba Participantes e dados.
--
-- Este arquivo e escrito para ser RODADO DE NOVO: `montar.viagem` com o mesmo
-- nome de rascunho recomeca do zero, entao corrigir um horario e editar a linha e
-- rodar o script outra vez, nao caçar o item no banco.

-- 1. A viagem. Sempre primeiro: ela abre o rascunho.
select montar.viagem(
  'exemplo',
  p_nome               => 'Portugal 2027',
  p_data_partida       => '2027-03-10',
  p_data_retorno       => '2027-03-18',
  p_subtitulo          => 'Lisboa e Porto',
  p_moeda              => 'EUR',
  -- IANA. Serve para converter o relogio de quem abre o app de casa; durante a
  -- viagem o certo e deixar null e confiar no aparelho.
  p_fuso               => 'Europe/Lisbon',
  p_orcamento_centavos => 1800000
);

-- 2. Quem vai. O NOME e a chave: pagador, dono de documento e divisao de despesa
--    citam esta lista por nome, e nome repetido deixa tudo ambiguo (montar.conferir
--    reclama).
select montar.participante('exemplo', p_nome => 'Ana',   p_papel => 'proprietario', p_ordem => 0);
select montar.participante('exemplo', p_nome => 'Bruno', p_papel => 'editor',       p_ordem => 1);
select montar.participante('exemplo', p_nome => 'Clara', p_papel => 'visualizador', p_ordem => 2);

-- 3. Voo. `p_escalas` e jsonb porque a escala so existe dentro do voo.
select montar.voo(
  'exemplo',
  p_companhia      => 'TAP',
  p_numero         => 'TP88',
  p_origem_iata    => 'GRU',
  p_origem_cidade  => 'Sao Paulo',
  p_destino_iata   => 'LIS',
  p_destino_cidade => 'Lisboa',
  -- Hora LOCAL de cada ponta, sem fuso: parte 22:15 em Sao Paulo, chega 12:30 em
  -- Lisboa. E a convencao do app inteiro — ver README, "Two clock conventions".
  p_parte_em       => '2027-03-10T22:15',
  p_chega_em       => '2027-03-11T12:30',
  p_localizador    => 'ABC123',
  p_bagagem        => '1 mala de 23kg por pessoa'
);

-- 4. Onde dormir. O `p_nome` da reserva e o que o roteiro e o cofre citam depois.
select montar.reserva(
  'exemplo',
  p_nome        => 'Hotel Baixa',
  p_tipo        => 'hospedagem',
  p_cidade      => 'Lisboa',
  p_inicio_em   => '2027-03-11T15:00',
  p_fim_em      => '2027-03-15T11:00',
  p_endereco    => 'Rua da Prata 100, Lisboa',
  p_localizador => 'HB-99812'
);

-- 5. Cidades. Alimentam o mapa do Inicio; sem lat/lon a cidade nao aparece la.
select montar.lugar('exemplo', p_cidade => 'Lisboa', p_pais => 'Portugal',
                    p_dias => 4, p_lat => 38.7223, p_lon => -9.1393, p_ordem => 0);
select montar.lugar('exemplo', p_cidade => 'Porto',  p_pais => 'Portugal',
                    p_dias => 3, p_lat => 41.1579, p_lon => -8.6291, p_ordem => 1);

-- 6. O roteiro, item a item. `p_reserva` liga ao hotel pelo NOME da reserva.
select montar.roteiro('exemplo',
  p_ocorre_em => '2027-03-11T12:30', p_titulo => 'Pouso em Lisboa',
  p_cidade => 'Lisboa', p_tipo => 'voo', p_ancora => true);

select montar.roteiro('exemplo',
  p_ocorre_em => '2027-03-11T15:00', p_titulo => 'Check-in no hotel',
  p_cidade => 'Lisboa', p_tipo => 'hospedagem', p_reserva => 'Hotel Baixa');

select montar.roteiro('exemplo',
  p_ocorre_em => '2027-03-12T10:00', p_fim_em => '2027-03-12T13:00',
  p_titulo => 'Mosteiro dos Jeronimos', p_cidade => 'Lisboa', p_local => 'Belem',
  p_tipo => 'passeio', p_custo_centavos => 1200,
  p_como_chegar => 'Tram 15E da Praca da Figueira, ~30 min',
  -- `p_opcoes` sao as alternativas de deslocamento que a tela compara.
  p_opcoes => '[{"modo":"onibus","duracao_min":30,"custo":"€3","detalhe":"Tram 15E","recomendado":true},
                {"modo":"taxi","duracao_min":15,"custo":"€14"}]'::jsonb);

-- 7. O dia, que e o cabecalho do roteiro daquela data (titulo, resumo, alertas).
select montar.dia('exemplo', p_dia => '2027-03-12', p_titulo => 'Belem a pe',
                  p_cidade => 'Lisboa', p_pais => 'Portugal',
                  p_resumo => 'Mosteiro, torre e pastel de nata. Dia todo em Belem.',
                  p_antes_sair => 'Levar agua e protetor');

-- 8. Checklist. Prazo ideal e prazo maximo sao datas, e a tela cobra por elas.
select montar.checklist('exemplo', p_titulo => 'Comprar seguro viagem',
  p_categoria => 'Antes de viajar', p_prazo_ideal => '2027-02-10',
  p_prazo_maximo => '2027-03-05', p_prioridade => 'obrigatorio',
  p_assigned_to_nomes => array['Ana']);

-- 9. Cofre. Documento PESSOAL exige dono: sem `p_dono_nome` a importacao rebaixa
--    para global e o numero fica visivel para a viagem inteira.
select montar.documento('exemplo', p_titulo => 'Passaporte da Ana',
  p_tipo => 'texto', p_categoria => 'passaporte', p_escopo => 'pessoal',
  p_dono_nome => 'Ana', p_validade => '2031-08-20', p_importante => true);

select montar.documento('exemplo', p_titulo => 'Voucher do hotel',
  p_tipo => 'texto', p_valor => 'HB-99812', p_categoria => 'hospedagem',
  p_reserva => 'Hotel Baixa', p_offline => true);

-- 10. Documentacao EXIGIDA: o que a viagem cobra de cada um. Diferente do cofre —
--     o cofre guarda o que existe, isto guarda o que falta.
select montar.requisito('exemplo', p_nome => 'Passaporte valido',
  p_obrigatorio => true, p_aplica_todos => true,
  p_exige_numero => true, p_exige_validade => true, p_prazo => '2027-02-01');

select montar.entrega('exemplo', p_requisito_nome => 'Passaporte valido',
  p_dono_nome => 'Ana', p_numero => 'FX123456', p_validade => '2031-08-20',
  p_status => 'aprovado');

-- 11. Emergencia. Funciona sem sinal, entao vale preencher antes de embarcar.
select montar.emergencia('exemplo', p_titulo => 'Emergencia (Portugal)',
                         p_telefone => '112', p_ordem => 0);
select montar.emergencia('exemplo', p_titulo => 'Consulado do Brasil em Lisboa',
                         p_telefone => '+351 21 394 8300', p_ordem => 1);

-- 12. Dinheiro. Categoria primeiro; a despesa cita a categoria pelo NOME.
select montar.categoria('exemplo', p_nome => 'Hospedagem', p_ordem => 0);
select montar.categoria('exemplo', p_nome => 'Transporte', p_ordem => 1);

-- Divisao por peso: Ana e Bruno pagam dobrado, Clara paga metade disso.
-- `p_valor_centavos` e o TOTAL da despesa, nunca o valor por pessoa.
select montar.custo('exemplo',
  p_descricao      => 'Hotel Baixa, 4 noites',
  p_valor_centavos => 96000,
  p_categoria      => 'Hospedagem',
  p_pagador        => 'Ana',
  p_moeda          => 'EUR',
  p_ocorre_em      => '2027-03-11',
  p_divisao        => 'peso',
  p_estimado       => false,
  p_divisoes       => '[{"participante":"Ana","peso":2},
                        {"participante":"Bruno","peso":2},
                        {"participante":"Clara","peso":1}]'::jsonb,
  -- Parcelas tem que somar o total, senao `montar.conferir` acusa.
  p_parcelas       => '[{"numero":1,"vence_em":"2027-01-15","valor_centavos":48000,"pago_centavos":48000,"pago_em":"2027-01-15"},
                        {"numero":2,"vence_em":"2027-02-15","valor_centavos":48000,"pago_centavos":0}]'::jsonb);

-- Reembolso: quem pagou por fora acerta com quem adiantou. Aponta para a parcela
-- pela descricao da despesa + numero da parcela.
select montar.pagamento('exemplo', p_de => 'Bruno', p_para => 'Ana',
  p_valor_centavos => 19200, p_ocorre_em => '2027-01-20',
  p_despesa => 'Hotel Baixa, 4 noites', p_parcela => 1,
  p_referencia => 'Pix');

-- 13. Conferir ANTES de gerar. Vazio = nada a corrigir.
select * from montar.conferir('exemplo');

-- 14. O que entrou.
select * from montar.resumo('exemplo');
