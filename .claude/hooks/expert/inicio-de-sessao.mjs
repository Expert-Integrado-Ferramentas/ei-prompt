#!/usr/bin/env node
/**
 * Início de sessão (SessionStart).
 *
 * Contexto curto em pt-BR, só com o que se aplica (nada quando está tudo certo):
 *   - branch atrás/à frente do remoto (depois de `git fetch --quiet`, 5s; nunca faz pull/rebase);
 *   - pendências: arquivos não commitados, commits não enviados;
 *   - versão nova do harness (tags do repositório da metodologia, 4s, cache de 24h);
 *   - mapeamento: AGENTS.md raiz (ou CLAUDE.md, em projeto antigo; existe, tem tabela de pastas, dentro do tamanho; CLAUDE.md aponta para ele), CONTEXT.md,
 *     .claude/memory/MEMORY.md, linha de base de testes; mapeamento velho (90 dias ou 50+ arquivos
 *     novos na branch atual desde a data `mapeamento.organizadoEm` — por data, não por commit, porque
 *     o squash merge apaga o commit da organização);
 *   - linha de base que já passa localmente mas segue "falhando" no arquivo versionado.
 * Nunca bloqueia.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { loadConfig, readStateJson, writeStateJson } from "./lib/config.mjs";
import { aheadBehind, currentBranch, git, repoRoot, statusEntries, unpushedCount, upstreamSha } from "./lib/git.mjs";
import { context, runHook } from "./lib/output.mjs";
import { contarLinhas } from "./guard-claude-md.mjs";

const DIA_MS = 24 * 60 * 60 * 1000;

export function parseVersao(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compararVersoes(a, b) {
  const x = parseVersao(a);
  const y = parseVersao(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** Maior versão entre as tags de `git ls-remote --tags`. */
export function maiorTag(saida) {
  let melhor = null;
  for (const l of String(saida || "").split("\n")) {
    const m = /refs\/tags\/(v?\d+\.\d+\.\d+)$/.exec(l.trim());
    if (m && (!melhor || compararVersoes(m[1], melhor) > 0)) melhor = m[1];
  }
  return melhor;
}

/** Última versão publicada do harness (com cache de 24h). null quando não deu para saber. */
export function ultimaVersaoDoHarness(root, repositorio, agora) {
  const cache = readStateJson(root, "session-cache.json") || {};
  const c = cache.versaoDoHarness;
  if (c && c.repositorio === repositorio && agora - Date.parse(c.verificadoEm) < DIA_MS) return c.ultima ?? null;
  const url = process.env.EXPERT_GOVERNANCA_REMOTE || `https://github.com/${repositorio}.git`;
  const out = git(root, ["ls-remote", "--tags", "--refs", url], { timeout: 4000 });
  const ultima = out === null ? null : maiorTag(out);
  try {
    writeStateJson(root, "session-cache.json", { ...cache, versaoDoHarness: { repositorio, verificadoEm: new Date(agora).toISOString(), ultima } });
  } catch {
    // sem cache: tudo bem
  }
  return ultima;
}

/** Arquivos adicionados na branch atual desde a data (YYYY-MM-DD). 0 quando não dá para saber. */
export function arquivosNovosDesde(root, data) {
  const out = git(root, ["log", `--since=${data}`, "--diff-filter=A", "--name-only", "--format="]);
  if (!out) return 0;
  return new Set(out.split("\n").filter(Boolean)).size;
}

export function temTabelaDePastas(texto) {
  return /^\s*\|.*\bpastas?\b.*\|/im.test(texto) || /pasta\s*(→|->)/i.test(texto);
}

/**
 * @param {string} cwd
 * @param {{agora?: number}} [opts]
 * @returns {string[]} linhas de aviso
 */
