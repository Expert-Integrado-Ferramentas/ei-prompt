#!/usr/bin/env node
/**
 * Trava 6 — deploy com rastro (PreToolUse, Bash).
 *
 * Antes de publicar (wrangler deploy / versions deploy / pages deploy, `npm run deploy`, vercel
 * --prod, netlify deploy --prod, supabase functions deploy, supabase db push, docker push) ou de
 * mexer em esquema de produção (`wrangler d1 migrations apply --remote`), confere:
 *   1. a pasta é um repositório git (publicar de cópia sem git apaga o rastro);
 *   2. nada pendente de commit;
 *   3. está numa branch protegida (a main);
 *   4. o HEAD é igual ao do remoto (já foi enviado);
 *   5. os testes passaram neste HEAD (`.claude/state/tests-ok.json`), quando o projeto tem testes.
 * Qualquer falha bloqueia com o motivo e o conserto. `wrangler versions upload` (prévia) passa.
 * Em `supabase db push`/`functions deploy` liberados, lembra de conferir RLS.
 *
 * Além disso:
 *   - deploy depois de algo que troca o commit ou mexe na pasta na mesma linha (`git pull`,
 *     `gh pr checkout`, `git stash pop|apply`, `git restore`, `git apply`, `git checkout -- x`
 *     `&& wrangler deploy`): bloqueia, porque a checagem vê o código de antes e publicaria outro;
 *   - operação destrutiva/irreversível em produção (`wrangler delete`, `d1 delete`,
 *     `d1 time-travel restore`, `supabase db reset --linked`, `migration up --linked`,
 *     `migration repair`, `psql -f` ou `-c` que escreve em banco remoto): sempre pede confirmação,
 *     mesmo na main em dia;
 *   - consulta/alteração pontual no banco de produção (`wrangler d1 execute --remote`, `psql`
 *     remoto só lendo): pede confirmação do alvo, sem as checagens de git (nunca bloqueia);
 *   - `docker compose up` local não é deploy (ambiente de dev); dentro de `ssh host '...'` é
 *     (checa o repositório local). Sem repositório local, ou num repositório sem compose.yaml/
 *     docker-compose.yml/Dockerfile (preparo de VPS, serviço de terceiros), só pede confirmação
 *     do serviço;
 *   - script de arquivo ou alvo do make com nome de deploy (`./deploy.sh`, `make deploy`) segue
 *     as checagens completas (o corpo é desconhecido); o mesmo vale para `npm run deploy|release|
 *     publish[...]` cujo corpo não usa ferramenta conhecida (`node scripts/deploy.mjs`);
 *   - `wrangler --env|-e <dev|staging|preview|hml|qa|test...>`: ambiente de teste, só pede
 *     confirmação do ambiente (sem as checagens de main/commit/testes).
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { loadConfig } from "./lib/config.mjs";
import { currentBranch, gitDisponivel, headSha, repoRoot, statusEntries, upstreamSha } from "./lib/git.mjs";
import { ask, context, deny, mensagem, runHook } from "./lib/output.mjs";
import { deploysNoComando, mascararComando } from "./lib/deploy.mjs";
import { linhaDeBaseEfetiva, resolveTestCommand, testsOkFor } from "./lib/testes.mjs";

const TRAVA = "deploy com rastro";
const PORQUE = "o que vai para o ar precisa ser exatamente um commit da main já enviado e testado, para se saber o que está publicado e o rollback ser simples.";
const ARQUIVOS_DE_CONTEINER = ["compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml", "Dockerfile"];

/** `docker compose up` via ssh sem nada de contêiner no repositório local (ou sem repositório). */
function conteinerDeFora(d) {
  if (!d.remoto || d.tipo !== "docker compose up") return false;
  const root = repoRoot(d.dir);
  if (!root) return true;
  return !ARQUIVOS_DE_CONTEINER.some((f) => existsSync(path.join(root, f)) || existsSync(path.join(d.dir, f)));
}

/**
 * Checa um deploy. @returns {{decisao: "deny"|"ask", texto: string}|null}
 */
