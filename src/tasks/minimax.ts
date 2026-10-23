/// MiniMax Code 每日签到任务：对齐 py 版 minimax_checkin.py。
/// 职责边界：先续期（/v1/api/user/renewal，等价重新登录）再签到，新 token 写回 KV 缓存自愈；
/// 多候选 token（环境变量 / KV 缓存）依次重试；yy/x-signature 签名见 signRequest。

import type { CheckinResult, Env } from "../types";
import { md5hex } from "../lib/md5";

const HOST = "https://agent.minimax.io";
const RENEW_PATH = "/v1/api/user/renewal";
const STATUS_PATH = "/minimax-cloud/api/v1/signin/status";
const CLAIM_PATH = "/minimax-cloud/api/v1/signin/claim";
const STORE_KEY = "minimax";

const DEVICE_PARAM_ORDER = [
  "device_platform", "biz_id", "app_id", "version_code", "unix",
  "timezone_offset", "is_desktop", "desktop_version", "sys_language",
  "lang", "uuid", "device_id", "os_name", "browser_name", "device_memory",
  "cpu_core_num", "browser_language", "browser_platform", "user_id",
  "op_ticket", "screen_width", "screen_height",
];

// 稳定的默认设备身份：仅在未设置对应变量时回落使用，避免设备指纹漂移（对齐 py）
const DEFAULT_UUID = "3548c8fa-9ac2-4a28-8f6b-71ecd88bc048";
const DEFAULT_DEVICE_ID = "1790426211";

const AUTH_FAIL_KEYWORDS = ["unauthorized", "token", "expired", "not login",
  "not logged", "登录", "鉴权", "invalid", "异常用户"];
const RATE_LIMIT_KEYWORDS = ["频繁", "frequent", "too many", "太多", "稍后再试",
  "繁忙", "busy", "limit"];

/** 清洗变量：去首尾空白、去误粘贴的成对引号（对齐 py clean_env_value，青龙/手填最常见 401 元凶）。 */
function cleanValue(raw: string): string {
  let s = (raw || "").trim();
  while (s.length >= 2 && s[0] === s[s.length - 1] && (s[0] === "'" || s[0] === '"')) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function pyQuotePlus(s: string): string {
  // 对齐 Python urllib.parse.quote_plus 的安全字符集（字母数字 + _ . - ~，空格->+）
  return s.replace(/[^A-Za-z0-9_.-~]/g, (c) =>
    c === " " ? "+" : "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"),
  );
}

function buildDeviceParams(userId: string, uuid: string, deviceId: string): Record<string, string> {
  const nowMs = Date.now();
  const v: Record<string, string> = {
    device_platform: "web",
    biz_id: "3",
    app_id: "3001",
    version_code: "22201",
    unix: String(nowMs),
    timezone_offset: "28800",
    is_desktop: "1",
    desktop_version: "",
    sys_language: "en",
    lang: "en",
    uuid,
    device_id: deviceId,
    os_name: "Windows",
    browser_name: "Chrome",
    device_memory: "16",
    cpu_core_num: "4",
    browser_language: "zh-CN",
    browser_platform: "Win32",
    user_id: userId,
    op_ticket: "undefined",
    screen_width: "1536",
    screen_height: "864",
  };
  const out: Record<string, string> = {};
  for (const k of DEVICE_PARAM_ORDER) out[k] = v[k];
  return out;
}

interface Signed {
  url: string;
  headers: Record<string, string>;
  bodyStr: string;
}

function signRequest(path: string, token: string, params: Record<string, string>, method: string, body: any): Signed {
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  // 设备参数里 unix 必须与签名用的 nowMs 完全一致（对齐 py _sign_request）
  const p = { ...params, unix: String(nowMs), client: "desktop" };
  const query = Object.entries(p)
    .map(([k, v]) => `${pyQuotePlus(k)}=${pyQuotePlus(v)}`)
    .join("&");
  const hasSearchParamsPath = `${path}?${query}`;
  const bodyStr = method.toLowerCase() === "get" ? "" : JSON.stringify(body || {});

  const xSignature = md5hex(`${nowSec}I*7Cf%WZ#S&%1RlZJ&C2${bodyStr}`);
  const yy = md5hex(
    encodeURIComponent(hasSearchParamsPath) + "_" + "{}" + md5hex(String(nowMs)) + "ooui",
  );

  const headers: Record<string, string> = {
    token,
    yy,
    "x-timestamp": String(nowSec),
    "x-signature": xSignature,
    origin: "https://agent.minimax.io",
    referer: "https://agent.minimax.io/",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) MiniMaxAgent/desktop Chrome/124.0 Safari/537.36",
  };
  if (method.toLowerCase() !== "get") headers["content-type"] = "application/json";
  return { url: HOST + path + "?" + query, headers, bodyStr };
}

