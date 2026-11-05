#!/usr/bin/env node
/**
 * Trava 3 — mensagem de commit (PreToolUse, Bash). Só avisa: nunca bloqueia; fora do padrão,
 * devolve um aviso (additionalContext) para o Claude corrigir a mensagem com `--amend`.
 *
 * Em `git commit` com mensagem escrita no próprio comando (`-m`, `--message`, `-F <arquivo>`,
 * `-F -` com heredoc, `-m "$(cat <<'EOF' ... EOF)"`), o cabeçalho (primeira linha) precisa seguir
 * Conventional Commits e ter até 72 caracteres. Com `commit.coautoriaClaude: "proibir"`, avisa do
 * trailer `Co-Authored-By:` que cite Claude/Anthropic.
 *
 * Sem mensagem no comando (abre editor, `--amend` sem `-m`, `--no-edit`, `-C`, `--fixup`):
 * deixa passar, porque não há o que julgar.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { loadConfig } from "./lib/config.mjs";
import { repoRoot } from "./lib/git.mjs";
import { context, mensagem, runHook } from "./lib/output.mjs";
import { gitCalls } from "./lib/shell.mjs";

/** Escopo aceita maiúsculas, ponto, barra e sublinhado (`feat(API)`, `fix(web/login)`, `chore(deps_dev)`). */
export const HEADER_RE = /^(feat|fix|refactor|test|chore|docs|style|perf|ci|build|revert)(\([A-Za-z0-9._/-]+\))?!?: \S.*/;
export const MAX_HEADER = 72;
/** Cabeçalhos gerados pelo próprio git, que não seguem o padrão e não devem travar. */
const GIT_GENERATED = /^(Merge |Revert "|fixup! |squash! |amend! )/;
const COAUTHOR_CLAUDE = /^\s*co-authored-by:.*\b(claude|anthropic)\b/im;

/** Opções curtas de `git commit` que recebem argumento. */
const SHORT_WITH_ARG = new Set(["m", "F", "c", "C", "t"]);
/** Opções curtas cujo valor, se houver, vem colado (`-uno`, `-Skeyid`): o resto do grupo é delas. */
const SHORT_OPTIONAL_ATTACHED = new Set(["u", "S"]);
const LONG_WITH_ARG = new Set(["--message", "--file", "--reuse-message", "--reedit-message", "--template", "--author", "--date", "--cleanup", "--fixup", "--squash", "--trailer", "--pathspec-from-file"]);

/** Extrai o corpo de `$(cat <<'EOF' ... EOF)` (forma que o Claude usa para mensagens longas). */
export function heredocDeSubstituicao(valor) {
  const m = /^\$\(\s*cat\s*<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*\n?\s*\)\s*$/.exec(valor);
  return m ? m[3] : null;
}

/**
 * Lê as opções de um `git commit`.
 * @returns {{mensagens: (string|null)[], arquivos: string[], trailers: string[], semMensagem: boolean}}
 */
export function lerOpcoesDeCommit(args) {
  const mensagens = [];
  const arquivos = [];
  const trailers = [];
  let reaproveita = false;
  const take = (opt, val) => {
    if (opt === "m" || opt === "--message") mensagens.push(val);
    else if (opt === "F" || opt === "--file") arquivos.push(val);
    else if (opt === "--trailer") trailers.push(val);
    else if (opt === "c" || opt === "C" || opt === "--reuse-message" || opt === "--reedit-message" || opt === "--fixup" || opt === "--squash") reaproveita = true;
  };
  for (let i = 0; i < args.length; i += 1) {
    const t = args[i];
    if (t === "--") break;
    if (t.startsWith("--")) {
      const eq = t.indexOf("=");
      const name = eq > 0 ? t.slice(0, eq) : t;
      if (!LONG_WITH_ARG.has(name)) continue;
      if (eq > 0) take(name, t.slice(eq + 1));
      else {
        take(name, args[i + 1] ?? "");
        i += 1;
      }
      continue;
    }
    if (t.startsWith("-") && t.length > 1) {
      for (let k = 1; k < t.length; k += 1) {
        const ch = t[k];
        if (SHORT_OPTIONAL_ATTACHED.has(ch)) break;
        if (!SHORT_WITH_ARG.has(ch)) continue;
        const attached = t.slice(k + 1);
        if (attached) take(ch, attached);
        else {
          take(ch, args[i + 1] ?? "");
          i += 1;
        }
        break;
      }
    }
  }
  return { mensagens, arquivos, trailers, reaproveita };
}

/**
 * Monta a mensagem completa de um commit, ou null quando ela não está no comando.
 * @param {import("./lib/shell.mjs").GitCall} call
 */
export function mensagemDoCommit(call) {
  const { mensagens, arquivos, trailers } = lerOpcoesDeCommit(call.args);
  const partes = [];
  if (mensagens.length) {
    for (const m of mensagens) {
      if (m === null) return null;
      const viaHeredoc = heredocDeSubstituicao(m);
      if (viaHeredoc !== null) partes.push(viaHeredoc);
      else if (/^\s*(\$|`)/.test(m)) return null; // conteúdo calculado na execução: não dá para julgar
      else partes.push(m);
    }
  } else if (arquivos.length) {
    const f = arquivos[0];
    if (f === "-") {
      if (!call.cmd.heredocs.length) return null;
      partes.push(call.cmd.heredocs[0]);
    } else {
      const file = path.resolve(call.dir, f);
      if (!existsSync(file)) return null;
      try {
        partes.push(readFileSync(file, "utf8"));
      } catch {
        return null;
      }
    }
  } else {
    return null; // editor, --amend/--no-edit, -C/-c, --fixup: não há mensagem no comando
  }
  const texto = partes.join("\n\n");
  return { texto, trailers };
}

/** Primeira linha não vazia, sem comentários do git. */
export function cabecalho(texto) {
  for (const l of texto.split("\n")) {
    if (l.startsWith("#")) continue;
    if (l.trim()) return l.replace(/\s+$/, "");
  }
  return "";
}

/** @returns {{motivo: string, tipo: "cabecalho"|"coautoria"}|null} */
export function avaliarMensagem(texto, trailers, coautoria) {
  const head = cabecalho(texto);
  if (!GIT_GENERATED.test(head)) {
    if (!HEADER_RE.test(head)) return { tipo: "cabecalho", motivo: `o cabeçalho \`${head}\` não segue Conventional Commits` };
    if (head.length > MAX_HEADER) return { tipo: "cabecalho", motivo: `o cabeçalho tem ${head.length} caracteres; o máximo é ${MAX_HEADER}` };
  }
  if (coautoria === "proibir") {
    const all = [texto, ...trailers].join("\n");
    if (COAUTHOR_CLAUDE.test(all)) return { tipo: "coautoria", motivo: "o commit tem o trailer `Co-Authored-By` do Claude/Anthropic" };
  }
  return null;
}

export function decide(payload) {
  if (payload.tool_name !== "Bash") return null;
  const command = payload.tool_input?.command;
  if (typeof command !== "string" || !command.includes("commit")) return null;
  for (const call of gitCalls(command, payload.cwd || process.cwd())) {
    if (call.sub !== "commit") continue;
    const msg = mensagemDoCommit(call);
    if (!msg) continue;
    const { config } = loadConfig(repoRoot(call.dir));
    const r = avaliarMensagem(msg.texto, msg.trailers, config.commit?.coautoriaClaude);
    if (!r) continue;
    if (r.tipo === "coautoria") {
      return context(
        "PreToolUse",
        mensagem({
          trava: "mensagem de commit",
          oQue: `Aviso: ${r.motivo}. O commit segue; corrija a mensagem em seguida.`,
          porque: "a Expert não usa coautoria do Claude nos commits (padrão `commit.coautoriaClaude: \"proibir\"`); quem responde pelo código é a pessoa que pediu.",
          comoFazer: "antes do push, refaça a mensagem sem a linha `Co-Authored-By: Claude ...` (nem `--trailer` equivalente) com `git commit --amend`.",
        }),
      );
    }
    return context(
      "PreToolUse",
      mensagem({
        trava: "mensagem de commit",
        oQue: `Aviso: ${r.motivo}. O commit segue; corrija a mensagem em seguida.`,
        porque: "o histórico no padrão vira documentação e gera o CHANGELOG e a versão a partir do tipo de cada commit.",
        comoFazer: `antes do push, corrija com \`git commit --amend -m "..."\` no formato \`tipo(escopo opcional): descrição em português\`, até ${MAX_HEADER} caracteres na primeira linha, com tipo entre feat, fix, refactor, test, chore, docs, style, perf, ci, build, revert. Ex.: \`fix(login): aceita e-mail com letras maiúsculas\`.`,
      }),
    );
  }
  return null;
}

runHook(import.meta.url, decide);
