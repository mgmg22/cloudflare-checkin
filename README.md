# qinglong-checkin（Cloudflare Worker 版签到）

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mgmg22/cloudflare-checkin)

把 `E:\QinglongMy` 的 Python 签到脚本重写成 **TypeScript + Cloudflare Workers**，
由 **Cron Triggers** 定时触发，无需常驻服务器。覆盖四个任务：

| 任务 | 说明 |
| --- | --- |
| WorkBuddy | 每日积分签到，并汇总「总剩余积分」 |
| Trae Work | 每日积分签到，内置 ECDSA 设备私钥自动续期（对齐 `trae_checkin.py`） |
| MiniMax Code | 每日积分签到，先续期再签到（对齐 `minimax_checkin.py`） |
| 美团 | 每日领券（对齐 `meituan_checkin.py`） |

> 不含原仓库的抓取类脚本（douban / job / stock / weibo / xb 等），只迁移签到自动化。

## 定时（两条 Cron，对齐 py 版时间）

时间均为**北京时间 UTC+8**，Cloudflare Cron 表达式用 **UTC** 写：

| Cron（UTC） | 北京时间 | 跑什么 | 对齐的 py 脚本 |
| --- | --- | --- | --- |
| `8 16 * * *` | 00:08 CST | WorkBuddy / Trae / MiniMax（聚合三项） | `checkin_all.py` |
| `55 2 * * *` | 10:55 CST | 仅美团 | `meituan_checkin.py` |

Worker 在 `scheduled()` 里用 `event.cron` 区分：命中美团 cron 只跑美团，
否则跑聚合三项（即 py 版 `checkin_all` 的集合，不含美团，避免重复领券）。

> 想改成「聚合 cron 也顺带跑美团」，把 `src/index.ts` 里 `runAll` 的
> `TASKS.filter((t) => t.name !== "美团")` 改成 `TASKS` 即可。

## 目录结构

```
cloudflare-checkin/
├─ wrangler.toml          # Worker 配置 + 两条 cron + KV 绑定
├─ package.json
├─ tsconfig.json
├─ .dev.vars.example      # 本地 dev 用的环境变量样例（不要提交真实密钥）
├─ src/
│  ├─ index.ts            # 编排：scheduled() / fetch() 手动触发
│  ├─ types.ts            # Env / CheckinResult 类型
│  ├─ tasks/              # workbuddy / trae / minimax / meituan 四个任务
│  └─ lib/                # http / crypto / md5 / notify 公共库
└─ scripts/
   ├─ setup-secrets.sh    # 从本机 .env 批量推送到 Cloudflare Secret（17 项）
   └─ test-crypto.ts      # MD5 / ECDSA 加密单测
```

## 环境变量 / Secrets

全部通过 Cloudflare **Secret**（`wrangler secret put` 或控制台录入），不进仓库。
清单与 `src/types.ts` 的 `Env` 一一对应；本地 dev 用 `.dev.vars`（见 `.dev.vars.example`）：

- WorkBuddy：`WB_ACCESS_TOKEN` / `WB_USER_ID`
- Trae：`TRAE_TOKEN` / `TRAE_DEVICE_ID` / `TRAE_USER_ID` / `TRAE_REFRESH_TOKEN` /
  `TRAE_DEVICE_KEY_PEM` / `TRAE_DEVICE_PUB_PEM` / `TRAE_MACHINE_ID`（可选）
- MiniMax：`MINIMAX_TOKEN` / `MINIMAX_USER_ID` / `MINIMAX_UUID`（可选）/ `MINIMAX_DEVICE_ID`（可选）
- 美团：`MT_TOKEN` / `MT_CLIENT_ID`（可选）/ `MT_AISCENE`（可选）
- 通知：`NOTIFY_PUSH_KEY`（server酱，对应本机 `.env` 的 `PUSH_KEY_MY`）

> `TRAE_APP_VERSION` 内置默认 `1.107.1`，无需配置。

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars   # 填入真实值（.dev.vars 已被 .gitignore 忽略）
npm run test:crypto               # 跑加密单测（MD5 向量 + ECDSA 往返）
npm run typecheck                 # tsc --noEmit
npm run dev                       # wrangler dev 本地起服务，浏览器访问 /?key=... 手动触发
```

## 部署（需要你自己的 Cloudflare 账号，AI 无法代为登录）

### 一键部署（Deploy to Cloudflare Workers）

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mgmg22/cloudflare-checkin)

> 一键部署会先 Fork 本仓库再部署，适合先跑起来看效果。
> 向导会列出代码用到的全部 18 个绑定（含可选的 `API_KEY`），逐项填入 `.env` 对应值即可，只需填一遍；
> 仓库里的 `CHECKIN_STATE.id` 仍是占位符 `REPLACE_WITH_YOUR_KV_ID`，
> 若向导未自动创建 KV，需手动 `npx wrangler kv namespace create CHECKIN_STATE` 并回填 id，
> 否则 Worker 运行会因缺 KV 而报错。

### 手动部署（完整控制）

```bash
cd cloudflare-checkin

# 1) 登录 Cloudflare（浏览器授权）
npx wrangler login

# 2) 建 KV 命名空间，把返回的 id 填进 wrangler.toml 的 CHECKIN_STATE.id
npx wrangler kv namespace create CHECKIN_STATE

# 3) 从本机 E:/QinglongMy/.env 批量推送 secret（含可选 API_KEY）
bash scripts/setup-secrets.sh
# 可选：设手动触发密码
printf '%s' '<你的API_KEY>' | npx wrangler secret put API_KEY

# 4) 部署
npx wrangler deploy
```

部署后可在 Cloudflare 控制台「Workers & Pages → 你的 Worker → Settings → Triggers」看到两条 Cron；
失败排查看控制台「Cron Events」（近 100 次调用）/ Workers Logs
（Cron 失败会被平台自动重试，但无内置告警）。

## 实现要点

- **WebCrypto 限制**：Workers 运行时只有 `crypto.subtle`，无 MD5、且 ECDSA
  返回 IEEE P1363（raw `r||s`）而非 DER。本项目自带纯 TS 的 `md5.ts`（RFC1321），
  `crypto.ts` 把 P1363 拆成 `(r,s)`、做低 s 归一化后重编码成 DER（Trae 服务端按 DER 校验）。
- **滚动凭据持久化**：Trae / MiniMax 续期后的 token 写进 KV 命名空间 `CHECKIN_STATE`
  （键 `trae` / `minimax`），替代原 Python 的本地缓存文件 `.trae_token.json` / `.minimax_token.json`。
- **免费版注意**：单次 10ms CPU、账号最多 5 个 cron、50 子请求/次、KV 已含；
  Cron 失败自动重试（可 `controller.noRetry()` 关闭）、无内置告警。本流程是几次顺序 HTTPS + 一次 WebCrypto 签名，通常在 10ms CPU 内。
