# Assistente de IA — Context

**Gathered:** 2026-09-01
**Spec:** `.specs/features/assistente-ia/spec.md`
**Status:** Ready for design

---

## Feature Boundary

Dar ao TripGo um assistente conversacional com IA (Claude) que **age sobre a viagem**, não apenas responde: cria e edita registros a partir de linguagem natural (texto ou voz), resume um lugar recém-adicionado, responde perguntas sobre a viagem, aponta o que falta preparar, e serve de guia com informação da internet.

Isto é uma feature de **produto durante a viagem**, não de infraestrutura. O critério de aceitação de todas as histórias é o mesmo: alguém de pé na rua, com uma mão no celular, consegue registrar ou descobrir algo em menos tempo do que levaria abrindo o formulário certo.

---

## O que esta feature reverte

A spec `checklist-inteligente` decidiu, e o `context.md` dela registra em "Onde a inteligência roda":

> Nenhuma dependência de LLM/API key entra em produção. A skill roda externamente (Claude Code/Desktop).

**Esta feature reverte essa decisão.** O usuário pediu explicitamente uma IA dentro do app, usando a chave dele na Anthropic, disponível no celular durante a viagem — o que uma skill de Claude Code, que roda no desktop de uma pessoa só, nunca pode entregar. A reversão vale só para o assistente; a skill `roteiro-trip-go` continua existindo e continua sendo o caminho para converter documentos em lote.

Consequências assumidas, a registrar como AD novo em `.specs/STATE.md`:

- O app passa a ter uma dependência de runtime que **custa dinheiro por uso** e **exige rede** — as duas coisas que o projeto evitou até aqui.
- `ANTHROPIC_API_KEY` vira o segundo segredo de produção, com a mesma regra do `DATABASE_URL`: existe só no processo servidor, nunca chega ao navegador.
- A regra "4 dependências de runtime de propósito" passa a 5 (`@anthropic-ai/sdk`). É dependência **só de servidor** — não entra no bundle do cliente.

---

## Decisões do usuário (entrevista de 2026-09-01)

| Questão | Resposta | Consequência de design |
| --- | --- | --- |
| Poder da IA sobre os dados | **Escreve direto**, sem tela de confirmação | Não existe fila de propostas. A escrita é imediata e otimista, como qualquer edição da tela. Exige rastro e desfazer (ver abaixo). |
| Onde aparece | Botão flutuante em todas as abas **+** aba dedicada **+** voz **+** gatilhos contextuais | Quatro superfícies sobre **um** motor. O botão e a aba compartilham o mesmo histórico de conversa. |
| Chave e custo | Uma chave no servidor, todos os participantes usam | Sem coluna de chave por usuário. Exige limite de uso por pessoa, senão um participante consome a conta de todos. |
| Escopo v1 | Criar registros por linguagem natural, resumo ao adicionar lugar, perguntas sobre a viagem, sugestão proativa de preparação, **guia com informação da internet**, cobrindo todas as features do app | Web search entra no v1. "Todas as features" = todas as entidades que `/api/mutate` já aceita, não um subconjunto. |

### Sobre "escreve direto" — o que isso significa e o que não significa

O usuário escolheu escrita direta ciente do risco apontado (5 pessoas, last-write-wins, a IA pode sobrescrever a edição de alguém). A escolha é dele e está aceita. Ela significa **ausência de tela de confirmação**, e nada além disso:

- **Não** significa que a IA escreve fora do `autorizar` / `validarCampos`. Ela escreve pelo mesmo caminho de qualquer tela, com o `Acesso` de quem está falando. Uma IA que escapasse disso seria um caminho para contornar o recorte do financeiro — o exato problema que o `README` → Authorization existe para impedir.
- **Não** significa escrita invisível. Toda escrita da IA fica marcada como tal no `change_log` e é desfazível como lote.

### Sobre a skill no planejamento do dia

O usuário pediu que o planejamento de um dia "use a skill". Constatação técnica, não recusa: uma skill de Claude Code é um diretório de instruções lido pelo agente no desktop — **ela não existe no runtime da Vercel** e não há como invocá-la de dentro do app. O que é portável é o *conteúdo* dela (regras de roteiro, formato de dia, o que checar). O design decide se essas regras viram uma "receita" de prompt no servidor. A skill `roteiro-trip-go` segue intocada para o uso em lote no desktop.

---

## Onde isto encosta no código existente

| Arquivo | Papel nesta feature |
| --- | --- |
| `lib/db.ts` → `getSnapshot(tripId, papel, participanteId)` | **A decisão de segurança inteira.** O contexto que a IA lê é o snapshot que o servidor já monta para aquela pessoa — `financeiroDaViagem` já devolve `{admin:false}` para `visualizador`, `documentosDaViagem` já exclui o documento pessoal alheio. Reusar essa função dá o recorte de graça; montar uma query nova para a IA reabriria todos os vazamentos que essas duas fecharam. |
| `app/api/mutate/route.ts` → `TABELA`, `autorizar`, `validarCampos` | O caminho de escrita. A IA não ganha um segundo. `via` continua sendo a fronteira que recorta a escrita pela viagem da sessão. |
| `lib/schema.ts` → `POR_ENTIDADE` | Fonte das ferramentas da IA. `z.toJSONSchema()` (zod 4) converte cada schema de entidade em JSON Schema de tool — a lista de campos não é copiada para um quinto lugar. |
| `lib/offline.ts` → `VERSAO` | O histórico da conversa, se cacheado, muda o formato do snapshot. |
| `lib/preparacao.ts` | Já responde "o que falta para a viagem estar pronta?". A sugestão proativa lê daqui em vez de a IA reinventar as regras. |
| `lib/session.ts` → `registrarFalha` | O limitador em memória que já existe, com namespace novo para o custo por pessoa. |
| `components/Shell.tsx` | Onde entram o botão flutuante e a aba nova. |

---

## Deferred Ideas

| Ideia | Por que fica fora |
| --- | --- |
| Streaming da resposta (SSE) | O app não tem streaming em lugar nenhum além do download de arquivo do cofre. A primeira versão responde inteiro com estado de "pensando"; streaming é otimização de percepção, não de capacidade. |
| Conversa por voz de mão dupla (a IA falar de volta) | Entrada por voz está no v1; síntese de fala não foi pedida. |
| Memória entre conversas / preferências aprendidas | Cada conversa começa do snapshot. Persistir preferência da pessoa é feature própria. |
| Chave por participante | Descartada na entrevista. |
| A IA operando o cofre (ler/enviar arquivo) | Bytes de documento nunca entram no snapshot por decisão de arquitetura; colocá-los no contexto da IA reabriria isso. A IA fala sobre o documento (metadado), não sobre o conteúdo do PDF. |
