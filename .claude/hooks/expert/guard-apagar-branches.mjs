#!/usr/bin/env node
/**
 * Trava 7 — apagar várias branches (PreToolUse, Bash).
 *
 * `git branch -d` (sem forçar) não conta: o próprio git recusa apagar branch não mesclada.
 * Contam as exclusões que perdem trabalho: `git branch -D` (ou `--delete --force`, `-df`),
 * `git push <remoto> --delete ...`, `git push <remoto> :a :b` e `git worktree remove`.
 *   - BLOQUEIA exclusão alimentada por lista gerada: `| xargs`, `$(...)`, crase, laço for/while
 *     (ex.: `git for-each-ref ... | xargs git branch -D`): quem aprova não lê o que vai sumir;
 *   - PEDE CONFIRMAÇÃO acima de 3 refs escritas na chamada (a pessoa confere a lista).
 *
 * Apagar a branch protegida (`main`/`master`), local ou remota, com ou sem força, sempre pede
 * confirmação: nem `git branch -d` livra, porque ela pode estar mesclada em outra branch.
 *
 * Origem: mass-branch-delete do Maestro (um agente apagou 138 branches ao "verificar" a limpeza).
 */
import { loadConfig } from "./lib/config.mjs";
import { repoRoot } from "./lib/git.mjs";
import { ask, deny, mensagem, runHook } from "./lib/output.mjs";
import { gitCalls, shortFlags } from "./lib/shell.mjs";

export const MAX_REFS = 3;

const BRANCH_OPTS_WITH_ARG = new Set(["--sort", "--format", "--contains", "--no-contains", "--merged", "--no-merged", "--points-at"]);

function isDelecaoDeBranch(t) {
  if (t === "--delete") return true;
  if (t.startsWith("--")) return false;
  const f = shortFlags(t);
  return f.includes("d") || f.includes("D");
}

/** `-D`, `-df`, `--delete --force`: apaga mesmo sem estar mesclada. */
function isForcada(args) {
  return args.some((t) => t === "--force" || (!t.startsWith("--") && (shortFlags(t).includes("D") || shortFlags(t).includes("f"))));
}

/**
 * Exclusões de uma linha de comando.
 * @returns {{tipo: string, refs: string[], gerada: boolean, leve: boolean}[]}
 */
export function exclusoes(command, cwd) {
  const out = [];
  for (const call of gitCalls(command, cwd)) {
    const { sub, args, argItems } = call;
    let refs = null;
    let tipo = null;
    let itens = [];
    let leve = false;
    if (sub === "branch" && args.some(isDelecaoDeBranch)) {
      leve = !isForcada(args); // `-d` puro: o git recusa o que não foi mesclado (só conta para a protegida)
      tipo = "git branch -D";
      refs = [];
      for (let k = 0; k < args.length; k += 1) {
        const t = args[k];
        if (t.startsWith("-")) {
          if (BRANCH_OPTS_WITH_ARG.has(t)) k += 1;
          continue;
        }
        refs.push(t);
        itens.push(argItems[k]);
      }
    } else if (sub === "worktree" && args[0] === "remove") {
      tipo = "git worktree remove";
      refs = [];
      args.slice(1).forEach((t, k) => {
        if (!t.startsWith("-")) {
          refs.push(t);
          itens.push(argItems[k + 1]);
        }
      });
    } else if (sub === "push") {
      const pos = [];
      args.forEach((t, k) => {
        if (!t.startsWith("-")) pos.push({ t, item: argItems[k] });
      });
      const apagando = args.some((t) => t === "--delete" || (!t.startsWith("--") && shortFlags(t).includes("d")));
      if (apagando) {
        tipo = "git push --delete";
        refs = pos.slice(1).map((p) => p.t);
        itens = pos.slice(1).map((p) => p.item);
      } else {
        const colon = pos.slice(1).filter((p) => p.t.startsWith(":"));
        if (colon.length) {
          tipo = "git push :ref";
          refs = colon.map((p) => p.t);
          itens = colon.map((p) => p.item);
        }
      }
    }
    if (!refs) continue;
    const gerada =
      call.cmd.viaXargs ||
      call.cmd.inLoop ||
      itens.some((it) => it && (/\$\(|`/.test(it.raw) || (!it.quoted && /[*?[]/.test(it.value)))) ||
      (call.cmd.pipedIn && refs.length === 0);
    out.push({ tipo, refs, gerada, leve });
  }
  return out;
}

/** `main`, `origin/main`, `:main`, `refs/heads/main` → `main`. */
function nomeDaBranch(ref) {
  return String(ref).replace(/^:/, "").replace(/^refs\/heads\//, "").replace(/^origin\/(?=(?:main|master)$)/, "");
}

const REGRA = "se o pedido era VERIFICAR, verifique e relate (`git branch --merged`, `git worktree list`) e deixe a decisão com a pessoa; se apagar É a decisão, escreva os nomes na chamada, em lotes de até 3, para quem aprova conseguir conferir.";

export function decide(payload) {
  if (payload.tool_name !== "Bash") return null;
  const command = payload.tool_input?.command;
  if (typeof command !== "string" || !command.includes("git")) return null;
  const cwd = payload.cwd || process.cwd();
  const todas = exclusoes(command, cwd);
  if (todas.length === 0) return null;
  const protegidas = new Set(loadConfig(repoRoot(cwd) || cwd).config.branchesProtegidas);
  const alvo = todas.flatMap((f) => f.refs).map(nomeDaBranch).find((r) => protegidas.has(r));
  if (alvo) {
    return ask(
      mensagem({
        trava: "apagar branch protegida",
        oQue: `Confirme: esta chamada apaga a branch protegida \`${alvo}\`.`,
        porque: "a branch principal é onde o código revisado vive; apagá-la (aqui ou no remoto) derruba o que depende dela, e a recuperação é manual.",
        comoFazer: "se a intenção era limpar branches de trabalho, apague só as suas, já mescladas. Se apagar a principal é mesmo o pedido, confirme.",
      }),
    );
  }
  const found = todas.filter((f) => !f.leve);
  if (found.length === 0) return null;
  const tipos = [...new Set(found.map((f) => f.tipo))].join(", ");
  if (found.some((f) => f.gerada)) {
    return deny(
      mensagem({
        trava: "apagar várias branches",
        oQue: `Bloqueado: exclusão de referências a partir de uma lista gerada (${tipos}).`,
        porque: "com lista gerada (pipe, xargs, $(...), laço) quem aprova a chamada não consegue ler o que vai sumir, e trabalho não mesclado pode ser perdido.",
        comoFazer: REGRA,
      }),
    );
  }
  const total = found.reduce((n, f) => n + f.refs.length, 0);
  if (total > MAX_REFS) {
    return ask(
      mensagem({
        trava: "apagar várias branches",
        oQue: `Confirme: esta chamada apaga ${total} referências de uma vez (${tipos}), acima de ${MAX_REFS}.`,
        porque: "limpeza em lote pode apagar trabalho que ainda não foi mesclado.",
        comoFazer: `confira a lista na chamada. ${REGRA} Para branches já mescladas, \`git branch -d\` (sem forçar) é seguro: o git recusa as não mescladas.`,
      }),
    );
  }
  return null;
}

runHook(import.meta.url, decide);
