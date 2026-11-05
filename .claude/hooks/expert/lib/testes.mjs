/**
 * Descoberta do comando de testes do projeto e leitura do registro `tests-ok.json`.
 * Ordem (CONTRATO.md): config `testes.comando` → package.json `scripts.test` →
 * deno.json `tasks.test` → Cargo.toml → pyproject.toml/pytest.ini (com `uv run`/`poetry run`
 * quando há uv.lock/poetry.lock). `testes.linhaDeBase.estado: "sem-testes"` vale como projeto
 * sem testes.
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { readStateJson, writeStateJson } from "./config.mjs";
import { git, headSha, isClean } from "./git.mjs";

/** Script padrão do `npm init`, que não testa nada. */
const NPM_PLACEHOLDER = /no test specified/i;
/** Saída de runner que não achou nenhum teste (vitest, jest, pytest, unittest). */
const SEM_TESTES_RE = /No test files found|No tests found|no tests ran|Ran 0 tests/i;
/** Sinal de teste que falhou de verdade (monorepo: um pacote sem testes e outro falhando). */
const FALHA_RE = /\b[1-9]\d*\s+(?:failed|failing|failures?|errors?)\b|\bFAIL\b|AssertionError|\u2715|\u2717/;

function readJsonLoose(file) {
  const text = readFileSync(file, "utf8");
  try {
    return JSON.parse(text);
  } catch {
    // jsonc: tira comentários de linha/bloco e vírgulas sobrando
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(stripped);
  }
}

function packageManager(root) {
  if (existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(root, "yarn.lock"))) return "yarn";
  if (existsSync(path.join(root, "bun.lockb")) || existsSync(path.join(root, "bun.lock"))) return "bun";
  return "npm";
}

/**
 * @param {string} root raiz do repositório
 * @param {Record<string, any>} config configuração já mesclada
 * @returns {string|null} comando, ou null quando o projeto não tem testes
 */
export function resolveTestCommand(root, config) {
  const testes = config?.testes || {};
  if (testes.linhaDeBase?.estado === "sem-testes") return null;
  if (Object.prototype.hasOwnProperty.call(testes, "comando")) {
    const cmd = typeof testes.comando === "string" ? testes.comando.trim() : "";
    return cmd || null;
  }
  try {
    const pkgFile = path.join(root, "package.json");
    if (existsSync(pkgFile)) {
      const script = JSON.parse(readFileSync(pkgFile, "utf8"))?.scripts?.test;
      if (typeof script === "string" && script.trim() && !NPM_PLACEHOLDER.test(script)) {
        const pm = packageManager(root);
        return pm === "npm" ? "npm test" : `${pm} run test`;
      }
    }
  } catch {
    // package.json inválido: segue procurando
  }
  for (const name of ["deno.json", "deno.jsonc"]) {
    const file = path.join(root, name);
    if (!existsSync(file)) continue;
    try {
      if (readJsonLoose(file)?.tasks?.test) return "deno task test";
    } catch {
      if (/"tasks"[\s\S]*"test"\s*:/.test(readFileSync(file, "utf8"))) return "deno task test";
    }
  }
  if (existsSync(path.join(root, "Cargo.toml"))) return "cargo test";
  if (existsSync(path.join(root, "pyproject.toml")) || existsSync(path.join(root, "pytest.ini"))) {
    if (existsSync(path.join(root, "uv.lock"))) return "uv run pytest";
    if (existsSync(path.join(root, "poetry.lock"))) return "poetry run pytest";
    return "pytest";
  }
  return null;
}

/**
 * O commit `sha` já teve a suíte aprovada nesta máquina? Vale o registro do próprio commit ou o
 * da árvore (`tree`) gravado quando a suíte rodou na pasta antes de um `git add -A && git commit`
 * na mesma linha: se o commit tem exatamente aquela árvore, foi aquele código que passou.
 */
export function testsOkFor(root, sha) {
  if (!sha) return false;
  const reg = readStateJson(root, "tests-ok.json");
  if (!reg) return false;
  if (reg.sha === sha) return true;
  if (typeof reg.tree !== "string" || !reg.tree) return false;
  const tree = git(root, ["rev-parse", "--verify", "--quiet", `${sha}^{tree}`]);
  return Boolean(tree && tree.trim() === reg.tree);
}

/**
 * Árvore (tree) do que está na pasta agora, como um `git add -A` deixaria o índice: cópia
 * temporária do índice + `git add -A` + `git write-tree`. Não mexe no índice real.
 * null se o git falhou ou passou do tempo.
 */
