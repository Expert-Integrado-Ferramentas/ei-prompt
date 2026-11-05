# Reconciliação com o harness da Expert

Instalação do harness 0.5.1 em 2026-11-05, em modo não interativo. Este arquivo lista o que o
projeto já tinha em `.claude/`, o que foi aplicado e o que espera decisão de uma pessoa.

## O que o projeto já tinha

| Item | O que fazer | Por quê |
| --- | --- | --- |
| `.claude/agents/*` (7 subagentes) | Fica | Livre: função que a Expert não cobre e é produto (está no `manifest.json`) |
| `.claude/commands/*` (3 comandos `/ei-*`) | Fica | Livre: produto distribuído |
| `.claude/hooks/*.sh` e `*.js` do pipeline (`post-ajustes-fanout`, `post-scaffolder-review`, `validate-xml-casca`, `check-claude-md-audience`, `inject-ei-context`, `prompt-matches-agent`) | Fica | Livre: cuidam da rotina do pipeline, não decidem push, branch, commit nem segredo. Sem sobreposição com as travas |
| `.claude/rules/` e `.claude/skills/` | Entram as do harness | A pasta não existia: sem conflito de nome nem skill equivalente do projeto |
| `.claude/hooks/expert/` | Entra | Travas do harness, pasta própria |
| `.claude/CLAUDE.md` (cópia idêntica do `CLAUDE.md` da raiz, 21,4 KB) | Removido | Duplicava o `CLAUDE.md` da raiz e carregava em toda conversa. O conteúdo foi classificado no relatório do PR; o original está no git |
| `.claude/settings.json` | **Não mesclado** (decidir) | Ver abaixo |

## Pendente: `.claude/settings.json`

O CLI (`expert-harness install`) parou com `out.hooks[evento].map is not a function`: o
`settings.json` do projeto tem `hooks._disabled_note` com um texto no lugar de uma lista de
hooks, e a mescla supõe que todo item de `hooks` seja lista. Os arquivos de `hooks/expert/`,
`rules/` e `skills/` já tinham sido copiados; o `settings.json` ficou como estava.

Mesmo sem o erro, a mescla não deveria entrar às cegas neste projeto. O `settings.json` é produto:

- `manifest.json` lista `.claude/settings.json` em `files`, e o `bin/cli.js` o baixa da `main` e
  sobrescreve o arquivo na pasta de cada cliente.
- Com a mescla, todo cliente receberia hooks que chamam `.claude/hooks/expert/*.mjs` (arquivos que
  não existem na pasta dele), um `permissions.deny` novo e `attribution` vazio.

Sem a mescla, o projeto fica **sem as travas e sem o `permissions.deny` do núcleo**, e as rules e
skills do harness já valem. A decisão é de uma pessoa. Caminho sugerido, num PR de produto com bump de
versão e CHANGELOG:

1. Copiar o `.claude/settings.json` de hoje para `client/settings.json` e trocar a entrada do
   manifest para `{ "from": "client/settings.json", "to": ".claude/settings.json" }` (o mesmo padrão
   usado com `client/CLAUDE.md`). Os clientes continuam recebendo o arquivo de antes.
2. Remover o campo `hooks._disabled_note` do `settings.json` do repositório (ou ajustar a mescla do
   CLI para ignorar campo que não seja lista) e rodar `expert-harness update`, que mescla o harness só
   neste repositório.
3. Provar as travas numa sessão nova (`git push origin main --dry-run` negado), gravar
   `testes.linhaDeBase` e apagar o campo `instalacao` de `.claude/expert-governanca.json`.

## Outros pontos para uma pessoa decidir

- `.planning/config.json` aponta `claude_md_path` para `./.claude/CLAUDE.md`, que foi removido. O GSD
  pode recriá-lo; ajuste o caminho para `./CLAUDE.md` se quiser evitar isso.
- `.claude/hooks/check-claude-md-audience.sh` só olha arquivos chamados `CLAUDE.md`. Agora o
  documento interno é o `AGENTS.md`, que ele não vigia.
- `RELEASE.md` descreve o merge em `main` como "via merge de PR ou push direto" e usa a branch
  longa `dev`. A política da Expert pede PR por branch `tipo/descricao`; o texto não foi alterado.
- Os agentes e comandos (`docs-analyzer`, `ei-ajustes`) mandam ler o `CLAUDE.md` da raiz como
  referência. No repositório-fonte ele agora só contém `@AGENTS.md`; nas pastas de cliente o
  `CLAUDE.md` continua sendo o `client/CLAUDE.md`.
