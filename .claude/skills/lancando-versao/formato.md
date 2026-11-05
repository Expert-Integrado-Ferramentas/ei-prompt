# Formato de versões e CHANGELOG

Referência da skill `lancando-versao`. O passo a passo de lançar uma versão está no `SKILL.md`
desta pasta; o de publicar, na skill `publicando`.

## Convenções

### Versão semântica (MAJOR.MINOR.PATCH)
- Primeira versão: `0.1.0`.
- **patch** (`0.1.0` → `0.1.1`): correção, ajuste interno. É o padrão.
- **minor** (`0.1.1` → `0.2.0`): há pelo menos um `feat` desde a última versão.
- **major** (`0.2.0` → `1.0.0`): quebra de compatibilidade (`feat!`, `BREAKING CHANGE`), ou
  quando o produto estabiliza. Antes de `1.0.0`, quebra pode vir num minor, com aviso no CHANGELOG.

### CHANGELOG (formato Keep a Changelog)
- Arquivo `CHANGELOG.md` na raiz, versão mais nova no topo.
- Sempre há uma seção `## [Unreleased]` no topo.
- Cada versão: `## [X.Y.Z] - AAAA-MM-DD`, com as subseções que tiverem conteúdo, nesta ordem:
  `### Added`, `### Changed`, `### Fixed`, `### Removed` (nomes padrão do formato; o texto dos
  itens é em português).
- Texto curto, sobre o impacto para quem usa, não sobre o detalhe interno.
- `feat` → Added; `fix` → Fixed; `refactor`/`perf` → Changed, só se quem usa percebe.
  `chore`, `test`, `docs`, `ci` geralmente não entram. Quebra de compatibilidade entra em
  Changed começando com `QUEBRA:`.

### Versão em sincronia
- `version` do `package.json` (ou `deno.json`, `Cargo.toml`) igual à última tag.
- Mude a versão com `npm version X.Y.Z --no-git-tag-version`; a tag é criada depois do merge.

### Tag e release
- Tag `vX.Y.Z` criada na `main`, depois do merge do PR de versão. Nunca antes.
- Toda tag vira release no GitHub: `gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <notas> --latest`.
- Versão sempre por PR (`chore: release vX.Y.Z`), nunca commit direto na `main`.

## Exemplos

```markdown
# Changelog

Este arquivo segue o formato [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e a [versão semântica](https://semver.org/lang/pt-BR/).

## [Unreleased]

## [0.2.0] - 2026-10-13

### Added
- Aluno pode baixar o certificado em PDF.

### Fixed
- Login não volta mais para a tela inicial quando a sessão expira.
```

## Armadilhas

- **Tag antes do merge**: aponta para um commit que não está na `main`.
- **`npm version` sem `--no-git-tag-version`**: cria tag sozinho, fora do fluxo.
- **`gh release create` sem `--latest`**: a release não aparece como a mais recente.
- **CHANGELOG com detalhe interno** (`chore: atualiza dependência`): quem usa não se importa.
