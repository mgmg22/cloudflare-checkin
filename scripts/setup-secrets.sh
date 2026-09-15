#!/usr/bin/env bash
# 从本机 E:/QinglongMy/.env 读取已有变量，逐个 wrangler secret put 到 Cloudflare。
# 用法： bash scripts/setup-secrets.sh [本机 .env 路径]
# 前置：npm install && npx wrangler login（已在本机登录 Cloudflare）
set -euo pipefail

SRC_ENV="${1:-/e/QinglongMy/.env}"
cd "$(dirname "$0")/.."

if [ ! -f "$SRC_ENV" ]; then
  echo "未找到源 .env：$SRC_ENV"
  exit 1
fi

# 从 .env 取某个 key 的值（去掉首尾可能的引号）
get() {
  grep -E "^$1=" "$SRC_ENV" | head -1 | cut -d= -f2- | sed 's/^["'"'"']//; s/["'"'"']$//'
}

put() {
  local name="$1" val="$2"
  if [ -z "$val" ]; then
    echo "跳过 $name（源 .env 无值）"
    return
  fi
  echo ">> wrangler secret put $name"
  printf '%s' "$val" | npx wrangler secret put "$name"
}

# ---- WorkBuddy ----
put WB_ACCESS_TOKEN "$(get WB_ACCESS_TOKEN)"
put WB_USER_ID "$(get WB_USER_ID)"
# ---- Trae Work ----
put TRAE_TOKEN "$(get TRAE_TOKEN)"
put TRAE_DEVICE_ID "$(get TRAE_DEVICE_ID)"
put TRAE_USER_ID "$(get TRAE_USER_ID)"
put TRAE_REFRESH_TOKEN "$(get TRAE_REFRESH_TOKEN)"
put TRAE_DEVICE_KEY_PEM "$(get TRAE_DEVICE_KEY_PEM)"
put TRAE_DEVICE_PUB_PEM "$(get TRAE_DEVICE_PUB_PEM)"
put TRAE_MACHINE_ID "$(get TRAE_MACHINE_ID)"
put TRAE_APP_VERSION "$(get TRAE_APP_VERSION)"
# ---- MiniMax Code ----
put MINIMAX_TOKEN "$(get MINIMAX_TOKEN)"
put MINIMAX_USER_ID "$(get MINIMAX_USER_ID)"
put MINIMAX_UUID "$(get MINIMAX_UUID)"
put MINIMAX_DEVICE_ID "$(get MINIMAX_DEVICE_ID)"
# ---- 美团 ----
put MT_TOKEN "$(get MT_TOKEN)"
put MT_CLIENT_ID "$(get MT_CLIENT_ID)"
put MT_AISCENE "$(get MT_AISCENE)"
# ---- 通知（server酱 PUSH_KEY_MY）----
put NOTIFY_PUSH_KEY "$(get PUSH_KEY_MY)"

echo ""
echo "完成。若设置了手动触发保护，再执行："
echo "  printf '%s' '<你的API_KEY>' | npx wrangler secret put API_KEY"
echo "（可选）未设置 API_KEY 时任何 GET /?key= 都可触发，请注意暴露风险。"
