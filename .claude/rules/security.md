# Segurança

Universal: carrega em toda conversa. A trava `guard-segredos` confere cada commit: bloqueia
arquivo `.env`, chave privada e token de API; pede confirmação quando vê formato de CPF ou telefone
ou um nome de credencial (`API_KEY`, `SECRET`, `SENHA`) recebendo valor literal.

## Convenções

### Segredos
- Nunca escreva segredo em arquivo versionado (`.ts`, `.json`, `.toml`, `.md`, teste, fixture).
- Segredo de execução vem de variável de ambiente: `env.API_TOKEN` no Worker, `process.env.API_TOKEN` no Node,
  `Deno.env.get("API_TOKEN")` no Deno.
- Na Cloudflare, segredo real só por `wrangler secret put API_TOKEN`. O bloco `vars` do
  `wrangler.jsonc`/`wrangler.toml` é público: só URL base, flag e ID público.
- `.env*`, `.dev.vars` e `.local.*` sempre no `.gitignore`.
- Segredo novo: documente o nome, sem valor, em `.env.example` ou `.dev.vars.example`.
- Chave ou token colado em conversa, log ou commit está vazado: troque (revogue e gere outro).

### Dado pessoal (alunos, clientes, participantes)
- Nome, telefone, e-mail, CPF, endereço ou conversa de pessoa real nunca entram em código, fixture,
  teste, log, commit, issue ou documentação.
- Teste e exemplo usam dado inventado: `aluno@exemplo.com`, `(11) 90000-0000`, CPF `000.000.000-00`
  (um CPF "gerado para teste" é válido e faz a trava pedir confirmação).
- Exportação, planilha ou transcrição com dado real fica fora do repositório (armazenamento da
  empresa com acesso controlado).
- Pasta publicada (site estático, build) não pode conter arquivo com dado real. Confira o que vai
  no pacote antes de publicar.

### Erros sem vazamento
- Nunca devolva `error.message` cru ou `error.stack` ao cliente. Mensagem genérica para fora
  ("Falha ao processar o pedido"), detalhe só no log interno.
- Corpo de erro de serviço externo: corte em ~500 caracteres antes de logar (pode conter token).

### Entrada validada na borda
- Toda entrada externa (body, query, header, webhook, argumento de ferramenta MCP) é validada com
  Zod antes de ser usada: `Schema.parse(...)` na entrada da rota.
- Limites realistas: `limit` com máximo, ID com formato, data com formato, tamanho de texto.
- Nunca confie em header de identidade sem verificar (`X-User-Id` sem token = qualquer um vira
  qualquer um).

### Autenticação e autorização
- Autenticação é "quem é você": confira assinatura e validade do token, não só a presença.
- Autorização é "o que você pode fazer": confira papel e dono do recurso em cada rota.
  Estar logado não basta.
- O cliente (empresa, conta) de cada usuário vem da sessão, nunca do que o navegador mandou.
- Atrás do Cloudflare Access, o Worker também verifica o token `cf-access-jwt-assertion`.
- `redirect_uri` de OAuth em lista explícita, sem curinga.

### Injeção
- SQL: consulta parametrizada (`db.prepare("... WHERE id = ?").bind(id)`), nunca texto concatenado.
- Caminho de arquivo vindo do usuário: rejeite `../`; use lista de nomes permitidos.
- Comando de sistema: argumentos em lista (`spawn("git", ["log", branch])`), nunca texto montado.
- HTML: nunca injete texto do usuário em HTML cru. Se precisar, sanitize (DOMPurify).

### Rede
- CORS com lista de origens permitidas. Nada de `*` em rota com credencial.
- Limite de requisições em login, cadastro e rota cara.
- Toda chamada externa com timeout: `fetch(url, { signal: AbortSignal.timeout(10_000) })`.
- Limite de tamanho em rota que recebe arquivo.

### Dependências
- `npm audit --omit=dev --audit-level=high` antes de publicar (é o que bloqueia no CI dos templates); vulnerabilidade alta ou crítica em dependência de produção bloqueia; moderada aparece como
  aviso e entra na próxima manutenção.
- Dependência nova: confira origem, autor, última versão e uso. Prefira o recurso nativo
  (`fetch`, `crypto`, `Intl`, `URL`).
- Atualização de versão maior: nunca automática. PR próprio com teste.

## Exemplos

```typescript
// Validação na borda + erro sem vazamento
const CreateStudentInput = z.object({ email: z.string().email(), age: z.number().int().min(0).max(120) });

app.post("/api/students", async (c) => {
  const parsed = CreateStudentInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Dados inválidos" }, 400);
  try {
    return c.json(await createStudent(parsed.data), 201);
  } catch (error) {
    console.error(JSON.stringify({ op: "createStudent", level: "error",
      message: error instanceof Error ? error.message : String(error) }));
    return c.json({ error: "Falha ao cadastrar" }, 500);
  }
});
```

## Armadilhas

- **Segredo em `vars` do wrangler**: vai para o pacote publicado. Use `wrangler secret put`.
- **CPF ou telefone "de teste" copiado de planilha real**: é dado pessoal. Use `000.000.000-00` e
  `(11) 90000-0000`.
- **`console.log(env)` ou `console.log(request)`**: vaza todos os segredos e cabeçalhos no log.
- **Chave de serviço no navegador** (Supabase `service_role` ou `sb_secret_...`): dá acesso total
  ao banco para qualquer visitante. Só no servidor.
- **Publicar a pasta inteira** num site estático: leva junto JSON, planilha e `.env`. Publique só
  a pasta de build.
