---
name: preparando-vps
description: Conduz, passo a passo, a preparação de uma VPS da Hostinger (Ubuntu 24.04) no padrão seguro da Expert, reaproveitando os módulos de segurança, backup e monitoramento do repositório privado vps-inteligente. Use quando a pessoa pedir "prepara a VPS", "configura o servidor", "deixa a VPS segura", ou quando a skill publicando precisar de uma VPS que ainda não está no padrão.
---

# Preparando uma VPS

Avise no início: "Vou preparar a VPS em 12 passos. Em nenhum momento cole chave, senha ou token
aqui no chat: quando for preciso, eu peço para você digitar no seu próprio terminal."

VPS só quando a Cloudflare não atende (processo sempre ligado, binário que não roda em Worker,
tarefa acima dos limites). Confirme isso com a pessoa antes (`stack/vps-hostinger.md` da metodologia).

Módulos reaproveitados: repositório privado `Expert-Integrado-Ferramentas/vps-inteligente`,
pastas `seguranca/`, `backup/` e `observabilidade/`. A parte de agentes e Telegram dele **não**
entra. Leia o `README.md` de cada módulo antes de usar.

## Regras durante todo o roteiro

- Segredo (chave privada, senha, token, senha do backup) é digitado ou colado pela pessoa no
  terminal dela, fora do Claude. Nunca peça no chat; se aparecer no chat, trate como vazado e troque.
- Chave **pública** pode ser mostrada e passada nos comandos.
- Nunca feche um acesso antes de provar o novo por um segundo terminal.
- O `ufw limit` descarta quem abre mais de 6 conexões SSH em 30 s. Junte os comandos numa sessão
  só ou espere 30 s entre rajadas. Bloqueado: espere 1 minuto sem tentar.

## Procedimento

1. **Contratar a VPS e ligar o firewall do painel.** Na Hostinger, Ubuntu 24.04. No firewall do
   painel, libere só a porta do SSH (22) na entrada. São duas camadas: painel e `ufw`.
   Depois, leve os módulos para a VPS, a partir da máquina da pessoa:
   ```bash
   gh repo clone Expert-Integrado-Ferramentas/vps-inteligente "$TMPDIR/vps-inteligente" -- --depth 1
   rsync -a "$TMPDIR/vps-inteligente/" root@<ip>:/opt/vps-inteligente/
   ```
   Nenhum token do GitHub vai para a VPS.

2. **Administrador com chave e prova de acesso.** Se a pessoa não tem chave SSH, ela gera no
   terminal dela (`ssh-keygen -t ed25519`). Depois, na VPS:
   ```bash
   sudo /opt/vps-inteligente/seguranca/hardening.sh --so admin --chave-publica "<chave pública>"
   sudo /opt/vps-inteligente/seguranca/hardening.sh --so prova-acesso
   ```
   A prova pede que a pessoa abra **outro terminal**, entre como o admin e rode
   `sudo /opt/vps-inteligente/bin/provar-acesso.sh`. Só siga quando o código bater.

3. **Endurecer o SSH.** `sudo .../hardening.sh --so sshd`: root e senha desligados, só chave,
   poucas tentativas. Se a nova conexão não for confirmada, tudo volta sozinho em 10 minutos.
   Confirme abrindo uma nova conexão como admin.

4. **Firewall:** `--so ufw` (nega entrada, libera saída, limita tentativas no SSH).

5. **fail2ban:** `--so fail2ban` (bane por 1 hora quem erra 4 vezes em 10 minutos).

6. **Atualizações automáticas:** `--so upgrades` (segurança automática, reinício às 04:30, depois
   do backup).

7. **Docker:** `--so docker`. Portas publicadas só em `127.0.0.1` (o Docker fura o firewall se
   publicar para fora), log com rotação. Todo `ports:` dos compose no formato `127.0.0.1:porta:porta`
   e contêiner com `user:` que não seja root.

8. **Cloudflare Tunnel como única entrada.** Crie o túnel no painel Cloudflare Zero Trust
   (Networks → Tunnels), aponte cada hostname para `http://127.0.0.1:<porta>` e instale o conector.
   O comando com o token (`sudo cloudflared service install <token>`) a pessoa cola no terminal
   dela, conectado à VPS. Nenhuma porta de aplicação fica aberta na internet.

9. **Painéis atrás do Cloudflare Access.** Portainer, Uptime Kuma e similares só por hostname do
    túnel com uma aplicação do Cloudflare Access (login da empresa) na frente. Sem Access,
    acesso só por túnel SSH (`ssh -N -L 3001:127.0.0.1:3001 <admin>@<ip>`).

10. **Backup cifrado no R2 com teste de restauração.** Use `backup/` (restic cifrado, R2 da conta
    da empresa, timers diários e restauração de teste todo mês). Credenciais em
    `/etc/vps-inteligente/restic.env` (permissão `600`, só root), preenchido pela pessoa ou pelo
    `r2-provisionar.sh`. A senha do backup fica também fora da VPS, no cofre da empresa: sem ela o
    backup não volta. Rode um backup e uma restauração de teste agora e mostre o resultado.

11. **Aviso de fora.** Heartbeat a cada 5 minutos para um serviço fora da VPS (`observabilidade/`:
    Worker de heartbeat na Cloudflare da empresa ou healthchecks.io). Configure o alerta para o
    celular de quem responde pela VPS e teste: pare o heartbeat e confirme que o alerta chega.

12. **Checagem final:** `sudo /opt/vps-inteligente/seguranca/hardening.sh --checar`. Tem que
    passar inteiro. Item reprovado: mostre o `como_corrigir` e resolva antes de encerrar.

## Relatório

Tabela dos 12 passos com ok ou pendente, o que ficou com a pessoa (guardar a chave privada e a
senha do backup no cofre, firewall do painel) e o resultado do `--checar`. Registre no projeto
que usa a VPS, em `docs/runbooks/vps.md`: IP, usuário admin, serviços e como voltar um backup.
Nada de senha ou token nesse arquivo.
