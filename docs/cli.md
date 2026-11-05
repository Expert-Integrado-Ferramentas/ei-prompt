# CLI (`bin/cli.js`)

Nota interna: fica em `docs/` e não em `bin/` porque o campo `files` do `package.json` publica a pasta `bin/` inteira no npm.

`cli.js` é o único código executável do repositório: lê `manifest.json`, apaga os
`deprecated_files` e baixa cada arquivo de `files` da `main` no GitHub para a pasta atual.
`cli.test.js` testa `normalizeEntry` e `formatManifestEntry`.

## Regras

- CommonJS, só built-ins (`fs`, `path`) e o `fetch` global do Node >= 18. Nada de dependência nem de
  bundler; o pacote publicado leva só `bin/` e `manifest.json` (campo `files` do `package.json`).
- Estilo do arquivo: 2 espaços, aspas duplas, ponto e vírgula, template literals, vírgula final em
  objetos multilinha. Não misture aspas simples nem outra indentação.
- Cada arquivo do manifest roda no seu `try/catch` dentro de `run()`: uma falha não aborta o lote.
  As falhas são contadas e o `exit(1)` só vem no fim. Erro aparece com `log("red", ...)`, nunca
  engolido.
- `removeFile()` só apaga dentro do diretório atual (defesa contra `..` num manifest adulterado).
  Fora dele, avisa e segue.
- `writeFile()` sobrescreve o que existe (`overwrite: true`) e dá `chmod 755` em `.sh`. Por isso o
  que está no manifest, inclusive `.claude/settings.json`, substitui o arquivo do cliente.
- Saída colorida com prefixos de largura fixa (`"add   "`, `"update"`, `"remove"`): verde sucesso,
  amarelo aviso, vermelho falha, ciano atualização.
- Entrada do manifest é string ou `{ "from", "to" }`; qualquer outra forma lança erro
  (`normalizeEntry`).
- Mudou o CLI ou o manifest: rode `npm test` e siga `RELEASE.md` (bump e CHANGELOG antes do merge).
