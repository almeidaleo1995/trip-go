# Changelog — skill roteiro-trip-go (antes `viagem-para-json`)

Uma entrada por versão aplicada. Uma proposta de versão que ainda não foi
revisada/aplicada não entra aqui — ela vive só no relatório da skill até
alguém aceitar.

## 1.2.0 — 2026-08-25

Renomeada de `viagem-para-json` para `roteiro-trip-go`.

- **Passo 0 obrigatório**: perguntar cidades, lugares, valores e nomes dos
  participantes antes de montar qualquer JSON. O documento diz o que foi
  comprado, não o que a pessoa quer.
- **Passo 4 novo**: conferir `lib/schema.ts` (e o export da viagem, quando ela
  já existe) antes de escrever — Zod descarta chave desconhecida em silêncio,
  então seção renomeada importava vazia sem erro.
- Documentação alinhada ao `SCHEMA_VERSION = 3` real, que já tinha divergido:
  `viajantes`/`pin`/`papel: admin` → `participantes`/`email`/`proprietario·
  editor·visualizador`, `hospedagens` → `reservas`, `custos[].valor_centavos`
  passa a ser o **total** (não o valor por pessoa × `pessoas`), pago vira
  `parcelas[].pago_centavos`, checklist ganha `prioridade`/`fonte_*`.

## 1.1.0 — 2026-08-24

`schemaVersion` alinhada a `SCHEMA_VERSION = 3` de `lib/schema.ts`.

- Nova capacidade: gerar lotes de sugestão de checklist para uma viagem já
  existente no app (`reference/checklist-sugestoes.md`), em vez de só o JSON
  de importação de uma viagem inteira.
- Estrutura nova: `schema/`, `rules/`, `templates/`, `mappings/`,
  `validators/`, mais este `CHANGELOG.md` na raiz da skill — versionamento
  explícito e evolução controlada, sem a skill reescrever o próprio
  `SKILL.md`.

## 1.0.0

Versão original: converte documentos de viagem no JSON de importação
completo (roteiro, voos, cruzeiro, hospedagens, lugares, checklist,
documentos, contatos de emergência, custos).
