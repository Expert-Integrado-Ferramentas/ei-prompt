#!/usr/bin/env node
/**
 * Banco e deploy por MCP (PreToolUse, matcher igual a `FERRAMENTA_RE`).
 *
 * Ferramentas MCP que alteram banco (migração, SQL, carga em massa, exclusão, branch do banco),
 * mudam esquema (`alterar_`, `renomear_`, `converter_`), publicam/apagam edge function (inclusive
 * `set_verify_jwt`), apagam recurso de infraestrutura (`r2_bucket_delete`, `kv_namespace_delete`,
 * `workers_delete`, `hyperdrive_delete`, `queue_delete`, `storage_delete`, `delete_branch`,
 * `delete_project`, `delete_bucket`, `delete_database`...) ou pausam/restauram projeto mexem direto
 * em produção sem passar pelo git (nem pela trava de deploy). Exclusão de evento de agenda,
 * comentário, documento ou mensagem de chat (`delete_event`, `chat_delete`) não é infraestrutura
 * e não entra. Pede confirmação. Ferramentas só de leitura (`query_sql`, `select`, `list_*`)
 * nem chegam aqui; `execute_sql`/`run_sql`/`d1_database_query` com um SELECT puro (ou `WITH ...
 * SELECT`, ou PRAGMA de leitura) passam sem perguntar.
 *
 * De propósito NÃO entram as operações de dado do dia a dia (`insert`, `update`, `rpc`): editar
 * registro do negócio com a permissão (RLS) da própria pessoa não é ponto de risco, e o Claude
 * Code já pede permissão para ferramenta MCP por padrão. Perguntar ali seria ruído.
 */
import { ask, mensagem, runHook } from "./lib/output.mjs";

export const FERRAMENTA_RE =
  /^mcp__.*(apply_migration|execute_sql|run_sql|d1_database_(?:query|delete)|deploy_edge_function|edge_function_(?:publish|delete|promote)|set_verify_jwt|update_from_query|insert_from_query|soft_delete|excluir_|remover_|drop_|alterar_|renomear_|converter_|reset_branch|merge_branch|pause_project|restore_project|(?:r2_bucket|kv_namespace|d1_database|workers?|hyperdrive|queue|branch|project|bucket|edge_function|storage|database)_delete|delete_(?:branch|project|bucket|database|worker|namespace))/;

/** Ferramentas que executam SQL livre: SELECT puro não precisa de confirmação. */
const SQL_LIVRE = /^(execute_sql|run_sql|d1_database_query)$/;
/** Dentro de um SELECT/WITH: CTE que escreve, `SELECT INTO`, `FOR UPDATE` e funções que mudam estado. */
const ESCREVE = /\b(insert|update|delete|merge|into|drop|alter|truncate|create|grant|revoke|copy|call)\b|\b(setval|nextval|set_config|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|dblink_exec|lo_unlink)\s*\(/i;
const PRAGMA_LEITURA = /^pragma\s+[\w.]+(?:\s*\(\s*['"\w.]+\s*\))?$/i;
const PRAGMA_COM_ARG = /^(?:\w+\.)?(table_x?info|table_list|index_(?:list|x?info)|foreign_key_(?:list|check)|integrity_check|quick_check)$/i;

/** O SQL é só leitura (um comando: SELECT, WITH ... SELECT ou PRAGMA de leitura)? */
export function sqlSoLeitura(sql) {
  if (typeof sql !== "string") return false;
  const s = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''") // texto entre aspas não conta como palavra-chave
    .trim()
    .replace(/;\s*$/, "")
    .trim();
  if (!s || s.includes(";")) return false; // mais de um comando
  if (/^pragma\b/i.test(s)) {
    if (s.includes("=") || !PRAGMA_LEITURA.test(s)) return false;
    return !s.includes("(") || PRAGMA_COM_ARG.test(/^pragma\s+([\w.]+)/i.exec(s)[1]);
  }
  return /^(select|with)\b/i.test(s) && !ESCREVE.test(s);
}

function sqlDe(input) {
  if (!input || typeof input !== "object") return null;
  for (const k of ["query", "sql", "statement", "command"]) if (typeof input[k] === "string") return input[k];
  return null;
}

export function decide(payload) {
  const tool = payload.tool_name;
  if (typeof tool !== "string") return null;
  const m = FERRAMENTA_RE.exec(tool);
  if (!m) return null;
  if (SQL_LIVRE.test(m[1]) && sqlSoLeitura(sqlDe(payload.tool_input))) return null;
  const nome = tool.split("__").pop();
  const deploy = /edge_function|set_verify_jwt/.test(nome);
  const oQue = deploy
    ? "publica, apaga ou muda a autenticação de uma edge function"
    : /pause_project|restore_project/.test(nome)
      ? "pausa ou restaura um projeto inteiro"
      : /alterar_|renomear_|converter_/.test(nome)
        ? "muda o esquema (campo, tipo ou entidade)"
        : /(^|_)delete(_|$)/.test(nome) && !/soft_delete|d1_database/.test(nome)
          ? "apaga um recurso de infraestrutura (branch, bucket, namespace, worker, banco ou projeto)"
          : "altera um banco (dado ou esquema)";
  return ask(
    mensagem({
      trava: "banco e deploy por MCP",
      oQue: `Confirme: \`${tool}\` ${oQue} direto pelo MCP, fora do fluxo do git.`,
      porque: deploy
        ? "publicar por fora do git não deixa rastro de qual código está no ar nem passa pelas checagens de deploy."
        : "migração, SQL ou exclusão aplicados direto no banco não ficam versionados e podem atingir produção sem revisão.",
      comoFazer: deploy
        ? "prefira publicar pelo repositório (`supabase functions deploy` na main em dia); se é só um teste ou ambiente de desenvolvimento, confira o projeto alvo e confirme."
        : "para mudar esquema, escreva a migração no repositório e aplique pelo fluxo de deploy; para ajuste pontual, confira o projeto/banco alvo e confirme.",
    }),
  );
}

runHook(import.meta.url, decide);