export function arvoreDaPasta(root, timeoutMs = 20000) {
  let tmp = null;
  try {
    tmp = mkdtempSync(path.join(os.tmpdir(), "eg-arvore-"));
    const indice = path.join(tmp, "index");
    const real = git(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"]);
    if (real && existsSync(real.trim())) copyFileSync(real.trim(), indice);
    const env = { GIT_INDEX_FILE: indice };
    const fim = Date.now() + timeoutMs;
    if (git(root, ["add", "-A"], { env, timeout: timeoutMs }) === null) return null;
    const tree = git(root, ["write-tree"], { env, timeout: Math.max(500, fim - Date.now()) });
    return tree ? tree.trim() || null : null;
  } catch {
    return null;
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Estado efetivo da linha de base. O arquivo local `.claude/state/linha-de-base.json`
 * (escrito no primeiro push com a suíte verde) vale mais que a configuração versionada,
 * para que a virada não suje a árvore de trabalho.
 * @returns {"passando"|"falhando"|"sem-testes"|string}
 */
export function linhaDeBaseEfetiva(root, config) {
  const local = readStateJson(root, "linha-de-base.json");
  if (local && typeof local.estado === "string") return local.estado;
  return config?.testes?.linhaDeBase?.estado || "passando";
}

/** Registra que a suíte passou (estado local, não versionado). */
export function registrarLinhaDeBasePassando(root, sha, agora = new Date()) {
  writeStateJson(root, "linha-de-base.json", { estado: "passando", em: agora.toISOString(), sha });
}

/** Registra o commit (ou, com `tree`, a árvore da pasta) cujos testes passaram. */
export function registrarTestsOk(root, sha, comando, agora = new Date(), tree = undefined) {
  writeStateJson(root, "tests-ok.json", { sha, ...(tree ? { tree } : {}), comando, em: agora.toISOString() });
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** Últimas `n` linhas da saída, sem cores. */
export function ultimasLinhas(texto, n = 30) {
  const linhas = String(texto || "").replace(ANSI, "").replace(/\r/g, "").split("\n");
  while (linhas.length && !linhas[linhas.length - 1].trim()) linhas.pop();
  return linhas.slice(-n).join("\n");
}

/** Espera pelo fim da saída depois que o processo sai (dado ainda no pipe). */
const ESPERA_SAIDA_MS = 300;
/** Depois de matar por tempo, resolve em no máximo isto, mesmo com pipe aberto. */
const ESPERA_APOS_MATAR_MS = 2000;

/**
 * Roda a suíte na raiz do repositório. O processo roda num grupo próprio para que o tempo
 * esgotado mate também os filhos (o `npm test` costuma abrir vários).
 * Termina quando o processo da suíte SAI (`exit`), não quando os pipes fecham: um neto destacado
 * (servidor, watcher, `setsid`) que herda o stdout seguraria o `close` até o hook ser morto pelo
 * Claude Code (e a trava deixaria passar). Depois do `exit` espera um instante pelo resto da saída
 * e fecha os pipes. Depois de matar por tempo, resolve "tempo" em até ~2 s mesmo sem `exit`.
 * @param {string} root
 * @param {string} comando
 * @param {number} timeoutSegundos
 * Se o próprio processo receber SIGTERM/SIGINT (ex.: o Claude Code encerrando o hook), mata o
 * grupo inteiro antes de sair, para a suíte não ficar rodando solta.
 * pytest que não acha testes (código 5) ou que nem está instalado (127) volta "sem-testes"; saída
 * de runner que não achou testes (`No test files found`, `No tests found`, `no tests ran`,
 * `Ran 0 tests`) com código diferente de 0 também, desde que não haja sinal de falha de verdade.
 * Depois que a suíte sai, mata o grupo de processos dela (fora do Windows), para netos que
 * ficaram no grupo (servidor, watcher) não seguirem rodando.
 * @param {{eco?: boolean}} [opts] eco: repete a saída no terminal (uso pela CLI)
 * @returns {Promise<{status: "passou"|"falhou"|"tempo"|"sem-testes", codigo: number|null, saida: string}>}
 */
export function rodarSuite(root, comando, timeoutSegundos, opts = {}) {
  return new Promise((resolve) => {
    let saida = "";
    let tempo = false;
    let feito = false;
    let child;
    try {
      child = spawn(comando, {
        cwd: root,
        shell: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, CI: process.env.CI || "1", FORCE_COLOR: "0" },
      });
    } catch (e) {
      resolve({ status: "falhou", codigo: null, saida: String(e?.message || e) });
      return;
    }
    const coleta = (eco) => (chunk) => {
      const t = chunk.toString("utf8");
      saida += t;
      if (saida.length > 2 * 1024 * 1024) saida = saida.slice(-1024 * 1024);
      if (opts.eco) eco.write(t);
    };
    child.stdout.on("data", coleta(process.stdout));
    child.stderr.on("data", coleta(process.stderr));
    const matar = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // já saiu
        }
      }
    };
    const aoSinal = (sinal) => {
      matar();
      process.exit(sinal === "SIGINT" ? 130 : 143);
    };
    process.once("SIGTERM", aoSinal);
    process.once("SIGINT", aoSinal);
    const timers = [];
    /** Resolve uma vez só, solta os ouvintes e fecha os pipes (que um neto pode segurar). */
    const terminar = (r) => {
      if (feito) return;
      feito = true;
      for (const t of timers) clearTimeout(t);
      if (process.platform !== "win32") {
        try {
          process.kill(-child.pid, "SIGKILL"); // netos que ficaram no grupo da suíte
        } catch {
          // grupo já vazio
        }
      }
      process.removeListener("SIGTERM", aoSinal);
      process.removeListener("SIGINT", aoSinal);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(r);
    };
    const porCodigo = (code) => {
      if (tempo) return { status: "tempo", codigo: null, saida };
      if (code === 0) return { status: "passou", codigo: 0, saida };
      if (/\bpytest\b/.test(comando) && (code === 5 || code === 127)) return { status: "sem-testes", codigo: code, saida };
      if (SEM_TESTES_RE.test(saida) && !FALHA_RE.test(saida)) return { status: "sem-testes", codigo: code, saida };
      return { status: "falhou", codigo: code, saida };
    };
    timers.push(
      setTimeout(() => {
        tempo = true;
        matar();
        timers.push(setTimeout(() => terminar({ status: "tempo", codigo: null, saida }), ESPERA_APOS_MATAR_MS));
      }, Math.max(1, Number(timeoutSegundos) || 300) * 1000),
    );
    child.on("error", (e) => terminar({ status: "falhou", codigo: null, saida: `${saida}\n${e.message}` }));
    child.on("exit", (code) => timers.push(setTimeout(() => terminar(porCodigo(code)), ESPERA_SAIDA_MS)));
    child.on("close", (code) => terminar(porCodigo(code)));
  });
}

