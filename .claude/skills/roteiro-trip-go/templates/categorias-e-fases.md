# Categorias sugeridas, prioridade e fase

## Categorias

`categoria` é texto livre no app — não é um enum travado, o admin pode
digitar qualquer coisa. As categorias abaixo são só um ponto de partida
consistente entre lotes gerados pela skill; reuse-as quando fizer sentido em
vez de inventar sinônimos a cada vez (não gere "Docs" numa sugestão e
"Documentação" na próxima):

| Categoria | Cobre |
| --- | --- |
| Documentos | Passaporte, visto, autorização de entrada, seguro viagem |
| Bagagem | O que levar, mala, mochila, bagagem de mão |
| Roupas | Vestuário adequado ao clima/atividades |
| Saúde | Farmácia, medicamentos, vacinas |
| Dinheiro | Câmbio, cartões, avisar o banco |
| Eletrônicos | Adaptador de tomada, carregador, power bank |
| Reservas | Passagem, hospedagem, ingressos, transporte |
| Destino | Requisitos específicos do país/cidade |
| Emergência | Contatos, seguro, o que fazer se perder documento |
| Retorno | Tarefas de quando a viagem termina |

## Prioridade

Ver [rules/dedup-e-prioridade.md](../rules/dedup-e-prioridade.md) para a
regra completa. Enum: `obrigatorio`, `importante` (default), `recomendado`,
`opcional`.

## Fase da viagem — não é um campo

O app organiza o checklist por fase (preparação, 7 dias antes, 48 horas
antes, no dia, durante a viagem, retorno) **calculando** a partir de
`prazo_ideal`/`prazo_maximo` e das datas da viagem (`faseChecklist` em
`lib/derive.ts`) — não existe coluna `fase` nem `dia` no banco.

Isso significa: a skill **nunca** deve incluir um campo `fase` ou `dia` numa
sugestão — não existe no schema (`ChecklistSugestaoSchema` não tem esses
campos) e seria descartado silenciosamente pelo zod. Para posicionar um item
numa fase, basta dar o `prazo_ideal`/`prazo_maximo` certo — o app calcula o
resto. Um item "para o dia do embarque" é só um item com `prazo_maximo` igual
à data de partida da viagem.
