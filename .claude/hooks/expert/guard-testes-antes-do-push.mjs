#!/usr/bin/env node
/**
 * Trava 5 — testes antes do push (PreToolUse, Bash).
 *
 * Em `git push` (exceto `--delete`, `--dry-run` e push só de tags) e `gh pr create`, roda a suíte
 * inteira do projeto e só deixa seguir se passar. Regras:
 *   - projeto sem comando de testes (ou linha de base "sem-testes"): deixa passar e avisa,
 *     oferecendo criar uma suíte mínima;
 *   - `git push` sem refspec com a branch em dia com o upstream (nada a enviar): não roda;
 *   - HEAD já aprovado (`.claude/state/tests-ok.json`): deixa passar sem rodar de novo — mas só
 *     se nada antes do push, no mesmo comando, cria ou troca o commit;
 *   - `git add && git commit && git push` numa linha (ou `npm version` antes do push, que também
 *     commita): roda a suíte na pasta (é o que será commitado); passou, libera. Sem nada rastreado
 *     fora do commit, registra a árvore da pasta (`tree`, calculada antes da suíte num índice
 *     temporário): o commit que tiver exatamente essa árvore vale como testado, e nem o deploy,
 *     nem o próximo push, nem o `gh pr create` rodam a suíte de novo;
 *   - `git pull|merge|rebase|reset|checkout...` antes do push na mesma linha: pede confirmação
 *     (a suíte rodaria num código diferente do enviado);
 *   - push de outra branch que não a atual (`git push origin a:b`): pede confirmação;
 *   - `git add <arquivos> && git commit && git push` com outros arquivos rastreados alterados e
 *     fora do add: pede confirmação (a suíte rodaria na pasta, que tem alterações fora do commit);
 *   - push puro com alterações não commitadas: pede confirmação (a suíte rodaria na pasta, não no
 *     commit enviado). Se só há arquivos novos fora do git (`??`), roda a suíte assim mesmo e, se
 *     passar, libera listando esses arquivos;
 *   - tag criada antes na mesma linha (`git tag v1 && git push origin v1`) conta como tag;
 *   - suíte passou: registra o HEAD e, se a linha de base estava "falhando", grava
 *     `.claude/state/linha-de-base.json` com "passando" (estado local);
 *   - suíte falhou: com linha de base "falhando" pede confirmação; senão bloqueia mostrando o fim
 *     da saída;
 *   - tempo esgotado (padrão 300 s, teto 570 s descontado o que o hook já gastou, para caber nos
 *     600 s do hook): pede confirmação.
 * Push que a trava de branch protegida vai bloquear não roda testes (seria espera à toa).
 */
import { loadConfig } from "./lib/config.mjs";
import { aFrenteDoUpstream, currentBranch, git, headSha, repoRoot, statusEntries } from "./lib/git.mjs";
import { ask, context, deny, mensagem, runHook } from "./lib/output.mjs";
import { gitCallOf, parseCommands, shortFlags } from "./lib/shell.mjs";
import { arvoreDaPasta, executarERegistrar, linhaDeBaseEfetiva, resolveTestCommand, testsOkFor, ultimasLinhas } from "./lib/testes.mjs";
import { violacoes } from "./guard-branch-protegida.mjs";

const TRAVA = "testes antes do push";
/** Teto do tempo da suíte dentro da trava (o hook tem 600 s no settings.json). */
export const MAX_SEGUNDOS = 570;
/** O hook inteiro tem que caber nos 600 s: a suíte usa no máximo 585 s menos o já gasto (mínimo 30 s). */
const FIM_DO_HOOK_SEGUNDOS = 585;
const MIN_SEGUNDOS = 30;

