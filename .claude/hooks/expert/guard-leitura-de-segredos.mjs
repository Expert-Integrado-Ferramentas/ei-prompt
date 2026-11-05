#!/usr/bin/env node
/**
 * Leitura de segredo pelo terminal (PreToolUse, Bash).
 *
 * A lista de bloqueio do settings.json impede o Read de `.env`, mas `cat .env` no Bash põe o
 * mesmo conteúdo na conversa. Esta trava cobre o Bash:
 *   - BLOQUEIA leitores (`cat|less|more|head|tail|bat|grep|sed|awk|cp|scp|xxd|od|base64|strings|
 *     nl|tac|cut|sort|uniq|diff|jq`, `dd if=`, `< arquivo`, `git show <rev>:<arquivo>`,
 *     `git cat-file -p <rev>:<arquivo>`) e `node -e`/`python -c` cujo código cita o arquivo, de
 *     `.env`, `.env.*` (menos os de exemplo: `.env[.x].example|.sample|.template|.dist`), `.envrc`,
 *     `.dev.vars`, `~/.ssh/id_*`, `*.pem` e `~/.aws/credentials`. `grep` com `-q`/`-c`/`-l` não
 *     mostra conteúdo e passa. `node|bun --env-file=<segredo>` com código na linha que imprime
 *     (`-p`, `console.*`, `process.stdout`) também é leitor;
 *   - PEDE CONFIRMAÇÃO no que mexe no segredo sem mostrar: `sed -i`/`awk -i inplace` editando o
 *     arquivo e `cp <x> .env*` (o destino é o próprio arquivo de segredo);
 *   - BLOQUEIA `grep -r` (`-R`, `--recursive`, `-rn`...) numa pasta que tem `.env`/`.dev.vars`
 *     sem `--exclude` para eles: sugere `git grep`/`rg`, que respeitam o .gitignore;
 *   - PEDE CONFIRMAÇÃO em `source .env` / `. .env` (carrega as variáveis sem mostrar, mas o
 *     valor fica disponível para os comandos seguintes).
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { ask, deny, mensagem, runHook } from "./lib/output.mjs";
import { gitCallOf, parseCommands, shortFlags } from "./lib/shell.mjs";

const LEITORES = new Set([
  ...["cat", "less", "more", "head", "tail", "bat", "grep", "egrep", "fgrep", "rg", "sed", "awk", "cp", "scp"],
  ...["xxd", "od", "base64", "strings", "nl", "tac", "cut", "sort", "uniq", "diff", "jq", "dd"],
]);
/** Interpretadores com código na linha (`node -e "...readFileSync('.env')"`). */
const CODIGO_INLINE = { node: ["-e", "--eval", "-p", "--print"], bun: ["-e", "--eval", "-p", "--print"], python: ["-c"], python3: ["-c"] };
const CARREGADORES = new Set(["source", "."]);
/** Opções que recebem valor (o valor não é arquivo lido). */
const OPCOES_COM_VALOR = {
  grep: ["-e", "-f", "-m", "-A", "-B", "-C", "--regexp", "--max-count"],
  rg: ["-e", "-g", "-t", "-m", "-A", "-B", "-C", "--glob", "--type"],
  head: ["-n", "-c"],
  tail: ["-n", "-c"],
  sed: ["-e", "-f"],
  awk: ["-F", "-v", "-f"],
  scp: ["-P", "-i", "-o", "-F", "-c", "-l", "-J", "-S"],
  cut: ["-d", "-f", "-c", "-b"],
  sort: ["-k", "-t", "-o", "-S", "-T", "--output"],
  uniq: ["-f", "-s", "-w"],
  xxd: ["-l", "-s", "-c", "-g", "-o"],
  od: ["-A", "-j", "-N", "-t", "-w"],
  base64: ["-w", "-b", "-o", "--output"],
  strings: ["-n", "-t", "-e"],
  nl: ["-b", "-d", "-f", "-h", "-i", "-l", "-n", "-s", "-v", "-w"],
  diff: ["-U", "-C", "-x", "-X", "--label"],
  jq: ["--indent", "--arg", "--argjson", "--args", "--jsonargs"],
};
/** Opções cujo valor é um arquivo LIDO (`base64 -i .env`, `jq --rawfile x .env`). */
const OPCOES_QUE_LEEM = { base64: ["-i", "--input"], jq: ["--rawfile", "--slurpfile"] };

