---
paths:
  - "**/*.spec.ts"
  - "**/*.spec.tsx"
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*_test.ts"
  - "test/**/*.ts"
  - "tests/unit/**/*.ts"
  - "vitest.config.*"
---

# Testes de unidade e integração

Carrega ao mexer em arquivo de teste. Stack padrão: **Vitest**, Testing Library para tela e
`@cloudflare/vitest-pool-workers` para Worker (roda no ambiente real da Cloudflare). Edge function
do Supabase (Deno): `deno test`.

## Convenções

### Estrutura
- Teste ao lado do código (`fetch-student.ts` ↔ `fetch-student.spec.ts`) ou espelhado em `test/`.
  Siga o que o projeto já faz.
- Um `describe` por unidade, um `it` por comportamento.
- Nome do teste é uma frase em português que diz o comportamento:
  `it("devolve 404 quando o aluno não existe")`. Nunca `it("test 1")` ou `it("funciona")`.

### Preparar, agir, verificar
- **Preparar**: dados e mocks. **Agir**: uma ação. **Verificar**: o resultado esperado.
- Separe as três partes com linha em branco.

### Mock só nas bordas
- Faça mock de: `fetch`, banco, relógio (`vi.useFakeTimers()`), `crypto.randomUUID`, API do navegador.
- Não faça mock da lógica do próprio projeto. Prefira passar a dependência como parâmetro.
- Mock de `fetch`: crie a `Response` dentro da função, a cada chamada. Restaure com
  `vi.restoreAllMocks()` no `beforeEach`.

### O que testar
- Teste: regra de negócio, validação, parser, cálculo, tratamento de erro, rota (status e corpo).
- Não teste: getter trivial, tipo, repasse de uma linha para biblioteca externa.
- Cobertura é consequência, não meta. Teste bom com 60% vale mais que teste ruim com 90%.

### Dados de teste
- Dado inventado, nunca real (ver `security`).
- Dado reutilizado vira fábrica: `buildStudent(overrides?: Partial<Student>)` em `test/fixtures/`.
- No `vitest-pool-workers` não há sistema de arquivos: carregue fixture com
  `import payload from "./fixtures/payload.json?raw"` ou import de JSON, nunca `node:fs`.

## Exemplos

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchStudent } from "./fetch-student";

describe("fetchStudent", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("devolve o aluno quando a API responde 200", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ id: "1", name: "Aluno Teste" }), { status: 200 }),
    );

    const student = await fetchStudent("1");

    expect(student.name).toBe("Aluno Teste");
  });

  it("lança erro quando a API responde 500", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("falha", { status: 500 }));

    await expect(fetchStudent("1")).rejects.toThrow();
  });
});
```

## Armadilhas

- **`mockResolvedValue(new Response(...))`**: a mesma `Response` só pode ser lida uma vez; a
  segunda chamada quebra. Use `mockImplementation` criando a resposta a cada chamada.
- **Mock que vaza entre testes**: sem `vi.restoreAllMocks()` um teste contamina o outro.
- **`fetch` sem mock**: o teste bate na internet, fica lento e falha ao acaso.
- **Espera fixa (`setTimeout`)**: falha ao acaso em máquina lenta. Use relógio falso ou `waitFor`.
- **Snapshot atualizado às cegas**: `--update` sem olhar transforma o snapshot em lixo.
- **`JSON.stringify(error)`**: sai `{}`. Verifique `error.message`.
