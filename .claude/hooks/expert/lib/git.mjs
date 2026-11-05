/**
 * Acesso ao git para as travas. Toda função devolve null (ou valor neutro) quando o git
 * falha, não existe ou estoura o tempo: quem chama decide deixar passar.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const DEFAULT_TIMEOUT_MS = 5000;

/** Caminhos de estado local do harness, que nunca contam como "pendência". */
const STATE_PREFIX = ".claude/state/";

/**
 * Roda `git -C dir ...args`. Devolve stdout (sem trim) ou null em falha.
 * @param {string} dir
 * @param {string[]} args
 * @param {{timeout?: number, env?: Record<string,string>}} [opts]
 */
export function git(dir, args, opts = {}) {
  if (!dir || !existsSync(dir)) return null;
  try {
    return execFileSync("git", ["-C", dir, "-c", "core.quotePath=false", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: opts.timeout ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", ...(opts.env || {}) },
    });
  } catch {
    return null;
  }
}

function line(out) {
  if (out === null) return null;
  const v = out.trim();
  return v === "" ? null : v;
}

/** O git está instalado? */
export function gitDisponivel() {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore", timeout: DEFAULT_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

export function repoRoot(dir, opts = {}) {
  return line(git(dir, ["rev-parse", "--show-toplevel"], opts));
}

/** Nome da branch atual (funciona em repositório sem commit). null quando HEAD está solto. */
export function currentBranch(dir) {
  return line(git(dir, ["symbolic-ref", "--quiet", "--short", "HEAD"]));
}

export function headSha(dir, opts = {}) {
  return line(git(dir, ["rev-parse", "--verify", "--quiet", "HEAD"], opts));
}

export function hasCommits(dir, opts = {}) {
  return headSha(dir, opts) !== null;
}

export function upstreamSha(dir) {
  return line(git(dir, ["rev-parse", "--verify", "--quiet", "@{upstream}"]));
}

export function upstreamName(dir) {
  return line(git(dir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]));
}

/** @returns {{ahead: number, behind: number}|null} */
export function aheadBehind(dir) {
  const out = line(git(dir, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]));
  if (!out) return null;
  const [ahead, behind] = out.split(/\s+/).map(Number);
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) return null;
  return { ahead, behind };
}

/** Commits da branch local `branch` à frente do upstream dela. null sem upstream (ou sem saber). */
export function aFrenteDoUpstream(dir, branch) {
  if (!branch) return null;
  const out = line(git(dir, ["rev-list", "--count", `${branch}@{upstream}..refs/heads/${branch}`]));
  const n = out === null ? NaN : Number(out);
  return Number.isFinite(n) ? n : null;
}

