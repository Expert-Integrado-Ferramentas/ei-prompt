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

# Arquitetura

Carrega ao mexer em código da aplicação. Complementa `code-quality` (tamanho, nomes) e
`security` (validação na borda).

## As quatro ideias

1. **Rota fina.** A rota só recebe, chama uma função e devolve. A regra de negócio fica fora dela,
   para poder ser testada e reaproveitada.
2. **Tradução na borda.** O JSON de um terceiro (CRM, gateway de pagamento, API externa) vira um
   tipo interno num único arquivo. Se o terceiro mudar, muda um arquivo, não o projeto.
3. **Módulos profundos.** Poucos arquivos, cada um fazendo bastante atrás de uma interface simples.
   Nada de dezenas de arquivos de 10 linhas que só repassam a chamada.
4. **Sofisticação só onde há dinheiro ou autenticação.** No resto, simples: rota fina e funções puras.

## Convenções

### Rota fina
- A rota faz três coisas: valida a entrada → chama uma função de negócio → formata a resposta.
- Um `if` de regra de negócio dentro da rota é sinal para extrair a lógica.

### Tradução na borda
- Cada integração tem sua pasta (`src/integrations/<service>/`) com o cliente e a tradução.
- O formato do terceiro nunca passa da borda. O resto do código só vê o tipo interno.
- Tipo do negócio, linha do banco e formato do terceiro são coisas diferentes. Não misture.

### Módulos profundos
- Interface é tudo o que quem chama precisa saber: parâmetros, ordem de chamada, erros,
  configuração. Quanto menor, melhor.
- **Teste da exclusão**: imagine apagar o módulo. Se a complexidade some junto, ele só repassava
  (remova). Se ela reaparece espalhada em vários lugares, ele se paga.
- Uma implementação só não justifica uma camada de abstração. Duas, sim.
- Quem chama e o teste usam a mesma interface. Se o teste precisa furar a interface, o módulo
  está no formato errado.

### Onde vale modelar mais
- Valor com regra (`Email`, `Money`, `StudentId`) vira tipo próprio só quando há regra a
  proteger.
- Regra de várias etapas com invariante (saldo, estoque, cobrança) fica junto dos dados que ela
  protege, não espalhada em serviços.

## Armadilhas

- **Esqueleto especulativo**: criar `domain/application/infrastructure` num projeto simples.
  Nunca crie camada sem lógica que a justifique.
- **Formato do terceiro vazando**: usar o JSON cru da API externa no meio do código acopla tudo
  ao formato deles.
- **Serviço vazio**: extrair uma camada "service" para um CRUD de um passo só adiciona arquivo
  sem proteger nada.
- **"Profundo" como desculpa para arquivo gigante**: profundidade se mede na interface. O limite
  de ~300 linhas por arquivo continua valendo.