/**
 * Resolve o comando, roda a suíte e registra o resultado no estado local.
 * Usado pela trava de push e pela CLI registrar-testes, para que os dois decidam igual.
 * - passou: grava `tests-ok.json` para o HEAD (só com a árvore limpa, senão o que passou não é
 *   o HEAD) e vira a linha de base para "passando" se ela estava "falhando".
 * opts.timeoutMaxSegundos: teto do tempo (a trava de push usa 570 s, abaixo dos 600 s do hook).
 * opts.registrar: false para só rodar (a suíte rodou na pasta, não num commit).
 * opts.arvore: com `registrar: false`, a árvore da pasta (calculada ANTES da suíte) a registrar
 *   no lugar do commit, para o commit que vem na mesma linha não precisar rodar a suíte de novo.
 * @returns {Promise<{status: "sem-testes"|"passou"|"falhou"|"tempo", comando?: string,
 *   codigo?: number|null, saida?: string, sha?: string|null, registrado?: boolean}>}
 */
export async function executarERegistrar(root, config, opts = {}) {
  const comando = resolveTestCommand(root, config);
  if (!comando) return { status: "sem-testes" };
  const sha = headSha(root);
  const timeout = tempoLimite(config, opts.timeoutMaxSegundos);
  const r = await rodarSuite(root, comando, timeout, opts);
  if (r.status !== "passou") return { ...r, comando, sha, registrado: false, timeout };
  if (opts.registrar === false) {
    if (opts.arvore) registrarTestsOk(root, null, comando, new Date(), opts.arvore);
    return { ...r, comando, sha, registrado: false, timeout };
  }
  const limpo = isClean(root) === true;
  const registrado = Boolean(sha && limpo);
  if (registrado) registrarTestsOk(root, sha, comando);
  if (linhaDeBaseEfetiva(root, config) === "falhando") registrarLinhaDeBasePassando(root, sha);
  return { ...r, comando, sha, registrado, timeout };
}

/** Tempo da suíte em segundos: `testes.timeoutSegundos` (padrão 300), limitado por `max`. */
export function tempoLimite(config, max = Infinity) {
  const t = Number(config?.testes?.timeoutSegundos) || 300;
  return Math.min(t, max);
}
