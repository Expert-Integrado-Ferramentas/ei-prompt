---
name: criando-rules
description: Cria ou edita uma rule própria do projeto (.claude/rules/<nome>.md) no mesmo formato das rules da Expert, e decide quando o assunto deveria ser trava (hook), CLAUDE.md de pasta ou memória em vez de rule. Use quando o projeto tem um padrão de código próprio que se repete, quando a pessoa pedir "cria uma regra para...", ou quando for acrescentar convenção ou armadilha a uma rule do projeto.
---

# Escrevendo uma rule do projeto

## 1. Decidir se é rule mesmo

| O conhecimento é... | Vai para |
| --- | --- |
| Crítico e verificável por comando (bloquear algo perigoso) | **Trava**, não rule: sugira pela skill `colhendo-aprendizados` (`tipo:trava`). Regra escrita não segura erro grave |
| Padrão de código de um tipo de arquivo, que se repete | **Rule do projeto** (esta skill) |
| Lei de uma pasta só | `AGENTS.md` daquela pasta |
| Padrão ou armadilha do projeto, sem tipo de arquivo definido | `.claude/memory/` (skill `organizando-contexto`) |
| Já existe memória sobre o assunto e ele tem tipo de arquivo definido | **Rule** (esta skill); a memória vira `promovido → <caminho da rule>`, sem repetir o texto |
| Vale para todo projeto da empresa | Sugestão `tipo:regra` à metodologia (`colhendo-aprendizados`) |
| Óbvio pelo código, configuração de ferramenta (ESLint, tsconfig) ou decisão de uma tarefa só | Lugar nenhum |

Antes de escrever, confira que a rule do harness com o mesmo assunto não diz já a mesma coisa.
Nunca edite uma rule do harness no projeto: ela é substituída na próxima atualização.

## 2. Formato

```markdown
---
paths:
  - "src/integrations/**/*.ts"
---

# <Assunto>

Uma frase: quando carrega e o que garante.

## Convenções
- <instrução direta, uma linha, no imperativo>

## Exemplos
<trecho curto de código mostrando o jeito certo, só se ajudar>

## Armadilhas
- **<nome curto>**: <o problema que já aconteceu e como evitar>
```

- `paths:` com caminhos específicos. Sem `paths:` a rule carrega em toda conversa: só para o que
  vale no projeto inteiro. Nunca `"**/*"`.
- **Convenções** é obrigatória (pelo menos 3 itens). **Exemplos** e **Armadilhas**, só se houver.
- Português claro, frases curtas, sem emoji. Um item por linha.
- Tamanho: até ~100 linhas. Maior que isso, divida por assunto.
- Nome do arquivo em kebab-case, diferente dos nomes das rules do harness.

## 3. Procedimento

1. Confirme que o padrão existe de fato no código (`grep`). Não invente regra que o código não segue.
2. Escolha os `paths:` olhando onde os arquivos daquele tipo moram.
3. Escreva em `.claude/rules/<nome>.md` no formato acima.
4. Para acrescentar a uma rule existente do projeto: classifique (convenção ou armadilha),
   coloque na seção certa e confira que não repete item.
5. Acrescente uma linha na tabela de pastas do `AGENTS.md` raiz se a rule cobrir uma pasta.
6. Entregue por `commitando` (`docs: cria rule <nome>`).
