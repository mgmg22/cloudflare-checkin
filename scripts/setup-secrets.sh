#!/usr/bin/env bash
# 从本机 E:/QinglongMy/.env 读取已有变量，把【敏感项】逐个 wrangler secret put 到 Cloudflare。
# 用法： bash scripts/setup-secrets.sh [本机 .env 路径]
# 前置：npm install && npx wrangler login（已在本机登录 Cloudflare）
#
# 分层说明：
#   - 敏感项（Secret）：本脚本用 `wrangler secret put` 推，加密存储、不进仓库。
#   - 非敏感项（Variables）：WB_USER_ID / TRAE_DEVICE_ID / TRAE_USER_ID /
#     TRAE_MACHINE_ID / MINIMAX_USER_ID / MINIMAX_UUID /
#     MINIMAX_DEVICE_ID / MT_CLIENT_ID / MT_AISCENE 已写在 wrangler.toml 的
#     [vars]，随仓库提交，无需本脚本处理。
#     （TRAE_APP_VERSION 未列入：trae.ts 内置默认 1.107.1，仅可在需偏离时单独覆盖。）
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

# ---- 敏感项：Secret（以下才推 secret） ----
# WorkBuddy
put WB_ACCESS_TOKEN "$(get WB_ACCESS_TOKEN)"
# Trae Work
put TRAE_TOKEN "$(get TRAE_TOKEN)"
put TRAE_REFRESH_TOKEN "$(get TRAE_REFRESH_TOKEN)"
put TRAE_DEVICE_KEY_PEM "$(get TRAE_DEVICE_KEY_PEM)"
put TRAE_DEVICE_PUB_PEM "$(get TRAE_DEVICE_PUB_PEM)"
# MiniMax Code
put MINIMAX_TOKEN "$(get MINIMAX_TOKEN)"
# 美团
put MT_TOKEN "$(get MT_TOKEN)"
# 通知（server酱 PUSH_KEY_MY）
put NOTIFY_PUSH_KEY "$(get PUSH_KEY_MY)"
# 手动触发保护（可选）
put API_KEY "$(get API_KEY)"

echo ""
echo "完成。非敏感 Variables 已在 wrangler.toml 的 [vars]，部署后可在"
echo "Cloudflare 控制台「Workers → Settings → Variables」修改。"
echo "未设置 API_KEY 时任何 GET /?key= 都可触发，请注意暴露风险。"
