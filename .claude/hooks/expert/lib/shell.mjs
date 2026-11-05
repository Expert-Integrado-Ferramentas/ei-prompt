/**
 * Leitura de uma linha de comando bash, o suficiente para as travas decidirem com segurança.
 *
 * Por que não basta casar texto: `git checkout main && git merge feat/x` só fica perigoso
 * porque o segundo comando roda DEPOIS do primeiro, e `cd outro-repo && git commit` roda em
 * outro repositório. Por isso este módulo:
 *   - separa palavras respeitando aspas simples, duplas, `$'...'`, escapes, `$(...)` e crases;
 *   - divide em comandos simples nos operadores `&&`, `||`, `;`, `|`, `&`, quebras de linha;
 *   - guarda o corpo de heredocs (`<<EOF`), inclusive dentro de `$(cat <<'EOF' ... EOF)`;
 *   - acompanha `cd <pasta>` / `pushd` e `git -C <pasta>` para saber ONDE cada git roda;
 *   - entra em `bash -c '...'`, `sh -c`, `zsh -c` e `eval`, e marca o que vem de `xargs` ou laço;
 *   - entra no script de `ssh [opções] <host> '<script>'`, marcando os comandos como `remoto`
 *     (rodam em outra máquina: a pasta é desconhecida e o git não é o local);
 *   - guarda os redirecionamentos de cada comando (`cat > corpo.md <<EOF`, `grep x < .env`).
 *
 * Não é um interpretador: expansões (`$VAR`, `$(...)`) não são executadas; a palavra fica com o
 * texto literal e `dynamic: true`, para a trava tratar como desconhecida.
 */
