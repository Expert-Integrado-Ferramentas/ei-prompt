#!/usr/bin/env node
/**
 * CLI — mede tokens, custo e tempo da entrega de uma branch e imprime o bloco "Custo e tempo" do PR.
 *
 * Uso (de qualquer pasta dentro do repositório): `node .claude/hooks/expert/medir-entrega.mjs`
 * Opções: `--branch <nome>` (padrão: a branch atual), `--sessao <id>` (mede a sessão inteira, para
 * trabalho feito de uma sessão aberta em outra pasta), `--projetos <pasta>` (padrão:
 * `$CLAUDE_CONFIG_DIR/projects` ou `~/.claude/projects`), `--json`.
 *
 * Lê os registros locais do Claude Code (um `.jsonl` por sessão, subagentes incluídos) das pastas
 * do repositório e das worktrees dele, e soma só as mensagens gravadas com `gitBranch` igual à
 * branch. O custo é o preço de tabela da API (`PRECOS`): na assinatura não há cobrança por token,
 * o número serve para comparar entregas. Nunca falha a entrega: sem registro, diz que a medição
 * ficou indisponível e sai com 0.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { currentBranch, git, repoRoot } from "./lib/git.mjs";
import { isMain } from "./lib/output.mjs";

/** Data da tabela abaixo; atualize junto com os preços. */
export const PRECOS_EM = "2026-11";

/**
 * US$ por milhão de tokens. `leitura` é o cache lido; gravar no cache custa 1,25× a entrada
 * (5 min) ou 2× (1 h). Ordem importa: o primeiro prefixo que casar vence.
 */
export const PRECOS = [
  ["claude-fable-5-1", { entrada: 10, saida: 50, leitura: 0.25 }],
  ["claude-mythos-5-1", { entrada: 10, saida: 50, leitura: 0.25 }],
  ["claude-fable-5", { entrada: 10, saida: 50, leitura: 1 }],
  ["claude-mythos-5", { entrada: 10, saida: 50, leitura: 1 }],
  ["claude-opus-5-5", { entrada: 4, saida: 20, leitura: 0.2 }],
  ["claude-opus-5", { entrada: 5, saida: 25, leitura: 0.5 }],
  ["claude-opus-4-8", { entrada: 5, saida: 25, leitura: 0.5 }],
  ["claude-opus-4-7", { entrada: 5, saida: 25, leitura: 0.5 }],
  ["claude-opus-4-6", { entrada: 5, saida: 25, leitura: 0.5 }],
  ["claude-opus-4-5", { entrada: 5, saida: 25, leitura: 0.5 }],
  ["claude-opus-4", { entrada: 15, saida: 75, leitura: 1.5 }],
  ["claude-sonnet-5-5", { entrada: 2, saida: 10, leitura: 0.2 }],
  ["claude-sonnet-5", { entrada: 2, saida: 10, leitura: 0.2 }],
  ["claude-sonnet-4", { entrada: 3, saida: 15, leitura: 0.3 }],
  ["claude-3-7-sonnet", { entrada: 3, saida: 15, leitura: 0.3 }],
  ["claude-haiku-5-5", { entrada: 0.1, saida: 0.5, leitura: 0.01 }],
  ["claude-haiku-4-5", { entrada: 1, saida: 5, leitura: 0.1 }],
  ["claude-3-5-haiku", { entrada: 0.8, saida: 4, leitura: 0.08 }],
];

/** Pausa maior que isto entre duas mensagens não conta como tempo ativo. */
export const PAUSA_MAXIMA_MS = 15 * 60 * 1000;

/** `anthropic.claude-opus-5-5`, `claude-opus-4-5-20251101`, `claude-sonnet-4-6[1m]` → preço. */
export function precoDoModelo(modelo) {
  const id = String(modelo || "")
    .toLowerCase()
    .replace(/^.*?(claude-)/, "$1")
    .replace(/\[.*\]$/, "");
  return PRECOS.find(([prefixo]) => id === prefixo || id.startsWith(`${prefixo}-`) || id.startsWith(`${prefixo}@`))?.[1] ?? null;
}

/** Nome da pasta do Claude Code para um caminho: tudo que não é letra ou dígito vira `-`. */
export const pastaDoProjeto = (caminho) => caminho.replace(/[^A-Za-z0-9]/g, "-");

