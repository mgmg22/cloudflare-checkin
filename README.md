# qinglong-checkin（Cloudflare Worker 版签到）

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mgmg22/cloudflare-checkin)

把青龙脚本库 [QinglongMy](https://github.com/mgmg22/QinglongMy) 的 Python 签到脚本重写成 **TypeScript + Cloudflare Workers**，
由 **Cron Triggers** 定时触发，无需常驻服务器。覆盖四个任务：

| 任务 | 说明 |
| --- | --- |
| WorkBuddy | 每日签到 + 成长中心（派猫旅行/开盲盒），并汇总「总剩余积分」（对齐 py 版 `run_full` 全量流程） |
| Trae Work | 每日积分签到，内置 ECDSA 设备私钥自动续期（对齐 `trae_checkin.py`） |
| MiniMax Code | 每日积分签到，先续期再签到（对齐 `minimax_checkin.py`） |
| XB 线报 | 抓 0818tuan 线报 → 黑白名单过滤 → KV 去重 → AI 评分 → 钉钉推 markdown（对齐 `xb.py`） |

> 不含原仓库其余抓取类脚本（douban / job / stock / weibo 等）。

## 定时（两条 Cron，对齐 py 版时间）

时间均为**北京时间 UTC+8**，Cloudflare Cron 表达式用 **UTC** 写：

| Cron（UTC） | 北京时间 | 跑什么 | 对齐的 py 脚本 |
| --- | --- | --- | --- |
| `8 16 * * *` | 00:08 CST | WorkBuddy / Trae / MiniMax（聚合三项，合并结果只发一次推送） | `checkin_all.py` |
| `3,33 0-15 * * *` | 8~23 点每小时的 03/33 分 | XB 线报抓取 + AI 评分 + 钉钉推送 | `xb.py`（`3/30 8/1 * * *`） |

## 目录结构

```
cloudflare-checkin/
├─ wrangler.toml          # Worker 配置 + 两条 cron + KV 绑定（注释）；变量不写在 [vars]（部署会清空），由 setup-secrets.sh / 控制台注入
├─ package.json
├─ tsconfig.json
├─ src/
│  ├─ index.ts            # 编排：scheduled() 按两条 cron 分发 / fetch() 手动触发（/?run=1、/?run=xb[&dry=1]）
│  ├─ types.ts            # Env / CheckinResult 类型
│  ├─ tasks/              # workbuddy / trae / minimax / xb 四个任务
│  └─ lib/                # http / crypto / md5 / notify 公共库
└─ scripts/
   ├─ setup-secrets.sh    # 推送变量到 Cloudflare（wrangler secret put 加密存储）；Trae 的 token/refresh_token 优先取 py 续期缓存 .trae_token.json
   └─ test-crypto.ts      # MD5 / ECDSA 加密单测
```

## 环境变量（Secret，加密存储）

**不要写进 `wrangler.toml` 的 `[vars]` 块**（否则 `wrangler deploy` 会把控制台已填好的真实值清空）。
统一为 **Cloudflare Secrets（加密存储，`wrangler secret put` / 控制台录入）**，Worker 内 `env.X` 读取方式不变，首次设置任选其一，之后长期有效、不被部署覆盖：

- 跑 `bash scripts/setup-secrets.sh <青龙 .env 路径> [py 续期缓存 .trae_token.json 路径]` 一键推送全部变量
  （Trae 的 token/refresh 优先取 py 续期缓存 `.trae_token.json` 的新鲜值）；
- 或在 Cloudflare 控制台「Workers & Pages → 你的 Worker → Settings → Variables and Secrets」逐项录入（类型选 Secret）。

手动覆盖同样用 `wrangler secret put`（前提：Worker 已部署）或控制台录入，均不进仓库。

清单与 `src/types.ts` 的 `Env` 一一对应：

- WorkBuddy：`WB_ACCESS_TOKEN` / `WB_USER_ID`（`WB_DOMAIN` 可选，成长中心按产品路由）
- Trae：`TRAE_TOKEN` / `TRAE_DEVICE_ID` / `TRAE_USER_ID` / `TRAE_REFRESH_TOKEN` /
  `TRAE_DEVICE_KEY_PEM` / `TRAE_DEVICE_PUB_PEM` / `TRAE_MACHINE_ID`（可选）
- MiniMax：`MINIMAX_TOKEN` / `MINIMAX_USER_ID` / `MINIMAX_UUID`（可选）/ `MINIMAX_DEVICE_ID`（可选）
- XB 线报：`API_KEY` / `API_URL`（AI 分析）、`XB_BOT_TOKEN` / `XB_BOT_TOKEN_SECRET`（可选，钉钉加签）
- 通知：`NOTIFY_PUSH_KEY`（server酱，对应青龙 `.env` 的 `PUSH_KEY_MY`）

> `TRAE_APP_VERSION` 内置默认 `1.107.1`，无需配置（未列入 `[vars]`）。

## 本地开发

```bash
npm install
# 本地 dev 用：新建 .dev.vars（已被 .gitignore 忽略），从青龙 .env 复制同名 key
# （PUSH_KEY_MY 需改名为 NOTIFY_PUSH_KEY）。setup-secrets.sh 走 `wrangler secret put` 写入云端，仅用于部署，不生成本地 .dev.vars
npm run test:crypto               # 跑加密单测（MD5 向量 + ECDSA 往返）
npm run typecheck                 # tsc --noEmit
npm run dev                       # wrangler dev 本地起服务，浏览器访问 /?run=1（聚合签到）、/?run=xb&dry=1（线报 dry 验证，不推钉钉不写 KV）
```

## 部署（需要你自己的 Cloudflare 账号，AI 无法代为登录）

### 自动部署（Cloudflare Git 集成，push 即上线，零 secret，推荐）

在 Cloudflare 控制台把 Worker 连到本仓库，push 到 `main` 自动构建部署。**GitHub 侧无需配置任何 secret**：仓库读取走 Cloudflare GitHub App 的 OAuth 授权，部署用 API token 由 Cloudflare 自动生成并保存在 CF 侧。

连接步骤（Workers & Pages → `qinglong-checkin` → Settings → Builds）：

1. 若之前连过别的仓库（如一键部署 fork 出的副本），先 **Disconnect**；
2. **Connect** → 选 GitHub → 选**原始仓库 `mgmg22/cloudflare-checkin`** → 分支 `main`；
3. 构建配置：Build command 留空（纯 Worker 无需构建）、Deploy command 默认 `npx wrangler deploy`、Root directory 留空（仓库根）。

> ⚠️ 一定连**原始仓库**：「一键部署」按钮会 fork 一份副本并对接副本，之后 push 原仓库不会触发部署。

因为是纯代码部署、`wrangler.toml` 不含 `[vars]`，**部署不会清空你在控制台填好的变量**，每次 push 只是更新代码。变量首次用 `setup-secrets.sh` 或手动录入后长期有效。

### 备选：GitHub Actions 部署（需配 1~2 个 secret）

若更想在 GitHub 侧控制部署，可自建 `.github/workflows/deploy.yml`（`on: push → branches: [main]`）直接跑 `npm run deploy`，并在仓库 `Settings → Secrets and variables → Actions` 配置：

- `CLOUDFLARE_API_TOKEN`（**必需**——CI 非交互环境下 wrangler 唯一正规鉴权方式；Cloudflare 后台 *Edit Cloudflare Workers* 模板创建）；
- `CLOUDFLARE_ACCOUNT_ID`（**可选**——token 只授权单账号时 wrangler 自动推断，无需配置）。

坑提醒：不要依赖 `cloudflare/wrangler-action@v3` 的默认 Wrangler（3.90.0 已 EOL，常致 exit 1）；直接 `npm run deploy` 用项目本地 wrangler 更稳。

### 一键部署（Deploy to Cloudflare Workers）

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mgmg22/cloudflare-checkin)

