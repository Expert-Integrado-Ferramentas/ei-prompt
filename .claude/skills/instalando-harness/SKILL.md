---
name: instalando-harness
description: Instala ou atualiza o harness da Expert (travas, rules, skills) no projeto atual a partir do repositório da metodologia, sem apagar o que o projeto já tem. Use quando a pessoa pedir "instala o harness da Expert", "atualiza o harness", ou quando o início de sessão avisar que há versão nova.
---

# Instalando o harness

Avise no início: "Vou instalar o harness da Expert neste projeto. Antes de copiar, guardo uma
cópia do que já existe."

Repositório da metodologia: o campo `repositorioDaMetodologia` de `.claude/expert-governanca.json`;
se não existir, `Expert-Integrado-Ferramentas/expert-governanca`. Contrato de instalação:
`harness/CONTRATO.md` desse repositório.

## Se o CLI já fez a parte mecânica

O pacote `@expertintegrado/harness` (`npx @expertintegrado/harness install`) copia travas, rules e
skills, mescla o `settings.json`, guarda a cópia de segurança, ajusta o `.gitignore` e grava a
configuração. Se `.claude/expert-governanca.json` tem `instalacao.origem` igual a `"cli"` e
`instalacao.pendente` não está vazio, **não repita os passos 1 a 7**: a pessoa só reiniciou o Claude
Code. Continue em: 7-B (reconciliar, começando por `docs/harness-reconciliacao.md` e pelas skills
equivalentes), 8 (linha de base de testes), 9 (conferir), 11 (provar as travas), 12 (contexto) e 13
(entrega). Se o aviso do CLI disse que o projeto ignora a pasta `.claude/`, resolva isso antes do
passo 13 (pergunta do passo 5). Ao terminar, apague o campo `instalacao` do config.
Sem o CLI (ou sem acesso ao pacote), siga o procedimento completo abaixo.

## Procedimento

1. **Conferir o ponto de partida.**
   - Estamos na raiz de um repositório git (`git rev-parse --show-toplevel`). Se não, pare e pergunte.
   - Árvore limpa (`git status --short`). Se houver mudança pendente, peça para commitar ou guardar antes.
   - Descubra a branch principal (`git symbolic-ref --short refs/remotes/origin/HEAD`, sem o
     `origin/`; sem remoto, `main` ou `master`, a que existir) e crie a branch a partir dela
     atualizada: `git switch <principal> && git pull --ff-only && git switch -c chore/harness-expert`.
   - Se `.claude/expert-governanca.json` já existe, é **atualização**: siga também o passo 3.

2. **Baixar a metodologia** numa pasta temporária, na última versão:
   ```bash
   REPO=$(node -e 'try{console.log(require("./.claude/expert-governanca.json").repositorioDaMetodologia||"")}catch{}')
   REPO=${REPO:-Expert-Integrado-Ferramentas/expert-governanca}
   TAG=$(gh release view --repo "$REPO" --json tagName -q .tagName 2>/dev/null)
   TMP=$(mktemp -d)
   gh repo clone "$REPO" "$TMP/metodologia"
   [ -n "$TAG" ] && git -C "$TMP/metodologia" -c advice.detachedHead=false checkout --quiet "$TAG"
   ```
   Versão: a tag (sem o `v`). Sem tag, a versão mais recente do `CHANGELOG.md` da metodologia
   (o primeiro `## [X.Y.Z]`).
   Leia `harness/CONTRATO.md` antes de copiar.

3. **Atualização: mostrar o que muda.** Compare `versao` do projeto com a nova. Mostre à pessoa,
   em linguagem simples, as entradas do `CHANGELOG.md` da metodologia entre as duas versões.
   Mesma versão: avise que já está atualizado e pare. Peça confirmação antes de seguir.

4. **Guardar cópia** (se `.claude/` existir), sem backups anteriores nem estado local, com data
   e hora para nunca sobrescrever um backup do mesmo dia:
   ```bash
   rsync -a --exclude 'backup-*' --exclude state .claude/ ".claude/backup-$(date +%Y%m%d-%H%M%S)/"
   ```