/** `.env.example`, `.env.production.example`, `.dev.vars.staging.sample`, `.env.dist`: modelo sem valor real. */
const EXEMPLO_RE = /\.(example|sample|template|dist)$/;

/** O caminho aponta para um arquivo de segredo? */
export function arquivoSecreto(p) {
  const norm = String(p).replace(/\\/g, "/");
  const base = path.posix.basename(norm);
  if (base === ".env" || base === ".env*" || base === ".env.*" || base === ".envrc") return true;
  if (base.startsWith(".env.")) return !EXEMPLO_RE.test(base);
  if (base === ".dev.vars") return true;
  if (base.startsWith(".dev.vars.")) return !EXEMPLO_RE.test(base);
  if (/\.pem$/i.test(base)) return true;
  if (/(^|\/)\.ssh\/id_[^/]*$/.test(norm)) return !base.endsWith(".pub");
  if (/(^|\/)\.aws\/credentials$/.test(norm)) return true;
  return false;
}

/** Arquivos que o comando lê. `cp`/`scp`: todos menos o destino. */
function arquivosLidos(cmd) {
  if (cmd.base === "dd") return cmd.args.filter((a) => a.startsWith("if=")).map((a) => a.slice(3));
  const comValor = new Set(OPCOES_COM_VALOR[cmd.base] || []);
  const queLeem = new Set(OPCOES_QUE_LEEM[cmd.base] || []);
  const pos = [];
  const viaOpcao = [];
  let programaDoAwkSed = cmd.base === "awk" || cmd.base === "sed";
  let filtroDoJq = cmd.base === "jq";
  for (let i = 0; i < cmd.args.length; i += 1) {
    const t = cmd.args[i];
    if (queLeem.has(t)) {
      // `jq --rawfile nome arquivo`: o arquivo é o segundo valor
      const k = cmd.base === "jq" ? i + 2 : i + 1;
      if (cmd.args[k] !== undefined) viaOpcao.push(cmd.args[k]);
      i = k;
      continue;
    }
    if (cmd.base === "jq" && ["--arg", "--argjson"].includes(t)) {
      i += 2;
      continue;
    }
    if (cmd.base === "jq" && (t === "-f" || t === "--from-file")) filtroDoJq = false;
    if (t.startsWith("-") && t !== "-") {
      if (comValor.has(t)) {
        if ((cmd.base === "sed" && t === "-e") || (cmd.base === "awk" && t === "-f") || (cmd.base === "sed" && t === "-f")) programaDoAwkSed = false;
        i += 1;
      }
      continue;
    }
    pos.push(t);
  }
  let lidos = pos;
  if (cmd.base === "grep" || cmd.base === "egrep" || cmd.base === "fgrep" || cmd.base === "rg") {
    lidos = cmd.args.some((a) => ["-e", "-f", "--regexp"].includes(a)) ? pos : pos.slice(1); // 1º posicional é o padrão
  } else if (programaDoAwkSed) {
    lidos = pos.slice(1); // 1º posicional é o programa
  } else if (filtroDoJq) {
    lidos = pos.slice(1); // 1º posicional é o filtro
  } else if (cmd.base === "cp" || cmd.base === "scp") {
    lidos = pos.slice(0, -1);
  } else if (cmd.base === "uniq" || cmd.base === "xxd") {
    lidos = pos.slice(0, 1); // 2º posicional é a saída
  }
  const deEntrada = cmd.redirects.filter((r) => r.op === "<").map((r) => r.target);
  return [...lidos, ...viaOpcao, ...deEntrada];
}

