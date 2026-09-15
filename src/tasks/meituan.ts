import type { CheckinResult, Env } from "../types";
import { postJson } from "../lib/http";

const COUPON_URL = "https://media.meituan.com/fulishemini/couponActivity/sendCouponWork";
const DEFAULT_CLIENT_ID = "c6f50b5a1e2f4e2bb00a3e2f58df3ced";

function fenToYuan(fen: any): string {
  if (!fen) return "0";
  const yuan = Number(fen) / 100;
  return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(1);
}

function fmtCoupon(c: any): string {
  const priceLimit = c.priceLimit;
  const couponValue = c.couponValue || 0;
  const discount = priceLimit && priceLimit > 0 ? `（满${fenToYuan(priceLimit)}元减${fenToYuan(couponValue)}元）` : "";
  return `- ${c.tabName || "其他"}：${c.couponName || ""}${discount}`;
}

export async function run(env: Env): Promise<CheckinResult> {
  const token = (env.MT_TOKEN || "").trim();
  if (!token) {
    return { flag: "NO_CREDENTIAL", content: "未获取到美团登录 Token，请设置 MT_TOKEN" };
  }
  const aiScene = (env.MT_AISCENE || "").trim();
  const clientId = (env.MT_CLIENT_ID || "").trim() || DEFAULT_CLIENT_ID;

  const [code, resp] = await postJson(
    COUPON_URL,
    {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
    },
    { token, aiScene, version: 2 },
  );

  if (code === 0) return { flag: "NET_ERR", content: `⚠️ 网络异常，领券请求未发出：${JSON.stringify(resp).slice(0, 200)}` };
  if (typeof resp !== "object") return { flag: "HTTP_ERR", content: `⚠️ 请求异常（HTTP ${code}）：${String(resp).slice(0, 200)}` };

  const c = resp.code;
  const data = resp.data || {};
  if (c === 200) {
    const list = data.couponList || [];
    const lines = [`✅ 美团领券成功，共 ${list.length} 张`];
    for (const x of list.slice(0, 8)) lines.push(fmtCoupon(x));
    if (data.activityName) lines.push(`- 活动：${data.activityName}`);
    return { flag: "SUCCESS", content: lines.join("\n") };
  }
  if (c === 1014) return { flag: "ALREADY_TODAY", content: "ℹ️ 您今天已经领取过美团的优惠券，明天再来哦～" };
  if (c === 401) return { flag: "TOKEN_EXPIRED", content: "⚠️ 登录已过期，请重新扫码登录并刷新 MT_TOKEN" };
  if (c === 509 || c === 50200) return { flag: "RATE_LIMITED", content: "⏳ 请求过于频繁（限流），请稍后重试" };
  return { flag: "FAIL", content: `⚠️ 领券未成功：HTTP ${code} code=${c} msg=${resp.msg}` };
}