5. **Preparar o projeto antes de copiar** (assim uma instalação interrompida não deixa o projeto
   travado): garanta no `.gitignore` as linhas `.claude/state/` e `.claude/backup-*/`, e crie ou
   atualize `.claude/expert-governanca.json` mantendo os campos que o projeto já tem; atualize
   `versao` e `instaladoEm` (data de hoje, `AAAA-MM-DD`).
   - **O harness precisa ir para o git.** Confira se o projeto já ignora a pasta inteira:
     ```bash
     git check-ignore -v .claude/settings.json .claude/hooks/expert/guard-segredos.mjs
     ```
     Se algum dos dois for ignorado (linha como `.claude`, `.claude/`, `/.claude/` ou `.claude/*`
     no `.gitignore`, no `.git/info/exclude` ou no ignore global), o harness não entraria no commit
     nem no PR e os colegas ficariam sem as travas. **Pergunte antes de mexer**, mostrando a linha
     encontrada: "Este projeto ignora a pasta .claude/ inteira. Troco essa linha por `.claude/state/` e
     `.claude/backup-*/`, para o harness ir para o git?"
     - **Sim:** troque só essa linha (mantenha o resto do `.gitignore`) e repita o `git check-ignore`
       até não aparecer mais nada. Se a regra vem de `.git/info/exclude` ou do ignore global, mostre o
       arquivo e peça para a pessoa ajustar; não edite arquivo fora do projeto.
     - **Não:** siga a instalação, mas avise no relatório final que o harness ficou só nesta máquina
       (fora do commit e do PR) e que, por isso, o passo 13 não vai entregá-lo.

6. **Copiar travas, rules e skills** de `$TMP/metodologia/harness/` para `.claude/`:
   - `hooks/` vai para `.claude/hooks/expert/` (com `lib/`; sem `test/`, que fica na metodologia).
     A pasta própria evita misturar com hooks e arquivos do projeto de mesmo nome.
   - `rules/*.md` e `skills/<nome>/`, **sem os `README.md`** (em `.claude/rules/` o README
     carregaria em toda conversa como se fosse uma rule).
   - **Nunca sobrescreva sem listar e perguntar** um arquivo do projeto com o mesmo nome (a decisão
     de cada caso segue o passo 7-B, "Reconciliar"):
     - Instalação nova: se `.claude/rules/<nome>.md` ou `.claude/skills/<nome>/` já existe, mostre
       a diferença e decida pelo passo 7-B (núcleo da Expert prevalece; o que o projeto tem a mais fica).
     - Atualização: baixe também a versão anterior
       (`gh repo clone "$REPO" "$TMP/anterior" && git -C "$TMP/anterior" -c advice.detachedHead=false checkout --quiet v<versao antiga>`; não use `--depth 1 --branch` com `gh repo clone`, que falha com erro do git). Arquivo do
       projeto igual ao da versão anterior: substitua. Editado no projeto: mostre a diferença e pergunte.
       Arquivo que saiu do harness na versão nova: pergunte antes de apagar.

7. **Mesclar `.claude/settings.json`** com `harness/settings.json` da metodologia:
   - Mantenha tudo o que o projeto tem: hooks, `permissions.allow`, `permissions.deny`, `env`.
   - Acrescente os hooks do harness em cada evento, sem duplicar o mesmo comando.
   - Atualização: remova só as entradas que apontam para `.claude/hooks/expert/` e que não existem
     mais na versão nova (hook renomeado ou removido); as do projeto ficam.
   - Atualização vinda da 0.1.0: os hooks antigos ficavam soltos em `.claude/hooks/`. **Não os
     remova agora** (nem as entradas, nem os arquivos): a remoção é o passo 14, depois do commit e
     do push do PR, para a sessão nunca rodar com metade dos hooks apagada.
   - Acrescente as entradas de `permissions.deny` do harness (lista de bloqueio). Nunca remova nada.
   - Acrescente `attribution` (`commit` e `pr` vazios) e `includeCoAuthoredBy: false`: a empresa não
     usa linha de coautoria do Claude em commit nem atribuição em PR.
   - Nunca mexa em `.claude/settings.local.json`.
   - Hook do projeto que faz o mesmo que uma trava (por exemplo, outra checagem de push) é
     sobreposição: decida pelo passo 7-B. Até a pessoa decidir, mantenha os dois e liste.

