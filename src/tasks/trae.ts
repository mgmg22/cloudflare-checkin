import type { CheckinResult, Env } from "../types";
import { postJson } from "../lib/http";
import { signCanonical } from "../lib/crypto";

const HOST = "https://api.trae.cn";
const STATUS_PATH = "/trae/api/v2/ug/checkin_credits/status";
const CLAIM_PATH = "/trae/api/v2/ug/checkin_credits/claim";
const ENTITLEMENT_PATH = "/trae/api/v2/pay/user_current_entitlement_list";
const EXCHANGE_PATH = "/trae/api/v3/oauth/ExchangeToken";
const CLIENT_ID = "en1oxy7wnw8j9n";
const APP_VERSION = "1.107.1";
const STORE_KEY = "trae";

interface TraeCred {
  token: string;
  device_id: string;
  user_id: string;
  refresh_token: string;
  device_key_pem: string;
  device_pub_pem: string;
  machine_id: string;
  expires_ms: number;
  refresh_expires_ms: number;
}

function readCred(env: Env): TraeCred {
  return {
    token: (env.TRAE_TOKEN || "").trim(),
    device_id: (env.TRAE_DEVICE_ID || "").trim(),
    user_id: (env.TRAE_USER_ID || "").trim(),
    refresh_token: (env.TRAE_REFRESH_TOKEN || "").trim(),
    device_key_pem: (env.TRAE_DEVICE_KEY_PEM || "").trim(),
    device_pub_pem: (env.TRAE_DEVICE_PUB_PEM || "").trim(),
    machine_id: (env.TRAE_MACHINE_ID || "").trim(),
    expires_ms: 0,
    refresh_expires_ms: 0,
  };
}

function decodeJwtExp(token: string): number {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return 0;
    const pad = (s: string) => s + "=".repeat(-s.length % 4);
    const payload = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(pad(parts[1])), (c) => c.charCodeAt(0)),
      ),
    );
    return parseFloat(payload.exp || 0) * 1000;
  } catch {
    return 0;
  }
}

function canHeal(c: TraeCred): boolean {
  return Boolean(c.refresh_token && c.device_key_pem && c.device_pub_pem);
}

function expiringSoon(c: TraeCred): boolean {
  const exp = c.expires_ms || decodeJwtExp(c.token);
  if (!exp) return false;
  return (exp - Date.now()) / 3600000 <= 48;
}

function buildDeviceProof(c: TraeCred): Promise<{ Timestamp: number; Nonce: string; Signature: string }> {
  const ts = Math.floor(Date.now() / 1000);
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  const nonce = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  const canonical = ["POST", EXCHANGE_PATH, CLIENT_ID, c.refresh_token, String(ts), nonce].join("\n");
  return signCanonical(c.device_key_pem, canonical).then((signature) => ({ Timestamp: ts, Nonce: nonce, Signature: signature }));
}

function buildDeviceInfo(c: TraeCred, appVersion: string): any {
  return {
    DeviceID: c.device_id,
    MachineID: c.machine_id || "",
    PlatformCode: "SOLO_PC",
    DeviceType: "PC",
    DeviceName: "user",
    DeviceModel: "",
    ClientVersion: appVersion,
    DevicePublicKey: c.device_pub_pem,
    DeviceBrand: "",
    DeviceCPU: "",
    OSInfo: "Windows",
    OSVersion: "",
  };
}

