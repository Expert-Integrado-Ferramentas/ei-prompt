---
name: client/CLAUDE.md é produto
description: `client/CLAUDE.md` é copiado para a pasta do cliente como `CLAUDE.md`; não é instrução para trabalhar neste repositório
---

**Por quê:** `manifest.json` mapeia `{ "from": "client/CLAUDE.md", "to": "CLAUDE.md" }`. O cliente não
tem `AGENTS.md`, então transformar esse arquivo em ponteiro `@AGENTS.md` deixaria o cliente sem as
regras de edição de agente. O conteúdo de cliente também não pode voltar ao `AGENTS.md` da raiz
(`check-claude-md-audience.sh` guardava isso para o `CLAUDE.md`).

**Como aplicar:** regra para quem edita agente de cliente vai em `client/CLAUDE.md` ou em `docs/`
(arquivos do manifest). Regra para quem trabalha neste repositório vai no `AGENTS.md` da raiz ou da
pasta. Mudou `client/CLAUDE.md`: versão nova e CHANGELOG antes do merge.
