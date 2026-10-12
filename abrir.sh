#!/usr/bin/env bash
# Levanta un servidor local para probar la app (necesario para que lea data.json).
set -euo pipefail
cd "$(dirname "$0")"
PUERTO="${1:-8000}"
echo "🌳 Abriendo http://localhost:${PUERTO}  (Ctrl+C para parar)"
python3 -m http.server "$PUERTO"