async function exchangeToken(c: TraeCred, appVersion: string): Promise<[boolean, any, string]> {
  if (!canHeal(c)) return [false, null, "缺少 refreshToken / 设备私钥材料"];
  let proof: { Timestamp: number; Nonce: string; Signature: string };
  try {
    proof = await buildDeviceProof(c);
  } catch (e: any) {
    return [false, null, `设备证明生成失败：${e?.message || e}`];
  }
  const body = {
    ClientID: CLIENT_ID,
    ClientSecret: "",
    RefreshToken: c.refresh_token,
    DeviceInfo: buildDeviceInfo(c, appVersion),
    DeviceProof: proof,
    IDEVersion: appVersion,
  };
  const [sc, sb] = await postJson(HOST + EXCHANGE_PATH, { "Content-Type": "application/json", "x-cloudide-token": "" }, body);
  if (typeof sb !== "object") return [false, null, `续期响应非 JSON（HTTP ${sc}）`];
  const err = (sb as any).ResponseMetadata?.Error;
  if (err) return [false, null, `续期被拒 HTTP ${sc} code=${err.Code} msg=${err.Message}`];
  const res = (sb as any).Result || {};
  const token = res.Token;
  if (!token) return [false, null, `续期响应无 Token：${JSON.stringify(sb).slice(0, 200)}`];
  return [
    true,
    {
      token,
      refresh_token: res.RefreshToken || c.refresh_token,
      expires_ms: parseFloat(res.TokenExpireAt || 0),
      refresh_expires_ms: parseFloat(res.RefreshExpireAt || 0),
    },
    "",
  ];
}

async function selfHeal(env: Env, c: TraeCred, appVersion: string): Promise<[boolean, string]> {
  const [ok, fields, err] = await exchangeToken(c, appVersion);
  if (!ok) return [false, `自动续期失败：${err}`];
  c.token = fields.token;
  c.refresh_token = fields.refresh_token;
  c.expires_ms = fields.expires_ms;
  c.refresh_expires_ms = fields.refresh_expires_ms;
  await env.CHECKIN_STATE.put(
    STORE_KEY,
    JSON.stringify({
      token: c.token,
      refresh_token: c.refresh_token,
      expires_ms: c.expires_ms,
      refresh_expires_ms: c.refresh_expires_ms,
      updated_at: Date.now(),
    }),
  );
  const remain = c.expires_ms ? (c.expires_ms - Date.now()) / 86400000 : 0;
  return [true, `已自动续期 token（新有效期约 ${remain.toFixed(1)} 天）`];
}

function buildHeaders(token: string, deviceId: string): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: token.startsWith("Cloud-IDE-JWT ") ? token : `Cloud-IDE-JWT ${token}`,
    "x-device-id": deviceId || "",
  };
}

function apiSucceeded(d: any): boolean {
  const code = d?.code;
  if (typeof code === "number" && (code === 0 || code === 200)) return true;
  if (typeof code === "string" && (code === "0" || code === "200")) return true;
  if (d?.success === true) return true;
  return String(d?.status || "").toLowerCase() === "success";
}

function isAuthFailure(sc: number, d: any): boolean {
  if (sc === 401 || sc === 403) return true;
  const code = d?.code;
  if (typeof code === "number" && (code === 401 || code === 403 || code === 1001)) return true;
  return false;
}

async function queryPoints(token: string, deviceId: string): Promise<number | null> {
  const [sc, sb] = await postJson(HOST + ENTITLEMENT_PATH, buildHeaders(token, deviceId), { require_usage: true });
  try {
    const packs = (sb as any)?.data?.user_entitlement_pack_list;
    if (!Array.isArray(packs)) return null;
    let total = 0;
    let found = false;
    for (const p of packs) {
      const limit = (p?.entitlement_base_info?.quota)?.credits_limit || 0;
      const used = p?.usage?.credits_amount || 0;
      if (limit > 0) {
        found = true;
        total += Math.max(limit - used, 0);
      }
    }
    return found ? total : null;
  } catch {
    return null;
  }
}

