---
name: iniciando-projeto
description: Cria um projeto novo da Expert a partir dos boilerplates do repositório da metodologia (MCP, app com tela, API/webhook ou agente com Flue), já com git, harness e glossário. Use quando a pessoa pedir "cria um projeto novo", "começa um MCP", "novo app", "nova API", "cria um agente" ou similar, numa pasta vazia.
---

# Iniciando um projeto

Avise no início: "Vou criar o projeto a partir do modelo da Expert. Ele já nasce com testes,
travas e o contexto organizado."

Repositório da metodologia: `Expert-Integrado-Ferramentas/expert-governanca`.

## Procedimento

1. **Perguntar o tipo e o nome.**
   - Tipo: `mcp` (servidor MCP remoto), `app` (app com tela), `api` (API ou webhook) ou `agente`
     (agente que conversa com pessoas ou roda sozinho, com Flue; leia antes `stack/agentes-em-producao.md`
     da metodologia e confirme que o caso não é só código ou uma chamada de modelo dentro de um Worker).
   - Nome em kebab-case (`controle-de-matriculas`; MCP termina em `-mcp`).
   - Uma frase sobre o que o projeto faz e para quem.
   - Fora desses tipos (site, algo que não roda na Cloudflare): leia
     `stack/cloudflare.md` e `stack/vps-hostinger.md` da metodologia e combine com a pessoa antes.

2. **Banco de dados.** Se o projeto guarda dados, leia `stack/d1-ou-postgres.md` da metodologia
   antes de escolher. O padrão é D1. Postgres só nos casos listados lá; a exceção vira uma
   decisão registrada em `docs/decisoes/` do projeto.

3. **Baixar a metodologia** numa pasta temporária:
   ```bash
   TMP=$(mktemp -d)
   gh repo clone Expert-Integrado-Ferramentas/expert-governanca "$TMP/metodologia" -- --depth 1
   ```

4. **Copiar o modelo.** Confira que a pasta de destino está vazia. Copie
   `$TMP/metodologia/templates/<tipo>/` para ela. Leia o `README.md` do modelo.

5. **Trocar os marcadores** listados no `PLACEHOLDERS.md` do modelo: nome do projeto, nome do
   Worker (`template-<tipo>`), nomes de fila e de banco, `namespace_id` e descrição. Renomeie
   também pastas com `{{` no nome. Confira que não sobrou nenhum com `npm run conferir-placeholders`; depois apague o `PLACEHOLDERS.md` (uma troca global também reescreveria a própria lista).
   Antes do primeiro deploy, confirme que o nome do Worker está livre na conta:
   `npx wrangler deployments list --name <nome>` tem que falhar (nome sem deploy). Nome repetido
   publicaria por cima do Worker de outro projeto.

6. **Instalar e testar.** Instale as dependências com `npm ci` (o lockfile do template resolve conflitos de versão) e rode a suíte. Tem que passar.

7. **Primeiro commit na `main`:**
   ```bash
   git init -b main
   git status --short        # confira que não há .env, .dev.vars nem arquivo de dado
   git add -A
   git commit -m "chore: cria projeto a partir do modelo <tipo>"
   ```
   Nesta sessão ainda **não há travas**: ela começou numa pasta vazia, sem harness, e o Claude
   Code só carrega hooks no início da sessão. Confira você mesmo, no `git status --short`, que não
   há `.env`, `.dev.vars`, chave nem arquivo de dado antes do `git add -A`.

8. **Repositório no GitHub** (se a pessoa quiser agora), privado e na organização:
   `gh repo create Expert-Integrado-Ferramentas/<nome> --private --source . --push`.
   Faça isso antes do passo 9: depois das travas, nada vai direto para a `main`.

9. **Instalar o harness** com a skill `instalando-harness`. Ela pede para reiniciar o Claude
   Code no meio (as travas só valem numa sessão nova); siga a partir dali na sessão nova
   (`claude --continue` retoma a conversa).

10. **Criar o `CONTEXT.md` com a pessoa.** Pergunte os 5 a 10 termos principais do negócio
    (quem usa, o que se cadastra, o que se vende ou entrega) e escreva o glossário. Preencha no
    `AGENTS.md` o que é o projeto e a tabela de pastas, e deixe o `CLAUDE.md` só com `@AGENTS.md`.

11. **Relatório:** pasta criada, tipo, link do repositório, resultado dos testes e o próximo passo
    (por exemplo: configurar segredos com `wrangler secret put`, seguindo o README do modelo).

## Por quê

A explicação de cada escolha da stack (Cloudflare, D1, Hono, Vite, shadcn, Agents SDK) está em
`stack/` da metodologia. Mostre o documento à pessoa quando ela perguntar o porquê.
