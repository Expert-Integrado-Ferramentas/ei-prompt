#!/usr/bin/env node
/**
 * Trava 1 — branch protegida (PreToolUse, Bash).
 *
 * Bloqueia: commit numa branch protegida (e o que cria commit: `cherry-pick`, `revert` sem
 * `--no-commit`, `am`, `rebase` que não seja sincronizar com o próprio remoto); push cujo destino
 * é protegido (em qualquer grafia: `main`, `HEAD:main`, `x:refs/heads/main`, `:main`, `@`,
 * `--all`, `--mirror`, `git push` puro estando na main; destino calculado na execução —
 * `$(...)`, `$VAR` — vale como a branch atual, e como protegida se o HEAD é desconhecido);
 * merge/pull de outra branch estando numa protegida; push forçado (`--force`, `-f`, `+refspec`)
 * em qualquer branch. `--force-with-lease` é liberado fora das protegidas. `git push` sem refspec
 * (`git push`, `git push origin`, `--follow-tags`) numa protegida que NÃO está à frente do upstream
 * não envia commit nenhum para ela: passa. `gh pr merge` é a porta certa; com `--admin` (pula a
 * proteção da branch no GitHub) pede confirmação.
 * Também bloqueia, em qualquer branch, `git reset --hard` e `git clean` com `-f`/`--force` em
 * qualquer posição (apagam trabalho sem volta; o caminho é `git stash`).
 * PEDE CONFIRMAÇÃO no que descarta trabalho não commitado e às vezes é o pedido da pessoa:
 * `git restore` (não só `--staged`) de `.`, `:/` ou pasta com alteração; `git checkout [--] .|:/`;
 * `git stash clear|drop`; `git worktree remove --force|-f`.
 *
 * Origem: guard-merge-target do Maestro. O destino de `git merge` é o HEAD, que não aparece no
 * texto do comando; por isso a trava SIMULA o HEAD ao longo dos comandos encadeados
 * (`git checkout main && git merge x` é pego mesmo com o HEAD real ainda em outra branch).
 */
import { statSync } from "node:fs";
import path from "node:path";

import { loadConfig } from "./lib/config.mjs";
import {
  aFrenteDoUpstream,
  currentBranch,
  git,
  hasCommits,
  localBranchExists,
  remoteBranchExists,
  repoRoot,
} from "./lib/git.mjs";
import { ask, deny, mensagem, runHook } from "./lib/output.mjs";
import { gitCalls, parseCommands, shortFlags } from "./lib/shell.mjs";