const GREPS = new Set(["grep", "egrep", "fgrep"]);

/** `grep -q|-c|-l|-L` (e equivalentes longos) não imprime o conteúdo das linhas. */
function grepSemConteudo(cmd) {
  if (!GREPS.has(cmd.base) && cmd.base !== "rg") return false;
  return cmd.args.some(
    (a) =>
      ["--quiet", "--silent", "--count", "--files-with-matches", "--files-without-match", "--files-with-match"].includes(a) ||
      (!a.startsWith("--") && shortFlags(a).some((f) => "qclL".includes(f))),
  );
}

/** `git show <rev>:<arquivo>`, `git cat-file -p <rev>:<arquivo>`: o arquivo lido do histórico. */
function lidosDoGit(cmd) {
  const call = gitCallOf(cmd);
  if (!call || !["show", "cat-file"].includes(call.sub)) return [];
  if (call.sub === "cat-file" && call.args.some((a) => ["-e", "-t", "-s"].includes(a))) return [];
  return call.args.filter((a) => !a.startsWith("-") && a.includes(":")).map((a) => a.slice(a.indexOf(":") + 1));
}

/** Casa um padrão de `--exclude`/`--include` do grep (glob simples) com o nome do arquivo. */
function casaGlob(glob, nome) {
  const re = glob.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${re}$`).test(nome);
}

/** Arquivos de segredo dentro de `dir` (até 4 níveis, sem node_modules/.git; para no primeiro lote). */
function segredosNaPasta(dir) {
  const achados = [];
  let vistos = 0;
  const walk = (d, nivel) => {
    if (nivel > 4 || achados.length >= 5 || vistos > 5000) return;
    let entries = [];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      vistos += 1;
      if (e.isDirectory()) {
        if (!["node_modules", ".git", "dist", "build", ".next", ".wrangler", "vendor"].includes(e.name)) walk(path.join(d, e.name), nivel + 1);
      } else if ((e.name.startsWith(".env") || e.name.startsWith(".dev.vars")) && arquivoSecreto(e.name)) {
        achados.push(path.join(d, e.name));
      }
    }
  };
  walk(dir, 0);
  return achados;
}

/**
 * `grep -r` numa pasta com `.env`/`.dev.vars` (que o grep lê, ao contrário de `git grep`/`rg`).
 * @returns {string[]} os arquivos de segredo que entrariam na busca
 */
function grepRecursivoEmSegredo(cmd) {
  if (!GREPS.has(cmd.base) || cmd.remoto) return [];
  const recursivo = cmd.args.some((a) => a === "--recursive" || a === "--dereference-recursive" || (!a.startsWith("--") && shortFlags(a).some((f) => f === "r" || f === "R")));
  if (!recursivo) return [];
  const excluir = [];
  const incluir = [];
  const pos = [];
  let comPadrao = false;
  for (let i = 0; i < cmd.args.length; i += 1) {
    const t = cmd.args[i];
    if (t.startsWith("--exclude=")) excluir.push(t.slice(10));
    else if (t === "--exclude") excluir.push(cmd.args[++i] ?? "");
    else if (t.startsWith("--include=")) incluir.push(t.slice(10));
    else if (t === "--include") incluir.push(cmd.args[++i] ?? "");
    else if (t === "-e" || t === "-f" || t === "--regexp" || t === "--file") {
      comPadrao = true;
      i += 1;
    } else if (["-m", "-A", "-B", "-C", "--max-count", "--exclude-dir", "--exclude-from"].includes(t)) i += 1;
    else if (!t.startsWith("-") || t === "-") pos.push(t);
  }
  const pastas = (comPadrao ? pos : pos.slice(1)).filter((p) => !/[$`]/.test(p));
  const alvos = pastas.length ? pastas : ["."];
  const achados = [];
  for (const p of alvos) {
    const abs = path.resolve(cmd.dir, p);
    try {
      if (!statSync(abs).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const f of segredosNaPasta(abs)) {
      const nome = path.basename(f);
      if (excluir.some((g) => casaGlob(g, nome))) continue;
      if (incluir.length && !incluir.some((g) => casaGlob(g, nome))) continue;
      achados.push(path.relative(cmd.dir, f) || nome);
    }
  }
  return achados;
}

