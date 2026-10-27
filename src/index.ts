/// <reference types="@cloudflare/workers-types" />
import type { Env, CheckinResult } from "./types";
import { run as workbuddyRun } from "./tasks/workbuddy";
import { run as traeRun } from "./tasks/trae";
import { run as minimaxRun } from "./tasks/minimax";
import { run as xbRun } from "./tasks/xb";
import { notifyServerJ } from "./lib/notify";

// cron 标识（与 wrangler.toml [triggers] 一致）：scheduled() 按 event.cron 字符串分发
const CRON_CHECKIN = "8 16 * * *"; // 北京时间 00:08 聚合签到
const CRON_XB = "3,33 0-15 * * *"; // 北京时间 8~23 点每小时的 03/33 分线报推送

interface TaskDef {
  name: string;
  title: string;
  fn: (env: Env) => Promise<CheckinResult>;
}

// 顺序即执行顺序（对齐 py 版 checkin_all.py）：WorkBuddy -> Trae Work -> MiniMax Code
const TASKS: TaskDef[] = [
  { name: "WorkBuddy", title: "WorkBuddy 每日签到", fn: workbuddyRun },
  { name: "Trae Work", title: "Trae Work 每日签到", fn: traeRun },
  { name: "MiniMax Code", title: "MiniMax Code 每日签到", fn: minimaxRun },
];

const FLAG_ICON: Record<string, string> = {
  SUCCESS: "✅",
  ALREADY_TODAY: "ℹ️",
  NET_ERR: "⚠️",
  HTTP_ERR: "⚠️",
  FAIL: "⚠️",
  TOKEN_EXPIRED: "⚠️",
  AUTH_EXPIRED: "⚠️",
  RATE_LIMITED: "⏳",
  NO_CREDENTIAL: "⚠️",
  STATUS_ERR: "⚠️",
  IMPORT_FAIL: "⚠️",
  ERROR: "⚠️",
};

function buildSummary(results: [string, CheckinResult][]): string {
  const now = new Date().toLocaleString("zh-CN", { month: "2-digit", day: "2-digit" });
  const lines = [`## ${now} Token签到汇总`, ""];
  let ok = 0;
  for (const [name, r] of results) {
    const icon = FLAG_ICON[r.flag] || "•";
    lines.push(`${icon} **${name}**：`);
    const body = (r.content || "").trim();
    if (body) {
      for (const ln of body.split("\n")) lines.push(ln.trim() ? `> ${ln}` : "");
    } else {
      lines.push("> (空)");
    }
    if (r.flag === "SUCCESS" || r.flag === "ALREADY_TODAY") ok++;
    lines.push("");
  }
  lines.push(`**共 ${results.length} 项，成功/已签 ${ok} 项**`);
  return lines.join("\n");
}

async function runAll(env: Env): Promise<string> {
  const results: [string, CheckinResult][] = [];
  for (const t of TASKS) {
    try {
      const r = await t.fn(env);
      results.push([t.name, r]);
      console.log(`[${t.name}] ${r.flag}`);
    } catch (e: any) {
      results.push([t.name, { flag: "ERROR", content: `⚠️ 执行异常：${e?.message || e}` }]);
      console.error(`[${t.name}] ERROR`, e);
    }
  }
  const summary = buildSummary(results);
  // 标题格式对齐 py 版：每日Token签到汇总✅{ok}/{total}
  const ok = results.filter(([, r]) => r.flag === "SUCCESS" || r.flag === "ALREADY_TODAY").length;
  try {
    await notifyServerJ(`每日Token签到汇总✅${ok}/${results.length}`, summary, env.NOTIFY_PUSH_KEY);
  } catch (e) {
    console.warn("[notify] 通知失败", e);
  }
  return summary;
}

export default {
  // 手动触发（仅开发期使用，不进生产逻辑分支）：/?run=1 -> 跑聚合三项；/?run=xb -> 跑线报推送
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      const run = url.searchParams.get("run");
      if (run === "xb") {
        const r = await xbRun(env, { dry: url.searchParams.get("dry") === "1" });
        return new Response(r.content, { headers: { "content-type": "text/plain; charset=utf-8" } });
      }
      if (run !== "1") {
        return new Response("本地手动触发请访问 /?run=1（聚合三项）或 /?run=xb（线报推送）", {
          status: 400,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
      const summary = await runAll(env);
      return new Response(summary, { headers: { "content-type": "text/plain; charset=utf-8" } });
    } catch (e) {
      // 手动触发端点：把异常原文返回，避免线上只剩一个无信息的 500
      console.error("[fetch] 未捕获异常:", e);
      return new Response(`ERROR: ${e instanceof Error ? (e.stack || e.message) : String(e)}`, {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    // 按触发它的 cron 表达式分发（多 cron 共享同一个 scheduled 入口）
    if (event.cron === CRON_XB) {
      const r = await xbRun(env);
      console.log(`[xb] ${r.flag}`);
      return;
    }
    await runAll(env); // 默认：聚合签到（CRON_CHECKIN）
  },
};
