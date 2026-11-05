---
name: lancando-versao
description: Lança uma versão nova do projeto com versão semântica, CHANGELOG no formato Keep a Changelog, PR de versão, tag e release no GitHub. Use quando a pessoa pedir "lança uma versão", "fecha a versão", "faz o release" ou quando houver mudanças na main prontas para virar versão.
---

# Lançando uma versão


> **Branch principal:** neste roteiro, `main` é o nome da branch principal do projeto, que pode ser
> `master`. Descubra uma vez com `git symbolic-ref --short refs/remotes/origin/HEAD | sed 's#^origin/##'`
> (sem remoto, `main` ou `master`, a que existir) e escreva o nome real onde os comandos trazem `<principal>`.

Regras de formato em `formato.md`, nesta mesma pasta.

## Abrir o PR de versão

1. **Ponto de partida.**
   ```bash
   git switch <principal> && git pull --ff-only && git status --short   # árvore limpa
   ULTIMA=$(git describe --tags --abbrev=0 2>/dev/null)          # vazio = primeira versão
   git log ${ULTIMA:+$ULTIMA..}HEAD --oneline
   ```
   Nenhum commit novo desde a última tag: avise e pare.

2. **Calcular a versão.**
   - Algum `feat!` ou `BREAKING CHANGE`: **major**.
   - Algum `feat`: **minor**.
   - Senão: **patch**.
   - Primeira versão (sem tag): comece pelo campo de versão do projeto (`package.json` etc.) se
     ele não for `0.0.0` nem `0.1.0` padrão de template; senão proponha `0.1.0`. Se o projeto já
     está em produção, diga isso na proposta: `1.0.0` é decisão da pessoa, não da skill. Mostre a
     proposta e confirme com a pessoa.

3. **Escrever o CHANGELOG.** Agrupe os commits desde a última tag em `Added` (feat),
   `Changed` (refactor/perf percebido por quem usa, quebras com `QUEBRA:`), `Fixed` (fix),
   `Removed`. Reescreva cada item em português, pelo impacto para quem usa. Deixe de fora `chore`,
   `test`, `docs`, `ci`. Aproveite o que já estiver em `[Unreleased]`. A seção vira
   `## [X.Y.Z] - AAAA-MM-DD`, abaixo de um `## [Unreleased]` vazio.
   Sem `CHANGELOG.md`: crie com o cabeçalho de `formato.md`.

4. **Branch, versão e commit.**
   ```bash
   git switch -c chore/release-vX-Y-Z   # hífens: o nome de branch não aceita ponto
   npm version X.Y.Z --no-git-tag-version      # ou edite deno.json / Cargo.toml
   git add CHANGELOG.md package.json package-lock.json
   git commit -m "chore: release vX.Y.Z"
   git push -u origin HEAD
   ```

5. **PR.** Primeiro extraia as notas da versão:
   ```bash
   awk '/^## \[X\.Y\.Z\]/{f=1; next} /^## \[/{f=0} f' CHANGELOG.md > .claude/state/notas-da-versao.md
   ```
   Depois, em outra chamada, abra o PR:
   ```bash
   gh pr create --base <principal> --title "chore: release vX.Y.Z" --body-file .claude/state/notas-da-versao.md
   ```
   Informe o link e espere a pessoa pedir o merge (skill `abrindo-pr`, seção Merge).

## Depois do merge

6. **Tag e release** na `main` atualizada:
   ```bash
   git switch <principal> && git pull --ff-only
   ```
   Em outra chamada (a trava de push pede confirmação quando o mesmo comando muda de branch e envia):
   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file .claude/state/notas-da-versao.md --latest
   ```
   Release criada, apague o arquivo de notas:
   ```bash
   rm -f .claude/state/notas-da-versao.md
   ```

7. **Relatório:** versão, link da release e a pergunta "Quer publicar esta versão?" (skill `publicando`).

## Nunca

- Rodar o script `release`/`publish` do projeto (changesets, semantic-release, release-it) no
  lugar destes passos: ele publica por conta própria, e a trava de deploy trata `npm run
  release|publish` como publicação (só da `main` limpa, enviada e testada).
- Tag antes do merge, ou commit de versão direto na `main`.
- Versão no `package.json` diferente da tag.
- Release sem `--latest`.
