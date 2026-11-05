# .claude/hooks/

Hooks do pipeline de ajustes (`/ei-ajustes`) e de criação de cliente (`/ei-cria-cliente`), cada
um com o teste ao lado (`*.test.js`, rodados por `npm test`). A pasta `expert/` é do harness da
Expert: não edite aqui.

| Hook | Evento | O que faz |
| --- | --- | --- |
| `post-ajustes-fanout.sh` | Stop | Detecta o sentinela `<ei-ajustes-round id=...>` e instrui o Claude a seguir para a revisão |
| `post-scaffolder-review.sh` | SubagentStop | Pede a auditoria do `docs-reviewer` depois do `client-scaffold-fill` |
| `validate-xml-casca.sh` | Stop e SubagentStop | Valida a casca XML dos arquivos de agente tocados (delega a `validate-xml-casca.js`) |
| `check-claude-md-audience.sh` | Stop e SubagentStop | Só do repositório: barra cabeçalhos de cliente em `CLAUDE.md` |
| `inject-ei-context.sh`, `prompt-matches-agent.sh` | nenhum | Fora do `settings.json`: a injeção de contexto foi desativada na v1.8.9 e o script fica para restaurar do histórico |

## Regras

- Só bash, `grep` e `sed` (mais `node`, já exigido pelo projeto); sem `jq`. Use `set -uo pipefail` e
  não use `set -e` (o `grep` sem resultado devolve 1 e é tratado no próprio script).
- O estado do pipeline vive no transcript, nos sentinelas `<ei-ajustes-round id=...>` e
  `<ei-ajustes-round-consumed id=...>`. Não grave arquivo de estado.
- Saída que bloqueia: `{"decision":"block","reason":"..."}` no stdout; sem saída, não bloqueia.
  O `post-scaffolder-review.sh` só informa (`additionalContext`) e não bloqueia.
- Anti-loop: `post-ajustes-fanout.sh` confere `stop_hook_active` antes de tudo, e o
  `post-scaffolder-review.sh` usa sentinela com id. Já `validate-xml-casca.sh` e
  `check-claude-md-audience.sh` não conferem `stop_hook_active` de propósito, porque reavaliam um
  fato que pode seguir quebrado. Não acrescente essa guarda (o teste do `check-claude-md-audience` confere).
- Hook distribuído aos clientes entra no `manifest.json` e no `.claude/settings.json`. Hook só do
  repositório (`check-claude-md-audience.sh`) fica fora do manifest e do `settings.json`, e é
  registrado apenas em `.claude/settings.local.json`; registrar no `settings.json` deixaria uma
  referência quebrada em todo cliente.
- `check-claude-md-audience.sh` só olha arquivos chamados `CLAUDE.md`. O conteúdo de cliente
  (`## Mapa de Regras`, `## Slash Commands`, ...) mora em `client/CLAUDE.md` e não entra no
  `AGENTS.md` da raiz nem no das pastas.
- Hook novo ou alterado: teste `*.test.js` na mesma pasta e registro no `settings.json` (se for
  distribuído).