function worktrees(root) {
  const out = git(root, ["worktree", "list", "--porcelain"]);
  const lista = out ? [...out.matchAll(/^worktree (.+)$/gm)].map((m) => m[1]) : [];
  return lista.length ? lista : [root];
}

function arquivosJsonl(dir) {
  const achados = [];
  for (const nome of readdirSync(dir)) {
    const p = path.join(dir, nome);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) achados.push(...arquivosJsonl(p));
    else if (nome.endsWith(".jsonl")) achados.push(p);
  }
  return achados;
}

const dentroDe = (cwd, pastas) => typeof cwd === "string" && pastas.some((p) => cwd === p || cwd.startsWith(`${p}/`));

/**
 * Soma tokens, custo e tempo das mensagens da branch (ou de uma sessão inteira, com `sessao`).
 * @param {{pastas: string[], branch: string, projetos: string, sessao?: string}} alvo
 */
export function medir({ pastas, branch, projetos, sessao }) {
  const prefixos = pastas.map(pastaDoProjeto);
  const dirs = existsSync(projetos)
    ? readdirSync(projetos)
        .filter((d) => (sessao ? existsSync(path.join(projetos, d, `${sessao}.jsonl`)) : prefixos.some((p) => d === p || d.startsWith(`${p}-`))))
        .map((d) => path.join(projetos, d))
    : [];
  const daSessao = (r) => r.sessionId === sessao;
  const daBranch = (r) => r.gitBranch === branch && dentroDe(r.cwd, pastas);
  const vistos = new Set();
  const momentos = [];
  const sessoes = new Set();
  const subagentes = new Set();
  const porModelo = new Map();
  for (const arq of dirs.flatMap(arquivosJsonl)) {
    let texto;
    try {
      texto = readFileSync(arq, "utf8");
    } catch {
      continue;
    }
    for (const linha of texto.split("\n")) {
      if (!linha.includes(sessao ? sessao : `"gitBranch"`)) continue;
      let r;
      try {
        r = JSON.parse(linha);
      } catch {
        continue;
      }
      if (!(sessao ? daSessao(r) : daBranch(r))) continue;
      const t = Date.parse(r.timestamp);
      if (!Number.isNaN(t)) momentos.push(t);
      if (r.sessionId && !r.isSidechain) sessoes.add(r.sessionId);
      if (r.agentId) subagentes.add(r.agentId);
      const u = r.message?.usage;
      if (r.type !== "assistant" || !u) continue;
      // O Claude Code grava uma linha por bloco da resposta, todas com o mesmo usage.
      const chave = `${r.message.id ?? ""}:${r.requestId ?? ""}`;
      if (chave !== ":" && vistos.has(chave)) continue;
      vistos.add(chave);
      const modelo = r.message.model || "desconhecido";
      if (modelo === "<synthetic>") continue;
      const m = porModelo.get(modelo) || { modelo, entrada: 0, saida: 0, gravado5m: 0, gravado1h: 0, lido: 0, custo: 0, semPreco: false };
      const gravado = u.cache_creation_input_tokens || 0;
      const g1h = u.cache_creation?.ephemeral_1h_input_tokens || 0;
      const g5m = u.cache_creation ? u.cache_creation.ephemeral_5m_input_tokens || 0 : gravado;
      const parcela = { entrada: u.input_tokens || 0, saida: u.output_tokens || 0, gravado5m: g5m, gravado1h: g1h, lido: u.cache_read_input_tokens || 0 };
      for (const k of Object.keys(parcela)) m[k] += parcela[k];
      const preco = precoDoModelo(modelo);
      if (preco) {
        const fator = u.speed === "fast" ? 2 : 1;
        m.custo +=
          (fator *
            (parcela.entrada * preco.entrada +
              parcela.saida * preco.saida +
              parcela.gravado5m * preco.entrada * 1.25 +
              parcela.gravado1h * preco.entrada * 2 +
              parcela.lido * preco.leitura)) /
          1e6;
      } else m.semPreco = true;
      porModelo.set(modelo, m);
    }
  }
  momentos.sort((a, b) => a - b);
  let ativoMs = 0;
  for (let i = 1; i < momentos.length; i += 1) {
    const d = momentos[i] - momentos[i - 1];
    if (d <= PAUSA_MAXIMA_MS) ativoMs += d;
  }
  const modelos = [...porModelo.values()].sort((a, b) => b.custo - a.custo);
  const soma = (k) => modelos.reduce((s, m) => s + m[k], 0);
  return {
    branch,
    sessao: sessao || null,
    mensagens: momentos.length,
    inicio: momentos.length ? new Date(momentos[0]).toISOString() : null,
    fim: momentos.length ? new Date(momentos.at(-1)).toISOString() : null,
    totalMs: momentos.length ? momentos.at(-1) - momentos[0] : 0,
    ativoMs,
    sessoes: sessoes.size,
    subagentes: subagentes.size,
    tokens: { entrada: soma("entrada"), saida: soma("saida"), gravado: soma("gravado5m") + soma("gravado1h"), lido: soma("lido") },
    custo: soma("custo"),
    modelos,
    precosEm: PRECOS_EM,
  };
}

