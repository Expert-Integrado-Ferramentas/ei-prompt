---
name: criando-issue
description: Escreve uma issue de tarefa no padrão da Expert (resumo com o porquê, jornadas, critérios de aceite testáveis, escopo, dependências entre issues, domínio sensível, prioridade e tamanho pequeno) a partir de um pedido solto ou de um plano com várias fatias, mostra o texto e só publica com um "sim". O formato é o do claude-harness, então a mesma issue serve à pipeline autônoma. Use quando a pessoa pedir "cria uma issue", "registra essa tarefa", "abre uma issue para isso" ou quando um trabalho for grande demais para uma entrega só. Para sugestão de melhoria da metodologia, use `colhendo-aprendizados`.
---

# Criando uma issue de tarefa

A issue é o **contrato da entrega**: quem pegar a tarefa (pessoa ou Claude) deve conseguir
resolver sem perguntar nada, e os critérios de aceite viram os testes (teste vem primeiro).

Repositório: o do projeto atual (`gh repo view --json nameWithOwner -q .nameWithOwner`).

## Procedimento

1. **Entender o pedido.** Se faltar algo que muda o resultado (quem usa, o que é "pronto"), pergunte
   uma vez, em uma mensagem. O que o código ou o git respondem, descubra sozinho.

2. **Procurar duplicada:** `gh issue list --state open --search "<palavras-chave>"`. Achou parecida:
   mostre o link e pergunte se comenta nela em vez de criar outra.

3. **Montar o texto** com estes títulos, exatamente (o `tarefa.yml`, ao lado desta skill, usa os mesmos; são os do claude-harness, que a pipeline autônoma lê; para quem abre pelo GitHub, o modelo vai em `.github/ISSUE_TEMPLATE/` do projeto):

   ````markdown
   ### Resumo + por quê

   <o que é e por que importa, em 1 a 3 linhas>

   ### User journeys

   #uj-1: <quem se beneficia e de que forma>

   ### Critérios de aceite (testáveis e observáveis)

   #ac-1.1: dado <situação>, quando <ação>, então <resultado com valor concreto>
   #ac-1.2: ...

   ### Escopo

   Pode: <arquivos ou áreas>
   Não tocar: <o que fica de fora>

   ### Decisões já resolvidas (opcional)

   <chave: valor concreto, para quem implementa não inventar>

   ### Domínio sensível?

   <não | auth/sessão | pagamento/billing | dados/PII | segredos | SQL/migração>

   ### Prioridade

   <P0 | P1 | P2>

   ### Tamanho estimado

   <S | M | L>

   ### Dependências

   ```harness-deps
   #12
   #13
   ```
   ````

   Sem dependência, a seção diz só `Nenhuma.` (sem o bloco).

   Regras de qualidade:
   - Critério **observável e com valor concreto** ("mostra `id 3`", não "mostra o id certo"). Cada
     um tem que virar um teste; se não dá para testar, reescreva. Numeração `#ac-N.M`, com N a jornada.
   - **Pequena:** uma issue é uma coisa que entra e volta sozinha (até ~400 linhas). Se dá para
     nomear duas entregas que poderiam ser mescladas separadas, são duas issues, ligadas pela dependência.
     Juntar é exceção: só quando as partes não sobem separadas, cabem em ~400 linhas e têm o mesmo risco.
   - Área sensível diferente de "não": diga no resumo que a mudança precisa de cuidado extra.
   - Sem segredo, dado pessoal, nome de cliente ou trecho de dado real. Descreva o caso de forma geral.
   - Pré-requisito fora do GitHub (decisão de alguém, resposta do cliente): escreva no resumo. Enquanto
     não estiver resolvido, a issue não entra na fila autônoma.

   **Dependências entre issues (plano com várias fatias):**
   - Só entra no bloco `harness-deps` a issue que precisa estar **mesclada** antes desta.
   - Publique na ordem das dependências (cada uma depois das que ela cita), trocando o código da fatia
     pelo número real. Confira antes que não há ciclo e que todo `#N` existe.
   - Ligue também cada par como "bloqueada por" no próprio GitHub, que a pipeline autônoma exige além do bloco:
     `gh api -X POST repos/<owner>/<repo>/issues/<N>/dependencies/blocked_by -F issue_id=<id numérico da issue que bloqueia>`
     (o id vem de `gh api repos/<owner>/<repo>/issues/<M> --jq .id`).
   - Para um plano grande, crie também uma issue de acompanhamento com as fatias e o caminho crítico.

4. **Mostrar o texto inteiro** (título, corpo e labels) e **só publicar com um "sim" explícito**: a
   issue fica no repositório e o histórico de edição guarda o texto mesmo depois de apagado.

5. **Publicar:**
   ```bash
   gh issue create --title "<título>" --body-file <arquivo-temporario> [--label <label>]
   ```
   - Projeto **sem** a pipeline autônoma: título no mesmo estilo do commit, em português
     (`fix: id da unidade aparece como "?" no test_connection`).
   - Projeto **com** a pipeline autônoma do claude-harness (tem a label `harness:ready`): título
     `[harness] <slug-em-kebab-case>`, que é o filtro da rotina. Labels:
     - `harness:ready` põe a issue na fila: a pipeline implementa e **mescla sozinha**. Só com o sinal
       explícito da pessoa e sem pré-requisito em aberto.
     - `harness:local` deixa a issue fora da fila, com entrega local e gate humano. Use só nas críticas
       das críticas: porta de login, função de permissão, cofre de tokens, publicação real, pagamento.
       Não use em tudo que é sensível: o campo "Domínio sensível?" já faz a pipeline rodar a revisão de segurança.
     - Nunca aplique à mão `harness:queued` nem `harness:blocked`: são da pipeline.
     - Labels que faltarem: `scripts/criar-labels-pipeline.sh owner/repo` do repositório de governança.
   Sem inventar outras labels: use só as que existem (`gh label list`).

6. **Relatório em uma linha:** o link da issue. Se a pessoa pedir para resolver agora, siga com
   `commitando` e `abrindo-pr`, e o PR leva `Closes #N`.

## Nunca

- Publicar sem mostrar o texto e receber o "sim".
- Critério de aceite que não dá para testar.
- Issue com mais de uma entrega independente.
- Dependência só no texto: sem o bloco `harness-deps` e sem o "bloqueada por" nativo, a pipeline não respeita a ordem.
- `harness:ready` sem o "sim" da pessoa para começar a implementar.