async function apiCall(signed: Signed, method: string): Promise<[number, any]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(signed.url, {
      method: method.toUpperCase(),
      headers: signed.headers,
      body: method.toLowerCase() === "get" ? undefined : signed.bodyStr,
      signal: ctrl.signal,
    });
    let data: any;
    try {
      data = await res.json();
    } catch {
      data = { raw: (await res.text().catch(() => "")).slice(0, 300) };
    }
    return [res.status, data];
  } catch (e: any) {
    return [0, { error: String(e?.message || e) }];
  } finally {
    clearTimeout(t);
  }
}

function decodeJwtExp(token: string): number {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return 0;
    const pad = (s: string) => s + "=".repeat(-s.length % 4);
    const payload = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(pad(parts[1])), (c) => c.charCodeAt(0))),
    );
    return parseFloat(payload.exp || 0) * 1000;
  } catch {
    return 0;
  }
}

function tokenAlive(token: string): boolean {
  if (!token) return false;
  const exp = decodeJwtExp(token);
  if (!exp) return true;
  return exp - Date.now() > 60_000;
}

function apiSucceeded(d: any): boolean {
  const br = d?.base_resp;
  if (br && br.status_code === 0) return true;
  const code = d?.code;
  if (typeof code === "number" && (code === 0 || code === 200)) return true;
  if (typeof code === "string" && (code === "0" || code === "200")) return true;
  if (d?.success === true) return true;
  return String(d?.status || "").toLowerCase() === "success";
}

function isAuthFailure(sc: number, d: any): boolean {
  if (sc === 401 || sc === 403) return true;
  const code = d?.code;
  if (typeof code === "number" && (code === 401 || code === 403)) return true;
  const si = d?.statusInfo;
  if (si && (si.code === 1000021 || si.code === 1000022 || si.code === 1000023)) return true;
  const msg = String(d?.message || d?.msg || "").toLowerCase();
  // 命中限频词先排除，避免"请求过于频繁"被误判为鉴权失败（对齐 py is_auth_failure）
  if (RATE_LIMIT_KEYWORDS.some((k) => msg.toLowerCase().includes(k))) return false;
  return AUTH_FAIL_KEYWORDS.some((k) => msg.includes(k));
}

function isRateLimited(sc: number, d: any): boolean {
  if (sc === 429 || sc === 500 || sc === 502 || sc === 503 || sc === 504) return true;
  const msg = String(d?.message || d?.msg || "");
  return RATE_LIMIT_KEYWORDS.some((k) => msg.includes(k));
}

function serverMsg(d: any): string {
  const si = d?.statusInfo;
  if (si?.message) return si.message;
  const br = d?.base_resp;
  if (br?.status_msg && br.status_code !== 0) return `${br.status_msg}(code=${br.status_code})`;
  return String(d?.message || d?.msg || "");
}

/** 用指定 token 走一遍「续期 -> 状态 -> 领取」（对齐 py _try_checkin）。 */
async function tryCheckin(
  params: Record<string, string>,
  token: string,
  source: string,
  storeRenewed: (t: string) => Promise<void>,
): Promise<CheckinResult> {
  // 1) 先续期（等价于重新登录一次，新 token 有效期顺延 ~40 天）
  let renewed = false;
  const [rc, rb] = await apiCall(signRequest(RENEW_PATH, token, params, "POST", {}), "POST");
  const newToken = typeof rb === "object" ? String(rb?.data?.token || "").trim() : "";
  if (newToken) {
    token = newToken;
    renewed = true;
    await storeRenewed(newToken);
    console.log(`[miniMax] 续期成功（来源 ${source}），已写回 KV 缓存`);
  } else if (rc) {
    console.log(`[miniMax] 续期失败：HTTP ${rc}（沿用原 token 继续尝试）`);
  }
  const extra = renewed ? "（已自动续期 token）" : "";

  // 2) 状态查询（GET）
  const [sc, sb] = await apiCall(signRequest(STATUS_PATH, token, params, "GET", {}), "GET");
  if (isAuthFailure(sc, sb)) {
    return { flag: "AUTH_EXPIRED", content: `⚠️ 鉴权失败：${serverMsg(sb) || `HTTP ${sc}`}` };
  }
  if (!apiSucceeded(sb)) {
    return { flag: "STATUS_ERR", content: `⚠️ 状态查询异常：HTTP ${sc} ${serverMsg(sb) || JSON.stringify(sb).slice(0, 150)}` };
  }
  // 解析今日签到状态：days[] 中 is_today=true 的那天，status==3 表示已领取
  const days = sb?.data?.days || [];
  const today = days.find((d: any) => d.is_today);
  if (today && today.status === 3) {
    return { flag: "ALREADY_TODAY", content: `ℹ️ 今日已签到（第 ${today.day_no} 天）${extra}` };
  }

  // 3) 领取（POST，body {}）
  const [cc, cb] = await apiCall(signRequest(CLAIM_PATH, token, params, "POST", {}), "POST");
  if (isAuthFailure(cc, cb)) {
    return { flag: "AUTH_EXPIRED", content: `⚠️ 鉴权失败：${serverMsg(cb) || `HTTP ${cc}`}` };
  }
  if (isRateLimited(cc, cb)) {
    const msg = serverMsg(cb) || JSON.stringify(cb).slice(0, 120);
    return { flag: "RATE_LIMITED", content: `⏳ 服务端限频：${msg}，建议错峰或稍后重试` };
  }
  if (apiSucceeded(cb)) {
    // 解析领取结果：claim_result 1=新领取成功，2=今日已领取
    const cdata = cb?.data || {};
    if (cdata.claim_result === 2) {
      return { flag: "ALREADY_TODAY", content: `ℹ️ 今日已签到（claim_result=2）${extra}` };
    }
    const gain = cdata.points != null ? `本次 +${cdata.points} 积分` : "签到成功";
    return { flag: "SUCCESS", content: `✅ ${gain}（第 ${cdata.day_no} 天）${extra}` };
  }
  return { flag: "FAIL", content: `⚠️ 领取未成功：HTTP ${cc} ${serverMsg(cb) || JSON.stringify(cb).slice(0, 150)}` };
}

