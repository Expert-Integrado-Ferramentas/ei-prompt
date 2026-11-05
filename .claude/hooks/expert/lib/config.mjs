/**
 * Configuração do harness no projeto: `<raiz>/.claude/expert-governanca.json` (CONTRATO.md).
 * Todo campo é opcional; o que faltar vem de DEFAULTS.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const CONFIG_RELATIVE = path.join(".claude", "expert-governanca.json");

export const DEFAULTS = Object.freeze({
  versao: "0.4.0",
  branchesProtegidas: ["main", "master"],
  tiposDeBranch: ["feat", "fix", "refactor", "test", "chore", "docs", "hotfix"],
  commit: { coautoriaClaude: "proibir" },
  testes: {
    timeoutSegundos: 300,
    linhaDeBase: { estado: "passando" },
  },
  claudeMd: { avisoLinhas: 200, bloqueioKb: 40 },
  repositorioDaMetodologia: "Expert-Integrado-Ferramentas/expert-governanca",
});

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Mescla `over` sobre `base` (objetos recursivamente; listas e escalares substituem). */
export function deepMerge(base, over) {
  if (!isPlainObject(over)) return structuredClone(base);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : structuredClone(v);
  }
  return out;
}

export function configPath(root) {
  return path.join(root, CONFIG_RELATIVE);
}

/** Lê o arquivo cru (sem padrões). null quando não existe ou é inválido. */
export function readRawConfig(root) {
  if (!root) return null;
  try {
    const parsed = JSON.parse(readFileSync(configPath(root), "utf8"));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {string|null} root raiz do repositório
 * @returns {{config: Record<string, any>, raw: Record<string, any>|null, exists: boolean}}
 */
export function loadConfig(root) {
  const raw = readRawConfig(root);
  const config = deepMerge(DEFAULTS, raw || {});
  if (!Array.isArray(config.branchesProtegidas)) config.branchesProtegidas = [...DEFAULTS.branchesProtegidas];
  if (!Array.isArray(config.tiposDeBranch) || config.tiposDeBranch.length === 0) {
    config.tiposDeBranch = [...DEFAULTS.tiposDeBranch];
  }
  return { config, raw, exists: raw !== null };
}

/**
 * Altera o arquivo de configuração preservando o resto. Só escreve se o arquivo existir
 * (sem arquivo, o padrão já é o que vale). Devolve true quando escreveu.
 * @param {string} root
 * @param {(raw: Record<string, any>) => void} mutate
 */
export function updateConfig(root, mutate) {
  const raw = readRawConfig(root);
  if (!raw) return false;
  mutate(raw);
  writeFileSync(configPath(root), `${JSON.stringify(raw, null, 2)}\n`);
  return true;
}

/**
 * Marca `testes.linhaDeBase` como "passando" no arquivo versionado. As travas NÃO chamam isto
 * (sujaria a árvore e travaria o deploy); fica para a skill instalando-harness / quem for commitar.
 */
export function marcarLinhaDeBasePassando(root, hoje = new Date()) {
  return updateConfig(root, (raw) => {
    raw.testes = isPlainObject(raw.testes) ? raw.testes : {};
    const base = isPlainObject(raw.testes.linhaDeBase) ? raw.testes.linhaDeBase : {};
    raw.testes.linhaDeBase = {
      ...base,
      estado: "passando",
      registradaEm: hoje.toISOString().slice(0, 10),
      falhas: 0,
    };
  });
}

/** Pasta de estado local (não versionada). Cria se preciso. */
export function stateDir(root, create = false) {
  const dir = path.join(root, ".claude", "state");
  if (create && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function readStateJson(root, name) {
  try {
    return JSON.parse(readFileSync(path.join(stateDir(root), name), "utf8"));
  } catch {
    return null;
  }
}

export function writeStateJson(root, name, value) {
  const dir = stateDir(root, true);
  writeFileSync(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
}
