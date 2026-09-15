/// <reference types="@cloudflare/workers-types" />
import type { Env, CheckinResult } from "./types";
import { run as workbuddyRun } from "./tasks/workbuddy";
import { run as traeRun } from "./tasks/trae";
import { run as minimaxRun } from "./tasks/minimax";
import { run as meituanRun } from "./tasks/meituan";
import { notifyServerJ } from "./lib/notify";

interface TaskDef {
  name: string;
  title: string;
  fn: (env: Env) => Promise<CheckinResult>;
}

const TASKS: TaskDef[] = [
  { name: "WorkBuddy", title: "WorkBuddy 每日签到", fn: workbuddyRun },
  { name: "Trae Work", title: "Trae Work 每日签到", fn: traeRun },
  { name: "MiniMax Code", title: "MiniMax Code 每日签到", fn: minimaxRun },
  { name: "美团", title: "美团每日领券", fn: meituanRun },
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

async function runAll(env: Env, onlyMeituan = false): Promise<string> {
  // 对齐 py 版：聚合签到 cron 只跑 WorkBuddy / Trae / MiniMax（不含美团）；
  // 美团专用 cron 只跑美团。onlyMeituan 由 scheduled() 按 event.cron 决定。
  const tasks = onlyMeituan
    ? TASKS.filter((t) => t.name === "美团")
    : TASKS.filter((t) => t.name !== "美团");
  const results: [string, CheckinResult][] = [];
  for (const t of tasks) {
    try {
      const r = await t.fn(env);
      results.push([t.name, r]);
      console.log(`[${t.name}] ${r.flag}`);
    } catch (e: any) {
      results.push([t.name, { flag: "ERROR", content: `⚠️ 执行异常：${e?.message || e}` }]);
      console.error(`[${t.name}] ERROR`, e);
    }
  }
  const allOk = results.every(
    ([, r]) => r.flag === "SUCCESS" || r.flag === "ALREADY_TODAY",
  );
  const summary = buildSummary(results);
  try {
    await notifyServerJ(`每日Token签到汇总 ${allOk ? "✅" : "⚠️"}`, summary, env.NOTIFY_PUSH_KEY);
  } catch (e) {
    console.warn("[notify] 通知失败", e);
  }
  return summary;
}

// 美团专用 cron（UTC，对应 py 版 meituan_checkin.py 的 55 10 * * * = 10:55 CST）。
// wrangler.toml 里两条 cron 通过 event.cron 区分：命中此表达式则只跑美团，否则跑全部。
const MEITUAN_CRON = "55 2 * * *";

export default {
  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    // event.cron 为空（部分本地/旧运行时）时回落到跑全部
    const onlyMeituan = event.cron === MEITUAN_CRON;
    await runAll(env, onlyMeituan);
  },
};
