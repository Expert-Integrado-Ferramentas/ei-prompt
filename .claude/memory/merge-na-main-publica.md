---
name: Merge na main publica no npm
description: Todo push na `main` dispara `npm publish`; sem bump de versão o workflow falha com 403
---

**Por quê:** `.github/workflows/publish.yml` roda em `push` na `main` e executa
`npm publish --access public`. Commit sem bump de `package.json` deixa o run vermelho (já aconteceu
com o commit "chore: CODEOWNERS para a trava de branch", run 35622557425). Além disso, os arquivos de
prompt chegam aos clientes direto da `main`, sem esperar o publish.

**Como aplicar:** mudança de produto (`modelo/`, `docs/` distribuídos, `.claude/`, `client/`) leva
bump em `package.json` e entrada no `CHANGELOG.md` no mesmo PR (`RELEASE.md`). Mudança só de contexto
(`AGENTS.md`, `CONTEXT.md`, `.claude/memory/`) não muda o pacote: o run falha com 403 e isso é
esperado, não é regressão.
