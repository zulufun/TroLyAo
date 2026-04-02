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

printf '[ollama-init] verifying both models are available in Ollama...\n'
attempt=1
max_attempts=60
while [ $attempt -le $max_attempts ]; do
  tags=$(ollama list 2>/dev/null || echo "")
  chat_ready=$(echo "$tags" | grep -q "^$(echo "$OLLAMA_CHAT_MODEL" | cut -d: -f1)" && echo "yes" || echo "no")
  embed_ready=$(echo "$tags" | grep -q "^$(echo "$OLLAMA_EMBED_MODEL" | cut -d: -f1)" && echo "yes" || echo "no")
  
  if [ "$chat_ready" = "yes" ] && [ "$embed_ready" = "yes" ]; then
    printf '[ollama-init] both models verified ready\n'
    exit 0
  fi
  
  printf '[ollama-init] models not yet visible, retry #%s (chat=%s, embed=%s)\n' "$attempt" "$chat_ready" "$embed_ready"
  attempt=$((attempt + 1))
  sleep 5
done

printf '[ollama-init] warning: timeout waiting for models to be visible, proceeding anyway\n'
exit 0
