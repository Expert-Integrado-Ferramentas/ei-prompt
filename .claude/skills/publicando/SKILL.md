---
name: publicando
description: Publica o projeto em produção na plataforma dele (Cloudflare, Vercel, Netlify, Supabase, VPS com Docker), com as checagens da trava de deploy, conferência depois de publicar e registro do que foi para o ar. Use quando a pessoa pedir "publica", "faz o deploy", "sobe para produção", "coloca no ar" ou "volta a versão anterior".
---

# Publicando


> **Branch principal:** neste roteiro, `main` é o nome da branch principal do projeto, que pode ser
> `master`. Descubra uma vez com `git symbolic-ref --short refs/remotes/origin/HEAD | sed 's#^origin/##'`
> (sem remoto, `main` ou `master`, a que existir) e escreva o nome real onde os comandos trazem `<principal>`.

Avise no início: "Vou publicar a versão que está na main. Antes, confiro que está tudo commitado,
enviado e com os testes passando."

## 1. Descobrir a plataforma

Pelos arquivos da raiz:

Confira primeiro se é **Lovable** (pasta criada pelo Lovable, commits do bot do Lovable, ou a
pessoa confirma). Se for, pare aqui: publique pelo botão Publish do Lovable depois do merge e
**nunca rode `supabase db push`** contra o banco que o Lovable gerencia.

| Arquivo | Plataforma |
| --- | --- |
| `wrangler.toml` ou `wrangler.jsonc` | Cloudflare |
| `vercel.json` ou pasta `.vercel/` | Vercel |
| `netlify.toml` | Netlify |
| `supabase/config.toml` | Supabase (migrations e edge functions) |
| `Dockerfile` ou `compose.yaml`/`docker-compose.yml`, rodando numa VPS | VPS com Docker |
| Projeto criado e publicado pelo Lovable | Lovable |

- Mais de uma plataforma (ex.: tela na Vercel e banco no Supabase): publique cada parte, na
  ordem banco → backend → tela.
- Ambíguo ou desconhecido: use `deploy.plataforma` de `.claude/expert-governanca.json`. Se não
  houver, pergunte uma vez e grave nesse campo.
- **Host ligado ao git** (Vercel, Netlify, Cloudflare com deploy automático): o merge já publica
  a tela. Se a mudança tem migration, faça em dois PRs: primeiro o PR só com a migration (aditiva),
  merge, aplicar no banco; depois o PR do código que usa a mudança.

**Regra de banco para qualquer plataforma: migration só aditiva** (criar tabela, coluna ou índice).
Remover ou renomear coluna, tabela ou dado é feito em duas etapas: primeiro o código para de usar,
num PR; a remoção vem num PR posterior, depois de confirmado em produção.

## 2. Checagens antes (as mesmas da trava `guard-deploy`)

```bash
git switch <principal> && git pull --ff-only
git status --short                 # vazio: nada pendente
git log origin/<principal>..HEAD          # vazio: tudo enviado
```
- Rode a suíte inteira com `node .claude/hooks/expert/registrar-testes.mjs`. Ele roda o comando de teste
  do projeto e, se passar, registra o commit atual como testado; a trava `guard-deploy` exige esse
  registro para o HEAD da main (depois de um merge por squash, o commit é novo e precisa ser
  testado de novo). Tem que passar, ou ter só as falhas da linha de base, com a pessoa ciente.
  Pela ferramenta Bash, use `timeout` de 600000 ms (ou rode em segundo plano): suíte lenta
  passa dos 120 s do padrão e a chamada é cortada antes de registrar.
- Pergunte, se não estiver claro, se há segredo novo para configurar na plataforma.
- A trava `guard-deploy` confere os comandos de deploy que conhece (`wrangler deploy`/`versions
  deploy`/`pages deploy`, `vercel --prod`, `netlify deploy --prod`, `supabase functions deploy`/
  `db push`, `docker push`/`stack deploy`, `docker compose up` via ssh, migração D1 `--remote`) e
  os scripts com nome de deploy (`npm run deploy|release|publish`, `./deploy.sh`, `make deploy`),
  e bloqueia se algo disso falhar. Corrija, não contorne. Deploy em ambiente de teste
  (`wrangler deploy --env staging|preview|dev|hml|qa`) só pede confirmação do ambiente.
- O que ela não conhece (CLI de outra plataforma chamada direto, `rsync` para a VPS,
  `docker --context`) passa sem checagem: faça as checagens acima do mesmo jeito.

