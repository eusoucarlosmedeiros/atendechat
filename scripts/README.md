# Scripts de Deploy — Atendechat

Scripts para **atualizar uma instancia ja instalada** via `git pull` + rebuild + pm2 restart.

## Pre-requisito: o repositorio na VPS deve apontar para este fork/repo

O instalador original aponta para `atendechat-org/codatendechat`. Para que o `update.sh` puxe **suas alteracoes**, o `origin` na VPS precisa apontar para este repo.

**Faca uma vez por VPS:**

```bash
# Como root, na VPS
sudo bash /home/deploy/atendechat/scripts/setup_remote.sh atendechat https://github.com/USUARIO/REPO.git
```

> Se o repo for privado, use `https://USUARIO:TOKEN@github.com/USUARIO/REPO.git`. Crie o token em **GitHub → Settings → Developer settings → Personal access tokens (classic)** com escopo `repo`.

## Update normal (toda vez que quiser publicar uma mudanca)

### Opcao 1 — direto da web (mais facil):

```bash
curl -fsSL https://raw.githubusercontent.com/USUARIO/REPO/main/scripts/update.sh \
  | sudo bash -s -- atendechat
```

### Opcao 2 — via arquivo local (depois do primeiro `git pull`):

```bash
sudo bash /home/deploy/atendechat/scripts/update.sh atendechat
```

## O que o update.sh faz

1. **Backup** com timestamp de `package.json`, `package-lock.json` e `dist/`
2. `git pull --rebase` no `/home/deploy/<instancia>/`
3. `npm uninstall @whiskeysockets/baileys` (limpa pacote antigo)
4. `npm install --legacy-peer-deps`
5. `rm -rf dist && npm run build`
6. `npx sequelize db:migrate` (continua mesmo se nada para migrar)
7. `pm2 restart <instancia>-backend` (auto-detecta nome se nao bater)
8. Mostra os ultimos 60 logs

## Rollback (se quebrar)

```bash
# Pegue o BACKUP_TS que aparece no log do update
sudo bash /home/deploy/atendechat/scripts/update.sh atendechat --rollback YYYYMMDD-HHMMSS
```

Restaura `package.json`, `dist/` e reinstala deps. **Nao reverte commit do git** — apenas o codigo compilado.

## Multiplas instancias

Cada instancia tem seu proprio diretorio em `/home/deploy/<nome>/`. Rode o update individualmente para cada uma:

```bash
sudo bash /home/deploy/atendechat/scripts/update.sh atendechat
sudo bash /home/deploy/clienteX/scripts/update.sh clienteX
```