export async function run(env: Env): Promise<CheckinResult> {
  const appVersion = env.TRAE_APP_VERSION || APP_VERSION;
  const c = readCred(env);

  // 合并 KV 中续期后的滚动凭据
  const cached = await env.CHECKIN_STATE.get(STORE_KEY).then((r) => (r ? JSON.parse(r) : null)).catch(() => null);
  if (cached) {
    for (const k of ["token", "refresh_token", "expires_ms", "refresh_expires_ms"]) {
      if (cached[k]) (c as any)[k] = cached[k];
    }
  }

  if (!c.token) {
    if (canHeal(c)) {
      const [ok, msg] = await selfHeal(env, c, appVersion);
      if (!ok) return { flag: "NO_CREDENTIAL", content: `⚠️ ${msg}` };
    } else {
      return { flag: "NO_CREDENTIAL", content: "未获取到 token 且无续期材料，请设置 TRAE_TOKEN 或运行过 --export-keys" };
    }
  } else if (canHeal(c) && expiringSoon(c)) {
    const [ok, msg] = await selfHeal(env, c, appVersion);
    if (!ok) return { flag: "AUTH_EXPIRED", content: `⚠️ ${msg}` };
  }

  // 1) 状态
  let [sc, sb] = await postJson(HOST + STATUS_PATH, buildHeaders(c.token, c.device_id), {});
  if (typeof sb === "object" && sb.checked_in) {
    const pts = await queryPoints(c.token, c.device_id);
    const extra = pts != null ? `\n- 总可用积分：${pts.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "";
    return { flag: "ALREADY_TODAY", content: `ℹ️ 今日已签到${extra}` };
  }
  if (isAuthFailure(sc, sb)) {
    if (canHeal(c)) {
      const [ok, msg] = await selfHeal(env, c, appVersion);
      if (ok) {
        [sc, sb] = await postJson(HOST + STATUS_PATH, buildHeaders(c.token, c.device_id), {});
        if (typeof sb === "object" && sb.checked_in) {
          const pts = await queryPoints(c.token, c.device_id);
          const extra = pts != null ? `\n- 总可用积分：${pts.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "";
          return { flag: "ALREADY_TODAY", content: `ℹ️ 今日已签到${extra}（已自动续期）` };
        }
        if (isAuthFailure(sc, sb)) return { flag: "AUTH_EXPIRED", content: "⚠️ 续期后再次鉴权失败，请检查设备证明材料" };
      } else {
        return { flag: "AUTH_EXPIRED", content: `⚠️ 鉴权失败（HTTP ${sc}）且自动续期失败：${msg}` };
      }
    } else {
      const m = sb?.message || sb?.msg || "未知错误";
      return { flag: "AUTH_EXPIRED", content: `⚠️ 鉴权失败（HTTP ${sc}）：${m}` };
    }
  }
  if (!apiSucceeded(sb)) {
    const m = sb?.message || sb?.msg || JSON.stringify(sb).slice(0, 120);
    return { flag: "STATUS_ERR", content: `⚠️ 状态查询异常：HTTP ${sc} ${m}` };
  }

  // 2) 领取
  let [cc, cb] = await postJson(HOST + CLAIM_PATH, buildHeaders(c.token, c.device_id), {});
  if (isAuthFailure(cc, cb)) {
    if (canHeal(c)) {
      const [ok, msg] = await selfHeal(env, c, appVersion);
      if (ok) [cc, cb] = await postJson(HOST + CLAIM_PATH, buildHeaders(c.token, c.device_id), {});
      else return { flag: "AUTH_EXPIRED", content: `⚠️ 领取时鉴权失败（HTTP ${cc}）且自动续期失败：${msg}` };
    } else {
      const m = cb?.message || cb?.msg || "未知错误";
      return { flag: "AUTH_EXPIRED", content: `⚠️ 领取时鉴权失败（HTTP ${cc}）：${m}` };
    }
  }
  if (apiSucceeded(cb)) {
    const points = (cb as any).data?.points ?? (cb as any).points;
    const message = (cb as any).message || (cb as any).msg || "";
    const pts = await queryPoints(c.token, c.device_id);
    const extra = pts != null ? `\n- 总可用积分：${pts.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "";
    const text = message === "success" ? "签到成功" : message;
    const gain = points ? `本次 +${points} 积分` : text;
    return { flag: "SUCCESS", content: `✅ ${gain}${extra}` };
  }
  const m = (cb as any)?.message || (cb as any)?.msg || JSON.stringify(cb).slice(0, 150);
  return { flag: "FAIL", content: `⚠️ 签到未成功：HTTP ${cc} ${m}` };
}
