#!/usr/bin/env node
/**
 * Registro de deploy (PostToolUse, Bash).
 *
 * Depois de um comando de deploy (os mesmos que a trava de deploy reconhece), acrescenta uma
 * linha em `.claude/state/deploys.jsonl` do repositório. Não registra o que não publica:
 * `docker compose up` local, migração `--local`, script cujo corpo não publica, `psql` remoto
 * só lendo. Linha:
 *   {"em": ISO, "sha": "...", "branch": "main", "comando": "...", "sucesso": true|false|null}
 * `sucesso` vem do código de saída quando o Claude Code o informa; sem ele, fica null
 * (ou false se o comando foi interrompido). Na prática o Bash não informa o código, então `null`
 * é o normal, também em deploy que falhou: a linha é o registro da TENTATIVA e a prova de que
 * publicou é a conferência pós-deploy da skill `publicando`. Credenciais no comando (`--token`, `--api-token`,
 * `--db-url`, `--password`, `-p`, `usuario:senha@` em URL) são mascaradas antes de gravar.
 * Nunca bloqueia e nunca imprime nada.
 */
import { appendFileSync } from "node:fs";
import path from "node:path";

import { stateDir } from "./lib/config.mjs";
import { currentBranch, headSha, repoRoot } from "./lib/git.mjs";
import { runHook } from "./lib/output.mjs";
import { deploysNoComando, mascararComando } from "./lib/deploy.mjs";

/** Lê o resultado do Bash na resposta da ferramenta. */
export function sucessoDe(resp) {
  if (!resp || typeof resp !== "object") return null;
  for (const k of ["exit_code", "exitCode", "returnCode", "code", "status"]) {
    if (typeof resp[k] === "number") return resp[k] === 0;
  }
  if (resp.interrupted === true) return false;
  return null;
}

export function decide(payload, agora = new Date()) {
  if (payload.tool_name !== "Bash") return null;
  const command = payload.tool_input?.command;
  if (typeof command !== "string") return null;
  const deploys = deploysNoComando(command, payload.cwd || process.cwd());
  const sucesso = sucessoDe(payload.tool_response);
  for (const d of deploys) {
    if (d.somenteLeitura) continue;
    const root = repoRoot(d.dir);
    if (!root) continue;
    const linha = { em: agora.toISOString(), sha: headSha(root), branch: currentBranch(root), comando: mascararComando(d.comando), sucesso };
    appendFileSync(path.join(stateDir(root, true), "deploys.jsonl"), `${JSON.stringify(linha)}\n`);
  }
  return null;
}

runHook(import.meta.url, (p) => decide(p));
