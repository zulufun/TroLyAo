#!/bin/sh
set -eu

: "${OLLAMA_HOST:=http://ollama:11434}"
: "${OLLAMA_CHAT_MODEL:=qwen2.5:1.5b-instruct-q4_K_M}"
: "${OLLAMA_EMBED_MODEL:=bge-m3}"

export OLLAMA_HOST

printf '\n[ollama-init] waiting for Ollama at %s\n' "$OLLAMA_HOST"

attempt=1
until ollama list >/dev/null 2>&1; do
  printf '[ollama-init] Ollama not ready yet, retry #%s\n' "$attempt"
  attempt=$((attempt + 1))
  sleep 5
done

printf '[ollama-init] Ollama is reachable\n'
printf '[ollama-init] pulling chat model: %s\n' "$OLLAMA_CHAT_MODEL"
ollama pull "$OLLAMA_CHAT_MODEL"

printf '[ollama-init] pulling embedding model: %s\n' "$OLLAMA_EMBED_MODEL"
ollama pull "$OLLAMA_EMBED_MODEL"

printf '[ollama-init] model pull complete\n'