const CHECKOUT_CREATE_FLAGS = new Set(["-b", "-B", "-c", "-C", "--create", "--force-create", "--orphan"]);
const WORKTREE_CREATE_FLAGS = new Set(["-b", "-B", "--branch"]);
const MERGE_NON_START = new Set(["--abort", "--continue", "--quit", "--skip"]);
const MERGE_OPTS_WITH_ARG = new Set(["-m", "-F", "-s", "-X", "--strategy", "--strategy-option", "--file", "--message", "--into-name", "--cleanup", "-S"]);
const PULL_OPTS_WITH_ARG = new Set(["-s", "-X", "--strategy", "--strategy-option", "--depth", "--deepen", "--shallow-since", "--shallow-exclude", "-j", "--jobs", "--upload-pack", "-o", "--server-option", "--recurse-submodules"]);
const PUSH_OPTS_WITH_ARG = new Set(["--repo", "--exec", "--receive-pack", "-o", "--push-option"]);
/** Saídas de uma operação em andamento: não criam commit novo. */
const SEQUENCER_NON_START = new Set(["--abort", "--continue", "--quit", "--skip", "--show-current-patch"]);
const REBASE_OPTS_WITH_ARG = new Set(["--onto", "-s", "-X", "--strategy", "--strategy-option", "-x", "--exec", "-C", "--whitespace"]);
/** Destino que só se conhece na execução (`$(...)`, crase, `$VAR`, `${VAR}`). */
const DINAMICO = /\$|`/;
/** Referências que significam "a própria branch no remoto" (sincronizar, não trazer trabalho alheio). */
const SYNC_REFS = new Set(["@{u}", "@{upstream}", "@{push}", "FETCH_HEAD", "ORIG_HEAD"]);

/**
 * Reduz uma referência ao nome de branch que ela designa: `+refs/heads/main`,
 * `origin/main` e `main` viram `main` (para as protegidas).
 */
export function branchOf(ref, protegidas) {
  if (typeof ref !== "string") return "";
  let name = ref.trim();
  if (name.startsWith("+")) name = name.slice(1);
  name = name.replace(/^refs\/heads\//, "").replace(/^heads\//, "");
  const remote = /^refs\/remotes\/[^/]+\/(.+)$/.exec(name);
  if (remote) name = remote[1];
  const slash = name.indexOf("/");
  if (slash > 0) {
    const tail = name.slice(slash + 1);
    if (protegidas.has(tail)) return tail;
  }
  return name;
}

function headAfterCheckout(rest, dir, sub) {
  if (rest.includes("--detach") || rest.includes("-d") && sub === "switch") return { head: null };
  const dashDash = rest.indexOf("--");
  const args = dashDash >= 0 ? rest.slice(0, dashDash) : rest;
  if (dashDash >= 0 && args.filter((t) => !t.startsWith("-")).length === 0) return undefined;
  for (let i = 0; i < args.length; i += 1) {
    const t = args[i];
    const eq = t.indexOf("=");
    if (eq > 0 && CHECKOUT_CREATE_FLAGS.has(t.slice(0, eq))) return { head: t.slice(eq + 1) };
    if (CHECKOUT_CREATE_FLAGS.has(t) && args[i + 1] && !args[i + 1].startsWith("-")) return { head: args[i + 1] };
  }
  const posicionais = args.filter((t) => !t.startsWith("-"));
  const positional = posicionais[0];
  if (!positional) return undefined;
  // `git checkout <ref> -- <arquivos>` ou `git checkout <ref> <arquivos>`: restaura arquivos, o HEAD fica
  if (sub === "checkout" && (dashDash >= 0 || posicionais.length > 1)) return undefined;
  if (positional === "-") {
    const prev = (git(dir, ["rev-parse", "--abbrev-ref", "@{-1}"]) || "").trim();
    return { head: prev || null };
  }
  if (sub === "switch") return { head: positional };
  // `git checkout <x>`: só move o HEAD se <x> for branch; senão é restauração de arquivo.
  if (localBranchExists(dir, positional) || remoteBranchExists(dir, positional)) return { head: positional };
  if (positional.includes("/") && !positional.startsWith(".")) return { head: positional };
  return undefined;
}

/**
 * Destinos que um `git push` escreveria no remoto.
 * @returns {{destinos: string[], forcado: boolean, comLease: boolean, tudo: boolean}}
 */
export function analisarPush(rest, head, protegidaPadrao = "main") {
  const positional = [];
  let forcado = false;
  let comLease = false;
  let tudo = false;
  let apagando = false;
  let soTags = false;
  let remoteViaFlag = false;
  for (let i = 0; i < rest.length; i += 1) {
    const t = rest[i];
    if (t === "--") continue;
    if (t.startsWith("--")) {
      if (t === "--force") forcado = true;
      if (t.startsWith("--force-with-lease") || t === "--force-if-includes") comLease = true;
      if (t === "--all" || t === "--mirror" || t === "--branches") tudo = true;
      if (t === "--delete") apagando = true;
      if (t === "--tags") soTags = true;
      if (t === "--repo" || t.startsWith("--repo=")) remoteViaFlag = true;
      if (PUSH_OPTS_WITH_ARG.has(t) && rest[i + 1] !== undefined) i += 1;
      continue;
    }
    if (t.startsWith("-") && t.length > 1) {
      const flags = shortFlags(t);
      if (flags.includes("f")) forcado = true;
      if (flags.includes("d")) apagando = true;
      if (PUSH_OPTS_WITH_ARG.has(t) && rest[i + 1] !== undefined) i += 1;
      continue;
    }
    positional.push(t);
  }
  const refspecs = remoteViaFlag ? positional : positional.slice(1);
  if (refspecs.some((r) => r.startsWith("+"))) forcado = true;
  const semRefspec = refspecs.length === 0;
  let destinos;
  if (refspecs.length === 0) {
    destinos = soTags || tudo ? [] : head ? [head] : [];
  } else if (apagando) {
    destinos = refspecs;
  } else {
    destinos = refspecs.map((spec) => {
      if (DINAMICO.test(spec) && !spec.includes(":")) return head || protegidaPadrao; // `git push origin "$B"`
      const colon = spec.lastIndexOf(":");
      let dst = colon < 0 ? spec : spec.slice(colon + 1) || spec.slice(0, colon);
      const nome = dst.replace(/^\+/, "");
      if (nome === "HEAD" || nome === "@" || DINAMICO.test(nome)) dst = head || protegidaPadrao;
      return dst;
    });
  }
  return { destinos, forcado, comLease, tudo, apagando, semRefspec };
}

function positionals(rest, optsWithArg) {
  const out = [];
  for (let i = 0; i < rest.length; i += 1) {
    const t = rest[i];
    if (t.startsWith("-")) {
      if (optsWithArg.has(t)) i += 1;
      continue;
    }
    out.push(t);
  }
  return out;
}

/**
 * Violações que um comando cometeria, simulando o HEAD por repositório.
 * @param {string} command
 * @param {string} cwd
 * @param {{protegidas?: string[]}} [opts]
 * @returns {{tipo: string, alvo: string, comando: string}[]}
 */
export function violacoes(command, cwd, opts = {}) {
  const heads = new Map(); // chave do repo -> {head} simulado
  const roots = new Map();
  const configs = new Map();
  const keyOf = (dir) => {
    if (!roots.has(dir)) roots.set(dir, repoRoot(dir) || dir);
    return roots.get(dir);
  };
  const protegidasDe = (dir) => {
    if (opts.protegidas) return new Set(opts.protegidas);
    const key = keyOf(dir);
    if (!configs.has(key)) configs.set(key, new Set(loadConfig(repoRoot(dir)).config.branchesProtegidas));
    return configs.get(key);
  };
  const headAt = (dir) => {
    const key = keyOf(dir);
    if (!heads.has(key)) heads.set(key, { head: currentBranch(dir), simulado: false });
    return heads.get(key);
  };

  const out = [];
  for (const call of gitCalls(command, cwd)) {
    const { sub, args, dir } = call;
    const protegidas = protegidasDe(dir);
    const isProt = (ref) => protegidas.has(branchOf(ref, protegidas));
    const texto = call.cmd.text;

    if (sub === "checkout" || sub === "switch") {
      const moved = headAfterCheckout(args, dir, sub);
      if (moved !== undefined) heads.set(keyOf(dir), { head: moved.head && branchOf(moved.head, protegidas), simulado: true });
      continue;
    }
    if (sub === "worktree" && args[0] === "add") {
      let created = null;
      const pos = [];
      for (let i = 1; i < args.length; i += 1) {
        const t = args[i];
        if (WORKTREE_CREATE_FLAGS.has(t) && args[i + 1]) {
          created = args[i + 1];
          i += 1;
        } else if (!t.startsWith("-")) pos.push(t);
      }
      if (pos[0]) {
        const wt = path.resolve(dir, pos[0]);
        roots.set(wt, wt);
        heads.set(wt, { head: branchOf(created || pos[1] || "", protegidas) || null, simulado: true });
      }
      continue;
    }

    if (sub === "reset" && args.includes("--hard")) {
      out.push({ tipo: "destrutivo", alvo: "reset --hard", comando: texto });
      continue;
    }
    if (sub === "clean" && args.some((t) => t === "--force" || (!t.startsWith("--") && shortFlags(t).includes("f")))) {
      out.push({ tipo: "destrutivo", alvo: "clean -f", comando: texto });
      continue;
    }

    const state = headAt(dir);
    const head = state.head;

    if (["cherry-pick", "revert", "am", "rebase"].includes(sub)) {
      if (!head || !isProt(head) || args.some((t) => SEQUENCER_NON_START.has(t))) continue;
      if (sub === "revert" && args.some((t) => t === "--no-commit" || (!t.startsWith("--") && shortFlags(t).includes("n")))) continue;
      if (sub === "rebase") {
        // `git rebase` puro ou com o próprio remoto (`origin/main`, `@{u}`) só sincroniza a main local
        const [upstream] = positionals(args, REBASE_OPTS_WITH_ARG);
        if (!args.some((t) => t === "-i" || t === "--interactive" || t === "--onto" || t === "--root")) {
          if (upstream === undefined || SYNC_REFS.has(upstream) || branchOf(upstream, protegidas) === branchOf(head, protegidas)) continue;
        }
      }
      out.push({ tipo: "commit", alvo: branchOf(head, protegidas), comando: texto });
      continue;
    }

    if (sub === "commit") {
      if (!head || !isProt(head)) continue;
      if (!state.simulado && !hasCommits(dir)) continue; // primeiro commit de um repositório novo
      out.push({ tipo: "commit", alvo: branchOf(head, protegidas), comando: texto });
      state.commitou = true;
      continue;
    }
    if (sub === "merge") {
      if (args.some((t) => MERGE_NON_START.has(t))) continue;
      const fontes = positionals(args, MERGE_OPTS_WITH_ARG);
      if (fontes.length === 0 || !head || !isProt(head)) continue;
      const alheia = fontes.some((f) => !SYNC_REFS.has(f) && branchOf(f, protegidas) !== branchOf(head, protegidas));
      if (alheia) out.push({ tipo: "merge", alvo: branchOf(head, protegidas), comando: texto });
      continue;
    }
    if (sub === "pull") {
      if (!head || !isProt(head)) continue;
      const refs = positionals(args, PULL_OPTS_WITH_ARG).slice(1);
      if (refs.some((r) => branchOf(r.split(":")[0], protegidas) !== branchOf(head, protegidas))) {
        out.push({ tipo: "pull", alvo: branchOf(head, protegidas), comando: texto });
      }
      continue;
    }
    if (sub === "push") {
      const p = analisarPush(args, head, [...protegidas][0] || "main");
      if (p.forcado) {
        out.push({ tipo: "force", alvo: p.destinos.map((d) => branchOf(d, protegidas)).join(", "), comando: texto });
        continue;
      }
      if (p.tudo) {
        out.push({ tipo: "push-tudo", alvo: [...protegidas].join(", "), comando: texto });
        continue;
      }
      const alvo = p.destinos.find((d) => isProt(d));
      // `git push`/`git push origin`/`--follow-tags` na protegida em dia com o upstream: não envia
      // commit nenhum para ela (só sincroniza tags ou não faz nada)
      if (alvo && !p.apagando && !p.comLease && p.semRefspec && head && !state.commitou && aFrenteDoUpstream(dir, head) === 0) continue;
      if (alvo) out.push({ tipo: p.apagando ? "push-delete" : "push", alvo: branchOf(alvo, protegidas), comando: texto });
    }
  }
  return out;
}

/** Pasta do repositório tem alteração rastreada (no índice ou na pasta) dentro de `specs`? null se o git falhou. */
function temAlteracao(dir, specs) {
  const out = git(dir, ["status", "--porcelain", "--untracked-files=no", "--", ...specs]);
  return out === null ? null : out.trim().length > 0;
}

function ehPasta(dir, spec) {
  try {
    return statSync(path.resolve(dir, spec)).isDirectory();
  } catch {
    return false;
  }
}

/** Pathspec amplo (`.`, `:/`, `./`, pasta) que descarta tudo de uma vez. */
function amplo(dir, spec) {
  return spec === "." || spec === "./" || spec === ":/" || spec === ":(top)" || spec === "*" || ehPasta(dir, spec);
}

const RESTORE_OPTS_WITH_ARG = new Set(["-s", "--source", "--pathspec-from-file", "--conflict", "--inline"]);

/**
 * Comandos que descartam trabalho não commitado e às vezes são o pedido da pessoa: pedem
 * confirmação (não bloqueiam). `git restore --staged` (só tira do índice) e restaurar arquivo
 * pontual passam.
 * @returns {{comando: string, oQue: string}[]}
 */
export function descartes(command, cwd) {
  const out = [];
  for (const call of gitCalls(command, cwd)) {
    const { sub, args, dir } = call;
    const texto = call.cmd.text;
    if (sub === "restore") {
      const curtas = args.filter((a) => /^-[A-Za-z]+$/.test(a)).flatMap(shortFlags);
      const staged = args.includes("--staged") || curtas.includes("S");
      const worktree = args.includes("--worktree") || curtas.includes("W");
      if (staged && !worktree) continue; // só tira do índice: o trabalho continua na pasta
      const specs = [];
      for (let i = 0; i < args.length; i += 1) {
        const t = args[i];
        if (t === "--") {
          specs.push(...args.slice(i + 1));
          break;
        }
        if (t.startsWith("-")) {
          if (RESTORE_OPTS_WITH_ARG.has(t)) i += 1;
          continue;
        }
        specs.push(t);
      }
      const largos = specs.filter((s) => amplo(dir, s));
      if (largos.length && temAlteracao(dir, largos) !== false) out.push({ comando: texto, oQue: `descarta as alterações não commitadas de \`${largos.join(" ")}\`` });
      continue;
    }
    if (sub === "checkout") {
      const dd = args.indexOf("--");
      const specs = dd >= 0 ? args.slice(dd + 1) : args.filter((a) => !a.startsWith("-"));
      const largos = specs.filter((s) => s === "." || s === "./" || s === ":/" || s === ":(top)");
      if (largos.length && temAlteracao(dir, largos) !== false) out.push({ comando: texto, oQue: `descarta as alterações não commitadas de \`${largos.join(" ")}\`` });
      continue;
    }
    if (sub === "stash" && (args[0] === "clear" || args[0] === "drop")) {
      out.push({ comando: texto, oQue: args[0] === "clear" ? "apaga todos os stashes" : "apaga um stash" });
      continue;
    }
    if (sub === "worktree" && args[0] === "remove" && args.some((a) => a === "--force" || a === "-f" || /^-f+$/.test(a))) {
      out.push({ comando: texto, oQue: "remove uma worktree mesmo com alterações não commitadas" });
    }
  }
  return out;
}

