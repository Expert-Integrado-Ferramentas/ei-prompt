---
paths:
  - "supabase/migrations/**"
  - "supabase/**/*.sql"
---

# Supabase

Carrega ao mexer em migration ou SQL do Supabase. O Supabase expõe o banco direto para o
navegador pela API. A única proteção entre um visitante e os dados é a RLS.

## Convenções

### RLS em toda tabela exposta
- Toda tabela num schema exposto pela API (`public` e os listados em `[api] schemas` do
  `supabase/config.toml`) tem RLS ligada **e** pelo menos uma política.
- A mesma migration que cria a tabela liga a RLS e cria as políticas. Nunca "depois".
- Política por operação (`select`, `insert`, `update`, `delete`) e por papel (`authenticated`,
  `anon`). Escreva o motivo num comentário quando não for óbvio.
- Política de dono usa `(select auth.uid())`, não o que o cliente mandou.
- Tabela que só o servidor usa: mova para um schema não exposto ou crie política explícita que
  nega (`using (false)`), com comentário do porquê.

### Chaves
- Chave `service_role` ou `sb_secret_...` nunca em código que roda no navegador, nem em variável
  com prefixo público (`VITE_`, `NEXT_PUBLIC_`, `PUBLIC_`).
- No navegador, só a chave pública (`anon` ou `sb_publishable_...`), sempre com RLS por trás.

### Migrations
- Toda mudança de banco é uma migration versionada em `supabase/migrations/`. Nada de alterar
  tabela pelo painel.
- Migration aditiva: crie coluna, tabela ou índice novo. Para remover ou renomear, faça em duas
  entregas (primeiro o código para de usar, depois a migration remove).
- Teste local antes: `supabase db reset` (recria o banco local com todas as migrations) e rode
  a suíte de testes.
- Nunca edite migration já aplicada em produção. Crie outra.

## Checagem de RLS

Rode antes de abrir o PR e antes de cada deploy (a skill `publicando` faz isso). O resultado
esperado é **nenhuma linha**. Inclua no `in (...)` todos os schemas expostos.

```sql
select t.schemaname as schema,
       t.tablename  as table_name,
       t.rowsecurity as rls_enabled,
       count(p.policyname) as policy_count
from pg_tables t
left join pg_policies p
  on p.schemaname = t.schemaname and p.tablename = t.tablename
where t.schemaname in ('public')
group by t.schemaname, t.tablename, t.rowsecurity
having not t.rowsecurity or count(p.policyname) = 0
order by 1, 2;
```

Local: `supabase db reset` e depois `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
com o SQL acima. Produção: SQL Editor do painel, ou `psql` com a string de conexão que a pessoa
coloca numa variável de ambiente no próprio terminal.

## Exemplos

```sql
create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users (id),
  course text not null,
  created_at timestamptz not null default now()
);

alter table public.enrollments enable row level security;

create policy "aluno vê as próprias matrículas"
  on public.enrollments for select to authenticated
  using ((select auth.uid()) = student_id);
```

## Armadilhas

- **RLS ligada sem política**: ninguém de fora acessa, o que parece seguro, mas costuma levar
  alguém a usar a chave de serviço no navegador "para funcionar". Crie a política certa.
- **View no schema exposto**: por padrão ignora a RLS da tabela. Use
  `with (security_invoker = true)` ou deixe a view fora do schema exposto.
- **Função `security definer` no schema exposto**: qualquer um chama pela API com poderes de
  dono. Coloque em schema não exposto ou confira permissão dentro dela.
- **Política `using (true)` para `anon`**: libera a tabela inteira para a internet.
- **Arquivos no Storage**: bucket também precisa de política em `storage.objects`.
