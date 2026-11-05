---
name: colhendo-aprendizados
description: Ao fim de cada entrega, guarda no projeto o que vale a pena lembrar (AGENTS.md da pasta, CONTEXT.md, memória) e, quando o aprendizado vale para a empresa toda, abre ou reforça uma sugestão de melhoria (issue) no repositório da metodologia. Chamada pela skill abrindo-pr. Use também quando a pessoa pedir "registra o que aprendemos" ou quando uma trava bloquear sem motivo.
---

# Colhendo aprendizados

Repositório da metodologia: `repositorioDaMetodologia` em `.claude/expert-governanca.json`, ou
`Expert-Integrado-Ferramentas/expert-governanca`.

## Procedimento

1. **Levantar candidatos** desta entrega: o que custou tempo, o que deu errado e foi corrigido,
   convenção que precisou ser descoberta, utilitário que faltou, termo do negócio novo, trava que
   bloqueou sem motivo ou deixou passar algo grave.

2. **Teste de durabilidade.** Fica só o que é **reutilizável** (ajuda numa tarefa futura) e **não
   óbvio** (não sai do código, do git ou do que já está escrito). O resto fica no git. Na dúvida,
   não guarde.

3. **Guardar no projeto**, pelo alcance (modelo da skill `organizando-contexto`):
   - Vale numa pasta só → `AGENTS.md` daquela pasta (e o `CLAUDE.md` ponteiro `@AGENTS.md` ao lado, se for novo) + linha na tabela da raiz, se nova. Nunca no `AGENTS.md` da raiz, que só roteia.
   - Vale no projeto todo → arquivo em `.claude/memory/` (frontmatter `name`/`description`, corpo
     com **Por quê** e **Como aplicar**) + uma linha no `MEMORY.md`.
   - Termo do negócio → linha nova no `CONTEXT.md` (só acrescente, nunca reescreva).
   - Já está escrito em outro lugar: não repita. Se subiu de nível (da memória para uma rule),
     troque o original por `promovido → <caminho>`.

4. **Vale para a empresa toda?** (rule que faltou, trava com falso positivo ou que deixou passar
   erro, modelo de projeto incompleto, documento de stack que faltou ou está errado). Se não,
   pule para o passo 6.

5. **Sugestão à metodologia.**
   - Procure uma issue aberta parecida:
     `gh issue list --repo <repo> --state open --search "<palavras-chave>"`.
   - **Antes de publicar qualquer coisa, mostre à pessoa o texto inteiro** (título, corpo, labels)
     e só siga com um "sim" explícito. A issue fica no repositório da empresa e o histórico de
     edição do GitHub guarda o texto mesmo depois de editado.
   - **Achou:** comente o caso novo (projeto e o que aconteceu, descrito sem dados reais) e acrescente a label
     `recorrente`: `gh issue edit <n> --repo <repo> --add-label recorrente`.
   - **Não achou:** crie.
     ```bash
     gh issue create --repo <repo> \
       --title "[<tipo>] <resumo em uma linha>" \
       --label "tipo:<tipo>,status:proposta,impacto:<alto|medio|baixo>,origem:claude" \
       --body-file <arquivo>
     ```
     Corpo, com os mesmos títulos do formulário de issue da metodologia
     (`.github/ISSUE_TEMPLATE/sugestao.yml`):
     ```markdown
     ### Tipo
     <trava | regra | skill | boilerplate | stack | politica | documentacao>

     ### Quem sugeriu
     <login do GitHub de quem estava na sessão>, projeto <nome do repositório>

     ### O que aconteceu
     <o fato, descrito de forma genérica: tipo de comando, tipo de erro, tipo de arquivo.
      Nunca cole saída de comando, linha de código com dado, string de conexão ou trecho de dado real>

     ### Por quê
     <qual problema a mudança resolve>

     ### Proposta
     <o que mudar e onde: regra, trava, skill, boilerplate ou documento>

     ### Impacto
     <alto | medio | baixo>: <quem é afetado e o risco de mudar>
     ```
   - `tipo:` exatamente um: `trava`, `regra`, `skill`, `boilerplate`, `stack`, `politica`,
     `documentacao`. `impacto:` exatamente um.
   - Status: **só `status:proposta`**. Nunca ponha nem mude outro status; isso é decisão do dono
     da metodologia.
   - Label inexistente no repositório: crie a issue sem ela e avise a pessoa. Não crie labels
     (elas vêm do `scripts/criar-labels.sh` da metodologia).
   - Nunca coloque dado pessoal, nome de cliente, segredo ou trecho de dado real na issue. Descreva
     o caso de forma genérica.

6. **Commit** das mudanças do projeto na branch atual (`docs: registra aprendizados da entrega`).

7. **Relatório em uma linha:** o que foi atualizado no projeto e qual issue foi aberta ou
   reforçada (link), ou "nada durável nesta entrega".
