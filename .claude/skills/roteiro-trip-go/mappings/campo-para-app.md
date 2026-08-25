# Mapeamento nome → campo do app

Mesmo princípio que a tabela "Mapeamentos que exigem atenção" do
[SKILL.md](../SKILL.md) já usa para o roteiro: ids não sobrevivem entre a
skill (que não tem acesso ao banco) e o app, então todo vínculo viaja por
**nome exato**, e o app resolve para o id real na importação
(`resolverSugestoes` em `lib/checklist.ts`).

| No lote da skill | No app | Como resolver |
| --- | --- | --- |
| `assigned_to_nomes: ["Alana Martins"]` | `assigned_to: ["<id do participante>"]` | Nome bate contra `travelers.nome` da viagem, normalizado (minúsculo, sem acento). Nome que não bate **rejeita a sugestão inteira** — não é um vínculo opcional, é quem é dono do item. |
| `evento: "Chegada em Madri"` | `itinerary_event_id: "<id>"` | Título bate contra `itinerary_events.titulo` da viagem. Não bate → item entra do mesmo jeito, só sem o vínculo (opcional). |
| `voo: "LATAM 719"` | `flight_id: "<id>"` | `"<companhia> <numero>"` bate contra `flights.companhia`/`flights.numero`. Mesma tolerância do evento: não bate, vínculo fica vazio. |
| `cruzeiro: "MSC Poesia"` | `cruise_id: "<id>"` | Nome do navio bate contra `cruises.navio`. Mesma tolerância. |

## Por que participante é obrigatório e o resto não

`assigned_to_nomes` define **de quem é o item** — errar isso é dado errado
(o item aparece pra pessoa errada, ou não aparece pra ninguém se ficar
vazio num item pessoal). Por isso um nome que não bate derruba a sugestão
inteira (ver [rules/dedup-e-prioridade.md](../rules/dedup-e-prioridade.md)).

`evento`/`voo`/`cruzeiro` só adicionam **contexto** — um item de checklist
sem esse vínculo ainda é um item de checklist válido e útil. Por isso a
skill pode citar o nome como "melhor esforço": se não bater exatamente,
o app não inventa uma correspondência aproximada, só deixa o campo vazio.

## Ao escrever o nome

Use o nome exatamente como aparece na viagem — copie do export/snapshot,
não abrevie nem traduza. "Alana" não bate com "Alana Martins" (comparação é
por igualdade após normalizar, não por conter). Na dúvida, prefira citar o
nome completo tal como está cadastrado.
