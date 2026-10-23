/// WorkBuddy 每日签到任务：对齐 py 版 workbuddy_checkin.py 的 run_full 全量流程。
/// 职责边界：每日签到 + 总剩余积分查询 + 成长中心（派猫旅行/开盲盒）。
/// 凭据只读 env（WB_ACCESS_TOKEN / WB_USER_ID，WB_DOMAIN 可选）；与 py 版一致，不做 token 续期。

import type { CheckinResult, Env } from "../types";
import { requestJson } from "../lib/http";

const API_BASE = "https://copilot.tencent.com";
const CHECKIN_PATH = "/v2/billing/meter/daily-checkin";
// 资源包余额接口：无 /v2 前缀的新网关，必须带 IDE 标识头，否则 10085。
const RESOURCE_SUMMARY_PATH = "/billing/meter/get-user-resource-summary";
const RESOURCE_HEADERS: Record<string, string> = {
  "X-Product": "WorkBuddy",
  "X-IDE-Name": "WorkBuddy",
  "User-Agent": "WorkBuddy/5.3.8",
};

// 成长中心（派猫旅行 + 开盲盒）——仅做可 API 化的部分，不自动完成成长计划任务
const GROWTH_BASE = "/v2/activity/growth";
const TRAVEL_STATUS = `${GROWTH_BASE}/buddy/travel/status`;
const TRAVEL_CONFIG = `${GROWTH_BASE}/buddy/travel/config`;
const TRAVEL_DEPART = `${GROWTH_BASE}/buddy/travel/depart`;
const TRAVEL_CLAIM = `${GROWTH_BASE}/buddy/travel/claim`;
// 开盲盒（能量开启 Buddy 盲盒）：每攒够 10 点能量可开启一次（开启消耗 10 能量）
const ENERGY = `${GROWTH_BASE}/energy`;
const BLINDBOX_ENERGY_COST = 10;
const BUDDY_OPEN = `${GROWTH_BASE}/buddy/open`;

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

/** 剥掉 data 信封：{code, data:{...}} -> {...}；非信封原样返回（对齐 py _unwrap）。 */
function unwrap(body: any): any {
  if (body && typeof body === "object" && body.data && typeof body.data === "object") {
    return body.data;
  }
  return body;
}

/** HTTP 2xx 且业务 code 非错误（缺失/0 视为成功，对齐 py _ok）。 */
function ok2xx(sc: number, sb: any): boolean {
  if (!(sc >= 200 && sc < 300)) return false;
  if (sb && typeof sb === "object" && sb.code != null && sb.code !== 0) return false;
  return true;
}

/** 通用请求：默认 POST，GET 用于状态/配置/能量查询（对齐 py _call）。 */
async function wbCall(
  token: string,
  uid: string,
  path: string,
  method: "GET" | "POST" = "POST",
  payload?: any,
  domain = "",
): Promise<[number, any]> {
  const headers = baseHeaders(token, uid);
  // 成长中心接口可能按 X-Domain 路由到对应产品；仅显式设置 WB_DOMAIN 时附加
  if (domain) headers["X-Domain"] = domain;
  return requestJson(API_BASE + path, method, headers, payload ?? {});
}

