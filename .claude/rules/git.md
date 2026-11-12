# Git

Universal: carrega em toda conversa. Os pontos de risco são garantidos por travas
(`guard-branch-protegida`, `guard-segredos`, `guard-testes-antes-do-push`,
`guard-apagar-branches`). Nome de branch e mensagem de commit fora do padrão geram só um aviso
(`guard-nome-de-branch`, `guard-mensagem-de-commit`): corrija ao receber. Quando uma trava
bloquear, leia o motivo e faça do jeito certo. Nunca tente contornar.

## Convenções

### Branches
- `main` nesta rule é a branch principal do projeto, que pode ser `master`: confira com
  `git symbolic-ref --short refs/remotes/origin/HEAD` e use o nome real nos comandos.
- A `main` só muda por PR. Nunca commit, merge ou push direto nela.
- Nome no formato `tipo/descricao`, em kebab-case, até ~50 caracteres:
  `feat/cadastro-de-aluno`, `fix/login-em-loop`.
- Tipos: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `hotfix`.
- Uma branch por assunto. Comece sempre da `main` atualizada:
  `git switch <principal> && git pull --ff-only && git switch -c feat/<descricao>`.
- Apague a branch só depois de provar o merge (`gh pr view --json state` = `MERGED`).

### Commits (Conventional Commits)
- Formato: `tipo(escopo opcional): descrição em português`. Cabeçalho até 72 caracteres.
- Tipos: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `perf`, `build`, `ci`, `style`, `revert`.
- Descrição no imperativo ou no presente, dizendo o que muda para quem usa:
  `fix: corrige cálculo do desconto no boleto`.
- Corpo opcional, separado por linha em branco, explica o **porquê** (o diff já mostra o quê).
- `Closes #N` ou `Refs #N` no corpo quando houver issue.
- Um commit, uma mudança lógica. Refatoração e funcionalidade em commits separados.
- Mudança que quebra compatibilidade: `feat!:` ou rodapé `BREAKING CHANGE: ...`.
- Sem linha de coautoria do Claude (`Co-Authored-By`) em commit e sem atribuição ao Claude em PR.
  Quem responde pelo código é a pessoa que pediu.

### Stage seletivo
- Nunca `git add .` ou `git add -A` às cegas. Adicione arquivo por arquivo.
- Antes de commitar: `git diff --cached` para ver exatamente o que entra.
- Antes do push: `git log origin/<principal>..HEAD --oneline` para revisar a série.

### Pull Requests
- Título no mesmo padrão do commit (`feat: ...`).
- Corpo com: **Resumo**, **Como testar**, **Riscos**, **Custo e tempo** e `Closes #N`. A skill `abrindo-pr` faz isso.
- **Custo e tempo** em todo PR, mesmo na assinatura: a saída de
  `node .claude/hooks/expert/medir-entrega.mjs` (tempo total e ativo, tokens por modelo e custo
  equivalente na API), colada sem editar. Nunca estime: sem registro, cole o "Medição indisponível".
  Crie a branch antes de começar o trabalho; o que foi feito na `main` fica fora da conta.
- PR pequeno (até ~400 linhas alteradas). Maior que isso: justifique ou divida.
- Merge por squash: `gh pr merge --squash --delete-branch`, feito pelo Claude logo depois de abrir o PR quando testes e checagens passam e não há conflito. Ninguém precisa aprovar: o PR é o registro.

### Sincronização
- Antes de começar: `git fetch origin && git status`.
- Com mudança não commitada, não puxe nada: commite, guarde (`git stash`) ou descarte antes.
- Conflito: resolva entendendo os dois lados. Nunca escolha um lado às cegas.

## Proibido

- Commit, merge ou push direto na `main`.
- `git commit --amend` em commit que já foi enviado (reescreve histórico compartilhado).
- `--no-verify`. Se a verificação falhou, corrija a causa.
- `git push --force` na `main`. Em branch própria, só `--force-with-lease`, e nunca na `main`.
- `git reset --hard` e `git clean -f` (estão na lista de bloqueio).
- Mensagem vaga: `fix`, `wip`, `ajustes`, `Changes`, `update`.
- Apagar várias branches de uma vez sem provar o merge de cada uma.

## Proibido sem confirmação

Descartam trabalho não commitado (sem histórico nem lixeira) ou pulam a revisão. Só com pedido
explícito da pessoa; a trava `guard-branch-protegida` pede confirmação:

- `git restore` (sem ser só `--staged`) de `.`, `:/` ou de uma pasta inteira; `git checkout -- .`
  ou `git checkout -- :/`. Para desfazer um arquivo, restaure só ele; na dúvida, `git stash -u`.
- `git stash drop` e `git stash clear`.
- `git worktree remove --force` (ou `-f`).
- `gh pr merge --admin` (passa por cima das regras de proteção da branch).

## Armadilhas

- **`git add .` com `.env` ou `.dev.vars` na pasta**: o segredo vai para o histórico e fica lá
  mesmo depois de apagado. Stage seletivo sempre.
- **Squash com título ruim**: o título do PR vira o commit permanente na `main`. Revise antes.
- **Branch atrasada**: `git fetch origin`, depois `git rebase origin/<principal>` se a branch ainda não
  foi enviada, ou `git merge origin/<principal>` se já foi (não exige force push). Nunca na `main`.
- **Squash e `git branch -d`**: depois de squash, o git não reconhece a branch como mesclada.
  Confira o merge pelo `gh pr view` antes de apagar.
