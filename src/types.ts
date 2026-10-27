/// <reference types="@cloudflare/workers-types" />

export interface Env {
  // WorkBuddy
  WB_ACCESS_TOKEN: string;
  WB_USER_ID: string;
  WB_DOMAIN?: string; // 可选：成长中心按产品路由（取自登录态 auth.domain，如 www.workbuddy.cn）
  // Trae Work
  TRAE_TOKEN?: string;
  TRAE_DEVICE_ID: string;
  TRAE_USER_ID?: string;
  TRAE_REFRESH_TOKEN: string;
  TRAE_DEVICE_KEY_PEM: string; // base64(PEM) 单行
  TRAE_DEVICE_PUB_PEM: string; // base64(PEM) 单行
  TRAE_MACHINE_ID?: string;
  TRAE_APP_VERSION?: string;
  // MiniMax Code
  MINIMAX_TOKEN: string;
  MINIMAX_USER_ID: string;
  MINIMAX_UUID?: string;
  MINIMAX_DEVICE_ID?: string;
  // XB 线报（AI 分析 + 钉钉推送）
  API_KEY: string; // OpenAI 兼容接口密钥（取自青龙 .env 的 API_KEY）
  API_URL: string; // OpenAI 兼容接口地址（含 /chat/completions）
  XB_BOT_TOKEN?: string; // 线报钉钉机器人 access_token
  XB_BOT_TOKEN_SECRET?: string; // 可选：钉钉机器人加签密钥（SEC 开头）
  // 通知
  NOTIFY_PUSH_KEY?: string;
  // KV（wrangler.toml 绑定，可选；不配置则 token 不跨调用缓存）
  CHECKIN_STATE?: KVNamespace;
}

export interface CheckinResult {
  flag: string;
  content: string;
}
