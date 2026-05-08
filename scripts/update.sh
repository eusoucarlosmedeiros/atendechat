#!/usr/bin/env bash
# =====================================================================
# scripts/update.sh — atualiza uma instancia do Atendechat na VPS
#
# Uso (dentro da VPS):
#   curl -fsSL https://raw.githubusercontent.com/USUARIO/REPO/main/scripts/update.sh | sudo bash -s -- atendechat
#
# Ou se ja clonado:
#   sudo bash /home/deploy/atendechat/scripts/update.sh atendechat
#
# Acoes:
#   1. Backup com timestamp do package.json/package-lock.json/dist
#   2. git pull --rebase
#   3. npm install (drop @whiskeysockets/baileys, instala baileys)
#   4. rm -rf dist && npm run build
#   5. npx sequelize db:migrate (continua mesmo se nada para migrar)
#   6. pm2 restart $INST-backend (auto-detecta nome se nao bater)
#   7. mostra logs
#
# Rollback:
#   sudo bash /home/deploy/atendechat/scripts/update.sh atendechat --rollback YYYYMMDD-HHMMSS
# =====================================================================

set -e

INST="${1:-}"
MODE="${2:-}"
TS_ROLLBACK="${3:-}"

if [ -z "$INST" ]; then
  echo "Uso: $0 <instancia> [--rollback <timestamp>]"
  exit 1
fi

REPO_DIR="/home/deploy/$INST"
BACKEND_DIR="$REPO_DIR/backend"

if [ ! -d "$BACKEND_DIR" ]; then
  echo "ERRO: $BACKEND_DIR nao existe"
  echo "Pastas em /home/deploy/:"
  ls /home/deploy/ 2>/dev/null || true
  exit 2
fi

# Re-executa como deploy se chamado como root
if [ "$(id -un)" = "root" ]; then
  echo "==> re-executando como usuario deploy"
  exec sudo -iu deploy bash "$(realpath "$0")" "$@"
fi

# ---------------------------------------------------------------------
# Detecta nome do processo PM2 backend
# ---------------------------------------------------------------------
detect_pm2_backend() {
  local default="$INST-backend"
  if pm2 describe "$default" >/dev/null 2>&1; then
    echo "$default"
    return
  fi
  local detected
  detected=$(pm2 jlist 2>/dev/null \
    | grep -oE '"name":"[^"]*backend[^"]*"' \
    | head -1 \
    | sed 's/.*"name":"\([^"]*\)".*/\1/')
  if [ -n "$detected" ]; then
    echo "$detected"
  else
    echo "$default"
  fi
}

PM2_BACKEND=$(detect_pm2_backend)
echo "==> Processo PM2 alvo: $PM2_BACKEND"

# ---------------------------------------------------------------------
# Modo rollback
# ---------------------------------------------------------------------
if [ "$MODE" = "--rollback" ]; then
  if [ -z "$TS_ROLLBACK" ]; then
    echo "ERRO: --rollback requer timestamp (ex: 20260508-153000)"
    exit 4
  fi

  echo "==> ROLLBACK para $TS_ROLLBACK"
  cd "$BACKEND_DIR"

  if [ ! -f "package.json.bkp.$TS_ROLLBACK" ]; then
    echo "ERRO: backup package.json.bkp.$TS_ROLLBACK nao encontrado"
    ls -la *.bkp.* 2>/dev/null | head
    exit 5
  fi

  cp "package.json.bkp.$TS_ROLLBACK" package.json
  [ -f "package-lock.json.bkp.$TS_ROLLBACK" ] && cp "package-lock.json.bkp.$TS_ROLLBACK" package-lock.json
  if [ -d "dist.bkp.$TS_ROLLBACK" ]; then
    rm -rf dist
    cp -r "dist.bkp.$TS_ROLLBACK" dist
  fi

  npm install --legacy-peer-deps --no-audit --no-fund
  pm2 restart "$PM2_BACKEND"
  sleep 3
  pm2 logs "$PM2_BACKEND" --lines 40 --nostream
  echo "==> ROLLBACK concluido"
  exit 0
fi