async function fetchBalance(token: string, uid: string, domain: string): Promise<string> {
  const [sc, sb] = await wbCall(token, uid, RESOURCE_SUMMARY_PATH, "POST", {}, domain);
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

async function checkinOnce(token: string, uid: string, domain: string): Promise<CheckinResult> {
  const [cc, cb] = await wbCall(token, uid, CHECKIN_PATH);

  if (cc === 0) {
    return { flag: "NET_ERR", content: `⚠️ 网络异常，签到请求未发出：${JSON.stringify(cb).slice(0, 200)}` };
  }
  if (typeof cb === "object") {
    const code = (cb as any).code;
    if (code === 0) {
      const d = (cb as any).data || {};
      let content = `✅ 领取成功\n- 本次积分：${d.credit}\n- 连续签到：第 ${d.streak_days} 天`;
      const bal = await fetchBalance(token, uid, domain);
      if (bal) content += `\n${bal}`;
      return { flag: "SUCCESS", content };
    }
    if (code === 10001) {
      let content = "ℹ️ 今日已签到，无需重复领取";
      const bal = await fetchBalance(token, uid, domain);
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

/** 派猫旅行状态机（对齐 py buddy_travel）：arrived→领奖；idle→派出发；traveling→跳过。
 *  动作由服务端状态驱动，天然幂等，重复运行不会重复领/派。 */
async function buddyTravel(token: string, uid: string, domain: string): Promise<string> {
  const [sc, sb] = await wbCall(token, uid, TRAVEL_STATUS, "GET", undefined, domain);
  if (!ok2xx(sc, sb)) return `查询旅行状态失败（HTTP ${sc}）`;
  const data = unwrap(sb);
  let state = data?.state;
  const parts: string[] = [];

  if (state === "arrived") {
    const recordId = data.record_id;
    const [cc, cb] = await wbCall(token, uid, TRAVEL_CLAIM, "POST", { record_id: recordId }, domain);
    if (ok2xx(cc, cb)) {
      const reward = unwrap(cb)?.reward_credit;
      parts.push(reward != null ? `领旅行礼物 +${reward} 积分` : "领旅行礼物成功");
    } else {
      parts.push(`领旅行礼物失败（HTTP ${cc}）`);
    }
    state = "idle"; // 领完回到 idle，下方再派一程
  }

  if (state === "idle") {
    // 服务端标记今日派猫额度已用完时，depart 会 400 daily limit reached，属正常幂等态
    if (data?.daily_limit_reached) {
      parts.push("今日派猫额度已用完");
    } else {
      const [cc, cb] = await wbCall(token, uid, TRAVEL_CONFIG, "GET", undefined, domain);
      const locs = ok2xx(cc, cb) ? unwrap(cb)?.locations : null;
      if (Array.isArray(locs) && locs.length) {
        const loc = locs[0];
        const [dc, db] = await wbCall(token, uid, TRAVEL_DEPART, "POST", { location_id: loc.id }, domain);
        if (ok2xx(dc, db)) {
          const locName = unwrap(db)?.location?.name || "?";
          parts.push(`派 Buddy 去${locName}`);
        } else {
          parts.push(`派 Buddy 失败（HTTP ${dc}）`);
        }
      } else {
        parts.push("无可用旅行地点");
      }
    }
  } else if (state === "traveling") {
    parts.push(`Buddy 旅行中（${data?.location?.name || "?"}）`);
  }

  return parts.length ? parts.join("；") : "旅行无变动";
}

/** 开盲盒（对齐 py open_blindbox）：先查能量余额，余额 >= 10 才开启一次，能量不足不开启。 */
async function openBlindbox(token: string, uid: string, domain: string): Promise<string> {
  const [es, eb] = await wbCall(token, uid, ENERGY, "GET", undefined, domain);
  if (!ok2xx(es, eb)) return `查询能量失败（HTTP ${es}）`;
  const energy = unwrap(eb)?.balance;
  if (typeof energy !== "number" || energy < BLINDBOX_ENERGY_COST) {
    return `能量不足（当前${energy}/${BLINDBOX_ENERGY_COST}），暂不能开盲盒`;
  }
  const [oc, ob] = await wbCall(token, uid, BUDDY_OPEN, "POST", {}, domain);
  if (ok2xx(oc, ob)) {
    const data = unwrap(ob);
    const results = data?.results || [];
    if (results.length) {
      const r0 = results[0] || {};
      const name = r0.name || r0.buddy?.name || r0.instance?.name || "未知 Buddy";
      const rarity = r0.rarity || r0.buddy?.rarity || r0.instance?.rarity || "";
      const got = rarity ? `${name}（${rarity}）` : name;
      const cnt = data?.count || results.length;
      return `开盲盒获得：${got}${cnt && cnt > 1 ? ` 等 ${cnt} 个` : ""}`;
    }
    return "开盲盒成功";
  }
  const msg = unwrap(ob)?.msg || "";
  return `开盲盒失败（HTTP ${oc}）${msg ? `：${msg}` : ""}`;
}

/** 成长中心编排（对齐 py run_growth）：派猫旅行 + 开盲盒。不含任务领奖。 */
async function runGrowth(token: string, uid: string, domain: string): Promise<string> {
  const parts: string[] = [];
  const t = await buddyTravel(token, uid, domain);
  if (t) parts.push(t);
  const b = await openBlindbox(token, uid, domain);
  if (b) parts.push(`盲盒：${b}`);
  return parts.length ? parts.join("；") : "成长中心无可执行项";
}

/** 完整运行（对齐 py run_full）：每日签到 + 成长中心。
 *  与单独跑 py 版、checkin_all 聚合均保持同一全量流程。 */
export async function run(env: Env): Promise<CheckinResult> {
  const token = (env.WB_ACCESS_TOKEN || "").trim();
  const uid = (env.WB_USER_ID || "").trim();
  if (!token || !uid) {
    return {
      flag: "NO_CREDENTIAL",
      content: "未获取到 WorkBuddy 登录态，请设置 WB_ACCESS_TOKEN / WB_USER_ID" +
        "（或本机运行 python workbuddy_checkin.py --export-env --save 刷新）",
    };
  }
  const domain = (env.WB_DOMAIN || "").trim();

  const { flag, content: checkinContent } = await checkinOnce(token, uid, domain);
  let content = checkinContent;
  const growth = await runGrowth(token, uid, domain);
  content += `\n${growth}`;
  return { flag, content };
}
