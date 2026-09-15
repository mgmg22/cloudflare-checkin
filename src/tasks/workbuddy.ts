import type { CheckinResult, Env } from "../types";
import { postJson } from "../lib/http";

const API_BASE = "https://copilot.tencent.com";
const CHECKIN_PATH = "/v2/billing/meter/daily-checkin";
// 资源包余额接口：无 /v2 前缀的新网关，必须带 IDE 标识头，否则 10085。
const RESOURCE_SUMMARY_PATH = "/billing/meter/get-user-resource-summary";
const RESOURCE_HEADERS: Record<string, string> = {
  "X-Product": "WorkBuddy",
  "X-IDE-Name": "WorkBuddy",
  "User-Agent": "WorkBuddy/5.3.8",
};

function baseHeaders(token: string, uid: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "X-User-Id": uid,
  };
}

function fmtCredits(v: number): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function fetchBalance(token: string, uid: string): Promise<string> {
  const [sc, sb] = await postJson(
    API_BASE + RESOURCE_SUMMARY_PATH,
    { ...baseHeaders(token, uid), ...RESOURCE_HEADERS },
    {},
  );
  if (sc !== 0 && typeof sb === "object" && (sb as any).code === 0) {
    const pkgs = (sb as any).data?.Packages;
    if (Array.isArray(pkgs)) {
      const total = pkgs.reduce(
        (acc: number, p: any) => acc + Math.max(0, parseFloat(p.CycleRemainCapacity || 0) || 0),
        0,
      );
      if (!Number.isNaN(total)) return `- 总剩余积分：${fmtCredits(total)}`;
    }
  }
  return "";
}

export async function run(env: Env): Promise<CheckinResult> {
  const token = (env.WB_ACCESS_TOKEN || "").trim();
  const uid = (env.WB_USER_ID || "").trim();
  if (!token || !uid) {
    return {
      flag: "NO_CREDENTIAL",
      content: "未获取到 WorkBuddy 登录态，请设置 WB_ACCESS_TOKEN / WB_USER_ID",
    };
  }

  const [cc, cb] = await postJson(API_BASE + CHECKIN_PATH, baseHeaders(token, uid), {});

  if (cc === 0) {
    return { flag: "NET_ERR", content: `⚠️ 网络异常，签到请求未发出：${JSON.stringify(cb).slice(0, 200)}` };
  }
  if (typeof cb === "object") {
    const code = (cb as any).code;
    if (code === 0) {
      const d = (cb as any).data || {};
      let content = `✅ 领取成功\n- 本次积分：${d.credit}\n- 连续签到：第 ${d.streak_days} 天`;
      const bal = await fetchBalance(token, uid);
      if (bal) content += `\n${bal}`;
      return { flag: "SUCCESS", content };
    }
    if (code === 10001) {
      let content = "ℹ️ 今日已签到，无需重复领取";
      const bal = await fetchBalance(token, uid);
      if (bal) content += `\n${bal}`;
      return { flag: "ALREADY_TODAY", content };
    }
    if (cc === 401 || cc === 403) {
      return { flag: "TOKEN_EXPIRED", content: `⚠️ 令牌失效（HTTP ${cc}），请刷新 WorkBuddy 登录态后重试` };
    }
    return { flag: "FAIL", content: `⚠️ 签到未成功：HTTP ${cc} code=${code} msg=${(cb as any).msg}` };
  }
  return { flag: "HTTP_ERR", content: `⚠️ 请求异常（HTTP ${cc}）：${JSON.stringify(cb).slice(0, 200)}` };
}
