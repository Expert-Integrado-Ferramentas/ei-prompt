---
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
  - "app/**/*.ts"
  - "app/**/*.tsx"
  - "worker/**/*.ts"
  - "worker/**/*.tsx"
  - "supabase/functions/**/*.ts"
---

# Observabilidade

Carrega ao mexer em código da aplicação. Objetivo: quando algo quebrar em produção, achar o
porquê sem vazar segredo.

## Convenções

### Log estruturado
- Em produção, log em JSON numa linha: `console.log(JSON.stringify({ ... }))`.
- Campos de todo log: `op` (nome da operação), `level` (`error`, `warn`, `info`, `debug`) e os
  identificadores úteis (`requestId`, `orderId`). Em operação que mede tempo, `durationMs`.
- Identificador técnico (ID) sim; dado pessoal (nome, e-mail, telefone, CPF) não.

### Níveis
- `error`: a operação falhou. `warn`: houve problema, mas o sistema se recuperou (nova tentativa,
  plano B). `info`: evento esperado importante. `debug`: detalhe interno, desligado em produção.

### Erro nunca engolido
- `catch` loga com contexto (op, IDs, status) e relança ou devolve erro estruturado.
- `catch {}` vazio é proibido: vira bug invisível.
- Em produção, logue `error.message`, nunca `error.stack`.

### Proibido no log
- Chave de API, cabeçalho `Authorization`, token, JWT, senha (nem com hash), cookie.
- `env` inteiro, corpo inteiro da requisição, query string com token.
- Resposta inteira de serviço externo. Corte em ~500 caracteres.
- Dado pessoal de aluno ou cliente.

### Tela (navegador)
- `console.log` em produção aparece para qualquer pessoa no DevTools. Remova antes de publicar.
- Erro de renderização capturado por `ErrorBoundary` na raiz das rotas.

### Saúde
- Serviço publicado expõe `/health` devolvendo 200 e `{ "ok": true }`, conferindo o banco ou o
  recurso principal. A skill `publicando` usa essa rota para conferir o deploy.

## Exemplos

```typescript
async function processOrder(order: Order): Promise<Order> {
  const startedAt = Date.now();
  try {
    const processedOrder = await runOrderSteps(order);
    console.log(JSON.stringify({ op: "processOrder", level: "info", orderId: order.id,
      durationMs: Date.now() - startedAt }));
    return processedOrder;
  } catch (error) {
    console.error(JSON.stringify({ op: "processOrder", level: "error", orderId: order.id,
      message: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt }));
    throw error;
  }
}
```

## Armadilhas

- **`console.log(error)`**: em alguns ambientes imprime a pilha inteira. Extraia `.message`.
- **`console.log(env)`**: mostra todos os segredos no `wrangler tail`. Se precisar, `Object.keys(env)`.
- **Log dentro de laço**: 10 mil voltas viram 10 mil linhas. Logue o resumo no fim.
- **`JSON.stringify(error)`**: sai `{}`. Use `error.message`.