export function checarDeploy(dep) {
  if (!gitDisponivel()) return null;
  const d = { ...dep, comando: mascararComando(dep.comando) };
  const root = repoRoot(d.dir);
  if (!root) {
    return {
      decisao: "deny",
      texto: mensagem({ trava: TRAVA, oQue: `Bloqueado: \`${d.comando}\` está rodando fora de um repositório git (${d.dir}).`, porque: PORQUE, comoFazer: "publique a partir do clone do projeto, na main atualizada (`git switch main && git pull`), sem copiar o código para outra pasta." }),
    };
  }
  const { config } = loadConfig(root);
  const pendentes = statusEntries(root);
  if (pendentes && pendentes.length) {
    const lista = pendentes.slice(0, 5).map((e) => e.path).join(", ");
    return {
      decisao: "deny",
      texto: mensagem({ trava: TRAVA, oQue: `Bloqueado: \`${d.comando}\` com ${pendentes.length} arquivo(s) pendente(s) de commit (${lista}${pendentes.length > 5 ? ", ..." : ""}).`, porque: PORQUE, comoFazer: "leve as alterações para uma branch e um PR (ou descarte-as); depois publique a partir da main limpa." }),
    };
  }
  const branch = currentBranch(root);
  if (!branch || !config.branchesProtegidas.includes(branch)) {
    return {
      decisao: "deny",
      texto: mensagem({ trava: TRAVA, oQue: `Bloqueado: \`${d.comando}\` fora da main (branch atual: \`${branch || "HEAD solto"}\`).`, porque: PORQUE, comoFazer: `mescle o PR primeiro (\`gh pr merge\`), depois \`git switch ${config.branchesProtegidas[0] || "main"} && git pull\` e publique de lá.` }),
    };
  }
  const head = headSha(root);
  const up = upstreamSha(root);
  if (!up || up !== head) {
    return {
      decisao: "deny",
      texto: mensagem({ trava: TRAVA, oQue: `Bloqueado: \`${d.comando}\` com a \`${branch}\` local diferente da do GitHub${up ? "" : " (sem branch remota configurada)"}.`, porque: PORQUE, comoFazer: `sincronize com \`git pull\` (commit local na \`${branch}\` deve ir por PR); publique quando \`git status\` disser que está em dia com o remoto.` }),
    };
  }
  const comando = resolveTestCommand(root, config);
  if (comando && !testsOkFor(root, head)) {
    const texto = mensagem({ trava: TRAVA, oQue: `${linhaDeBaseEfetiva(root, config) === "falhando" ? "Confirme" : "Bloqueado"}: não há registro de testes aprovados para o commit atual (${head.slice(0, 7)}).`, porque: PORQUE, comoFazer: "rode `node .claude/hooks/expert/registrar-testes.mjs` (roda a suíte e registra o commit; o tempo segue `testes.timeoutSegundos`, padrão 300 s) e publique de novo. Pelo Bash, use timeout de 600000 ms ou rode em segundo plano, para a suíte não ser cortada." });
    return { decisao: linhaDeBaseEfetiva(root, config) === "falhando" ? "ask" : "deny", texto };
  }
  return null;
}

export function decide(payload) {
  if (payload.tool_name !== "Bash") return null;
  const command = payload.tool_input?.command;
  if (typeof command !== "string") return null;
  const deploys = deploysNoComando(command, payload.cwd || process.cwd());
  if (deploys.length === 0) return null;
  const perguntas = [];
  const checagens = new Map();
  const checar = (d) => {
    if (!checagens.has(d.dir)) checagens.set(d.dir, checarDeploy(d));
    return checagens.get(d.dir);
  };
  for (const d of deploys) {
    const comando = mascararComando(d.comando);
    if (d.brando) {
      // consulta/alteração pontual no banco: o estado do git não decide; confirma o alvo
      perguntas.push(mensagem({ trava: TRAVA, oQue: `Confirme: \`${comando}\` é ${d.aviso.oQue}.`, porque: d.aviso.porque, comoFazer: d.aviso.comoFazer }));
      continue;
    }
    if (conteinerDeFora(d)) {
      // preparo de VPS: o serviço não vem deste repositório; o git local não diz nada sobre ele
      perguntas.push(
        mensagem({
          trava: TRAVA,
          oQue: `Confirme: \`${comando}\` é subida de contêiner na VPS: confirme o serviço.`,
          porque: "o compose roda do outro lado do ssh e não vem deste repositório, então as checagens de git não se aplicam; um alvo errado derruba serviço no ar.",
          comoFazer: "confira o host, a pasta e o serviço; se o serviço é deste projeto, publique a partir do repositório (main limpa, enviada e testada).",
        }),
      );
      continue;
    }
    if (d.depoisDe) {
      return deny(
        mensagem({
          trava: TRAVA,
          oQue: `Bloqueado: \`${comando}\` vem depois de \`${d.depoisDe}\` no mesmo comando.`,
          porque: "a trava confere o commit e a pasta de ANTES do comando rodar; o que iria para o ar seria outro código, que ninguém conferiu.",
          comoFazer: "rode o deploy num comando separado, depois de conferir o commit (`git status`, `git log -1`).",
        }),
      );
    }
    const r = checar(d);
    if (d.destrutivo) {
      perguntas.push(
        mensagem({
          trava: TRAVA,
          oQue: `Confirme: \`${comando}\` (${d.tipo}) apaga ou reescreve dados/serviços de produção e não tem como desfazer pelo git.`,
          porque: "operação irreversível em produção precisa de uma pessoa conferindo alvo e momento, mesmo partindo da main em dia.",
          comoFazer: "confira o ambiente/banco alvo e se há backup (no D1, anote o bookmark do `wrangler d1 time-travel info`); se estiver certo, confirme.",
          detalhe: r ? `Além disso, a checagem de deploy falhou:\n${r.texto}` : undefined,
        }),
      );
      continue;
    }
    if (!r) continue;
    if (r.decisao === "deny") return deny(r.texto);
    perguntas.push(r.texto);
  }
  if (perguntas.length) return ask([...new Set(perguntas)].join("\n\n"));
  if (deploys.some((d) => d.supabase)) {
    return context(
      "PreToolUse",
      "Deploy no Supabase: antes de publicar, confirme que toda tabela exposta tem RLS ligada e com política, e que nenhuma chave de serviço vai para o cliente (roteiro da skill publicando).",
    );
  }
  return null;
}

runHook(import.meta.url, decide);
