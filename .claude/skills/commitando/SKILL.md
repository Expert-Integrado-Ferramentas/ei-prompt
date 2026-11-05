---
name: commitando
description: Faz commit no padrão da Expert (Conventional Commits em português), escolhendo só os arquivos certos, e envia para o GitHub. Use quando a pessoa pedir "commita", "salva isso", "sobe isso aí" ou ao fim de uma etapa de trabalho. Nunca commita na main: cria a branch antes.
---

# Commit

## Procedimento

1. **Ver o estado.**
   ```bash
   git status --short
   git diff --stat
   git branch --show-current
   ```
   Nada mudou: avise e pare.

2. **Nunca na `main`.** Se a branch atual é `main` ou `master`, crie uma antes, no padrão
   `tipo/descricao` (`feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `hotfix`):
   `git switch -c feat/<descricao-curta>`. As mudanças não commitadas vão junto.

3. **Conferir o que não deve entrar.** Separe e pergunte antes de incluir:
   - `.env*`, `.dev.vars`, `.local.*`, chaves (`*.pem`, `id_*`), `.claude/settings.local.json`,
     `.claude/state/`.
   - Gerados: `node_modules/`, `dist/`, `coverage/`, `.wrangler/`, `*.log`, `.DS_Store`.
   - Arquivo com dado pessoal real (planilha, exportação, JSON com nomes e telefones).
   - Valor que parece segredo dentro do diff (`git diff | grep -iE "key|token|secret|senha"`).

4. **Testes.** Se o código mudou, rode a suíte inteira (rule `testing`). Falha nova: corrija antes.

5. **Stage seletivo.** `git add <arquivo>` um por um. Nunca `git add .` ou `-A`.
   Mostre `git diff --cached --stat` e confira.

6. **Commit** no formato `tipo(escopo): descrição em português` (até 72 caracteres), com corpo
   explicando o porquê quando não for óbvio e `Closes #N` se houver issue:
   ```bash
   git commit -m "$(cat <<'EOF'
   fix(cobranca): corrige vencimento em mês com 30 dias

   O cálculo somava 30 dias fixos e pulava o último dia útil.

   Closes #42
   EOF
   )"
   ```
   Mudanças de assuntos diferentes viram commits diferentes.
   Sem linha `Co-Authored-By` do Claude: a mensagem termina na descrição (e no corpo, se houver).

7. **Enviar.** `git push -u origin HEAD`. A trava `guard-testes-antes-do-push` roda a suíte:
   se bloquear, corrija a falha. Se pedir confirmação por linha de base, confirme só se as falhas
   forem as mesmas de antes.

## Relatório (uma ou duas linhas)

Hash e título do commit, branch enviada e, se ainda não há PR, a sugestão: "Quer que eu abra o PR?"

## Nunca

- Commit na `main`, `--no-verify`, `--amend` em commit já enviado, force push.
- Mensagem vaga (`ajustes`, `wip`, `fix`).
- Contornar uma trava. Se ela bloqueou, explique o motivo à pessoa e faça do jeito certo.
