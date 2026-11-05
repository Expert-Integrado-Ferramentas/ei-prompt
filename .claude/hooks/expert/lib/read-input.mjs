/**
 * Lê o JSON que o Claude Code entrega ao hook pela entrada padrão.
 * Qualquer problema (stdin vazio, JSON inválido, não-objeto) devolve null:
 * o hook então deixa passar, nunca derruba o trabalho por defeito próprio.
 */
import { readFileSync } from "node:fs";

/**
 * @param {string} [raw] texto já lido (testes); sem ele, lê o stdin inteiro
 * @returns {Record<string, any>|null}
 */
export function readInput(raw) {
  try {
    const text = raw ?? readFileSync(0, "utf8");
    if (!text || !text.trim()) return null;
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    return payload;
  } catch {
    return null;
  }
}