7-B. **Reconciliar com o que o projeto já tem** (só se havia `.claude/` com hooks, rules, skills
   ou settings próprios; instalação limpa pula este passo). O harness da Expert é o padrão da
   empresa, aprovado pela diretoria: o **núcleo dele não é negociável**, e isso vale também para as skills equivalentes. Mas a pessoa pode ter
   construído o que ajuda o projeto dela, e isso **fica**. Você avalia item por item **com a pessoa**.

   Primeiro faça o inventário do que o projeto tem (hooks por evento e matcher, rules, skills,
   agentes, permissões) e classifique:

   | Tipo | O que é | Regra |
   | --- | --- | --- |
   | **Núcleo da Expert** (inegociável) | As travas (`hooks/expert/`), `permissions.deny`, `attribution` vazio e `includeCoAuthoredBy: false`, e as rules `git`, `security` e `testing` | A versão da Expert prevalece. Nunca fica de fora e nunca é desligado |
   | **Padrão da Expert** | As outras rules e as skills do harness | Entram. Skill equivalente do projeto sai; rule sem ser núcleo, decida com a pessoa |
   | **Livre** | Agentes, skills com função que a Expert não cobre, rules de tipo de arquivo próprias, memória, `settings.local.json`, hooks que cuidam da rotina do projeto | **Ficam**, sem mexer |

   Depois decida cada sobreposição e **mostre uma tabela** `item | o que fazer | por quê`, com a
   recomendação, antes de aplicar:

   - **Rule com o mesmo nome** (por exemplo, `git.md`): se é núcleo, entra a da Expert e o conteúdo
     que a rule do projeto tem a mais vai para `<nome>-projeto.md` (mesmos `paths:`), para nada se
     perder. Se não é núcleo, pergunte: substituir, manter a do projeto ou fundir.
   - **Skill do projeto com função equivalente** a uma da Expert (por exemplo, `committing-changes`
     e `commitando`): **sai, e fica a da empresa.** Não é decisão da pessoa: governança é para isso, e
     o gatilho não pode ficar duplicado. A skill do projeto vai para o backup (nunca é apagada sem
     volta) e a tabela avisa a pessoa do que saiu e do que ela tinha a mais; se a skill dela fazia
     algo que a da Expert não faz, esse trecho vira skill nova com outro nome e outro gatilho.
   - **Hook do projeto que decide a mesma coisa que uma trava** (push, branch principal, mensagem de
     commit, segredo): a trava da Expert fica; proponha tirar a entrada do projeto do `settings.json`
     (o arquivo vai para o backup) ou adaptá-la para só o que é próprio do fluxo dele. Hook de rotina
     do projeto (pipeline, estado, notificação) **fica**.
   - **O que é livre fica**, e vale dizer isso à pessoa: criar agentes e skills próprios para o
     projeto continua permitido.

   Regras: nada é apagado sem estar na tabela, sem o "sim" da pessoa e sem cópia no backup do passo 4.
   Sem como perguntar (execução não interativa): aplique o núcleo e **aposente as skills equivalentes**
   (backup); o resto (rules sem ser núcleo, hooks sobrepostos, `CLAUDE.md` antigo) fica como está e
   as pendências vão para `docs/harness-reconciliacao.md` para a pessoa decidir. No relatório final, liste as decisões (fica,
   sai, adapta) e os riscos de sobreposição que restaram (duas mensagens de bloqueio para o mesmo
   push, dois avisos de início de sessão, gatilhos de skill repetidos).

8. **Linha de base de testes.**
   - Descubra o comando (`package.json` `scripts.test`, `deno.json` `tasks.test`, `Cargo.toml`,
     `pyproject.toml`/`pytest.ini`). Não achou: pergunte uma vez e grave em `testes.comando`.
   - Rode a suíte inteira uma vez.
   - Grave `testes.linhaDeBase`: `{ "estado": "passando" | "falhando" | "sem-testes",
     "registradaEm": "<hoje>", "falhas": <número> }`.
   - Com `falhando`: liste as falhas em `docs/linha-de-base-de-testes.md` (nome do teste e
     motivo em uma linha) e ofereça corrigir uma de cada vez, cada uma no próprio PR `fix:`.
   - Com `sem-testes`: avise que o push não será bloqueado e ofereça criar uma suíte mínima.

