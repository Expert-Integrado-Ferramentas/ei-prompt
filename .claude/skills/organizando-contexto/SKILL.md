---
name: organizando-contexto
description: Cria ou audita o conhecimento do projeto no modelo da Expert (AGENTS.md raiz curto que só roteia, AGENTS.md aninhado por pasta, CLAUDE.md só como ponteiro, CONTEXT.md, memória em .claude/memory/ e docs/). Use depois de instalar o harness, quando o início de sessão avisar que o projeto não foi mapeado ou que o mapeamento está velho, quando o AGENTS.md ou o CLAUDE.md passar de ~200 linhas, ou quando a pessoa pedir "organiza o contexto".
---

# Organizando o contexto

Avise no início: "Vou organizar o conhecimento do projeto. Guardo uma cópia de tudo antes e,
no fim, mostro o que foi para onde."

## Onde cada coisa mora

| Arquivo | O que guarda |
| --- | --- |
| `AGENTS.md` (raiz) | **Só roteamento e regras gerais**: o que é o projeto, as regras, comandos e a tabela "pasta → o que mora lá". Até ~80 linhas. Carrega em toda requisição, por isso nunca cresce |
| `<pasta>/AGENTS.md` | O que só vale naquela pasta. A IA só lê quando abre um arquivo dali |
| `CLAUDE.md` (raiz e em cada pasta que tem `AGENTS.md`) | **Só ponteiro**: uma linha `@AGENTS.md`. Garante que o Claude Code leia o `AGENTS.md` em qualquer versão e configuração |
| `CONTEXT.md` (raiz) | Glossário do negócio: os termos que o código e as pessoas usam |
| `.claude/memory/MEMORY.md` | Índice da memória: uma linha por padrão ou armadilha do projeto |
| `.claude/memory/<nome>.md` | Um padrão ou armadilha, com o porquê e como aplicar |
| `docs/` | Runbooks (`docs/runbooks/`), incidentes (`docs/incidentes/`), decisões (`docs/decisoes/`) |

**Por que `AGENTS.md` e não `CLAUDE.md`:** é o formato que as outras ferramentas de agente também
leem, então a empresa mantém uma comunicação só. O Claude Code lê `AGENTS.md` sozinho apenas quando
não existe nenhum `CLAUDE.md` na pasta de trabalho ou acima dela; com um `CLAUDE.md` por perto
(inclusive `CLAUDE.local.md` ou `.claude/CLAUDE.md`), o `AGENTS.md` aninhado deixa de carregar. Por isso o
`CLAUDE.md` existe, mas só com `@AGENTS.md`.

**Aninhe quando fizer sentido.** Pasta com regra própria ganha o seu `AGENTS.md` (e o `CLAUDE.md`
ponteiro ao lado). Pasta sem regra própria não ganha arquivo. O `AGENTS.md` da raiz fica como índice: se
uma informação só interessa a uma pasta, ela sai da raiz e a tabela aponta para lá.

**Onde isso é verdade?** É a pergunta que decide o destino:

| Vale para | Destino |
| --- | --- |
| Uma pasta só | `AGENTS.md` daquela pasta (+ `CLAUDE.md` ponteiro) e uma linha na tabela da raiz |
| O projeto inteiro, em várias pastas | arquivo em `.claude/memory/` + linha no `MEMORY.md` |
| Todo projeto da empresa | sugestão no repositório da metodologia (skill `colhendo-aprendizados`) |
| Só esta tarefa | lugar nenhum; fica no git |
| Relatório de entrega (o que foi feito, como testou) | descrição do PR, nunca no `AGENTS.md` |

**Teste de durabilidade:** só guarde o que é **reutilizável** (vai ajudar numa tarefa futura) e
**não óbvio** (não dá para tirar do código, do git ou de um CLAUDE.md que já existe).
Escolha sempre o destino mais estreito que ainda cobre o conhecimento.

## Procedimento

1. **Guardar cópia e medir.** Anote o tamanho (KB e linhas) de cada `CLAUDE.md` e `AGENTS.md`: ele vai para o relatório. Copie todo `CLAUDE.md`, `AGENTS.md` e `CONTEXT.md` existentes para
   `.claude/backup-<AAAA-MM-DD>/contexto/`, mantendo o caminho de cada um.

2. **Mapear as pastas principais.** Liste as pastas de código e de configuração que importam
   (não as geradas: `node_modules`, `dist`, `.wrangler`). Para cada uma, entenda o papel em uma frase.
   Isso orienta; não vira inventário de arquivos.