export function avisos(cwd, opts = {}) {
  const agora = opts.agora ?? Date.now();
  const root = repoRoot(cwd);
  if (!root) return [];
  const { config, raw, exists } = loadConfig(root);
  const out = [];

  // 1. sincronia com o remoto
  const branch = currentBranch(root);
  if (upstreamSha(root)) {
    git(root, ["fetch", "--quiet"], { timeout: 5000 });
    const ab = aheadBehind(root);
    if (ab && ab.behind > 0) {
      out.push(`A branch \`${branch}\` está ${ab.behind} commit(s) atrás do remoto: rode \`git pull\` antes de começar, para não trabalhar sobre código velho.`);
    }
  }

  // 2. pendências
  const pend = statusEntries(root);
  const naoEnviados = unpushedCount(root);
  const partes = [];
  if (pend && pend.length) partes.push(`${pend.length} arquivo(s) não commitado(s)`);
  if (naoEnviados) partes.push(`${naoEnviados} commit(s) não enviado(s)`);
  if (partes.length) out.push(`Trabalho pendente em \`${branch || "HEAD solto"}\`: ${partes.join(", ")}. Pergunte à pessoa se é para continuar ou guardar antes de começar outra coisa.`);

  // 3. versão do harness
  if (exists && config.versao && config.repositorioDaMetodologia) {
    const ultima = ultimaVersaoDoHarness(root, config.repositorioDaMetodologia, agora);
    if (ultima && compararVersoes(ultima, config.versao) > 0) {
      out.push(`Há versão nova do harness (${ultima}; instalada: ${config.versao}): peça "atualiza o harness".`);
    }
  }

  // 4. mapeamento
  const falta = [];
  // AGENTS.md é a fonte; CLAUDE.md só aponta (@AGENTS.md). Projeto antigo, só com CLAUDE.md, segue valendo.
  const agentsMd = path.join(root, "AGENTS.md");
  const claudeMd = path.join(root, "CLAUDE.md");
  const principal = existsSync(agentsMd) ? agentsMd : claudeMd;
  const nome = path.basename(principal);
  if (!existsSync(principal)) falta.push("o AGENTS.md na raiz");
  else {
    const texto = readFileSync(principal, "utf8");
    if (!temTabelaDePastas(texto)) falta.push(`a tabela "pasta → o que mora lá" no ${nome}`);
    const linhas = contarLinhas(texto);
    const kb = Buffer.byteLength(texto, "utf8") / 1024;
    if (linhas > config.claudeMd.avisoLinhas || kb > config.claudeMd.bloqueioKb) {
      falta.push(`um ${nome} enxuto (hoje ${linhas} linhas, ${kb.toFixed(1)} KB)`);
    }
  }
  if (existsSync(agentsMd) && existsSync(claudeMd) && !/^\s*@AGENTS\.md\s*$/m.test(readFileSync(claudeMd, "utf8"))) {
    falta.push("a linha `@AGENTS.md` no CLAUDE.md (sem ela o Claude Code lê só o CLAUDE.md e ignora o AGENTS.md)");
  }
  if (!existsSync(path.join(root, "CONTEXT.md"))) falta.push("o CONTEXT.md (glossário)");
  if (!existsSync(path.join(root, ".claude", "memory", "MEMORY.md"))) falta.push("a memória do projeto (.claude/memory/MEMORY.md)");
  if (falta.length) out.push(`Projeto ainda não mapeado: falta ${falta.join(", ")}. Ofereça rodar a skill organizando-contexto.`);
  if (!exists) out.push("O harness não está configurado neste projeto (.claude/expert-governanca.json): ofereça rodar a skill instalando-harness.");
  else if (!raw?.testes?.linhaDeBase) out.push("Falta a linha de base de testes (testes.linhaDeBase): ofereça rodar a skill instalando-harness para registrá-la.");

  const mapa = config.mapeamento || {};
  let velho = null;
  if (mapa.organizadoEm && !Number.isNaN(Date.parse(mapa.organizadoEm)) && agora - Date.parse(mapa.organizadoEm) > 90 * DIA_MS) {
    velho = `organizado em ${mapa.organizadoEm}, há mais de 3 meses`;
  } else if (mapa.organizadoEm && !Number.isNaN(Date.parse(mapa.organizadoEm))) {
    const n = arquivosNovosDesde(root, mapa.organizadoEm);
    if (n > 50) velho = `${n} arquivos novos desde a organização em ${mapa.organizadoEm}`;
  }
  if (velho && !falta.length) out.push(`O mapeamento do projeto envelheceu (${velho}): ofereça rodar de novo a skill organizando-contexto.`);

  // 5. linha de base virou localmente
  const local = readStateJson(root, "linha-de-base.json");
  if (local?.estado === "passando" && raw?.testes?.linhaDeBase?.estado === "falhando") {
    out.push("A suíte já passa: atualize testes.linhaDeBase.estado para 'passando' no .claude/expert-governanca.json no próximo commit.");
  }
  return out;
}

export function decide(payload, opts = {}) {
  const linhas = avisos(payload.cwd || process.cwd(), opts);
  if (!linhas.length) return null;
  return context("SessionStart", `Harness da Expert:\n${linhas.map((l) => `- ${l}`).join("\n")}`);
}

runHook(import.meta.url, (p) => decide(p));
