/**
 * Reconhece comandos que publicam (ou mexem em dado/esquema de produção). Compartilhado pela
 * trava de deploy (antes) e pelo registro de deploy (depois).
 *
 * - `npm|pnpm|yarn|bun run <script>`: lê o corpo do script no package.json (e o `pre`/`post`
 *   dele) e classifica pelo que ele roda. Corpo com ferramenta conhecida decide sozinho
 *   (`deploy:preview` = `wrangler versions upload` não é deploy); corpo sem ferramenta conhecida (`node scripts/deploy.mjs`, `firebase deploy`, `fly deploy`) conta
 *   como deploy de corpo desconhecido quando o NOME é `deploy|release|publish[...]` (sem `local`
 *   no nome e sem `--local`/`--dry-run` no corpo). O nome `deploy|release|publish|db:migrate[...]`
 *   também conta quando o corpo é desconhecido (sem package.json, script inexistente, `ssh`).
 * - `wrangler --env|-e <dev|staging|preview|hml|qa|test...>`: ambiente de teste não é produção;
 *   pede confirmação do ambiente (`brando`), sem as checagens de main/commit/testes.
 * - script de arquivo ou alvo do make com nome de deploy (`./deploy.sh`, `bash scripts/release.sh`,
 *   `make deploy`): corpo desconhecido, conta como deploy.
 * - `docker compose up` só é deploy dentro de `ssh host '...'`; local é ambiente de dev.
 * - `destrutivo`: apaga ou reescreve produção sem volta (`wrangler delete`, `supabase db reset
 *   --linked`, `psql -f`...): a trava sempre pede confirmação, mesmo na main em dia.
 * - `brando`: consulta ou alteração pontual em banco de produção (`wrangler d1 execute --remote`,
 *   `psql` remoto só lendo): pede confirmação do alvo com a mensagem de `aviso`, sem as checagens
 *   de git; `somenteLeitura` não vai para o registro de deploys.
 * - `depoisDe`: um comando anterior na mesma linha troca o commit ou a pasta (`git pull`,
 *   `gh pr checkout`, `git stash pop`, `git restore`, `git apply`... `&& wrangler deploy`).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { gitCallOf, parseCommands } from "./shell.mjs";

/** Subcomandos do git que mudam o commit (ou a árvore) antes de um deploy na mesma linha. */
const MOVE_HEAD = new Set(["pull", "merge", "switch", "checkout", "reset", "rebase", "cherry-pick", "revert", "commit", "am", "restore", "apply"]);
const SCRIPT_DE_DEPLOY = /^(deploy|release|publish|db:migrate)([:_-].*)?$/;
/** Nome de script que publica mesmo quando o corpo roda uma ferramenta desconhecida. */
const NOME_DE_DEPLOY = /^(deploy|release|publish)([:_-].*)?$/;
/** `wrangler --env <x>`: ambientes de teste (não são produção). */
const AMBIENTE_DE_TESTE = /^(dev|development|staging|stage|preview|hml|homolog|qa|test)/i;
/** Opções do wrangler que recebem valor (o valor não é subcomando). */
const WRANGLER_OPTS_WITH_ARG = new Set(["--env", "-e", "--config", "-c", "--cwd"]);
/** Arquivo de script ou alvo do make com nome de deploy: `deploy.sh`, `release-prod`, `publish`. */
const ARQUIVO_DE_DEPLOY = /^(deploy|release|publish)([._:-][\w.:-]*)?$/;
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const MAX_PROFUNDIDADE = 4;

/** Prefixos que executam um pacote: `npx wrangler`, `pnpm dlx wrangler`, `bunx`, `yarn exec`... */
const RUNNERS_DIRETOS = new Set(["npx", "bunx", "pnpx"]);
const RUNNERS_COM_SUB = { pnpm: ["dlx", "exec"], yarn: ["dlx", "exec"], npm: ["exec", "x"], bun: ["x"] };
const FERRAMENTAS = new Set(["wrangler", "vercel", "netlify", "supabase", "docker", "docker-compose", "psql"]);
const NPX_OPTS_WITH_ARG = new Set(["-p", "--package", "-c", "--call"]);

function nomeDoPacote(token) {
  // `wrangler@3`, `wrangler@latest` → wrangler; caminho → nome do arquivo
  const base = token.split("/").pop();
  return base.replace(/@.*$/, "");
}

