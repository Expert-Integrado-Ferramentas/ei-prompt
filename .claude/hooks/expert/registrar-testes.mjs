#!/usr/bin/env node
/**
 * CLI — roda a suíte e registra o HEAD aprovado em `.claude/state/tests-ok.json`.
 *
 * Uso (de qualquer pasta dentro do repositório): `node .claude/hooks/expert/registrar-testes.mjs`
 * A skill publicando chama isto na main depois de um squash merge, para que a trava de deploy
 * encontre o registro do novo HEAD. Descobre o comando de testes exatamente como a trava de push
 * (mesma função da lib). Sai com o código da suíte. O tempo segue `testes.timeoutSegundos` (padrão
 * 300 s, sem o teto de 570 s da trava de push); pelo Bash, rode com timeout de 600000 ms ou em
 * segundo plano, senão o Bash corta a suíte nos 2 minutos padrão.
 */
import { loadConfig } from "./lib/config.mjs";
import { repoRoot } from "./lib/git.mjs";
import { isMain } from "./lib/output.mjs";
import { executarERegistrar } from "./lib/testes.mjs";

/**
 * @param {string} cwd
 * @param {{eco?: boolean, log?: (s: string) => void}} [opts]
 * @returns {Promise<number>} código de saída
 */
export async function main(cwd, opts = {}) {
  const log = opts.log || ((s) => process.stdout.write(`${s}\n`));
  const root = repoRoot(cwd);
  if (!root) {
    log("registrar-testes: esta pasta não está num repositório git.");
    return 1;
  }
  const { config } = loadConfig(root);
  const r = await executarERegistrar(root, config, { eco: opts.eco ?? true });
  if (r.status === "sem-testes") {
    log(
      r.comando
        ? `registrar-testes: \`${r.comando}\` não encontrou testes (ou o pytest não está instalado); nada registrado. Crie ao menos um teste ou instale as dependências.`
        : "registrar-testes: o projeto não tem comando de testes; nada a registrar (o deploy não exige registro neste caso).",
    );
    return 0;
  }
  if (r.status === "tempo") {
    log(`registrar-testes: a suíte (\`${r.comando}\`) passou do limite de ${config.testes?.timeoutSegundos ?? 300}s e foi interrompida.`);
    return 124;
  }
  if (r.status === "falhou") {
    log(`registrar-testes: a suíte (\`${r.comando}\`) falhou; nada registrado.`);
    return typeof r.codigo === "number" && r.codigo !== 0 ? r.codigo : 1;
  }
  if (!r.registrado) {
    log(`registrar-testes: a suíte passou, mas há alterações não commitadas; o registro só vale para um commit limpo. Faça o commit (ou descarte) e rode de novo.`);
    return 0;
  }
  log(`registrar-testes: suíte aprovada para ${r.sha.slice(0, 7)} (\`${r.comando}\`), registrada em .claude/state/tests-ok.json.`);
  return 0;
}

if (isMain(import.meta.url)) {
  main(process.cwd()).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.exitCode = 1;
    },
  );
}