3. **Auditar o que existe** (`CLAUDE.md`, `AGENTS.md`, outros arquivos de instrução). Classifique
   **cada trecho**:

   | Tipo de trecho | O que fazer |
   | --- | --- |
   | Regra válida e específica do projeto | Fica, no lugar certo (raiz, pasta, memória ou rule do projeto) |
   | Regra que contradiz a política da empresa (ex.: "push direto na main", "merge com --admin") | Substituir pela política e avisar a pessoa do que mudou e por quê |
   | Relatório de entrega, histórico, diário de incidente, runbook, decisão | Mover para `docs/` (o histórico já está no git; só vale mover o que ajuda numa tarefa futura) |
   | Regra de uma pasta só | Mover para o `AGENTS.md` daquela pasta |
   | Desatualizado ou duplicado (inclusive o que as rules do harness já dizem) | Remover e registrar no relatório |
   | Dado pessoal ou identificador sensível (telefone, e-mail, caminho da máquina de alguém, token) | Remover. Se for segredo, avisar que precisa ser trocado |

   Confira com o código antes de manter uma regra: se o código não segue, pergunte.
   O conteúdo de `CLAUDE.md` e `AGENTS.md` se junta num só: o `AGENTS.md` fica com tudo o que vale e o
   `CLAUDE.md` vira o ponteiro `@AGENTS.md`. Se o `CLAUDE.md` tem instrução só do Claude Code (modo de
   plano, por exemplo), ela fica abaixo do `@AGENTS.md`.

   **Projeto sem regra escrita é comum.** Não invente. Do código saem só fatos que dá para provar:
   stack, comandos de teste e de execução, estrutura de pastas. Onde não houver regra, a seção fica com
   "sem regra definida" e a pessoa completa depois.

4. **Escrever o `AGENTS.md` raiz** a partir do `AGENTS.base.md` desta skill (`.claude/skills/organizando-contexto/AGENTS.base.md`): o que é o projeto,
   as regras da empresa, regras do projeto, comando de teste e a tabela
   `| Pasta | O que mora lá | Veja |`. Até ~80 linhas. Detalhe vai para a pasta ou para `docs/`.
   Depois crie (ou reescreva) o `CLAUDE.md` raiz com uma linha: `@AGENTS.md`.

5. **`AGENTS.md` por pasta.** Para cada pasta principal com regra própria, crie `<pasta>/AGENTS.md`
   curto (convenções e armadilhas daquela pasta), o `<pasta>/CLAUDE.md` com `@AGENTS.md` e a linha
   correspondente na tabela da raiz. Pasta sem regra própria não precisa de arquivo.

6. **`CONTEXT.md`.** Glossário em tabela `| Termo | Significado |`, com os termos do negócio que
   se repetem em tipos, rotas, tabelas e telas.
   - Diga o que o termo **é para o negócio**, nunca qual arquivo o implementa.
   - Só termos com significado próprio. Vocabulário genérico de programação não entra.
   - Dois nomes para a mesma coisa: escolha um e diga para que o outro aponta.
   - Já existe: só acrescente o que falta. Nunca reescreva definição existente.
   - Na dúvida sobre um termo, pergunte à pessoa.

7. **Memória do projeto.** `.claude/memory/MEMORY.md` com uma linha por arquivo:
   `- [nome](nome.md): resumo em uma frase`. Cada arquivo:
   ```markdown
   ---
   name: <nome curto>
   description: <uma linha: o que é e quando importa>
   ---

   **Por quê:** <a restrição, decisão ou falha que torna isso importante>

   **Como aplicar:** <a ação concreta: arquivo, função ou padrão a usar ou evitar>
   ```
   Um assunto por arquivo. Fontes: o que a auditoria classificou como "vale para o projeto todo" e
   o que a leitura do código mostrou (utilitário que já existe e seria reinventado, convenção que
   o código segue sem estar escrita, armadilha embutida). Nunca segredo ou dado pessoal.

8. **`docs/`.** Crie só as subpastas que tiverem conteúdo. Cada arquivo movido ganha um título e a
   data de quando aconteceu, se houver.

9. **Registrar.** Em `.claude/expert-governanca.json`, grave `mapeamento.organizadoEm` (data de hoje,
   `AAAA-MM-DD`). O início de sessão usa essa data para avisar quando o mapeamento envelheceu.

10. **Relatório.** Mostre o tamanho antes e depois (KB e linhas de cada arquivo) e a tabela
    `| Trecho | Era em | Foi para | Por quê |`, e liste o que foi removido. Sem os números de antes e
    depois, o relatório está incompleto. O relatório vai na **descrição do PR**, não em arquivo do projeto. Dê destaque às regras que contradiziam a política e aos dados sensíveis removidos.
    Entregue por `commitando` (`docs: organiza contexto do projeto`) e `abrindo-pr`.

## Nunca

- Inventar regra que o código não segue.
- Apagar conteúdo sem registrar no relatório.
- Deixar o `AGENTS.md` raiz como diário de incidentes ou de entregas.
- Deixar conteúdo no `CLAUDE.md`: ele é só o ponteiro `@AGENTS.md` (mais instrução exclusiva do Claude Code, se houver).