> 一键部署会先 Fork 本仓库再部署，Worker 名默认取 `wrangler.toml` 里的 `qinglong-checkin`，无需手填。
> 由于变量不在 `[vars]`，向导**不预生成变量表单**——部署完成后，运行 `bash scripts/setup-secrets.sh`
> （或去控制台 Secrets 手动录入）推送全部变量（清单见上）即可。
> KV 绑定默认启用（`CHECKIN_STATE`，Trae/MiniMax 滚动 token 缓存 + XB 线报 id 去重）；换账号时
> `wrangler kv namespace create CHECKIN_STATE` 后把新 id 填回 `wrangler.toml`。

### 手动部署（完整控制）

```bash
cd cloudflare-checkin

# 1) 登录 Cloudflare（浏览器授权）
npx wrangler login

# 2) KV 命名空间：wrangler.toml 已含默认绑定，账号一致可跳过；换账号时执行本命令并把新 id 填回
npx wrangler kv namespace create CHECKIN_STATE

# 3) 部署（先部署，变量 secret 绑定才能落库）
npx wrangler deploy

# 4) 推送全部变量（wrangler secret put，加密存储）。Trae 的 token / refresh_token 优先取
#    py 续期缓存 .trae_token.json（.env 里多为过期快照）。
#    用法：bash scripts/setup-secrets.sh <QinglongMy/.env 路径> [py续期缓存 .trae_token.json 路径]
bash scripts/setup-secrets.sh ~/QinglongMy/.env ~/QinglongMy/.trae_token.json
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
  首跑 / KV 为空时依赖 secrets 里的初始 `TRAE_REFRESH_TOKEN`，请填 py 续期缓存 `.trae_token.json`
  中的新鲜值（`.env` 里多为过期快照）——`scripts/setup-secrets.sh` 已按此优先级取值。
- **免费版注意**：单次 10ms CPU、账号最多 5 个 cron、50 子请求/次、KV 已含；
  Cron 失败自动重试（可 `controller.noRetry()` 关闭）、无内置告警。本流程是几次顺序 HTTPS + 一次 WebCrypto 签名，通常在 10ms CPU 内。
