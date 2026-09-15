/// <reference types="@cloudflare/workers-types" />

export interface Env {
  // WorkBuddy
  WB_ACCESS_TOKEN: string;
  WB_USER_ID: string;
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
  // 美团
  MT_TOKEN: string;
  MT_CLIENT_ID?: string;
  MT_AISCENE?: string;
  // 通知
  NOTIFY_PUSH_KEY?: string;
  // KV（wrangler.toml 绑定）
  CHECKIN_STATE: KVNamespace;
}

export interface CheckinResult {
  flag: string;
  content: string;
}
