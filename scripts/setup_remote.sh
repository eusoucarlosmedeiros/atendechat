#!/usr/bin/env bash
# =====================================================================
# scripts/setup_remote.sh — Aponta o repositorio na VPS para um novo origin
#
# Necessario UMA UNICA VEZ em cada VPS, antes do primeiro update.sh.
# O instalador original aponta para atendechat-org/codatendechat. Este
# script troca para o repo passado como parametro.
#
# Uso (na VPS, como root):
#   sudo bash setup_remote.sh <instancia> <git_url>
#
# Exemplo (com PAT):
#   sudo bash setup_remote.sh atendechat https://USER:TOKEN@github.com/USER/codatendechat.git
#
# Exemplo (publico):
#   sudo bash setup_remote.sh atendechat https://github.com/USER/codatendechat.git
# =====================================================================

set -e

INST="${1:-}"
NEW_URL="${2:-}"

if [ -z "$INST" ] || [ -z "$NEW_URL" ]; then
  echo "Uso: $0 <instancia> <git_url>"
  echo "Ex.: $0 atendechat https://github.com/USUARIO/REPO.git"
  exit 1
fi

REPO_DIR="/home/deploy/$INST"

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "ERRO: $REPO_DIR nao e um repositorio git"
  exit 2
fi

# Re-executa como deploy se chamado como root
if [ "$(id -un)" = "root" ]; then
  exec sudo -iu deploy bash "$(realpath "$0")" "$@"
fi

cd "$REPO_DIR"

echo "==> origin atual:"
git remote -v | grep origin || echo "(sem origin)"

echo ""
echo "==> Backup do origin atual:"
git remote get-url origin > .git/origin-old.txt 2>/dev/null && cat .git/origin-old.txt || echo "(nao havia origin)"

echo ""
echo "==> Trocando origin para: $NEW_URL"
git remote set-url origin "$NEW_URL"

echo ""
echo "==> Verificando novo origin:"
git remote -v | grep origin

echo ""
echo "==> Testando fetch (vai pedir credencial se URL for privada):"
git fetch --dry-run origin

echo ""
echo "OK. Origin atualizado. Agora pode rodar:"
echo "  sudo bash $REPO_DIR/scripts/update.sh $INST"
