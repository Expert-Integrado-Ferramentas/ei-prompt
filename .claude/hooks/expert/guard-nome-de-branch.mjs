#!/usr/bin/env node
/**
 * Trava 2 — nome de branch (PreToolUse, Bash). Só avisa: nunca bloqueia.
 *
 * Todo comando que CRIA branch (`git switch -c|-C`, `git checkout -b|-B`, `git branch <nome>`,
 * `git worktree add -b`) deve usar `tipo/descricao-em-kebab-case`, com até 50 caracteres. Fora
 * do padrão, devolve um aviso (additionalContext) para o Claude renomear a branch sozinho.
 * Os tipos vêm de `tiposDeBranch` na configuração. Nomes das branches protegidas são aceitos
 * (criar a `main` num repositório novo é legítimo).
 *
 * Origem: guard-branch-name do Maestro (mesma extração de nomes), com o contrato da Expert.
 */
import { loadConfig } from "./lib/config.mjs";
import { repoRoot } from "./lib/git.mjs";
import { context, mensagem, runHook } from "./lib/output.mjs";
import { gitCalls } from "./lib/shell.mjs";

export const MAX_LEN = 50;

const CREATE_FLAGS = new Set(["-c", "-C", "-b", "-B", "--create", "--force-create", "--orphan"]);
const WORKTREE_CREATE_FLAGS = new Set(["-b", "-B", "--branch"]);
/** Qualquer uma destas em `git branch` significa que não é criação simples. */
const BRANCH_NON_CREATE = new Set([
  "-d", "-D", "--delete", "-m", "-M", "--move", "-c", "-C", "--copy",
  "--list", "-l", "-a", "--all", "-r", "--remotes", "-v", "-vv", "--verbose",
  "--show-current", "--edit-description", "--contains", "--no-contains",
  "--merged", "--no-merged", "-u", "--set-upstream-to", "--unset-upstream",
  "--points-at", "--sort", "--format", "--color", "--no-color", "--column", "--no-column",
  "-h", "--help",
]);

/** Nomes de branch que um comando criaria. */
export function branchesCriadas(command, cwd) {
  const found = [];
  for (const call of gitCalls(command, cwd)) {
    const { sub, args } = call;
    if (sub === "switch" || sub === "checkout") collect(args, CREATE_FLAGS, found, call.dir);
    else if (sub === "worktree" && args[0] === "add") collect(args.slice(1), WORKTREE_CREATE_FLAGS, found, call.dir);
    else if (sub === "branch") {
      if (args.some((t) => BRANCH_NON_CREATE.has(t) || /^--(sort|format|contains|merged|points-at|set-upstream-to|color|column)=/.test(t))) continue;
      const name = args.find((t) => !t.startsWith("-"));
      if (name) found.push({ nome: name, dir: call.dir });
    }
  }
  return found;
}

function collect(tokens, flags, out, dir) {
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    const eq = t.indexOf("=");
    if (eq > 0 && flags.has(t.slice(0, eq))) {
      out.push({ nome: t.slice(eq + 1), dir });
      continue;
    }
    if (flags.has(t) && tokens[i + 1] && !tokens[i + 1].startsWith("-")) {
      out.push({ nome: tokens[i + 1], dir });
      i += 1;
    }
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @returns {string|null} motivo da recusa, ou null se o nome é válido
 */
export function validarNome(nome, tipos, protegidas = []) {
  if (protegidas.includes(nome)) return null;
  if (nome.includes("$") || nome.includes("`")) return null; // nome gerado em tempo de execução: não dá para julgar
  const re = new RegExp(`^(${tipos.map(escapeRe).join("|")})/[a-z0-9]+(-[a-z0-9]+)*$`);
  if (!re.test(nome)) {
    const slash = nome.indexOf("/");
    const tipo = slash > 0 ? nome.slice(0, slash) : null;
    if (!tipo) return `falta o tipo no começo (\`tipo/\`)`;
    if (!tipos.includes(tipo)) return `\`${tipo}\` não é um tipo aceito`;
    return "a descrição deve ser em minúsculas, só letras, números e hífens, sem barras extras";
  }
  if (nome.length > MAX_LEN) return `tem ${nome.length} caracteres; o máximo é ${MAX_LEN}`;
  return null;
}

export function decide(payload) {
  if (payload.tool_name !== "Bash") return null;
  const command = payload.tool_input?.command;
  if (typeof command !== "string" || !command.includes("git")) return null;
  const criadas = branchesCriadas(command, payload.cwd || process.cwd());
  for (const { nome, dir } of criadas) {
    const { config } = loadConfig(repoRoot(dir));
    const motivo = validarNome(nome, config.tiposDeBranch, config.branchesProtegidas);
    if (!motivo) continue;
    const tipos = config.tiposDeBranch.join(", ");
    return context(
      "PreToolUse",
      mensagem({
        trava: "nome de branch",
        oQue: `Aviso: a branch \`${nome}\` está fora do padrão (${motivo}). O comando segue; corrija o nome em seguida.`,
        porque: "o nome no padrão tipo/descricao diz o que a branch entrega sem precisar abrir o código.",
        comoFazer: `renomeie com \`git branch -m <tipo>/<descricao-em-kebab-case>\` antes do push: até ${MAX_LEN} caracteres, tipo entre ${tipos}. Ex.: \`feat/cadastro-de-cliente\`, \`fix/login-sem-senha\`.`,
      }),
    );
  }
  return null;
}

runHook(import.meta.url, decide);