/** Tempo da suíte descontando o que o hook já gastou (árvore da pasta, outra suíte antes). */
export function tempoDaSuite(inicio, agora = Date.now()) {
  const gasto = Math.max(0, (agora - inicio) / 1000);
  return Math.max(MIN_SEGUNDOS, Math.floor(Math.min(MAX_SEGUNDOS, FIM_DO_HOOK_SEGUNDOS - gasto)));
}
const CLI = "node .claude/hooks/expert/registrar-testes.mjs";
/** Antes do push, na mesma linha, trocam o commit ou a árvore (a suíte não veria o enviado). */
const TROCA_COMMIT = new Set(["pull", "merge", "rebase", "reset", "checkout", "switch", "cherry-pick", "am", "revert"]);
const PUSH_OPTS_WITH_ARG = new Set(["--repo", "--exec", "--receive-pack", "-o", "--push-option"]);

/**
 * `switch -c X`/`checkout -b X` só criam branch a partir do HEAD (não trocam o código);
 * `branch -m|-M|--move [<atual>] X` renomeia a branch atual para X.
 * @returns {string|null} o nome da branch criada (ou o novo nome da atual)
 */
function branchCriada(call) {
  if (call.sub === "branch") {
    if (!call.args.some((a) => ["-m", "-M", "--move"].includes(a))) return null;
    const pos = call.args.filter((a) => !a.startsWith("-"));
    if (pos.length === 1) return pos[0];
    // `git branch -m outra X` renomeia outra branch: a atual continua a mesma
    if (pos.length === 2 && pos[0] === currentBranch(call.dir)) return pos[1];
    return null;
  }
  if (call.sub !== "switch" && call.sub !== "checkout") return null;
  for (let i = 0; i < call.args.length; i += 1) {
    const a = call.args[i];
    if (a.startsWith("--create=")) return a.slice(9);
    if (["-c", "-C", "-b", "-B", "--create"].includes(a)) return call.args[i + 1] || null;
  }
  return null;
}

/** Refspecs de um `git push` (sem as opções e sem o remoto). */
function refspecsDoPush(args) {
  const pos = [];
  let remoteViaFlag = false;
  for (let i = 0; i < args.length; i += 1) {
    const t = args[i];
    if (t === "--repo" || t.startsWith("--repo=")) remoteViaFlag = true;
    if (t.startsWith("-")) {
      if (PUSH_OPTS_WITH_ARG.has(t)) i += 1;
      continue;
    }
    pos.push(t);
  }
  return remoteViaFlag ? pos : pos.slice(1);
}

const TAG_OPTS_WITH_ARG = new Set(["-m", "--message", "-F", "--file", "-u", "--local-user", "--cleanup", "--format", "--sort", "--contains", "--no-contains", "--points-at", "--merged", "--no-merged", "--trailer"]);

