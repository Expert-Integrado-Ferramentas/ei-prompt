# ei-prompt

CLI npm (`@expertzinhointegrado/ei-prompt`) que instala, na pasta de um cliente de atendimento
automatizado, os agentes EiPrompt (Orquestrador, Qualifier, Scheduler, Protractor, Recepcionista,
Follow-Up), os subagentes e os comandos `/ei-*` do Claude Code. Roda via `npx` (Node >= 18) e baixa
os arquivos da branch `main` no GitHub, listados em `manifest.json`.

Antes de começar qualquer tarefa, leia `.claude/memory/MEMORY.md` (ela não carrega sozinha) e
o `AGENTS.md` da pasta em que vai mexer, se houver.

## Regras da Expert

1. A `main` só muda por PR. Trabalhe numa branch `tipo/descricao`.
2. Commit no padrão Conventional Commits, com a descrição em português.
3. Nenhum segredo ou dado pessoal (de aluno, cliente ou participante) no código, em teste, log,
   commit ou issue.
4. Teste antes do push, e a suíte inteira: o que foi feito e tudo o que já existia.
5. Quem torna algo obsoleto (código, arquivo, flag, documento) remove no mesmo PR.
6. Limpeza de branch só depois de provar o merge.
7. Mudança de banco só por migration testada localmente.
8. Versão semântica e CHANGELOG em toda versão lançada.
9. Afirmação se prova com medida: comando rodado, resultado, número. "Deve funcionar" não vale.
10. Erro que se repete vira rule (ou trava, se for risco grave), não mais um parágrafo neste arquivo.
11. `AGENTS.md` guarda só regra do projeto (e o roteamento para as pastas). Relatório de entrega,
    histórico e diário de incidente vão na descrição do PR ou em `docs/`, nunca aqui.
12. Não altere o harness da Expert (`.claude/hooks/expert/`, `.claude/rules/`, `.claude/skills/`,
    `.claude/state/`) sem pedido explícito da pessoa; mudança nele vem pela skill
    `instalando-harness`. Os hooks de `.claude/hooks/*.sh` e o `.claude/settings.json` são do
    produto (ver abaixo) e mudam por PR como qualquer outro arquivo.

## Regras deste projeto

- **Este repositório é a fonte do que o CLI entrega.** `manifest.json` lista cada arquivo baixado
  (`files`) e cada arquivo legado que o CLI apaga (`deprecated_files`). Arquivo distribuído novo,
  renomeado ou removido em `modelo/`, `docs/` ou `.claude/` muda o `manifest.json` no mesmo PR.
- **O que está no manifest é produto, não contexto desta sessão.** O CLI lê a `main` direto do
  GitHub e sobrescreve o arquivo na pasta do cliente: mudança neles chega aos clientes assim que cai
  na `main`. Isso inclui `.claude/settings.json`, `.claude/hooks/*.sh`, `.claude/agents/`,
  `.claude/commands/` e o `client/CLAUDE.md` (entregue ao cliente como `CLAUDE.md`).
- **`client/CLAUDE.md` nunca vira ponteiro `@AGENTS.md`**: o cliente não tem `AGENTS.md`. Regra de
  edição de agente vai nele e em `docs/`; regra para trabalhar neste repositório vai aqui.
- **Nada do harness da Expert em `.claude/settings.json`**: hook apontando para
  `.claude/hooks/expert/` quebraria nas pastas dos clientes. Ver `docs/harness-reconciliacao.md`.
- **Merge na `main` dispara `npm publish`** (`.github/workflows/publish.yml`). Versão nova pede
  bump em `package.json` e entrada no `CHANGELOG.md` antes do merge; sem bump o publish falha com
  403. Fluxo completo em `RELEASE.md`.
- **`modelo/` é read-only para os comandos públicos** (`docs/proibido-fazer.md`). O mantenedor edita
  aqui, mantém a casca XML (`docs/regras-edicao.md`), valida com `xmllint --noout modelo/*.md` e
  sobe versão e CHANGELOG. Só template vive em `modelo/`: `/ei-cria-cliente` lista `modelo/*.md`.
- **Zero dependências.** Só built-ins do Node e o `fetch` global; não há `package-lock.json`.
- Commit ou PR sem "Generated with Claude Code" nem `Co-Authored-By` (`docs/proibido-fazer.md`).
- Textos de comando e subagente em pt-BR; chaves do frontmatter (`name`, `description`, `tools`,
  `model`) em inglês. Subagente em kebab-case; comando com prefixo `ei-`.
- O projeto usa o fluxo GSD (`.planning/`): mudança começa por `/gsd-quick`, `/gsd-debug` ou
  `/gsd-execute-phase`, salvo pedido explícito da pessoa de seguir sem ele.

## Comandos

- Testes: `npm test` (`node --test bin/*.test.js .claude/hooks/*.test.js`)
- CLI local: `node bin/cli.js` baixa do GitHub e escreve na pasta atual (use uma pasta temporária)
- Publicar: merge na `main` com versão e `CHANGELOG.md` atualizados (`RELEASE.md`)

## Onde está cada coisa

| Pasta | O que mora lá | Veja |
| --- | --- | --- |
| `bin/` | `cli.js` (o CLI) e `cli.test.js`; sem `AGENTS.md` porque `bin/` vai inteira para o npm | `docs/cli.md` |
| `modelo/` | Os 6 templates de agente, com casca XML; base de todo cliente | `docs/regras-edicao.md` |
| `client/` | `CLAUDE.md` que o CLI entrega ao cliente (produto) | `docs/regras-edicao.md` |
| `docs/` | `regras-edicao`, `regras-validacao`, `proibido-fazer` e `multi-agente-recepcionista` (distribuídos) e docs internos | `docs/proibido-fazer.md` |
| `.claude/agents/`, `.claude/commands/` | Subagentes e comandos `/ei-cria-cliente`, `/ei-ajustes`, `/ei-update` | `COMANDOS.md` |
| `.claude/hooks/` | Hooks do pipeline de ajustes e de criação de cliente, com testes | `.claude/hooks/AGENTS.md` |
| `.claude/hooks/expert/`, `.claude/rules/`, `.claude/skills/` | Harness da Expert (não é produto) | `.claude/expert-governanca.json` |
| `.planning/` | Artefatos do GSD: fases, milestones, mapa do código (`codebase/`, de 2026-07-04) | `.planning/codebase/` |
| `.github/workflows/` | `publish.yml` (publica no npm a cada push na `main`) | `RELEASE.md` |

- Glossário do negócio: `CONTEXT.md` · Padrões e armadilhas: `.claude/memory/MEMORY.md`
- Reconciliação com o `.claude/` anterior: `docs/harness-reconciliacao.md`

## Metodologia

Stack padrão, políticas e o próprio harness:
https://github.com/Expert-Integrado-Ferramentas/expert-governanca
