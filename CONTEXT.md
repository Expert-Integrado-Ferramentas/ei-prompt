# Glossário

Os termos que o código, os prompts e as pessoas usam neste projeto.

| Termo | Significado |
| --- | --- |
| Cliente | Empresa de atendimento automatizado para a qual se cria uma pasta de agentes (por exemplo, `malu/`). Cada pasta de cliente é uma cópia customizada dos modelos |
| Lead | Pessoa que conversa com a IA do cliente e é qualificada, agendada ou encaminhada |
| Modelo | Cada template de agente em `modelo/`. É a base de todo cliente e não muda no fluxo distribuído |
| Repo-fonte | Este repositório, onde o mantenedor edita modelos, comandos e subagentes. O oposto é a pasta do cliente, que só recebe o que o CLI entrega |
| Orquestrador | Agente principal: responde ao lead, conduz a conversa e chama os outros. Nunca encerra nem transfere sozinho |
| Qualifier | Agente que valida o lead: qualificado, desqualificado ou informações insuficientes. Não encerra conversa |
| Scheduler | Agente que marca, remarca e cancela reuniões |
| Protractor | Único agente que encerra a sessão (`FINALIZAR_SESSAO`) e transfere para humano ou para outro agente |
| Follow-Up | Agente que escreve a mensagem para reengajar um lead parado; a resposta dele vai direto ao lead |
| FUP | Abreviação de follow-up. Lembretes e FUPs ficam fora do escopo do ajuste de prompt (`docs/proibido-fazer.md`) |
| Recepcionista | Agente opcional do cliente multi-agente: recebe o lead, identifica a intenção e transfere para o especialista. Não qualifica nem agenda |
| Single-agent | Cliente com uma frente só, atendida por um conjunto de agentes (Orquestrador, Qualifier, Scheduler, Protractor, Follow-Up) |
| Multi-agente | Cliente com duas ou mais frentes (por exemplo, Consumidor e Trabalhista): um Recepcionista na frente e um conjunto completo por especialidade |
| Especialista | Cada frente de um cliente multi-agente, com a sua pasta e o seu conjunto de agentes |
| Personificação | Regra do multi-agente: na transferência, o Recepcionista envia a primeira mensagem como se fosse o especialista, sem avisar o lead da troca |
| Casca XML | Envoltório `<agente xmlns="..." versao="1.0" tipo="...">` de raiz única que todo prompt carrega, para validar a boa-formação |
| `tipo` | Atributo da casca que identifica o prompt (`orchestrator`, `qualifier`, `protractor`, `scheduler`, `followup`) |
| `<conhecimento>` | Seção do prompt com o saber do cliente. Não recebe documento integral nem mídia por URL de página |
| Ação do `resume` | Palavra de comando no campo `resume` da resposta do agente, como `IR_PARA_AGENDAMENTO`, `ACIONAR_PROTRACTOR:FINALIZAR_SESSAO` ou `COLETAR:[campo]` |
| Ajuste | Alteração pontual num agente de cliente feita por `/ei-ajustes`: analisa, pede aprovação, edita e revisa |
| Fan-out | Despacho em paralelo de vários editores (ou revisores) numa mesma rodada de ajuste |
| Sentinela | Marcador que o pipeline escreve no transcript (`<ei-ajustes-round id=...>`) para os hooks saberem em que passo a rodada está |
| Manifest | `manifest.json`: a lista do que o CLI baixa para o cliente e do que ele apaga |