export async function run(env: Env): Promise<CheckinResult> {
  const user_id = cleanValue(env.MINIMAX_USER_ID || "");
  const uuid = cleanValue(env.MINIMAX_UUID || "") || DEFAULT_UUID;
  const device_id = cleanValue(env.MINIMAX_DEVICE_ID || "") || DEFAULT_DEVICE_ID;
  if (!user_id) {
    return { flag: "NO_CREDENTIAL", content: "未获取到 MiniMax 登录态，请设置 MINIMAX_TOKEN / MINIMAX_USER_ID" };
  }

  const params = buildDeviceParams(user_id, uuid, device_id);
  const storeRenewed = async (t: string) => {
    if (env.CHECKIN_STATE) {
      await env.CHECKIN_STATE.put(STORE_KEY, JSON.stringify({ token: t, updated_at: Date.now() }));
    }
  };

  // 候选 token（对齐 py _candidate_tokens）：存活的排前（env 在前、KV 缓存在后），再补未存活项，去重
  const envToken = cleanValue(env.MINIMAX_TOKEN || "");
  let cacheToken = "";
  if (env.CHECKIN_STATE) {
    const cached = await env.CHECKIN_STATE.get(STORE_KEY)
      .then((r) => (r ? JSON.parse(r) : null)).catch(() => null);
    cacheToken = cleanValue(cached?.token || "");
  }
  const candidates: [string, string][] = [];
  const push = (t: string, tag: string) => {
    if (t && !candidates.some(([x]) => x === t)) candidates.push([t, tag]);
  };
  if (envToken && tokenAlive(envToken)) push(envToken, "环境变量");
  if (cacheToken && tokenAlive(cacheToken)) push(cacheToken, "KV 缓存");
  push(envToken, "环境变量");
  push(cacheToken, "KV 缓存");
  if (!candidates.length) {
    return { flag: "NO_CREDENTIAL", content: "未获取到 MiniMax 登录态，请设置 MINIMAX_TOKEN" };
  }

  // 依次尝试各候选；SUCCESS / ALREADY_TODAY / RATE_LIMITED 提前返回，其余换下一个
  let last: CheckinResult = { flag: "NO_CREDENTIAL", content: "未获取到 MiniMax 登录态" };
  for (const [token, source] of candidates) {
    let r: CheckinResult;
    try {
      r = await tryCheckin(params, token, source, storeRenewed);
    } catch (e: any) {
      r = { flag: "ERROR", content: `⚠️ 执行异常（token 来源：${source}）：${e?.message || e}` };
      console.error(`[miniMax] ${r.content}`);
    }
    if (r.flag === "SUCCESS" || r.flag === "ALREADY_TODAY" || r.flag === "RATE_LIMITED") return r;
    last = r;
    console.log(`[miniMax] token 来源 ${source} 失败：RESULT=${r.flag} | ${r.content}`);
  }

  // 全部候选都失败：补一条可操作提示（对齐 py checkin_once）
  if (last.flag === "AUTH_EXPIRED") {
    last = {
      flag: last.flag,
      content: last.content +
        "｜处理：①本机 python minimax_checkin.py --export-env --save 重新导出；" +
        "②把新的 MINIMAX_TOKEN 更新到 Worker 变量（注意别带引号）；" +
        "③若确认 token 无误仍 401，多为出口 IP 被风控",
    };
  }
  return last;
}
