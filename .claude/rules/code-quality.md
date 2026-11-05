# Qualidade de código

Universal: carrega em toda conversa. Objetivo: código que qualquer pessoa, ou outro Claude,
entende e mantém.

## Convenções

### Tamanho e responsabilidade
- Uma função, uma responsabilidade. Nome com "And" (`validateAndSave`) pede duas funções.
- Função acima de ~40 linhas precisa de motivo (parser, laço complexo). O padrão é dividir.
- Arquivo acima de ~300 linhas precisa de motivo. O padrão é dividir por assunto.

### Reaproveitamento sem exagero
- Duplicado em 2 lugares: tolerável. Em 3 ou mais: extraia.
- Não crie abstração "para o futuro". Três linhas repetidas valem mais que uma abstração errada.
- Antes de criar um utilitário, procure se já existe: `grep -rn "<conceito>" src/`.
- Prefira o nativo da plataforma (`Intl`, `URL`, `crypto`, `fetch`) a escrever à mão ou instalar pacote.

### Nomes
- Identificadores, tabelas, colunas e rotas em inglês; textos para pessoas (telas, mensagens,
  documentação, comentários) em português.
- Variáveis e funções: camelCase (`fetchStudent`). Tipos, classes e componentes: PascalCase.
- Constantes de módulo: SCREAMING_SNAKE_CASE (`MAX_RETRIES`).
- Arquivos: kebab-case (`fetch-student.ts`). Componente React também em kebab-case (`student-card.tsx`), exportando `StudentCard`.
- Booleanos com `is/has/can/should` (`isLoading`, `hasError`).
- Nada de nomes vagos: `data`, `info`, `temp`, `result`, `obj`. Diga o que é (`student`, `dueDate`).
- Número mágico vira constante com nome.

### Pastas
- Pastas por assunto do negócio (`students/`, `billing/`), não por tipo técnico genérico.
- Proibido arquivo lixeira: `utils.ts`, `helpers.ts`, `misc.ts`, `common.ts`. Nomeie pelo assunto.
  Exceção: o `lib/utils.ts` criado pelo shadcn, só com a função `cn`. Ele é o padrão do ecossistema
  (os componentes e exemplos importam de lá); qualquer outra função vai para um arquivo com nome do assunto.
  Exceção: arquivo de apoio de teste (`test/helpers.ts`, `tests/**/helpers.ts`). É utilitário de
  teste, não código de produção.
- `index.ts` só reexporta. Nunca lógica dentro dele, nem reexportação em cascata.
  Exceção: a entrada do Worker (`src/index.ts`, `src/worker/index.ts`) pode ligar rotas e handlers.
  Ela é o ponto de entrada, não um arquivo que só reexporta.
- Prefira export nomeado a `export default` (renomear e buscar fica fácil).

### Comentários
- Código bem nomeado dispensa comentário.
- Comente só o **porquê**: restrição escondida, contorno de bug externo, decisão surpreendente.
- Nunca comente o quê (`// soma 1`). Nada de "código antigo, não apagar": o git guarda.
- Código morto, flag sem uso e arquivo obsoleto saem no mesmo PR que os tornou obsoletos.

### TypeScript (em projetos TypeScript)
- `strict: true` no `tsconfig.json`, sempre.
- Sem `any`. Use `unknown` na borda e refine com checagem ou Zod.
- Sem `as` para calar o compilador. Valide em vez de afirmar.
- `type` para objetos simples, `interface` para contratos extensíveis.
- Nada de `enum` numérico. Use união de strings ou objeto `as const`.
- Sem import circular. Ele indica acoplamento errado.

### Testes na interface pública
- Teste o que o módulo exporta, nunca função interna. Reorganizar o miolo não pode quebrar teste.

## Exemplos

```typescript
// Ruim: uma função faz tudo
async function processOrder(order) { /* 80 linhas */ }

// Bom: cada passo é testável
async function processOrder(order: Order): Promise<Order> {
  const validOrder = validateOrder(order);
  const total = calculateTotal(validOrder);
  const savedOrder = await saveOrder(validOrder, total);
  await notifyCustomer(savedOrder);
  return savedOrder;
}
```

## Armadilhas

- **Abstração de um uso só**: se só um lugar chama, deixe junto. Extraia com 2 usos reais.
- **Dezenas de arquivos de 10 linhas**: é o formato que a IA produz por padrão e o mais caro de
  navegar. Veja "módulos profundos" na rule `architecture`.
- **Reinventar o nativo**: formatação de moeda, data ou URL escrita à mão. Use `Intl` e `URL`.
- **Apagar código só para diminuir linhas**: simplifique o que é morto ou duplicado, não o que funciona.
