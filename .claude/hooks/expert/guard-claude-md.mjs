#!/usr/bin/env node
/**
 * CLAUDE.md muito grande (PreToolUse, Write|Edit|MultiEdit). Só avisa: nunca bloqueia.
 *
 * Para arquivos CLAUDE.md e AGENTS.md, calcula o tamanho que o arquivo TERÁ depois da escrita:
 *   - acima de `claudeMd.bloqueioKb` KB (e crescendo): avisa que nesse tamanho o Claude já não usa
 *     bem o arquivo e sugere a skill organizando-contexto;
 *   - acima de `claudeMd.avisoLinhas` linhas: avisa e sugere a skill organizando-contexto.
 * Uma edição que DIMINUI um arquivo já grande não recebe o aviso de KB: é assim que ele volta ao normal.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { loadConfig } from "./lib/config.mjs";
import { repoRoot } from "./lib/git.mjs";
import { context, mensagem, runHook } from "./lib/output.mjs";

const ALVOS = new Set(["CLAUDE.md", "AGENTS.md"]);

function aplicar(texto, oldS, newS, todas) {
  if (typeof oldS !== "string" || typeof newS !== "string") return null;
  if (oldS === "") return null;
  if (!texto.includes(oldS)) return null;
  return todas ? texto.split(oldS).join(newS) : texto.replace(oldS, () => newS);
}

/** Conteúdo resultante da ferramenta, ou null quando não dá para calcular. */
export function conteudoResultante(toolName, input, atual) {
  if (toolName === "Write") return typeof input.content === "string" ? input.content : null;
  if (atual === null) return null;
  if (toolName === "Edit") return aplicar(atual, input.old_string, input.new_string, input.replace_all === true);
  if (toolName === "MultiEdit") {
    if (!Array.isArray(input.edits)) return null;
    let t = atual;
    for (const e of input.edits) {
      t = aplicar(t, e?.old_string, e?.new_string, e?.replace_all === true);
      if (t === null) return null;
    }
    return t;
  }
  return null;
}

export function contarLinhas(texto) {
  if (!texto) return 0;
  const n = texto.split("\n").length;
  return texto.endsWith("\n") ? n - 1 : n;
}

export function decide(payload) {
  const tool = payload.tool_name;
  if (!["Write", "Edit", "MultiEdit"].includes(tool)) return null;
  const input = payload.tool_input || {};
  if (typeof input.file_path !== "string" || !ALVOS.has(path.basename(input.file_path))) return null;
  const file = path.resolve(payload.cwd || process.cwd(), input.file_path);
  const atual = existsSync(file) ? readFileSync(file, "utf8") : null;
  const novo = conteudoResultante(tool, input, atual);
  if (novo === null) return null;

  const root = repoRoot(path.dirname(file)) || repoRoot(payload.cwd || process.cwd());
  const { config } = loadConfig(root);
  const limiteKb = Number(config.claudeMd?.bloqueioKb) || 40;
  const avisoLinhas = Number(config.claudeMd?.avisoLinhas) || 200;
  const bytes = Buffer.byteLength(novo, "utf8");
  const bytesAtuais = atual === null ? 0 : Buffer.byteLength(atual, "utf8");
  const nome = path.basename(file);

  if (bytes > limiteKb * 1024 && bytes > bytesAtuais) {
    return context(
      "PreToolUse",
      mensagem({
        trava: "CLAUDE.md muito grande",
        oQue: `Aviso: o ${nome} vai ficar com ${(bytes / 1024).toFixed(1)} KB; o limite é ${limiteKb} KB. A escrita segue; reduza o arquivo em seguida.`,
        porque: "nesse tamanho o Claude já não consegue usar o arquivo direito e o contexto de toda sessão fica caro.",
        comoFazer: "rode a skill `organizando-contexto`: histórico, incidentes e runbooks vão para `docs/`, padrões e armadilhas para `.claude/memory/`, e o que só vale numa pasta para o CLAUDE.md dela.",
      }),
    );
  }
  const linhas = contarLinhas(novo);
  if (linhas > avisoLinhas) {
    return context(
      "PreToolUse",
      `O ${nome} vai ficar com ${linhas} linhas (aviso acima de ${avisoLinhas}). Sugira à pessoa rodar a skill organizando-contexto para mover histórico e runbooks para docs/ e padrões para .claude/memory/.`,
    );
  }
  return null;
}

runHook(import.meta.url, decide);