import { closeSync, openSync, readSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const OPERATORS = ["&&", "||", "|&", ";;", ";", "|", "&", "(", ")"];
const REDIR = /^(?:&>>|&>|<<<|<<-|<<|<>|<&|>>|>&|>\||<|>)/;

/** Palavras reservadas que podem abrir um comando sem serem o comando. */
const LEADING_KEYWORDS = new Set(["if", "then", "else", "elif", "do", "!", "{", "}", "fi", "time"]);
/** Prefixos que executam o comando seguinte como se fosse ele. */
const WRAPPERS = new Set(["sudo", "command", "nohup", "exec", "builtin", "nice", "env", "doas", "caffeinate"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
/** Opções do ssh que consomem o próximo argumento. */
const SSH_OPTS_WITH_ARG = new Set("BbcDEeFIiJLlmOoPpQRSWw".split(""));
const XARGS_OPTS_WITH_ARG = new Set(["-I", "-n", "-L", "-P", "-d", "-E", "-s", "-a", "--max-args", "--delimiter"]);
const MAX_DEPTH = 4;

function isNameStart(ch) {
  return /[A-Za-z_{0-9@*#?$!-]/.test(ch || "");
}

/**
 * Lê a partir de `start` (logo depois de `$(`) até o `)` correspondente.
 * Respeita aspas, escapes, `$(` aninhado e corpos de heredoc (um apóstrofo dentro do heredoc
 * não abre aspas). Devolve o índice logo após o `)` (ou o fim do texto).
 */
function scanSubst(s, start) {
  let depth = 1;
  let i = start;
  const pending = [];
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      i = end < 0 ? s.length : end + 1;
      continue;
    }
    if (c === '"') {
      i = scanDouble(s, i + 1).end;
      continue;
    }
    if (c === "`") {
      const end = s.indexOf("`", i + 1);
      i = end < 0 ? s.length : end + 1;
      continue;
    }
    if (c === "$" && s[i + 1] === "(") {
      i = scanSubst(s, i + 2);
      continue;
    }
    if (c === "<" && s[i + 1] === "<" && s[i + 2] !== "<") {
      const hd = readHeredocDelimiter(s, i + 2);
      if (hd) {
        pending.push(hd);
        i = hd.end;
        continue;
      }
    }
    if (c === "\n" && pending.length) {
      i = consumeHeredocBodies(s, i + 1, pending);
      continue;
    }
    if (c === "(") depth += 1;
    if (c === ")") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return s.length;
}

/**
 * Lê o conteúdo entre aspas duplas a partir de `start` (logo depois de `"`).
 * @returns {{value: string, end: number, dynamic: boolean}}
 */
function scanDouble(s, start) {
  let value = "";
  let dynamic = false;
  let i = start;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') return { value, end: i + 1, dynamic };
    if (c === "\\") {
      const nx = s[i + 1];
      if (nx === "\n") {
        i += 2;
        continue;
      }
      if (nx === "$" || nx === "`" || nx === '"' || nx === "\\") {
        value += nx;
        i += 2;
        continue;
      }
      value += c;
      i += 1;
      continue;
    }
    if (c === "$" && s[i + 1] === "(") {
      const end = scanSubst(s, i + 2);
      value += s.slice(i, end);
      dynamic = true;
      i = end;
      continue;
    }
    if (c === "`") {
      const close = s.indexOf("`", i + 1);
      const end = close < 0 ? s.length : close + 1;
      value += s.slice(i, end);
      dynamic = true;
      i = end;
      continue;
    }
    if (c === "$" && isNameStart(s[i + 1])) dynamic = true;
    value += c;
    i += 1;
  }
  return { value, end: s.length, dynamic };
}

/** Lê o delimitador de um heredoc a partir de `start` (logo depois de `<<`). */
function readHeredocDelimiter(s, start) {
  let i = start;
  let strip = false;
  if (s[i] === "-") {
    strip = true;
    i += 1;
  }
  while (s[i] === " " || s[i] === "\t") i += 1;
  let delim = "";
  while (i < s.length && !/[\s;&|<>()]/.test(s[i])) {
    const c = s[i];
    if (c === "'" || c === '"') {
      const end = s.indexOf(c, i + 1);
      const stop = end < 0 ? s.length : end;
      delim += s.slice(i + 1, stop);
      i = stop + 1;
      continue;
    }
    if (c === "\\") {
      delim += s[i + 1] || "";
      i += 2;
      continue;
    }
    delim += c;
    i += 1;
  }
  if (!delim) return null;
  return { delim, strip, end: i, body: "" };
}

/** Consome os corpos dos heredocs pendentes a partir de `pos` (início da linha). */
function consumeHeredocBodies(s, pos, pending) {
  let i = pos;
  while (pending.length) {
    const hd = pending.shift();
    const lines = [];
    let closed = false;
    while (i < s.length) {
      const nl = s.indexOf("\n", i);
      const lineEnd = nl < 0 ? s.length : nl;
      const text = s.slice(i, lineEnd);
      i = nl < 0 ? s.length : nl + 1;
      if (text.trim() === hd.delim) {
        closed = true;
        break;
      }
      lines.push(hd.strip ? text.replace(/^\t+/, "") : text);
    }
    hd.body = lines.join("\n") + (lines.length ? "\n" : "");
    hd.closed = closed;
  }
  return i;
}

/**
 * Divide o texto em itens: palavras, operadores, redirecionamentos e heredocs.
 * @param {string} s
 */
export function lex(s) {
  const items = [];
  const pending = [];
  let word = null;
  const start = () => {
    if (!word) word = { type: "word", value: "", raw: "", dynamic: false, quoted: false };
  };
  const end = () => {
    if (word) items.push(word);
    word = null;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      if (s[i + 1] === "\n") {
        i += 2;
        continue;
      }
      start();
      word.value += s[i + 1] ?? "";
      word.raw += s.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === "'") {
      start();
      word.quoted = true;
      const close = s.indexOf("'", i + 1);
      const stop = close < 0 ? s.length : close;
      word.value += s.slice(i + 1, stop);
      word.raw += s.slice(i, stop + 1);
      i = stop + 1;
      continue;
    }
    if (c === "$" && s[i + 1] === "'") {
      start();
      word.quoted = true;
      let j = i + 2;
      let v = "";
      while (j < s.length && s[j] !== "'") {
        if (s[j] === "\\" && j + 1 < s.length) {
          const e = s[j + 1];
          v += e === "n" ? "\n" : e === "t" ? "\t" : e;
          j += 2;
          continue;
        }
        v += s[j];
        j += 1;
      }
      word.value += v;
      word.raw += s.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '"') {
      start();
      word.quoted = true;
      const r = scanDouble(s, i + 1);
      word.value += r.value;
      word.raw += s.slice(i, r.end);
      word.dynamic = word.dynamic || r.dynamic;
      i = r.end;
      continue;
    }
    if (c === "$" && s[i + 1] === "(") {
      start();
      const stop = scanSubst(s, i + 2);
      word.value += s.slice(i, stop);
      word.raw += s.slice(i, stop);
      word.dynamic = true;
      i = stop;
      continue;
    }
    if (c === "`") {
      start();
      const close = s.indexOf("`", i + 1);
      const stop = close < 0 ? s.length : close + 1;
      word.value += s.slice(i, stop);
      word.raw += s.slice(i, stop);
      word.dynamic = true;
      i = stop;
      continue;
    }
    if (c === "#" && !word) {
      const nl = s.indexOf("\n", i);
      i = nl < 0 ? s.length : nl;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      end();
      i += 1;
      continue;
    }
    if (c === "\n") {
      end();
      items.push({ type: "op", value: "\n" });
      i += 1;
      if (pending.length) i = consumeHeredocBodies(s, i, pending);
      continue;
    }
    if (c === "<" || c === ">" || (c === "&" && s[i + 1] === ">")) {
      if (word && !word.quoted && /^\d+$/.test(word.value)) word = null; // descritor: 2>&1
      else end();
      const op = REDIR.exec(s.slice(i))[0];
      i += op.length;
      if (op === "<<" || op === "<<-") {
        const hd = readHeredocDelimiter(s, op === "<<-" ? i - 1 : i);
        if (hd) {
          if (op === "<<-") hd.strip = true;
          const item = { type: "heredoc", ...hd };
          items.push(item);
          pending.push(item);
          i = hd.end;
          continue;
        }
      }
      items.push({ type: "redir", value: op });
      continue;
    }
    const op = OPERATORS.find((o) => s.startsWith(o, i));
    if (op) {
      end();
      items.push({ type: "op", value: op });
      i += op.length;
      continue;
    }
    start();
    word.value += c;
    word.raw += c;
    if (c === "$" && isNameStart(s[i + 1])) word.dynamic = true;
    i += 1;
  }
  end();
  return items;
}

function expandHome(p) {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function basename(name) {
  return name.split("/").pop();
}

/**
 * Tira do início do comando palavras-chave, atribuições `X=y` e prefixos como `sudo`/`env`.
 * As atribuições (`PGHOST=db psql`, `env X=y cmd`) ficam em `env` (valor sem aspas; null se calculado).
 * @returns {{words: object[], viaXargs: boolean, env: Record<string, string|null>}}
 */
function stripPrefixes(words) {
  let w = words;
  let viaXargs = false;
  const env = {};
  for (let guard = 0; guard < 50 && w.length; guard += 1) {
    const first = w[0];
    if (!first.quoted && LEADING_KEYWORDS.has(first.value)) {
      w = w.slice(1);
      continue;
    }
    if (!first.quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(first.raw)) {
      const eq = first.value.indexOf("=");
      env[first.value.slice(0, eq)] = first.dynamic ? null : first.value.slice(eq + 1);
      w = w.slice(1);
      continue;
    }
    const name = basename(first.value);
    if (WRAPPERS.has(name)) {
      let k = 1;
      while (k < w.length && w[k].value.startsWith("-")) {
        if (name === "sudo" && /^-[ugCDhpRrTt]$/.test(w[k].value)) k += 1;
        if (name === "env" && /^-[uSC]$/.test(w[k].value)) k += 1;
        if (name === "nice" && w[k].value === "-n") k += 1;
        k += 1;
      }
      if (k >= w.length) break; // `env > arquivo`: o próprio prefixo é o comando
      w = w.slice(k);
      continue;
    }
    if (name === "time" || name === "timeout") {
      let k = 1;
      while (k < w.length && w[k].value.startsWith("-")) k += 1;
      if (name === "timeout") k += 1; // duração
      w = w.slice(k);
      continue;
    }
    if (name === "xargs") {
      viaXargs = true;
      let k = 1;
      while (k < w.length && w[k].value.startsWith("-")) {
        if (XARGS_OPTS_WITH_ARG.has(w[k].value)) k += 1;
        k += 1;
      }
      w = w.slice(k);
      continue;
    }
    break;
  }
  return { words: w, viaXargs, env };
}

/**
 * @typedef {object} Command
 * @property {string} name        nome do programa (como escrito, ex. `git`, `./node_modules/.bin/wrangler`)
 * @property {string} base        só o nome do arquivo do programa (`git`, `wrangler`)
 * @property {string[]} args      argumentos já sem aspas
 * @property {object[]} argItems  argumentos com metadados ({value, raw, dynamic, quoted})
 * @property {string} dir         pasta em que o comando roda (após os `cd` anteriores)
 * @property {string[]} heredocs  corpos de heredoc ligados a este comando
 * @property {boolean} viaXargs   o comando recebe argumentos gerados por `xargs`
 * @property {boolean} inLoop     o comando está dentro de `for`/`while`/`until`
 * @property {boolean} pipedIn    a entrada vem de um `|`
 * @property {{op: string, target: string, dynamic: boolean}[]} redirects  redirecionamentos (`>`, `>>`, `<`...)
 * @property {boolean} remoto     o comando roda do outro lado de um `ssh` (pasta e git desconhecidos)
 * @property {Record<string, string|null>} env  atribuições na frente do comando (`PGHOST=x psql`)
 * @property {string} text        o comando reconstruído (para mensagens e registros)
 */

/**
 * Todos os comandos simples de uma linha de comando, em ordem de execução.
 * @param {string} command
 * @param {string} cwd pasta em que o Bash da sessão está
 * @returns {Command[]}
 */
export function parseCommands(command, cwd, _ctx = { depth: 0, viaXargs: false, inLoop: false, remoto: false }) {
  if (typeof command !== "string" || !command.trim()) return [];
  const items = lex(command);
  const commands = [];
  let shellDir = path.resolve(cwd || process.cwd());
  let loopDepth = 0;

  let seg = { words: [], heredocs: [], redirects: [], pipedIn: false };
  let pipedNext = false;
  let expectRedirTarget = null;

  const flush = () => {
    const current = seg;
    seg = { words: [], heredocs: [], redirects: [], pipedIn: pipedNext };
    pipedNext = false;
    if (current.words.length === 0) return;

    let words = current.words;
    const first = words[0].quoted ? null : words[0].value;
    if (first === "for" || first === "select") {
      loopDepth += 1;
      return;
    }
    if (first === "while" || first === "until") {
      loopDepth += 1;
      words = words.slice(1);
    }
    if (first === "done") {
      loopDepth = Math.max(0, loopDepth - 1);
      words = words.slice(1);
    }
    if (first === "case" || first === "esac") return;
    const stripped = stripPrefixes(words);
    words = stripped.words;
    if (words.length === 0) return;

    const name = words[0].value;
    const base = basename(name);
    const argItems = words.slice(1);
    const args = argItems.map((w) => w.value);
    const inLoop = _ctx.inLoop || loopDepth > 0 || (first === "do" && loopDepth > 0);
    const viaXargs = _ctx.viaXargs || stripped.viaXargs;

    if (base === "cd" || base === "pushd") {
      if (_ctx.remoto) return; // pasta da outra máquina: não muda a pasta local
      const target = args.find((a) => !/^-[LPe@]$/.test(a));
      if (target === undefined) shellDir = os.homedir();
      else if (target !== "-" && !argItems.find((w) => w.value === target)?.dynamic) {
        shellDir = path.resolve(shellDir, expandHome(target));
      }
      return;
    }

    if (_ctx.depth < MAX_DEPTH && (SHELLS.has(base) || base === "eval")) {
      let script = null;
      if (base === "eval") {
        script = args.join(" ");
      } else {
        const ci = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a));
        if (ci >= 0 && args[ci + 1] !== undefined) script = args[ci + 1];
      }
      if (script !== null) {
        const inner = parseCommands(script, shellDir, { depth: _ctx.depth + 1, viaXargs, inLoop, remoto: _ctx.remoto });
        commands.push(...inner);
        return;
      }
    }

    if (_ctx.depth < MAX_DEPTH && base === "ssh") {
      let k = 0;
      while (k < args.length && args[k].startsWith("-") && args[k] !== "--") {
        if (args[k].length === 2 && SSH_OPTS_WITH_ARG.has(args[k][1])) k += 1;
        k += 1;
      }
      if (args[k] === "--") k += 1;
      const script = args.slice(k + 1).join(" ");
      if (args[k] !== undefined && script.trim()) {
        const inner = parseCommands(script, shellDir, { depth: _ctx.depth + 1, viaXargs, inLoop, remoto: true });
        commands.push(...inner);
        return;
      }
    }

    commands.push({
      name,
      base,
      args,
      argItems,
      dir: shellDir,
      heredocs: current.heredocs.map((h) => h.body),
      viaXargs,
      inLoop,
      pipedIn: current.pipedIn,
      redirects: current.redirects,
      remoto: Boolean(_ctx.remoto),
      env: stripped.env,
      text: words.map((w) => w.value).join(" "),
    });
  };

  for (const item of items) {
    if (item.type === "word") {
      if (expectRedirTarget) {
        seg.redirects.push({ op: expectRedirTarget, target: item.value, dynamic: item.dynamic });
        expectRedirTarget = null;
        continue;
      }
      seg.words.push(item);
      continue;
    }
    if (item.type === "redir") {
      expectRedirTarget = item.value;
      continue;
    }
    if (item.type === "heredoc") {
      seg.heredocs.push(item);
      continue;
    }
    // operador
    expectRedirTarget = null;
    const isPipe = item.value === "|" || item.value === "|&";
    flush();
    if (isPipe) seg.pipedIn = true;
  }
  flush();
  return commands;
}

/**
 * Substituições `$(...)` de primeiro nível num texto (o valor de uma palavra com `dynamic`).
 * @returns {{inicio: number, fim: number, interno: string}[]}
 */
export function substituicoes(texto) {
  const out = [];
  let i = 0;
  while (i < texto.length) {
    if (texto[i] === "\\") {
      i += 2;
      continue;
    }
    if (texto[i] === "$" && texto[i + 1] === "(") {
      const fim = scanSubst(texto, i + 2);
      out.push({ inicio: i, fim, interno: texto.slice(i + 2, texto[fim - 1] === ")" ? fim - 1 : fim) });
      i = fim;
      continue;
    }
    i += 1;
  }
  return out;
}

/** Opções globais do git que consomem o próximo argumento. */
const GIT_GLOBAL_WITH_ARG = new Set(["-C", "-c", "--exec-path", "--git-dir", "--work-tree", "--namespace", "--config-env"]);

/**
 * @typedef {object} GitCall
 * @property {string} sub          subcomando (`commit`, `push`...)
 * @property {string[]} args       argumentos depois do subcomando
 * @property {object[]} argItems
 * @property {string} dir          pasta efetiva (cd + -C + --work-tree)
 * @property {Command} cmd
 */

/** Se o comando é uma chamada ao git, devolve o subcomando e a pasta efetiva. */
export function gitCallOf(cmd) {
  if (cmd.base !== "git" || cmd.remoto) return null; // git do outro lado do ssh não é o repositório local
  let dir = cmd.dir;
  let i = 0;
  const a = cmd.args;
  while (i < a.length && a[i].startsWith("-")) {
    const t = a[i];
    if (t === "-C" && a[i + 1] !== undefined) dir = path.resolve(dir, expandHome(a[i + 1]));
    if (t === "--work-tree" && a[i + 1] !== undefined) dir = path.resolve(dir, expandHome(a[i + 1]));
    if (t.startsWith("--work-tree=")) dir = path.resolve(dir, expandHome(t.slice(12)));
    if (GIT_GLOBAL_WITH_ARG.has(t)) i += 1;
    i += 1;
  }
  if (i >= a.length) return null;
  return { sub: a[i], args: a.slice(i + 1), argItems: cmd.argItems.slice(i + 1), dir, cmd };
}

/**
 * Todas as chamadas ao git de uma linha de comando, com a pasta onde cada uma roda.
 * @param {string} command
 * @param {string} cwd
 * @returns {GitCall[]}
 */
export function gitCalls(command, cwd) {
  const out = [];
  for (const cmd of parseCommands(command, cwd)) {
    const call = gitCallOf(cmd);
    if (call) out.push(call);
  }
  return out;
}

/**
 * Separa opções curtas agrupadas (`-am` → `-a`, `-m`). Opções longas ficam como estão.
 * Útil para checar flags sem se perder em `-fu`, `-uf`.
 */
export function shortFlags(token) {
  if (!/^-[A-Za-z]+$/.test(token)) return [];
  return token.slice(1).split("");
}

/** Destino de saída que não é arquivo de verdade. */
const SAIDA_ESPECIAL = /^\/dev\//;

/**
 * Cópias de `cp`/`mv`/`install`: destino é o último posicional (ou `-t pasta`); pasta recebe
 * `pasta/<nome>`. @returns {{fonte: string, destino: string}[]}
 */
function copias(cmd) {
  const pos = [];
  let alvo = null;
  for (let i = 0; i < cmd.args.length; i += 1) {
    const t = cmd.args[i];
    if (t === "-t" || t === "--target-directory") alvo = cmd.args[++i] ?? null;
    else if (t.startsWith("--target-directory=")) alvo = t.slice(19);
    else if (t === "-S" || t === "--suffix" || t === "-m" || t === "-o" || t === "-g") i += 1;
    else if (!t.startsWith("-")) pos.push(t);
  }
  const fontes = alvo === null ? pos.slice(0, -1) : pos;
  const dest = alvo ?? pos[pos.length - 1];
  if (dest === undefined || !fontes.length) return [];
  let pasta = alvo !== null || dest.endsWith("/") || fontes.length > 1;
  if (!pasta) {
    try {
      pasta = statSync(path.resolve(cmd.dir, expandHome(dest))).isDirectory();
    } catch {
      pasta = false;
    }
  }
  return fontes.map((f) => ({ fonte: f, destino: pasta ? path.join(dest, basename(f.replace(/\/+$/, ""))) : dest }));
}

/** Conteúdo (até 1 MB) de um arquivo do disco; binário vira "" (não há texto a examinar); null se não for arquivo. */
function lerPequeno(abs) {
  let fd = null;
  try {
    const st = statSync(abs);
    if (!st.isFile()) return null;
    fd = openSync(abs, "r");
    const buf = Buffer.alloc(Math.min(st.size, 1024 * 1024));
    readSync(fd, buf, 0, buf.length, 0);
    return buf.includes(0) ? "" : buf.toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** Arquivo que `curl -O`/`wget` sem `-O` grava: o nome no fim da URL. */
function nomeDaUrl(url) {
  const semQuery = String(url).split(/[?#]/)[0];
  const nome = semQuery.replace(/\/+$/, "").split("/").pop();
  return nome && !/^[a-z]+:$/i.test(nome) && semQuery.includes("/") ? nome : "index.html";
}

/**
 * Arquivos que um comando grava sem que a linha mostre o conteúdo: redirecionamento de outro
 * comando, `sed -i`, `curl -o|-O`, `wget [-O]`, `tee` lendo do pipe.
 */
function escritasDesconhecidas(cmd) {
  const out = [];
  const b = cmd.base;
  if (b === "sed" && cmd.args.some((a) => a === "--in-place" || a.startsWith("--in-place=") || /^-[a-zA-Z]*i/.test(a))) {
    let programa = !cmd.args.some((a) => a === "-e" || a === "-f" || a === "--expression" || a === "--file");
    for (let i = 0; i < cmd.args.length; i += 1) {
      const t = cmd.args[i];
      if (t === "-e" || t === "-f" || t === "--expression" || t === "--file") i += 1;
      else if (t === "-i" && cmd.args[i + 1] === "") i += 1; // `sed -i '' ...` (BSD)
      else if (t.startsWith("-")) continue;
      else if (programa) programa = false;
      else out.push(t);
    }
  } else if (b === "curl") {
    const url = cmd.args.find((a) => /^[a-z]+:\/\//i.test(a));
    for (let i = 0; i < cmd.args.length; i += 1) {
      const t = cmd.args[i];
      if (t === "--output") out.push(cmd.args[++i]);
      else if (t.startsWith("--output=")) out.push(t.slice(9));
      else if (t === "--remote-name" || t === "--remote-name-all") {
        if (url) out.push(nomeDaUrl(url));
      } else if (/^-[a-zA-Z]+/.test(t) && !t.startsWith("--")) {
        // opções curtas agrupadas: `-sO`, `-sSo arquivo`, `-ofile`
        const k = t.indexOf("o");
        if (t.slice(1, k > 0 ? k : undefined).includes("O") && url) out.push(nomeDaUrl(url));
        if (k > 0) out.push(t.length > k + 1 ? t.slice(k + 1) : cmd.args[++i]);
      }
    }
  } else if (b === "wget") {
    let comO = false;
    for (let i = 0; i < cmd.args.length; i += 1) {
      const t = cmd.args[i];
      if (t === "-O" || t === "--output-document") {
        comO = true;
        out.push(cmd.args[++i]);
      } else if (/^-O./.test(t)) {
        comO = true;
        out.push(t.slice(2));
      } else if (t.startsWith("--output-document=")) {
        comO = true;
        out.push(t.slice(18));
      }
    }
    if (!comO) for (const u of cmd.args.filter((a) => /^[a-z]+:\/\//i.test(a))) out.push(nomeDaUrl(u));
  } else if (b === "tee" && !cmd.heredocs.length) {
    out.push(...cmd.args.filter((a) => !a.startsWith("-")));
  }
  return out.filter((f) => typeof f === "string" && f && f !== "-");
}

/**
 * Arquivos que a própria linha de comando escreve antes de usá-los: `cat > corpo.md <<'EOF'`,
 * `tee corpo.md <<EOF`, `echo "..." > corpo.md`, `printf '...' > corpo.md`.
 * Valor null: o arquivo é gravado na linha, mas o conteúdo não aparece nela (`cmd > arquivo`,
 * `echo "$VAR" > arquivo`, `sed -i`, `curl -o`, `wget -O`, `cp -r` de pasta); quem lê não pode
 * confiar no disco (ainda tem o conteúdo de antes). `cp`/`mv`/`install` de arquivo leva o conteúdo
 * da fonte (gravada antes na linha, ou lida do disco).
 * `anexados`: arquivos que só receberam `>>` (o conteúdo é o do disco mais o anexado).
 * @param {Command[]} cmds comandos já lidos por `parseCommands`
 * @param {number} [ate] só os comandos antes deste índice
 * @returns {Map<string, string|null> & {anexados: Set<string>}} caminho absoluto → conteúdo
 */
export function arquivosCriados(cmds, ate = cmds.length) {
  const out = new Map();
  const anexados = new Set();
  const gravar = (abs, conteudo, anexa) => {
    if (conteudo === null) {
      out.set(abs, null);
      anexados.delete(abs);
      return;
    }
    if (anexa && out.has(abs)) {
      const antes = out.get(abs);
      out.set(abs, antes === null ? null : antes + conteudo);
      return;
    }
    out.set(abs, conteudo);
    if (anexa) anexados.add(abs);
    else anexados.delete(abs);
  };
  for (const cmd of cmds.slice(0, ate)) {
    if (cmd.remoto) continue;
    const resolver = (d) => path.resolve(cmd.dir, expandHome(d));
    let conteudo = null;
    const literal = !cmd.argItems.some((w) => w.dynamic);
    if ((cmd.base === "cat" || cmd.base === "tee") && cmd.heredocs.length) conteudo = cmd.heredocs[0];
    else if (cmd.base === "echo" && literal) conteudo = `${cmd.args.filter((a) => !/^-[neE]+$/.test(a)).join(" ")}\n`;
    // printf: o formato com `\n`/`\t` interpretados e, em linhas à parte, os argumentos do `%s`
    else if (cmd.base === "printf" && literal) conteudo = [String(cmd.args[0] ?? "").replace(/\\n/g, "\n").replace(/\\t/g, "\t"), ...cmd.args.slice(1)].join("\n");
    const saidas = cmd.redirects.filter((r) => [">", ">>", ">|", "&>", "&>>"].includes(r.op) && !r.dynamic && !SAIDA_ESPECIAL.test(r.target));
    for (const r of saidas) gravar(resolver(r.target), conteudo, r.op === ">>" || r.op === "&>>");
    if (cmd.base === "tee" && conteudo !== null) {
      const anexa = cmd.args.some((a) => a === "-a" || a === "--append");
      for (const d of cmd.args.filter((a) => !a.startsWith("-"))) gravar(resolver(d), conteudo, anexa);
    }
    for (const d of escritasDesconhecidas(cmd)) if (!SAIDA_ESPECIAL.test(d) && !/[$`]/.test(d)) gravar(resolver(d), null, false);
    if (cmd.base === "cp" || cmd.base === "mv" || cmd.base === "install") {
      for (const { fonte, destino } of copias(cmd)) {
        if (/[$`]/.test(destino)) continue;
        const absF = resolver(fonte);
        let c = null;
        if (!/[$`*?[]/.test(fonte)) {
          if (out.has(absF) && !anexados.has(absF)) c = out.get(absF);
          else {
            const disco = lerPequeno(absF);
            if (disco !== null) c = disco + (anexados.has(absF) ? out.get(absF) ?? "" : "");
          }
        }
        gravar(resolver(destino), c, false);
      }
    }
  }
  out.anexados = anexados;
  return out;
}
