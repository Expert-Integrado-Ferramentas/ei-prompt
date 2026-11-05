#!/usr/bin/env node
/**
 * Trava 4 — segredo e dado pessoal (PreToolUse, Bash).
 *
 * No `git commit` (e no `git add` que o antecede no mesmo comando) confere o que vai entrar:
 *   - BLOQUEIA o que é certo: arquivo de segredo (.env, chave privada, credencial) e linhas
 *     adicionadas (ou a própria mensagem do commit, `-m`/`-F`) com formato de token conhecido
 *     (AWS, OpenAI, Anthropic, GitHub, npm, Supabase, Stripe, Slack, Google, Resend, SendGrid,
 *     Cloudflare, ClickUp, Groq, Hugging Face, OAuth do Google, bot do Telegram, Asaas, Mercado
 *     Pago, URL de banco com senha, chave privada PEM, JWT com papel `service_role`). Modelos
 *     (`.env[.x].example|.sample|.template|.dist`) não são arquivo de segredo;
 *   - PEDE CONFIRMAÇÃO no que pode ser falso alarme: CPF válido, telefone brasileiro (menos os de
 *     exemplo, como (11) 90000-0000), JWT de papel
 *     desconhecido (o `anon` do Supabase é público e passa), `.env` já versionado recebendo só
 *     chaves públicas (`VITE_*`, `NEXT_PUBLIC_*`, `PUBLIC_*`, padrão do Lovable);
 *   - PEDE CONFIRMAÇÃO quando não deu para examinar tudo: arquivo novo de texto acima de 1 MB (lê
 *     só o primeiro MB), dump/planilha acima de 1 MB (`.sql`, `.dump`, `.sqlite`, `.db`, `.csv`),
 *     git que falhou ao montar o diff ou listar o `git add -A`, ou exame que passou de ~8 s (todo
 *     git roda com o tempo que sobra do prazo). Cada arquivo é examinado logo depois de lido: um
 *     segredo certo achado antes do prazo acabar continua BLOQUEANDO;
 *   - PEDE CONFIRMAÇÃO em nome de credencial (`API_KEY`, `clientSecret`, `SENHA`...) recebendo
 *     literal entre aspas de 16+ caracteres com letras e dígitos (formato desconhecido).
 * Token com cara de exemplo (`AKIA...EXAMPLE`, `xxxxxx`, `****`, `your`/`seu`/`sua`, `<...>`, `...`)
 * pede confirmação em vez de bloquear. URL de banco com host sem ponto (serviço do compose) é local.
 * Arquivo gravado ANTES na mesma linha (`cat > x <<EOF`, `echo > x`, `printf > x`, `tee x`) é
 * examinado pelo conteúdo que o comando mostra, não pelo disco (que ainda tem o de antes); gravado
 * sem conteúdo visível (redirecionamento de outro comando, `sed -i`, `cp`/`mv`, `curl -o`,
 * `wget -O`) e incluído no commit, pede confirmação.
 * Sem repositório ainda (`git init && git add . && git commit` numa chamada só), examina a pasta.
 * Também examina o texto de `gh issue|pr create|comment|edit`, `gh pr review|merge|close`,
 * `gh issue close`, `gh release create|edit` (`--body`, `--title`, `--subject`, `--notes`,
 * `--comment`, `--body-file`, `--notes-file`, `--body "$(cat arquivo)"`, `$VAR` no caminho pelo
 * ambiente), os arquivos de `gh gist create` e de `gh api` (`-f|-F|--field|--raw-field
 * body=|title=`, `--input`). Corpo que não dá para ler (pipe em `-F -`, valor calculado, arquivo
 * ilegível) pede confirmação.
 * Nunca repete o segredo inteiro na mensagem: mostra só os 4 primeiros caracteres.
 */
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  git,
  gitDisponivel,
  hasCommits,
  ignoredPaths,
  modifiedTrackedFiles,
  repoRoot,
  stagedDiffAddedLines,
  stagedFiles,
  trackedFiles,
  worktreeDiffAddedLines,
} from "./lib/git.mjs";
import { ask, deny, mensagem, runHook } from "./lib/output.mjs";
import { arquivosCriados, gitCallOf, parseCommands, shortFlags, substituicoes } from "./lib/shell.mjs";

const TRAVA = "segredo e dado pessoal";
export const LIMITE_BYTES = 1024 * 1024;
export const ORCAMENTO_MS = 8_000;
/** Dumps e planilhas: acima de 1 MB quase sempre são dado real de produção. */
const DADOS_RE = /\.(sql|dump|sqlite3?|db|csv)$/i;
/** Pastas que nunca são examinadas quando não há repositório. */
const PASTAS_PULADAS = new Set(["node_modules", ".git", "dist", ".wrangler"]);

/** Nomes de arquivo que nunca entram no git. */
export function arquivoProibido(file) {
  const base = path.posix.basename(file.replace(/\\/g, "/"));
  if (base === ".env") return true;
  // modelo sem valor real: `.env.example`, `.env.production.example`, `.dev.vars.staging.sample`, `.env.dist`
  if (base.startsWith(".env.")) return !/\.(example|sample|template|dist)$/.test(base);
  if (base === ".dev.vars") return true;
  if (base.startsWith(".dev.vars.")) return !/\.(example|sample|template|dist)$/.test(base);
  if (/\.(pem|key|p12|pfx)$/i.test(base)) return true;
  if (/^id_(rsa|ed25519|ecdsa|dsa)/.test(base)) return !base.endsWith(".pub");
  if (/^credentials.*\.json$/i.test(base)) return true;
  if (/^service-account.*\.json$/i.test(base)) return true;
  return false;
}

