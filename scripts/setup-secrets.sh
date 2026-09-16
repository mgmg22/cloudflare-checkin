#!/usr/bin/env bash
# 从本机 E:/QinglongMy/.env 读取变量，逐个 wrangler vars set 到 Cloudflare（文本变量，全量 17 项，不加密）。
# 用法： bash scripts/setup-secrets.sh [本机 .env 路径]
# 前置：npm install && npx wrangler login（已在本机登录 Cloudflare）
set -euo pipefail

SRC_ENV="${1:-/e/QinglongMy/.env}"
# py 版每次成功续期都会把最新的 token / refresh_token 写进同目录 .trae_token.json
# （见 py 的 self_heal -> save_cache）。部署时优先用这里的新鲜值，
# 避免拿到 .env 里那份过期的 refresh token（这正是本地与 py 表现不一致的根因）。
CACHE_JSON="${2:-/e/QinglongMy/.trae_token.json}"
cd "$(dirname "$0")/.."

# 从 py 的续期缓存读取最新凭据（key 为 json 字段名，如 token / refresh_token）
get_cache() {
  local key="$1" val=""
  if [ -f "$CACHE_JSON" ] && command -v node >/dev/null 2>&1; then
    val=$(node -e "try{const j=require(process.argv[2]);process.stdout.write(j[process.argv[3]]||'')}catch(e){}" "$CACHE_JSON" "$key" 2>/dev/null)
  fi
  printf '%s' "$val"
}

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
  echo ">> wrangler vars set $name"
  printf '%s' "$val" | npx wrangler vars set "$name"
}

# ---- WorkBuddy ----
put WB_ACCESS_TOKEN "$(get WB_ACCESS_TOKEN)"
put WB_USER_ID "$(get WB_USER_ID)"
# ---- Trae Work ----（token / refresh_token 优先取自 .trae_token.json 新鲜值）
TRAE_TOKEN_VAL="$(get_cache token)"; [ -z "$TRAE_TOKEN_VAL" ] && TRAE_TOKEN_VAL="$(get TRAE_TOKEN)"
put TRAE_TOKEN "$TRAE_TOKEN_VAL"
put TRAE_DEVICE_ID "$(get TRAE_DEVICE_ID)"
put TRAE_USER_ID "$(get TRAE_USER_ID)"
TRAE_REFRESH_VAL="$(get_cache refresh_token)"; [ -z "$TRAE_REFRESH_VAL" ] && TRAE_REFRESH_VAL="$(get TRAE_REFRESH_TOKEN)"
put TRAE_REFRESH_TOKEN "$TRAE_REFRESH_VAL"
put TRAE_DEVICE_KEY_PEM "$(get TRAE_DEVICE_KEY_PEM)"
put TRAE_DEVICE_PUB_PEM "$(get TRAE_DEVICE_PUB_PEM)"
put TRAE_MACHINE_ID "$(get TRAE_MACHINE_ID)"
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
echo "完成。"
