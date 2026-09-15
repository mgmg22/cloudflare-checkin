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

const DEFAULT_UUID = "3548c8fa-9ac2-4a28-8f6b-71ecd88bc048";
const DEFAULT_DEVICE_ID = "1790426211";

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
  return ["unauthorized", "token", "expired", "not login", "登录", "鉴权", "invalid", "异常用户"].some((k) => msg.includes(k));
}

function serverMsg(d: any): string {
  const si = d?.statusInfo;
  if (si?.message) return si.message;
  const br = d?.base_resp;
  if (br?.status_msg && br.status_code !== 0) return `${br.status_msg}(code=${br.status_code})`;
  return String(d?.message || d?.msg || "");
}

export async function run(env: Env): Promise<CheckinResult> {
  const user_id = (env.MINIMAX_USER_ID || "").trim();
  const uuid = (env.MINIMAX_UUID || "").trim() || DEFAULT_UUID;
  const device_id = (env.MINIMAX_DEVICE_ID || "").trim() || DEFAULT_DEVICE_ID;
  if (!user_id) {
    return { flag: "NO_CREDENTIAL", content: "未获取到 MiniMax 登录态，请设置 MINIMAX_TOKEN / MINIMAX_USER_ID" };
  }

  // 候选 token：优先 KV 续期缓存，回落环境变量
  const cached = await env.CHECKIN_STATE.get(STORE_KEY).then((r) => (r ? JSON.parse(r) : null)).catch(() => null);
  let token = cached?.token && tokenAlive(cached.token) ? cached.token : (env.MINIMAX_TOKEN || "").trim();
  if (!token) return { flag: "NO_CREDENTIAL", content: "未获取到 MiniMax 登录态，请设置 MINIMAX_TOKEN" };

  const params = buildDeviceParams(user_id, uuid, device_id);

  // 1) 先续期
  const rSigned = signRequest(RENEW_PATH, token, params, "POST", {});
  const [rc, rb] = await apiCall(rSigned, "POST");
  const newToken = typeof rb === "object" ? (rb?.data?.token || "").trim() : "";
  if (newToken) {
    token = newToken;
    await env.CHECKIN_STATE.put(STORE_KEY, JSON.stringify({ token, updated_at: Date.now() }));
  }

  // 2) 状态查询（GET）
  const sSigned = signRequest(STATUS_PATH, token, params, "GET", {});
  const [sc, sb] = await apiCall(sSigned, "GET");
  if (isAuthFailure(sc, sb)) {
    return { flag: "AUTH_EXPIRED", content: `⚠️ 鉴权失败：${serverMsg(sb) || `HTTP ${sc}`}` };
  }
  if (!apiSucceeded(sb)) {
    return { flag: "STATUS_ERR", content: `⚠️ 状态查询异常：HTTP ${sc} ${serverMsg(sb) || JSON.stringify(sb).slice(0, 150)}` };
  }
  const days = (sb?.data?.days) || [];
  const today = days.find((d: any) => d.is_today);
  if (today && today.status === 3) {
    return { flag: "ALREADY_TODAY", content: `ℹ️ 今日已签到（第 ${today.day_no} 天）${newToken ? "（已自动续期 token）" : ""}` };
  }

  // 3) 领取（POST）
  const cSigned = signRequest(CLAIM_PATH, token, params, "POST", {});
  const [cc, cb] = await apiCall(cSigned, "POST");
  if (isAuthFailure(cc, cb)) {
    return { flag: "AUTH_EXPIRED", content: `⚠️ 鉴权失败：${serverMsg(cb) || `HTTP ${cc}`}` };
  }
  if (apiSucceeded(cb)) {
    const cdata = cb?.data || {};
    if (cdata.claim_result === 2) {
      return { flag: "ALREADY_TODAY", content: `ℹ️ 今日已签到（claim_result=2）${newToken ? "（已自动续期 token）" : ""}` };
    }
    const gain = cdata.points != null ? `本次 +${cdata.points} 积分` : "签到成功";
    return { flag: "SUCCESS", content: `✅ ${gain}（第 ${cdata.day_no} 天）${newToken ? "（已自动续期 token）" : ""}` };
  }
  return { flag: "FAIL", content: `⚠️ 领取未成功：HTTP ${cc} ${serverMsg(cb) || JSON.stringify(cb).slice(0, 150)}` };
}