/** Tira o executor de pacotes da frente. @returns {{tool: string, args: string[]}|null} */
function ferramentaDe(cmd) {
  let words = [cmd.name, ...cmd.args];
  const first = nomeDoPacote(words[0]);
  if (RUNNERS_DIRETOS.has(first)) {
    let i = 1;
    while (i < words.length && words[i].startsWith("-")) {
      if (NPX_OPTS_WITH_ARG.has(words[i])) i += 1;
      i += 1;
    }
    words = words.slice(i);
  } else if (RUNNERS_COM_SUB[first] && RUNNERS_COM_SUB[first].includes(words[1])) {
    let i = 2;
    while (i < words.length && words[i].startsWith("-")) i += 1;
    if (words[i] === "--") i += 1;
    words = words.slice(i);
  } else if ((first === "pnpm" || first === "yarn") && words[1] && FERRAMENTAS.has(nomeDoPacote(words[1]))) {
    words = words.slice(1);
  }
  if (!words.length) return null;
  return { tool: nomeDoPacote(words[0]), args: words.slice(1) };
}

function semFlags(args) {
  return args.filter((a) => !a.startsWith("-"));
}

/**
 * @typedef {{tipo: string, comando: string, dir: string, supabase: boolean, destrutivo?: boolean,
 *   brando?: boolean, aviso?: {oQue: string, porque: string, comoFazer: string},
 *   somenteLeitura?: boolean, remoto?: boolean, depoisDe?: string|null}} Deploy
 */

/** Palavra de volta ao texto de shell (para anexar argumentos ao corpo de um script). */
function citar(a) {
  return /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`;
}

/** `scripts` do package.json mais próximo (subindo a partir de `dir`). */
function scriptsDe(dir) {
  let d = dir;
  for (let i = 0; i < 30; i += 1) {
    const file = path.join(d, "package.json");
    if (existsSync(file)) {
      try {
        const s = JSON.parse(readFileSync(file, "utf8"))?.scripts;
        return { scripts: s && typeof s === "object" ? s : {}, dir: d };
      } catch {
        return null;
      }
    }
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
  return null;
}

function hostLocal(h) {
  return /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|::1|host\.docker\.internal)$/i.test(h) || h.startsWith("/"); // `/var/run/postgresql`: socket local
}

/** Host de uma URL `postgres://`. */
function hostDaUrl(u) {
  const m = /^postgres(?:ql)?:\/\/(?:[^@/]*@)?([^:/?]+)/.exec(u || "");
  return m ? m[1] : null;
}

const SQL_QUE_ESCREVE = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy)\b/i;

/**
 * `psql`: `"destrutivo"` aplicando arquivo (`-f`, `< arquivo`, pipe, heredoc) ou `-c` que escreve
 * em banco remoto (ou `-f` sem host explícito); `"leitura"` em banco remoto sem escrita; null no local.
 */