## 3. Publicar, por plataforma

### Cloudflare
- **Migrations D1 antes do código**, se houver migration nova:
  ```bash
  npx wrangler d1 time-travel info <BANCO>                    # anote o ponto de volta
  npx wrangler d1 migrations apply <BANCO> --remote
  ```
- Escolha o modo com a pessoa:
  - **Direto** (projeto sem usuário real ainda): `npm run deploy` (nos projetos com Vite ele
    faz o build antes; `npx wrangler deploy` direto só em Worker sem build).
  - **Com prévia** (produção com usuário real, recomendado):
    ```bash
    npx wrangler versions upload --message "<sha curto> <título>"   # devolve ID e URL de prévia
    curl -fsS "<url-da-previa>/health"                               # tem que dar 200
    npx wrangler versions deploy <id-da-versao>@100% --yes
    ```
- Voltar o código: `npx wrangler rollback <id-da-versao-anterior>` (segundos, sem build).
- Voltar o banco: `npx wrangler d1 time-travel restore <BANCO> --bookmark=<ponto anotado>`.
  **Atenção:** isso descarta tudo o que foi gravado em produção depois do ponto anotado. Explique
  à pessoa o que se perde e só rode com a confirmação dela.
- O modo com prévia protege o código, não o banco: a migration já roda antes da prévia. Por isso
  migration só aditiva.

### Vercel
- Projeto ligado ao GitHub: o merge na `main` já publica. Acompanhe com `npx vercel ls` e confira.
- Sem ligação: `npx vercel deploy --prod`.
- Nunca copie o código para outra pasta para fugir das checagens.
- Voltar: `npx vercel rollback <url-do-deploy-anterior>`.

### Netlify
- Projeto ligado ao GitHub: o merge na `main` já publica.
- Sem ligação: `npx netlify deploy --build --prod`. Confira que o diretório publicado é só o de
  build (`publish` no `netlify.toml`), nunca a raiz do projeto.
- Voltar: no painel, Deploys → deploy anterior → "Publish deploy".

### Supabase
1. **Checagem de RLS antes de tudo**, com o SQL da rule `supabase`, no banco de produção.
   Qualquer linha no resultado: pare e corrija com uma migration.
2. Ver o que será aplicado: `npx supabase db push --dry-run`. Mostre à pessoa.
3. Se a migration tiver `DROP`, `ALTER ... TYPE`, `DELETE` ou `TRUNCATE`, faça antes uma cópia do
   banco fora do repositório: `npx supabase db dump --linked -f <pasta fora do projeto>/antes-<data>.sql`.
4. `npx supabase db push`.
5. Edge functions alteradas: `npx supabase functions deploy <nome>`.
- Voltar: migration nova que desfaz a anterior (nunca edite a já aplicada). Dado apagado só volta
  pela cópia do passo 3.

### VPS com Docker
- Imagem marcada com o commit, construída para a arquitetura da VPS (normalmente `amd64`, mesmo
  num Mac com chip Apple) e levada até ela:
  ```bash
  SHA=$(git rev-parse --short HEAD)
  docker buildx build --platform linux/amd64 -t <app>:sha-$SHA --load .
  docker save <app>:sha-$SHA | ssh <vps> docker load
  ```
- Na VPS (pela skill `preparando-vps` se ainda não estiver no padrão): suba com a tag do commit
  (`IMAGE_TAG=sha-$SHA docker compose up -d`), com `restart: unless-stopped`, porta publicada só
  em `127.0.0.1`, entrada pelo Cloudflare Tunnel, segredos em arquivo `.env` fora do git com
  permissão `600`.
- Voltar: suba de novo com a tag anterior.

## 4. Conferir depois de publicar

- `curl -fsS https://<endereco>/health` ou a página principal: tem que responder 200.
- Falhou: volte a versão anterior imediatamente e investigue depois.

## 5. Relatório

Em poucas linhas: plataforma, commit (sha curto), versão (se houver tag), endereço e resultado da
conferência. O registro em `.claude/state/deploys.jsonl` é feito pela trava `registrar-deploy` e marca a *tentativa* (o campo `sucesso` costuma ficar `null`, também quando o deploy falhou): quem prova que publicou é a conferência.

## Nunca

- Publicar de branch que não é a `main`, com mudança pendente ou sem testes.
- Publicar a pasta inteira do projeto num site estático.
- Pedir à pessoa para colar token ou senha no chat. Login é no terminal dela
  (`npx wrangler login`, `npx vercel login`, `npx supabase login`).
