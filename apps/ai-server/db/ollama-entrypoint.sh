#!/bin/sh
# ollama 容器入口：启动 ollama serve 后自动拉取 OLLAMA_MODELS 里列出的模型
# （见 openspec/changes/ai-assistant design.md 决策 14）。拉取是幂等的——已存在的
# 模型会快速跳过，所以容器每次重启都会先 serve、再确保模型就位。
set -e

ollama serve &
SERVER_PID=$!

# 等 ollama 就绪（给 serve 一个启动窗口；模型拉取本身也会自动排队）
sleep 5

for model in ${OLLAMA_MODELS}; do
  echo "[ollama] pulling model: ${model}"
  ollama pull "${model}"
done

echo "[ollama] all models ready"
wait "${SERVER_PID}"