/** `gh pr merge --admin`: mescla pulando as regras de proteção da branch no GitHub. */
function mergeAdmin(command, cwd) {
  if (!/\bgh\b/.test(command)) return null;
  for (const cmd of parseCommands(command, cwd)) {
    if (cmd.base === "gh" && cmd.args[0] === "pr" && cmd.args[1] === "merge" && cmd.args.includes("--admin")) return cmd.text;
  }
  return null;
}

const TRAVA = "branch protegida";
const PR = "crie uma branch no padrão tipo/descricao (ex.: `git switch -c feat/descricao-curta`, que leva junto as alterações ainda não commitadas), faça o commit nela, envie com `git push -u origin <branch>` e abra um PR com `gh pr create`; o merge acontece pelo PR (`gh pr merge`).";

export function mensagemPara(v) {
  switch (v.tipo) {
    case "commit":
      return mensagem({
        trava: TRAVA,
        oQue: `Bloqueado: commit direto na branch protegida \`${v.alvo}\`${/^git( .*)? commit\b/.test(v.comando) ? "" : ` (\`${v.comando}\` cria commit)`}.`,
        porque: `a \`${v.alvo}\` só recebe código por pull request, para ficar sempre num estado revisado e fácil de desfazer.`,
        comoFazer: PR,
      });
    case "merge":
    case "pull":
      return mensagem({
        trava: TRAVA,
        oQue: `Bloqueado: \`git ${v.tipo}\` traria outra branch para dentro da \`${v.alvo}\` (\`${v.comando}\`).`,
        porque: `merge na \`${v.alvo}\` sem PR não deixa rastro de revisão nem um ponto claro para desfazer.`,
        comoFazer: `abra um PR da sua branch para a \`${v.alvo}\` (\`gh pr create\`) e mescle por ele (\`gh pr merge\`). Para só atualizar a \`${v.alvo}\` local, use \`git pull\` sem argumentos.`,
      });
    case "push":
      return mensagem({
        trava: TRAVA,
        oQue: `Bloqueado: push com destino na branch protegida \`${v.alvo}\` (\`${v.comando}\`).`,
        porque: `a \`${v.alvo}\` só recebe código por pull request, para ficar sempre num estado revisado e fácil de desfazer.`,
        comoFazer: PR,
      });
    case "push-delete":
      return mensagem({
        trava: TRAVA,
        oQue: `Bloqueado: apagar a branch protegida \`${v.alvo}\` no remoto.`,
        porque: `a \`${v.alvo}\` é a referência do que está publicado; apagá-la quebra o fluxo de todos.`,
        comoFazer: "apague só a sua branch de trabalho (`git push origin --delete tipo/descricao`).",
      });
    case "push-tudo":
      return mensagem({
        trava: TRAVA,
        oQue: `Bloqueado: \`${v.comando}\` envia todas as branches, inclusive as protegidas (${v.alvo}).`,
        porque: "push em massa pode escrever na main sem passar por pull request.",
        comoFazer: "envie só a sua branch: `git push -u origin <sua-branch>`.",
      });
    case "destrutivo":
      return mensagem({
        trava: "comando destrutivo",
        oQue: `Bloqueado: \`${v.comando}\` apaga alterações sem volta (\`git ${v.alvo}\`).`,
        porque: "o que não foi commitado some de vez: não há histórico nem lixeira para recuperar.",
        comoFazer: "guarde as alterações com `git stash -u` (voltam com `git stash pop`); para desfazer um commit, use `git revert <sha>` ou `git reset --soft`. Se é isso mesmo que a pessoa quer, peça para ela rodar o comando no terminal.",
      });
    case "force":
    default:
      return mensagem({
        trava: TRAVA,
        oQue: `Bloqueado: push forçado (\`${v.comando}\`).`,
        porque: "`--force`, `-f` e `+refspec` sobrescrevem o histórico remoto e podem apagar trabalho de outra pessoa.",
        comoFazer: "se precisa mesmo reescrever a SUA branch (ex.: depois de um rebase), use `git push --force-with-lease`, que só sobrescreve se ninguém mais enviou nada; numa branch protegida, nunca.",
      });
  }
}