/** Senha de exemplo numa URL de banco (`postgres://user:<senha>@...`, `${DB_PASS}`). */
function senhaDeExemplo(s) {
  return /^[$<{[%]/.test(s) || /^[*x.]+$/i.test(s) || /^(password|senha|pass|secret|changeme|example|your[-_]?password|sua[-_]?senha)$/i.test(s);
}
/** Host local: localhost, loopback, ou nome sem ponto (serviço do compose: `database`, `pg`, `supabase_db_x`). */
function hostLocal(h) {
  return /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|host\.docker\.internal)$/i.test(h) || !h.includes(".");
}

/**
 * Token com cara de exemplo de documentação (`AKIA...EXAMPLE`, `sk-xxxxxxxx`, `sk_live_seu_token`,
 * `<...>`, `...`): pede confirmação em vez de bloquear. Olha o casamento e os 3 caracteres seguintes.
 */
export function pareceExemplo(trecho) {
  return /x{6,}|X{6,}|\*{4,}|0{8,}|EXAMPLE|example|exemplo|EXEMPLO|your|YOUR|(?:^|[^A-Za-z])(?:seu|sua|SEU|SUA)|\.{3}|<[^>]*>/.test(trecho);
}

/** Formatos de segredo com certeza suficiente para bloquear. */
export const SEGREDOS = [
  { nome: "chave privada", re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  { nome: "chave da AWS", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { nome: "chave da Anthropic", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { nome: "chave da OpenAI", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/, exceto: /\bsk-ant-/ },
  { nome: "token do GitHub", re: /\bgh[pousr]_[A-Za-z0-9]{36}\b/ },
  { nome: "token do GitHub", re: /\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { nome: "token do npm", re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { nome: "token do npm (_authToken)", re: /_authToken\s*=\s*(?!\$\{)\S{20,}/ },
  { nome: "chave secreta do Supabase", re: /\bsb_secret_[A-Za-z0-9_-]{10,}/ },
  { nome: "chave da Stripe", re: /\b[sr]k_live_[A-Za-z0-9]{10,}/ },
  { nome: "token do Slack", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { nome: "chave do Google", re: /\bAIza[0-9A-Za-z_-]{35}/ },
  // identificador snake_case (`re_render_component_...`) não é chave: a da Resend mistura maiúscula e dígito
  { nome: "chave da Resend", re: /\bre_[A-Za-z0-9_]{20,}/, valida: (m) => /[A-Z]/.test(m[0]) && /\d/.test(m[0]) },
  { nome: "chave da SendGrid", re: /\bSG\.[\w-]{16,}\.[\w-]{16,}/ },
  { nome: "token da Cloudflare", re: /\b(?:CLOUDFLARE|CF)_[A-Z_]*(?:TOKEN|KEY|SECRET)["']?\s*[=:]\s*["']?[A-Za-z0-9_-]{37,}/i },
  { nome: "token do ClickUp", re: /\bpk_\d{6,}_[A-Z0-9]{32}\b/ },
  { nome: "chave da Groq", re: /\bgsk_[A-Za-z0-9]{40,}/ },
  { nome: "token do Hugging Face", re: /\bhf_[A-Za-z0-9]{30,}/ },
  { nome: "segredo de cliente OAuth do Google", re: /\bGOCSPX-[\w-]{20,}/ },
  { nome: "token de bot do Telegram", re: /\b\d{8,10}:AA[\w-]{30,}/ },
  { nome: "chave do Asaas", re: /\$aact_\w{20,}/ },
  { nome: "token do Mercado Pago", re: /\bAPP_USR-\d{10,}-/ },
  {
    nome: "URL de banco com senha",
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?):\/\/([^\s:@/'"]+):([^\s@/'"]+)@([^\s:/'"?]+)/,
    valida: (m) => !senhaDeExemplo(m[2]) && !hostLocal(m[3]),
  },
];

/**
 * Nome de credencial (`API_KEY`, `clientSecret`, `accessToken`, `SENHA`...) recebendo um literal
 * entre aspas de 16+ caracteres que mistura letras e dígitos: pede confirmação (formato
 * desconhecido, pode ser chave real). Referência (`process.env`, `env.`, `${`, `import.meta.env`)
 * não é literal; placeholder (`your-...`, `xxxx`, `<...>`, `changeme`) e nome de chave de storage
 * ou rota (`app_auth_token_v1`, `/api/...`) passam.
 */
const CREDENCIAL_LITERAL = /\b([\w-]*?(?:SECRET|TOKEN|API_?KEY|PASSWORD|SENHA|ACCESS_?KEY)\w*)["']?\s*(?:=|:|:=|=>)\s*(["'`])([^"'`\s]{16,})\2/i;
function credencialLiteral(text) {
  const m = CREDENCIAL_LITERAL.exec(text);
  if (!m) return null;
  const v = m[3];
  if (!/[A-Za-z]/.test(v) || (v.match(/\d/g) || []).length < 2) return null;
  // nome de chave de storage/rota (`app_auth_token_v1`, `/api/token/123`) não é valor de segredo
  if (/token|key|secret|senha|password|session|auth|\//i.test(v)) return null;
  if (/process\.env|import\.meta\.env|\benv\.|\$\{|^\$/.test(v)) return null;
  if (pareceExemplo(v) || /changeme|placeholder|dummy|fake|mock|sample|redacted|test/i.test(v)) return null;
  return { nome: m[1], valor: v };
}

/** Arquivos gerados onde CPF/telefone/JWT quase sempre são falso alarme. */
const SEM_CHECAGEM_PESSOAL = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|deno\.lock|composer\.lock)$|\.(min\.js|map|svg)$/;

export function cpfValido(digitos) {
  if (!/^\d{11}$/.test(digitos) || /^(\d)\1{10}$/.test(digitos)) return false;
  const d = digitos.split("").map(Number);
  const dv = (n) => {
    let soma = 0;
    for (let i = 0; i < n; i += 1) soma += d[i] * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === d[9] && dv(10) === d[10];
}

const CPF_RE = /(?<![\d.\-/])(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})(?![\d])/g;
const FONE_RE = [
  /\+55[\s.-]?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}(?!\d)/,
  /(?<!\d)\(\d{2}\)\s?9\d{4}-?\d{4}(?!\d)/,
];
/** Telefone de exemplo: o número (sem DDI/DDD e sem o 9 da frente) é um dígito repetido, como 90000-0000. */
export function telefoneDeExemplo(fone) {
  const numero = fone.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "").slice(2);
  return /^9?(\d)\1{7}$/.test(numero);
}
/** Dado fictício sugerido na mensagem (a trava não pergunta de novo por ele). */
export const EXEMPLOS_FICTICIOS = { cpf: "000.000.000-00", telefone: "(11) 90000-0000" };
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

export function mascarar(valor) {
  return `${valor.slice(0, 4)}${"*".repeat(Math.min(8, Math.max(4, valor.length - 4)))}`;
}

/** Papel (`role`) declarado no corpo de um JWT; undefined quando não dá para ler. */
export function papelDoJwt(jwt) {
  try {
    const corpo = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    return corpo && typeof corpo.role === "string" ? corpo.role : undefined;
  } catch {
    return undefined;
  }
}

/** Prazo do exame inteiro: estourou, a trava pede confirmação em vez de deixar passar. */
export class PrazoEstourado extends Error {}
export function prazo(ms = ORCAMENTO_MS) {
  const fim = Date.now() + ms;
  return {
    /** Segredos certos achados até aqui: valem mesmo se o prazo estourar depois. */
    bloqueios: [],
    restante: () => Math.max(500, fim - Date.now()),
    checar() {
      if (Date.now() > fim) throw new PrazoEstourado();
    },
  };
}

/**
 * Classifica linhas adicionadas.
 * @param {{file: string, line: number, text: string}[]} linhas
 * @param {{checar: () => void, bloqueios?: string[]}} [p] prazo (os bloqueios achados vão também para `p.bloqueios`)
 * @returns {{bloqueios: string[], avisos: string[]}}
 */
export function examinarLinhas(linhas, p = null) {
  const bloqueios = [];
  const avisos = [];
  const vistos = new Set();
  let n = 0;
  for (const { file, line, text } of linhas) {
    n += 1;
    if (p && n % 2000 === 0) p.checar();
    const chave = `${file}\0${text}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    let conhecido = false;
    for (const s of SEGREDOS) {
      const m = s.re.exec(text);
      if (!m || (s.exceto && s.exceto.test(m[0])) || (s.valida && !s.valida(m))) continue;
      conhecido = true;
      if (pareceExemplo(text.slice(m.index, m.index + m[0].length + 3))) avisos.push(`${file}:${line} — ${s.nome} que parece exemplo de token (${mascarar(m[0])}); confira se não é chave real`);
      else {
        const b = `${file}:${line} — ${s.nome} (${mascarar(m[0])})`;
        bloqueios.push(b);
        if (p?.bloqueios) p.bloqueios.push(b); // sobrevive ao prazo estourar no meio do exame
      }
      break;
    }
    if (!conhecido && !SEM_CHECAGEM_PESSOAL.test(file)) {
      const c = credencialLiteral(text);
      if (c) avisos.push(`${file}:${line} — \`${c.nome}\` recebe um valor literal (${mascarar(c.valor)}); confira se não é chave real`);
    }
    for (const jwt of text.matchAll(JWT_RE)) {
      const papel = papelDoJwt(jwt[0]);
      if (papel === "service_role" || papel === "supabase_admin") {
        const b = `${file}:${line} — chave service_role do Supabase (${mascarar(jwt[0])})`;
        bloqueios.push(b);
        if (p?.bloqueios) p.bloqueios.push(b);
      } else if (papel !== "anon" && !SEM_CHECAGEM_PESSOAL.test(file)) {
        avisos.push(`${file}:${line} — token JWT (${mascarar(jwt[0])}); confira se não é chave de serviço`);
      }
    }
    if (SEM_CHECAGEM_PESSOAL.test(file)) continue;
    for (const m of text.matchAll(CPF_RE)) {
      if (cpfValido(m.slice(1).join(""))) {
        avisos.push(`${file}:${line} — CPF (${mascarar(m[0])})`);
        break;
      }
    }
    for (const re of FONE_RE) {
      const m = re.exec(text);
      if (m && !telefoneDeExemplo(m[0])) {
        avisos.push(`${file}:${line} — telefone (${mascarar(m[0])})`);
        break;
      }
    }
  }
  return { bloqueios, avisos };
}

/**
 * Caminhos que um `git add <args>` incluiria (via `--dry-run`). Relativos à raiz do repositório.
 * `incompleto`: o `--dry-run` falhou (ou estourou o prazo) num add amplo (`-A`, `.`, pasta, sem
 * caminho), então não dá para saber o que entraria.
 * @returns {{files: string[], incompleto: boolean}}
 */
export function arquivosDoAdd(dir, args, p = prazo()) {
  const nada = { files: [], incompleto: false };
  if (args.some((a) => ["-p", "--patch", "-i", "--interactive", "-e", "--edit", "-n", "--dry-run"].includes(a))) return nada;
  if (args.some((a) => a.includes("$") || a.includes("`"))) return nada;
  const root = repoRoot(dir, { timeout: p.restante() });
  if (!root) return nada;
  const out = git(dir, ["add", "--dry-run", "--ignore-missing", ...args], { timeout: p.restante() });
  if (out === null) {
    const caminhos = args.filter((a) => !a.startsWith("-"));
    const pasta = (a) => {
      try {
        return statSync(path.resolve(dir, a)).isDirectory();
      } catch {
        return false;
      }
    };
    const amplo = args.some((a) => ["-A", "--all", "-u", "--update", "--no-ignore-removal"].includes(a)) || caminhos.length === 0 || caminhos.some((a) => a === "." || a === ":/" || pasta(a));
    if (amplo) return { files: [], incompleto: true };
    // `--dry-run` falhou (ex.: caminho inexistente): confere os nomes escritos
    return { files: caminhos.map((a) => path.relative(root, path.resolve(dir, a))), incompleto: false };
  }
  const files = [];
  for (const l of out.split("\n")) {
    const m = /^add '(.*)'$/.exec(l.trim());
    if (m) files.push(m[1]); // o git já imprime relativo à raiz do repositório
  }
  return { files, incompleto: false };
}

/**
 * Lê um arquivo novo (que ainda não está no git) para o exame: até 1 MB.
 * Anota em `exame` o que ficou de fora (arquivo de texto grande, dump/planilha grande).
 */
function lerArquivoNovo(base, rel, exame) {
  const file = path.join(base, rel);
  let fd = null;
  try {
    if (!existsSync(file)) return;
    const st = statSync(file);
    if (!st.isFile()) return;
    const grande = st.size > LIMITE_BYTES;
    if (grande && DADOS_RE.test(rel)) exame.dados.add(rel);
    fd = openSync(file, "r");
    const buf = Buffer.alloc(Math.min(st.size, LIMITE_BYTES));
    readSync(fd, buf, 0, buf.length, 0);
    if (buf.includes(0)) return; // binário
    if (grande && !DADOS_RE.test(rel)) exame.grandes.add(rel);
    buf.toString("utf8").split("\n").forEach((text, i) => exame.linhas.push({ file: rel, line: i + 1, text }));
  } catch {
    // ilegível: o git também não vai conseguir ler
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function novoExame() {
  return { files: new Set(), linhas: [], grandes: new Set(), dados: new Set(), alterados: new Set(), incompleto: null, chavesPublicas: new Set(), previo: { bloqueios: [], avisos: [] }, ate: 0 };
}

/**
 * Examina já as linhas que entraram no exame desde a última chamada (logo depois de ler cada
 * arquivo), para um segredo achado antes do prazo estourar continuar bloqueando. Linhas de
 * arquivos em `pular` (gravados de novo na mesma linha) ficam para o julgamento final.
 */
function examinarJa(exame, p, pular = null) {
  const novas = exame.linhas.slice(exame.ate).filter((l) => !(pular && pular.has(l.file)));
  exame.ate = exame.linhas.length;
  if (!novas.length) return;
  for (const l of novas) l.examinada = true;
  const r = examinarLinhas(novas, p);
  exame.previo.bloqueios.push(...r.bloqueios);
  exame.previo.avisos.push(...r.avisos);
}

/** Caminho relativo à raiz (com `/`), ou null fora do repositório. */
function relDaRaiz(root, abs) {
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

/** O pathspec do git (`.`, pasta, arquivo, `:/`, glob) cobre o arquivo `abs`? */
function pathspecCobre(ps, baseDir, root, abs) {
  let spec = ps;
  let base = baseDir;
  if (spec === ":/" || spec === ":(top)") return true;
  if (spec.startsWith(":/")) {
    base = root;
    spec = spec.slice(2);
  } else if (spec.startsWith(":")) return true; // pathspec mágico: na dúvida, cobre
  if (/[*?[]/.test(spec)) {
    const rel = path.relative(base, abs).split(path.sep).join("/");
    const esc = spec.replace(/^\.\//, "").replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${esc}$`).test(rel);
  }
  const alvo = path.resolve(base, spec);
  return abs === alvo || abs.startsWith(alvo + path.sep);
}

/**
 * Arquivos gravados antes na mesma linha (`criados`) que um `git add <args>` incluiria. O
 * `--dry-run` não os enxerga (ainda não existem, ou têm o conteúdo de antes). Respeita o
 * `.gitignore` (menos com `-f`) e o `-u` (só rastreados). Relativos à raiz.
 */
function escritosDoAdd(root, call, criados, p) {
  if (!criados.size) return [];
  const flags = [];
  const specs = [];
  for (let i = 0; i < call.args.length; i += 1) {
    const t = call.args[i];
    if (t === "--") {
      specs.push(...call.args.slice(i + 1));
      break;
    }
    if (t.startsWith("-")) flags.push(t);
    else specs.push(t);
  }
  const tem = (...f) => flags.some((x) => f.includes(x) || (!x.startsWith("--") && f.some((y) => y.length === 2 && shortFlags(x).includes(y[1]))));
  const todos = tem("-A", "--all", "--no-ignore-removal");
  const soRastreados = tem("-u", "--update");
  if (!specs.length && !todos && !soRastreados) return [];
  const cands = [];
  for (const abs of criados.keys()) {
    const rel = relDaRaiz(root, abs);
    if (!rel) continue;
    if (specs.length ? specs.some((ps) => pathspecCobre(ps, call.dir, root, abs)) : true) cands.push(rel);
  }
  if (!cands.length) return [];
  let out = cands;
  if (soRastreados) {
    const rastreados = trackedFiles(root, { timeout: p.restante() }) || new Set();
    out = out.filter((f) => rastreados.has(f));
  }
  if (!tem("-f", "--force")) {
    const ignorados = ignoredPaths(root, out, { timeout: p.restante() });
    if (ignorados) out = out.filter((f) => !ignorados.has(f));
  }
  return out;
}

/**
 * Troca, no exame, o conteúdo do disco pelo que a linha grava antes do commit: conteúdo conhecido
 * (heredoc, `echo`, `printf`) é examinado no lugar do disco; conteúdo desconhecido (`sed -i`,
 * `cp`, `curl -o`, redirecionamento de outro comando) vira dúvida.
 */
function aplicarEscritos(exame, root, criados, incluido, p) {
  const anexados = criados.anexados || new Set();
  for (const [abs, conteudo] of criados) {
    const rel = relDaRaiz(root, abs);
    if (!rel || !incluido(rel)) continue;
    exame.files.add(rel);
    if (conteudo === null) {
      exame.alterados.add(rel);
      continue;
    }
    let antigas = new Set();
    if (!anexados.has(abs)) {
      exame.linhas = exame.linhas.filter((l) => l.file !== rel);
      exame.grandes.delete(rel);
      const head = git(root, ["show", `HEAD:${rel}`], { timeout: p.restante() });
      if (head !== null) antigas = new Set(head.split("\n"));
    }
    conteudo.split("\n").forEach((text, i) => {
      if (!antigas.has(text)) exame.linhas.push({ file: rel, line: i + 1, text });
    });
  }
}

/** Linha de `.env` com chave pública de front-end (VITE_, NEXT_PUBLIC_, PUBLIC_). */
const CHAVE_PUBLICA_RE = /^\s*(?:export\s+)?(?:VITE_|NEXT_PUBLIC_|PUBLIC_)[A-Za-z0-9_]*\s*=/;

/**
 * `.env` que JÁ está no último commit e recebe só chaves públicas (padrão do Lovable): não é
 * segredo novo, mas pede confirmação em vez de bloquear. Devolve os que se encaixam.
 */
function envsSoComChavesPublicas(root, files, linhas, p = prazo()) {
  const out = new Set();
  for (const f of files) {
    if (!arquivoProibido(f) || !path.posix.basename(f).startsWith(".env")) continue;
    if (git(root, ["cat-file", "-e", `HEAD:${f}`], { timeout: p.restante() }) === null) continue; // não estava versionado
    const minhas = linhas.filter((l) => l.file === f && l.text.trim() && !l.text.trim().startsWith("#"));
    if (minhas.every((l) => CHAVE_PUBLICA_RE.test(l.text))) out.add(f);
  }
  return out;
}

/** Expande `~`, `$VAR` e `${VAR}` de um caminho pelo ambiente; null se sobrar algo calculado. */
function expandirCaminho(f) {
  let ok = true;
  const v = f.replace(/^~(?=\/|$)/, os.homedir()).replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (_, a, b) => {
    const val = process.env[a || b];
    if (val === undefined) ok = false;
    return val ?? "";
  });
  return ok && !/[$`]/.test(v) ? v : null;
}

/** Conteúdo de um arquivo citado no comando (criado antes na mesma linha, ou no disco). null se não deu. */
function lerTexto(dir, f, criados) {
  const exp = expandirCaminho(f);
  if (exp === null) return null;
  const abs = path.resolve(dir, exp);
  const anexado = criados.anexados?.has(abs);
  if (criados.has(abs) && !anexado) return criados.get(abs); // null: gravado sem conteúdo conhecido
  try {
    return readFileSync(abs, "utf8").slice(0, LIMITE_BYTES) + (anexado ? criados.get(abs) : "");
  } catch {
    return anexado ? criados.get(abs) : null;
  }
}

/** Mensagem do commit: cada `-m`/`--message` e o conteúdo de `-F`/`--file` (`-` = heredoc). */
export function mensagensDoCommit(call, criados = new Map()) {
  const out = [];
  const a = call.args;
  const ler = (f) => (f === "-" ? (call.cmd?.heredocs?.[0] ?? null) : lerTexto(call.dir, f, criados));
  const guardar = (tipo, v) => {
    const t = typeof v !== "string" ? null : tipo === "m" ? v : ler(v);
    if (t) out.push(t);
  };
  for (let i = 0; i < a.length; i += 1) {
    const t = a[i];
    if (t === "--") break;
    if (t.startsWith("--")) {
      const eq = t.indexOf("=");
      const nome = eq > 0 ? t.slice(0, eq) : t;
      if (nome === "--message" || nome === "--file") guardar(nome === "--message" ? "m" : "F", eq > 0 ? t.slice(eq + 1) : a[++i]);
      else if (eq < 0 && ["--author", "--date", "--trailer", "--template", "--reuse-message", "--reedit-message", "--cleanup", "--fixup", "--squash"].includes(nome)) i += 1;
      continue;
    }
    if (!t.startsWith("-") || t.length < 2) continue;
    for (let k = 1; k < t.length; k += 1) {
      if (!"mFcCt".includes(t[k])) continue;
      const v = t.slice(k + 1) || a[++i];
      if (t[k] === "m" || t[k] === "F") guardar(t[k], v);
      break;
    }
  }
  return out;
}

/** Tudo o que o commit levaria: arquivos e linhas adicionadas (e a mensagem). null fora de repositório. */
export function conteudoDoCommit(call, pendentesDoAdd, p = prazo(), criados = new Map()) {
  const root = repoRoot(call.dir, { timeout: p.restante() });
  if (!root) return null;
  let todos = false;
  const pathspecs = [];
  for (let i = 0; i < call.args.length; i += 1) {
    const t = call.args[i];
    if (t === "--") {
      pathspecs.push(...call.args.slice(i + 1));
      break;
    }
    if (t === "--all") todos = true;
    const curtas = shortFlags(t);
    if (curtas.length) {
      // `-am msg`: lê as letras até a primeira que recebe argumento
      const k = curtas.findIndex((c) => "mFcCt".includes(c));
      const flags = k < 0 ? curtas : curtas.slice(0, k + 1);
      if (flags.includes("a")) todos = true;
      if (k >= 0 && k === curtas.length - 1) i += 1; // valor no próximo argumento
      continue;
    }
    if (["--message", "--file", "--author", "--date", "--trailer", "--template", "--reuse-message", "--reedit-message", "--cleanup", "--fixup", "--squash"].includes(t)) {
      i += 1;
      continue;
    }
    if (!t.startsWith("-")) pathspecs.push(t);
  }
  const o = (extra = {}) => ({ timeout: p.restante(), ...extra });
  const exame = novoExame();
  const pular = new Set([...criados.keys()].map((abs) => relDaRaiz(root, abs)).filter(Boolean));
  for (const msg of mensagensDoCommit(call, criados)) {
    msg.split("\n").forEach((text, i) => exame.linhas.push({ file: "mensagem do commit", line: i + 1, text }));
  }
  examinarJa(exame, p, pular);
  const falhou = () => {
    exame.incompleto = "o git não conseguiu montar o diff do commit (falhou ou o diff é grande demais)";
    return exame;
  };
  const staged = stagedFiles(root, o());
  const stagedLinhas = stagedDiffAddedLines(root, o());
  if (staged === null || stagedLinhas === null) return falhou();
  for (const f of staged) exame.files.add(f);
  for (const l of stagedLinhas) exame.linhas.push(l);
  examinarJa(exame, p, pular);
  if (todos) {
    const mod = modifiedTrackedFiles(root, o());
    const wl = worktreeDiffAddedLines(root, null, o());
    if (mod === null || wl === null) return falhou();
    for (const f of mod) exame.files.add(f);
    for (const l of wl) exame.linhas.push(l);
    examinarJa(exame, p, pular);
  }
  const extras = [...(pendentesDoAdd || [])];
  if (pathspecs.length && !pathspecs.some((ps) => ps.includes("$"))) {
    const out = git(call.dir, ["diff", "HEAD", "--name-only", "--", ...pathspecs], o());
    if (out) for (const f of out.split("\n").filter(Boolean)) extras.push(f);
  }
  const novos = [...new Set(extras)].filter((f) => !exame.files.has(f));
  if (novos.length) {
    const rastreados = trackedFiles(root, o()); // uma chamada só, em vez de uma por arquivo
    if (rastreados === null) return falhou();
    const temHead = hasCommits(root, o());
    const jaNoGit = new Set(novos.filter((f) => temHead && rastreados.has(f)));
    for (const f of novos) exame.files.add(f);
    if (jaNoGit.size) {
      const wl = worktreeDiffAddedLines(root, [...jaNoGit], o({ base: "HEAD" }));
      if (wl === null) return falhou();
      for (const l of wl) exame.linhas.push(l);
      examinarJa(exame, p, pular);
    }
    for (const f of novos) {
      if (jaNoGit.has(f)) continue;
      p.checar();
      lerArquivoNovo(root, f, exame);
      examinarJa(exame, p, pular);
    }
  }
  // arquivos gravados antes na mesma linha: o disco ainda tem o conteúdo de antes
  if (criados.size) {
    let rastreados = null;
    const rastreado = (f) => {
      rastreados = rastreados || trackedFiles(root, o()) || new Set();
      return rastreados.has(f);
    };
    const porSpec = (f) => pathspecs.some((ps) => pathspecCobre(ps, call.dir, root, path.join(root, f)));
    aplicarEscritos(exame, root, criados, (f) => exame.files.has(f) || (rastreado(f) && (todos || porSpec(f))), p);
  }
  // dump/planilha grande já no índice (o diff de binário não mostra conteúdo)
  for (const f of exame.files) {
    if (!DADOS_RE.test(f) || exame.dados.has(f)) continue;
    try {
      if (statSync(path.join(root, f)).size > LIMITE_BYTES) exame.dados.add(f);
    } catch {
      // apagado da pasta: segue
    }
  }
  exame.chavesPublicas = envsSoComChavesPublicas(root, [...exame.files], exame.linhas, p);
  return exame;
}

/** Arquivos que `git add` levaria numa pasta que ainda não é repositório (respeita o .gitignore). */
export function arquivosSemRepositorio(dir, args, p = prazo()) {
  if (!existsSync(dir) || !gitDisponivel()) return [];
  const pathspecs = args.filter((a) => !a.startsWith("-") && !a.includes("$") && !a.includes("`"));
  const pulada = (rel) => rel.split("/").some((seg) => PASTAS_PULADAS.has(seg));
  // repositório descartável: o próprio git diz o que entraria, respeitando o .gitignore da pasta
  let tmp = null;
  try {
    tmp = mkdtempSync(path.join(os.tmpdir(), "eg-segredos-"));
    if (git(tmp, ["init", "-q", "--bare", "."], { timeout: p.restante() }) !== null) {
      const out = git(dir, [`--git-dir=${tmp}`, "--work-tree=.", "ls-files", "--others", "--exclude-standard", "-z", "--", ...pathspecs], { timeout: p.restante() });
      if (out !== null) return out.split("\0").filter(Boolean).filter((f) => !pulada(f));
    }
  } catch {
    // cai na varredura da pasta
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
  const out = [];
  const walk = (rel) => {
    p.checar();
    let entries = [];
    try {
      entries = readdirSync(path.join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (PASTAS_PULADAS.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk("");
  return out;
}

/**
 * Texto de um valor de `--body`/`--title`/campo do `gh api`. Literal vale como está;
 * `$(cat <<EOF ...)` vale pelo texto do heredoc; `$(cat arquivo)` lê o arquivo. Qualquer outra
 * expansão (`$VAR`, `$(outro comando)`, crase) devolve null: não dá para saber o que vai.
 */
function textoDoValor(item, dir, criados) {
  if (!item.dynamic) return item.value;
  const partes = [];
  let resto = "";
  let pos = 0;
  for (const sub of substituicoes(item.value)) {
    resto += item.value.slice(pos, sub.inicio);
    pos = sub.fim;
    const cmds = parseCommands(sub.interno, dir);
    if (cmds.length !== 1 || cmds[0].base !== "cat") return null;
    const [c] = cmds;
    if (c.heredocs.length) {
      partes.push(c.heredocs.join("\n"));
      continue;
    }
    if (!c.args.length || c.argItems.some((w) => w.dynamic || w.value.startsWith("-"))) return null;
    for (const f of c.args) {
      const t = lerTexto(c.dir, f, criados);
      if (t === null) return null;
      partes.push(t);
    }
  }
  resto += item.value.slice(pos);
  if (/\$[A-Za-z_{0-9@*#?!-]|`/.test(resto)) return null;
  return [resto, ...partes].join("\n");
}

/**
 * Opções de texto de cada `gh <grupo> <ação>`: `valores` (texto na linha), `arquivos` (caminho do
 * texto), `comArg` (outras opções que recebem valor) e `posArquivos` (os posicionais são arquivos).
 */
const GH_TEXTOS = {
  "issue create": { valores: ["--body", "-b", "--title", "-t"], arquivos: ["--body-file", "-F"] },
  "issue comment": { valores: ["--body", "-b"], arquivos: ["--body-file", "-F"] },
  "issue edit": { valores: ["--body", "-b", "--title", "-t"], arquivos: ["--body-file", "-F"] },
  "issue close": { valores: ["--comment", "-c"], arquivos: [] },
  "pr create": { valores: ["--body", "-b", "--title", "-t"], arquivos: ["--body-file", "-F"] },
  "pr comment": { valores: ["--body", "-b"], arquivos: ["--body-file", "-F"] },
  "pr edit": { valores: ["--body", "-b", "--title", "-t"], arquivos: ["--body-file", "-F"] },
  "pr review": { valores: ["--body", "-b"], arquivos: ["--body-file", "-F"] },
  "pr merge": { valores: ["--body", "-b", "--subject", "-t"], arquivos: ["--body-file", "-F"] },
  "pr close": { valores: ["--comment", "-c"], arquivos: [] },
  "release create": { valores: ["--notes", "-n", "--title", "-t"], arquivos: ["--notes-file", "-F"] },
  "release edit": { valores: ["--notes", "-n", "--title", "-t"], arquivos: ["--notes-file", "-F"] },
  "gist create": { valores: ["--desc", "-d"], arquivos: [], comArg: ["--filename", "-f"], posArquivos: true },
};

/**
 * Textos que um comando `gh` publica: corpo, título, comentário e notas de `gh issue|pr|release`
 * (`GH_TEXTOS`, com o conteúdo de `--body-file`/`--notes-file`), os arquivos de `gh gist create`
 * e `gh api` (`-f|-F|--field|--raw-field body=|title=`, `--input`).
 * `naoExaminados`: o que não deu para ler (pipe em `-F -`, valor calculado, arquivo ilegível).
 */
export function textosDoGh(cmd, criados = new Map()) {
  if (cmd.base !== "gh" || cmd.remoto) return null;
  const a = cmd.args;
  const api = a[0] === "api";
  const regra = api ? null : GH_TEXTOS[`${a[0]} ${a[1]}`];
  if (!api && !regra) return null;
  const textos = [];
  const naoExaminados = [];
  const entrada = () => {
    if (cmd.heredocs.length) return cmd.heredocs[0];
    const r = cmd.redirects.find((x) => x.op === "<");
    return r && !r.dynamic ? lerTexto(cmd.dir, r.target, criados) : null; // pipe: não dá para ler
  };
  const doArquivo = (f, onde) => {
    const t = f === "-" ? entrada() : lerTexto(cmd.dir, f, criados);
    if (t === null) naoExaminados.push(`${onde} ${f}`);
    else textos.push(t);
  };
  const doValor = (item, valor, onde) => {
    const t = textoDoValor({ ...item, value: valor }, cmd.dir, criados);
    if (t === null) naoExaminados.push(`${onde} com valor calculado`);
    else textos.push(t);
  };
  for (let i = api ? 1 : 2; i < a.length; i += 1) {
    const t = a[i];
    const eq = t.startsWith("--") ? t.indexOf("=") : -1;
    const nome = eq > 0 ? t.slice(0, eq) : t;
    const pegar = () => {
      if (eq > 0) return { item: cmd.argItems[i], valor: t.slice(eq + 1) };
      i += 1;
      return a[i] === undefined ? null : { item: cmd.argItems[i], valor: a[i] };
    };
    if (!api && regra.valores.includes(nome)) {
      const v = pegar();
      if (v) doValor(v.item, v.valor, nome);
    } else if (!api && regra.arquivos.includes(nome)) {
      const v = pegar();
      if (v) doArquivo(v.valor, nome);
    } else if (!api && regra.comArg?.includes(nome)) {
      pegar();
    } else if (!api && regra.posArquivos && (t === "-" || !t.startsWith("-"))) {
      doArquivo(t, "arquivo");
    } else if (api && ["-f", "--raw-field", "-F", "--field"].includes(nome)) {
      const v = pegar();
      const m = v && /^(body|title)=([\s\S]*)$/.exec(v.valor);
      if (!m) continue;
      if ((nome === "-F" || nome === "--field") && m[2].startsWith("@")) doArquivo(m[2].slice(1), `${nome} ${m[1]}=@`);
      else doValor(v.item, m[2], `${nome} ${m[1]}=`);
    } else if (api && nome === "--input") {
      const v = pegar();
      if (v) doArquivo(v.valor, nome);
    }
  }
  return { rotulo: api ? "gh api" : `gh ${a[0]} ${a[1]}`, textos, naoExaminados };
}

function denyArquivos(lista, verbo) {
  return deny(
    mensagem({
      trava: TRAVA,
      oQue: `Bloqueado: ${verbo} de arquivo de segredo: ${lista.map((f) => `\`${f}\``).join(", ")}.`,
      porque: "segredo que entra no histórico do git fica lá mesmo depois de apagado, e qualquer pessoa com acesso ao repositório passa a tê-lo.",
      comoFazer: "tire o arquivo do commit (`git restore --staged <arquivo>`), coloque o nome no `.gitignore` e, se precisar documentar as variáveis, versione um `.env.example` sem valores reais.",
    }),
  );
}

function denySegredo(bloqueios, onde) {
  return deny(
    mensagem({
      trava: TRAVA,
      oQue: `Bloqueado: ${onde} o que parece ser segredo.`,
      porque: "token no histórico do git (ou num PR/issue) continua válido e exposto mesmo depois de apagado.",
      comoFazer: "tire o valor do código e leia de variável de ambiente (`.env` fora do git, ou o cofre da plataforma); se o token já foi enviado a algum lugar, revogue e gere outro.",
      detalhe: `Onde:\n${bloqueios.slice(0, 10).map((b) => `- ${b}`).join("\n")}`,
    }),
  );
}

/** Julga um exame: deny pronto, ou a lista do que precisa de confirmação. */
function julgar(exame, verbo, p) {
  const resto = examinarLinhas(exame.linhas.filter((l) => !l.examinada), p);
  const bloqueios = [...exame.previo.bloqueios, ...resto.bloqueios];
  const avisos = [...exame.previo.avisos, ...resto.avisos];
  if (bloqueios.length) return { saida: denySegredo(bloqueios, `${verbo} adiciona`) };
  const proibidos = [...exame.files].filter((f) => arquivoProibido(f) && !exame.chavesPublicas.has(f));
  if (proibidos.length) return { saida: denyArquivos(proibidos, verbo) };
  const duvidas = [];
  if (exame.incompleto) duvidas.push(exame.incompleto);
  for (const f of exame.grandes) duvidas.push(`arquivo grande não examinado por inteiro: ${f}`);
  for (const f of exame.dados) duvidas.push(`arquivo de dados (dump/planilha) acima de 1 MB: ${f}`);
  for (const f of exame.alterados) duvidas.push(`arquivo alterado na mesma linha antes do commit (conteúdo não aparece no comando): ${f}`);
  for (const f of exame.chavesPublicas) duvidas.push(`${f} já está versionado e recebe só chaves públicas de front-end (VITE_/NEXT_PUBLIC_/PUBLIC_)`);
  for (const a of avisos) duvidas.push(a);
  return { duvidas };
}

/** @param {{orcamentoMs?: number, prazo?: object}} [opts] orcamentoMs/prazo: prazo do exame (testes) */
export function decide(payload, opts = {}) {
  if (payload.tool_name !== "Bash") return null;
  const command = payload.tool_input?.command;
  if (typeof command !== "string" || !/\b(git|gh)\b/.test(command)) return null;
  const orcamento = opts.orcamentoMs ?? ORCAMENTO_MS;
  const p = opts.prazo ?? prazo(orcamento);
  const duvidas = [];
  try {
    const cmds = parseCommands(command, payload.cwd || process.cwd());
    const pendentes = new Map(); // raiz -> caminhos que um `git add` anterior incluiria
    let houveInit = false;
    for (let idx = 0; idx < cmds.length; idx += 1) {
      p.checar();
      const cmd = cmds[idx];
      const gh = textosDoGh(cmd, arquivosCriados(cmds, idx));
      if (gh) {
        const linhas = gh.textos.flatMap((t) => t.split("\n").map((text, i) => ({ file: `${gh.rotulo} (texto)`, line: i + 1, text })));
        const { bloqueios, avisos } = examinarLinhas(linhas, p);
        if (bloqueios.length) return denySegredo(bloqueios, `\`${gh.rotulo}\` publica`);
        for (const a of avisos) duvidas.push(a);
        for (const n of gh.naoExaminados) duvidas.push(`\`${gh.rotulo}\`: corpo não examinado (${n})`);
        continue;
      }
      const call = gitCallOf(cmd);
      if (!call) continue;
      if (call.sub === "init") houveInit = true;
      if (call.sub === "add") {
        const root = repoRoot(call.dir, { timeout: p.restante() });
        if (!root) {
          // sem `git init` antes, o `git add` vai falhar sozinho (e não vale varrer, ex., a home)
          if (!houveInit) continue;
          // `git init && git add . && git commit` numa chamada só: examina a pasta
          const exame = novoExame();
          for (const f of arquivosSemRepositorio(call.dir, call.args, p)) {
            exame.files.add(f);
            p.checar();
            lerArquivoNovo(call.dir, f, exame);
            examinarJa(exame, p);
          }
          const r = julgar(exame, "`git add`", p);
          if (r.saida) return r.saida;
          for (const a of r.duvidas) duvidas.push(a);
          continue;
        }
        const criados = arquivosCriados(cmds, idx);
        const listados = arquivosDoAdd(call.dir, call.args, p);
        const { incompleto } = listados;
        const files = [...new Set([...listados.files, ...escritosDoAdd(root, call, criados, p)])];
        if (incompleto) duvidas.push(`o git não conseguiu listar o que \`${call.cmd.text}\` incluiria (falhou ou passou do prazo)`);
        const proibidos = files.filter(arquivoProibido);
        if (proibidos.length) {
          const linhas = worktreeDiffAddedLines(root, proibidos, { base: "HEAD", timeout: p.restante() }) || [];
          const publicos = envsSoComChavesPublicas(root, proibidos, linhas);
          const reais = proibidos.filter((f) => !publicos.has(f));
          if (reais.length) return denyArquivos(reais, "`git add`");
        }
        pendentes.set(root, [...(pendentes.get(root) || []), ...files]);
        continue;
      }
      if (call.sub !== "commit") continue;
      const root = repoRoot(call.dir, { timeout: p.restante() });
      const exame = conteudoDoCommit(call, root ? pendentes.get(root) : [], p, arquivosCriados(cmds, idx));
      if (!exame) continue;
      const r = julgar(exame, "o commit", p);
      if (r.saida) return r.saida;
      for (const a of r.duvidas) duvidas.push(a);
    }
  } catch (e) {
    if (!(e instanceof PrazoEstourado)) throw e;
    // segredo certo achado antes do prazo acabar continua bloqueando
    if (p.bloqueios.length) return denySegredo([...new Set(p.bloqueios)], "o commit adiciona");
    duvidas.unshift(`commit grande demais para examinar por inteiro (passou de ${orcamento / 1000} s)`);
  }
  if (!duvidas.length) return null;
  return ask(
    mensagem({
      trava: TRAVA,
      oQue: "Confirme: há algo com formato de dado pessoal ou token, ou que a trava não conseguiu examinar por inteiro.",
      porque: "CPF, telefone, token e dump de banco no git (ou num PR/issue) ficam no histórico para sempre; às vezes é só dado de teste ou arquivo legítimo.",
      comoFazer: `confira cada item abaixo. Dado real: cancele, troque por dado fictício (ex.: CPF ${EXEMPLOS_FICTICIOS.cpf}, telefone ${EXEMPLOS_FICTICIOS.telefone}, que a trava não pergunta de novo) e refaça. Dump/planilha de produção: tire do commit e coloque no \`.gitignore\`. Dado de teste, chave pública ou arquivo legítimo: confirme. Corpo de PR/issue não examinado: escreva o texto num arquivo ou heredoc e use \`--body-file\`.`,
      detalhe: `Itens:\n${[...new Set(duvidas)].slice(0, 12).map((a) => `- ${a}`).join("\n")}`,
    }),
  );
}

runHook(import.meta.url, (payload) => decide(payload));