# ---------------------------------------------------------------------
# Deploy normal
# ---------------------------------------------------------------------
cd "$BACKEND_DIR"

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "ERRO: $REPO_DIR nao e um repositorio git. Clone via instalador antes."
  exit 6
fi

# 1) BACKUP
TS=$(date +%Y%m%d-%H%M%S)
echo "==> Backup com timestamp $TS"
cp package.json "package.json.bkp.$TS"
[ -f package-lock.json ] && cp package-lock.json "package-lock.json.bkp.$TS"
[ -d dist ] && cp -r dist "dist.bkp.$TS"
echo "BACKUP_TS=$TS"

# 2) GIT SYNC (forca igualar a main; ignora alteracoes locais — package-lock,
#    node_modules etc nao sao rastreados, entao nada importante e perdido)
echo "==> git sync (forca alinhar com origin/main)"
cd "$REPO_DIR"
SHA_BEFORE=$(git rev-parse HEAD 2>/dev/null || echo "")
git fetch --all --prune
git reset --hard origin/main
SHA_AFTER=$(git rev-parse HEAD)
echo "SHA: $SHA_BEFORE -> $SHA_AFTER"

# Detecta se houve mudanca no frontend para rebuildar tambem.
FRONTEND_CHANGED="no"
if [ -n "$SHA_BEFORE" ] && [ "$SHA_BEFORE" != "$SHA_AFTER" ]; then
  if git diff --name-only "$SHA_BEFORE..$SHA_AFTER" | grep -q "^frontend/"; then
    FRONTEND_CHANGED="yes"
  fi
fi
echo "Frontend changed: $FRONTEND_CHANGED"

# 3) INSTALL BACKEND
echo "==> Backend: dependencias"
cd "$BACKEND_DIR"
# Remove pacote antigo (se ainda estiver no node_modules) — ignora erro se nao existir
npm uninstall @whiskeysockets/baileys --no-audit --no-fund 2>/dev/null || true
npm install --legacy-peer-deps --no-audit --no-fund

# 4) BUILD BACKEND
echo "==> Backend: build"
rm -rf dist
npm run build

if [ ! -f dist/server.js ] || [ ! -f dist/libs/uazapi.js ]; then
  echo "ERRO: build nao gerou arquivos esperados em dist/"
  echo "Verificando dist/:"
  ls dist/ 2>&1 | head -20
  exit 7
fi

# 5) MIGRATIONS (nao-bloqueantes — se nada para migrar, continua)
echo "==> Backend: db:migrate"
npx sequelize db:migrate || echo "(migrate sem mudancas ou ja aplicadas)"

# 6) RESTART BACKEND
echo "==> Restart PM2: $PM2_BACKEND"
pm2 restart "$PM2_BACKEND"
sleep 3
pm2 save || true

# 7) FRONTEND (rebuild + restart somente se houve mudanca em frontend/)
FRONTEND_DIR="$REPO_DIR/frontend"
if [ "$FRONTEND_CHANGED" = "yes" ] && [ -d "$FRONTEND_DIR" ]; then
  echo "==> Frontend: dependencias"
  cd "$FRONTEND_DIR"
  npm install --legacy-peer-deps --no-audit --no-fund

  echo "==> Frontend: build"
  rm -rf build
  npm run build

  if [ ! -d build/static ]; then
    echo "AVISO: build do frontend pode nao ter gerado bundle (sem build/static/)"
  fi

  echo "==> Restart PM2: $INST-frontend"
  pm2 restart "$INST-frontend" || pm2 restart atendechat-frontend || true
  pm2 save || true
else
  echo "==> Frontend: sem mudancas, skip rebuild"
fi

# 8) LOGS
echo ""
echo "==> Logs (ultimas 60 linhas):"
pm2 logs "$PM2_BACKEND" --lines 60 --nostream

echo ""
echo "============================================================"
echo " DEPLOY CONCLUIDO — instancia $INST"
echo " BACKUP_TS=$TS"
echo "============================================================"
echo "Para rollback:"
echo "  sudo bash $REPO_DIR/scripts/update.sh $INST --rollback $TS"
echo ""
