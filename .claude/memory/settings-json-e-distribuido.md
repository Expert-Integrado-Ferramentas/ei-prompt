---
name: settings.json é distribuído
description: O `.claude/settings.json` deste repositório vai para a pasta de todo cliente e é sobrescrito a cada execução do CLI
---

**Por quê:** `manifest.json` lista `.claude/settings.json` em `files`, e `writeFile()` em `bin/cli.js`
roda com `overwrite: true`. O que está no `settings.json` da `main` substitui o do cliente. Um hook
apontando para `.claude/hooks/expert/` (harness da Expert) ficaria quebrado nas pastas dos clientes,
e um `permissions.deny` novo passaria a valer para eles. O cabeçalho de
`.claude/hooks/check-claude-md-audience.sh` já registra o mesmo cuidado.

**Como aplicar:** não mescle hook, permissão ou `attribution` do harness no `.claude/settings.json`
sem decidir como separar o arquivo do cliente (por exemplo, entregá-lo de `client/`, como já é feito
com o `CLAUDE.md`). Hook só do repositório vai em `.claude/settings.local.json`. Ver
`docs/harness-reconciliacao.md`.