/** Nome da tag que `git tag X`/`git tag -a X -m ...` cria (null em listar/apagar/verificar). */
export function tagCriada(call) {
  if (call.sub !== "tag") return null;
  const pos = [];
  for (let i = 0; i < call.args.length; i += 1) {
    const t = call.args[i];
    if (["-l", "--list", "-d", "--delete", "-v", "--verify"].includes(t) || /^-n\d*$/.test(t)) return null;
    if (t.startsWith("-")) {
      if (TAG_OPTS_WITH_ARG.has(t)) i += 1;
      continue;
    }
    pos.push(t);
  }
  return pos[0] && !/\$|`/.test(pos[0]) ? pos[0] : null;
}

/** Algum refspec envia uma branch que não é a atual? Tag e destino calculado não contam. */
export function enviaOutraRef(dir, args, atual = currentBranch(dir), tagsNovas = new Set()) {
  for (const spec of refspecsDoPush(args)) {
    const src = spec.split(":")[0].replace(/^\+/, "");
    if (!src || src === "HEAD" || src === "@" || /\$|`/.test(src)) continue;
    const nome = src.replace(/^refs\/heads\//, "");
    if (nome === atual) continue;
    if (tagsNovas.has(nome.replace(/^refs\/tags\//, ""))) continue;
    if (git(dir, ["show-ref", "--verify", "--quiet", `refs/tags/${nome.replace(/^refs\/tags\//, "")}`]) !== null) continue;
    return src;
  }
  return null;
}

/** Push só de tags (`--tags` sem refspec, ou todo refspec é tag): não envia código novo de branch. */
export function soTags(dir, args, tagsNovas = new Set()) {
  if (args.some((a) => ["--all", "--mirror", "--branches"].includes(a))) return false;
  const refspecs = refspecsDoPush(args);
  if (!refspecs.length) return args.includes("--tags");
  const existe = (ref) => (ref.startsWith("refs/tags/") && tagsNovas.has(ref.slice(10))) || git(dir, ["show-ref", "--verify", "--quiet", ref]) !== null;
  for (let i = 0; i < refspecs.length; i += 1) {
    const spec = refspecs[i];
    if (spec === "tag" && refspecs[i + 1]) {
      i += 1; // `git push origin tag v1.0.0`
      continue;
    }
    const src = spec.split(":")[0].replace(/^\+/, "");
    if (src.startsWith("refs/tags/")) continue;
    if (!src || /\$|`/.test(src) || !existe(`refs/tags/${src}`) || existe(`refs/heads/${src}`)) return false;
  }
  return true;
}

/** `npm version <x>` (sem `--no-git-tag-version`) commita e cria tag: conta como commit antes do push. */
function versionQueCommita(cmd) {
  if (!["npm", "pnpm"].includes(cmd.base) || cmd.args[0] !== "version" || cmd.remoto) return false;
  if (cmd.args.some((a) => a === "--no-git-tag-version" || a === "--git-tag-version=false")) return false;
  return cmd.args.slice(1).some((a) => !a.startsWith("-"));
}

/** A chamada adiciona tudo da pasta ao commit (`git add -A|.`, `git commit -a`)? */
function adicionaTudo(call) {
  if (call.sub === "add") return call.args.some((a) => ["-A", "--all", ".", ":/"].includes(a));
  if (call.sub === "commit") return call.args.some((a) => a === "--all" || (!a.startsWith("--") && shortFlags(a).includes("a")));
  return false;
}

/**
 * Pastas onde um push/PR vai acontecer neste comando, com o que roda antes dele na mesma linha.
 * `adds`: os `git add` e `git commit` antes do push (para saber o que fica fora do commit).
 * @returns {{dir: string, outraRef: string|null, commitAntes: boolean, addTudo: boolean, trocaAntes: string|null, adds: object[]}[]}
 */
export function alvosDoComando(command, cwd) {
  const alvos = [];
  const anteriores = [];
  for (const cmd of parseCommands(command, cwd)) {
    const call = gitCallOf(cmd);
    const ehPr = cmd.base === "gh" && cmd.args[0] === "pr" && cmd.args[1] === "create" && !cmd.remoto;
    if (ehPr || (call && call.sub === "push")) {
      const dir = ehPr ? cmd.dir : call.dir;
      const root = repoRoot(dir);
      const antes = anteriores.filter((a) => a.root === root);
      const alvo = {
        dir,
        outraRef: null,
        commitAntes: antes.some((a) => a.call.sub === "commit"),
        addTudo: antes.some((a) => adicionaTudo(a.call)),
        trocaAntes: antes.find((a) => TROCA_COMMIT.has(a.call.sub) && !branchCriada(a.call))?.call.cmd.text || null,
        adds: antes.filter((a) => a.call.sub === "add" || a.call.sub === "commit").map((a) => a.call),
      };
      if (call) {
        const apaga = call.args.some((a) => a === "--delete" || a === "--dry-run" || (!a.startsWith("--") && (shortFlags(a).includes("d") || shortFlags(a).includes("n"))));
        const refspecs = refspecsDoPush(call.args);
        const soApagaPorRefspec = refspecs.length > 0 && refspecs.every((a) => a.startsWith(":"));
        // tags criadas antes na mesma linha (`git tag v1 && git push origin v1`) contam como tags
        const tagsNovas = new Set(antes.map((a) => tagCriada(a.call)).filter(Boolean));
        if (apaga || soApagaPorRefspec || soTags(dir, call.args, tagsNovas)) continue;
        const criada = antes.map((a) => branchCriada(a.call)).filter(Boolean).pop();
        // `git push` sem refspec com a branch em dia com o upstream: não envia commit nenhum
        const mudaAntes = alvo.commitAntes || antes.some((a) => TROCA_COMMIT.has(a.call.sub));
        if (!refspecs.length && !mudaAntes && !criada && !call.args.some((a) => ["--all", "--mirror", "--branches"].includes(a)) && aFrenteDoUpstream(dir, currentBranch(dir)) === 0) continue;
        alvo.outraRef = enviaOutraRef(dir, call.args, criada || currentBranch(dir), tagsNovas);
      }
      alvos.push(alvo);
      continue;
    }
    if (call) anteriores.push({ call, root: repoRoot(call.dir) });
    else if (versionQueCommita(cmd)) anteriores.push({ call: { sub: "commit", args: [], cmd }, root: repoRoot(cmd.dir) });
  }
  return alvos;
}

function lista(arquivos) {
  return `${arquivos.slice(0, 5).join(", ")}${arquivos.length > 5 ? ", ..." : ""}`;
}

/**
 * `git add <arquivos> && git commit && git push`: arquivos rastreados alterados que nenhum `git add`
 * da linha (nem os caminhos do próprio commit) leva. A suíte roda na pasta, que os inclui.
 */
export function foraDoCommit(root, calls) {
  const alterados = git(root, ["diff", "--name-only", "-z"]);
  if (!alterados) return [];
  const pendentes = alterados.split("\0").filter((f) => f && !f.startsWith(".claude/state/"));
  if (!pendentes.length) return [];
  const levados = new Set();
  for (const call of calls) {
    const args = call.sub === "commit" ? caminhosDoCommit(call.args) : call.args;
    if (call.sub === "commit" && !args.length) continue;
    if (args.some((a) => /\$|`/.test(a))) return []; // caminho calculado: não dá para saber
    if (call.sub === "add" && !args.some((a) => !a.startsWith("-"))) return []; // `git add -u` sem caminho: leva tudo
    const out = git(call.dir, ["add", "--dry-run", "--ignore-missing", ...(call.sub === "commit" ? ["--"] : []), ...args]);
    if (out === null) return [];
    for (const l of out.split("\n")) {
      const m = /^(?:add|remove) '(.*)'$/.exec(l.trim());
      if (m) levados.add(m[1]);
    }
  }
  return pendentes.filter((f) => !levados.has(f));
}

const COMMIT_OPTS_WITH_ARG = new Set(["-m", "--message", "-F", "--file", "-C", "--reuse-message", "-c", "--reedit-message", "--author", "--date", "--trailer", "-t", "--template", "--cleanup", "--fixup", "--squash"]);

/** Caminhos de `git commit <caminhos>` (só esses arquivos entram no commit). */
function caminhosDoCommit(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const t = args[i];
    if (t === "--") return [...out, ...args.slice(i + 1)];
    if (t.startsWith("--")) {
      if (COMMIT_OPTS_WITH_ARG.has(t)) i += 1;
      continue;
    }
    if (t.startsWith("-")) {
      const f = shortFlags(t);
      const k = f.findIndex((c) => "mFCct".includes(c));
      if (k >= 0 && k === f.length - 1) i += 1;
      continue;
    }
    out.push(t);
  }
  return out;
}

