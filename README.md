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
├─ wrangler.toml          # Worker 配置 + 两条 cron + KV 绑定（注释）；变量不写死在 [vars]，改由控制台 / setup-secrets.sh 注入
├─ package.json
├─ tsconfig.json
├─ src/
│  ├─ index.ts            # 编排：scheduled() 定时触发 / fetch() 手动触发（/?run=1、/?run=1&only=meituan）
│  ├─ types.ts            # Env / CheckinResult 类型
│  ├─ tasks/              # workbuddy / trae / minimax / meituan 四个任务
│  └─ lib/                # http / crypto / md5 / notify 公共库
└─ scripts/
   ├─ setup-secrets.sh    # 推送文本变量到 Cloudflare（17 项，不加密）；Trae 的 token/refresh_token 优先取 py 续期缓存 .trae_token.json
   └─ test-crypto.ts      # MD5 / ECDSA 加密单测
```

## 环境变量（文本变量，不加密）

**不再写进 `wrangler.toml` 的 `[vars]` 块**（否则 `wrangler deploy` 会把控制台已填好的真实值清空成空）。
统一为 **Cloudflare 文本变量（明文，不加密）**，首次设置任选其一，之后长期有效、不被部署覆盖：

- 跑 `bash scripts/setup-secrets.sh` 把本机 `.env` 的 17 项一键推送（Trae 的 token/refresh 优先取 py 续期缓存 `.trae_token.json`）；
- 或在 Cloudflare 控制台「Workers & Pages → 你的 Worker → Settings → Variables」逐项录入，**不勾选「加密」**。

手动覆盖同样用 `wrangler vars set` / 控制台录入，均不进仓库。

清单与 `src/types.ts` 的 `Env` 一一对应：

- WorkBuddy：`WB_ACCESS_TOKEN` / `WB_USER_ID`
- Trae：`TRAE_TOKEN` / `TRAE_DEVICE_ID` / `TRAE_USER_ID` / `TRAE_REFRESH_TOKEN` /
  `TRAE_DEVICE_KEY_PEM` / `TRAE_DEVICE_PUB_PEM` / `TRAE_MACHINE_ID`（可选）
- MiniMax：`MINIMAX_TOKEN` / `MINIMAX_USER_ID` / `MINIMAX_UUID`（可选）/ `MINIMAX_DEVICE_ID`（可选）
- 美团：`MT_TOKEN` / `MT_CLIENT_ID`（可选）/ `MT_AISCENE`（可选）
- 通知：`NOTIFY_PUSH_KEY`（server酱，对应本机 `.env` 的 `PUSH_KEY_MY`）

> `TRAE_APP_VERSION` 内置默认 `1.107.1`，无需配置（未列入 `[vars]`）。

## 本地开发

```bash
npm install
# 本地 dev 用：新建 .dev.vars（已被 .gitignore 忽略），把本机 .env 的同名 key 复制进去
# （PUSH_KEY_MY 需改名为 NOTIFY_PUSH_KEY）。setup-secrets.sh 走 `wrangler vars set` 写入云端 Worker 变量，仅用于部署，不生成本地 .dev.vars
npm run test:crypto               # 跑加密单测（MD5 向量 + ECDSA 往返）
npm run typecheck                 # tsc --noEmit
npm run dev                       # wrangler dev 本地起服务，浏览器访问 /?run=1 手动触发（/?run=1&only=meituan 仅美团）
```

## 部署（需要你自己的 Cloudflare 账号，AI 无法代为登录）

### 自动部署（GitHub Actions，push 即上线，推荐）

仓库根 `.github/workflows/deploy.yml` 在每次 push 到 `main` 时自动跑 `wrangler deploy`：

```yaml
on: push: branches: [main]
uses: cloudflare/wrangler-action@v3
with:
  apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
  accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

前置：在仓库 `Settings → Secrets and variables → Actions` 添加两个 secret：

- `CLOUDFLARE_API_TOKEN`：Cloudflare 后台 *Account API Tokens* 新建，给 **Edit Cloudflare Workers** 权限；
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 控制台 Overview 的 Account ID。

因为是纯代码部署、`wrangler.toml` 不含 `[vars]`，**部署不会清空你在控制台填好的变量**，每次 push 只是更新代码。变量首次用 `setup-secrets.sh` 或手动录入后长期有效。

### 一键部署（Deploy to Cloudflare Workers）

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mgmg22/cloudflare-checkin)

> 一键部署会先 Fork 本仓库再部署，Worker 名默认取 `wrangler.toml` 里的 `qinglong-checkin`，无需手填。
> 由于变量已不在 `[vars]`，向导**不再预生成变量表单**——部署完成后，运行 `bash scripts/setup-secrets.sh`
> （或去控制台 Variables 手动录入，均不加密）把 17 项文本变量推上去即可。
> KV 持久化默认关闭（已在 `wrangler.toml` 注释掉），所以一键部署可直接跑通，无需先建 KV。
> 想让 Trae / MiniMax 的续期 token 跨调用缓存：Workers & Pages → KV → 新建命名空间，
> 复制 id 填回 `wrangler.toml` 的 `CHECKIN_STATE.id` 并取消注释对应行即可。

### 手动部署（完整控制）

```bash
cd cloudflare-checkin

# 1) 登录 Cloudflare（浏览器授权）
npx wrangler login

# 2) （可选）建 KV 命名空间做 token 持久化；不做也能跑。要做就把 id 填进 wrangler.toml 的 CHECKIN_STATE.id 并取消注释
npx wrangler kv namespace create CHECKIN_STATE

# 3) 部署（先部署，文本变量绑定才能落库）
npx wrangler deploy

# 4) 推送文本变量到 Cloudflare（17 项，不加密）。Trae 的 token / refresh_token
#    优先取自 py 续期缓存 .trae_token.json（避免 .env 里的旧快照失效）。
#    用法：bash scripts/setup-secrets.sh [本机 .env 路径] [缓存 json 路径]
bash scripts/setup-secrets.sh
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
  首跑 / KV 为空时依赖 `[vars]` 里的初始 `TRAE_REFRESH_TOKEN`，请填 py 续期缓存 `.trae_token.json`
  中的新鲜值（而非 `.env` 快照）——`scripts/setup-secrets.sh` 已默认这样取，正是本地与 py 表现一致的关键。
- **免费版注意**：单次 10ms CPU、账号最多 5 个 cron、50 子请求/次、KV 已含；
  Cron 失败自动重试（可 `controller.noRetry()` 关闭）、无内置告警。本流程是几次顺序 HTTPS + 一次 WebCrypto 签名，通常在 10ms CPU 内。
