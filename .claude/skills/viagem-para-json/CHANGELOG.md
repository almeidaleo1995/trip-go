# Changelog — skill viagem-para-json

Uma entrada por versão aplicada. Uma proposta de versão que ainda não foi
revisada/aplicada não entra aqui — ela vive só no relatório da skill até
alguém aceitar.

## 1.1.0 — 2026-08-24

`schemaVersion` alinhada a `SCHEMA_VERSION = 3` de `lib/schema.ts`.

- Nova capacidade: gerar lotes de sugestão de checklist para uma viagem já
  existente no app (`reference/checklist-sugestoes.md`), em vez de só o JSON
  de importação de uma viagem inteira.
- Estrutura nova: `schema/`, `rules/`, `templates/`, `mappings/`,
  `validators/`, `changelog/` — versionamento explícito e evolução
  controlada, sem a skill reescrever o próprio `SKILL.md`.

## 1.0.0

Versão original: converte documentos de viagem no JSON de importação
completo (roteiro, voos, cruzeiro, hospedagens, lugares, checklist,
documentos, contatos de emergência, custos).
