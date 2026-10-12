#!/usr/bin/env bash
# Publica esta carpeta como repositorio en GitHub (para luego activar GitHub Pages).
# Uso:  bash deploy.sh <usuario-github> <nombre-repo> [ruta-de-esta-carpeta]
# Ej.:  bash deploy.sh falblambiz arbol-cuestionado
set -euo pipefail

USUARIO="${1:-}"
REPO="${2:-}"
ORIGEN="${3:-$(cd "$(dirname "$0")" && pwd)}"

if [[ -z "$USUARIO" || -z "$REPO" ]]; then
  echo "Uso: bash deploy.sh <usuario-github> <nombre-repo> [carpeta]" >&2
  exit 1
fi

cd "$ORIGEN"

if [[ ! -d .git ]]; then
  git init -q
  git branch -M main 2>/dev/null || true
fi

# .nojekyll evita que GitHub Pages procese los archivos con Jekyll
touch .nojekyll

git add -A
if git diff --cached --quiet; then
  echo "ℹ️  No hay cambios nuevos que commitear."
else
  git -c user.name="${GIT_AUTHOR_NAME:-$USUARIO}" -c user.email="${GIT_AUTHOR_EMAIL:-$USUARIO@users.noreply.github.com}" \
    commit -q -m "Árbol genealógico: app web + datos"
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "https://github.com/${USUARIO}/${REPO}.git"
fi

echo "➡️  Subiendo a https://github.com/${USUARIO}/${REPO} (rama main)…"
git push -u origin main

cat <<FIN

✅ Listo. Crea el repo en GitHub si aún no existe (vacío, sin README) y vuelve a correr:
   bash deploy.sh ${USUARIO} ${REPO}

Activa Pages en: https://github.com/${USUARIO}/${REPO}/settings/pages
   Source: Deploy from a branch · Branch: main · Folder: / (root) · Save

Tu web quedará en: https://${USUARIO}.github.io/${REPO}/
FIN