function resultadoDaSuite(r, root, config, ondeRodou) {
  if (r.status === "passou") return null;
  if (r.status === "sem-testes") {
    return context("PreToolUse", `A suíte (\`${r.comando}\`) não encontrou testes ou o pytest não está instalado (código ${r.codigo}); o push segue sem testes. Ofereça à pessoa criar uma suíte mínima e instalar as dependências.`);
  }
  if (r.status === "tempo") {
    return ask(
      mensagem({
        trava: TRAVA,
        oQue: `Confirme: a suíte (\`${r.comando}\`) passou do limite de ${r.timeout}s e foi interrompida.`,
        porque: "sem a suíte terminar não dá para saber se o push quebra algo que já funcionava.",
        comoFazer: `o tempo vem de \`testes.timeoutSegundos\` no \`.claude/expert-governanca.json\` (padrão 300 s, teto ${MAX_SEGUNDOS} s na trava). Suíte mais lenta: rode \`${CLI}\` antes do push (segue \`testes.timeoutSegundos\` sem o teto; pelo Bash, use timeout de 600000 ms ou rode em segundo plano). Ele registra o commit e o push não roda de novo. Para seguir assim mesmo, confirme.`,
      }),
    );
  }
  const fim = ultimasLinhas(r.saida, 30);
  if (linhaDeBaseEfetiva(root, config) === "falhando") {
    return ask(
      mensagem({
        trava: TRAVA,
        oQue: `Confirme: a suíte (\`${r.comando}\`) falhou${ondeRodou}.`,
        porque: "a suíte já falhava quando o harness foi instalado (linha de base \"falhando\"); confirme o push ou corrija as falhas.",
        comoFazer: "confira se alguma falha é NOVA (causada por esta mudança); se for, corrija antes de enviar. Se são só as antigas, confirme.",
        detalhe: `Fim da saída:\n${fim}`,
      }),
    );
  }
  return deny(
    mensagem({
      trava: TRAVA,
      oQue: `Bloqueado: a suíte de testes (\`${r.comando}\`) falhou${ondeRodou}.`,
      porque: "push com teste falhando leva regressão para o repositório; a suíte inteira faz o papel do CI que não temos.",
      comoFazer: "corrija as falhas abaixo, rode a suíte de novo e repita o push (ele só roda os testes de novo se o commit mudar).",
      detalhe: `Fim da saída:\n${fim}`,
    }),
  );
}