/** `sed -i` / `awk -i inplace`: edita o arquivo no lugar, sem imprimir. */
function editaNoLugar(cmd) {
  if (cmd.base === "sed") return cmd.args.some((a) => a === "--in-place" || a.startsWith("--in-place=") || /^-[a-zA-Z]*i/.test(a));
  if (cmd.base === "awk" || cmd.base === "gawk") return cmd.args.some((a, i) => (a === "-i" && cmd.args[i + 1] === "inplace") || a === "-iinplace" || a === "--include=inplace");
  return false;
}

/** `node|bun --env-file=<arquivo>` (ou `--env-file <arquivo>`): os arquivos carregados. */
function envFiles(cmd) {
  if (!["node", "bun"].includes(cmd.base)) return [];
  const out = [];
  cmd.args.forEach((a, i) => {
    if (/^--env-file(-if-exists)?=/.test(a)) out.push(a.slice(a.indexOf("=") + 1));
    else if ((a === "--env-file" || a === "--env-file-if-exists") && cmd.args[i + 1]) out.push(cmd.args[i + 1]);
  });
  return out;
}

/** Código na linha que imprime algo (`-p`, `console.*`, `process.stdout`, `print(`). */
function codigoQueImprime(cmd) {
  if (cmd.args.some((a) => a === "-p" || a === "--print")) return true;
  const flags = CODIGO_INLINE[cmd.base] || [];
  const i = cmd.args.findIndex((a) => flags.includes(a));
  const codigo = i >= 0 ? cmd.args[i + 1] : undefined;
  return typeof codigo === "string" && /console\.|process\.(?:stdout|stderr)|\bprint\s*\(|Bun\.write/.test(codigo);
}

/** Arquivos de segredo citados no código de `node -e`/`python -c`. */
function citadosNoCodigo(cmd) {
  const flags = CODIGO_INLINE[cmd.base];
  if (!flags) return [];
  const i = cmd.args.findIndex((a) => flags.includes(a));
  const codigo = i >= 0 ? cmd.args[i + 1] : undefined;
  if (typeof codigo !== "string") return [];
  return codigo.split(/[\s'"`(),;+=[\]{}]+/).filter((t) => t && arquivoSecreto(t));
}

export function decide(payload) {
  if (payload.tool_name !== "Bash") return null;
  const command = payload.tool_input?.command;
  if (typeof command !== "string") return null;
  if (!/\.env|\.dev\.vars|\.pem|\.ssh|\.aws|grep/.test(command)) return null;
  let carregar = null;
  for (const cmd of parseCommands(command, payload.cwd || process.cwd())) {
    const recursivo = grepSemConteudo(cmd) ? [] : grepRecursivoEmSegredo(cmd);
    if (recursivo.length) {
      return deny(
        mensagem({
          trava: "leitura de segredo",
          oQue: `Bloqueado: \`${cmd.text}\` busca recursivamente numa pasta com arquivo de segredo (${recursivo.slice(0, 3).map((s) => `\`${s}\``).join(", ")}).`,
          porque: "o `grep -r` lê também o `.env`/`.dev.vars` e imprime na conversa as linhas que casarem (inclusive valores de chave).",
          comoFazer: "use `git grep` ou `rg`, que respeitam o .gitignore (ou acrescente `--exclude='.env*' --exclude='.dev.vars*'`).",
        }),
      );
    }
    const doGit = lidosDoGit(cmd).filter(arquivoSecreto);
    if (LEITORES.has(cmd.base) || CODIGO_INLINE[cmd.base] || cmd.redirects.some((r) => r.op === "<") || doGit.length) {
      const leitor = LEITORES.has(cmd.base) && !grepSemConteudo(cmd);
      const secretos = CODIGO_INLINE[cmd.base]
        ? [...citadosNoCodigo(cmd), ...arquivosLidos({ ...cmd, args: [] })].filter(arquivoSecreto)
        : [...arquivosLidos(leitor ? cmd : { ...cmd, args: [] }), ...doGit].filter(arquivoSecreto);
      // `cp .env.staging .env`, `sed -i 's/X=.*/X=1/' .env`: mexe no segredo sem mostrar o conteúdo
      const pos = cmd.args.filter((a) => !a.startsWith("-"));
      const paraSegredo = cmd.base === "cp" && pos.length >= 2 && arquivoSecreto(pos[pos.length - 1]) && !cmd.redirects.length;
      if (secretos.length && (paraSegredo || (editaNoLugar(cmd) && !cmd.redirects.some((r) => r.op !== "<")))) {
        carregar = carregar || { texto: cmd.text, edita: true };
        continue;
      }
      if (secretos.length) {
        return deny(
          mensagem({
            trava: "leitura de segredo",
            oQue: `Bloqueado: \`${cmd.text}\` lê arquivo de segredo (${secretos.map((s) => `\`${s}\``).join(", ")}).`,
            porque: "o conteúdo iria para a conversa (e para os registros dela) ou seria copiado para fora; segredo exposto precisa ser trocado.",
            comoFazer: "para saber quais variáveis existem, leia o `.env.example`; para conferir um valor, peça à pessoa. O código lê o `.env` sozinho em tempo de execução (ex.: `node --env-file=.env`, `wrangler dev`).",
          }),
        );
      }
    }
    const comEnv = envFiles(cmd).filter(arquivoSecreto);
    if (comEnv.length && codigoQueImprime(cmd)) {
      return deny(
        mensagem({
          trava: "leitura de segredo",
          oQue: `Bloqueado: \`${cmd.text}\` carrega ${comEnv.map((s) => `\`${s}\``).join(", ")} e imprime pelo código na linha.`,
          porque: "o valor carregado do arquivo de segredo iria para a conversa (e para os registros dela).",
          comoFazer: "para saber quais variáveis existem, leia o `.env.example`; para conferir se uma variável está definida, teste sem imprimir o valor (ex.: `node --env-file=.env -e \"process.exit(process.env.X ? 0 : 1)\"`).",
        }),
      );
    }
    if (CARREGADORES.has(cmd.base) && cmd.args[0] && arquivoSecreto(cmd.args[0])) carregar = carregar || { texto: cmd.text, edita: false };
  }
  if (carregar?.edita) {
    return ask(
      mensagem({
        trava: "leitura de segredo",
        oQue: `Confirme: \`${carregar.texto}\` altera um arquivo de segredo (sem mostrar o conteúdo).`,
        porque: "mexer no `.env`/`.dev.vars` muda as credenciais que o projeto usa; um valor errado quebra o ambiente ou aponta para o lugar errado.",
        comoFazer: "confira o arquivo e a alteração; se é o que a pessoa pediu, confirme.",
      }),
    );
  }
  if (carregar) {
    return ask(
      mensagem({
        trava: "leitura de segredo",
        oQue: `Confirme: \`${carregar.texto}\` carrega as variáveis de um arquivo de segredo no terminal.`,
        porque: "os valores ficam disponíveis para os comandos seguintes e podem acabar impressos na conversa.",
        comoFazer: "prefira que a ferramenta leia o arquivo sozinha (`node --env-file=.env`, `dotenv`, `wrangler dev`). Se precisa mesmo carregar, confirme.",
      }),
    );
  }
  return null;
}

runHook(import.meta.url, decide);