function psqlRisco(cmd, args) {
  const env = cmd.env || {};
  let host = null;
  let arquivo = false;
  // SQL pela entrada (`< dump.sql`, pipe, heredoc que escreve): conta só em banco remoto
  const entrada = cmd.pipedIn || cmd.redirects.some((r) => r.op === "<") || cmd.heredocs.some((h) => SQL_QUE_ESCREVE.test(h));
  let escreve = false;
  for (let i = 0; i < args.length; i += 1) {
    const t = args[i];
    if (t === "-f" || t === "--file" || t.startsWith("--file=") || /^-f./.test(t)) arquivo = true;
    const sql = t === "-c" || t === "--command" ? args[i + 1] : t.startsWith("--command=") ? t.slice(10) : /^-c./.test(t) ? t.slice(2) : null;
    if (typeof sql === "string" && SQL_QUE_ESCREVE.test(sql)) escreve = true;
    if (t === "-c" || t === "--command") {
      i += 1;
      continue;
    }
    if (t === "-h" || t === "--host") host = args[i + 1] ?? "";
    else if (t.startsWith("--host=")) host = t.slice(7);
    else if (/^-h./.test(t)) host = t.slice(2);
    const url = hostDaUrl(t);
    if (url) host = url;
    else if (/\bhost=([^\s]+)/.test(t)) host = /\bhost=([^\s]+)/.exec(t)[1];
    else if (/^["']?\$\{?DATABASE_URL\}?["']?$/.test(t) && typeof env.DATABASE_URL === "string" && hostDaUrl(env.DATABASE_URL)) host = hostDaUrl(env.DATABASE_URL);
    else if (/^["']?\$/.test(t) && !t.startsWith("-") && host === null) host = t; // `psql "$DATABASE_URL"`
  }
  // sem host na linha: o ambiente decide (`PGHOST=x psql`, `PGSERVICE=prod psql`, PGHOST da sessão)
  if (host === null) {
    if (env.PGHOST !== undefined) host = env.PGHOST ?? "$PGHOST";
    else if (env.PGSERVICE !== undefined) host = `service=${env.PGSERVICE ?? "$PGSERVICE"}`;
    else if (process.env.PGHOST) host = process.env.PGHOST;
  }
  const remoto = host !== null && !hostLocal(host);
  if (remoto) return arquivo || escreve || entrada ? "destrutivo" : "leitura";
  return arquivo && host === null ? "destrutivo" : null;
}

/** Opções globais do `docker compose` que recebem valor (antes do subcomando). */
const COMPOSE_OPTS_WITH_ARG = new Set(["-f", "--file", "-p", "--project-name", "--env-file", "--profile", "--project-directory", "--ansi", "--progress", "--parallel"]);

/** Primeiro subcomando do `docker compose` (pula as opções globais e seus valores). */
function subcomandoDoCompose(args) {
  for (let i = 0; i < args.length; i += 1) {
    const t = args[i];
    if (!t.startsWith("-")) return t;
    if (COMPOSE_OPTS_WITH_ARG.has(t)) i += 1;
  }
  return null;
}

const AVISO_BANCO = {
  oQue: "consulta ou alteração direta no banco de produção: confirme o alvo",
  porque: "comando pontual no banco remoto não passa pelo fluxo de deploy nem fica versionado; um alvo errado atinge dado real.",
  comoFazer: "confira o banco/ambiente alvo e o SQL; mudança de esquema vai por migração no repositório. Se estiver certo, confirme.",
};

/** Classifica um comando simples. @returns {Deploy|null} */
export function deployDe(cmd, profundidade = 0) {
  const base = nomeDoPacote(cmd.name);
  const mk = (tipo, extra = {}) => ({ tipo, comando: cmd.text, dir: cmd.dir, supabase: false, remoto: Boolean(cmd.remoto), ...extra });

  // scripts: npm run deploy, pnpm run deploy:prod, yarn deploy, bun run ship (corpo com wrangler deploy)
  if (["npm", "pnpm", "yarn", "bun"].includes(base)) {
    const a = cmd.args;
    const idx = a.findIndex((t) => t === "run" || t === "run-script");
    const script = idx >= 0 ? semFlags(a.slice(idx + 1))[0] : base === "yarn" || base === "pnpm" ? semFlags(a)[0] : undefined;
    if (script) {
      const pkg = cmd.remoto ? null : scriptsDe(cmd.dir);
      if (pkg && profundidade < MAX_PROFUNDIDADE && typeof pkg.scripts[script] === "string") {
        // corpo conhecido decide: o nome não conta (`db:migrate:local` com `--local` não é deploy)
        let extra = a.slice(a.indexOf(script, idx + 1) + 1);
        if (extra[0] === "--") extra = extra.slice(1);
        for (const nome of [`pre${script}`, script, `post${script}`]) {
          let corpo = pkg.scripts[nome];
          if (typeof corpo !== "string") continue;
          if (nome === script && extra.length) corpo = `${corpo} ${extra.map(citar).join(" ")}`;
          const [d] = deploysEmComandos(parseCommands(corpo, pkg.dir), profundidade + 1);
          if (d) return { ...d, tipo: `script ${script} (${d.tipo})`, comando: cmd.text, dir: cmd.dir, remoto: Boolean(cmd.remoto) };
        }
        // nenhuma ferramenta conhecida no corpo (`wrangler versions upload` é conhecida e não publica),
        // mas o nome diz que publica: corpo desconhecido, checagens completas
        if (NOME_DE_DEPLOY.test(script) && !/local/i.test(script)) {
          const corpos = [`pre${script}`, script, `post${script}`].map((n) => pkg.scripts[n]).filter((c) => typeof c === "string");
          const conhecida = corpos.some((c) => parseCommands(c, pkg.dir).some((sc) => FERRAMENTAS.has(ferramentaDe(sc)?.tool)));
          if (!conhecida && !/--(?:local|dry-run)\b/.test([...corpos, ...extra].join(" "))) return mk(`script ${script}`);
        }
        return null;
      }
      if (SCRIPT_DE_DEPLOY.test(script)) return mk(`script ${script}`);
    }
  }

  // `./deploy.sh`, `bash scripts/release.sh`, `make deploy`: corpo desconhecido, checagens completas
  if (!cmd.remoto) {
    const sh = SHELLS.has(base) ? semFlags(cmd.args)[0] : null;
    if (base === "make") {
      const alvo = cmd.args.find((t, i) => !t.startsWith("-") && !t.includes("=") && !["-C", "-f", "--directory", "--file", "-j", "--jobs"].includes(cmd.args[i - 1]));
      if (alvo && ARQUIVO_DE_DEPLOY.test(alvo)) return mk(`make ${alvo}`);
    } else if (sh && ARQUIVO_DE_DEPLOY.test(path.basename(sh))) {
      return mk(`script ${path.basename(sh)}`);
    } else if (cmd.name.includes("/") && ARQUIVO_DE_DEPLOY.test(base)) {
      return mk(`script ${base}`);
    }
  }

  const f = ferramentaDe(cmd);
  if (!f) return null;
  const { tool, args } = f;
  const pos = semFlags(args);
  const has = (...flags) => args.some((t) => flags.includes(t) || flags.some((fl) => t.startsWith(`${fl}=`)));
  if (has("--dry-run")) return null;

  if (tool === "wrangler") {
    // posicionais sem as opções e seus valores (`wrangler --env production deploy`)
    const wp = [];
    let ambiente = null;
    for (let i = 0; i < args.length; i += 1) {
      const t = args[i];
      if (t.startsWith("--env=")) ambiente = t.slice(6);
      if (WRANGLER_OPTS_WITH_ARG.has(t)) {
        if (t === "--env" || t === "-e") ambiente = args[i + 1] ?? null;
        i += 1;
      } else if (!t.startsWith("-")) wp.push(t);
    }
    const teste = typeof ambiente === "string" && AMBIENTE_DE_TESTE.test(ambiente);
    // ambiente de teste não é produção: confirma o ambiente, sem exigir main/commit/testes
    const publica = (tipo) =>
      teste
        ? mk(`${tipo} --env ${ambiente}`, {
            brando: true,
            aviso: {
              oQue: `deploy em ambiente de teste (${ambiente}): confirme`,
              porque: "ambiente de teste não é produção, então as checagens de main, commit e testes não se aplicam; um `--env` errado ainda publica no lugar errado.",
              comoFazer: "confira o `--env` e o worker/banco desse ambiente no wrangler.toml/wrangler.jsonc; se estiver certo, confirme. Produção segue pela main (limpa, enviada e testada).",
            },
          })
        : mk(tipo);
    if (wp[0] === "delete") return mk("wrangler delete", { destrutivo: true });
    if (wp[0] === "d1" && wp[1] === "delete") return mk("wrangler d1 delete", { destrutivo: true });
    if (wp[0] === "d1" && wp[1] === "time-travel" && wp[2] === "restore") return mk("wrangler d1 time-travel restore", { destrutivo: true });
    if (wp[0] === "deploy" || wp[0] === "publish") return publica("wrangler deploy");
    if (wp[0] === "versions" && wp[1] === "deploy") return publica("wrangler versions deploy");
    if (wp[0] === "pages" && wp[1] === "deploy") return publica("wrangler pages deploy");
    // dado/esquema de produção: só com --remote (sem ele é o banco local)
    if (wp[0] === "d1" && has("--remote")) {
      if (wp[1] === "migrations" && wp[2] === "apply") return publica("wrangler d1 migrations apply --remote");
      if (wp[1] === "execute") return mk("wrangler d1 execute --remote", { brando: true, aviso: AVISO_BANCO });
    }
    return null;
  }
  if (tool === "vercel") {
    const prod = has("--prod", "--production") || args.some((t, i) => t === "--target" && args[i + 1] === "production") || args.includes("--target=production");
    if (prod && (pos.length === 0 || pos[0] === "deploy" || !["env", "link", "pull", "dev", "build", "logs", "ls", "list", "inspect", "domains", "alias"].includes(pos[0]))) return mk("vercel --prod");
    return null;
  }
  if (tool === "netlify") {
    if (pos[0] === "deploy" && has("--prod", "--prod-if-unlocked")) return mk("netlify deploy --prod");
    return null;
  }
  if (tool === "supabase") {
    if (pos[0] === "functions" && pos[1] === "deploy") return mk("supabase functions deploy", { supabase: true });
    if (pos[0] === "db" && pos[1] === "push") return mk("supabase db push", { supabase: true });
    const remoto = has("--linked", "--db-url");
    if (pos[0] === "db" && pos[1] === "reset" && remoto) return mk("supabase db reset (banco remoto)", { supabase: true, destrutivo: true });
    if (pos[0] === "migration" && pos[1] === "up" && has("--linked")) return mk("supabase migration up --linked", { supabase: true, destrutivo: true });
    if (pos[0] === "migration" && pos[1] === "repair") return mk("supabase migration repair", { supabase: true, destrutivo: true });
    return null;
  }
  if (tool === "psql") {
    const risco = psqlRisco(cmd, args);
    if (risco === "destrutivo") return mk("psql em banco remoto", { destrutivo: true });
    if (risco === "leitura") {
      return mk("psql em banco remoto", {
        brando: true,
        somenteLeitura: true,
        aviso: { ...AVISO_BANCO, oQue: "consulta a um banco remoto: confirme o alvo", porque: "o banco remoto costuma ser o de produção, com dado real de clientes." },
      });
    }
    return null;
  }
  if (tool === "docker" || tool === "docker-compose") {
    if (tool === "docker" && (pos[0] === "push" || (pos[0] === "image" && pos[1] === "push"))) return mk("docker push");
    if (tool === "docker" && pos[0] === "stack" && pos[1] === "deploy") return mk("docker stack deploy");
    // compose local é ambiente de dev; só `up` dentro de `ssh host '...'` publica
    const compose = tool === "docker-compose" ? args : pos[0] === "compose" ? args.slice(args.indexOf("compose") + 1) : null;
    if (compose && cmd.remoto && subcomandoDoCompose(compose) === "up") return mk("docker compose up");
    return null;
  }
  return null;
}

/** Comando que troca o commit ou mexe na pasta (o deploy depois dele não seria o conferido). */
function trocaCodigo(cmd) {
  if (cmd.base === "gh" && !cmd.remoto && cmd.args[0] === "pr" && cmd.args[1] === "checkout") return true;
  const call = gitCallOf(cmd);
  if (!call) return false;
  if (call.sub === "stash") return ["pop", "apply"].includes(call.args[0]);
  return MOVE_HEAD.has(call.sub);
}

/** Deploys numa sequência de comandos, marcando os que vêm depois de algo que troca o código. */
function deploysEmComandos(cmds, profundidade = 0) {
  const out = [];
  let moveu = null;
  for (const cmd of cmds) {
    if (trocaCodigo(cmd)) {
      moveu = moveu || cmd.text;
      continue;
    }
    const d = deployDe(cmd, profundidade);
    if (d) out.push({ ...d, depoisDe: d.depoisDe || moveu });
  }
  return out;
}

/** Todos os deploys de uma linha de comando. @returns {Deploy[]} */
export function deploysNoComando(command, cwd) {
  return deploysEmComandos(parseCommands(command, cwd));
}

/**
 * Esconde credenciais de um comando antes de registrá-lo ou mostrá-lo: valores de `--token`,
 * `--api-token`, `--db-url`, `--password`, `-p` e a senha de URLs `usuario:senha@host`.
 */
export function mascararComando(texto) {
  return String(texto)
    .replace(/(--(?:token|api-token|db-url|password)(?:=|\s+))(\S+)/g, "$1***")
    .replace(/((?:^|\s)-p\s*)(\S+)/g, "$1***")
    .replace(/(\/\/[^\s:/@]+:)[^\s@/]+@/g, "$1***@");
}
