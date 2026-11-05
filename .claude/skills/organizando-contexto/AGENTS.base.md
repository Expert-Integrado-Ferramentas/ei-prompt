# <Nome do projeto>

<Uma ou duas frases: o que o projeto faz, para quem e onde roda (plataforma).>

Antes de começar qualquer tarefa, leia `.claude/memory/MEMORY.md` (ela não carrega sozinha) e
o `AGENTS.md` da pasta em que vai mexer, se houver.

## Regras da Expert

1. A `main` só muda por PR. Trabalhe numa branch `tipo/descricao`.
2. Commit no padrão Conventional Commits, com a descrição em português.
3. Nenhum segredo ou dado pessoal (de aluno, cliente ou participante) no código, em teste, log,
   commit ou issue.
4. Teste antes do push, e a suíte inteira: o que foi feito e tudo o que já existia.
5. Quem torna algo obsoleto (código, arquivo, flag, documento) remove no mesmo PR.
6. Limpeza de branch só depois de provar o merge.
7. Mudança de banco só por migration testada localmente.
8. Versão semântica e CHANGELOG em toda versão lançada.
9. Afirmação se prova com medida: comando rodado, resultado, número. "Deve funcionar" não vale.
10. Erro que se repete vira rule (ou trava, se for risco grave), não mais um parágrafo neste arquivo.
11. `AGENTS.md` guarda só regra do projeto (e o roteamento para as pastas). Relatório de entrega,
    histórico e diário de incidente vão na descrição do PR ou em `docs/`, nunca aqui.
12. Não altere o próprio harness (`.claude/hooks/`, `.claude/settings.json`, `.claude/state/`)
    sem pedido explícito da pessoa; mudança no harness vem pela skill `instalando-harness`.

## Regras deste projeto

- <regra específica do projeto, uma linha cada>

## Comandos

- Testes: `<comando>`
- Rodar local: `<comando>`
- Publicar: skill `publicando`

## Onde está cada coisa

| Pasta | O que mora lá | Veja |
| --- | --- | --- |
| `<pasta>/` | <o que mora lá, em uma frase> | `<pasta>/AGENTS.md` |

- Glossário do negócio: `CONTEXT.md`
- Padrões e armadilhas do projeto: `.claude/memory/MEMORY.md`
- Runbooks, incidentes e decisões: `docs/`

## Metodologia

Stack padrão, políticas e o próprio harness:
https://github.com/Expert-Integrado-Ferramentas/expert-governanca