export function decide(payload) {
  if (payload.tool_name !== "Bash") return null;
  const command = payload.tool_input?.command;
  if (typeof command !== "string" || !/git|\bgh\b/.test(command)) return null;
  const cwd = payload.cwd || process.cwd();
  const found = command.includes("git") ? violacoes(command, cwd) : [];
  if (found.length) return deny(mensagemPara(found[0]));
  const admin = mergeAdmin(command, cwd);
  if (admin) {
    return ask(
      mensagem({
        trava: TRAVA,
        oQue: `Confirme: \`${admin}\` mescla com \`--admin\`, pulando as regras de proteção da branch no GitHub.`,
        porque: "o `--admin` passa por cima de revisão obrigatória e checagens exigidas; é para emergência, não para o dia a dia.",
        comoFazer: "mescle sem `--admin` (`gh pr merge --squash`) e, se algo exigido estiver pendente, resolva primeiro. Se é emergência combinada com a pessoa, confirme.",
      }),
    );
  }
  const descarta = command.includes("git") ? descartes(command, cwd) : [];
  if (descarta.length) {
    return ask(
      mensagem({
        trava: "comando destrutivo",
        oQue: `Confirme: \`${descarta[0].comando}\` ${descarta[0].oQue}.`,
        porque: "o que não foi commitado (ou o stash apagado) não tem histórico nem lixeira para recuperar.",
        comoFazer: "se não foi a pessoa que pediu para descartar, guarde antes com `git stash -u` (voltam com `git stash pop`) ou restaure só o arquivo certo. Se é isso mesmo, confirme.",
      }),
    );
  }
  return null;
}

runHook(import.meta.url, decide);
