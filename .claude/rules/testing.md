# Testes

Universal: carrega em toda conversa. Detalhes de escrita em `testing-unit` e `testing-e2e`.

## Convenções

### Teste primeiro
- Comportamento novo ou bug corrigido começa por um teste que falha.
- Rode o teste e veja ele falhar pelo motivo certo. Só então implemente.
- Bug corrigido: o teste reproduz o bug antes da correção. Assim ele não volta.
- O teste confere o requisito pedido (o que a pessoa precisa que aconteça), não detalhes internos.

### Suíte inteira depois de implementar
- Depois de implementar, rode a suíte **inteira**: o teste novo e todos os que já existiam.
  Teste novo passando com antigo quebrado é regressão.
- O comando de teste está em `testes.comando` em `.claude/expert-governanca.json`. Sem comando
  definido, a trava descobre pelo projeto: `npm test`, `deno test`, `cargo test` ou `pytest`,
  conforme o projeto.
- Antes de dizer "pronto", mostre o resultado: quantos passaram e quantos falharam.

### Nunca maquiar
- Nunca apague, pule (`.skip`, `.only`, `xit`) ou enfraqueça um teste para ele passar.
- Teste falhando é informação. Ou o código está errado, ou o requisito mudou. Se o requisito
  mudou, ajuste o teste e diga isso na mensagem do commit.
- Nunca mude a asserção para o valor que o código devolve sem confirmar que esse valor é o certo.

### Projeto sem testes
- Ao mexer numa área sem teste, crie uma suíte mínima para ela: o comportamento que você mudou
  e o caminho principal da área.
- Não é preciso cobrir o projeto inteiro de uma vez. Cada entrega deixa a área tocada coberta.
- Sem nenhuma estrutura de teste: proponha Vitest (TypeScript) e um script `test` no `package.json`.

## A trava de push

- `guard-testes-antes-do-push` roda a suíte inteira antes de cada push e só deixa seguir se passar.
- Projeto sem testes: avisa e oferece criar a suíte mínima. Não bloqueia.
- Linha de base: na instalação do harness, a suíte roda uma vez e o resultado fica em
  `testes.linhaDeBase` (`passando`, `falhando` ou `sem-testes`, com o número de falhas).
  Com `falhando`, falha no push pede confirmação em vez de bloquear.
- Só confirme o push se as falhas forem as mesmas da linha de base. Falha nova é regressão sua:
  corrija antes.
- Quando a suíte passa inteira, a linha de base vira `passando` e, dali em diante, falha bloqueia.
- Corrigir as falhas antigas é bem-vindo: uma por vez, cada uma em PR `fix:` ou `test:` próprio.

## Armadilhas

- **Rodar só o arquivo de teste novo**: não pega regressão. Suíte inteira antes do push.
- **Teste que passa de primeira**: se ele nunca falhou, talvez não teste nada. Faça falhar antes.
- **Teste preso à implementação**: quebra em toda refatoração. Teste o que a pessoa vê ou o que
  a função exportada devolve.
- **Dado real em teste**: proibido. Use dado inventado (ver `security`).
