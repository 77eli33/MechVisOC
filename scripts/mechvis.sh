#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/src/frontend"
VENV_DIR="$REPO_ROOT/.venv"
VENV_PYTHON="$VENV_DIR/bin/python"

say() {
  printf '\nMechVis · %s\n' "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'MechVis needs %s, but it is not installed or not on PATH.\n' "$1" >&2
    exit 1
  fi
}

prepare_dependencies() {
  require_command python3
  require_command npm
  require_command curl

  if [[ ! -x "$VENV_PYTHON" ]]; then
    say "Creating the Python environment"
    python3 -m venv "$VENV_DIR"
  fi

  if ! "$VENV_PYTHON" -c "import fastapi, uvicorn, pytest, rdkit" >/dev/null 2>&1; then
    say "Installing backend dependencies"
    "$VENV_PYTHON" -m pip install -r "$REPO_ROOT/src/backend/requirements-dev.txt"
  fi

  if [[ ! -x "$FRONTEND_DIR/node_modules/.bin/vite" ]]; then
    say "Installing frontend dependencies"
    npm install --prefix "$FRONTEND_DIR"
  fi
}

start_app() {
  prepare_dependencies

  local backend_pid=""
  cleanup() {
    if [[ -n "$backend_pid" ]] && kill -0 "$backend_pid" >/dev/null 2>&1; then
      kill "$backend_pid" >/dev/null 2>&1 || true
      wait "$backend_pid" 2>/dev/null || true
    fi
  }
  trap cleanup EXIT INT TERM

  say "Starting the backend"
  "$VENV_PYTHON" -m uvicorn src.backend.main:app \
    --app-dir "$REPO_ROOT" \
    --host 127.0.0.1 \
    --port 8000 \
    --reload &
  backend_pid=$!

  local backend_ready="false"
  for _ in {1..40}; do
    if curl --fail --silent http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
      backend_ready="true"
      break
    fi
    if ! kill -0 "$backend_pid" >/dev/null 2>&1; then
      printf 'The backend could not start. Port 8000 may already be in use.\n' >&2
      exit 1
    fi
    sleep 0.1
  done

  if [[ "$backend_ready" != "true" ]]; then
    printf 'The backend did not become ready at http://127.0.0.1:8000.\n' >&2
    exit 1
  fi

  say "Starting the app — stop it with Ctrl+C"
  if [[ "${1:-}" == "--open" ]]; then
    npm run dev --prefix "$FRONTEND_DIR" -- --open
  else
    npm run dev --prefix "$FRONTEND_DIR"
  fi
}

run_checks() {
  prepare_dependencies
  say "Running backend tests"
  "$VENV_PYTHON" -m pytest "$REPO_ROOT/tests/backend" -q
  say "Building the frontend"
  npm run build --prefix "$FRONTEND_DIR"
  say "All checks passed"
}

case "${1:-start}" in
  start)
    start_app "${2:-}"
    ;;
  check)
    run_checks
    ;;
  *)
    printf 'Usage: %s [start [--open] | check]\n' "$0" >&2
    exit 2
    ;;
esac