9. **Conferir a configuração.** Cada comando de `harness/settings.json` aparece no
   `.claude/settings.json` do projeto, e nenhum dos arquivos de configuração
   (`.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json`) tem
   `"disableAllHooks": true`.

10. **Reiniciar o Claude Code.** O Claude Code lê os hooks no início da sessão: o que foi
    copiado e mesclado só vale numa sessão nova (ou depois de a pessoa revisar em `/hooks`).
    Diga à pessoa: "Para as travas valerem, saia do Claude Code e abra de novo nesta pasta
    (`claude --continue` retoma esta conversa). Depois me peça para seguir a instalação."
    Não siga para o próximo passo nesta sessão.

11. **Provar, na sessão nova, que as travas estão ligadas.** Rode pelo Bash:
    ```bash
    git push origin main --dry-run
    ```
    O comando tem que ser **negado** pela trava (`[Trava: branch protegida] Bloqueado: push com
    destino na branch protegida`), sem a saída do git. Se o git chegou a rodar (mesmo só
    simulando), as travas não estão ligadas: pare e reporte. Trava desligada sem aviso é pior que
    trava nenhuma.

12. **Organizar o contexto.** Rode a skill `organizando-contexto` (na atualização, só se o
    início de sessão avisou que o mapeamento está faltando ou velho).

13. **Entregar.** Commit pela skill `commitando` (`chore: instala harness da Expert vX.Y.Z`
    ou `chore: atualiza harness da Expert para vX.Y.Z`), push e PR pela skill `abrindo-pr`.

14. **Só na atualização vinda da 0.1.0: remover os hooks soltos**, depois do commit e do push
    do passo 13, na mesma branch:
    - No `.claude/settings.json`, remova as entradas que chamam `.claude/hooks/<arquivo>.mjs`
      quando o arquivo é um hook do harness (`guard-*.mjs`, `registrar-*.mjs` e
      `inicio-de-sessao.mjs` que existem em `harness/hooks/` da metodologia).
    - Pergunte à pessoa e apague esses arquivos antigos e `.claude/hooks/lib/`, este só se tiver
      apenas as libs do harness: compare com `harness/hooks/lib/` da tag v0.1.0
      (`$TMP/anterior`). Arquivo a mais ou editado em `lib/` é do projeto: mantenha e avise.
    - Commit `chore: remove hooks soltos da 0.1.0` e push para o mesmo PR.
    - Avise: depois do merge, quem estiver com uma sessão do Claude Code aberta neste projeto
      precisa reiniciá-la (a sessão aberta ainda chama os arquivos antigos).

    Apague `$TMP` no fim.

## Relatório final (pt-BR, curto)

- Versão antes → depois.
- O que foi copiado, o que foi mantido do projeto e os conflitos que a pessoa precisa decidir.
- Linha de base de testes (estado e número de falhas).
- Prova das travas (o `git push origin main --dry-run` negado na sessão nova).
- Link do PR e o lembrete: quem tem sessão aberta no projeto reinicia o Claude Code depois do merge.

## Desinstalar ou voltar atrás

- Voltar para antes da instalação: restaure a cópia (`rsync -a --delete .claude/backup-<data-hora>/ .claude/`
  preservando `state/` e os backups) ou, se ainda não houve merge, feche o PR e apague a branch.
- Desinstalar: remova `.claude/hooks/expert/`, as skills e rules que vieram do harness (os nomes estão
  em `harness/` da metodologia), as entradas de hooks que apontam para `.claude/hooks/expert/` e o
  `.claude/expert-governanca.json`. Faça isso numa branch, com PR, como qualquer mudança.

## Nunca

- Apagar hook, permissão, rule ou skill do projeto sem listar na tabela do passo 7-B, sem o "sim" da pessoa e sem cópia no backup. O que sobrepõe o núcleo da Expert é aposentado; o núcleo nunca é.
- Desligar ou deixar de fora uma trava, `permissions.deny` ou rule do núcleo para preservar algo do projeto.
- Instalar direto na `main`.
- Copiar `.claude/state/` ou backups para o git.
