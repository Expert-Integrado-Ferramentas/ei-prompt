---
name: configurando-ci
description: Configura o CI do projeto (workflow do GitHub Actions que roda os testes em todo pull request), a partir do que o projeto já tem. Use quando o início de sessão avisar "este projeto não tem CI", quando a pessoa pedir "configura o CI", "roda os testes no PR" ou "cria o workflow de testes".
---

# Configurando o CI

O harness avisa em toda sessão enquanto o projeto não tiver CI. Esta skill resolve o aviso do jeito
mais honesto que a stack permite: **o CI roda o que o projeto já tem**. Ela não inventa teste, não
cria teste de fachada e não mexe nas regras do GitHub.

> **Branch principal:** neste roteiro, `main` é o nome da branch principal do projeto, que pode ser
> `master`. Descubra uma vez com `git symbolic-ref --short refs/remotes/origin/HEAD | sed 's#^origin/##'`.

## 1. Ver o que existe

1. `ls .github/workflows 2>/dev/null`: já há workflow? Leia cada um. Se algum já roda em
   `pull_request` com testes, o aviso era falso: diga isso e pare.
2. Descubra o comando de testes, nesta ordem, e use o primeiro que existir:
   - `testes.comando` em `.claude/expert-governanca.json`;
   - `scripts.test` do `package.json` (`npm test`);
   - `deno.json`/`deno.jsonc` com task `test` (`deno task test`);
   - `pyproject.toml`/`pytest.ini` (`pytest`); `Cargo.toml` (`cargo test`); `go.mod` (`go test ./...`);
   - arquivos `*.test.mjs` sem `package.json` (`node --test`).
3. Descubra a versão da stack (`engines.node`, `.nvmrc`, `.tool-versions`) e o gerenciador
   (`package-lock.json` → `npm ci`; `pnpm-lock.yaml` → `pnpm install --frozen-lockfile`;
   `yarn.lock` → `yarn install --frozen-lockfile`).

## 2. Sem comando de testes

Não crie workflow vazio nem um teste que sempre passa. Diga à pessoa, em duas linhas:

- que o projeto não tem testes que um CI possa rodar;
- o menor caminho para ter (o que testar primeiro, pela área mais sensível do projeto).

Se houver `lint`, `typecheck` ou `build` no `package.json`, ofereça um workflow só com eles, dizendo
que isso **não prova o comportamento**. Registre a pendência em `.claude/expert-governanca.json`
(`ci: { estado: "sem-testes", em: "<data>" }`) e pare. O aviso do início de sessão continua até
existir CI de verdade.

## 3. Com comando de testes: propor o workflow

Mostre o arquivo inteiro à pessoa **antes** de criar e só crie com o "pode". Modelo mínimo
(`.github/workflows/ci.yml`), ajustando stack, versão e comando:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  testes:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
```

Regras do arquivo:

- Gatilho em `pull_request` (é o que o aviso do início de sessão procura) e em `push` na branch principal.
- `permissions: contents: read`. Segredo só se o teste exigir, e nunca com valor no arquivo.
- Teste que precisa de banco, chave ou serviço de verdade não roda no CI: rode só os que funcionam
  offline e diga quais ficaram de fora.
- Para projeto novo, os modelos `templates/app` e `templates/mcp` já trazem um `ci.yml` mais completo.

## 4. Provar e entregar

1. Rode **localmente** o mesmo comando do workflow. Se falhar, o CI vai falhar: mostre o resultado
   à pessoa e decida com ela (corrigir o teste, ou registrar a falha como linha de base) antes de abrir o PR.
2. Crie a branch `ci/configura-testes`, commite só o workflow (`commitando`) e abra o PR (`abrindo-pr`).
3. Antes do merge, confirme que o workflow rodou **no próprio PR** e passou (`gh pr checks`). Workflow
   que nunca rodou não está provado.
4. Depois do merge, grave em `.claude/expert-governanca.json`: `ci: { estado: "ativo", workflow: "ci.yml" }`.

## O que esta skill não faz

- Não liga proteção de branch nem exige o check para mesclar: isso muda as regras da organização e é
  decisão da pessoa responsável, repositório a repositório, quando o CI estiver estável.
- Não cria workflow de release nem de deploy. Release é manual, pela skill `lancando-versao`.
- Não troca a stack nem reescreve testes existentes.