export async function decide(payload) {
  if (payload.tool_name !== "Bash") return null;
  const command = payload.tool_input?.command;
  if (typeof command !== "string" || !/\b(push|pr)\b/.test(command)) return null;
  const inicio = Date.now();
  const cwd = payload.cwd || process.cwd();
  const alvos = alvosDoComando(command, cwd);
  if (alvos.length === 0) return null;
  if (violacoes(command, cwd).length > 0) return null; // a trava de branch protegida bloqueia

  // um julgamento por repositório, somando o que acontece antes de cada push/PR dele
  const porRaiz = new Map();
  for (const a of alvos) {
    const root = repoRoot(a.dir);
    if (!root) continue;
    const j = porRaiz.get(root) || { commitAntes: false, addTudo: false, trocaAntes: null, outraRef: null, adds: [] };
    j.adds.push(...a.adds);
    j.commitAntes = j.commitAntes || a.commitAntes;
    j.addTudo = j.addTudo || a.addTudo;
    j.trocaAntes = j.trocaAntes || a.trocaAntes;
    j.outraRef = j.outraRef || a.outraRef;
    porRaiz.set(root, j);
  }
  const avisos = [];
  for (const [root, j] of porRaiz) {
    const { config } = loadConfig(root);
    const comando = resolveTestCommand(root, config);
    if (!comando) {
      avisos.push(
        "Este projeto não tem comando de testes (nem `testes.comando` no `.claude/expert-governanca.json`, nem script de teste detectável, ou a linha de base é \"sem-testes\"), então o push segue sem rodar testes. " +
          "Ofereça à pessoa criar uma suíte mínima (um teste do comportamento principal) e registrar o comando em `testes.comando`.",
      );
      continue;
    }
    if (j.trocaAntes) {
      return ask(
        mensagem({
          trava: TRAVA,
          oQue: `Confirme: o push vem depois de \`${j.trocaAntes}\` no mesmo comando.`,
          porque: "a trava roda antes do comando inteiro; a suíte testaria o código de antes, não o que será enviado.",
          comoFazer: "rode o push num comando separado (a trava então testa o commit certo). Para seguir assim mesmo, confirme.",
        }),
      );
    }
    if (j.outraRef) {
      return ask(
        mensagem({
          trava: TRAVA,
          oQue: `Confirme: o push envia \`${j.outraRef}\`, que não é a branch atual.`,
          porque: "a suíte roda na pasta (a branch atual); o que vai para o remoto é outro código, que ela não testa.",
          comoFazer: `troque para a branch (\`git switch ${j.outraRef}\`) e faça o push de lá, ou confirme se ela já foi testada.`,
        }),
      );
    }
    if (j.commitAntes) {
      const fora = j.addTudo ? [] : foraDoCommit(root, j.adds);
      if (fora.length) {
        return ask(
          mensagem({
            trava: TRAVA,
            oQue: `Confirme: a suíte rodaria na pasta, que tem alterações fora do commit (${lista(fora)}).`,
            porque: "o commit leva só os arquivos adicionados; a suíte testaria também o que fica de fora, e o que passa aqui pode quebrar no remoto.",
            comoFazer: "adicione esses arquivos ao commit (ou guarde com `git stash push -- <arquivo>`) e repita; para seguir assim mesmo, confirme.",
          }),
        );
      }
      // `git add && git commit && git push`: o commit ainda não existe; testa a pasta. Nada fica
      // fora do commit: registra a árvore da pasta (antes da suíte). Só o commit com essa árvore
      // exata aproveita o registro (o `gh pr create` seguinte não roda a suíte de novo); qualquer
      // diferença (arquivo novo fora do add, `npm version`) cai fora
      const arvore = arvoreDaPasta(root);
      const r = await executarERegistrar(root, config, { timeoutMaxSegundos: tempoDaSuite(inicio), registrar: false, arvore });
      const saida = resultadoDaSuite(r, root, config, " na pasta que vai ser commitada");
      if (saida?.hookSpecificOutput.permissionDecision) return saida;
      if (saida) avisos.push(saida.hookSpecificOutput.additionalContext);
      continue;
    }
    if (testsOkFor(root, headSha(root))) continue;
    const pendentes = statusEntries(root);
    const soNovos = Boolean(pendentes?.length) && pendentes.every((e) => e.code === "??");
    if (pendentes && pendentes.length && !soNovos) {
      return ask(
        mensagem({
          trava: TRAVA,
          oQue: `Confirme: há alterações não commitadas (${lista(pendentes.map((e) => e.path))}).`,
          porque: "a suíte rodaria na pasta, não no commit enviado; o que passa aqui pode quebrar no remoto.",
          comoFazer: "commite ou guarde (`git stash -u`) antes do push; para seguir assim mesmo, confirme.",
        }),
      );
    }
    // só arquivos novos fora do git: roda a suíte assim mesmo (eles não vão no push) e avisa
    const r = await executarERegistrar(root, config, { timeoutMaxSegundos: tempoDaSuite(inicio) });
    const saida = resultadoDaSuite(r, root, config, soNovos ? " (com arquivos não versionados na pasta)" : "");
    if (saida?.hookSpecificOutput.permissionDecision) return saida;
    if (saida) avisos.push(saida.hookSpecificOutput.additionalContext);
    if (soNovos && r.status === "passou") {
      avisos.push(`A suíte passou, mas a pasta tem arquivos não versionados que não vão no push: ${lista(pendentes.map((e) => e.path))}. Se o código depende de algum deles, adicione ao commit antes; senão, siga.`);
    }
  }
  if (avisos.length) return context("PreToolUse", avisos.join("\n"));
  return null;
}

runHook(import.meta.url, decide);
