/**
 * Formato de saída dos hooks (CONTRATO.md, "Saída dos hooks") e o executor comum.
 *
 * - deny/ask: só para PreToolUse.
 * - context: aviso sem bloquear, em qualquer evento.
 * - allow: nenhuma saída, código 0.
 * Erro interno: nenhuma saída, código 0 (fail-open).
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { readInput } from "./read-input.mjs";

export function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

export function ask(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: reason,
    },
  };
}

export function context(event, text) {
  return { hookSpecificOutput: { hookEventName: event, additionalContext: text } };
}

export function allow() {
  return null;
}

/**
 * Monta a mensagem padrão das travas: o que foi bloqueado, por quê, como fazer certo.
 * @param {{trava: string, oQue: string, porque: string, comoFazer: string, detalhe?: string}} m
 */
export function mensagem({ trava, oQue, porque, comoFazer, detalhe }) {
  const linhas = [`[Trava: ${trava}] ${oQue}`, `Por quê: ${porque}`, `Como fazer: ${comoFazer}`];
  if (detalhe) linhas.push("", detalhe);
  return linhas.join("\n");
}

/** Este módulo é o ponto de entrada do processo? (segue symlinks) */
export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(metaUrl);
  try {
    return realpathSync(process.argv[1]) === realpathSync(self);
  } catch {
    return process.argv[1] === self;
  }
}

/**
 * Executa `decide(payload)` quando o arquivo é chamado como hook. `decide` pode ser assíncrona.
 * Qualquer exceção vira "deixa passar" (código 0, sem saída).
 * @param {string} metaUrl import.meta.url do hook
 * @param {(payload: Record<string, any>) => any} decide
 */
export async function runHook(metaUrl, decide) {
  if (!isMain(metaUrl)) return;
  let result = null;
  try {
    const payload = readInput();
    if (payload) result = await decide(payload);
  } catch {
    result = null;
  }
  try {
    if (result) process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    // nada: fail-open
  }
  process.exitCode = 0;
}
