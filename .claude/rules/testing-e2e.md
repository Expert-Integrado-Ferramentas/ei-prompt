---
paths:
  - "e2e/**/*.ts"
  - "tests/e2e/**/*.ts"
  - "**/*.e2e.spec.ts"
  - "playwright.config.*"
---

# Testes ponta a ponta (Playwright)

Carrega ao mexer em teste ponta a ponta ou na configuração do Playwright. O objetivo é testar
a tela como a pessoa usa.

## Convenções

### Estrutura
- Um arquivo por jornada, com nome em inglês: `tests/e2e/<journey>.spec.ts` (`login.spec.ts`,
  `signup.spec.ts`, `checkout.spec.ts`).
- Page objects em `tests/e2e/pages/<page>.page.ts` (`login.page.ts`): guardam seletores e ações da página.
- Estado de login em `tests/.auth/<papel>.json`, gerado uma vez no setup global e fora do git.

### Cobertura por jornada
- Teste as jornadas que dão dinheiro ou que, se quebrarem, param o uso: entrar, cadastrar,
  pagar, criar e editar o recurso principal.
- Não repita em ponta a ponta o que o teste de unidade já cobre. Ponta a ponta é caro.

### Seletores, nesta ordem
1. `getByRole("button", { name: /entrar/i })`
2. `getByLabel(/e-mail/i)`
3. `getByText(/bem-vindo/i)`
4. `getByTestId("avatar")`, só quando os anteriores não servem.
5. Seletor CSS, último recurso.

### Page object
- Métodos são ações da pessoa (`login(email, password)`), não cliques técnicos.
- A espera fica dentro do page object; o teste não chama `waitFor` direto.

### Dados
- Usuário e dados de teste inventados, nunca reais. Credencial de teste vem de variável de
  ambiente (`E2E_EMAIL`, `E2E_PASSWORD`), nunca escrita no código.
- Dado criado no teste é apagado no fim, ou o teste usa banco descartável.

### Configuração
- `trace: "retain-on-failure"` e `screenshot: "only-on-failure"`.
- `retries: 0` na máquina local, para não esconder teste instável.

## Exemplos

```typescript
// tests/e2e/pages/login.page.ts
export class LoginPage {
  constructor(private readonly page: Page) {}
  async goto() { await this.page.goto("/login"); }
  async login(email: string, password: string) {
    await this.page.getByLabel(/e-mail/i).fill(email);
    await this.page.getByLabel(/senha/i).fill(password);
    await this.page.getByRole("button", { name: /entrar/i }).click();
  }
}

// tests/e2e/login.spec.ts
test("pessoa com senha certa chega ao painel", async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();

  await loginPage.login(process.env.E2E_EMAIL!, process.env.E2E_PASSWORD!);

  await expect(page.getByRole("heading", { name: /painel/i })).toBeVisible();
});
```

## Armadilhas

- **Seletor por classe CSS**: quebra no primeiro ajuste visual. Use papel e rótulo.
- **`waitForTimeout(2000)`**: instável. Espere por algo concreto (`toBeVisible`, `waitForResponse`).
- **Login real em cada teste**: lento. Use o estado salvo no setup global.
- **Teste escrevendo em banco compartilhado**: dois testes ao mesmo tempo colidem. Use dados
  com prefixo único ou banco descartável.