const inteiro = (n) => Math.round(n).toLocaleString("pt-BR");
const dolar = (n) => `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function duracao(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}

/** Bloco em markdown para colar na descrição do PR. */
export function formatar(r) {
  if (!r.mensagens) {
    return [
      "## Custo e tempo",
      "",
      r.sessao
        ? `Medição indisponível: nenhum registro da sessão \`${r.sessao}\` nesta máquina.`
        : `Medição indisponível: nenhum registro do Claude Code para a branch \`${r.branch}\` nesta máquina (trabalho feito em outra máquina, na nuvem, antes de criar a branch ou numa sessão aberta em outra pasta: nesse caso use \`--sessao <id>\`).`,
    ].join("\n");
  }
  const t = r.tokens;
  const linhas = [
    "## Custo e tempo",
    "",
    "| Medida | Valor |",
    "| --- | --- |",
    `| Tempo total (1ª à última mensagem ${r.sessao ? "da sessão" : "na branch"}) | ${duracao(r.totalMs)} |`,
    `| Tempo ativo (sem pausas acima de ${PAUSA_MAXIMA_MS / 60000} min) | ${duracao(r.ativoMs)} |`,
    `| Sessões / subagentes | ${r.sessoes} / ${r.subagentes} |`,
    `| Tokens de entrada / saída | ${inteiro(t.entrada)} / ${inteiro(t.saida)} |`,
    `| Tokens de cache gravado / lido | ${inteiro(t.gravado)} / ${inteiro(t.lido)} |`,
    `| Custo equivalente na API | ${dolar(r.custo)}${r.modelos.some((m) => m.semPreco) ? " (sem os modelos marcados como sem preço)" : ""} |`,
    "",
    "| Modelo | Entrada | Saída | Cache gravado | Cache lido | Custo |",
    "| --- | --- | --- | --- | --- | --- |",
    ...r.modelos.map(
      (m) =>
        `| \`${m.modelo}\` | ${inteiro(m.entrada)} | ${inteiro(m.saida)} | ${inteiro(m.gravado5m + m.gravado1h)} | ${inteiro(m.lido)} | ${m.semPreco ? "sem preço" : dolar(m.custo)} |`,
    ),
    "",
    `Medido pelo \`medir-entrega\` nos registros locais do Claude Code (${r.sessao ? `sessão \`${r.sessao}\` inteira` : `mensagens gravadas na branch \`${r.branch}\``}, subagentes incluídos). Custo pelo preço de tabela da API (${r.precosEm}); na assinatura não há cobrança por token, o número serve para comparar entregas.`,
  ];
  return linhas.join("\n");
}

function opcao(args, nome) {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
}

/**
 * @param {string} cwd
 * @param {string[]} [args]
 * @param {{log?: (s: string) => void}} [opts]
 * @returns {number} código de saída
 */
export function main(cwd, args = [], opts = {}) {
  const log = opts.log || ((s) => process.stdout.write(`${s}\n`));
  const root = repoRoot(cwd);
  const branch = opcao(args, "--branch") || (root && currentBranch(root));
  if (!root || !branch) {
    log("medir-entrega: rode dentro de um repositório git, numa branch (ou passe `--branch <nome>`).");
    return 0;
  }
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const projetos = opcao(args, "--projetos") || path.join(base, "projects");
  const r = medir({ pastas: worktrees(root), branch, projetos, sessao: opcao(args, "--sessao") });
  log(args.includes("--json") ? JSON.stringify(r, null, 2) : formatar(r));
  return 0;
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = main(process.cwd(), process.argv.slice(2));
  } catch (e) {
    process.stdout.write(`## Custo e tempo\n\nMedição indisponível: ${e?.message || e}\n`);
  }
}