/** Existe a branch local `name`? */
export function localBranchExists(dir, name) {
  return git(dir, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`]) !== null;
}

/** Existe `refs/remotes/<qualquer>/<name>`? */
export function remoteBranchExists(dir, name) {
  const out = git(dir, ["for-each-ref", "--format=%(refname)", `refs/remotes/*/${name}`]);
  return Boolean(out && out.trim());
}

function splitZ(out) {
  if (!out) return [];
  return out.split("\0").filter(Boolean);
}

/**
 * Arquivos no índice (adicionados, copiados, modificados, renomeados).
 * null quando o git falhou (quem examina segredo não pode tratar falha como "nada").
 */
export function stagedFiles(dir, opts = {}) {
  const out = git(dir, ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"], opts);
  return out === null ? null : splitZ(out);
}

/** Arquivos rastreados modificados fora do índice (o que `commit -a` levaria). null em falha. */
export function modifiedTrackedFiles(dir, opts = {}) {
  const out = git(dir, ["diff", "--name-only", "-z", "--diff-filter=ACMR"], opts);
  return out === null ? null : splitZ(out);
}

/** Todos os caminhos rastreados (índice), numa chamada só. null em falha. */
export function trackedFiles(dir, opts = {}) {
  const out = git(dir, ["ls-files", "-z"], opts);
  return out === null ? null : new Set(splitZ(out));
}

/**
 * Quais destes caminhos (relativos à raiz) o `.gitignore` ignora. Funciona com arquivo que ainda
 * não existe. Arquivo já rastreado nunca conta como ignorado. null quando o git falhou.
 * @returns {Set<string>|null}
 */
export function ignoredPaths(dir, paths, opts = {}) {
  if (!paths.length) return new Set();
  if (!dir || !existsSync(dir)) return null;
  const r = spawnSync("git", ["-C", dir, "-c", "core.quotePath=false", "check-ignore", "--stdin", "-z"], {
    input: paths.join("\0"),
    encoding: "utf8",
    timeout: opts.timeout ?? DEFAULT_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (r.status === 1) return new Set(); // nenhum ignorado
  if (r.status !== 0) return null;
  return new Set(splitZ(r.stdout));
}

/**
 * Linhas adicionadas num diff unificado.
 * @param {string|null} diffText
 * @returns {{file: string, line: number, text: string}[]}
 */
export function parseAddedLines(diffText) {
  const out = [];
  if (!diffText) return out;
  let file = null;
  let inHeader = false;
  let lineNo = 0;
  for (const raw of diffText.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      inHeader = true;
      file = null;
      continue;
    }
    if (inHeader) {
      if (raw.startsWith("+++ ")) {
        const p = raw.slice(4);
        file = p === "/dev/null" ? null : p.replace(/^b\//, "");
        continue;
      }
      if (!raw.startsWith("@@")) continue;
      inHeader = false;
    }
    if (raw.startsWith("@@")) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      lineNo = m ? Number(m[1]) : 0;
      continue;
    }
    if (!file) continue;
    if (raw.startsWith("+")) {
      out.push({ file, line: lineNo, text: raw.slice(1) });
      lineNo += 1;
    } else if (raw.startsWith(" ")) {
      lineNo += 1;
    }
  }
  return out;
}

const DIFF_ARGS = ["-U0", "--no-color", "--no-ext-diff", "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/"];

/** Linhas adicionadas no índice. null quando o git falhou (ex.: diff maior que o buffer). */
export function stagedDiffAddedLines(dir, opts = {}) {
  const out = git(dir, ["diff", "--cached", ...DIFF_ARGS], opts);
  return out === null ? null : parseAddedLines(out);
}

/**
 * Linhas adicionadas em arquivos rastreados ainda fora do índice (opcionalmente só em `paths`),
 * ou, com `base` ("HEAD"), entre o commit e a árvore de trabalho. null quando o git falhou.
 */
export function worktreeDiffAddedLines(dir, paths, opts = {}) {
  const args = ["diff", ...(opts.base ? [opts.base] : []), ...DIFF_ARGS];
  if (paths && paths.length) args.push("--", ...paths);
  const out = git(dir, args, opts);
  return out === null ? null : parseAddedLines(out);
}

/**
 * Entradas do `git status --porcelain`, sem o estado local do harness.
 * @returns {{code: string, path: string}[]|null}
 */
export function statusEntries(dir) {
  const out = git(dir, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (out === null) return null;
  const parts = out.split("\0");
  const entries = [];
  for (let i = 0; i < parts.length; i += 1) {
    const item = parts[i];
    if (!item) continue;
    const code = item.slice(0, 2);
    const file = item.slice(3);
    if (code[0] === "R" || code[0] === "C") i += 1; // origem do rename vem no próximo campo
    if (file.startsWith(STATE_PREFIX)) continue;
    entries.push({ code, path: file });
  }
  return entries;
}

/** Árvore de trabalho sem nada pendente (ignora `.claude/state/`). null quando não dá para saber. */
export function isClean(dir) {
  const entries = statusEntries(dir);
  return entries === null ? null : entries.length === 0;
}

/** Commits locais que não estão em nenhum remoto. null sem remoto ou sem commit. */
export function unpushedCount(dir) {
  const remotes = line(git(dir, ["remote"]));
  if (!remotes || !hasCommits(dir)) return null;
  const out = line(git(dir, ["rev-list", "--count", "HEAD", "--not", "--remotes"]));
  return out === null ? null : Number(out);
}
